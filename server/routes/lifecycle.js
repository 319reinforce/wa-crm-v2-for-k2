const express = require('express');
const router = express.Router();
const db = require('../../db');
const { writeAudit } = require('../middleware/audit');
const {
    DEFAULT_POLICY_KEY,
    buildDefaultPayload,
    extractPayloadFromRow,
    normalizeConfig,
} = require('../services/lifecycleConfigService');

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

router.put('/lifecycle-config', async (req, res) => {
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

module.exports = router;
