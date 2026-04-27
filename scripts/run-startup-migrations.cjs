#!/usr/bin/env node
require('dotenv').config();

const path = require('path');
const { spawnSync } = require('child_process');
const mysql = require('mysql2/promise');

const DEFAULT_MIGRATIONS = [
    'server/migrations/005_active_event_detection_queue.sql',
    'server/migrations/006_managed_runtime_tables.sql',
    'server/migrations/007_creator_import_tables.sql',
    'server/migrations/008_template_media_training_tables.sql',
    'server/migrations/009_ai_profile_creator_id_backfill.sql',
    'server/migrations/010_schema_index_backfill.sql',
    'server/migrations/011_billing_progress_deadline_retention.sql',
    'server/migrations/012_retention_rollups_and_purge_windows.sql',
    'server/migrations/013_retention_external_archive_checks.sql',
];

const LIFECYCLE_BASE_MIGRATION = 'server/migrations/004_event_lifecycle_fact_model.sql';

function envFlag(name, fallback = false) {
    const raw = process.env[name];
    if (raw === undefined || raw === null || raw === '') return fallback;
    return ['1', 'true', 'yes', 'on'].includes(String(raw).trim().toLowerCase());
}

function parsePositiveInt(raw, fallback, { min = 1, max = 3600 } = {}) {
    const value = Number(raw);
    if (!Number.isFinite(value)) return fallback;
    return Math.max(min, Math.min(max, Math.trunc(value)));
}

function parseMigrationFiles() {
    const explicit = String(process.env.DB_MIGRATION_FILES || '').trim();
    if (explicit) {
        return explicit.split(/[\s,]+/).map((item) => item.trim()).filter(Boolean);
    }
    const migrations = [...DEFAULT_MIGRATIONS];
    if (envFlag('DB_MIGRATION_INCLUDE_004', false)) {
        migrations.unshift(LIFECYCLE_BASE_MIGRATION);
    }
    return migrations;
}

function getDbConfig() {
    return {
        host: process.env.DB_HOST || '127.0.0.1',
        port: parseInt(process.env.DB_PORT || '3306', 10),
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || '',
        database: process.env.DB_NAME || 'wa_crm_v2',
        charset: 'utf8mb4',
        timezone: '+08:00',
        multipleStatements: true,
    };
}

function assertRemoteMigrationConfirmed(config) {
    const localHosts = new Set(['127.0.0.1', 'localhost', '::1', 'mysql']);
    const host = String(config.host || '').trim().toLowerCase();
    if (localHosts.has(host)) return;
    if (envFlag('CONFIRM_REMOTE_MIGRATION', false)) return;
    throw new Error(
        `Refusing startup migration for non-local DB_HOST=${config.host}. ` +
        'Set CONFIRM_REMOTE_MIGRATION=1 only after backup/rollout approval.',
    );
}

function runNodeScript(args, env = process.env) {
    const result = spawnSync(process.execPath, args, {
        cwd: process.cwd(),
        env,
        stdio: 'inherit',
    });
    if (result.error) throw result.error;
    return result.status == null ? 1 : result.status;
}

async function withMysqlMigrationLock(config, fn) {
    const lockName = process.env.DB_MIGRATION_LOCK_NAME || `wa_crm_v2_schema_migrations:${config.database}`;
    const lockTimeout = parsePositiveInt(process.env.DB_MIGRATION_LOCK_TIMEOUT_SECONDS, 60, { min: 1, max: 3600 });
    const conn = await mysql.createConnection(config);
    let acquired = false;
    try {
        const [rows] = await conn.query('SELECT GET_LOCK(?, ?) AS acquired', [lockName, lockTimeout]);
        acquired = Number(rows?.[0]?.acquired || 0) === 1;
        if (!acquired) {
            throw new Error(`Timed out waiting for MySQL migration lock ${lockName}`);
        }
        console.log(`[startup-migrations] acquired lock ${lockName}`);
        return await fn();
    } finally {
        if (acquired) {
            try {
                await conn.query('SELECT RELEASE_LOCK(?) AS released', [lockName]);
                console.log(`[startup-migrations] released lock ${lockName}`);
            } catch (err) {
                console.warn(`[startup-migrations] failed to release lock ${lockName}: ${err.message}`);
            }
        }
        await conn.end();
    }
}

async function main() {
    if (!envFlag('DB_MIGRATE_ON_STARTUP', false)) {
        console.log('[startup-migrations] disabled; set DB_MIGRATE_ON_STARTUP=true to run before app startup');
        return;
    }

    const config = getDbConfig();
    assertRemoteMigrationConfirmed(config);
    const files = parseMigrationFiles();
    if (files.length === 0) {
        console.log('[startup-migrations] no migration files configured');
        return;
    }

    console.log(`[startup-migrations] target=${config.user}@${config.host}:${config.port}/${config.database}`);
    console.log(`[startup-migrations] files=${files.map((file) => path.relative(process.cwd(), path.resolve(file))).join(', ')}`);

    await withMysqlMigrationLock(config, async () => {
        const status = runNodeScript(['scripts/apply-sql-migrations.cjs', ...files]);
        if (status !== 0) {
            throw new Error(`apply-sql-migrations exited with status ${status}`);
        }

        if (envFlag('DB_MIGRATION_ANALYZE_AFTER', false)) {
            const analyzeStatus = runNodeScript(['scripts/analyze-schema-state.js']);
            if (analyzeStatus !== 0) {
                throw new Error(`analyze-schema-state exited with status ${analyzeStatus}`);
            }
        }
    });

    console.log('[startup-migrations] done');
}

main().catch((err) => {
    console.error('[startup-migrations] failed:', err.message);
    process.exit(1);
});
