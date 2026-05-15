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

function projectRecentGenerationRow(row = {}) {
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

function normalizeStringKey(value, fallback = 'Unknown') {
    const normalized = String(value ?? '').trim();
    return normalized || fallback;
}

function toDateKey(value) {
    if (!value) return null;
    if (typeof value === 'string') return value.slice(0, 10);
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
        return value.toISOString().slice(0, 10);
    }
    return String(value).slice(0, 10);
}

function parseSftContext(value) {
    const parsed = parseJsonSafe(value, {});
    return parsed && typeof parsed === 'object' ? parsed : {};
}

function getSftClientId(row = {}) {
    const context = parseSftContext(row.context_json);
    return String(context.client_id || '').trim();
}

function getSftScene(row = {}) {
    const context = parseSftContext(row.context_json);
    return normalizeStringKey(context.scene || row.scene, 'unknown');
}

async function fetchCreatorsByPhones(db2, phones = []) {
    const uniquePhones = [...new Set(phones.map((phone) => String(phone || '').trim()).filter(Boolean))];
    const creatorMap = new Map();
    const chunkSize = 500;
    for (let i = 0; i < uniquePhones.length; i += chunkSize) {
        const chunk = uniquePhones.slice(i, i + chunkSize);
        const rows = await db2.prepare(`
            SELECT wa_phone, wa_owner
            FROM creators
            WHERE wa_phone IN (?)
        `).all(chunk);
        for (const row of rows) {
            const phone = String(row.wa_phone || '').trim();
            if (phone) creatorMap.set(phone, row);
        }
    }
    return creatorMap;
}

function enrichRowsWithOwners(rows = [], creatorMap = new Map(), getClientId = () => '') {
    return rows.map((row) => {
        const clientId = String(getClientId(row) || '').trim();
        const creator = clientId ? creatorMap.get(clientId) : null;
        return {
            ...row,
            client_id: row.client_id ?? clientId,
            owner: creator?.wa_owner || null,
        };
    });
}

function filterRowsByOwner(rows = [], owner = null) {
    if (!owner) return rows;
    return rows.filter((row) => row.owner === owner);
}

function incrementSummaryBucket(target, key, selected) {
    if (!target[key]) {
        target[key] = { total: 0, custom_count: 0, custom_rate: '0.0%' };
    }
    target[key].total += 1;
    if (selected === 'custom') target[key].custom_count += 1;
}

function finalizeCustomRates(target) {
    for (const row of Object.values(target)) {
        row.custom_rate = pct(row.custom_count, row.total);
    }
}

function summarizeCountRows(rows = []) {
    const total = rows.length;
    const opt1Count = rows.filter((row) => row.human_selected === 'opt1').length;
    const opt2Count = rows.filter((row) => row.human_selected === 'opt2').length;
    const customCount = rows.filter((row) => row.human_selected === 'custom').length;
    return { total, opt1Count, opt2Count, customCount };
}

async function buildAbEvaluationSummary({ owner = null, startDate = null, endDate = null } = {}) {
    const db2 = db.getDb();
    let where = 'WHERE 1=1';
    const params = [];
    if (startDate) { where += ' AND sm.created_at >= ?'; params.push(startDate); }
    if (endDate) { where += ' AND sm.created_at <= ?'; params.push(endDate); }

    const baseRows = await db2.prepare(`
        SELECT
            sm.id,
            sm.human_selected,
            sm.context_json,
            sm.scene,
            sm.created_at
        FROM sft_memory sm
        ${where}
    `).all(...params);

    const creatorMap = await fetchCreatorsByPhones(db2, baseRows.map(getSftClientId));
    const rows = filterRowsByOwner(
        enrichRowsWithOwners(baseRows, creatorMap, getSftClientId),
        owner
    );
    const { total, opt1Count, opt2Count, customCount } = summarizeCountRows(rows);

    const byScene = {};
    const byOwner = {};
    const byDay = new Map();
    for (const row of rows) {
        incrementSummaryBucket(byScene, getSftScene(row), row.human_selected);
        incrementSummaryBucket(byOwner, row.owner || 'Unknown', row.human_selected);
        const day = toDateKey(row.created_at);
        if (day) {
            if (!byDay.has(day)) byDay.set(day, { date: day, total: 0, custom_count: 0, custom_rate: '0.0%' });
            const bucket = byDay.get(day);
            bucket.total += 1;
            if (row.human_selected === 'custom') bucket.custom_count += 1;
        }
    }

    finalizeCustomRates(byScene);
    finalizeCustomRates(byOwner);
    const byDayRows = [...byDay.values()]
        .map((row) => ({ ...row, custom_rate: pct(row.custom_count, row.total) }))
        .sort((a, b) => String(a.date).localeCompare(String(b.date)));

    return {
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
        by_day: byDayRows,
    };
}

