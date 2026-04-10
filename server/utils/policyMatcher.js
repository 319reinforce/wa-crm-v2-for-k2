/**
 * getPolicy — 从 events_policy 表获取策略配置
 * Used by: events routes (detail, judge, gmv-check, policy)
 */
const db = require('../../db');

async function getPolicy(owner, eventKey) {
    const db2 = db.getDb();
    const row = await db2.prepare('SELECT policy_json FROM events_policy WHERE owner = ? AND event_key = ?').get(owner, eventKey);
    if (!row) return null;
    // MySQL json column returns parsed object already, no need to JSON.parse again
    return row.policy_json;
}

module.exports = { getPolicy };
