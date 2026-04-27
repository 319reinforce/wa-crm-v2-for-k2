const express = require('express');
const {
    getLockedOwner,
    matchesOwnerScope,
    resolveScopedOwner,
    sendOwnerScopeForbidden,
} = require('../middleware/appAuth');
const {
    createImportBatch,
    fetchBatch,
    listOutreachTemplates,
    runImportBatch,
    upsertOutreachTemplate,
} = require('../services/creatorImportBatchService');

const router = express.Router();

function parsePositiveInt(value) {
    const n = parseInt(value, 10);
    return Number.isInteger(n) && n > 0 ? n : null;
}

function ensureOwnerAccess(req, res, requestedOwner) {
    const lockedOwner = getLockedOwner(req);
    if (lockedOwner && requestedOwner && !matchesOwnerScope(req, requestedOwner)) {
        sendOwnerScopeForbidden(res, lockedOwner);
        return null;
    }
    const owner = resolveScopedOwner(req, requestedOwner, null);
    if (!owner) {
        res.status(400).json({ ok: false, error: 'owner required' });
        return null;
    }
    return owner;
}

function ensureBatchAccess(req, res, batch) {
    const lockedOwner = getLockedOwner(req);
    if (lockedOwner && !matchesOwnerScope(req, batch?.owner)) {
        sendOwnerScopeForbidden(res, lockedOwner);
        return false;
    }
    return true;
}

// GET /api/creator-import-batches/outreach-templates?owner=Jiawei
router.get('/outreach-templates', async (req, res) => {
    try {
        const owner = ensureOwnerAccess(req, res, req.query?.owner || req.query?.wa_owner);
        if (!owner) return;
        const templates = await listOutreachTemplates({
            owner,
            includeInactive: req.query?.include_inactive === 'true',
        });
        res.json({ ok: true, owner, templates });
    } catch (err) {
        console.error('GET /api/creator-import-batches/outreach-templates error:', err);
        res.status(500).json({ ok: false, error: err.message });
    }
});

// POST /api/creator-import-batches/outreach-templates
router.post('/outreach-templates', async (req, res) => {
    try {
        const owner = ensureOwnerAccess(req, res, req.body?.owner || req.body?.wa_owner);
        if (!owner) return;
        const template = await upsertOutreachTemplate({
            owner,
            templateKey: req.body?.template_key || 'welcome',
            label: req.body?.label || 'Welcome',
            body: req.body?.body || req.body?.template_text || req.body?.welcome_text,
            isActive: req.body?.is_active === undefined ? true : req.body?.is_active,
            createdBy: req.auth?.username || req.auth?.owner || 'api_user',
            req,
        });
        res.json({ ok: true, template });
    } catch (err) {
        console.error('POST /api/creator-import-batches/outreach-templates error:', err);
        res.status(400).json({ ok: false, error: err.message });
    }
});

// POST /api/creator-import-batches
// 批量建档;可选 send_welcome=true 后异步发送同一条 owner 欢迎消息。
router.post('/', async (req, res) => {
    try {
        const owner = ensureOwnerAccess(req, res, req.body?.owner || req.body?.wa_owner);
        if (!owner) return;

        const batch = await createImportBatch({
            rows: Array.isArray(req.body?.rows) ? req.body.rows : null,
            owner,
            source: req.body?.source || 'csv-import',
            sendWelcome: req.body?.send_welcome,
            welcomeText: req.body?.welcome_text,
            welcomeTemplateKey: req.body?.welcome_template_key || req.body?.template_key || 'welcome',
            createdBy: req.auth?.username || req.auth?.owner || 'api_user',
            lockedOwner: getLockedOwner(req),
            req,
        });

        res.json({
            ok: true,
            batch,
            summary: batch.summary,
            message: batch.send_welcome ? 'batch created; welcome send is running in background' : 'batch imported',
        });
    } catch (err) {
        console.error('POST /api/creator-import-batches error:', err);
        res.status(400).json({ ok: false, error: err.message });
    }
});

// GET /api/creator-import-batches/:id
router.get('/:id', async (req, res) => {
    try {
        const id = parsePositiveInt(req.params.id);
        if (!id) return res.status(400).json({ ok: false, error: 'invalid batch id' });
        const batch = await fetchBatch(id, { includeItems: req.query.items !== 'false' });
        if (!batch) return res.status(404).json({ ok: false, error: 'batch not found' });
        if (!ensureBatchAccess(req, res, batch)) return;
        res.json({ ok: true, batch, summary: batch.summary, items: batch.items || [] });
    } catch (err) {
        console.error('GET /api/creator-import-batches/:id error:', err);
        res.status(500).json({ ok: false, error: err.message });
    }
});

// POST /api/creator-import-batches/:id/run
router.post('/:id/run', async (req, res) => {
    try {
        const id = parsePositiveInt(req.params.id);
        if (!id) return res.status(400).json({ ok: false, error: 'invalid batch id' });
        const batch = await fetchBatch(id, { includeItems: false });
        if (!batch) return res.status(404).json({ ok: false, error: 'batch not found' });
        if (!ensureBatchAccess(req, res, batch)) return;
        runImportBatch(id, { req, retryFailed: !!req.body?.retry_failed }).catch((err) => {
            console.error(`POST /api/creator-import-batches/${id}/run background error:`, err.message);
        });
        res.json({ ok: true, batch_id: id, running: true });
    } catch (err) {
        console.error('POST /api/creator-import-batches/:id/run error:', err);
        res.status(500).json({ ok: false, error: err.message });
    }
});

// POST /api/creator-import-batches/:id/retry
router.post('/:id/retry', async (req, res) => {
    try {
        const id = parsePositiveInt(req.params.id);
        if (!id) return res.status(400).json({ ok: false, error: 'invalid batch id' });
        const batch = await fetchBatch(id, { includeItems: false });
        if (!batch) return res.status(404).json({ ok: false, error: 'batch not found' });
        if (!ensureBatchAccess(req, res, batch)) return;
        runImportBatch(id, { req, retryFailed: true }).catch((err) => {
            console.error(`POST /api/creator-import-batches/${id}/retry background error:`, err.message);
        });
        res.json({ ok: true, batch_id: id, running: true, retry_failed: true });
    } catch (err) {
        console.error('POST /api/creator-import-batches/:id/retry error:', err);
        res.status(500).json({ ok: false, error: err.message });
    }
});

module.exports = router;
