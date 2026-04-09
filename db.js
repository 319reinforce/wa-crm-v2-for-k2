/**
 * MySQL 数据库操作库
 * WA CRM v2
 * mysql2/promise 异步封装，async/await 接口
 * 对外接口与 better-sqlite3 版本一致（prepare/get/all/run/transaction）
 */
require('dotenv').config();
const mysql = require('mysql2/promise');

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
async function closeDb() {
    if (pool) {
        await pool.end();
        pool = null;
    }
}

// ***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED*** SQLite 接口兼容层 ***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED***

// MySQL → SQLite 结果格式适配
function toSqliteFormat(result) {
    return {
        lastInsertRowid: result.insertId || 0,
        changes: result.affectedRows || 0,
    };
}

const db = {
    prepare(sql) {
        return {
            get: async (...params) => {
                const [rows] = await getPool().execute(sql, params);
                return rows[0] || null;
            },
            all: async (...params) => {
                const [rows] = await getPool().execute(sql, params);
                return rows;
            },
            run: async (...params) => {
                const [result] = await getPool().execute(sql, params);
                return toSqliteFormat(result);
            },
        };
    },

    transaction: async (fn) => {
        const conn = await getPool().getConnection();
        await conn.beginTransaction();
        try {
            const txDb = {
                prepare(sql) {
                    return {
                        get: async (...params) => {
                            const [rows] = await conn.execute(sql, params);
                            return rows[0] || null;
                        },
                        all: async (...params) => {
                            const [rows] = await conn.execute(sql, params);
                            return rows;
                        },
                        run: async (...params) => {
                            const [result] = await conn.execute(sql, params);
                            return toSqliteFormat(result);
                        },
                    };
                },
            };
            const result = await fn(txDb);
            await conn.commit();
            return result;
        } catch (e) {
            await conn.rollback();
            throw e;
        } finally {
            conn.release();
        }
    },
};

// ***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED*** Creator 操作 ***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED***

async function getOrCreateCreator(phone, name, source = 'wa') {
    return await db.transaction(async (txDb) => {
        const existing = await txDb.prepare('SELECT id, primary_name FROM creators WHERE wa_phone = ?').get(phone);
        if (existing) {
            if (name) {
                await txDb.prepare('UPDATE creators SET primary_name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
                    .run(name, existing.id);
            }
            return existing.id;
        }
        const result = await txDb.prepare(
            'INSERT INTO creators (primary_name, wa_phone, source) VALUES (?, ?, ?)'
        ).run(name || 'Unknown', phone, source);
        return result.lastInsertRowid;
    });
}

async function findCreator(query) {
    if (query.phone) {
        return (await db.prepare('SELECT id FROM creators WHERE wa_phone = ?').get(query.phone))?.id || null;
    }
    if (query.keeper_username) {
        return (await db.prepare('SELECT id FROM creators WHERE keeper_username = ?').get(query.keeper_username))?.id || null;
    }
    if (query.alias_type && query.alias_value) {
        return (await db.prepare(
            'SELECT creator_id FROM creator_aliases WHERE alias_type = ? AND alias_value = ?'
        ).get(query.alias_type, query.alias_value))?.creator_id || null;
    }
    return null;
}

async function updateCreator(id, updates) {
    if (!updates || typeof updates !***REMOVED*** 'object') return;
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
    await db.prepare(`UPDATE creators SET ${fields.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(...values);
}

async function addAlias(creatorId, aliasType, aliasValue, verified = false) {
    try {
        await db.prepare(
            'INSERT IGNORE INTO creator_aliases (creator_id, alias_type, alias_value, is_verified) VALUES (?, ?, ?, ?)'
        ).run(creatorId, aliasType, aliasValue, verified ? 1 : 0);
    } catch (e) {
        if (e.code !***REMOVED*** 'ER_DUP_ENTRY') throw e;
    }
}

// ***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED*** 消息操作 ***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED***

async function insertMessage(creatorId, role, text, timestamp) {
    await db.prepare(
        'INSERT INTO wa_messages (creator_id, role, text, timestamp) VALUES (?, ?, ?, ?)'
    ).run(creatorId, role, text, timestamp);
}

async function insertMessagesBatch(creatorId, messages) {
    if (!messages || messages.length ***REMOVED***= 0) return;
    await db.transaction(async (txDb) => {
        const insert = txDb.prepare(
            'INSERT IGNORE INTO wa_messages (creator_id, role, text, timestamp) VALUES (?, ?, ?, ?)'
        );
        for (const msg of messages) {
            await insert.run(creatorId, msg.role, msg.text, msg.timestamp);
        }
    });
}

async function getMessageCount(creatorId) {
    const result = await db.prepare('SELECT COUNT(*) as cnt FROM wa_messages WHERE creator_id = ?').get(creatorId);
    return result ? (result.cnt || 0) : 0;
}

async function getLastMessage(creatorId) {
    return await db.prepare(
        'SELECT * FROM wa_messages WHERE creator_id = ? ORDER BY timestamp DESC LIMIT 1'
    ).get(creatorId);
}

// ***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED*** WA CRM 数据操作 ***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED***

async function getOrCreateWacrm(creatorId) {
    return await db.transaction(async (txDb) => {
        let wacrm = await txDb.prepare('SELECT * FROM wa_crm_data WHERE creator_id = ?').get(creatorId);
        if (!wacrm) {
            await txDb.prepare('INSERT IGNORE INTO wa_crm_data (creator_id) VALUES (?)').run(creatorId);
            wacrm = await txDb.prepare('SELECT * FROM wa_crm_data WHERE creator_id = ?').get(creatorId);
        }
        return wacrm;
    });
}

async function updateWacrm(creatorId, updates) {
    const allowed = [
        'priority', 'next_action', 'event_score', 'urgency_level',
        'monthly_fee_status', 'monthly_fee_amount', 'monthly_fee_deducted',
        'beta_status', 'beta_cycle_start', 'beta_program_type',
        'agency_bound', 'agency_bound_at', 'agency_deadline',
        'video_count', 'video_target', 'video_last_checked'
    ];
    const fields = [];
    const values = [];
    for (const key of Object.keys(updates)) {
        if (allowed.includes(key)) {
            fields.push(`${key} = ?`);
            values.push(updates[key]);
        }
    }
    if (fields.length ***REMOVED***= 0) return;
    values.push(creatorId);
    await db.prepare(`UPDATE wa_crm_data SET ${fields.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE creator_id = ?`).run(...values);
}

// ***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED*** 查询 ***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED***

async function getAllCreators(filters = {}) {
    const limit = Math.min(parseInt(filters.limit) || 100, 500);
    const offset = parseInt(filters.offset) || 0;
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
    sql += ` GROUP BY c.id ORDER BY msg_count DESC LIMIT ${limit} OFFSET ${offset}`;
    return await db.prepare(sql).all(...params);
}

async function getCreatorFull(creatorId) {
    const row = await db.prepare(`
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

    const messages = await db.prepare(
        'SELECT * FROM wa_messages WHERE creator_id = ? ORDER BY timestamp DESC LIMIT 100'
    ).all(creatorId);
    const aliases = await db.prepare(
        'SELECT * FROM creator_aliases WHERE creator_id = ? LIMIT 50'
    ).all(creatorId);
    const keeperRow = await db.prepare(
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
