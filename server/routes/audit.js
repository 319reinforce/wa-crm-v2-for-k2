/**
 * Audit routes
 * GET /api/audit-log, GET /api/ab-evaluation, GET /api/generation-log/stats, GET /api/generation-log/recent
 */
const express = require('express');
const router = express.Router();
const db = require('../../db');

function parseJsonSafe(value, fallback = null) {
    if (value === null || value === undefined) return fallback;
    if (typeof value === 'object') return value;
    try {
        return JSON.parse(value);
    } catch (_) {
        return fallback;
    }
}

function toMysqlDateTime(ms) {
    return new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
}

function pct(numerator, denominator) {
    if (!denominator) return '0.0%';
    return `${((numerator / denominator) * 100).toFixed(1)}%`;
}

function aggregateTopSources(rows) {
    const map = new Map();
    rows.forEach((row) => {
        const hits = row?.rag?.hits || [];
        hits.forEach((hit) => {
            const key = `${hit.source_id || hit.filename || 'unknown'}|${hit.source_type || 'unknown'}`;
            if (!map.has(key)) {
                map.set(key, {
                    source_id: hit.source_id || null,
                    source_type: hit.source_type || null,
                    filename: hit.filename || null,
                    hit_count: 0,
                });
            }
            map.get(key).hit_count += 1;
        });
    });
    return Array.from(map.values()).sort((a, b) => b.hit_count - a.hit_count).slice(0, 12);
}

async function fetchGenerationRows({ startAt = null, endAt = null, owner = null, limit = null, hours = null } = {}) {
    const db2 = db.getDb();
    const params = [];
    let ownerJoin = '';
    let where = 'WHERE 1=1';

    if (Number.isFinite(hours)) {
        where += ' AND gl.created_at >= DATE_SUB(NOW(), INTERVAL ? HOUR)';
        params.push(hours);
    } else if (startAt) {
        where += ' AND gl.created_at >= ?';
        params.push(startAt);
    }
    if (endAt) {
        where += ' AND gl.created_at <= ?';
        params.push(endAt);
    }
    if (owner) {
        ownerJoin = 'LEFT JOIN creators c ON c.wa_phone = gl.client_id';
        where += ' AND c.wa_owner = ?';
        params.push(owner);
    }
    const limitSql = limit ? `LIMIT ${Math.min(Math.max(parseInt(limit, 10) || 50, 1), 500)}` : '';
    const rows = await db2.prepare(`
        SELECT gl.id, gl.client_id, gl.retrieval_snapshot_id, gl.provider, gl.model, gl.route, gl.ab_bucket,
               gl.scene, gl.operator, gl.message_count, gl.prompt_version, gl.latency_ms, gl.status, gl.error_message,
               gl.created_at, rs.grounding_json
        FROM generation_log gl
        ${ownerJoin}
        LEFT JOIN retrieval_snapshot rs ON rs.id = gl.retrieval_snapshot_id
        ${where}
        ORDER BY gl.created_at DESC
        ${limitSql}
    `).all(...params);

    return rows.map((row) => {
        const grounding = parseJsonSafe(row.grounding_json, {});
        const rag = grounding?.rag || {};
        const hitCount = Number.isFinite(Number(rag?.hit_count)) ? Number(rag.hit_count) : 0;
        const hits = Array.isArray(rag?.hits) ? rag.hits : [];
        return {
            ...row,
            grounding,
            rag: {
                enabled: !!rag?.enabled,
                hit_count: hitCount,
                hits,
            },
        };
    });
}

function buildGenerationSummary(rows) {
    const total = rows.length;
    const successCount = rows.filter((r) => r.status === 'success').length;
    const failedCount = rows.filter((r) => r.status === 'failed').length;
    const withSnapshot = rows.filter((r) => !!r.retrieval_snapshot_id);
    const withHits = withSnapshot.filter((r) => (r.rag?.hit_count || 0) > 0);
    const avgHitCount = withSnapshot.length
        ? (withSnapshot.reduce((sum, row) => sum + (row.rag?.hit_count || 0), 0) / withSnapshot.length).toFixed(2)
        : '0.00';
    const byScene = {};
    rows.forEach((row) => {
        const key = row.scene || 'unknown';
        if (!byScene[key]) byScene[key] = { total: 0, rag_hit_count: 0 };
        byScene[key].total += 1;
        if ((row.rag?.hit_count || 0) > 0) byScene[key].rag_hit_count += 1;
    });
    Object.keys(byScene).forEach((scene) => {
        byScene[scene].rag_hit_rate = pct(byScene[scene].rag_hit_count, byScene[scene].total);
    });

    return {
        total,
        success_count: successCount,
        failed_count: failedCount,
        success_rate: pct(successCount, total),
        with_snapshot_count: withSnapshot.length,
        rag_hit_count: withHits.length,
        rag_hit_rate: pct(withHits.length, withSnapshot.length),
        avg_rag_hit_count: Number(avgHitCount),
        top_sources: aggregateTopSources(rows),
        by_scene: byScene,
    };
}

