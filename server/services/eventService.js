/**
 * Event Service — 事件系统业务逻辑封装
 * 提取自 server/routes/events.js
 */
const db = require('../../db');
const { EVENT_KEYWORDS } = require('../constants/eventKeywords');
const { getPolicy } = require('../utils/policyMatcher');

/**
 * 分页查询事件列表
 */
async function listEvents({ status, owner, creator_id, event_key, limit = 50, offset = 0 } = {}) {
    const db2 = db.getDb();
    let sql = `SELECT e.*, c.primary_name as creator_name, c.wa_phone as creator_phone
               FROM events e
               LEFT JOIN creators c ON c.id = e.creator_id
               WHERE 1=1`;
    const params = [];

    if (status) { sql += ` AND e.status = ?`; params.push(status); }
    if (owner) { sql += ` AND e.owner = ?`; params.push(owner); }
    if (creator_id) { sql += ` AND e.creator_id = ?`; params.push(creator_id); }
    if (event_key) { sql += ` AND e.event_key = ?`; params.push(event_key); }

    sql += ` ORDER BY e.created_at DESC LIMIT ${limit} OFFSET ${offset}`;

    const events = await db2.prepare(sql).all(...params);
    const cond = status ? [status] : owner ? [owner] : creator_id ? [creator_id] : event_key ? [event_key] : [];
    const total = (await db2.prepare(`SELECT COUNT(*) as count FROM events e WHERE 1=1${status ? ' AND e.status = ?' : ''}${owner ? ' AND e.owner = ?' : ''}${creator_id ? ' AND e.creator_id = ?' : ''}${event_key ? ' AND e.event_key = ?' : ''}`).get(...cond)).count;

    return { events, total, limit: parseInt(limit), offset: parseInt(offset) };
}

/**
 * 获取单个事件（含 policy 和 periods）
 */
async function getEventWithDetails(eventId) {
    const db2 = db.getDb();
    const event = await db2.prepare(`
        SELECT e.*, c.primary_name as creator_name, c.wa_phone as creator_phone
        FROM events e
        LEFT JOIN creators c ON c.id = e.creator_id
        WHERE e.id = ?
    `).get(eventId);

    if (!event) return null;

    event.policy = getPolicy(event.owner, event.event_key);
    event.periods = await db2.prepare(`
        SELECT * FROM event_periods WHERE event_id = ? ORDER BY period_start DESC
    `).all(eventId);
    return event;
}

/**
 * 创建事件（含重复检查）
 */
async function createEvent({ creator_id, event_key, event_type, owner, trigger_source = 'manual', trigger_text = '', start_at, end_at, meta = {} }) {
    const db2 = db.getDb();
    const existing = await db2.prepare(`SELECT id FROM events WHERE creator_id = ? AND event_key = ? AND status = 'active'`).get(creator_id, event_key);
    if (existing) {
        const err = new Error('同一达人已有相同事件处于 active 状态');
        err.existing_id = existing.id;
        throw err;
    }
    const result = await db2.prepare(`
        INSERT INTO events (creator_id, event_key, event_type, owner, status, trigger_source, trigger_text, start_at, end_at, meta)
        VALUES (?, ?, ?, ?, 'active', ?, ?, ?, ?, ?)
    `).run(creator_id, event_key, event_type, owner, trigger_source, trigger_text, start_at || new Date().toISOString(), end_at, JSON.stringify(meta));
    return { id: result.lastInsertRowid, status: 'active' };
}

/**
 * 更新事件（白名单保护）
 */
async function updateEvent(eventId, updates = {}) {
    const db2 = db.getDb();
    const existing = await db2.prepare('SELECT * FROM events WHERE id = ?').get(eventId);
    if (!existing) return null;

    const allowed = ['status', 'end_at', 'meta'];
    const fields = [];
    const params = [];
    for (const key of Object.keys(updates)) {
        if (allowed.includes(key)) {
            fields.push(`${key} = ?`);
            params.push(key ***REMOVED***= 'meta' ? JSON.stringify(updates[key]) : updates[key]);
        }
    }
    if (fields.length ***REMOVED***= 0) return existing;

    fields.push('updated_at = CURRENT_TIMESTAMP');
    params.push(eventId);
    await db2.prepare(`UPDATE events SET ${fields.join(', ')} WHERE id = ?`).run(...params);
    return await db2.prepare('SELECT * FROM events WHERE id = ?').get(eventId);
}

/**
 * 删除事件（仅 pending 状态）
 */
async function deleteEvent(eventId) {
    const db2 = db.getDb();
    const event = await db2.prepare('SELECT status FROM events WHERE id = ?').get(eventId);
    if (!event) return false;
    if (event.status !***REMOVED*** 'pending') {
        const err = new Error('只能删除 pending 状态的事件');
        err.status = event.status;
        throw err;
    }
    await db2.prepare('DELETE FROM event_periods WHERE event_id = ?').run(eventId);
    await db2.prepare('DELETE FROM events WHERE id = ?').run(eventId);
    return true;
}

/**
 * 从文本中检测事件关键词
 */
