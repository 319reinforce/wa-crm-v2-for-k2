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

// ***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED*** Creator 操作 ***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED***

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

    if (fields.length ***REMOVED***= 0) return;

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

// ***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED*** 消息操作 ***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED***

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
    if (filtered.length ***REMOVED***= 0) return;

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

// ***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED*** WA CRM 数据操作 ***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED***

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
    if (fields.length ***REMOVED***= 0) return;

    const setClause = fields.map(f => `${f} = ?`).join(', ');
    const values = [...Object.values(updates), creatorId];

    db.prepare(`UPDATE wa_crm_data SET ${setClause}, updated_at = CURRENT_TIMESTAMP WHERE creator_id = ?`).run(...values);
}

// ***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED*** 查询 ***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED***

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

    if (filters.is_active !***REMOVED*** undefined) {
        sql += ' AND c.is_active = ?';
        params.push(filters.is_active ? 1 : 0);
    }

    sql += ' GROUP BY c.id ORDER BY msg_count DESC';

    return db.prepare(sql).all(...params);
}

// 获取单个 creator 完整信息（优化：合并为 2 次查询）
function getCreatorFull(creatorId) {
    const db = getDb();

    // Query 1: creators + wacrm + joinbrands（通过 LEFT JOIN 合并）
    const row = db.prepare(`
        SELECT c.*,
               wc.priority as wc_priority,
               wc.beta_status as wc_beta_status,
               wc.monthly_fee_status,
               wc.monthly_fee_amount,
               wc.monthly_fee_deducted,
               wc.agency_bound,
               wc.agency_bound_at,
               wc.agency_deadline,
               wc.video_count,
               wc.video_target,
               wc.video_last_checked,
               wc.event_score,
               wc.urgency_level,
               j.keeper_username as jb_keeper_username,
               j.keeper_gmv as jb_keeper_gmv,
               j.keeper_gmv30,
               j.keeper_orders,
               j.keeper_videos,
               j.keeper_videos_posted,
               j.keeper_videos_sold,
               j.keeper_card_rate,
               j.keeper_order_rate,
               j.keeper_reg_time,
               j.keeper_activate_time,
               j.ev_joined,
               j.ev_ready_sent,
               j.ev_trial_7day,
               j.ev_monthly_invited,
               j.ev_monthly_joined,
               j.ev_whatsapp_shared,
               j.ev_gmv_1k,
               j.ev_gmv_3k,
               j.ev_gmv_10k,
               j.ev_churned
        FROM creators c
        LEFT JOIN wa_crm_data wc ON wc.creator_id = c.id
        LEFT JOIN joinbrands_link j ON j.creator_id = c.id
        WHERE c.id = ?
    `).get(creatorId);

    if (!row) return null;

    // 重构为旧格式，保持调用方兼容
    const creator = { id: row.id, primary_name: row.primary_name, wa_phone: row.wa_phone,
        keeper_username: row.keeper_username, wa_owner: row.wa_owner, source: row.source,
        is_active: row.is_active, created_at: row.created_at, updated_at: row.updated_at };

    const wacrm = (row.wc_priority !***REMOVED*** undefined) ? {
        priority: row.wc_priority, beta_status: row.wc_beta_status, monthly_fee_status: row.monthly_fee_status,
        monthly_fee_amount: row.monthly_fee_amount, monthly_fee_deducted: row.monthly_fee_deducted,
        agency_bound: row.agency_bound, agency_bound_at: row.agency_bound_at, agency_deadline: row.agency_deadline,
        video_count: row.video_count, video_target: row.video_target, video_last_checked: row.video_last_checked,
        event_score: row.event_score, urgency_level: row.urgency_level
    } : null;

    const joinbrands = (row.ev_joined !***REMOVED*** undefined) ? {
        keeper_username: row.jb_keeper_username, keeper_gmv: row.jb_keeper_gmv, keeper_gmv30: row.keeper_gmv30,
        keeper_orders: row.keeper_orders, keeper_videos: row.keeper_videos,
        keeper_videos_posted: row.keeper_videos_posted, keeper_videos_sold: row.keeper_videos_sold,
        keeper_card_rate: row.keeper_card_rate, keeper_order_rate: row.keeper_order_rate,
        keeper_reg_time: row.keeper_reg_time, keeper_activate_time: row.keeper_activate_time,
        ev_joined: row.ev_joined, ev_ready_sent: row.ev_ready_sent, ev_trial_7day: row.ev_trial_7day,
        ev_monthly_invited: row.ev_monthly_invited, ev_monthly_joined: row.ev_monthly_joined,
        ev_whatsapp_shared: row.ev_whatsapp_shared, ev_gmv_1k: row.ev_gmv_1k,
        ev_gmv_3k: row.ev_gmv_3k, ev_gmv_10k: row.ev_gmv_10k, ev_churned: row.ev_churned
    } : null;

    // Query 2: messages（单独查，消息量大不宜 JOIN）
    const messages = db.prepare(
        'SELECT * FROM wa_messages WHERE creator_id = ? ORDER BY timestamp ASC'
    ).all(creatorId);

    // Query 3: aliases
    const aliases = db.prepare(
        'SELECT * FROM creator_aliases WHERE creator_id = ?'
    ).all(creatorId);

    return { ...creator, messages, wacrm, aliases, joinbrands };
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
