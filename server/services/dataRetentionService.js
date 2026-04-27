const db = require('../../db');
const { assertManagedSchemaReady } = require('./schemaReadinessGuard');

const MIGRATION_PATH = 'server/migrations/011_billing_progress_deadline_retention.sql';
const DEFAULT_SAMPLE_SIZE = 20;

const RETENTION_TARGETS = Object.freeze({
    generation_log: {
        idColumn: 'id',
        dateColumns: ['created_at'],
        action: 'archive_mark',
        keepIfLinked: { table: 'sft_memory', column: 'generation_log_id' },
        hardDeleteAllowed: true,
    },
    retrieval_snapshot: {
        idColumn: 'id',
        dateColumns: ['created_at'],
        action: 'archive_mark',
        keepIfLinked: { table: 'sft_memory', column: 'retrieval_snapshot_id' },
        hardDeleteAllowed: true,
    },
    ai_usage_logs: {
        idColumn: 'id',
        dateColumns: ['created_at'],
        action: 'archive_mark',
        rollup: 'ai_usage_daily',
        hardDeleteAllowed: true,
    },
    audit_log: {
        idColumn: 'id',
        dateColumns: ['created_at'],
        action: 'archive_mark',
    },
    wa_messages: {
        idColumn: 'id',
        dateColumns: ['created_at'],
        action: 'archive_mark',
        rollup: 'wa_messages_monthly',
    },
    wa_group_messages: {
        idColumn: 'id',
        dateColumns: ['created_at'],
        action: 'archive_mark',
        rollup: 'wa_group_messages_monthly',
    },
    media_assets: {
        idColumn: 'id',
        dateColumns: ['created_at'],
        action: 'tier_cold',
        mediaTierCold: true,
    },
});

let schemaReady = false;

function assertSafeIdentifier(value, kind = 'identifier') {
    const text = String(value || '').trim();
    if (!/^[A-Za-z0-9_]+$/.test(text)) {
        throw new Error(`Unsafe ${kind}: ${text || '(empty)'}`);
    }
    return text;
}

function parsePositiveInt(value, fallback, { min = 1, max = 100000 } = {}) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return fallback;
    return Math.max(min, Math.min(max, Math.trunc(numeric)));
}

function parseJson(value, fallback = {}) {
    if (value === null || value === undefined) return fallback;
    if (typeof value === 'object') return value;
    try {
        return JSON.parse(value);
    } catch (_) {
        return fallback;
    }
}

function toSqlDatetime(value = Date.now()) {
    const date = value instanceof Date ? value : new Date(value);
    if (!Number.isFinite(date.getTime())) return null;
    return date.toISOString().slice(0, 19).replace('T', ' ');
}

function cutoffForDays(days) {
    const date = new Date();
    date.setDate(date.getDate() - Number(days || 0));
    return toSqlDatetime(date);
}

async function ensureRetentionSchema(dbConn = db.getDb()) {
    if (schemaReady) return;
    await assertManagedSchemaReady(dbConn, {
        feature: 'Data retention',
        migration: MIGRATION_PATH,
        tables: [
            'data_retention_policies',
            'data_retention_runs',
            'data_retention_archive_refs',
            'ai_usage_daily',
            'message_archive_monthly_rollups',
        ],
        columns: {
            data_retention_policies: [
                'policy_key', 'table_name', 'date_column', 'hot_window_days',
                'archive_after_days', 'purge_after_days', 'archive_mode',
                'batch_size', 'enabled', 'config_json', 'created_at', 'updated_at',
            ],
            data_retention_runs: [
                'id', 'policy_key', 'status', 'dry_run', 'scanned_count',
                'archived_count', 'purged_count', 'skipped_count', 'error_count',
                'error_message', 'started_at', 'completed_at', 'triggered_by',
                'meta_json',
            ],
            data_retention_archive_refs: [
                'id', 'policy_key', 'run_id', 'table_name', 'record_id',
                'action', 'record_created_at', 'archived_at', 'meta_json',
            ],
            ai_usage_daily: [
                'date', 'purpose', 'provider_config_id', 'model',
                'request_count', 'tokens_prompt', 'tokens_completion',
                'tokens_total', 'error_count', 'total_latency_ms',
            ],
            message_archive_monthly_rollups: [
                'id', 'table_name', 'archive_month', 'creator_id', 'group_chat_id',
                'operator', 'message_count', 'user_message_count',
                'me_message_count', 'assistant_message_count', 'media_message_count',
                'first_message_timestamp', 'last_message_timestamp',
                'record_created_min', 'record_created_max', 'archive_after_days',
                'run_id', 'created_at', 'updated_at',
            ],
        },
    });
    schemaReady = true;
}

