/**
 * 幂等迁移：为 wa_messages 表新增 wa_message_id 列 + UNIQUE 索引。
 *
 * 目的：用 WhatsApp 原生 message.id._serialized 作为消息的幂等主键,
 * 替代原先以 (creator_id, message_hash) 为去重键的实现。
 *
 * 兼容：旧行 wa_message_id 为 NULL,UNIQUE 允许多 NULL,互不干扰。
 */

const db = require('./db');

const COLUMN_NAME = 'wa_message_id';
const INDEX_NAME = 'uk_wa_message_id';

async function columnExists(conn, tableName, columnName) {
    const rows = await conn.prepare(
        'SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?'
    ).all(tableName, columnName);
    return rows.length > 0;
}

async function indexExists(conn, tableName, indexName) {
    const rows = await conn.prepare(
        'SELECT INDEX_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?'
    ).all(tableName, indexName);
    return rows.length > 0;
}

async function run({ silent = false } = {}) {
    const conn = db.getDb();
    if (!conn) throw new Error('db connection not ready');

    const hasColumn = await columnExists(conn, 'wa_messages', COLUMN_NAME);
    if (!hasColumn) {
        await conn.prepare(
            `ALTER TABLE wa_messages ADD COLUMN ${COLUMN_NAME} VARCHAR(128) DEFAULT NULL COMMENT 'WhatsApp 原生 message id (Message.id._serialized)'`
        ).run();
        if (!silent) console.log(`[migrate-wa-message-id] added column ${COLUMN_NAME}`);
    }

    const hasIndex = await indexExists(conn, 'wa_messages', INDEX_NAME);
    if (!hasIndex) {
        await conn.prepare(
            `ALTER TABLE wa_messages ADD UNIQUE KEY ${INDEX_NAME} (${COLUMN_NAME})`
        ).run();
        if (!silent) console.log(`[migrate-wa-message-id] added unique index ${INDEX_NAME}`);
    }

    if (hasColumn && hasIndex && !silent) {
        console.log('[migrate-wa-message-id] already up to date');
    }
}

module.exports = { run };

if (require.main === module) {
    run()
        .then(() => process.exit(0))
        .catch((err) => {
            console.error('[migrate-wa-message-id] failed:', err.message);
            process.exit(1);
        });
}
