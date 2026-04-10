/**
 * Profile routes
 * GET /api/client-memory/:clientId, POST /api/client-memory,
 * GET /api/client-profile/:clientId, PUT /api/client-profile/:clientId,
 * PUT /api/client-profiles/:clientId/tags,
 * POST /api/client-profiles/:clientId/memory,
 * DELETE /api/client-profiles/:clientId/memory,
 * POST /api/profile-agent/event
 */
const express = require('express');
const router = express.Router();
const db = require('../../db');
const { writeAudit } = require('../middleware/audit');

// GET /api/client-memory/:clientId
router.get('/client-memory/:clientId', async (req, res) => {
    try {
        const { clientId } = req.params;
        if (!clientId || typeof clientId !***REMOVED*** 'string' || clientId.length > 50) {
            return res.status(400).json({ error: 'invalid clientId' });
        }
        const db2 = db.getDb();
        const rows = await db2.prepare(`
            SELECT * FROM client_memory
            WHERE client_id = ?
            ORDER BY memory_type, confidence DESC
        `).all(clientId);
        res.json(rows);
    } catch (err) {
        console.error('GET /api/client-memory error:', err);
        res.status(500).json({ error: err.message });
    }
});

// POST /api/client-memory
router.post('/client-memory', async (req, res) => {
    try {
        const { client_id, memory_type, memory_key, memory_value, confidence = 1 } = req.body;
        if (!client_id || !memory_type || !memory_key || !memory_value) {
            return res.status(400).json({ error: 'client_id, memory_type, memory_key, memory_value required' });
        }
        const db2 = db.getDb();
        await db2.prepare(`
            INSERT INTO client_memory
            (client_id, memory_type, memory_key, memory_value, confidence, updated_at)
            VALUES (?, ?, ?, ?, ?, NOW())
            ON DUPLICATE KEY UPDATE memory_value = VALUES(memory_value), confidence = VALUES(confidence), updated_at = NOW()
        `).run(client_id, memory_type, memory_key, memory_value, confidence);

        await writeAudit('client_memory_update', 'client_memory', null, null, {
            client_id, memory_type, memory_key, memory_value, confidence
        }, req);
        res.json({ ok: true });
    } catch (err) {
        console.error('POST /api/client-memory error:', err);
        res.status(500).json({ error: err.message });
    }
});

// GET /api/client-profile/:clientId
router.get('/client-profile/:clientId', async (req, res) => {
    try {
        const db2 = db.getDb();
        const { clientId } = req.params;

        const profile = await db2.prepare('SELECT * FROM client_profiles WHERE client_id = ?').get(clientId);
        const tags = await db2.prepare(
            'SELECT * FROM client_tags WHERE client_id = ? ORDER BY confidence DESC'
        ).all(clientId);
        const memory = await db2.prepare(
            'SELECT * FROM client_memory WHERE client_id = ? ORDER BY created_at DESC LIMIT 20'
        ).all(clientId);

        const profileData = profile || { summary: null, tiktok_data: null, stage: null, last_interaction: null, last_updated: null };

        const creator = await db2.prepare(`
            SELECT c.primary_name as name, c.wa_owner, c.keeper_username,
                   wc.beta_status as conversion_stage, wc.priority,
                   k.keeper_gmv, k.keeper_videos, k.keeper_orders
            FROM creators c
            LEFT JOIN wa_crm_data wc ON wc.creator_id = c.id
            LEFT JOIN keeper_link k ON k.creator_id = c.id
            WHERE c.wa_phone = ?
        `).get(clientId);

        res.json({
            client_id: clientId,
            name: creator?.name || null,
            wa_owner: creator?.wa_owner || null,
            keeper_username: creator?.keeper_username || null,
            conversion_stage: creator?.conversion_stage || null,
            priority: creator?.priority || null,
            summary: profileData.summary || null,
            tags: tags.map(t => ({ tag: t.tag, source: t.source, confidence: t.confidence })),
            tiktok_data: profileData.tiktok_data ? JSON.parse(profileData.tiktok_data) : null,
            stage: profileData.stage || creator?.conversion_stage || null,
            last_interaction: profileData.last_interaction,
            last_updated: profileData.last_updated,
            memory: memory.map(m => ({ type: m.memory_type, key: m.memory_key, value: m.memory_value })),
        });
    } catch (err) {
        console.error('GET /api/client-profile error:', err);
        res.status(500).json({ error: err.message });
    }
});

