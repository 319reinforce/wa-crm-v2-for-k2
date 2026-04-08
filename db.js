/**
 * SQLite 数据库操作库
 * WA CRM v2
 */

const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, 'crm.db');
let db = null;

// 获取数据库连接
function getDb() {
    if (!db) {
        db = new Database(DB_PATH);
        db.pragma('journal_mode = WAL');
    }
    return db;
}

// 关闭数据库连接
function closeDb() {
    if (db) {
        db.close();
        db = null;
    }
}

// ================== Creator 操作 ==================

// 获取或创建 creator
function getOrCreateCreator(phone, name, source = 'wa') {
    const db = getDb();

    // 尝试查找已存在的
    const existing = db.prepare('SELECT id, primary_name FROM creators WHERE wa_phone = ?').get(phone);
    if (existing) {
        // 更新名字（只有传了 name 才更新）
        if (name) {
            db.prepare('UPDATE creators SET primary_name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
                .run(name, existing.id);
        }
        return existing.id;
    }

    // 创建新的
    const result = db.prepare(
        'INSERT INTO creators (primary_name, wa_phone, source) VALUES (?, ?, ?)'
    ).run(name || 'Unknown', phone, source);

    return result.lastInsertRowid;
}

// 根据多种方式查找 creator
function findCreator(query) {
    const db = getDb();

    // 1. 按 phone 查找
    if (query.phone) {
        const byPhone = db.prepare('SELECT id FROM creators WHERE wa_phone = ?').get(query.phone);
        if (byPhone) return byPhone.id;
    }

    // 2. 按 keeper_username 查找
    if (query.keeper_username) {
        const byKeeper = db.prepare('SELECT id FROM creators WHERE keeper_username = ?').get(query.keeper_username);
        if (byKeeper) return byKeeper.id;
    }

    // 3. 按别名查找
    if (query.alias_type && query.alias_value) {
        const byAlias = db.prepare(
            'SELECT creator_id FROM creator_aliases WHERE alias_type = ? AND alias_value = ?'
        ).get(query.alias_type, query.alias_value);
        if (byAlias) return byAlias.creator_id;
    }

    return null;
}

// 更新 creator 信息
function updateCreator(id, updates) {
    const db = getDb();
    const allowed = ['primary_name', 'keeper_username', 'wa_owner', 'is_active'];
    const fields = [];
    const values = [];

    for (const [key, value] of Object.entries(updates)) {
        if (allowed.includes(key)) {
            fields.push(`${key} = ?`);
            values.push(value);
        }
    }

    if (fields.length === 0) return;

    values.push(id);
    db.prepare(`UPDATE creators SET ${fields.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(...values);
}

// 添加别名
function addAlias(creatorId, aliasType, aliasValue, verified = false) {
    const db = getDb();
    try {
        db.prepare(
            'INSERT OR IGNORE INTO creator_aliases (creator_id, alias_type, alias_value, is_verified) VALUES (?, ?, ?, ?)'
        ).run(creatorId, aliasType, aliasValue, verified ? 1 : 0);
    } catch (e) {
        // 忽略重复别名错误
    }
}

// ================== 消息操作 ==================

// 插入单条消息
function insertMessage(creatorId, role, text, timestamp) {
    const db = getDb();
    db.prepare(
        'INSERT INTO wa_messages (creator_id, role, text, timestamp) VALUES (?, ?, ?, ?)'
    ).run(creatorId, role, text, timestamp);
}

// 批量插入消息（自动去重）
function insertMessagesBatch(creatorId, messages) {
    const db = getDb();

    // 预查已有 timestamp，避免重复插入
    const existing = db.prepare(
        'SELECT timestamp FROM wa_messages WHERE creator_id = ?'
    ).all(creatorId);
    const existingTimestamps = new Set(existing.map(r => r.timestamp));

    const filtered = messages.filter(m => !existingTimestamps.has(m.timestamp));
    if (filtered.length === 0) return;

    const insert = db.prepare(
        'INSERT INTO wa_messages (creator_id, role, text, timestamp) VALUES (?, ?, ?, ?)'
    );

    const insertMany = db.transaction((msgs) => {
        for (const msg of msgs) {
            insert.run(creatorId, msg.role, msg.text, msg.timestamp);
        }
    });

    insertMany(filtered);
}

// 获取消息数量
function getMessageCount(creatorId) {
    const db = getDb();
    const result = db.prepare('SELECT COUNT(*) as count FROM wa_messages WHERE creator_id = ?').get(creatorId);
    return result.count;
}

// 获取最后一条消息
function getLastMessage(creatorId) {
    const db = getDb();
    return db.prepare(
        'SELECT * FROM wa_messages WHERE creator_id = ? ORDER BY timestamp DESC LIMIT 1'
    ).get(creatorId);
}

// ================== WA CRM 数据操作 ==================

// 获取或创建 WA CRM 数据
function getOrCreateWacrm(creatorId) {
    const db = getDb();
    let wacrm = db.prepare('SELECT * FROM wa_crm_data WHERE creator_id = ?').get(creatorId);

    if (!wacrm) {
        db.prepare(
            'INSERT INTO wa_crm_data (creator_id) VALUES (?)'
        ).run(creatorId);
        wacrm = db.prepare('SELECT * FROM wa_crm_data WHERE creator_id = ?').get(creatorId);
    }

    return wacrm;
}

// 更新 WA CRM 数据
function updateWacrm(creatorId, updates) {
    const db = getDb();
    const fields = Object.keys(updates);
    if (fields.length === 0) return;

    const setClause = fields.map(f => `${f} = ?`).join(', ');
    const values = [...Object.values(updates), creatorId];

    db.prepare(`UPDATE wa_crm_data SET ${setClause}, updated_at = CURRENT_TIMESTAMP WHERE creator_id = ?`).run(...values);
}

// ================== 查询 ==================

// 获取所有 creators（带统计）
function getAllCreators(filters = {}) {
    const db = getDb();

    let sql = `
        SELECT
            c.id,
            c.primary_name,
            c.wa_phone,
            c.keeper_username,
            c.wa_owner,
            c.source,
            c.is_active,
            c.created_at,
            c.updated_at,
            COUNT(wm.id) as msg_count,
            MAX(wm.timestamp) as last_active
        FROM creators c
        LEFT JOIN wa_messages wm ON wm.creator_id = c.id
        WHERE 1=1
    `;

    const params = [];

    if (filters.wa_owner) {
        sql += ' AND c.wa_owner = ?';
        params.push(filters.wa_owner);
    }

    if (filters.is_active !== undefined) {
        sql += ' AND c.is_active = ?';
        params.push(filters.is_active ? 1 : 0);
    }

    sql += ' GROUP BY c.id ORDER BY msg_count DESC';

    return db.prepare(sql).all(...params);
}

// 获取单个 creator 完整信息
function getCreatorFull(creatorId) {
    const db = getDb();

    const creator = db.prepare('SELECT * FROM creators WHERE id = ?').get(creatorId);
    if (!creator) return null;

    const messages = db.prepare(
        'SELECT * FROM wa_messages WHERE creator_id = ? ORDER BY timestamp ASC'
    ).all(creatorId);

    const wacrm = db.prepare('SELECT * FROM wa_crm_data WHERE creator_id = ?').get(creatorId);

    const aliases = db.prepare(
        'SELECT * FROM creator_aliases WHERE creator_id = ?'
    ).all(creatorId);

    const joinbrands = db.prepare('SELECT * FROM joinbrands_link WHERE creator_id = ?').get(creatorId) || null;

    return {
        ...creator,
        messages,
        wacrm,
        aliases,
        joinbrands
    };
}

module.exports = {
    getDb,
    closeDb,
    getOrCreateCreator,
    findCreator,
    updateCreator,
    addAlias,
    insertMessage,
    insertMessagesBatch,
    getMessageCount,
    getLastMessage,
    getOrCreateWacrm,
    updateWacrm,
    getAllCreators,
    getCreatorFull
};
