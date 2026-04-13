const express = require('express');
const router = express.Router();
const {
    registerIncomingMessages,
    runProfileAnalysis,
    listPendingChanges,
    reviewChange,
    runFallbackAnalysisScan,
} = require('../services/profileAnalysisService');

// POST /api/profile-analysis/hook
router.post('/profile-analysis/hook', async (req, res) => {
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

// POST /api/profile-analysis/trigger/:clientId
router.post('/profile-analysis/trigger/:clientId', async (req, res) => {
    try {
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

// POST /api/profile-changes/:id/review
router.post('/profile-changes/:id/review', async (req, res) => {
    try {
        const { action, note = '', reviewed_by = 'operator', edited = null } = req.body || {};
        if (!['accept', 'reject', 'edit'].includes(String(action || '').toLowerCase())) {
            return res.status(400).json({ error: 'action must be accept|reject|edit' });
        }
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

// POST /api/profile-analysis/fallback-scan
router.post('/profile-analysis/fallback-scan', async (_req, res) => {
    try {
        const result = await runFallbackAnalysisScan();
        res.json({ ok: true, ...result });
    } catch (err) {
        console.error('POST /api/profile-analysis/fallback-scan error:', err);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
