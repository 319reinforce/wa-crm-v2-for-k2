/**
 * migrate-wa-messages-proto.js
 * 为 wa_messages 增加 Baileys proto 持久化字段，支持 getMessage 回调跨重启可靠。
 *
 * 新增字段：
 *   proto_bytes   LONGBLOB NULL   — Baileys proto.IMessage 原始字节
 *   proto_driver  VARCHAR(16) NULL — 'baileys' | NULL（仅 baileys driver 写入）
 *
 * 幂等：通过 INFORMATION_SCHEMA 检测存在性。
 *
 * 使用方法：
 *   node migrate-wa-messages-proto.js
 *   // 或由 server/index.cjs 启动时自动调用 run({ silent: true })
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

async function runMigration({ silent = false } = {}) {
    const log = silent ? () => {} : (...args) => console.log(...args);
    log('[migrate-wa-messages-proto] Starting...');
    const conn = await mysql.createConnection(getMysqlConfig());

    try {
        const protoBytesExists = await hasColumn(conn, 'wa_messages', 'proto_bytes');
        const protoDriverExists = await hasColumn(conn, 'wa_messages', 'proto_driver');

        if (!protoBytesExists) {
            log('[migrate-wa-messages-proto] Adding proto_bytes LONGBLOB...');
            await conn.query(`
                ALTER TABLE wa_messages
                ADD COLUMN proto_bytes LONGBLOB NULL
                COMMENT 'Baileys proto.IMessage 原始字节（仅 baileys driver）'
            `);
        } else {
            log('[migrate-wa-messages-proto] proto_bytes already exists, skipping');
        }

        if (!protoDriverExists) {
            log('[migrate-wa-messages-proto] Adding proto_driver VARCHAR(16)...');
            await conn.query(`
                ALTER TABLE wa_messages
                ADD COLUMN proto_driver VARCHAR(16) NULL
                COMMENT 'proto 来源 driver: baileys | NULL'
            `);
        } else {
            log('[migrate-wa-messages-proto] proto_driver already exists, skipping');
        }

        const idxExists = await hasIndex(conn, 'wa_messages', 'idx_messages_proto_driver');
        if (!idxExists) {
            log('[migrate-wa-messages-proto] Creating idx_messages_proto_driver...');
            await conn.query(`CREATE INDEX idx_messages_proto_driver ON wa_messages(proto_driver)`);
        } else {
            log('[migrate-wa-messages-proto] idx_messages_proto_driver already exists, skipping');
        }

        log('[migrate-wa-messages-proto] Done.');
    } finally {
        await conn.end();
    }
}

module.exports = { run: runMigration };

if (require.main === module) {
    require('dotenv').config();
    runMigration().then(() => process.exit(0)).catch((err) => {
        console.error('[migrate-wa-messages-proto] Error:', err.message);
        process.exit(1);
    });
}