function incrementCountBucket(map, key) {
    const normalizedKey = normalizeStringKey(key);
    map.set(normalizedKey, (map.get(normalizedKey) || 0) + 1);
}

function mapToCountRows(map, fieldName) {
    return [...map.entries()]
        .map(([key, count]) => ({ [fieldName]: key, count }))
        .sort((a, b) => b.count - a.count || String(a[fieldName]).localeCompare(String(b[fieldName])));
}

async function buildGenerationStatsSummary({ owner = null, days = 7 } = {}) {
    const db2 = db.getDb();
    const safeDays = Math.min(Math.max(parseInt(days, 10) || 7, 1), 60);
    const startAt = new Date(Date.now() - (safeDays * 24 * 60 * 60 * 1000))
        .toISOString()
        .slice(0, 19)
        .replace('T', ' ');

    const baseRows = await db2.prepare(`
        SELECT
            gl.client_id,
            gl.provider,
            gl.route,
            gl.status,
            gl.latency_ms,
            gl.created_at
        FROM generation_log gl
        WHERE gl.created_at >= ?
    `).all(startAt);

    const creatorMap = await fetchCreatorsByPhones(db2, baseRows.map((row) => row.client_id));
    const rows = filterRowsByOwner(
        enrichRowsWithOwners(baseRows, creatorMap, (row) => row.client_id),
        owner
    );
    const total = rows.length;
    const successCount = rows.filter((row) => row.status === 'success').length;
    const failedCount = rows.filter((row) => row.status === 'failed').length;
    const latencies = rows
        .filter((row) => row.latency_ms !== null && row.latency_ms !== undefined && row.latency_ms !== '')
        .map((row) => Number(row.latency_ms))
        .filter((value) => Number.isFinite(value));
    const avgLatencyMs = latencies.length
        ? Math.round(latencies.reduce((sum, value) => sum + value, 0) / latencies.length)
        : null;
    const providerMap = new Map();
    const routeMap = new Map();
    const dayMap = new Map();
    for (const row of rows) {
        incrementCountBucket(providerMap, row.provider);
        incrementCountBucket(routeMap, row.route);
        const day = toDateKey(row.created_at);
        if (!day) continue;
        if (!dayMap.has(day)) {
            dayMap.set(day, { date: day, total: 0, success_count: 0, failed_count: 0 });
        }
        const bucket = dayMap.get(day);
        bucket.total += 1;
        if (row.status === 'success') bucket.success_count += 1;
        if (row.status === 'failed') bucket.failed_count += 1;
    }

    return {
        window_days: safeDays,
        owner: owner || null,
        total,
        success_count: successCount,
        failed_count: failedCount,
        avg_latency_ms: avgLatencyMs,
        by_provider: mapToCountRows(providerMap, 'provider'),
        by_route: mapToCountRows(routeMap, 'route'),
        by_day: [...dayMap.values()].sort((a, b) => String(a.date).localeCompare(String(b.date))),
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
// admin(source=db) 看全部;operator 只看自己 user_id 的记录(同 owner 多 operator 不互串)
// env admin token 视为管理视图但禁止跨用户追溯:403(避免运维 token 被滥用)
router.get('/audit-log', async (req, res) => {
    try {
        const auth = req.auth || {};
        const isDbAdmin = auth.source === 'db' && auth.role === 'admin';
        const isDbOperator = auth.source === 'db' && auth.role === 'operator';
        if (!isDbAdmin && !isDbOperator) {
            return res.status(403).json({ ok: false, error: 'Forbidden: DB-backed user required' });
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
        if (isDbOperator) {
            sql += ' AND user_id = ?';
            params.push(auth.user_id);
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
        const { start_date, end_date } = req.query;
        const effectiveOwner = resolveRequestedOwner(req, res, req.query.owner, null);
        if (effectiveOwner === null && getLockedOwner(req) && req.query.owner) return;
        res.json(await buildAbEvaluationSummary({
            owner: effectiveOwner,
            startDate: start_date,
            endDate: end_date,
        }));
    } catch (err) {
        console.error('GET /api/ab-evaluation error:', err);
        res.status(500).json({ error: err.message });
    }
});

// GET /api/generation-log/stats
router.get('/generation-log/stats', async (req, res) => {
    try {
        const days = Math.min(Math.max(parseInt(req.query.days) || 7, 1), 60);
        const effectiveOwner = resolveRequestedOwner(req, res, req.query.owner, null);
        if (effectiveOwner === null && getLockedOwner(req) && req.query.owner) return;
        res.json(await buildGenerationStatsSummary({ owner: effectiveOwner, days }));
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
        res.json(rows.map(projectRecentGenerationRow));
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

// GET /api/generation-log/evaluation-summary
// SFTDashboard uses this one endpoint to avoid five independent evaluation-tab requests.
router.get('/generation-log/evaluation-summary', async (req, res) => {
    try {
        const days = Math.min(Math.max(parseInt(req.query.days) || 7, 1), 60);
        const hours = Math.min(Math.max(parseInt(req.query.hours) || 24, 1), 24 * 14);
        const limit = Math.min(Math.max(parseInt(req.query.limit) || 20, 1), 500);
        const effectiveOwner = resolveRequestedOwner(req, res, req.query.owner, null);
        if (effectiveOwner === null && getLockedOwner(req) && req.query.owner) return;

        const [
            abEvaluation,
            generationStats,
            generationRecentRows,
            generationWindowRows,
            sftRows,
            skipCount,
        ] = await Promise.all([
            buildAbEvaluationSummary({
                owner: effectiveOwner,
                startDate: req.query.start_date,
                endDate: req.query.end_date,
            }),
            buildGenerationStatsSummary({ owner: effectiveOwner, days }),
            fetchGenerationRows({ owner: effectiveOwner, limit }),
            fetchGenerationRows({ hours, owner: effectiveOwner, limit }),
            fetchSftRows({ hours, owner: effectiveOwner }),
            fetchSkipCount({ hours, owner: effectiveOwner }),
        ]);

        res.json({
            owner: effectiveOwner || null,
            ab_evaluation: abEvaluation,
            generation_stats: generationStats,
            generation_recent: generationRecentRows.map(projectRecentGenerationRow),
            rag_observation: {
                window_hours: hours,
                owner: effectiveOwner || null,
                start_at: null,
                end_at: null,
                generation: buildGenerationSummary(generationWindowRows),
                sft: buildSftSummary(sftRows, skipCount),
            },
            rag_sources: {
                window_hours: hours,
                owner: effectiveOwner || null,
                summary: buildGenerationSummary(generationWindowRows),
                recent: generationWindowRows.map((row) => ({
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
                })),
            },
        });
    } catch (err) {
        console.error('GET /api/generation-log/evaluation-summary error:', err);
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
    projectRecentGenerationRow,
    buildGenerationSummary,
    buildAbEvaluationSummary,
    buildGenerationStatsSummary,
    fetchGenerationLogDetail,
    fetchRetrievalSnapshotDetail,
};
