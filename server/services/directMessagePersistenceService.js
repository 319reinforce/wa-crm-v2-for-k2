const crypto = require('crypto');
const { writeAudit } = require('../middleware/audit');
const {
    filterShortWindowDuplicates,
    normalizeMessageText,
    toTimestampMs,
} = require('./messageDedupService');
const {
    ensureGroupMessageSchema,
    filterDirectMessagesAgainstGroups,
} = require('./groupMessageService');
const { normalizeOperatorName } = require('../utils/operator');

function buildMessageHash(role, text, timestampMs) {
    return crypto
        .createHash('sha256')
        .update(`${role || ''}|${text || ''}|${timestampMs || ''}`)
        .digest('hex');
}

async function persistDirectMessageRecord({
    dbConn,
    creatorId,
    role,
    operator,
    text,
    timestamp = null,
    req = null,
    auditAction = 'message_create',
    shortWindowGuard = true,
    groupConflictGuard = true,
}) {
    const normalizedText = normalizeMessageText(text);
    const normalizedOperator = normalizeOperatorName(operator, operator || null);
    const timestampMs = toTimestampMs(timestamp) || Date.now();

    if (!dbConn) {
        throw new Error('dbConn is required');
    }
    if (!creatorId || !role || !normalizedText) {
        throw new Error('creatorId, role, and text are required');
    }

    let kept = [{
        creator_id: creatorId,
        role,
        operator: normalizedOperator,
        text: normalizedText,
        timestamp: timestampMs,
    }];

    if (shortWindowGuard) {
        const deduped = await filterShortWindowDuplicates(dbConn, creatorId, kept, {
            windowMs: 15 * 60 * 1000,
            minTextLength: 12,
        });
        kept = deduped.kept;
        if (kept.length === 0) {
            return {
                handled: true,
                persisted: false,
                duplicate: false,
                blocked: true,
                reason: 'short_window_duplicate',
                timestamp: timestampMs,
                operator: normalizedOperator,
                message_hash: null,
                text: normalizedText,
            };
        }
    }

    let safe = kept[0];
    if (groupConflictGuard) {
        await ensureGroupMessageSchema(dbConn);
        const groupFiltered = await filterDirectMessagesAgainstGroups(dbConn, {
            operator: normalizedOperator,
            messages: kept,
        });
        if (groupFiltered.kept.length === 0) {
            return {
                handled: true,
                persisted: false,
                duplicate: false,
                blocked: true,
                reason: 'group_message_conflict',
                timestamp: timestampMs,
                operator: normalizedOperator,
                message_hash: null,
                text: normalizedText,
            };
        }
        safe = groupFiltered.kept[0];
    }

    const messageHash = buildMessageHash(safe.role, safe.text, safe.timestamp);
    const insertResult = await dbConn.prepare(
        'INSERT IGNORE INTO wa_messages (creator_id, role, operator, text, timestamp, message_hash) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(creatorId, safe.role, safe.operator, safe.text, safe.timestamp, messageHash);
    const persisted = Number(insertResult?.changes || 0) > 0;

    if (persisted && req) {
        await writeAudit(auditAction, 'wa_messages', messageHash, null, {
            creator_id: creatorId,
            role: safe.role,
            operator: safe.operator,
            timestamp: safe.timestamp,
        }, req);
    }

    return {
        handled: true,
        persisted,
        duplicate: !persisted,
        blocked: false,
        reason: persisted ? null : 'message_hash_duplicate',
        timestamp: safe.timestamp,
        operator: safe.operator,
        message_hash: messageHash,
        text: safe.text,
    };
}

module.exports = {
    persistDirectMessageRecord,
};
