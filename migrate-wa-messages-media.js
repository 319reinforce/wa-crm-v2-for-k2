/**
 * migrate-wa-messages-media.js
 * 为 wa_messages 添加媒体相关字段，支持存储 incoming 媒体消息
 *
 * 支持类型：图片（jpeg/png/webp/gif）+ 视频（mp4/mov/webm/3gp）
 *          + 音频（ogg/mp3/wav/opus）+ PDF
 *
 * 新增字段：
 *   media_asset_id, media_type, media_mime, media_size,
 *   media_width, media_height, media_caption, media_thumbnail,
 *   media_download_status, updated_at
 *
 * 使用方法：
 *   node migrate-wa-messages-media.js
 */
require('dotenv').config();
const mysql = require('mysql2/promise');

const MYSQL_CONFIG = {
    host: process.env.DB_HOST || '127.0.0.1',
    port: parseInt(process.env.DB_PORT || '3306', 10),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'wa_crm_v2',
    timezone: '+08:00',
};

async function hasColumn(conn, tableName, columnName) {
    const [rows] = await conn.query(`
        SELECT COLUMN_NAME
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?
    `, [MYSQL_CONFIG.database, tableName, columnName]);
    return rows.length > 0;
}

async function hasIndex(conn, tableName, indexName) {
    const [rows] = await conn.query(`
        SELECT INDEX_NAME
        FROM INFORMATION_SCHEMA.STATISTICS
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND INDEX_NAME = ?
    `, [MYSQL_CONFIG.database, tableName, indexName]);
    return rows.length > 0;
}

async function main() {
    console.log('[migrate-wa-messages-media] Starting...');
    const conn = await mysql.createConnection(MYSQL_CONFIG);

    try {
        // 检查 updated_at 是否存在（updated_at 是最早添加的字段之一）
        const updatedAtExists = await hasColumn(conn, 'wa_messages', 'updated_at');

        if (!updatedAtExists) {
            console.log('[migrate-wa-messages-media] Adding updated_at...');
            await conn.query(`
                ALTER TABLE wa_messages
                ADD COLUMN updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            `);
        }

        const mediaAssetIdExists = await hasColumn(conn, 'wa_messages', 'media_asset_id');
        if (!mediaAssetIdExists) {
            console.log('[migrate-wa-messages-media] Adding media columns...');
            await conn.query(`
                ALTER TABLE wa_messages
                ADD COLUMN media_asset_id         BIGINT NULL COMMENT 'FK to media_assets.id',
                ADD COLUMN media_type             VARCHAR(32) NULL COMMENT 'image|video|audio|document',
                ADD COLUMN media_mime             VARCHAR(64) NULL COMMENT 'e.g. image/jpeg',
                ADD COLUMN media_size             BIGINT NULL COMMENT 'file size in bytes',
                ADD COLUMN media_width            INT NULL COMMENT 'image width in px',
                ADD COLUMN media_height          INT NULL COMMENT 'image height in px',
                ADD COLUMN media_caption          TEXT NULL COMMENT 'caption text (for media with caption)',
                ADD COLUMN media_thumbnail        TEXT NULL COMMENT 'base64 thumbnail for quick preview',
                ADD COLUMN media_download_status  VARCHAR(16) NULL COMMENT 'pending|success|failed'
            `);
        } else {
            console.log('[migrate-wa-messages-media] media columns already exist, skipping');
        }

        // 创建索引
        const idxAssetExists = await hasIndex(conn, 'wa_messages', 'idx_messages_media_asset');
        if (!idxAssetExists) {
            console.log('[migrate-wa-messages-media] Creating idx_messages_media_asset...');
            await conn.query(`CREATE INDEX idx_messages_media_asset ON wa_messages(media_asset_id)`);
        }

        const idxStatusExists = await hasIndex(conn, 'wa_messages', 'idx_messages_media_status');
        if (!idxStatusExists) {
            console.log('[migrate-wa-messages-media] Creating idx_messages_media_status...');
            await conn.query(`CREATE INDEX idx_messages_media_status ON wa_messages(media_download_status)`);
        }

        const idxTypeExists = await hasIndex(conn, 'wa_messages', 'idx_messages_media_type');
        if (!idxTypeExists) {
            console.log('[migrate-wa-messages-media] Creating idx_messages_media_type...');
            await conn.query(`CREATE INDEX idx_messages_media_type ON wa_messages(media_type)`);
        }

        console.log('[migrate-wa-messages-media] Done.');
    } finally {
        await conn.end();
    }
}

main().catch((err) => {
    console.error('[migrate-wa-messages-media] Error:', err.message);
    process.exit(1);
});
