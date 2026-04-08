/**
 * Per-User Profile Agent
 *
 * 负责维护每个客户的独立画像：标签提取、summary 生成、动态更新。
 * 所有数据严格按 client_id 隔离。
 *
 * 事件类型：
 *   wa_message    - 从 WA 消息中提取偏好
 *   sft_record    - 从 SFT 记录中学习场景表现
 *   keeper_update - 从 Keeper 数据中提取 TikTok 统计
 *   manual_tag    - 运营人员手工标注
 *
 * 用法：
 *   node agents/profile-agent.js --event wa_message --client_id 16145639865 --data '{}'
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, '..', 'crm.db');
const API_KEY = '***REMOVED***';
const API_BASE = 'https://api.minimaxi.com/anthropic';

// ***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED*** MiniMax API ***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED***

async function generateSummary(clientInfo, tags, recentMemory) {
    const prompt = `你是一个专业的客户画像分析师。根据以下信息，为这位客户生成一段简洁的画像摘要（50字以内）。

客户信息：
- 姓名: ${clientInfo.name || '未知'}
- 负责人: ${clientInfo.wa_owner || '未知'}
- 建联阶段: ${clientInfo.conversion_stage || '未知'}
- TikTok: ${clientInfo.keeper_username || '未知'} | GMV: ${clientInfo.keeper_gmv || 0} | 粉丝: ${clientInfo.keeper_videos || '未知'}

已知标签: ${tags.map(t => `${t.tag}(${t.source})`).join(', ') || '暂无'}

最近对话摘要: ${recentMemory.map(m => m.memory_value).join('; ') || '暂无'}

请直接输出一段该客户的画像简介，不要解释。`;

    const response = await fetch(`${API_BASE}/v1/messages`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': API_KEY,
            'anthropic-version': '2023-06-01',
            'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
            model: 'mini-max-typing',
            messages: [{ role: 'user', content: prompt }],
            max_tokens: 200,
            temperature: 0.5,
        }),
    });

    if (!response.ok) {
        const err = await response.text();
        throw new Error(`MiniMax API error: ${response.status} - ${err}`);
    }

    const data = await response.json();
    const textItem = data.content?.find(item => item.type ***REMOVED***= 'text');
    return textItem?.text?.trim() || null;
}

// ***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED*** Tag Extraction Rules ***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED***

/**
 * 从 WA 消息中提取标签
 */