async function fetchSftRows({ startAt = null, endAt = null, owner = null, hours = null } = {}) {
    const db2 = db.getDb();
    const params = [];
    let joinClause = '';
    let where = 'WHERE 1=1';
    if (Number.isFinite(hours)) {
        where += ' AND sm.created_at >= DATE_SUB(NOW(), INTERVAL ? HOUR)';
        params.push(hours);
    } else if (startAt) {
        where += ' AND sm.created_at >= ?';
        params.push(startAt);
    }
    if (endAt) {
        where += ' AND sm.created_at <= ?';
        params.push(endAt);
    }
    if (owner) {
        joinClause = 'LEFT JOIN creators c ON c.wa_phone = JSON_UNQUOTE(JSON_EXTRACT(sm.context_json, "$.client_id"))';
        where += ' AND c.wa_owner = ?';
        params.push(owner);
    }
    return db2.prepare(`
        SELECT sm.id, sm.human_selected, sm.status, sm.context_json, sm.scene, sm.created_at
        FROM sft_memory sm
        ${joinClause}
        ${where}
        ORDER BY sm.created_at DESC
    `).all(...params);
}

async function fetchSkipCount({ startAt = null, endAt = null, owner = null, hours = null } = {}) {
    const db2 = db.getDb();
    const params = [];
    let joinClause = '';
    let where = "WHERE sf.feedback_type = 'skip'";
    if (Number.isFinite(hours)) {
        where += ' AND sf.created_at >= DATE_SUB(NOW(), INTERVAL ? HOUR)';
        params.push(hours);
    } else if (startAt) {
        where += ' AND sf.created_at >= ?';
        params.push(startAt);
    }
    if (endAt) {
        where += ' AND sf.created_at <= ?';
        params.push(endAt);
    }
    if (owner) {
        joinClause = 'LEFT JOIN creators c ON c.wa_phone = sf.client_id';
        where += ' AND c.wa_owner = ?';
        params.push(owner);
    }
    const row = await db2.prepare(`
        SELECT COUNT(*) AS count
        FROM sft_feedback sf
        ${joinClause}
        ${where}
    `).get(...params);
    return row?.count || 0;
}

function buildSftSummary(rows, skipCount) {
    const total = rows.length;
    const custom = rows.filter((r) => r.human_selected === 'custom').length;
    const adopted = rows.filter((r) => r.human_selected === 'opt1' || r.human_selected === 'opt2').length;
    const retrievalLinked = rows.filter((row) => {
        const ctx = parseJsonSafe(row.context_json, {});
        return !!ctx?.retrieval_snapshot_id;
    }).length;
    return {
        total_records: total,
        custom_count: custom,
        adopted_count: adopted,
        rewrite_rate: pct(custom, total),
        adoption_rate: pct(adopted, total),
        retrieval_linked_count: retrievalLinked,
        retrieval_linked_rate: pct(retrievalLinked, total),
        skip_count: skipCount,
    };
}

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
                if (r.after_value == null) return null;
                if (typeof r.after_value !== 'string') return r.after_value;
                try { return JSON.parse(r.after_value); } catch (_) { return r.after_value; }
            })(),
            before_value: (() => {
                if (r.before_value == null) return null;
                if (typeof r.before_value !== 'string') return r.before_value;
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

// GET /api/generation-log/rag-sources
router.get('/generation-log/rag-sources', async (req, res) => {
    try {
        const hours = Math.min(Math.max(parseInt(req.query.hours) || 24, 1), 24 * 14);
        const limit = Math.min(Math.max(parseInt(req.query.limit) || 50, 1), 500);
        const owner = req.query.owner || null;
        const rows = await fetchGenerationRows({ hours, owner, limit });
        const summary = buildGenerationSummary(rows);
        const recent = rows.map((row) => ({
            id: row.id,
            created_at: row.created_at,
            client_id: row.client_id,
            scene: row.scene,
            operator: row.operator,
            provider: row.provider,
            model: row.model,
            status: row.status,
            retrieval_snapshot_id: row.retrieval_snapshot_id,
            rag_hit_count: row.rag?.hit_count || 0,
            rag_sources: (row.rag?.hits || []).slice(0, 5),
        }));
        res.json({
            window_hours: hours,
            owner,
            summary,
            recent,
        });
    } catch (err) {
        console.error('GET /api/generation-log/rag-sources error:', err);
        res.status(500).json({ error: err.message });
    }
});

// GET /api/generation-log/rag-observation
router.get('/generation-log/rag-observation', async (req, res) => {
    try {
        const hours = Math.min(Math.max(parseInt(req.query.hours) || 24, 1), 24 * 14);
        const owner = req.query.owner || null;

        const [generationRows, sftRows, skipCount] = await Promise.all([
            fetchGenerationRows({ hours, owner }),
            fetchSftRows({ hours, owner }),
            fetchSkipCount({ hours, owner }),
        ]);
        const generation = buildGenerationSummary(generationRows);
        const sft = buildSftSummary(sftRows, skipCount);

        res.json({
            window_hours: hours,
            owner,
            start_at: null,
            end_at: null,
            generation,
            sft,
        });
    } catch (err) {
        console.error('GET /api/generation-log/rag-observation error:', err);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