async function listPolicies(dbConn, { policyKey = null, includeDisabled = false } = {}) {
    await ensureRetentionSchema(dbConn);
    const params = [];
    let sql = `
        SELECT *
        FROM data_retention_policies
        WHERE 1=1
    `;
    if (policyKey) {
        sql += ' AND policy_key = ?';
        params.push(policyKey);
    }
    if (!includeDisabled) {
        sql += ' AND enabled = 1';
    }
    sql += ' ORDER BY policy_key ASC';
    const rows = await dbConn.prepare(sql).all(...params);
    return (rows || []).map((row) => ({
        ...row,
        config: parseJson(row.config_json, {}),
    }));
}

function resolveTarget(policy) {
    const tableName = assertSafeIdentifier(policy.table_name, 'table name');
    const dateColumn = assertSafeIdentifier(policy.date_column, 'date column');
    const target = RETENTION_TARGETS[tableName];
    if (!target) {
        throw new Error(`Retention policy ${policy.policy_key} targets unsupported table ${tableName}`);
    }
    if (!target.dateColumns.includes(dateColumn)) {
        throw new Error(`Retention policy ${policy.policy_key} uses unsupported date column ${dateColumn}`);
    }
    return {
        tableName,
        dateColumn,
        idColumn: assertSafeIdentifier(target.idColumn, 'id column'),
        action: target.action,
        keepIfLinked: target.keepIfLinked || null,
        mediaTierCold: !!target.mediaTierCold,
        rollup: target.rollup || null,
        hardDeleteAllowed: !!target.hardDeleteAllowed,
    };
}

function buildCandidateQuery(policy, target, limit) {
    const clauses = [
        `t.${target.dateColumn} < ?`,
        `NOT EXISTS (
            SELECT 1
            FROM data_retention_archive_refs ar
            WHERE BINARY ar.policy_key = BINARY ?
              AND BINARY ar.table_name = BINARY ?
              AND CAST(ar.record_id AS UNSIGNED) = t.${target.idColumn}
              AND BINARY ar.action = BINARY ?
        )`,
    ];

    if (target.keepIfLinked) {
        clauses.push(`NOT EXISTS (
            SELECT 1
            FROM ${target.keepIfLinked.table} linked
            WHERE linked.${target.keepIfLinked.column} = t.${target.idColumn}
        )`);
    }

    if (target.mediaTierCold) {
        clauses.push(`t.storage_tier = 'hot'`);
        clauses.push(`t.status = 'active'`);
        clauses.push(`NOT EXISTS (
            SELECT 1
            FROM cleanup_exemptions ce
            WHERE ce.media_asset_id = t.${target.idColumn}
              AND (ce.expires_at IS NULL OR ce.expires_at > NOW())
        )`);
    }

    return `
        SELECT t.${target.idColumn} AS record_id,
               t.${target.dateColumn} AS record_created_at
        FROM ${target.tableName} t
        WHERE ${clauses.join('\n          AND ')}
        ORDER BY t.${target.dateColumn} ASC, t.${target.idColumn} ASC
        LIMIT ${limit}
    `;
}

async function listCandidates(dbConn, policy, target, limit) {
    const cutoff = cutoffForDays(policy.archive_after_days);
    const safeLimit = parsePositiveInt(limit, policy.batch_size || 500, { min: 1, max: 10000 });
    const sql = buildCandidateQuery(policy, target, safeLimit);
    const rows = await dbConn.prepare(sql).all(cutoff, policy.policy_key, target.tableName, target.action);
    return {
        cutoff,
        rows: rows || [],
    };
}

