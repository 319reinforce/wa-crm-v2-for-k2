/**
 * Audit routes
 * GET /api/audit-log, GET /api/ab-evaluation, GET /api/generation-log/stats, GET /api/generation-log/recent
 */
const express = require('express');
const router = express.Router();
const db = require('../../db');
const { sanitizeAuditLogRow } = require('../middleware/audit');
const {
    getLockedOwner,
    matchesOwnerScope,
    resolveScopedOwner,
    sendOwnerScopeForbidden,
} = require('../middleware/appAuth');

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

function resolveRequestedOwner(req, res, owner, fallback = null) {
    const lockedOwner = getLockedOwner(req);
    const requestedOwner = typeof owner === 'string' ? owner.trim() : owner;
    if (lockedOwner && requestedOwner && !matchesOwnerScope(req, requestedOwner)) {
        sendOwnerScopeForbidden(res, lockedOwner);
        return null;
    }
    return resolveScopedOwner(req, requestedOwner, fallback);
}

function parsePositiveId(value) {
    const id = parseInt(value, 10);
    return Number.isInteger(id) && id > 0 ? id : null;
}

function resolveAuditRowOwner(row = {}) {
    return row.owner || row.operator || row.retrieval_operator || null;
}

function ensureAuditDetailAccess(req, res, row) {
    const lockedOwner = getLockedOwner(req);
    if (!lockedOwner) return true;
    const rowOwner = resolveAuditRowOwner(row);
    if (!rowOwner || !matchesOwnerScope(req, rowOwner)) {
        sendOwnerScopeForbidden(res, lockedOwner);
        return false;
    }
    return true;
}

