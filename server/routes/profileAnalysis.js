const express = require('express');
const router = express.Router();
const db = require('../../db');
const {
    registerIncomingMessages,
    runProfileAnalysis,
    listPendingChanges,
    reviewChange,
    runFallbackAnalysisScan,
} = require('../services/profileAnalysisService');
const { ensureClientScope, hasPrivilegedRole } = require('../utils/ownerScope');
const { requireHumanAdmin } = require('../middleware/appAuth');

// 通过 change_event id 反查其 client,再复用 ensureClientScope 校验 operator 归属
async function ensureChangeEventScope(req, res, changeEventId) {
    const dbConn = db.getDb();
    const row = await dbConn.prepare(`
        SELECT client_id FROM client_profile_change_events WHERE id = ? LIMIT 1
    `).get(changeEventId);
    if (!row) {
        res.status(404).json({ error: 'change event not found' });
        return null;
    }
    const scoped = await ensureClientScope(req, res, dbConn, row.client_id);
    if (!scoped.ok) return null;
    return row.client_id;
}

// POST /api/profile-analysis/hook — 内部服务钩子,只允许 service token
router.post('/profile-analysis/hook', async (req, res) => {
    if (!(req.auth?.source === 'env' && req.auth?.role === 'service')
        && !hasPrivilegedRole(req)) {
        return res.status(403).json({ error: 'Forbidden: service or admin required' });
    }
    try {
        const { creator_id, client_id, inserted_count = 1, sample_text = '' } = req.body || {};
        const result = await registerIncomingMessages({
            creatorId: creator_id ? Number(creator_id) : null,
            clientId: client_id || null,
            insertedCount: Number(inserted_count) || 0,
            sampleText: sample_text || '',
        });
        res.json({ ok: true, ...result });
    } catch (err) {
        console.error('POST /api/profile-analysis/hook error:', err);
        res.status(500).json({ error: err.message });
    }
});

// POST /api/profile-analysis/trigger/:clientId — operator 只能触发自己 owner 下的 client
router.post('/profile-analysis/trigger/:clientId', async (req, res) => {
    try {
        const scoped = await ensureClientScope(req, res, db.getDb(), req.params.clientId);
        if (!scoped.ok) return;
        const result = await runProfileAnalysis({
            clientId: req.params.clientId,
            triggerType: 'manual',
            triggerText: req.body?.trigger_text || 'manual_trigger',
        });
        res.json(result);
    } catch (err) {
        console.error('POST /api/profile-analysis/trigger error:', err);
        res.status(500).json({ error: err.message });
    }
});

// GET /api/profile-changes/pending
router.get('/profile-changes/pending', async (req, res) => {
    try {
        const rows = await listPendingChanges({
            limit: req.query.limit || 50,
            clientId: req.query.client_id || null,
        });
        res.json({ ok: true, items: rows, count: rows.length });
    } catch (err) {
        console.error('GET /api/profile-changes/pending error:', err);
        res.status(500).json({ error: err.message });
    }
});

// POST /api/profile-changes/:id/review — operator 只能审核自己 owner 下 client 的 change
router.post('/profile-changes/:id/review', async (req, res) => {
    try {
        const { action, note = '', reviewed_by = 'operator', edited = null } = req.body || {};
        if (!['accept', 'reject', 'edit'].includes(String(action || '').toLowerCase())) {
            return res.status(400).json({ error: 'action must be accept|reject|edit' });
        }
        const clientId = await ensureChangeEventScope(req, res, Number(req.params.id));
        if (!clientId) return;
        const result = await reviewChange({
            changeEventId: Number(req.params.id),
            action: String(action).toLowerCase(),
            reviewedBy: reviewed_by,
            note,
            edited,
        });
        if (!result.ok) {
            return res.status(400).json(result);
        }
        res.json(result);
    } catch (err) {
        console.error('POST /api/profile-changes/:id/review error:', err);
        res.status(500).json({ error: err.message });
    }
});

// POST /api/profile-analysis/fallback-scan — 全局批处理,admin-only
router.post('/profile-analysis/fallback-scan', requireHumanAdmin, async (_req, res) => {
    try {
        const result = await runFallbackAnalysisScan();
        res.json({ ok: true, ...result });
    } catch (err) {
        console.error('POST /api/profile-analysis/fallback-scan error:', err);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