async function getRollupPreview(dbConn, policy, target, cutoff) {
    if (target.rollup === 'ai_usage_daily') {
        const row = await dbConn.prepare(`
            SELECT COUNT(*) AS rollup_group_count
            FROM (
                SELECT DATE(created_at), purpose, COALESCE(provider_config_id, 0)
                FROM ai_usage_logs
                WHERE created_at < ?
                GROUP BY DATE(created_at), purpose, COALESCE(provider_config_id, 0)
            ) grouped
        `).get(cutoff);
        return {
            type: 'ai_usage_daily',
            group_count: Number(row?.rollup_group_count || 0),
        };
    }

    if (target.rollup === 'wa_messages_monthly') {
        const row = await dbConn.prepare(`
            SELECT COUNT(*) AS rollup_group_count
            FROM (
                SELECT DATE_FORMAT(created_at, '%Y-%m-01'), creator_id, COALESCE(operator, '')
                FROM wa_messages
                WHERE created_at < ?
                GROUP BY DATE_FORMAT(created_at, '%Y-%m-01'), creator_id, COALESCE(operator, '')
            ) grouped
        `).get(cutoff);
        return {
            type: 'message_archive_monthly_rollups',
            source_table: 'wa_messages',
            group_count: Number(row?.rollup_group_count || 0),
        };
    }

    if (target.rollup === 'wa_group_messages_monthly') {
        const row = await dbConn.prepare(`
            SELECT COUNT(*) AS rollup_group_count
            FROM (
                SELECT DATE_FORMAT(created_at, '%Y-%m-01'), group_chat_id, COALESCE(operator, '')
                FROM wa_group_messages
                WHERE created_at < ?
                GROUP BY DATE_FORMAT(created_at, '%Y-%m-01'), group_chat_id, COALESCE(operator, '')
            ) grouped
        `).get(cutoff);
        return {
            type: 'message_archive_monthly_rollups',
            source_table: 'wa_group_messages',
            group_count: Number(row?.rollup_group_count || 0),
        };
    }

    return null;
}

async function applyAiUsageDailyRollup(dbConn, cutoff) {
    const preview = await getRollupPreview(dbConn, {}, { rollup: 'ai_usage_daily' }, cutoff);
    await dbConn.prepare(`
        INSERT INTO ai_usage_daily (
            date, purpose, provider_config_id, model, request_count,
            tokens_prompt, tokens_completion, tokens_total, error_count,
            total_latency_ms
        )
        SELECT
            DATE(created_at) AS date,
            purpose,
            COALESCE(provider_config_id, 0) AS provider_config_id,
            CASE
                WHEN COUNT(DISTINCT model) = 1 THEN MAX(model)
                ELSE '__mixed__'
            END AS model,
            COUNT(*) AS request_count,
            COALESCE(SUM(tokens_prompt), 0) AS tokens_prompt,
            COALESCE(SUM(tokens_completion), 0) AS tokens_completion,
            COALESCE(SUM(tokens_total), 0) AS tokens_total,
            COALESCE(SUM(CASE WHEN status <> 'ok' THEN 1 ELSE 0 END), 0) AS error_count,
            COALESCE(SUM(latency_ms), 0) AS total_latency_ms
        FROM ai_usage_logs
        WHERE created_at < ?
        GROUP BY DATE(created_at), purpose, COALESCE(provider_config_id, 0)
        ON DUPLICATE KEY UPDATE
            model = VALUES(model),
            request_count = VALUES(request_count),
            tokens_prompt = VALUES(tokens_prompt),
            tokens_completion = VALUES(tokens_completion),
            tokens_total = VALUES(tokens_total),
            error_count = VALUES(error_count),
            total_latency_ms = VALUES(total_latency_ms)
    `).run(cutoff);
    return preview;
}

