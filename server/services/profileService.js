/**
 * Profile Service — 异步画像摘要刷新
 * scheduleProfileRefresh: debounced 5s 触发 refreshProfileSummary
 */
const db = require('../../db');
const { evaluateCreatorLifecycle } = require('./lifecyclePersistenceService');
const { buildFallbackProfileSummary } = require('./profileFallbackService');

// 防止同一 client 频繁刷新的 debounce 标记
const _pendingRefresh = new Map(); // clientId → setImmediate handle

/**
 * 带 debounce 的 summary 刷新
 * 同一 client 5 秒内不重复触发
 */
function scheduleProfileRefresh(clientId) {
    if (_pendingRefresh.has(clientId)) {
        return;
    }
    const handle = setImmediate(async () => {
        _pendingRefresh.delete(clientId);
        try {
            await refreshProfileSummary(clientId);
        } catch (err) {
            console.error('scheduleProfileRefresh error:', err.message);
        }
    });
    _pendingRefresh.set(clientId, handle);
    setTimeout(() => _pendingRefresh.delete(clientId), 5000);
}

async function refreshProfileSummary(clientId) {
    try {
        const db2 = db.getDb();
        const creator = await db2.prepare(`
            SELECT c.id, c.primary_name as name, c.wa_owner, c.keeper_username,
                   wc.beta_status,
                   k.keeper_gmv, k.keeper_videos
            FROM creators c
            LEFT JOIN wa_crm_data wc ON wc.creator_id = c.id
            LEFT JOIN keeper_link k ON k.creator_id = c.id
            WHERE c.wa_phone = ?
        `).get(clientId);

        if (!creator) return;
        const lifecycleEval = await evaluateCreatorLifecycle(db2, creator.id).catch(() => null);
        const lifecycleLabel = lifecycleEval?.lifecycle?.stage_label || lifecycleEval?.lifecycle?.stage_key || '未知';

        const tags = await db2.prepare(
            'SELECT * FROM client_tags WHERE client_id = ? ORDER BY confidence DESC LIMIT 15'
        ).all(clientId);
        const memory = await db2.prepare(
            'SELECT * FROM client_memory WHERE client_id = ? ORDER BY created_at DESC LIMIT 5'
        ).all(clientId);
        const existingProfile = await db2.prepare(
            'SELECT summary FROM client_profiles WHERE client_id = ?'
        ).get(clientId);
        const existingSummary = String(existingProfile?.summary || '').trim();

        const tagLines = tags.map(t => t.tag).join(', ') || '暂无';
        const memLines = memory.map(m => m.memory_value).join('; ') || '暂无';

        const prompt = `客户画像分析（100-150字）。姓名:${creator.name || '未知'} | 负责人:${creator.wa_owner || '未知'} | 生命周期:${lifecycleLabel} | Beta子流程:${creator.beta_status || '未知'} | TikTok:${creator.keeper_username || '未知'} | 标签:${tagLines} | 记忆:${memLines}。请生成一段简洁的画像简介，包括用户特点、当前阶段、潜在需求。直接输出正文，不要前缀。`;

        const API_KEY = process.env.MINIMAX_API_KEY;
        let summary = '';
        if (!API_KEY) {
            console.warn('MINIMAX_API_KEY not set, using profile summary fallback when needed');
        } else {
            try {
                const response = await fetch('https://api.minimaxi.com/anthropic/v1/messages', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${API_KEY}`,
                        'x-api-key': API_KEY,
                        'anthropic-version': '2023-06-01',
                    },
                    body: JSON.stringify({
                        model: 'mini-max-typing',
                        messages: [{ role: 'user', content: prompt }],
                        max_tokens: 400,
                        temperature: 0.5,
                    }),
                    signal: AbortSignal.timeout(30000),
                });

                if (!response.ok) {
                    console.warn(`refreshProfileSummary llm failed: HTTP ${response.status}`);
                } else {
                    const data = await response.json();
                    const textItem = data.content?.find(item => item.type === 'text');
                    summary = String(textItem?.text || '').trim();
                }
            } catch (err) {
                console.warn('refreshProfileSummary llm error:', err.message);
            }
        }

        if (!summary && !existingSummary) {
            summary = buildFallbackProfileSummary({
                creator,
                lifecycleLabel,
                tags,
                memory,
            });
        }

        if (summary) {
            const updated = await db2.prepare(
                'UPDATE client_profiles SET summary = ?, last_updated = CURRENT_TIMESTAMP WHERE client_id = ?'
            ).run(summary, clientId);
            if (updated.changes === 0) {
                await db2.prepare(
                    'INSERT INTO client_profiles (client_id, summary) VALUES (?, ?)'
                ).run(clientId, summary);
            }
        }
    } catch (err) {
        console.error('refreshProfileSummary error:', err.message);
    }
}

module.exports = { scheduleProfileRefresh, refreshProfileSummary };
