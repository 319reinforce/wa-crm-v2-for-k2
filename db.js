/**
 * MySQL 数据库操作库
 * WA CRM v2
 * 迁移自 better-sqlite3 → mysql2 + deasync（同步封装）
 * 对外接口与 SQLite 版本完全一致（prepare/get/all/run/transaction）
 */

const mysql = require('mysql2');
const deasync = require('deasync');
const path = require('path');

const DB_CONFIG = {
    host: process.env.DB_HOST || '127.0.0.1',
    port: parseInt(process.env.DB_PORT || '3306'),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'wa_crm_v2',
    charset: 'utf8mb4',
    timezone: '+08:00',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    enableKeepAlive: true,
    keepAliveInitialDelay: 0,
};

let pool = null;

function getPool() {
    if (!pool) {
        pool = mysql.createPool(DB_CONFIG);
    }
    return pool;
}

// 关闭连接池
function closeDb() {
    if (pool) {
        pool.end();
        pool = null;
    }
}

// ***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED*** 同步执行封装 ***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED***

// 用 deasync 把 Promise 转成同步返回值（阻塞事件循环，模拟 better-sqlite3）
function syncQuery(sql, params = []) {
    const p = getPool();
    let done = false;
    let result = null;
    let err = null;
    p.query(sql, params, (e, r) => { err = e; result = r; done = true; });
    // 轮询直到完成（deasync 方式）
    while (!done) { deasync.runLoopOnce(); }
    if (err) throw err;
    return result;
}

// 同步执行（单行）
function syncQueryOne(sql, params = []) {
    const rows = syncQuery(sql, params);
    return rows[0] || null;
}

// ***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED*** SQLite 接口兼容层 ***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED***

// SQLite → MySQL 结果格式适配
function toSqliteFormat(result) {
    return {
        lastInsertRowid: result.insertId || 0,
        changes: result.affectedRows || 0,
    };
}

const db = {
    prepare(sql) {
        return {
            get(...params) {
                return syncQueryOne(sql, params);
            },
            all(...params) {
                return syncQuery(sql, params);
            },
            run(...params) {
                const r = syncQuery(sql, params);
                return toSqliteFormat(r);
            },
        };
    },

    transaction(fn) {
        const p = getPool();
        let done = false;
        let txErr = null;
        p.getConnection((err, conn) => {
            if (err) { txErr = err; done = true; return; }
            conn.beginTransaction((err) => {
                if (err) { txErr = err; done = true; conn.release(); return; }
                try {
                    const txDb = {
                        prepare(sql) {
                            return {
                                get(...params) {
                                    let gDone = false;
                                    let gResult = null;
                                    let gErr = null;
                                    conn.query(sql, params, (e, r) => { gErr = e; gResult = r && r[0] || null; gDone = true; });
                                    while (!gDone) { deasync.runLoopOnce(); }
                                    if (gErr) throw gErr;
                                    return gResult;
                                },
                                all(...params) {
                                    let aDone = false;
                                    let aResult = null;
                                    let aErr = null;
                                    conn.query(sql, params, (e, r) => { aErr = e; aResult = r; aDone = true; });
                                    while (!aDone) { deasync.runLoopOnce(); }
                                    if (aErr) throw aErr;
                                    return aResult;
                                },
                                run(...params) {
                                    let rDone = false;
                                    let rResult = null;
                                    let rErr = null;
                                    conn.query(sql, params, (e, r) => { rErr = e; rResult = r; rDone = true; });
                                    while (!rDone) { deasync.runLoopOnce(); }
                                    if (rErr) throw rErr;
                                    return toSqliteFormat(rResult);
                                },
                            };
                        },
                    };
                    const result = fn(txDb);
                    conn.commit((err) => {
                        if (err) { conn.rollback(); conn.release(); txErr = err; }
                        conn.release();
                        done = true;
                    });
                } catch (e) {
                    conn.rollback(() => { conn.release(); txErr = e; });
                    done = true;
                }
            });
        });
        while (!done) { deasync.runLoopOnce(); }
        if (txErr) throw txErr;
    },
};