async function applyMessageMonthlyRollup(dbConn, policy, target, cutoff, runId) {
    const sourceTable = target.tableName;
    const isGroup = sourceTable === 'wa_group_messages';
    const preview = await getRollupPreview(dbConn, policy, target, cutoff);
    const sql = isGroup ? `
        INSERT INTO message_archive_monthly_rollups (
            table_name, archive_month, creator_id, group_chat_id, operator,
            message_count, user_message_count, me_message_count,
            assistant_message_count, media_message_count,
            first_message_timestamp, last_message_timestamp,
            record_created_min, record_created_max, archive_after_days, run_id
        )
        SELECT
            'wa_group_messages',
            STR_TO_DATE(DATE_FORMAT(created_at, '%Y-%m-01'), '%Y-%m-%d') AS archive_month,
            0 AS creator_id,
            COALESCE(group_chat_id, 0) AS group_chat_id,
            COALESCE(operator, '') AS operator,
            COUNT(*) AS message_count,
            COALESCE(SUM(CASE WHEN role = 'user' THEN 1 ELSE 0 END), 0) AS user_message_count,
            COALESCE(SUM(CASE WHEN role = 'me' THEN 1 ELSE 0 END), 0) AS me_message_count,
            COALESCE(SUM(CASE WHEN role = 'assistant' THEN 1 ELSE 0 END), 0) AS assistant_message_count,
            0 AS media_message_count,
            MIN(timestamp) AS first_message_timestamp,
            MAX(timestamp) AS last_message_timestamp,
            MIN(created_at) AS record_created_min,
            MAX(created_at) AS record_created_max,
            ? AS archive_after_days,
            ? AS run_id
        FROM wa_group_messages
        WHERE created_at < ?
        GROUP BY STR_TO_DATE(DATE_FORMAT(created_at, '%Y-%m-01'), '%Y-%m-%d'), COALESCE(group_chat_id, 0), COALESCE(operator, '')
        ON DUPLICATE KEY UPDATE
            message_count = VALUES(message_count),
            user_message_count = VALUES(user_message_count),
            me_message_count = VALUES(me_message_count),
            assistant_message_count = VALUES(assistant_message_count),
            media_message_count = VALUES(media_message_count),
            first_message_timestamp = VALUES(first_message_timestamp),
            last_message_timestamp = VALUES(last_message_timestamp),
            record_created_min = VALUES(record_created_min),
            record_created_max = VALUES(record_created_max),
            archive_after_days = VALUES(archive_after_days),
            run_id = VALUES(run_id),
            updated_at = CURRENT_TIMESTAMP
    ` : `
        INSERT INTO message_archive_monthly_rollups (
            table_name, archive_month, creator_id, group_chat_id, operator,
            message_count, user_message_count, me_message_count,
            assistant_message_count, media_message_count,
            first_message_timestamp, last_message_timestamp,
            record_created_min, record_created_max, archive_after_days, run_id
        )
        SELECT
            'wa_messages',
            STR_TO_DATE(DATE_FORMAT(created_at, '%Y-%m-01'), '%Y-%m-%d') AS archive_month,
            COALESCE(creator_id, 0) AS creator_id,
            0 AS group_chat_id,
            COALESCE(operator, '') AS operator,
            COUNT(*) AS message_count,
            COALESCE(SUM(CASE WHEN role = 'user' THEN 1 ELSE 0 END), 0) AS user_message_count,
            COALESCE(SUM(CASE WHEN role = 'me' THEN 1 ELSE 0 END), 0) AS me_message_count,
            COALESCE(SUM(CASE WHEN role = 'assistant' THEN 1 ELSE 0 END), 0) AS assistant_message_count,
            COALESCE(SUM(CASE WHEN media_asset_id IS NOT NULL OR media_type IS NOT NULL THEN 1 ELSE 0 END), 0) AS media_message_count,
            MIN(timestamp) AS first_message_timestamp,
            MAX(timestamp) AS last_message_timestamp,
            MIN(created_at) AS record_created_min,
            MAX(created_at) AS record_created_max,
            ? AS archive_after_days,
            ? AS run_id
        FROM wa_messages
        WHERE created_at < ?
        GROUP BY STR_TO_DATE(DATE_FORMAT(created_at, '%Y-%m-01'), '%Y-%m-%d'), COALESCE(creator_id, 0), COALESCE(operator, '')
        ON DUPLICATE KEY UPDATE
            message_count = VALUES(message_count),
            user_message_count = VALUES(user_message_count),
            me_message_count = VALUES(me_message_count),
            assistant_message_count = VALUES(assistant_message_count),
            media_message_count = VALUES(media_message_count),
            first_message_timestamp = VALUES(first_message_timestamp),
            last_message_timestamp = VALUES(last_message_timestamp),
            record_created_min = VALUES(record_created_min),
            record_created_max = VALUES(record_created_max),
            archive_after_days = VALUES(archive_after_days),
            run_id = VALUES(run_id),
            updated_at = CURRENT_TIMESTAMP
    `;
    await dbConn.prepare(sql).run(policy.archive_after_days, runId || null, cutoff);
    return preview;
}

async function applyRollup(dbConn, policy, target, cutoff, runId) {
    if (!target.rollup) return null;
    if (target.rollup === 'ai_usage_daily') {
        return await applyAiUsageDailyRollup(dbConn, cutoff);
    }
    if (target.rollup === 'wa_messages_monthly' || target.rollup === 'wa_group_messages_monthly') {
        return await applyMessageMonthlyRollup(dbConn, policy, target, cutoff, runId);
    }
    return null;
}

