/**
 * Audit routes
 * GET /api/audit-log, GET /api/ab-evaluation
 */
const express = require('express');
const router = express.Router();
const db = require('../../db');

// GET /api/audit-log
router.get('/audit-log', (req, res) => {
    try {
        const db2 = db.getDb();
        const { action, limit = 50, offset = 0 } = req.query;
        let sql = 'SELECT * FROM audit_log WHERE 1=1';
        const params = [];
        if (action) {
            sql += ' AND action = ?';
            params.push(action);
        }
        sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
        params.push(parseInt(limit), parseInt(offset));
        const rows = db2.prepare(sql).all(...params);
        res.json(rows.map(r => ({
            ...r,
            after_value: r.after_value ? JSON.parse(r.after_value) : null,
            before_value: r.before_value ? JSON.parse(r.before_value) : null,
        })));
    } catch (err) {
        console.error('GET /api/audit-log error:', err);
        res.status(500).json({ error: err.message });
    }
});

// GET /api/ab-evaluation
router.get('/ab-evaluation', (req, res) => {
    try {
        const db2 = db.getDb();
        const { start_date, end_date, owner } = req.query;

        let where = 'WHERE 1=1';
        const params = [];
        if (start_date) { where += ' AND created_at >= ?'; params.push(start_date); }
        if (end_date) { where += ' AND created_at <= ?'; params.push(end_date); }

        let joinCreators = '';
        if (owner) {
            joinCreators = ' LEFT JOIN creators c ON c.wa_phone = JSON_EXTRACT(sm.context_json, "$.client_id")';
            where += ' AND c.wa_owner = ?';
            params.push(owner);
        }

        const total = db2.prepare(`SELECT COUNT(*) as count FROM sft_memory sm ${joinCreators} ${where}`).get(...params)?.count || 0;
        const opt1Count = db2.prepare(`SELECT COUNT(*) as count FROM sft_memory sm ${joinCreators} ${where} AND sm.human_selected = 'opt1'`).get(...params)?.count || 0;
        const opt2Count = db2.prepare(`SELECT COUNT(*) as count FROM sft_memory sm ${joinCreators} ${where} AND sm.human_selected = 'opt2'`).get(...params)?.count || 0;
        const customCount = db2.prepare(`SELECT COUNT(*) as count FROM sft_memory sm ${joinCreators} ${where} AND sm.human_selected = 'custom'`).get(...params)?.count || 0;

        const bySceneRows = db2.prepare(`
            SELECT
                JSON_EXTRACT(context_json, '$.scene') as scene,
                COUNT(*) as total,
                SUM(CASE WHEN human_selected = 'custom' THEN 1 ELSE 0 END) as custom_count
            FROM sft_memory sm
            ${joinCreators}
            ${where}
            GROUP BY scene
            ORDER BY total DESC
        `).all(...params);

        const byScene = {};
        for (const row of bySceneRows) {
            const scene = row.scene || 'unknown';
            byScene[scene] = {
                total: row.total,
                custom_rate: row.total > 0 ? ((row.custom_count / row.total) * 100).toFixed(1) + '%' : '0%',
                custom_count: row.custom_count,
            };
        }

        const byOwnerRows = db2.prepare(`
            SELECT
                c.wa_owner as owner,
                COUNT(*) as total,
                SUM(CASE WHEN sm.human_selected = 'custom' THEN 1 ELSE 0 END) as custom_count
            FROM sft_memory sm
            LEFT JOIN creators c ON c.wa_phone = JSON_EXTRACT(sm.context_json, '$.client_id')
            GROUP BY c.wa_owner
            ORDER BY total DESC
        `).all();

        const byOwner = {};
        for (const row of byOwnerRows) {
            const o = row.owner || 'Unknown';
            byOwner[o] = {
                total: row.total,
                custom_rate: row.total > 0 ? ((row.custom_count / row.total) * 100).toFixed(1) + '%' : '0%',
                custom_count: row.custom_count,
            };
        }

        const byDayRows = db2.prepare(`
            SELECT
                DATE(created_at) as date,
                COUNT(*) as total,
                SUM(CASE WHEN human_selected = 'custom' THEN 1 ELSE 0 END) as custom_count
            FROM sft_memory
            WHERE created_at >= DATE('now', '-30 days')
            GROUP BY DATE(created_at)
            ORDER BY date ASC
        `).all();

        const byDay = byDayRows.map(row => ({
            date: row.date,
            total: row.total,
            custom_count: row.custom_count,
            custom_rate: row.total > 0 ? ((row.custom_count / row.total) * 100).toFixed(1) + '%' : '0%',
        }));

        res.json({
            total_records: total,
            opt1_selected: opt1Count,
            opt2_selected: opt2Count,
            custom_input: customCount,
            custom_rate: total > 0 ? ((customCount / total) * 100).toFixed(1) + '%' : '0%',
            opt1_rate: total > 0 ? ((opt1Count / total) * 100).toFixed(1) + '%' : '0%',
            opt2_rate: total > 0 ? ((opt2Count / total) * 100).toFixed(1) + '%' : '0%',
            model_override_rate: total > 0 ? ((customCount / total) * 100).toFixed(1) + '%' : '0%',
            by_scene: byScene,
            by_owner: byOwner,
            by_day: byDay,
        });
    } catch (err) {
        console.error('GET /api/ab-evaluation error:', err);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
