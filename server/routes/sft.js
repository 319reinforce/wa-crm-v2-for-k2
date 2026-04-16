/**
 * SFT routes
 * GET /api/sft-memory, POST /api/sft-memory, GET /api/sft-memory/pending,
 * PATCH /api/sft-memory/:id/review, GET /api/sft-memory/stats,
 * GET /api/sft-memory/trends, POST /api/sft-feedback, GET /api/sft-feedback/stats,
 * GET /api/sft-export
 */
const express = require('express');
const router = express.Router();
const db = require('../../db');
const { writeAudit } = require('../middleware/audit');
const { getLockedOwner, matchesOwnerScope, resolveScopedOwner, sendOwnerScopeForbidden } = require('../middleware/appAuth');
const {
    createSftFeedback,
    createSftMemory,
    getSftFeedbackStats,
    getSftMemoryStats,
    getSftMemoryTrends,
    listPendingSftMemory,
    listSftMemory,
    parseJsonSafe,
    reviewSftMemory,
} = require('../services/sftService');

function resolveRequestedOwner(req, res, owner, fallback = null) {
    const lockedOwner = getLockedOwner(req);
    const requestedOwner = typeof owner === 'string' ? owner.trim() : owner;
    if (lockedOwner && requestedOwner && !matchesOwnerScope(req, requestedOwner)) {
        sendOwnerScopeForbidden(res, lockedOwner);
        return null;
    }
    return resolveScopedOwner(req, requestedOwner, fallback);
}

async function resolveClientOwner(db2, clientId) {
    const normalizedClientId = String(clientId || '').trim();
    if (!normalizedClientId) return null;
    return db2.prepare(`
        SELECT wa_owner
        FROM creators
        WHERE wa_phone = ?
        LIMIT 1
    `).get(normalizedClientId);
}

async function ensureClientScope(req, res, clientId, { required = false } = {}) {
    const db2 = db.getDb();
    const lockedOwner = getLockedOwner(req);
    const normalizedClientId = String(clientId || '').trim();

    if (!normalizedClientId) {
        if (lockedOwner || required) {
            res.status(400).json({ ok: false, error: 'client_id required' });
            return null;
        }
        return null;
    }

    const ownerRow = await resolveClientOwner(db2, normalizedClientId);
    if (!ownerRow?.wa_owner) {
        if (lockedOwner) {
            res.status(404).json({ ok: false, error: 'Creator not found for client_id' });
            return null;
        }
        return null;
    }
    if (lockedOwner && !matchesOwnerScope(req, ownerRow.wa_owner)) {
        sendOwnerScopeForbidden(res, lockedOwner);
        return null;
    }
    return ownerRow.wa_owner;
}

async function ensureSftRecordAccess(req, res, recordId) {
    const row = await db.getDb().prepare(`
        SELECT
            sm.id,
            JSON_UNQUOTE(JSON_EXTRACT(sm.context_json, '$.client_id')) AS client_id,
            c.wa_owner
        FROM sft_memory sm
        LEFT JOIN creators c
          ON c.wa_phone = JSON_UNQUOTE(JSON_EXTRACT(sm.context_json, '$.client_id'))
        WHERE sm.id = ?
        LIMIT 1
    `).get(recordId);
    if (!row) {
        res.status(404).json({ ok: false, error: 'Record not found' });
        return null;
    }
    const lockedOwner = getLockedOwner(req);
    if (lockedOwner && !matchesOwnerScope(req, row.wa_owner)) {
        sendOwnerScopeForbidden(res, lockedOwner);
        return null;
    }
    return row;
}