async function createRun(dbConn, policy, { apply = false, triggeredBy = 'script', meta = {} } = {}) {
    const result = await dbConn.prepare(`
        INSERT INTO data_retention_runs (
            policy_key, status, dry_run, triggered_by, meta_json
        ) VALUES (?, 'running', ?, ?, ?)
    `).run(
        policy.policy_key,
        apply ? 0 : 1,
        String(triggeredBy || 'script').slice(0, 64),
        JSON.stringify(meta || {}),
    );
    return result.lastInsertRowid || null;
}

async function finishRun(dbConn, runId, {
    status = 'completed',
    scanned = 0,
    archived = 0,
    purged = 0,
    skipped = 0,
    errors = [],
} = {}) {
    if (!runId) return;
    await dbConn.prepare(`
        UPDATE data_retention_runs
        SET status = ?,
            scanned_count = ?,
            archived_count = ?,
            purged_count = ?,
            skipped_count = ?,
            error_count = ?,
            error_message = ?,
            completed_at = CURRENT_TIMESTAMP
        WHERE id = ?
    `).run(
        status,
        scanned,
        archived,
        purged,
        skipped,
        errors.length,
        errors.length > 0 ? errors.slice(0, 20).join('\n') : null,
        runId,
    );
}

async function applyArchiveRefs(dbConn, policy, target, rows, runId) {
    let archived = 0;
    const errors = [];
    for (const row of rows) {
        try {
            const recordId = String(row.record_id);
            await dbConn.prepare(`
                INSERT IGNORE INTO data_retention_archive_refs (
                    policy_key, run_id, table_name, record_id, action,
                    record_created_at, meta_json
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
            `).run(
                policy.policy_key,
                runId,
                target.tableName,
                recordId,
                target.action,
                row.record_created_at || null,
                JSON.stringify({
                    archive_mode: policy.archive_mode,
                    archive_after_days: policy.archive_after_days,
                    purge_after_days: policy.purge_after_days || null,
                    hard_delete_supported: target.hardDeleteAllowed,
                }),
            );

            if (target.mediaTierCold) {
                await dbConn.prepare(`
                    UPDATE media_assets
                    SET storage_tier = 'cold',
                        updated_at = CURRENT_TIMESTAMP
                    WHERE id = ?
                      AND storage_tier = 'hot'
                      AND status = 'active'
                `).run(row.record_id);
            }
            archived += 1;
        } catch (err) {
            errors.push(`record=${row.record_id}: ${err.message}`);
        }
    }
    return { archived, errors };
}

function buildPurgeCandidateQuery(policy, target, limit) {
    const clauses = [
        `t.${target.dateColumn} < ?`,
        `EXISTS (
            SELECT 1
            FROM data_retention_archive_refs ar
            WHERE BINARY ar.policy_key = BINARY ?
              AND BINARY ar.table_name = BINARY ?
              AND CAST(ar.record_id AS UNSIGNED) = t.${target.idColumn}
              AND BINARY ar.action = BINARY ?
        )`,
    ];

    if (target.keepIfLinked) {
        clauses.push(`NOT EXISTS (
            SELECT 1
            FROM ${target.keepIfLinked.table} linked
            WHERE linked.${target.keepIfLinked.column} = t.${target.idColumn}
        )`);
    }

    return `
        SELECT t.${target.idColumn} AS record_id
        FROM ${target.tableName} t
        WHERE ${clauses.join('\n          AND ')}
        ORDER BY t.${target.dateColumn} ASC, t.${target.idColumn} ASC
        LIMIT ${limit}
    `;
}

async function listPurgeCandidates(dbConn, policy, target, limit) {
    if (!policy.purge_after_days || !target.hardDeleteAllowed || policy.config?.no_hard_delete) {
        return {
            cutoff: policy.purge_after_days ? cutoffForDays(policy.purge_after_days) : null,
            rows: [],
            skipped_reason: !policy.purge_after_days
                ? 'purge_window_not_configured'
                : (!target.hardDeleteAllowed ? 'hard_delete_not_supported_for_target' : 'policy_no_hard_delete'),
        };
    }
    const cutoff = cutoffForDays(policy.purge_after_days);
    const safeLimit = parsePositiveInt(limit, policy.batch_size || 500, { min: 1, max: 10000 });
    const sql = buildPurgeCandidateQuery(policy, target, safeLimit);
    const rows = await dbConn.prepare(sql).all(cutoff, policy.policy_key, target.tableName, target.action);
    return {
        cutoff,
        rows: rows || [],
        skipped_reason: null,
    };
}

