/**
 * getPolicy — 从 events_policy 表获取策略配置
 * Used by: events routes (detail, judge, gmv-check, policy)
 */
const db = require('../../db');

function getPolicy(owner, eventKey) {
    const db2 = db.getDb();
    const row = db2.prepare('SELECT policy_json FROM events_policy WHERE owner = ? AND event_key = ?').get(owner, eventKey);
    if (!row) return null;
    try {
        return JSON.parse(row.policy_json);
    } catch (e) {
        console.error('getPolicy JSON parse error:', e.message, row.policy_json);
        return null;
    }
}

module.exports = { getPolicy };
