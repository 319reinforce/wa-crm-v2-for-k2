/**
 * migrate-message-hash.js
 * 为 wa_messages 添加 message_hash，并将去重索引从 (creator_id, timestamp) 升级为 (creator_id, message_hash)
 *
 * 使用方法：
 *   node migrate-message-hash.js
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
    console.log('[migrate-message-hash] Starting...');
    const conn = await mysql.createConnection(MYSQL_CONFIG);

    try {
        const messageHashExists = await hasColumn(conn, 'wa_messages', 'message_hash');
        if (!messageHashExists) {
            console.log('[migrate-message-hash] Adding wa_messages.message_hash...');
            await conn.query(`
                ALTER TABLE wa_messages
                ADD COLUMN message_hash VARCHAR(64) NULL COMMENT 'SHA256(role|text|timestamp_ms)'
            `);
        }

        console.log('[migrate-message-hash] Backfilling message_hash...');
        await conn.query(`
            UPDATE wa_messages
            SET message_hash = SHA2(CONCAT(COALESCE(role, ''), '|', COALESCE(text, ''), '|', COALESCE(timestamp, '')), 256)
            WHERE message_hash IS NULL OR message_hash = ''
        `);

        const oldIndexExists = await hasIndex(conn, 'wa_messages', 'idx_messages_dedup');
        if (oldIndexExists) {
            console.log('[migrate-message-hash] Dropping old idx_messages_dedup...');
            await conn.query('DROP INDEX idx_messages_dedup ON wa_messages');
        }

        const newIndexExists = await hasIndex(conn, 'wa_messages', 'idx_messages_dedup_hash');
        if (!newIndexExists) {
            console.log('[migrate-message-hash] Creating idx_messages_dedup_hash...');
            await conn.query(`
                CREATE UNIQUE INDEX idx_messages_dedup_hash
                ON wa_messages (creator_id, message_hash)
            `);
        }

        console.log('[migrate-message-hash] Done.');
    } finally {
        await conn.end();
    }
}

main().catch((err) => {
    console.error('[migrate-message-hash] Error:', err.message);
    process.exit(1);
});