async function purgeArchivedRows(dbConn, policy, target, rows) {
    if (!rows || rows.length === 0) return { purged: 0, errors: [] };
    const errors = [];
    let purged = 0;
    for (const row of rows) {
        try {
            const result = await dbConn.prepare(`
                DELETE FROM ${target.tableName}
                WHERE ${target.idColumn} = ?
                LIMIT 1
            `).run(row.record_id);
            purged += Number(result?.changes || 0);
        } catch (err) {
            errors.push(`record=${row.record_id}: ${err.message}`);
        }
    }
    return { purged, errors };
}

async function runPolicy(dbConn, policy, {
    apply = false,
    purge = false,
    limit = null,
    triggeredBy = 'script',
    sampleSize = DEFAULT_SAMPLE_SIZE,
} = {}) {
    const target = resolveTarget(policy);
    const safeLimit = parsePositiveInt(limit, policy.batch_size || 500, { min: 1, max: 10000 });
    const { cutoff, rows } = await listCandidates(dbConn, policy, target, safeLimit);
    const rollupPreview = await getRollupPreview(dbConn, policy, target, cutoff);
    const purgeCandidates = await listPurgeCandidates(dbConn, policy, target, safeLimit);
    const base = {
        policy_key: policy.policy_key,
        table_name: target.tableName,
        date_column: target.dateColumn,
        archive_mode: policy.archive_mode,
        action: target.action,
        dry_run: !apply,
        cutoff,
        purge_requested: !!purge,
        purge_cutoff: purgeCandidates.cutoff,
        purge_after_days: policy.purge_after_days || null,
        purge_supported: target.hardDeleteAllowed && !policy.config?.no_hard_delete,
        purge_skipped_reason: purgeCandidates.skipped_reason,
        candidate_count: rows.length,
        sample: rows.slice(0, Math.max(0, Math.min(Number(sampleSize) || DEFAULT_SAMPLE_SIZE, 100))),
        rollup: rollupPreview,
        run_id: null,
        archived_count: 0,
        purged_count: 0,
        purge_candidate_count: purgeCandidates.rows.length,
        error_count: 0,
        errors: [],
    };

    if (!apply) return base;

    const runId = await createRun(dbConn, policy, {
        apply,
        triggeredBy,
        meta: {
            cutoff,
            limit: safeLimit,
            action: target.action,
            purge,
            purge_cutoff: purgeCandidates.cutoff,
        },
    });
    base.run_id = runId;

    const rollup = await applyRollup(dbConn, policy, target, cutoff, runId);
    if (rollup) base.rollup = rollup;

    const applied = await applyArchiveRefs(dbConn, policy, target, rows, runId);
    base.archived_count = applied.archived;
    let purgeResult = { purged: 0, errors: [] };
    if (purge && base.purge_supported) {
        purgeResult = await purgeArchivedRows(dbConn, policy, target, purgeCandidates.rows);
        base.purged_count = purgeResult.purged;
    }
    base.error_count = applied.errors.length + purgeResult.errors.length;
    base.errors = [...applied.errors, ...purgeResult.errors];
    await finishRun(dbConn, runId, {
        status: base.errors.length > 0 ? 'completed_with_errors' : 'completed',
        scanned: rows.length,
        archived: applied.archived,
        purged: purgeResult.purged,
        errors: base.errors,
    });
    return base;
}

async function runRetentionArchiveJobs(dbConn = db.getDb(), {
    policyKey = null,
    apply = false,
    purge = false,
    limit = null,
    triggeredBy = 'script',
    includeDisabled = false,
} = {}) {
    await ensureRetentionSchema(dbConn);
    const policies = await listPolicies(dbConn, { policyKey, includeDisabled });
    if (policyKey && policies.length === 0) {
        throw new Error(`Retention policy not found or disabled: ${policyKey}`);
    }
    const results = [];
    for (const policy of policies) {
        results.push(await runPolicy(dbConn, policy, {
            apply,
            purge,
            limit,
            triggeredBy,
        }));
    }
    return {
        ok: true,
        apply: !!apply,
        purge: !!purge,
        policy_count: policies.length,
        results,
    };
}

module.exports = {
    RETENTION_TARGETS,
    ensureRetentionSchema,
    listPolicies,
    runRetentionArchiveJobs,
    _private: {
        cutoffForDays,
        parsePositiveInt,
        resolveTarget,
    },
};
