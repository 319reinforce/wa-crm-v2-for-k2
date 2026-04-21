/**
 * migrate-media-lifecycle.js
 * 媒体生命周期管理迁移：
 *   1) media_assets 扩列：storage_tier / original_size / compressed_at / deleted_at / cleanup_job_id
 *   2) 建表：cleanup_jobs / cleanup_exemptions
 *   3) 相关索引
 *
 * 幂等：每一步先查再改，可重复执行。
 *
 * 使用方法：
 *   node migrate-media-lifecycle.js
 */
const mysql = require('mysql2/promise');

function getMysqlConfig() {
    return {
        host: process.env.DB_HOST || '127.0.0.1',
        port: parseInt(process.env.DB_PORT || '3306', 10),
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || '',
        database: process.env.DB_NAME || 'wa_crm_v2',
        timezone: '+08:00',
    };
}

async function hasColumn(conn, tableName, columnName) {
    const [rows] = await conn.query(`
        SELECT COLUMN_NAME
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?
    `, [getMysqlConfig().database, tableName, columnName]);
    return rows.length > 0;
}

async function hasIndex(conn, tableName, indexName) {
    const [rows] = await conn.query(`
        SELECT INDEX_NAME
        FROM INFORMATION_SCHEMA.STATISTICS
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND INDEX_NAME = ?
    `, [getMysqlConfig().database, tableName, indexName]);
    return rows.length > 0;
}

async function hasTable(conn, tableName) {
    const [rows] = await conn.query(`
        SELECT TABLE_NAME
        FROM INFORMATION_SCHEMA.TABLES
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
    `, [getMysqlConfig().database, tableName]);
    return rows.length > 0;
}

async function addColumnIfMissing(conn, log, tableName, columnName, columnDef) {
    if (await hasColumn(conn, tableName, columnName)) return;
    log(`[migrate-media-lifecycle] Adding ${tableName}.${columnName}...`);
    await conn.query(`ALTER TABLE ${tableName} ADD COLUMN ${columnDef}`);
}

async function addIndexIfMissing(conn, log, tableName, indexName, columnExpr) {
    if (await hasIndex(conn, tableName, indexName)) return;
    log(`[migrate-media-lifecycle] Creating ${indexName}...`);
    await conn.query(`CREATE INDEX ${indexName} ON ${tableName}(${columnExpr})`);
}

async function runMigration({ silent = false } = {}) {
    const log = silent ? () => {} : (...args) => console.log(...args);
    log('[migrate-media-lifecycle] Starting...');
    const conn = await mysql.createConnection(getMysqlConfig());

    try {
        // 1) media_assets 新列
        await addColumnIfMissing(conn, log, 'media_assets', 'storage_tier',
            `storage_tier VARCHAR(16) NOT NULL DEFAULT 'hot' COMMENT 'hot|warm|cold|deleted'`);
        await addColumnIfMissing(conn, log, 'media_assets', 'original_size',
            `original_size BIGINT NULL COMMENT '压缩前原始大小'`);
        await addColumnIfMissing(conn, log, 'media_assets', 'compressed_at',
            `compressed_at DATETIME NULL COMMENT '压缩完成时间'`);
        await addColumnIfMissing(conn, log, 'media_assets', 'deleted_at',
            `deleted_at DATETIME NULL COMMENT '软删除时间'`);
        await addColumnIfMissing(conn, log, 'media_assets', 'cleanup_job_id',
            `cleanup_job_id BIGINT NULL COMMENT 'FK to cleanup_jobs.id'`);

        // media_assets 新索引
        await addIndexIfMissing(conn, log, 'media_assets', 'idx_media_assets_storage_tier', 'storage_tier');
        await addIndexIfMissing(conn, log, 'media_assets', 'idx_media_assets_deleted_at', 'deleted_at');
        await addIndexIfMissing(conn, log, 'media_assets', 'idx_media_assets_cleanup_job', 'cleanup_job_id');
        await addIndexIfMissing(conn, log, 'media_assets', 'idx_media_assets_created_at', 'created_at');

        // 2) cleanup_jobs 表
        if (!(await hasTable(conn, 'cleanup_jobs'))) {
            log('[migrate-media-lifecycle] Creating cleanup_jobs...');
            await conn.query(`
                CREATE TABLE cleanup_jobs (
                    id                  BIGINT AUTO_INCREMENT PRIMARY KEY,
                    job_type            VARCHAR(32) NOT NULL COMMENT "'retention'|'manual'|'purge'",
                    retention_days      INT NULL COMMENT '保留天数（retention 类型）',
                    status              VARCHAR(16) NOT NULL DEFAULT 'running' COMMENT 'running|completed|failed',
                    total_candidates    INT NOT NULL DEFAULT 0,
                    candidates_checked  INT NOT NULL DEFAULT 0,
                    candidates_deleted  INT NOT NULL DEFAULT 0,
                    candidates_skipped  INT NOT NULL DEFAULT 0,
                    started_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    completed_at        DATETIME NULL,
                    triggered_by        VARCHAR(64) NOT NULL DEFAULT 'system' COMMENT "'system'|'cron'|'manual'|'script'",
                    triggered_by_user   VARCHAR(64) NULL,
                    note                TEXT NULL,
                    error_message       TEXT NULL
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
            `);
        } else {
            log('[migrate-media-lifecycle] cleanup_jobs already exists, skipping');
        }
        await addIndexIfMissing(conn, log, 'cleanup_jobs', 'idx_cleanup_jobs_status', 'status');
        await addIndexIfMissing(conn, log, 'cleanup_jobs', 'idx_cleanup_jobs_started', 'started_at DESC');

        // 3) cleanup_exemptions 表
        if (!(await hasTable(conn, 'cleanup_exemptions'))) {
            log('[migrate-media-lifecycle] Creating cleanup_exemptions...');
            await conn.query(`
                CREATE TABLE cleanup_exemptions (
                    id                  BIGINT AUTO_INCREMENT PRIMARY KEY,
                    media_asset_id      BIGINT NOT NULL,
                    exempted_by         VARCHAR(64) NOT NULL,
                    exemption_reason    VARCHAR(255) NOT NULL,
                    exempted_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    expires_at          DATETIME NULL COMMENT 'NULL = 永久豁免',
                    created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (media_asset_id) REFERENCES media_assets(id) ON DELETE CASCADE
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
            `);
        } else {
            log('[migrate-media-lifecycle] cleanup_exemptions already exists, skipping');
        }
        if (!(await hasIndex(conn, 'cleanup_exemptions', 'idx_exemptions_asset'))) {
            log('[migrate-media-lifecycle] Creating idx_exemptions_asset (UNIQUE)...');
            await conn.query(`CREATE UNIQUE INDEX idx_exemptions_asset ON cleanup_exemptions(media_asset_id)`);
        }
        await addIndexIfMissing(conn, log, 'cleanup_exemptions', 'idx_exemptions_expiry', 'expires_at');

        log('[migrate-media-lifecycle] Done.');
    } finally {
        await conn.end();
    }
}

module.exports = { run: runMigration };

if (require.main === module) {
    require('dotenv').config();
    runMigration().then(() => process.exit(0)).catch((err) => {
        console.error('[migrate-media-lifecycle] Error:', err.message);
        process.exit(1);
    });
}
