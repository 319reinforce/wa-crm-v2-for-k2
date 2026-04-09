/**
 * Policy routes
 * GET /api/policy-documents, POST /api/policy-documents
 */
const express = require('express');
const router = express.Router();
const db = require('../../db');
const { writeAudit } = require('../middleware/audit');

// GET /api/policy-documents
router.get('/policy-documents', (req, res) => {
    try {
        const db2 = db.getDb();
        const { active_only } = req.query;
        let sql = 'SELECT * FROM policy_documents';
        if (active_only ***REMOVED***= 'true') sql += ' WHERE is_active = 1';
        sql += ' ORDER BY policy_key';
        const rows = db2.prepare(sql).all();
        res.json(rows.map(r => ({
            ...r,
            applicable_scenarios: r.applicable_scenarios ? JSON.parse(r.applicable_scenarios) : []
        })));
    } catch (err) {
        console.error('GET /api/policy-documents error:', err);
        res.status(500).json({ error: err.message });
    }
});

// POST /api/policy-documents
router.post('/policy-documents', (req, res) => {
    try {
        const { policy_key, policy_version, policy_content, applicable_scenarios, is_active = 1 } = req.body;
        if (!policy_key || !policy_version || !policy_content) {
            return res.status(400).json({ error: 'policy_key, policy_version, policy_content required' });
        }
        const db2 = db.getDb();
        const scenarios_json = applicable_scenarios ? JSON.stringify(applicable_scenarios) : null;

        const oldRow = db2.prepare('SELECT * FROM policy_documents WHERE policy_key = ?').get(policy_key);
        const auditAction = oldRow ? (is_active ? 'policy_update' : 'policy_deactivate') : 'policy_create';

        if (oldRow) {
            db2.prepare(`
                UPDATE policy_documents SET
                    policy_version = ?,
                    policy_content = ?,
                    applicable_scenarios = ?,
                    is_active = ?,
                    updated_at = CURRENT_TIMESTAMP
                WHERE policy_key = ?
            `).run(policy_version, policy_content, scenarios_json, is_active ? 1 : 0, policy_key);
        } else {
            db2.prepare(`
                INSERT INTO policy_documents
                (policy_key, policy_version, policy_content, applicable_scenarios, is_active)
                VALUES (?, ?, ?, ?, ?)
            `).run(policy_key, policy_version, policy_content, scenarios_json, is_active ? 1 : 0);
        }

        writeAudit(auditAction, 'policy_documents', policy_key, oldRow || null, {
            policy_key, policy_version, is_active
        }, req);
        res.json({ ok: true });
    } catch (err) {
        console.error('POST /api/policy-documents error:', err);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