// PUT /api/client-profile/:clientId
router.put('/client-profile/:clientId', async (req, res) => {
    try {
        const db2 = db.getDb();
        const { clientId } = req.params;
        const { summary } = req.body;

        const updated = await db2.prepare(`
            UPDATE client_profiles SET summary = ?, last_updated = CURRENT_TIMESTAMP WHERE client_id = ?
        `).run(summary || '', clientId);

        if (updated.changes ***REMOVED***= 0) {
            await db2.prepare(`
                INSERT INTO client_profiles (client_id, summary) VALUES (?, ?)
            `).run(clientId, summary || '');
        }

        res.json({ ok: true });
    } catch (err) {
        console.error('PUT /api/client-profile error:', err);
        res.status(500).json({ error: err.message });
    }
});

// PUT /api/client-profiles/:clientId/tags
router.put('/client-profiles/:clientId/tags', async (req, res) => {
    try {
        const db2 = db.getDb();
        const { clientId } = req.params;
        const { tag, value, action = 'upsert', confidence = 3 } = req.body;

        if (!tag) return res.status(400).json({ error: 'tag required' });

        if (action ***REMOVED***= 'delete') {
            await db2.prepare('DELETE FROM client_tags WHERE client_id = ? AND tag = ?').run(clientId, tag);
        } else {
            const fullTag = tag.includes(':') ? tag : `${tag}:${value || 'true'}`;
            await db2.prepare(`
                INSERT INTO client_tags (client_id, tag, source, confidence)
                VALUES (?, ?, 'manual', ?)
                ON DUPLICATE KEY UPDATE confidence = VALUES(confidence), tag = VALUES(tag)
            `).run(clientId, fullTag, confidence);
        }

        res.json({ ok: true });
    } catch (err) {
        console.error('PUT /api/client-profiles/tags error:', err);
        res.status(500).json({ error: err.message });
    }
});

// POST /api/client-profiles/:clientId/memory
router.post('/client-profiles/:clientId/memory', async (req, res) => {
    try {
        const db2 = db.getDb();
        const { clientId } = req.params;
        const { memory_type, memory_key, memory_value } = req.body;

        if (!memory_type || !memory_key || memory_value ***REMOVED***= undefined) {
            return res.status(400).json({ error: 'memory_type, memory_key and memory_value required' });
        }

        await db2.prepare(`
            INSERT INTO client_memory (client_id, memory_type, memory_key, memory_value)
            VALUES (?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE memory_value = VALUES(memory_value)
        `).run(clientId, memory_type, memory_key, memory_value);

        res.json({ ok: true });
    } catch (err) {
        console.error('POST /api/client-profiles/memory error:', err);
        res.status(500).json({ error: err.message });
    }
});

// DELETE /api/client-profiles/:clientId/memory
router.delete('/client-profiles/:clientId/memory', async (req, res) => {
    try {
        const db2 = db.getDb();
        const { clientId } = req.params;
        const { memory_type, memory_key } = req.body;

        if (!memory_type || !memory_key) {
            return res.status(400).json({ error: 'memory_type and memory_key required' });
        }

        await db2.prepare('DELETE FROM client_memory WHERE client_id = ? AND memory_type = ? AND memory_key = ?')
            .run(clientId, memory_type, memory_key);

        res.json({ ok: true });
    } catch (err) {
        console.error('DELETE /api/client-profiles/memory error:', err);
        res.status(500).json({ error: err.message });
    }
});

// ***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED*** MiniMax LLM 标签提取 ***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED***

const LABEL_SYSTEM_PROMPT = `你是一个客户对话标签提取专家。根据用户消息提取结构化标签。

标签体系（每条标签格式：type:value）：
- format类: video | text | voice | image | carousel
- tone类: formal | casual | aggressive | friendly | hesitant
- urgency类: high | medium | low
- engagement类: high | medium | low | passive
- intent类: purchase_intent | info_seeking | complaint | renewal | upgrade | churn_risk | referral
- topic类: pricing | demo | tutorial | contract | feature_request | trial | commission | payment | gmv | mcn | content | violation
- preference类: video_preferred | text_preferred | async_communication | detailed_response | brief_response
- stage类: first_contact | trial_intro | trial_active | monthly_inquiry | mcn_joined | churned | loyal

规则：
- 只输出与消息内容明确相关的标签，不要猜测
- 最多输出5个标签，没有合适的标签则返回空数组
- 每条标签需要附上简短 reason 说明提取依据
- 输出必须是合法JSON格式`;

