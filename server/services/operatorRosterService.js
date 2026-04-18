const db = require('../../db');
const { normalizeOperatorName } = require('../utils/operator');
const sessionRepository = require('./sessionRepository');

const TABLE = 'operator_creator_roster';

// 从 wa_sessions 表(in-memory 缓存)查 operator → session_id;
// 缓存未 warm 时回退到小写 operator
function getSessionIdForOperator(operator) {
    const normalized = normalizeOperatorName(operator, operator);
    if (!normalized) return null;
    const cached = sessionRepository.getActiveSessionIdByOwnerCached(normalized);
    if (cached) return cached;
    return String(normalized).trim().toLowerCase() || null;
}

async function safeGet(sql, ...params) {
    try {
        return await db.getDb().prepare(sql).get(...params);
    } catch (err) {
        if (err?.code === 'ER_NO_SUCH_TABLE') return null;
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

async function getPrimaryAssignmentsByOperator(operator) {
    const normalized = normalizeOperatorName(operator, operator);
    if (!normalized) return [];
    try {
        return await db.getDb().prepare(
            `SELECT
                r.id,
                r.creator_id,
                r.operator,
                r.session_id,
                r.source_file,
                r.raw_poc,
                r.raw_name,
                r.raw_handle,
                r.raw_keeper_name,
                r.marketing_channel,
                r.match_strategy,
                r.score,
                r.is_primary,
                r.created_at,
                r.updated_at,
                c.wa_phone,
                c.primary_name,
                c.wa_owner
             FROM ${TABLE} r
             JOIN creators c ON c.id = r.creator_id
             WHERE r.is_primary = 1 AND r.operator = ?
             ORDER BY c.id ASC`
        ).all(normalized);
    } catch (err) {
        if (err?.code === 'ER_NO_SUCH_TABLE') return [];
        throw err;
    }
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
    getPrimaryAssignmentsByOperator,
    applyAssignmentToCreator,
};
