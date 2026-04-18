const express = require('express');
const router = express.Router();
const db = require('../../db');
const { writeAudit } = require('../middleware/audit');
const {
    DEFAULT_POLICY_KEY,
    buildDefaultPayload,
    extractPayloadFromRow,
    normalizeConfig,
    toRuntimeOptions,
} = require('../services/lifecycleConfigService');
const {
    rebuildLifecycleBatch,
} = require('../services/lifecyclePersistenceService');
const {
    getLifecycleDashboard,
} = require('../services/lifecycleDashboardService');
const { requireHumanAdmin } = require('../middleware/appAuth');

router.get('/lifecycle-config', async (req, res) => {
    try {
        const db2 = db.getDb();
        const row = await db2.prepare(
            'SELECT policy_key, policy_version, policy_content, applicable_scenarios, is_active, updated_at FROM policy_documents WHERE policy_key = ? LIMIT 1'
        ).get(DEFAULT_POLICY_KEY);
        res.json({ ok: true, ...extractPayloadFromRow(row) });
    } catch (err) {
        console.error('GET /api/lifecycle-config error:', err);
        res.status(500).json({ error: err.message });
    }
});

router.put('/lifecycle-config', requireHumanAdmin, async (req, res) => {
    try {
        const db2 = db.getDb();
        const fallback = buildDefaultPayload();
        const policy_version = String(req.body?.policy_version || fallback.policy_version).trim() || fallback.policy_version;
        const applicable_scenarios = Array.isArray(req.body?.applicable_scenarios)
            ? req.body.applicable_scenarios.map((item) => String(item || '').trim()).filter(Boolean)
            : fallback.applicable_scenarios;
        const is_active = req.body?.is_active === undefined ? 1 : (req.body?.is_active ? 1 : 0);
        const config = normalizeConfig(req.body?.config || {});

        const oldRow = await db2.prepare(
            'SELECT policy_key, policy_version, policy_content, applicable_scenarios, is_active FROM policy_documents WHERE policy_key = ? LIMIT 1'
        ).get(DEFAULT_POLICY_KEY);

        await db2.prepare(`
            INSERT INTO policy_documents (policy_key, policy_version, policy_content, applicable_scenarios, is_active)
            VALUES (?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
              policy_version = VALUES(policy_version),
              policy_content = VALUES(policy_content),
              applicable_scenarios = VALUES(applicable_scenarios),
              is_active = VALUES(is_active),
              updated_at = CURRENT_TIMESTAMP
        `).run(
            DEFAULT_POLICY_KEY,
            policy_version,
            JSON.stringify({ config }),
            JSON.stringify(applicable_scenarios),
            is_active
        );

        await writeAudit(
            'lifecycle_config_update',
            'policy_documents',
            DEFAULT_POLICY_KEY,
            oldRow || null,
            {
                policy_key: DEFAULT_POLICY_KEY,
                policy_version,
                applicable_scenarios,
                is_active,
                config,
            },
            req
        );

        res.json({
            ok: true,
            policy_key: DEFAULT_POLICY_KEY,
            policy_version,
            applicable_scenarios,
            is_active,
            config,
        });
    } catch (err) {
        console.error('PUT /api/lifecycle-config error:', err);
        res.status(500).json({ error: err.message });
    }
});

router.post('/lifecycle/rebuild', requireHumanAdmin, async (req, res) => {
    try {
        const db2 = db.getDb();
        const creatorIds = Array.isArray(req.body?.creator_ids) ? req.body.creator_ids : [];
        const dryRun = req.body?.dry_run === true;
        const writeSnapshot = req.body?.write_snapshot !== false;
        const writeTransition = req.body?.write_transition !== false;
        const reason = String(req.body?.reason || 'manual_rebuild').trim() || 'manual_rebuild';

        if (dryRun) {
            const results = await rebuildLifecycleBatch(db2, {
                creatorIds,
                operator: req.user?.name || null,
                reason,
                writeSnapshot: false,
                writeTransition: false,
            });
            return res.json({
                ok: true,
                dry_run: true,
                processed_count: results.length,
                results,
            });
        }

        const results = await rebuildLifecycleBatch(db2, {
            creatorIds,
            operator: req.user?.name || null,
            reason,
            writeSnapshot,
            writeTransition,
        });

        await writeAudit(
            'lifecycle_rebuild',
            'creator_lifecycle_snapshot',
            null,
            null,
            {
                creator_ids: creatorIds,
                dry_run: false,
                write_snapshot: writeSnapshot,
                write_transition: writeTransition,
                reason,
                processed_count: results.length,
            },
            req
        );

        res.json({
            ok: true,
            dry_run: false,
            processed_count: results.length,
            results,
        });
    } catch (err) {
        console.error('POST /api/lifecycle/rebuild error:', err);
        res.status(500).json({ error: err.message });
    }
});

router.get('/lifecycle/dashboard', async (req, res) => {
    try {
        const db2 = db.getDb();
        const data = await getLifecycleDashboard(db2, {
            owner: req.query.owner || null,
        });
        const row = await db2.prepare(
            'SELECT policy_key, policy_version, policy_content, applicable_scenarios, is_active, updated_at FROM policy_documents WHERE policy_key = ? LIMIT 1'
        ).get(DEFAULT_POLICY_KEY);
        const payload = extractPayloadFromRow(row);

        res.json({
            ok: true,
            config: payload.config,
            runtime: toRuntimeOptions(payload.config),
            ...data,
        });
    } catch (err) {
        console.error('GET /api/lifecycle/dashboard error:', err);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