async function detectEventsFromText(text, creatorId) {
    const db2 = db.getDb();
    const creator = await db2.prepare('SELECT * FROM creators WHERE id = ?').get(creatorId);
    if (!creator) return null;

    const lowerText = text.toLowerCase();
    const detected = [];

    for (const [event_key, keywords] of Object.entries(EVENT_KEYWORDS)) {
        for (const kw of keywords) {
            if (lowerText.includes(kw.toLowerCase())) {
                if (!detected.find(d => d.event_key ***REMOVED***= event_key)) {
                    const event_type = event_key ***REMOVED***= 'trial_7day' || event_key ***REMOVED***= 'monthly_challenge' ? 'challenge'
                        : event_key ***REMOVED***= 'agency_bound' ? 'agency'
                        : event_key ***REMOVED***= 'referral' ? 'referral' : 'incentive_task';

                    detected.push({
                        event_key,
                        event_type,
                        owner: creator.wa_owner || 'Beau',
                        trigger_text: text,
                        trigger_source: 'semantic_auto',
                        confidence: 1.0,
                    });
                }
                break;
            }
        }
    }

    const gmvKeywords = ['gmv', '$', 'revenue', '销售额', '成交'];
    for (const kw of gmvKeywords) {
        if (lowerText.includes(kw) && creator.keeper_username) {
            const keeper = await db2.prepare('SELECT * FROM keeper_link WHERE creator_id = ?').get(creatorId);
            if (keeper && keeper.keeper_gmv > 0) {
                detected.push({
                    event_key: 'gmv_milestone',
                    event_type: 'gmv',
                    owner: creator.wa_owner || 'Beau',
                    trigger_text: text,
                    trigger_source: 'gmv_crosscheck',
                    gmv_current: keeper.keeper_gmv,
                    confidence: 0.8,
                });
            }
            break;
        }
    }

    return { detected, creator_id: creatorId, creator_name: creator.primary_name };
}

/**
 * 判定周期 bonus
 */
async function judgeEventPeriod(eventId, { period_start, period_end, video_count }) {
    const db2 = db.getDb();
    const event = await db2.prepare('SELECT * FROM events WHERE id = ?').get(eventId);
    if (!event) return null;

    const policy = getPolicy(event.owner, event.event_key);
    if (!policy) return null;

    const weekly_target = policy.weekly_target || 35;
    const bonus_per_video = policy.bonus_per_video || 5;
    const bonus_earned = video_count >= weekly_target ? video_count * bonus_per_video : 0;

    const existingPeriod = await db2.prepare(`SELECT id FROM event_periods WHERE event_id = ? AND period_start = ?`).get(eventId, period_start);
    let periodId;
    if (existingPeriod) {
        await db2.prepare(`
            UPDATE event_periods SET video_count = ?, bonus_earned = ?, status = 'settled', updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        `).run(video_count, bonus_earned, existingPeriod.id);
        periodId = existingPeriod.id;
    } else {
        const result = await db2.prepare(`
            INSERT INTO event_periods (event_id, period_start, period_end, video_count, bonus_earned, status)
            VALUES (?, ?, ?, ?, ?, 'settled')
        `).run(eventId, period_start, period_end || period_start, video_count, bonus_earned);
        periodId = result.lastInsertRowid;
    }

    return {
        period_id: periodId,
        event_id: event.id,
        event_key: event.event_key,
        video_count,
        weekly_target,
        bonus_earned,
        policy,
    };
}

/**
 * GMV 检查（所有活跃 GMV 事件）
 */
async function checkGmvMilestones() {
    const db2 = db.getDb();
    const activeGmvEvents = await db2.prepare(`SELECT e.*, c.primary_name as creator_name, c.keeper_username FROM events e JOIN creators c ON c.id = e.creator_id WHERE e.event_type = 'gmv' AND e.status = 'active'`).all();

    const results = [];
    for (const evt of activeGmvEvents) {
        const keeper = await db2.prepare('SELECT * FROM keeper_link WHERE creator_id = ?').get(evt.creator_id);
        if (!keeper) continue;

        const gmv = keeper.keeper_gmv || 0;
        const policy = getPolicy(evt.owner, 'gmv_milestone');

        let totalReward = 0;
        if (policy && policy.gmv_milestones) {
            for (const milestone of policy.gmv_milestones) {
                if (gmv >= milestone.threshold) {
                    if (milestone.reward_type ***REMOVED***= 'cash') totalReward += milestone.value;
                    else if (milestone.reward_type ***REMOVED***= 'commission_boost') {
                        const recentPeriod = await db2.prepare(`SELECT video_count FROM event_periods WHERE event_id = ? ORDER BY period_end DESC LIMIT 1`).get(evt.id);
                        if (recentPeriod && recentPeriod.video_count >= 35) {
                            totalReward += milestone.value;
                        }
                    }
                }
            }
        }

        results.push({
            event_id: evt.id,
            creator_id: evt.creator_id,
            creator_name: evt.creator_name,
            keeper_username: evt.keeper_username,
            gmv_current: gmv,
            estimated_reward: totalReward,
            status: evt.status,
        });
    }

    return { events: results };
}

/**
 * 获取达人事件汇总
 */
async function getEventSummary(creatorId) {
    const db2 = db.getDb();
    const creator = await db2.prepare('SELECT id, primary_name, wa_owner FROM creators WHERE id = ?').get(creatorId);
    if (!creator) return null;

    const events = await db2.prepare(`SELECT * FROM events WHERE creator_id = ? ORDER BY created_at DESC`).all(creatorId);
    const activeEvents = events.filter(e => e.status ***REMOVED***= 'active');
    const completedEvents = events.filter(e => e.status ***REMOVED***= 'completed');

    const summary = {
        creator_id: creatorId,
        creator_name: creator.primary_name,
        wa_owner: creator.wa_owner,
        total_events: events.length,
        active_count: activeEvents.length,
        completed_count: completedEvents.length,
        by_type: {},
        by_status: {},
    };

    for (const evt of events) {
        summary.by_type[evt.event_key] = (summary.by_type[evt.event_key] || 0) + 1;
        summary.by_status[evt.status] = (summary.by_status[evt.status] || 0) + 1;
    }

    return { summary, events };
}

module.exports = {
    listEvents,
    getEventWithDetails,
    createEvent,
    updateEvent,
    deleteEvent,
    detectEventsFromText,
    judgeEventPeriod,
    checkGmvMilestones,
    getEventSummary,
};
