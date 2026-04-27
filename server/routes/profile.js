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
const { evaluateCreatorLifecycle } = require('../services/lifecyclePersistenceService');
const { extractTagsHeuristically } = require('../services/profileFallbackService');
const { ensureClientScope } = require('../utils/ownerScope');

function parseJsonSafe(value, fallback = null) {
    if (!value) return fallback;
    if (typeof value === 'object') return value;
    try {
        return JSON.parse(value);
    } catch (_) {
        return fallback;
    }
}

function clampConfidence(value, fallback = 2) {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(1, Math.min(3, Math.round(n)));
}

function normalizeEnum(value, allowed = []) {
    const normalized = String(value || '').trim().toLowerCase();
    return allowed.includes(normalized) ? normalized : null;
}

function normalizePortraitField(rawField, allowed = []) {
    if (rawField === null || rawField === undefined) {
        return { value: null, confidence: 2, evidence: '' };
    }

    const rawObj = (typeof rawField === 'object' && rawField !== null)
        ? rawField
        : { value: rawField };
    return {
        value: normalizeEnum(rawObj.value, allowed),
        confidence: clampConfidence(rawObj.confidence, 2),
        evidence: String(rawObj.evidence || '').slice(0, 250),
    };
}

function normalizePortraitPayload(payload) {
    if (!payload || typeof payload !== 'object') return null;
    return {
        frequency: normalizePortraitField(payload.frequency, ['high', 'medium', 'low']),
        difficulty: normalizePortraitField(payload.difficulty, ['high', 'medium', 'low']),
        intent: normalizePortraitField(payload.intent, ['strong', 'medium', 'weak']),
        emotion: normalizePortraitField(payload.emotion, ['positive', 'neutral', 'negative']),
    };
}

function mapSnapshotRowToPortrait(row) {
    if (!row) return null;
    return {
        frequency: {
            value: normalizeEnum(row.frequency_level, ['high', 'medium', 'low']),
            confidence: clampConfidence(row.frequency_conf, 2),
            evidence: String(row.frequency_evidence || '').slice(0, 250),
        },
        difficulty: {
            value: normalizeEnum(row.difficulty_level, ['high', 'medium', 'low']),
            confidence: clampConfidence(row.difficulty_conf, 2),
            evidence: String(row.difficulty_evidence || '').slice(0, 250),
        },
        intent: {
            value: normalizeEnum(row.intent_level, ['strong', 'medium', 'weak']),
            confidence: clampConfidence(row.intent_conf, 2),
            evidence: String(row.intent_evidence || '').slice(0, 250),
        },
        emotion: {
            value: normalizeEnum(row.emotion_level, ['positive', 'neutral', 'negative']),
            confidence: clampConfidence(row.emotion_conf, 2),
            evidence: String(row.emotion_evidence || '').slice(0, 250),
        },
    };
}

function hasPortraitValue(portrait) {
    if (!portrait || typeof portrait !== 'object') return false;
    return ['frequency', 'difficulty', 'intent', 'emotion'].some((field) => {
        return !!portrait?.[field]?.value;
    });
}

async function getLatestSnapshotPortrait(db2, clientId) {
    try {
        const row = await db2.prepare(`
            SELECT frequency_level, frequency_conf, frequency_evidence,
                   difficulty_level, difficulty_conf, difficulty_evidence,
                   intent_level, intent_conf, intent_evidence,
                   emotion_level, emotion_conf, emotion_evidence
            FROM client_profile_snapshots
            WHERE client_id = ?
            ORDER BY id DESC
            LIMIT 1
        `).get(clientId);
        return mapSnapshotRowToPortrait(row);
    } catch (_) {
        return null;
    }
}

async function ensureProfileClientScope(req, res, db2, clientId) {
    return await ensureClientScope(req, res, db2, clientId, {
        required: true,
        fieldName: 'client_id',
        notFoundMessage: 'client not found',
    });
}

