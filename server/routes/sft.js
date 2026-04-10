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
const { sha256 } = require('../utils/crypto');
const { parseJsonSafe, validateHumanOutput } = require('../services/sftService');

// POST /api/sft-memory
router.post('/sft-memory', async (req, res) => {
    try {
        const {
            model_candidates,
            human_selected,
            human_output,
            diff_analysis,
            context,
            messages = [],
            reviewed_by = 'system'
        } = req.body;

        if (!human_selected || !human_output) {
            return res.status(400).json({ error: 'human_selected and human_output required' });
        }

        const validation = validateHumanOutput(human_output);
        if (!validation.valid) {
            return res.status(400).json({ error: validation.error });
        }

        const db2 = db.getDb();
        const context_json = context ? JSON.stringify(context) : null;
        const ctx = context || {};
        const client_id = ctx.client_id || '';
        const input_text = ctx.input_text || '';
        const scene = ctx.scene || 'unknown';
        const similarity = diff_analysis?.similarity ?? null;

        let status = 'approved';
        if (diff_analysis?.is_custom) {
            status = similarity >= 85 ? 'approved' : 'pending_review';
        } else if (similarity !***REMOVED*** null && similarity < 85) {
            status = 'pending_review';
        }

        const client_id_hash = sha256(client_id);
        const input_text_hash = sha256(input_text);
        const human_output_hash = sha256(human_output);
        const created_date = new Date().toISOString().split('T')[0];
        const message_history_json = messages.length > 0 ? JSON.stringify(messages.slice(-10)) : null;

        const opt1 = model_candidates?.opt1 || null;
        const opt2 = model_candidates?.opt2 || null;
        let chosen_output = null;
        let rejected_output = null;
        if (human_selected ***REMOVED***= 'opt1') {
            chosen_output = opt1; rejected_output = opt2;
        } else if (human_selected ***REMOVED***= 'opt2') {
            chosen_output = opt2; rejected_output = opt1;
        } else if (human_selected ***REMOVED***= 'custom') {
            chosen_output = human_output; rejected_output = opt1;
        }

        const existing = await db2.prepare(`
            SELECT id FROM sft_memory
            WHERE client_id_hash = ? AND input_text_hash = ? AND human_output_hash = ? AND created_date = ?
        `).get(client_id_hash, input_text_hash, human_output_hash, created_date);

        if (existing) {
            const newStatus = (status ***REMOVED***= 'approved') ? existing.status || status : status;
            await db2.prepare(`
                UPDATE sft_memory SET
                    human_output = ?,
                    status = CASE WHEN ? = 'approved' THEN ? ELSE ? END,
                    similarity = ?,
                    chosen_output = ?,
                    rejected_output = ?
                WHERE id = ?
            `).run(human_output, status, newStatus, status, similarity, chosen_output, rejected_output, existing.id);
            return res.json({ ok: true, id: existing.id, updated: true });
        }

        const result = await db2.prepare(`
            INSERT INTO sft_memory
            (model_opt1, model_opt2, human_selected, human_output,
             model_predicted, model_rejected, is_custom_input, human_reason,
             context_json, status, reviewed_by,
             similarity, scene, message_history,
             client_id_hash, input_text_hash, human_output_hash, created_date,
             chosen_output, rejected_output)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            model_candidates?.opt1 || null,
            model_candidates?.opt2 || null,
            human_selected,
            human_output,
            diff_analysis?.model_predicted || null,
            diff_analysis?.model_rejected || null,
            diff_analysis?.is_custom ? 1 : 0,
            diff_analysis?.human_reason || null,
            context_json,
            status,
            reviewed_by,
            similarity,
            scene,
            message_history_json,
            client_id_hash,
            input_text_hash,
            human_output_hash,
            created_date,
            chosen_output,
            rejected_output
        );

        await writeAudit('sft_create', 'sft_memory', result.lastInsertRowid, null, {
            human_selected, human_output, status, reviewed_by
        }, req);
        res.json({ ok: true, id: result.lastInsertRowid });
    } catch (err) {
        console.error('POST /api/sft-memory error:', err);
        res.status(500).json({ error: err.message });
    }
});

// GET /api/sft-memory
router.get('/sft-memory', async (req, res) => {
    try {
        const db2 = db.getDb();
        const limit = Math.min(Math.max(parseInt(req.query.limit) || 50, 1), 1000);
        const offset = Math.max(parseInt(req.query.offset) || 0, 0);
        const rows = await db2.prepare(`
            SELECT * FROM sft_memory
            ORDER BY created_at DESC
            LIMIT ${limit} OFFSET ${offset}
        `).all();
        res.json(rows.map(r => ({
            ...r,
            context: parseJsonSafe(r.context_json),
            message_history: parseJsonSafe(r.message_history),
        })));
    } catch (err) {
        console.error('GET /api/sft-memory error:', err);
        res.status(500).json({ error: err.message });
    }
});

// GET /api/sft-memory/pending
router.get('/sft-memory/pending', async (req, res) => {
    try {
        const db2 = db.getDb();
        const rows = await db2.prepare(`
            SELECT * FROM sft_memory
            WHERE status IN ('pending_review', 'needs_review')
            ORDER BY created_at DESC
            LIMIT 100
        `).all();
        res.json(rows.map(r => ({
            ...r,
            context: parseJsonSafe(r.context_json),
            message_history: parseJsonSafe(r.message_history),
        })));
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
        const db2 = db.getDb();
        const newStatus = action ***REMOVED***= 'approve' ? 'approved' : 'rejected';
        const result = await db2.prepare(`
            UPDATE sft_memory SET status = ?, reviewed_by = ?, human_reason = COALESCE(?, human_reason)
            WHERE id = ?
        `).run(newStatus, 'human_review', comment || null, parseInt(req.params.id));
        if (result.changes ***REMOVED***= 0) {
            return res.status(404).json({ error: 'Record not found' });
        }
        res.json({ ok: true, status: newStatus });
    } catch (err) {
        console.error('PATCH /api/sft-memory/:id/review error:', err);
        res.status(500).json({ error: err.message });
    }
});

// GET /api/sft-memory/stats
router.get('/sft-memory/stats', async (req, res) => {
    try {
        const db2 = db.getDb();
        const total = (await db2.prepare('SELECT COUNT(*) as count FROM sft_memory').get()).count;
        const opt1 = (await db2.prepare("SELECT COUNT(*) as count FROM sft_memory WHERE human_selected = 'opt1'").get()).count;
        const opt2 = (await db2.prepare("SELECT COUNT(*) as count FROM sft_memory WHERE human_selected = 'opt2'").get()).count;
        const custom = (await db2.prepare("SELECT COUNT(*) as count FROM sft_memory WHERE human_selected = 'custom'").get()).count;
        const pending = (await db2.prepare("SELECT COUNT(*) as count FROM sft_memory WHERE status IN ('pending_review','needs_review')").get()).count;
        const approved = (await db2.prepare("SELECT COUNT(*) as count FROM sft_memory WHERE status = 'approved'").get()).count;
        res.json({
            total,
            opt1_selected: opt1,
            opt2_selected: opt2,
            custom_input: custom,
            pending_review: pending,
            approved,
            model_override_rate: total > 0 ? ((custom / total) * 100).toFixed(1) + '%' : '0%'
        });
    } catch (err) {
        console.error('GET /api/sft-memory/stats error:', err);
        res.status(500).json({ error: err.message });
    }
});

// GET /api/sft-training-status — 训练就绪状态检查
router.get('/sft-training-status', async (req, res) => {
    try {
        const db2 = db.getDb();

        const THRESHOLDS = {
            approved: 200,
            custom: 20,
            scenes: 3,
        };

        const [approvedRow, customRow, sceneRows, enApprovedRow] = await Promise.all([
            db2.prepare("SELECT COUNT(*) as count FROM sft_memory WHERE status = 'approved'").get(),
            db2.prepare("SELECT COUNT(*) as count FROM sft_memory WHERE status = 'approved' AND human_selected = 'custom'").get(),
            db2.prepare("SELECT COUNT(DISTINCT scene) as count FROM sft_memory WHERE status = 'approved' AND scene IS NOT NULL").get(),
            db2.prepare("SELECT COUNT(*) as count FROM sft_memory WHERE status = 'approved' AND (SELECT input_text FROM sft_memory WHERE LENGTH(input_text) > 0 AND input_text IS NOT NULL LIMIT 1) IS NOT NULL").get(),
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
            ready: trainingReady,
            approved,
            approved_threshold: THRESHOLDS.approved,
            custom,
            custom_threshold: THRESHOLDS.custom,
            scene_count: sceneCount,
            scene_threshold: THRESHOLDS.scenes,
            blockers,
            next_action: nextAction,
            export_url: `/api/sft-export?status=approved&limit=${THRESHOLDS.approved}&lang=en&format=jsonl`,
        });
    } catch (err) {
        console.error('GET /api/sft-training-status error:', err);
        res.status(500).json({ error: err.message });
    }
});

// GET /api/sft-memory/trends
router.get('/sft-memory/trends', async (req, res) => {
    try {
        const db2 = db.getDb();
        const rows = await db2.prepare(`
            SELECT
                DATE(created_at) as date,
                COUNT(*) as total,
                SUM(CASE WHEN human_selected = 'opt1' THEN 1 ELSE 0 END) as opt1_cnt,
                SUM(CASE WHEN human_selected = 'opt2' THEN 1 ELSE 0 END) as opt2_cnt,
                SUM(CASE WHEN human_selected = 'custom' THEN 1 ELSE 0 END) as custom_cnt,
                SUM(CASE WHEN status = 'pending_review' THEN 1 ELSE 0 END) as pending_cnt
            FROM sft_memory
            WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
            GROUP BY DATE(created_at)
            ORDER BY date ASC
        `).all();

        const dates = rows.map(r => r.date);
        const volumes = rows.map(r => r.total);
        const opt1_rate = rows.map(r => r.total > 0 ? +(r.opt1_cnt / r.total * 100).toFixed(1) : 0);
        const opt2_rate = rows.map(r => r.total > 0 ? +(r.opt2_cnt / r.total * 100).toFixed(1) : 0);
        const custom_rate = rows.map(r => r.total > 0 ? +(r.custom_cnt / r.total * 100).toFixed(1) : 0);

        const skipRows = await db2.prepare(`
            SELECT DATE(created_at) as date, COUNT(*) as skip_cnt
            FROM sft_feedback
            WHERE feedback_type = 'skip' AND created_at >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
            GROUP BY DATE(created_at)
        `).all();
        const skipMap = {};
        skipRows.forEach(r => { skipMap[r.date] = r.skip_cnt; });
        const skip_rate = rows.map(r => {
            const skip = skipMap[r.date] || 0;
            return r.total > 0 ? +(skip / (r.total + skip) * 100).toFixed(1) : 0;
        });

        res.json({ dates, volumes, opt1_rate, opt2_rate, custom_rate, skip_rate });
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
        const db2 = db.getDb();
        const result = await db2.prepare(`
            INSERT INTO sft_feedback (client_id, feedback_type, input_text, opt1, opt2, final_output, scene, detail, reject_reason)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(client_id || null, feedback_type, input_text || null, opt1 || null, opt2 || null, final_output || null, scene || null, detail || null, reject_reason || null);
        res.json({ ok: true, id: result.lastInsertRowid });
    } catch (err) {
        console.error('POST /api/sft-feedback error:', err);
        res.status(500).json({ error: err.message });
    }
});

// GET /api/sft-feedback/stats
router.get('/sft-feedback/stats', async (req, res) => {
    try {
        const db2 = db.getDb();
        const total = (await db2.prepare('SELECT COUNT(*) as count FROM sft_feedback').get()).count;
        const byTypeRows = await db2.prepare('SELECT feedback_type, COUNT(*) as count FROM sft_feedback GROUP BY feedback_type').all();
        const byType = {};
        byTypeRows.forEach(r => { byType[r.feedback_type] = r.count; });
        const byScene = await db2.prepare(`
            SELECT scene, feedback_type, COUNT(*) as count
            FROM sft_feedback WHERE scene IS NOT NULL
            GROUP BY scene, feedback_type
        `).all();
        const sceneMap = {};
        byScene.forEach(r => {
            if (!sceneMap[r.scene]) sceneMap[r.scene] = { skip: 0, reject: 0, edit: 0 };
            sceneMap[r.scene][r.feedback_type] = r.count;
        });
        res.json({ total, by_type: byType, by_scene: sceneMap });
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
        const { format = 'json', status = 'approved', lang = 'all' } = req.query;
        const limit = Math.min(Math.max(parseInt(req.query.limit) || 1000, 1), 5000);

        const rows = await db2.prepare(`
            SELECT * FROM sft_memory
            WHERE status = ?
            ORDER BY created_at DESC
            LIMIT ${limit} OFFSET 0
        `).all(status);

        const isEnglish = (text) => /^[a-zA-Z\s.,!?]+$/.test((text || '').slice(0, 100));

        function buildConversationMessages(history, inputText) {
            const msgs = [];
            if (history && history.length > 0) {
                for (const m of history) {
                    msgs.push({ role: m.role ***REMOVED***= 'me' ? 'assistant' : 'user', content: m.text });
                }
            }
            msgs.push({ role: 'user', content: inputText || '' });
            return msgs;
        }

        const exportRecord = (r) => {
            let ctx = {};
            let history = [];
            try { if (r.context_json) ctx = JSON.parse(r.context_json); } catch (_) {}
            try { if (r.message_history) history = JSON.parse(r.message_history); } catch (_) {}
            const inputText = ctx.input_text || '';

            if (lang ***REMOVED***= 'en' && !isEnglish(inputText) && !isEnglish(r.human_output || '')) {
                return null;
            }

            const { prompt: systemPrompt, version: promptVersion } = buildFullSystemPrompt(
                ctx.client_id,
                r.scene || ctx.scene || 'unknown',
                history
            );
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
                }
            };
        };

        if (format ***REMOVED***= 'jsonl') {
            res.setHeader('Content-Type', 'application/x-ndjson');
            const exported = rows.map(r => exportRecord(r)).filter(Boolean);
            res.end(exported.map(r => JSON.stringify(r)).join('\n'));
        } else {
            res.setHeader('Content-Type', 'application/json');
            res.json(rows.map(r => exportRecord(r)).filter(Boolean));
        }
    } catch (err) {
        console.error('GET /api/sft-export error:', err);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
