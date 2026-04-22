/**
 * 幂等迁移：为 wa_messages 表新增 wa_message_id 列 + (wa_message_id, creator_id) 组合 UNIQUE。
 *
 * 目的：用 WhatsApp 原生 message.id._serialized + creator_id 作为幂等键。
 *
 * 历史：早期版本建的是全表 UNIQUE (wa_message_id)，多 session 场景下
 * （两端同时观察到同一全局 messageId）会把后到的那条 INSERT IGNORE 静默 drop。
 * 组合键允许同一消息在不同 creator 视角下各留一份。
 *
 * 迁移会执行：
 *   1. 如果列不存在 → ADD COLUMN
 *   2. 如果存在旧的单列 UNIQUE `uk_wa_message_id` → DROP
 *   3. 如果组合 UNIQUE `uk_wa_message_id_creator` 不存在 → ADD
 */

const db = require('./db');

const COLUMN_NAME = 'wa_message_id';
const OLD_INDEX_NAME = 'uk_wa_message_id';
const NEW_INDEX_NAME = 'uk_wa_message_id_creator';

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

    const hasOldIndex = await indexExists(conn, 'wa_messages', OLD_INDEX_NAME);
    if (hasOldIndex) {
        await conn.prepare(`ALTER TABLE wa_messages DROP INDEX ${OLD_INDEX_NAME}`).run();
        if (!silent) console.log(`[migrate-wa-message-id] dropped legacy single-column unique ${OLD_INDEX_NAME}`);
    }

    const hasNewIndex = await indexExists(conn, 'wa_messages', NEW_INDEX_NAME);
    if (!hasNewIndex) {
        await conn.prepare(
            `ALTER TABLE wa_messages ADD UNIQUE KEY ${NEW_INDEX_NAME} (${COLUMN_NAME}, creator_id)`
        ).run();
        if (!silent) console.log(`[migrate-wa-message-id] added composite unique index ${NEW_INDEX_NAME} (wa_message_id, creator_id)`);
    }

    if (hasColumn && hasNewIndex && !hasOldIndex && !silent) {
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