// POST /api/sft-memory
router.post('/sft-memory', async (req, res) => {
    try {
        const client_id = String(req.body?.context?.client_id || '').trim();
        const scopedOwner = await ensureClientScope(req, res, client_id, { required: !!getLockedOwner(req) });
        if (getLockedOwner(req) && !scopedOwner) return;
        const result = await createSftMemory({
            ...req.body,
            owner: scopedOwner || null,
        });
        if (!result.updated) {
            await writeAudit('sft_create', 'sft_memory', result.id, null, {
                human_selected: req.body?.human_selected || null,
                human_output: req.body?.human_output || null,
                status: result.status || null,
                reviewed_by: req.body?.reviewed_by || 'system',
            }, req);
        }
        res.json({ ok: true, id: result.id, updated: !!result.updated });
    } catch (err) {
        console.error('POST /api/sft-memory error:', err);
        res.status(err.status || 500).json({ error: err.message });
    }
});

// GET /api/sft-memory
router.get('/sft-memory', async (req, res) => {
    try {
        const effectiveOwner = resolveRequestedOwner(req, res, req.query.owner, null);
        if (effectiveOwner === null && getLockedOwner(req) && req.query.owner) return;
        const limit = Math.min(Math.max(parseInt(req.query.limit) || 50, 1), 1000);
        const offset = Math.max(parseInt(req.query.offset) || 0, 0);
        const rows = await listSftMemory({ limit, offset, owner: effectiveOwner || null });
        res.json(rows);
    } catch (err) {
        console.error('GET /api/sft-memory error:', err);
        res.status(500).json({ error: err.message });
    }
});

// GET /api/sft-memory/pending
router.get('/sft-memory/pending', async (req, res) => {
    try {
        const effectiveOwner = resolveRequestedOwner(req, res, req.query.owner, null);
        if (effectiveOwner === null && getLockedOwner(req) && req.query.owner) return;
        const rows = await listPendingSftMemory({ owner: effectiveOwner || null, limit: 100 });
        res.json(rows);
    } catch (err) {
        console.error('GET /api/sft-memory/pending error:', err);
        res.status(500).json({ error: err.message });
    }
});

// PATCH /api/sft-memory/:id/review
router.patch('/sft-memory/:id/review', async (req, res) => {
    try {
        const { action, comment } = req.body;
        if (!action || !['approve', 'reject'].includes(action)) {
            return res.status(400).json({ error: 'action must be approve or reject' });
        }
        const existing = await ensureSftRecordAccess(req, res, parseInt(req.params.id, 10));
        if (!existing) return;
        const result = await reviewSftMemory(parseInt(req.params.id, 10), action, comment || null);
        await writeAudit('sft_review', 'sft_memory', parseInt(req.params.id), { status: existing.status }, { status: result.status, comment: comment || null, reviewed_by: 'human_review' }, req);
        res.json(result);
    } catch (err) {
        console.error('PATCH /api/sft-memory/:id/review error:', err);
        res.status(err.status || 500).json({ error: err.message });
    }
});

// GET /api/sft-memory/stats
router.get('/sft-memory/stats', async (req, res) => {
    try {
        const effectiveOwner = resolveRequestedOwner(req, res, req.query.owner, null);
        if (effectiveOwner === null && getLockedOwner(req) && req.query.owner) return;
        const stats = await getSftMemoryStats(effectiveOwner || null);
        res.json(stats);
    } catch (err) {
        console.error('GET /api/sft-memory/stats error:', err);
        res.status(500).json({ error: err.message });
    }
});