function extractTagsFromMessage(text, role = 'user') {
    if (!text) return [];
    const t = text.toLowerCase();
    const tags = [];

    // preference 类
    if (/\b(prefer|更喜欢|比较喜欢)\b/.test(t)) {
        if (/\bvideo\b/.test(t)) tags.push({ tag: 'format:video', source: 'ai_extracted', confidence: 2 });
        if (/\btext\b/.test(t)) tags.push({ tag: 'format:text', source: 'ai_extracted', confidence: 2 });
        if (/\bvoice|call|audio\b/.test(t)) tags.push({ tag: 'format:voice', source: 'ai_extracted', confidence: 2 });
    }
    if (/\b(don't like|dislike|不喜欢)\b/.test(t)) {
        tags.push({ tag: 'preference:cautious', source: 'ai_extracted', confidence: 1 });
    }

    // style 类
    if (/\b(please|would|could|kindly)\b/.test(t)) {
        tags.push({ tag: 'tone:formal', source: 'ai_extracted', confidence: 2 });
    }
    if (/\b(hey|great|awesome|cool|yeah|thanks?)\b/.test(t)) {
        tags.push({ tag: 'tone:casual', source: 'ai_extracted', confidence: 2 });
    }

    // decision 类
    if (role ***REMOVED***= 'me' && /\b(decide[sd]?|chose|going with|选择了|已确认)\b/.test(t)) {
        tags.push({ tag: 'decision_made:true', source: 'ai_extracted', confidence: 3 });
    }

    // stage 类
    if (/\b(trial|7[\s-]?day|7day|free\s*try)\b/.test(t)) {
        tags.push({ tag: 'stage:trial_intro', source: 'ai_extracted', confidence: 2 });
    }
    if (/\b(monthly|month|card|membership)\b/.test(t)) {
        tags.push({ tag: 'stage:monthly_inquiry', source: 'ai_extracted', confidence: 2 });
    }
    if (/\b(commission|分成|提成)\b/.test(t)) {
        tags.push({ tag: 'stage:commission_query', source: 'ai_extracted', confidence: 2 });
    }
    if (/\b(mcn|agency|经纪)\b/.test(t)) {
        tags.push({ tag: 'stage:mcn_inquiry', source: 'ai_extracted', confidence: 2 });
    }

    // engagement 类
    if (role ***REMOVED***= 'user' && t.length > 50) {
        tags.push({ tag: 'engagement:detailed_response', source: 'ai_extracted', confidence: 1 });
    }

    return tags;
}

/**
 * 从 Keeper 数据提取标签
 */
function extractTagsFromKeeper(keeperData) {
    if (!keeperData) return [];
    const tags = [];

    if (keeperData.keeper_gmv > 0) {
        if (keeperData.keeper_gmv >= 3000) tags.push({ tag: 'gmv_tier:high', source: 'keeper_update', confidence: 3 });
        else if (keeperData.keeper_gmv >= 1000) tags.push({ tag: 'gmv_tier:medium', source: 'keeper_update', confidence: 3 });
        else tags.push({ tag: 'gmv_tier:low', source: 'keeper_update', confidence: 3 });
    }

    if (keeperData.keeper_videos > 0) {
        if (keeperData.keeper_videos >= 20) tags.push({ tag: 'content_active:high', source: 'keeper_update', confidence: 3 });
        else if (keeperData.keeper_videos >= 5) tags.push({ tag: 'content_active:medium', source: 'keeper_update', confidence: 3 });
        else tags.push({ tag: 'content_active:low', source: 'keeper_update', confidence: 2 });
    }

    return tags;
}

/**
 * 从 SFT 记录中学习
 */
function learnFromSftRecord(sftRecord) {
    const tags = [];
    if (!sftRecord) return tags;

    const ctx = sftRecord.context_json ? JSON.parse(sftRecord.context_json) : {};
    const scene = ctx.scene || 'unknown';

    // 场景标签
    tags.push({ tag: `scene:${scene}`, source: 'sft_feedback', confidence: 2 });

    // 如果 human_selected = 'custom'，说明模型在这个场景表现差
    if (sftRecord.human_selected ***REMOVED***= 'custom') {
        tags.push({ tag: `scene:${scene}:ai_weak`, source: 'sft_feedback', confidence: 2 });
    } else {
        // 模型被采纳，说明这个场景 AI 表现好
        tags.push({ tag: `scene:${scene}:ai_strong`, source: 'sft_feedback', confidence: 1 });
    }

    return tags;
}

// ***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED*** Database Operations ***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED***

function getDb() {
    return new Database(DB_PATH);
}

/**
 * upsert 一个标签，置信度取 max
 */
function upsertTag(db, clientId, tag, source, confidence) {
    const existing = db.prepare(
        'SELECT confidence FROM client_tags WHERE client_id = ? AND tag = ?'
    ).get(clientId, tag);

    if (existing) {
        if (confidence > existing.confidence) {
            db.prepare(
                'UPDATE client_tags SET confidence = ?, source = ? WHERE client_id = ? AND tag = ?'
            ).run(confidence, source, clientId, tag);
        }
    } else {
        db.prepare(
            'INSERT INTO client_tags (client_id, tag, source, confidence) VALUES (?, ?, ?, ?)'
        ).run(clientId, tag, source, confidence);
    }
}

/**
 * 获取或创建 profile 记录
 */
function getOrCreateProfile(db, clientId) {
    let profile = db.prepare('SELECT * FROM client_profiles WHERE client_id = ?').get(clientId);
    if (!profile) {
        db.prepare(
            'INSERT INTO client_profiles (client_id) VALUES (?)'
        ).run(clientId);
        profile = db.prepare('SELECT * FROM client_profiles WHERE client_id = ?').get(clientId);
    }
    return profile;
}

/**
 * 更新 profile 的 summary（异步，通过 agent）
 */

// 防止同一 client 频繁刷新的 debounce 标记
const _pendingRefresh = new Map();

/**
 * 带 debounce 的 summary 刷新
 * 同一 client 5 秒内不重复触发
 */
function scheduleProfileRefresh(clientId) {
    if (_pendingRefresh.has(clientId)) return;
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
    const db = getDb();

    const creator = db.prepare(`
        SELECT c.primary_name as name, c.wa_owner, c.keeper_username,
               wc.beta_status as conversion_stage,
               k.keeper_gmv, k.keeper_videos
        FROM creators c
        LEFT JOIN wa_crm_data wc ON wc.creator_id = c.id
        LEFT JOIN keeper_link k ON k.creator_id = c.id
        WHERE c.wa_phone = ?
    `).get(clientId);

    if (!creator) return;

    const tags = db.prepare(
        'SELECT * FROM client_tags WHERE client_id = ? ORDER BY confidence DESC LIMIT 20'
    ).all(clientId);

    const recentMemory = db.prepare(
        'SELECT * FROM client_memory WHERE client_id = ? ORDER BY created_at DESC LIMIT 10'
    ).all(clientId);

    try {
        const summary = await generateSummary(creator, tags, recentMemory);
        if (summary) {
            db.prepare(
                'UPDATE client_profiles SET summary = ?, last_updated = CURRENT_TIMESTAMP WHERE client_id = ?'
            ).run(summary, clientId);
        }
    } catch (err) {
        console.error('Summary generation failed:', err.message);
    }

    db.close();
    return clientId;
}

// ***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED*** Event Handlers ***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED***

async function handleWAMessage(db, clientId, data) {
    const { text, role, timestamp } = data;
    const tags = extractTagsFromMessage(text, role);

    for (const t of tags) {
        upsertTag(db, clientId, t.tag, t.source, t.confidence);
    }

    // 更新 profile 的 last_interaction
    db.prepare(
        'UPDATE client_profiles SET last_interaction = CURRENT_TIMESTAMP, last_updated = CURRENT_TIMESTAMP WHERE client_id = ?'
    ).run(clientId);

    console.log(`[wa_message] ${clientId}: extracted ${tags.length} tags`);
    return tags;
}

async function handleSftRecord(db, clientId, data) {
    const { sft_record_id } = data;
    const sft = db.prepare('SELECT * FROM sft_memory WHERE id = ?').get(sft_record_id);
    if (!sft) return [];

    const tags = learnFromSftRecord(sft);
    for (const t of tags) {
        upsertTag(db, clientId, t.tag, t.source, t.confidence);
    }

    console.log(`[sft_record] ${clientId}: learned ${tags.length} tags`);
    return tags;
}

async function handleKeeperUpdate(db, clientId, data) {
    const tags = extractTagsFromKeeper(data);

    for (const t of tags) {
        upsertTag(db, clientId, t.tag, t.source, t.confidence);
    }

    // 同时更新 profile 的 tiktok_data
    if (Object.keys(data).length > 0) {
        db.prepare(
            'UPDATE client_profiles SET tiktok_data = ?, last_updated = CURRENT_TIMESTAMP WHERE client_id = ?'
        ).run(JSON.stringify(data), clientId);
    }

    console.log(`[keeper_update] ${clientId}: extracted ${tags.length} tags`);
    return tags;
}

async function handleManualTag(db, clientId, data) {
    const { tag, value, confidence = 3 } = data;
    if (!tag) return [];

    upsertTag(db, clientId, `${tag}:${value || 'true'}`, 'manual', confidence);

    console.log(`[manual_tag] ${clientId}: added tag "${tag}:${value || 'true'}"`);
    return [{ tag: `${tag}:${value || 'true'}`, source: 'manual', confidence }];
}

// ***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED*** Main ***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED***

async function processEvent(eventType, clientId, eventData) {
    const db = getDb();

    // 确保 client 存在
    const creator = db.prepare('SELECT id FROM creators WHERE wa_phone = ?').get(clientId);
    if (!creator) {
        db.close();
        return { ok: false, error: 'client not found' };
    }

    // 确保 profile 存在
    getOrCreateProfile(db, clientId);

    let tags = [];
    switch (eventType) {
        case 'wa_message':
            tags = await handleWAMessage(db, clientId, eventData);
            break;
        case 'sft_record':
            tags = await handleSftRecord(db, clientId, eventData);
            break;
        case 'keeper_update':
            tags = await handleKeeperUpdate(db, clientId, eventData);
            break;
        case 'manual_tag':
            tags = await handleManualTag(db, clientId, eventData);
            break;
        default:
            db.close();
            return { ok: false, error: `unknown event type: ${eventType}` };
    }

    // 异步刷新 summary（带 debounce）
    scheduleProfileRefresh(clientId);

    db.close();
    return { ok: true, client_id: clientId, tags_added: tags.length };
}

// CLI 模式
if (require.main ***REMOVED***= module) {
    const args = process.argv.slice(2);
    let eventType, clientId, data = {};

    for (let i = 0; i < args.length; i++) {
        if (args[i] ***REMOVED***= '--event' && args[i + 1]) eventType = args[++i];
        if (args[i] ***REMOVED***= '--client_id' && args[i + 1]) clientId = args[++i];
        if (args[i] ***REMOVED***= '--data' && args[i + 1]) data = JSON.parse(args[++i]);
    }

    if (!eventType || !clientId) {
        console.error('Usage: node profile-agent.js --event <type> --client_id <phone> [--data \'{}\']');
        process.exit(1);
    }

    processEvent(eventType, clientId, data)
        .then(r => { console.log(JSON.stringify(r)); process.exit(0); })
        .catch(e => { console.error(e.message); process.exit(1); });
}

module.exports = { processEvent, extractTagsFromMessage, extractTagsFromKeeper, learnFromSftRecord };