// GET /api/client-memory/:clientId
router.get('/client-memory/:clientId', async (req, res) => {
    try {
        const { clientId } = req.params;
        if (!clientId || typeof clientId !== 'string' || clientId.length > 50) {
            return res.status(400).json({ error: 'invalid clientId' });
        }
        const db2 = db.getDb();
        const clientScope = await ensureProfileClientScope(req, res, db2, clientId);
        if (!clientScope.ok) return;
        const rows = await db2.prepare(`
            SELECT * FROM client_memory
            WHERE client_id = ?
            ORDER BY memory_type, confidence DESC
        `).all(clientScope.clientId);
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
        const clientScope = await ensureProfileClientScope(req, res, db2, client_id);
        if (!clientScope.ok) return;
        await db2.prepare(`
            INSERT INTO client_memory
            (creator_id, client_id, memory_type, memory_key, memory_value, confidence, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, NOW())
            ON DUPLICATE KEY UPDATE creator_id = COALESCE(creator_id, VALUES(creator_id)), memory_value = VALUES(memory_value), confidence = VALUES(confidence), updated_at = NOW()
        `).run(clientScope.row?.id || null, clientScope.clientId, memory_type, memory_key, memory_value, confidence);

        await writeAudit('client_memory_update', 'client_memory', null, null, {
            client_id: clientScope.clientId, memory_type, memory_key, memory_value, confidence
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
        const clientScope = await ensureProfileClientScope(req, res, db2, clientId);
        if (!clientScope.ok) return;

        const profile = await db2.prepare('SELECT * FROM client_profiles WHERE client_id = ?').get(clientScope.clientId);
        const tags = await db2.prepare(
            'SELECT * FROM client_tags WHERE client_id = ? ORDER BY confidence DESC'
        ).all(clientScope.clientId);
        const memory = await db2.prepare(
            'SELECT * FROM client_memory WHERE client_id = ? ORDER BY created_at DESC LIMIT 20'
        ).all(clientScope.clientId);

        const profileData = profile || { summary: null, tiktok_data: null, stage: null, last_interaction: null, last_updated: null };
        const tiktokData = parseJsonSafe(profileData.tiktok_data, {}) || {};
        const manualPortrait = normalizePortraitPayload(tiktokData.portrait_manual || tiktokData.portrait || null);
        const snapshotPortrait = await getLatestSnapshotPortrait(db2, clientScope.clientId);
        const portrait = hasPortraitValue(manualPortrait)
            ? manualPortrait
            : (hasPortraitValue(snapshotPortrait) ? snapshotPortrait : null);
        const portraitSource = hasPortraitValue(manualPortrait)
            ? 'manual'
            : (hasPortraitValue(snapshotPortrait) ? 'system' : null);

        const creator = await db2.prepare(`
            SELECT c.id, c.primary_name as name, c.wa_owner, c.keeper_username,
                   wc.beta_status, wc.priority,
                   k.keeper_gmv, k.keeper_videos, k.keeper_orders
            FROM creators c
            LEFT JOIN wa_crm_data wc ON wc.creator_id = c.id
            LEFT JOIN keeper_link k ON k.creator_id = c.id
            WHERE c.wa_phone = ?
        `).get(clientScope.clientId);
        const lifecycleEval = creator?.id
            ? await evaluateCreatorLifecycle(db2, creator.id).catch(() => null)
            : null;
        const lifecycleStage = lifecycleEval?.lifecycle?.stage_key || null;
        const lifecycleLabel = lifecycleEval?.lifecycle?.stage_label || lifecycleStage || null;

        res.json({
            client_id: clientScope.clientId,
            name: creator?.name || null,
            wa_owner: creator?.wa_owner || null,
            keeper_username: creator?.keeper_username || null,
            conversion_stage: lifecycleStage || null,
            lifecycle_stage: lifecycleStage,
            lifecycle_label: lifecycleLabel,
            beta_status: creator?.beta_status || null,
            priority: creator?.priority || null,
            summary: profileData.summary || null,
            tags: tags.map(t => ({ tag: t.tag, source: t.source, confidence: t.confidence })),
            portrait,
            portrait_source: portraitSource,
            tiktok_data: tiktokData,
            stage: profileData.stage || lifecycleStage || creator?.beta_status || null,
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
        const { summary, portrait } = req.body || {};
        if (summary === undefined && portrait === undefined) {
            return res.status(400).json({ error: 'summary or portrait required' });
        }
        const clientScope = await ensureProfileClientScope(req, res, db2, clientId);
        if (!clientScope.ok) return;

        const existing = await db2.prepare(
            'SELECT client_id, summary, tiktok_data FROM client_profiles WHERE client_id = ? LIMIT 1'
        ).get(clientScope.clientId);
        const nextSummary = summary === undefined ? (existing?.summary || '') : String(summary || '');
        const tiktokData = parseJsonSafe(existing?.tiktok_data, {}) || {};

        let normalizedPortrait;
        if (portrait === undefined) {
            normalizedPortrait = normalizePortraitPayload(tiktokData.portrait_manual || null);
        } else if (portrait === null) {
            normalizedPortrait = null;
            delete tiktokData.portrait_manual;
            delete tiktokData.portrait_manual_updated_at;
        } else {
            normalizedPortrait = normalizePortraitPayload(portrait);
            tiktokData.portrait_manual = normalizedPortrait;
            tiktokData.portrait_manual_updated_at = new Date().toISOString();
        }

        const nextTiktokData = Object.keys(tiktokData).length > 0 ? JSON.stringify(tiktokData) : null;
        const updated = await db2.prepare(`
            UPDATE client_profiles
            SET creator_id = COALESCE(creator_id, ?), summary = ?, tiktok_data = ?, last_updated = CURRENT_TIMESTAMP
            WHERE client_id = ?
        `).run(clientScope.row?.id || null, nextSummary, nextTiktokData, clientScope.clientId);

        if (updated.changes === 0) {
            await db2.prepare(`
                INSERT INTO client_profiles (creator_id, client_id, summary, tiktok_data)
                VALUES (?, ?, ?, ?)
            `).run(clientScope.row?.id || null, clientScope.clientId, nextSummary, nextTiktokData);
        }

        await writeAudit('client_profile_update', 'client_profiles', clientId, null, {
            client_id: clientScope.clientId,
            summary: nextSummary,
            portrait_manual: normalizedPortrait,
        }, req);

        res.json({
            ok: true,
            portrait: normalizedPortrait,
            portrait_source: normalizedPortrait ? 'manual' : null,
        });
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
        const clientScope = await ensureProfileClientScope(req, res, db2, clientId);
        if (!clientScope.ok) return;

        if (action === 'delete') {
            await db2.prepare('DELETE FROM client_tags WHERE client_id = ? AND tag = ?').run(clientScope.clientId, tag);
        } else {
            const fullTag = tag.includes(':') ? tag : `${tag}:${value || 'true'}`;
            await db2.prepare(`
                INSERT INTO client_tags (creator_id, client_id, tag, source, confidence)
                VALUES (?, ?, ?, 'manual', ?)
                ON DUPLICATE KEY UPDATE creator_id = COALESCE(creator_id, VALUES(creator_id)), confidence = VALUES(confidence), tag = VALUES(tag)
            `).run(clientScope.row?.id || null, clientScope.clientId, fullTag, confidence);
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

        if (!memory_type || !memory_key || memory_value === undefined) {
            return res.status(400).json({ error: 'memory_type, memory_key and memory_value required' });
        }
        const clientScope = await ensureProfileClientScope(req, res, db2, clientId);
        if (!clientScope.ok) return;

        await db2.prepare(`
            INSERT INTO client_memory (client_id, memory_type, memory_key, memory_value)
            VALUES (?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE memory_value = VALUES(memory_value)
        `).run(clientScope.clientId, memory_type, memory_key, memory_value);

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
        const clientScope = await ensureProfileClientScope(req, res, db2, clientId);
        if (!clientScope.ok) return;

        await db2.prepare('DELETE FROM client_memory WHERE client_id = ? AND memory_type = ? AND memory_key = ?')
            .run(clientScope.clientId, memory_type, memory_key);

        res.json({ ok: true });
    } catch (err) {
        console.error('DELETE /api/client-profiles/memory error:', err);
        res.status(500).json({ error: err.message });
    }
});

// ================== MiniMax LLM 标签提取 ==================

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
                'Authorization': `Bearer ${API_KEY}`,
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
        const textItem = data.content?.find(item => item.type === 'text');
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
            .filter(t => t.tag && typeof t.tag === 'string')
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

// ================== 事件触发入口 ==================

// POST /api/profile-agent/event
router.post('/profile-agent/event', async (req, res) => {
    try {
        const { event_type, client_id, data: eventData } = req.body;
        if (!event_type || !client_id) {
            return res.status(400).json({ error: 'event_type and client_id required' });
        }

        const db2 = db.getDb();
        const clientScope = await ensureProfileClientScope(req, res, db2, client_id);
        if (!clientScope.ok) return;

        const profile = await db2.prepare('SELECT id FROM client_profiles WHERE client_id = ?').get(clientScope.clientId);
        if (!profile) {
            await db2.prepare('INSERT INTO client_profiles (creator_id, client_id) VALUES (?, ?)').run(clientScope.row?.id || null, clientScope.clientId);
        }

        let tags_added = [];

        if (event_type === 'wa_message') {
            const { text, role } = eventData || {};
            if (text) {
                // LLM 标签提取（主要方式）
                tags_added = await extractTagsWithLLM(text);
                if (tags_added.length === 0) {
                    tags_added = extractTagsHeuristically(text);
                }
            }
        }

        // Insert tags（重复时保留较高的 confidence）
        for (const { tag, source, confidence } of tags_added) {
            await db2.prepare(
                'INSERT INTO client_tags (creator_id, client_id, tag, source, confidence) ' +
                'VALUES (?, ?, ?, ?, ?) ' +
                'ON DUPLICATE KEY UPDATE ' +
                'creator_id = COALESCE(creator_id, VALUES(creator_id)), ' +
                'confidence = IF(VALUES(confidence) > confidence, VALUES(confidence), confidence)'
            ).run(clientScope.row?.id || null, clientScope.clientId, tag, source, confidence || 2);
        }

        // 写入审计日志
        if (tags_added.length > 0) {
            await writeAudit('profile_tags_extracted', 'client_tags', null, null, {
                client_id: clientScope.clientId, event_type, tags_added
            }, req);
        }

        // Trigger async profile refresh
        const { scheduleProfileRefresh } = require('../services/profileService');
        scheduleProfileRefresh(clientScope.clientId);

        res.json({ ok: true, tags_added });
    } catch (err) {
        console.error('POST /api/profile-agent/event error:', err);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
module.exports._private = {
    ensureProfileClientScope,
};