// GET /api/sft-training-status — 训练就绪状态检查
router.get('/sft-training-status', async (req, res) => {
    try {
        const db2 = db.getDb();
        const effectiveOwner = resolveRequestedOwner(req, res, req.query.owner, null);
        if (effectiveOwner === null && getLockedOwner(req) && req.query.owner) return;

        const THRESHOLDS = {
            approved: 200,
            custom: 20,
            scenes: 3,
        };

        const [approvedRow, customRow, sceneRows] = await Promise.all([
            db2.prepare(`
                SELECT COUNT(*) as count
                FROM sft_memory sm
                LEFT JOIN creators c
                  ON c.wa_phone = JSON_UNQUOTE(JSON_EXTRACT(sm.context_json, '$.client_id'))
                WHERE sm.status = 'approved'
                ${effectiveOwner ? 'AND c.wa_owner = ?' : ''}
            `).get(...(effectiveOwner ? [effectiveOwner] : [])),
            db2.prepare(`
                SELECT COUNT(*) as count
                FROM sft_memory sm
                LEFT JOIN creators c
                  ON c.wa_phone = JSON_UNQUOTE(JSON_EXTRACT(sm.context_json, '$.client_id'))
                WHERE sm.status = 'approved' AND sm.human_selected = 'custom'
                ${effectiveOwner ? 'AND c.wa_owner = ?' : ''}
            `).get(...(effectiveOwner ? [effectiveOwner] : [])),
            db2.prepare(`
                SELECT COUNT(DISTINCT sm.scene) as count
                FROM sft_memory sm
                LEFT JOIN creators c
                  ON c.wa_phone = JSON_UNQUOTE(JSON_EXTRACT(sm.context_json, '$.client_id'))
                WHERE sm.status = 'approved' AND sm.scene IS NOT NULL
                ${effectiveOwner ? 'AND c.wa_owner = ?' : ''}
            `).get(...(effectiveOwner ? [effectiveOwner] : [])),
        ]);

        const approved = approvedRow?.count || 0;
        const custom = customRow?.count || 0;
        const sceneCount = sceneRows?.count || 0;

        const approvedReady = approved >= THRESHOLDS.approved;
        const customReady = custom >= THRESHOLDS.custom;
        const scenesReady = sceneCount >= THRESHOLDS.scenes;
        const trainingReady = approvedReady && customReady && scenesReady;

        const blockers = [];
        if (!approvedReady) blockers.push(`approved 数据 ${approved}/${THRESHOLDS.approved}`);
        if (!customReady) blockers.push(`custom 数据 ${custom}/${THRESHOLDS.custom}`);
        if (!scenesReady) blockers.push(`场景覆盖 ${sceneCount}/${THRESHOLDS.scenes}`);

        let nextAction = '继续积累数据';
        if (trainingReady) {
            nextAction = '数据已就绪，可以开始训练！请运行 Modal + Axolotl 训练脚本';
        } else if (approvedReady && !customReady) {
            nextAction = '鼓励运营使用 custom 回复（高质量训练数据）';
        } else if (approvedReady) {
            nextAction = '数据接近门槛，继续推进运营使用';
        }

        res.json({
            owner: effectiveOwner || null,
            ready: trainingReady,
            approved,
            approved_threshold: THRESHOLDS.approved,
            custom,
            custom_threshold: THRESHOLDS.custom,
            scene_count: sceneCount,
            scene_threshold: THRESHOLDS.scenes,
            blockers,
            next_action: nextAction,
            export_url: `/api/sft-export?status=approved&limit=${THRESHOLDS.approved}&lang=en&format=jsonl${effectiveOwner ? `&owner=${encodeURIComponent(effectiveOwner)}` : ''}`,
        });
    } catch (err) {
        console.error('GET /api/sft-training-status error:', err);
        res.status(500).json({ error: err.message });
    }
});

// GET /api/sft-memory/trends
router.get('/sft-memory/trends', async (req, res) => {
    try {
        const effectiveOwner = resolveRequestedOwner(req, res, req.query.owner, null);
        if (effectiveOwner === null && getLockedOwner(req) && req.query.owner) return;
        const trends = await getSftMemoryTrends(effectiveOwner || null, 30);
        res.json(trends);
    } catch (err) {
        console.error('GET /api/sft-memory/trends error:', err);
        res.status(500).json({ error: err.message });
    }
});

