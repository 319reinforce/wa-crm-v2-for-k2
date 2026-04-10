/**
 * Audit routes
 * GET /api/audit-log, GET /api/ab-evaluation, GET /api/generation-log/stats, GET /api/generation-log/recent
 */
const express = require('express');
const router = express.Router();
const db = require('../../db');

// GET /api/audit-log
router.get('/audit-log', async (req, res) => {
    try {
        const db2 = db.getDb();
        const { action } = req.query;
        const limit = Math.min(Math.max(parseInt(req.query.limit) || 50, 1), 1000);
        const offset = Math.max(parseInt(req.query.offset) || 0, 0);
        let sql = 'SELECT * FROM audit_log WHERE 1=1';
        const params = [];
        if (action) {
            sql += ' AND action = ?';
            params.push(action);
        }
        sql += ` ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`;
        const rows = await db2.prepare(sql).all(...params);
        res.json(rows.map(r => ({
            ...r,
            after_value: (() => {
                if (r.after_value ***REMOVED*** null) return null;
                if (typeof r.after_value !***REMOVED*** 'string') return r.after_value;
                try { return JSON.parse(r.after_value); } catch (_) { return r.after_value; }
            })(),
            before_value: (() => {
                if (r.before_value ***REMOVED*** null) return null;
                if (typeof r.before_value !***REMOVED*** 'string') return r.before_value;
                try { return JSON.parse(r.before_value); } catch (_) { return r.before_value; }
            })(),
        })));
    } catch (err) {
        console.error('GET /api/audit-log error:', err);
        res.status(500).json({ error: err.message });
    }
});

// GET /api/ab-evaluation
router.get('/ab-evaluation', async (req, res) => {
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

        const countsRow = (await db2.prepare(`
            SELECT
                COUNT(*) as total,
                SUM(CASE WHEN sm.human_selected = 'opt1' THEN 1 ELSE 0 END) as opt1_count,
                SUM(CASE WHEN sm.human_selected = 'opt2' THEN 1 ELSE 0 END) as opt2_count,
                SUM(CASE WHEN sm.human_selected = 'custom' THEN 1 ELSE 0 END) as custom_count
            FROM sft_memory sm ${joinCreators} ${where}
        `).get(...params)) || { total: 0, opt1_count: 0, opt2_count: 0, custom_count: 0 };
        const total = countsRow.total || 0;
        const opt1Count = countsRow.opt1_count || 0;
        const opt2Count = countsRow.opt2_count || 0;
        const customCount = countsRow.custom_count || 0;

        const bySceneRows = await db2.prepare(`
            SELECT
                JSON_EXTRACT(context_json, '$.scene') as scene,
                COUNT(*) as total,
                SUM(CASE WHEN human_selected = 'custom' THEN 1 ELSE 0 END) as custom_count
            FROM sft_memory sm
            ${joinCreators}
            ${where}
            GROUP BY JSON_EXTRACT(context_json, '$.scene')
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

        const byOwnerRows = await db2.prepare(`
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

        const byDayRows = await db2.prepare(`
            SELECT
                DATE(created_at) as date,
                COUNT(*) as total,
                SUM(CASE WHEN human_selected = 'custom' THEN 1 ELSE 0 END) as custom_count
            FROM sft_memory
            WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
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

// GET /api/generation-log/stats
router.get('/generation-log/stats', async (req, res) => {
    try {
        const db2 = db.getDb();
        const days = Math.min(Math.max(parseInt(req.query.days) || 7, 1), 60);
        const { owner } = req.query;
        const startAt = new Date(Date.now() - (days * 24 * 60 * 60 * 1000))
            .toISOString()
            .slice(0, 19)
            .replace('T', ' ');

        let joinClause = '';
        const params = [startAt];
        if (owner) {
            joinClause = 'LEFT JOIN creators c ON c.wa_phone = gl.client_id';
        }

        let whereClause = 'WHERE gl.created_at >= ?';
        if (owner) {
            whereClause += ' AND c.wa_owner = ?';
            params.push(owner);
        }

        const totalRow = await db2.prepare(`
            SELECT
                COUNT(*) AS total,
                SUM(CASE WHEN gl.status = 'success' THEN 1 ELSE 0 END) AS success_count,
                SUM(CASE WHEN gl.status = 'failed' THEN 1 ELSE 0 END) AS failed_count,
                AVG(CASE WHEN gl.latency_ms IS NOT NULL THEN gl.latency_ms END) AS avg_latency_ms
            FROM generation_log gl
            ${joinClause}
            ${whereClause}
        `).get(...params);

        const byProviderRows = await db2.prepare(`
            SELECT gl.provider, COUNT(*) AS count
            FROM generation_log gl
            ${joinClause}
            ${whereClause}
            GROUP BY gl.provider
            ORDER BY count DESC
        `).all(...params);

        const byRouteRows = await db2.prepare(`
            SELECT gl.route, COUNT(*) AS count
            FROM generation_log gl
            ${joinClause}
            ${whereClause}
            GROUP BY gl.route
            ORDER BY count DESC
        `).all(...params);

        const byDayRows = await db2.prepare(`
            SELECT DATE(gl.created_at) AS date,
                   COUNT(*) AS total,
                   SUM(CASE WHEN gl.status = 'success' THEN 1 ELSE 0 END) AS success_count,
                   SUM(CASE WHEN gl.status = 'failed' THEN 1 ELSE 0 END) AS failed_count
            FROM generation_log gl
            ${joinClause}
            ${whereClause}
            GROUP BY DATE(gl.created_at)
            ORDER BY date ASC
        `).all(...params);

        res.json({
            window_days: days,
            owner: owner || null,
            total: totalRow?.total || 0,
            success_count: totalRow?.success_count || 0,
            failed_count: totalRow?.failed_count || 0,
            avg_latency_ms: totalRow?.avg_latency_ms ? Math.round(totalRow.avg_latency_ms) : null,
            by_provider: byProviderRows,
            by_route: byRouteRows,
            by_day: byDayRows,
        });
    } catch (err) {
        console.error('GET /api/generation-log/stats error:', err);
        res.status(500).json({ error: err.message });
    }
});

// GET /api/generation-log/recent
router.get('/generation-log/recent', async (req, res) => {
    try {
        const db2 = db.getDb();
        const limit = Math.min(Math.max(parseInt(req.query.limit) || 50, 1), 500);
        const rows = await db2.prepare(`
            SELECT id, client_id, retrieval_snapshot_id, provider, model, route, ab_bucket, scene, operator,
                   message_count, prompt_version, latency_ms, status, error_message, created_at
            FROM generation_log
            ORDER BY created_at DESC
            LIMIT ${limit}
        `).all();
        res.json(rows);
    } catch (err) {
        console.error('GET /api/generation-log/recent error:', err);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
