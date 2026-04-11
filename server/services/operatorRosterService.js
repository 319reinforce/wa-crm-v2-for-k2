const db = require('../../db');
const { normalizeOperatorName } = require('../utils/operator');

const TABLE = 'operator_creator_roster';
const SESSION_BY_OPERATOR = {
    Beau: 'beau',
    Yiyun: 'yiyun',
    Jiawen: 'jiawen',
    WangYouKe: 'youke',
};

function getSessionIdForOperator(operator) {
    const normalized = normalizeOperatorName(operator, operator);
    if (!normalized) return null;
    return SESSION_BY_OPERATOR[normalized] || String(normalized).trim().toLowerCase();
}

async function safeGet(sql, ...params) {
    try {
        return await db.getDb().prepare(sql).get(...params);
    } catch (err) {
        if (err?.code ***REMOVED***= 'ER_NO_SUCH_TABLE') return null;
        throw err;
    }
}

async function hasRosterAssignments() {
    const row = await safeGet(`SELECT COUNT(*) AS c FROM ${TABLE} WHERE is_primary = 1`);
    return Number(row?.c || 0) > 0;
}

async function getAssignmentByCreatorId(creatorId) {
    if (!creatorId) return null;
    return await safeGet(
        `SELECT id, creator_id, operator, session_id, source_file, raw_poc, raw_name, raw_handle, raw_keeper_name,
                marketing_channel, match_strategy, score, is_primary, created_at, updated_at
           FROM ${TABLE}
          WHERE creator_id = ? AND is_primary = 1
          LIMIT 1`,
        creatorId
    );
}

function applyAssignmentToCreator(creator, assignment) {
    if (!creator) return creator;
    const operator = assignment?.operator || normalizeOperatorName(creator.wa_owner, creator.wa_owner);
    return {
        ...creator,
        wa_owner: operator,
        session_id: assignment?.session_id || getSessionIdForOperator(operator),
        roster_assignment: assignment || null,
    };
}

module.exports = {
    TABLE,
    getSessionIdForOperator,
    hasRosterAssignments,
    getAssignmentByCreatorId,
    applyAssignmentToCreator,
};