// POST /api/sft-feedback
router.post('/sft-feedback', async (req, res) => {
    try {
        const { client_id, feedback_type, input_text, opt1, opt2, final_output, scene, detail, reject_reason } = req.body;
        if (!feedback_type || !['skip', 'reject', 'edit'].includes(feedback_type)) {
            return res.status(400).json({ error: 'feedback_type must be skip, reject, or edit' });
        }
        const scopedOwner = await ensureClientScope(req, res, client_id, { required: !!getLockedOwner(req) });
        if (getLockedOwner(req) && !scopedOwner) return;
        const result = await createSftFeedback({ client_id, feedback_type, input_text, opt1, opt2, final_output, scene, detail, reject_reason });
        res.json(result);
    } catch (err) {
        console.error('POST /api/sft-feedback error:', err);
        res.status(err.status || 500).json({ error: err.message });
    }
});

// GET /api/sft-feedback/stats
router.get('/sft-feedback/stats', async (req, res) => {
    try {
        const effectiveOwner = resolveRequestedOwner(req, res, req.query.owner, null);
        if (effectiveOwner === null && getLockedOwner(req) && req.query.owner) return;
        const stats = await getSftFeedbackStats(effectiveOwner || null);
        res.json(stats);
    } catch (err) {
        console.error('GET /api/sft-feedback/stats error:', err);
        res.status(500).json({ error: err.message });
    }
});