function normalizeGenerationRowLimit(limit) {
    if (limit === null || limit === undefined || limit === '') return null;
    const parsed = parseInt(limit, 10);
    if (!Number.isFinite(parsed)) return null;
    return Math.min(Math.max(parsed, 1), 500);
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
    const normalizedLimit = normalizeGenerationRowLimit(limit);
    const baseSql = `
        SELECT gl.id, gl.client_id, gl.retrieval_snapshot_id, gl.provider, gl.model, gl.route, gl.ab_bucket,
               gl.scene, gl.operator, gl.message_count, gl.prompt_version, gl.latency_ms, gl.status, gl.error_message,
               gl.created_at, rs.grounding_json
        FROM generation_log gl
        ${ownerJoin}
        LEFT JOIN retrieval_snapshot rs ON rs.id = gl.retrieval_snapshot_id
        ${where}
        ORDER BY gl.created_at DESC
    `;
    const rows = normalizedLimit === null
        ? await db2.prepare(baseSql).all(...params)
        : await db2.prepare(`${baseSql}\nLIMIT ?`).all(...params, normalizedLimit);

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
        SELECT sm.id, sm.human_selected, sm.status, sm.context_json, sm.scene, sm.created_at,
               sm.retrieval_snapshot_id, sm.generation_log_id, sm.provider, sm.model, sm.pipeline_version
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
        return !!(row?.retrieval_snapshot_id || ctx?.retrieval_snapshot_id);
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

async function fetchGenerationLogDetail(id) {
    const row = await db.getDb().prepare(`
        SELECT
            gl.id,
            gl.client_id,
            gl.retrieval_snapshot_id,
            gl.provider,
            gl.model,
            gl.route,
            gl.ab_bucket,
            gl.scene,
            gl.operator,
            gl.temperature_json,
            gl.message_count,
            gl.prompt_version,
            gl.latency_ms,
            gl.status,
            gl.error_message,
            gl.created_at,
            rs.operator AS retrieval_operator,
            rs.scene AS retrieval_scene,
            rs.system_prompt_version AS retrieval_prompt_version,
            rs.snapshot_hash,
            rs.grounding_json,
            rs.topic_context,
            rs.rich_context,
            rs.conversation_summary,
            c.wa_owner AS owner
        FROM generation_log gl
        LEFT JOIN retrieval_snapshot rs ON rs.id = gl.retrieval_snapshot_id
        LEFT JOIN creators c ON c.wa_phone = gl.client_id
        WHERE gl.id = ?
        LIMIT 1
    `).get(id);

    if (!row) return null;

    const temperature = parseJsonSafe(row.temperature_json, null);
    const grounding = parseJsonSafe(row.grounding_json, {});
    const rag = grounding?.rag || {};

    return {
        id: row.id,
        client_id: row.client_id,
        retrieval_snapshot_id: row.retrieval_snapshot_id,
        provider: row.provider,
        model: row.model,
        route: row.route,
        ab_bucket: row.ab_bucket,
        scene: row.scene,
        operator: row.operator,
        message_count: row.message_count,
        prompt_version: row.prompt_version,
        latency_ms: row.latency_ms,
        status: row.status,
        error_message: row.error_message,
        created_at: row.created_at,
        owner: row.owner || null,
        temperature,
        grounding,
        rag: {
            enabled: !!rag?.enabled,
            hit_count: Number.isFinite(Number(rag?.hit_count)) ? Number(rag.hit_count) : 0,
            hits: Array.isArray(rag?.hits) ? rag.hits : [],
        },
        retrieval_snapshot: row.retrieval_snapshot_id ? {
            id: row.retrieval_snapshot_id,
            operator: row.retrieval_operator || null,
            scene: row.retrieval_scene || null,
            system_prompt_version: row.retrieval_prompt_version || null,
            snapshot_hash: row.snapshot_hash || null,
            grounding,
            topic_context: row.topic_context || null,
            rich_context: row.rich_context || null,
            conversation_summary: row.conversation_summary || null,
        } : null,
    };
}

async function fetchRetrievalSnapshotDetail(id) {
    const row = await db.getDb().prepare(`
        SELECT
            rs.id,
            rs.client_id,
            rs.operator,
            rs.scene,
            rs.system_prompt_version,
            rs.snapshot_hash,
            rs.grounding_json,
            rs.topic_context,
            rs.rich_context,
            rs.conversation_summary,
            rs.created_at,
            c.wa_owner AS owner
        FROM retrieval_snapshot rs
        LEFT JOIN creators c ON c.wa_phone = rs.client_id
        WHERE rs.id = ?
        LIMIT 1
    `).get(id);

    if (!row) return null;

    const grounding = parseJsonSafe(row.grounding_json, {});
    return {
        id: row.id,
        client_id: row.client_id,
        operator: row.operator,
        scene: row.scene,
        system_prompt_version: row.system_prompt_version,
        snapshot_hash: row.snapshot_hash,
        topic_context: row.topic_context,
        rich_context: row.rich_context,
        conversation_summary: row.conversation_summary,
        created_at: row.created_at,
        owner: row.owner || null,
        grounding,
        grounding_json: grounding,
    };
}

// GET /api/audit-log
router.get('/audit-log', async (req, res) => {
    try {
        const lockedOwner = getLockedOwner(req);
        if (lockedOwner) {
            return sendOwnerScopeForbidden(res, lockedOwner);
        }
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
        sql += ` ORDER BY created_at DESC LIMIT ? OFFSET ?`;
        params.push(limit, offset);
        const rows = await db2.prepare(sql).all(...params);
        res.json(rows.map((row) => sanitizeAuditLogRow(row)));
    } catch (err) {
        console.error('GET /api/audit-log error:', err);
        res.status(500).json({ error: err.message });
    }
});

// GET /api/ab-evaluation
router.get('/ab-evaluation', async (req, res) => {
    try {
        const db2 = db.getDb();
        const { start_date, end_date } = req.query;
        const effectiveOwner = resolveRequestedOwner(req, res, req.query.owner, null);
        if (effectiveOwner === null && getLockedOwner(req) && req.query.owner) return;

        let where = 'WHERE 1=1';
        const params = [];
        if (start_date) { where += ' AND sm.created_at >= ?'; params.push(start_date); }
        if (end_date) { where += ' AND sm.created_at <= ?'; params.push(end_date); }

        let joinCreators = '';
        if (effectiveOwner) {
            joinCreators = ' LEFT JOIN creators c ON c.wa_phone = JSON_UNQUOTE(JSON_EXTRACT(sm.context_json, "$.client_id"))';
            where += ' AND c.wa_owner = ?';
            params.push(effectiveOwner);
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
            LEFT JOIN creators c ON c.wa_phone = JSON_UNQUOTE(JSON_EXTRACT(sm.context_json, '$.client_id'))
            ${effectiveOwner ? 'WHERE c.wa_owner = ?' : ''}
            GROUP BY c.wa_owner
            ORDER BY total DESC
        `).all(...(effectiveOwner ? [effectiveOwner] : []));

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
                DATE(sm.created_at) as date,
                COUNT(*) as total,
                SUM(CASE WHEN sm.human_selected = 'custom' THEN 1 ELSE 0 END) as custom_count
            FROM sft_memory sm
            LEFT JOIN creators c ON c.wa_phone = JSON_UNQUOTE(JSON_EXTRACT(sm.context_json, '$.client_id'))
            WHERE sm.created_at >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
            ${effectiveOwner ? 'AND c.wa_owner = ?' : ''}
            GROUP BY DATE(sm.created_at)
            ORDER BY date ASC
        `).all(...(effectiveOwner ? [effectiveOwner] : []));

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
        const effectiveOwner = resolveRequestedOwner(req, res, req.query.owner, null);
        if (effectiveOwner === null && getLockedOwner(req) && req.query.owner) return;
        const startAt = new Date(Date.now() - (days * 24 * 60 * 60 * 1000))
            .toISOString()
            .slice(0, 19)
            .replace('T', ' ');

        let joinClause = '';
        const params = [startAt];
        if (effectiveOwner) {
            joinClause = 'LEFT JOIN creators c ON c.wa_phone = gl.client_id';
        }

        let whereClause = 'WHERE gl.created_at >= ?';
        if (effectiveOwner) {
            whereClause += ' AND c.wa_owner = ?';
            params.push(effectiveOwner);
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
            owner: effectiveOwner || null,
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
        const limit = Math.min(Math.max(parseInt(req.query.limit) || 50, 1), 500);
        const effectiveOwner = resolveRequestedOwner(req, res, req.query.owner, null);
        if (effectiveOwner === null && getLockedOwner(req) && req.query.owner) return;
        const rows = await fetchGenerationRows({ owner: effectiveOwner, limit });
        res.json(rows.map((row) => ({
            id: row.id,
            client_id: row.client_id,
            retrieval_snapshot_id: row.retrieval_snapshot_id,
            provider: row.provider,
            model: row.model,
            route: row.route,
            ab_bucket: row.ab_bucket,
            scene: row.scene,
            operator: row.operator,
            message_count: row.message_count,
            prompt_version: row.prompt_version,
            latency_ms: row.latency_ms,
            status: row.status,
            error_message: row.error_message,
            created_at: row.created_at,
        })));
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
        const effectiveOwner = resolveRequestedOwner(req, res, req.query.owner, null);
        if (effectiveOwner === null && getLockedOwner(req) && req.query.owner) return;
        const rows = await fetchGenerationRows({ hours, owner: effectiveOwner, limit });
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
            owner: effectiveOwner || null,
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
        const effectiveOwner = resolveRequestedOwner(req, res, req.query.owner, null);
        if (effectiveOwner === null && getLockedOwner(req) && req.query.owner) return;

        const [generationRows, sftRows, skipCount] = await Promise.all([
            fetchGenerationRows({ hours, owner: effectiveOwner }),
            fetchSftRows({ hours, owner: effectiveOwner }),
            fetchSkipCount({ hours, owner: effectiveOwner }),
        ]);
        const generation = buildGenerationSummary(generationRows);
        const sft = buildSftSummary(sftRows, skipCount);

        res.json({
            window_hours: hours,
            owner: effectiveOwner || null,
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

// GET /api/generation-log/:id
router.get('/generation-log/:id', async (req, res) => {
    try {
        const id = parsePositiveId(req.params.id);
        if (!id) {
            return res.status(400).json({ error: 'invalid generation log id' });
        }

        const detail = await fetchGenerationLogDetail(id);
        if (!detail) {
            return res.status(404).json({ error: 'generation log not found' });
        }
        if (!ensureAuditDetailAccess(req, res, detail)) return;

        res.json(detail);
    } catch (err) {
        console.error('GET /api/generation-log/:id error:', err);
        res.status(500).json({ error: err.message });
    }
});

// GET /api/retrieval-snapshot/:id
router.get('/retrieval-snapshot/:id', async (req, res) => {
    try {
        const id = parsePositiveId(req.params.id);
        if (!id) {
            return res.status(400).json({ error: 'invalid retrieval snapshot id' });
        }

        const detail = await fetchRetrievalSnapshotDetail(id);
        if (!detail) {
            return res.status(404).json({ error: 'retrieval snapshot not found' });
        }
        if (!ensureAuditDetailAccess(req, res, detail)) return;

        res.json(detail);
    } catch (err) {
        console.error('GET /api/retrieval-snapshot/:id error:', err);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
module.exports._private = {
    parsePositiveId,
    normalizeGenerationRowLimit,
    resolveAuditRowOwner,
    ensureAuditDetailAccess,
    fetchGenerationRows,
    fetchGenerationLogDetail,
    fetchRetrievalSnapshotDetail,
};
