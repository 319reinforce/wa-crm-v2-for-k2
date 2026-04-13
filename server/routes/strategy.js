/**
 * Strategy config routes
 * GET /api/strategy-config/unbound-agency
 * PUT /api/strategy-config/unbound-agency
 */
const express = require('express');
const router = express.Router();
const db = require('../../db');
const { writeAudit } = require('../middleware/audit');
const {
    DEFAULT_POLICY_KEY,
    normalizeTextArray,
    normalizeStrategies,
    buildDefaultPayload,
    extractPayloadFromRow,
} = require('../services/strategyConfigService');

// GET /api/strategy-config/unbound-agency
router.get('/strategy-config/unbound-agency', async (req, res) => {
    try {
        const db2 = db.getDb();
        const row = await db2.prepare(
            'SELECT policy_key, policy_version, policy_content, applicable_scenarios, updated_at FROM policy_documents WHERE policy_key = ? LIMIT 1'
        ).get(DEFAULT_POLICY_KEY);
        res.json({ ok: true, ...extractPayloadFromRow(row) });
    } catch (err) {
        console.error('GET /api/strategy-config/unbound-agency error:', err);
        res.status(500).json({ error: err.message });
    }
});

// PUT /api/strategy-config/unbound-agency
router.put('/strategy-config/unbound-agency', async (req, res) => {
    try {
        const db2 = db.getDb();
        const fallback = buildDefaultPayload();
        const bodyStrategies = normalizeStrategies(req.body?.strategies || []);
        if (bodyStrategies.length ***REMOVED***= 0) {
            return res.status(400).json({ error: 'strategies must be a non-empty array' });
        }

        const policy_version = String(req.body?.policy_version || fallback.policy_version).trim() || fallback.policy_version;
        const applicable_scenarios = normalizeTextArray(req.body?.applicable_scenarios || fallback.applicable_scenarios);
        const is_active = req.body?.is_active ***REMOVED***= undefined ? 1 : (req.body?.is_active ? 1 : 0);

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
            JSON.stringify({ strategies: bodyStrategies }),
            JSON.stringify(applicable_scenarios),
            is_active
        );

        await writeAudit(
            'strategy_config_update',
            'policy_documents',
            DEFAULT_POLICY_KEY,
            oldRow || null,
            {
                policy_key: DEFAULT_POLICY_KEY,
                policy_version,
                applicable_scenarios,
                is_active,
                strategy_count: bodyStrategies.length,
            },
            req
        );

        res.json({
            ok: true,
            policy_key: DEFAULT_POLICY_KEY,
            policy_version,
            applicable_scenarios,
            strategies: bodyStrategies,
            is_active,
        });
    } catch (err) {
        console.error('PUT /api/strategy-config/unbound-agency error:', err);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