async function extractTagsWithLLM(text) {
    if (!text || text.trim().length < 3) return [];

    const API_KEY = process.env.MINIMAX_API_KEY;
    if (!API_KEY) {
        console.warn('[profile-agent] MINIMAX_API_KEY not set, skipping LLM extraction');
        return [];
    }

    try {
        const response = await fetch('https://api.minimaxi.com/anthropic/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': API_KEY,
                'anthropic-version': '2023-06-01',
            },
            body: JSON.stringify({
                model: 'mini-max-typing',
                messages: [{
                    role: 'user',
                    content: `${LABEL_SYSTEM_PROMPT}\n\n用户消息: "${text}"\n\n请直接输出JSON，不要任何其他内容：`
                }],
                max_tokens: 400,
                temperature: 0.2,
            }),
            signal: AbortSignal.timeout(15000),
        });

        if (!response.ok) {
            console.warn(`[profile-agent] LLM extraction failed: ${response.status}`);
            return [];
        }

        let data;
        try {
            data = await response.json();
        } catch (err) {
            const bodyText = await response.clone().text();
            console.warn(`[profile-agent] non-JSON response (status ${response.status}):`, bodyText.slice(0, 80));
            return [];
        }
        const textItem = data.content?.find(item => item.type ***REMOVED***= 'text');
        const raw = textItem?.text?.trim() || '';

        // 清理 Markdown code fence，再提取 JSON（非贪心匹配第一个块）
        const cleaned = raw
            .replace(/```json\s*/gi, '')
            .replace(/```\s*/gi, '')
            .trim();
        const jsonMatch = cleaned.match(/\{[\s\S]*?\}/) || cleaned.match(/\[[\s\S]*?\]/);
        if (!jsonMatch) {
            console.warn('[profile-agent] LLM response has no JSON:', raw.slice(0, 100));
            return [];
        }

        const parsed = JSON.parse(jsonMatch[0]);
        const tags = Array.isArray(parsed) ? parsed : parsed.tags || [];

        // 规范化：统一转成 { tag, source: 'ai_extracted', reason } 格式
        return tags
            .filter(t => t.tag && typeof t.tag ***REMOVED***= 'string')
            .map(t => ({
                tag: t.tag,
                source: 'ai_extracted',
                reason: t.reason || '',
                confidence: t.confidence || 2,
            }));
    } catch (err) {
        console.warn(`[profile-agent] LLM extraction error: ${err.message}`);
        return [];
    }
}

// ***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED*** 事件触发入口 ***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED***

// POST /api/profile-agent/event
router.post('/profile-agent/event', async (req, res) => {
    try {
        const { event_type, client_id, data: eventData } = req.body;
        if (!event_type || !client_id) {
            return res.status(400).json({ error: 'event_type and client_id required' });
        }

        const db2 = db.getDb();

        const creator = await db2.prepare('SELECT id FROM creators WHERE wa_phone = ?').get(client_id);
        if (!creator) {
            return res.status(404).json({ error: 'client not found' });
        }

        const profile = await db2.prepare('SELECT id FROM client_profiles WHERE client_id = ?').get(client_id);
        if (!profile) {
            await db2.prepare('INSERT INTO client_profiles (client_id) VALUES (?)').run(client_id);
        }

        let tags_added = [];

        if (event_type ***REMOVED***= 'wa_message') {
            const { text, role } = eventData || {};
            if (text) {
                // LLM 标签提取（主要方式）
                tags_added = await extractTagsWithLLM(text);
            }
        }

        // Insert tags（重复时保留较高的 confidence）
        for (const { tag, source, confidence } of tags_added) {
            await db2.prepare(
                'INSERT INTO client_tags (client_id, tag, source, confidence) ' +
                'VALUES (?, ?, ?, ?) ' +
                'ON DUPLICATE KEY UPDATE ' +
                'confidence = IF(VALUES(confidence) > confidence, VALUES(confidence), confidence)'
            ).run(client_id, tag, source, confidence || 2);
        }

        // 写入审计日志
        if (tags_added.length > 0) {
            await writeAudit('profile_tags_extracted', 'client_tags', null, null, {
                client_id, event_type, tags_added
            }, req);
        }

        // Trigger async profile refresh
        const { scheduleProfileRefresh } = require('../services/profileService');
        scheduleProfileRefresh(client_id);

        res.json({ ok: true, tags_added });
    } catch (err) {
        console.error('POST /api/profile-agent/event error:', err);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