// GET /api/sft-export
router.get('/sft-export', async (req, res) => {
    try {
        const { buildFullSystemPrompt } = require('../../systemPromptBuilder.cjs');

        const db2 = db.getDb();
        const effectiveOwner = resolveRequestedOwner(req, res, req.query.owner, null);
        if (effectiveOwner === null && getLockedOwner(req) && req.query.owner) return;
        const { format = 'json', status = 'approved', lang = 'all', month, include_retrieval = 'false' } = req.query;
        const limit = Math.min(Math.max(parseInt(req.query.limit) || 1000, 1), 5000);
        const withRetrieval = include_retrieval === 'true';

        let sql = `
            SELECT sm.*, c.wa_owner AS owner
            FROM sft_memory sm
            LEFT JOIN creators c
              ON c.wa_phone = JSON_UNQUOTE(JSON_EXTRACT(sm.context_json, '$.client_id'))
            WHERE sm.status = ?
        `;
        const params = [status];
        if (effectiveOwner) {
            sql += ` AND c.wa_owner = ?`;
            params.push(effectiveOwner);
        }
        if (month && /^\d{4}-\d{2}$/.test(month)) {
            sql += ` AND DATE_FORMAT(sm.created_at, '%Y-%m') = ?`;
            params.push(month);
        }
        sql += ` ORDER BY sm.created_at DESC LIMIT ? OFFSET ?`;
        params.push(limit, 0);

        const rows = await db2.prepare(sql).all(...params);
        const retrievalMap = new Map();

        if (withRetrieval) {
            const retrievalIds = [];
            for (const row of rows) {
                try {
                    const parsed = row.context_json ? JSON.parse(row.context_json) : {};
                    const retrievalId = row.retrieval_snapshot_id || parsed?.retrieval_snapshot_id;
                    if (retrievalId) retrievalIds.push(Number(retrievalId));
                } catch (_) {}
            }
            const uniqueIds = Array.from(new Set(retrievalIds.filter((id) => Number.isInteger(id) && id > 0)));
            if (uniqueIds.length > 0) {
                const placeholders = uniqueIds.map(() => '?').join(',');
                const retrievedRows = await db2.prepare(`
                    SELECT id, snapshot_hash, grounding_json, scene, operator, system_prompt_version, created_at
                    FROM retrieval_snapshot
                    WHERE id IN (${placeholders})
                `).all(...uniqueIds);
                for (const item of retrievedRows) {
                    retrievalMap.set(item.id, {
                        id: item.id,
                        snapshot_hash: item.snapshot_hash,
                        grounding_json: parseJsonSafe(item.grounding_json),
                        scene: item.scene,
                        operator: item.operator,
                        system_prompt_version: item.system_prompt_version,
                        created_at: item.created_at,
                    });
                }
            }
        }

        const isEnglish = (text) => /^[a-zA-Z\s.,!?]+$/.test((text || '').slice(0, 100));

        function buildConversationMessages(history, inputText) {
            const msgs = [];
            if (history && history.length > 0) {
                for (const m of history) {
                    msgs.push({ role: m.role === 'me' ? 'assistant' : 'user', content: m.text });
                }
            }
            // Only append inputText as a new user message if history doesn't already end with a user message.
            // This aligns with inference: '[请回复这位达人]' is only added when last msg is NOT from user.
            const lastMsg = msgs.length > 0 ? msgs[msgs.length - 1] : null;
            const alreadyHasUserMessage = lastMsg && lastMsg.role === 'user';
            if (!alreadyHasUserMessage) {
                msgs.push({ role: 'user', content: inputText || '' });
            }
            return msgs;
        }

        const exportRecord = async (r) => {
            let ctx = {};
            let history = [];
            try { if (r.context_json) ctx = JSON.parse(r.context_json); } catch (_) {}
            try { if (r.message_history) history = JSON.parse(r.message_history); } catch (_) {}
            const inputText = ctx.input_text || '';

            if (lang === 'en' && !isEnglish(inputText) && !isEnglish(r.human_output || '')) {
                return null;
            }

            // 优先使用推理时捕获的 system_prompt_used，避免重新构建导致漂移
            let systemPrompt;
            let promptVersion;
            if (r.system_prompt_used) {
                systemPrompt = r.system_prompt_used;
                promptVersion = r.system_prompt_version || 'v2';
            } else {
                // system_prompt_used 为 null 时用 buildFullSystemPrompt 重建
                // 注意：topicContext/richContext/conversationSummary 未存入 context_json，
                // 重建时传空占位；未来可扩展 context_json 字段实现完整重建
                const built = await buildFullSystemPrompt(
                    ctx.client_id,
                    r.scene || ctx.scene || 'unknown',
                    history,
                    { topicContext: '', richContext: '', conversationSummary: '', systemPromptVersion: 'v2' }
                );
                systemPrompt = built.prompt;
                promptVersion = built.version || 'v2';
            }
            const conversationMsgs = buildConversationMessages(history, inputText);

            return {
                messages: [
                    { role: 'system', content: systemPrompt },
                    ...conversationMsgs,
                    { role: 'assistant', content: r.human_output || '' }
                ],
                metadata: {
                    human_selected: r.human_selected,
                    scene: r.scene || ctx.scene || 'unknown',
                    similarity: r.similarity,
                    model_opt1: r.model_opt1,
                    model_opt2: r.model_opt2,
                    is_custom_input: r.is_custom_input,
                    reviewed_by: r.reviewed_by,
                    created_at: r.created_at,
                    system_prompt_version: promptVersion || 'v2',
                    chosen_output: r.chosen_output,
                    rejected_output: r.rejected_output,
                    retrieval_snapshot_id: r.retrieval_snapshot_id || ctx.retrieval_snapshot_id || null,
                    generation_log_id: r.generation_log_id || ctx.generation_log_id || null,
                    provider: r.provider || ctx.provider || null,
                    model: r.model || ctx.model || null,
                    scene_source: r.scene_source || ctx.scene_source || null,
                    pipeline_version: r.pipeline_version || ctx.pipeline_version || null,
                    retrieval_snapshot: withRetrieval && (r.retrieval_snapshot_id || ctx.retrieval_snapshot_id)
                        ? retrievalMap.get(Number(r.retrieval_snapshot_id || ctx.retrieval_snapshot_id)) || null
                        : undefined,
                }
            };
        };

        if (format === 'jsonl') {
            res.setHeader('Content-Type', 'application/x-ndjson');
            const exported = (await Promise.all(rows.map(r => exportRecord(r)))).filter(Boolean);
            res.end(exported.map(r => JSON.stringify(r)).join('\n'));
        } else {
            res.setHeader('Content-Type', 'application/json');
            res.json((await Promise.all(rows.map(r => exportRecord(r)))).filter(Boolean));
        }
    } catch (err) {
        console.error('GET /api/sft-export error:', err);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
