/**
 * getPolicy — 从 events_policy 表获取策略配置
 * Used by: events routes (detail, judge, gmv-check, policy)
 */
const db = require('../../db');

function getPolicy(owner, eventKey) {
    const db2 = db.getDb();
    const row = db2.prepare('SELECT policy_json FROM events_policy WHERE owner = ? AND event_key = ?').get(owner, eventKey);
    return row ? JSON.parse(row.policy_json) : null;
}

module.exports = { getPolicy };
