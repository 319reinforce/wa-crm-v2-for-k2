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
    },
    retrieval_snapshot: {
        idColumn: 'id',
        dateColumns: ['created_at'],
        action: 'archive_mark',
        keepIfLinked: { table: 'sft_memory', column: 'retrieval_snapshot_id' },
    },
    ai_usage_logs: {
        idColumn: 'id',
        dateColumns: ['created_at'],
        action: 'archive_mark',
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
    },
    wa_group_messages: {
        idColumn: 'id',
        dateColumns: ['created_at'],
        action: 'archive_mark',
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
        tables: ['data_retention_policies', 'data_retention_runs', 'data_retention_archive_refs'],
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
                    no_hard_delete: true,
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

async function runPolicy(dbConn, policy, {
    apply = false,
    limit = null,
    triggeredBy = 'script',
    sampleSize = DEFAULT_SAMPLE_SIZE,
} = {}) {
    const target = resolveTarget(policy);
    const safeLimit = parsePositiveInt(limit, policy.batch_size || 500, { min: 1, max: 10000 });
    const { cutoff, rows } = await listCandidates(dbConn, policy, target, safeLimit);
    const base = {
        policy_key: policy.policy_key,
        table_name: target.tableName,
        date_column: target.dateColumn,
        archive_mode: policy.archive_mode,
        action: target.action,
        dry_run: !apply,
        cutoff,
        candidate_count: rows.length,
        sample: rows.slice(0, Math.max(0, Math.min(Number(sampleSize) || DEFAULT_SAMPLE_SIZE, 100))),
        run_id: null,
        archived_count: 0,
        purged_count: 0,
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
        },
    });
    base.run_id = runId;

    const applied = await applyArchiveRefs(dbConn, policy, target, rows, runId);
    base.archived_count = applied.archived;
    base.error_count = applied.errors.length;
    base.errors = applied.errors;
    await finishRun(dbConn, runId, {
        status: applied.errors.length > 0 ? 'completed_with_errors' : 'completed',
        scanned: rows.length,
        archived: applied.archived,
        errors: applied.errors,
    });
    return base;
}

async function runRetentionArchiveJobs(dbConn = db.getDb(), {
    policyKey = null,
    apply = false,
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
            limit,
            triggeredBy,
        }));
    }
    return {
        ok: true,
        apply: !!apply,
        policy_count: policies.length,
        results,
    };
}

module.exports = {
    RETENTION_TARGETS,
    ensureRetentionSchema,
    listPolicies,
    runRetentionArchiveJobs,
};