// ***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED*** Creator 操作 ***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED***

function getOrCreateCreator(phone, name, source = 'wa') {
    const existing = db.prepare('SELECT id, primary_name FROM creators WHERE wa_phone = ?').get(phone);
    if (existing) {
        if (name) {
            db.prepare('UPDATE creators SET primary_name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
                .run(name, existing.id);
        }
        return existing.id;
    }
    const result = db.prepare(
        'INSERT INTO creators (primary_name, wa_phone, source) VALUES (?, ?, ?)'
    ).run(name || 'Unknown', phone, source);
    return result.lastInsertRowid;
}

function findCreator(query) {
    if (query.phone) {
        const byPhone = db.prepare('SELECT id FROM creators WHERE wa_phone = ?').get(query.phone);
        if (byPhone) return byPhone.id;
    }
    if (query.keeper_username) {
        const byKeeper = db.prepare('SELECT id FROM creators WHERE keeper_username = ?').get(query.keeper_username);
        if (byKeeper) return byKeeper.id;
    }
    if (query.alias_type && query.alias_value) {
        const byAlias = db.prepare(
            'SELECT creator_id FROM creator_aliases WHERE alias_type = ? AND alias_value = ?'
        ).get(query.alias_type, query.alias_value);
        if (byAlias) return byAlias.creator_id;
    }
    return null;
}

function updateCreator(id, updates) {
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

function addAlias(creatorId, aliasType, aliasValue, verified = false) {
    try {
        db.prepare(
            'INSERT IGNORE INTO creator_aliases (creator_id, alias_type, alias_value, is_verified) VALUES (?, ?, ?, ?)'
        ).run(creatorId, aliasType, aliasValue, verified ? 1 : 0);
    } catch (e) {
        // 忽略重复别名错误
    }
}

// ***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED*** 消息操作 ***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED***

function insertMessage(creatorId, role, text, timestamp) {
    db.prepare(
        'INSERT INTO wa_messages (creator_id, role, text, timestamp) VALUES (?, ?, ?, ?)'
    ).run(creatorId, role, text, timestamp);
}

function insertMessagesBatch(creatorId, messages) {
    const existing = db.prepare(
        'SELECT timestamp FROM wa_messages WHERE creator_id = ?'
    ).all(creatorId);
    const existingTimestamps = new Set(existing.map(r => r.timestamp));
    const filtered = messages.filter(m => !existingTimestamps.has(m.timestamp));
    if (filtered.length ***REMOVED***= 0) return;

    db.transaction(async (txDb) => {
        const insert = txDb.prepare(
            'INSERT INTO wa_messages (creator_id, role, text, timestamp) VALUES (?, ?, ?, ?)'
        );
        for (const msg of filtered) {
            insert.run(creatorId, msg.role, msg.text, msg.timestamp);
        }
    });
}

function getMessageCount(creatorId) {
    const result = db.prepare('SELECT COUNT(*) as count FROM wa_messages WHERE creator_id = ?').get(creatorId);
    return result ? result.count : 0;
}

function getLastMessage(creatorId) {
    return db.prepare(
        'SELECT * FROM wa_messages WHERE creator_id = ? ORDER BY timestamp DESC LIMIT 1'
    ).get(creatorId);
}

// ***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED*** WA CRM 数据操作 ***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED***

function getOrCreateWacrm(creatorId) {
    let wacrm = db.prepare('SELECT * FROM wa_crm_data WHERE creator_id = ?').get(creatorId);
    if (!wacrm) {
        db.prepare('INSERT INTO wa_crm_data (creator_id) VALUES (?)').run(creatorId);
        wacrm = db.prepare('SELECT * FROM wa_crm_data WHERE creator_id = ?').get(creatorId);
    }
    return wacrm;
}

function updateWacrm(creatorId, updates) {
    const fields = Object.keys(updates);
    if (fields.length ***REMOVED***= 0) return;
    const setClause = fields.map(f => `${f} = ?`).join(', ');
    const values = [...Object.values(updates), creatorId];
    db.prepare(`UPDATE wa_crm_data SET ${setClause}, updated_at = CURRENT_TIMESTAMP WHERE creator_id = ?`).run(...values);
}

// ***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED*** 查询 ***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED***

function getAllCreators(filters = {}) {
    let sql = `
        SELECT
            c.id, c.primary_name, c.wa_phone, c.keeper_username, c.wa_owner,
            c.source, c.is_active, c.created_at, c.updated_at,
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

function getCreatorFull(creatorId) {
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
               j.creator_name_jb,
               j.jb_gmv,
               j.jb_status,
               j.ev_joined,
               j.ev_ready_sent,
               j.ev_trial_active,
               j.ev_monthly_started,
               j.ev_monthly_joined,
               j.ev_whatsapp_shared,
               j.ev_gmv_1k,
               j.ev_gmv_2k,
               j.ev_gmv_5k,
               j.ev_gmv_10k,
               j.ev_agency_bound,
               j.ev_churned
        FROM creators c
        LEFT JOIN wa_crm_data wc ON wc.creator_id = c.id
        LEFT JOIN joinbrands_link j ON j.creator_id = c.id
        WHERE c.id = ?
    `).get(creatorId);

    if (!row) return null;

    const creator = {
        id: row.id, primary_name: row.primary_name, wa_phone: row.wa_phone,
        keeper_username: row.keeper_username, wa_owner: row.wa_owner, source: row.source,
        is_active: row.is_active, created_at: row.created_at, updated_at: row.updated_at
    };

    const wacrm = (row.wc_priority !***REMOVED*** undefined) ? {
        priority: row.wc_priority, beta_status: row.wc_beta_status,
        monthly_fee_status: row.monthly_fee_status, monthly_fee_amount: row.monthly_fee_amount,
        monthly_fee_deducted: row.monthly_fee_deducted, agency_bound: row.agency_bound,
        agency_bound_at: row.agency_bound_at, agency_deadline: row.agency_deadline,
        video_count: row.video_count, video_target: row.video_target,
        video_last_checked: row.video_last_checked, event_score: row.event_score,
        urgency_level: row.urgency_level
    } : null;

    const joinbrands = (row.ev_joined !***REMOVED*** undefined) ? {
        keeper_username: row.creator_name_jb, keeper_gmv: row.jb_gmv, jb_status: row.jb_status,
        ev_joined: row.ev_joined, ev_ready_sent: row.ev_ready_sent,
        ev_trial_active: row.ev_trial_active, ev_monthly_started: row.ev_monthly_started,
        ev_monthly_joined: row.ev_monthly_joined, ev_whatsapp_shared: row.ev_whatsapp_shared,
        ev_gmv_1k: row.ev_gmv_1k, ev_gmv_2k: row.ev_gmv_2k,
        ev_gmv_5k: row.ev_gmv_5k, ev_gmv_10k: row.ev_gmv_10k,
        ev_agency_bound: row.ev_agency_bound, ev_churned: row.ev_churned
    } : null;

    const messages = db.prepare(
        'SELECT * FROM wa_messages WHERE creator_id = ? ORDER BY timestamp ASC'
    ).all(creatorId);
    const aliases = db.prepare(
        'SELECT * FROM creator_aliases WHERE creator_id = ?'
    ).all(creatorId);
    const keeperRow = db.prepare(
        'SELECT keeper_gmv, keeper_gmv30, keeper_orders, keeper_videos, keeper_videos_posted, keeper_videos_sold, keeper_card_rate, keeper_order_rate, keeper_reg_time, keeper_activate_time FROM keeper_link WHERE creator_id = ?'
    ).get(creatorId);

    return { ...creator, messages, wacrm, aliases, joinbrands, keeper: keeperRow || null };
}

module.exports = {
    getDb: () => db,
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
    getCreatorFull,
};
