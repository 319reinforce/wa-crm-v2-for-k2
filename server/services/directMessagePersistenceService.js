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

// Optional-require for message cache (perf-cache branch). No-op when not present.
let invalidateMessageCache = () => {};
try {
    const cache = require('./messageCache');
    if (cache && typeof cache.invalidateCreator === 'function') {
        invalidateMessageCache = cache.invalidateCreator;
    }
} catch (_) {
    // messageCache module not installed; leave no-op.
}

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
    waMessageId = null,
    req = null,
    auditAction = 'message_create',
    shortWindowGuard = true,
    groupConflictGuard = true,
}) {
    const normalizedText = normalizeMessageText(text);
    const normalizedOperator = normalizeOperatorName(operator, operator || null);
    const timestampMs = toTimestampMs(timestamp) || Date.now();
    const normalizedWaMessageId =
        typeof waMessageId === 'string' && waMessageId.trim().length > 0
            ? waMessageId.trim()
            : null;

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

    // short-window guard 只针对 AI 自动回复（role='assistant'）生效，
    // 避免误伤人工/镜像 outbound（role='me'）和达人 inbound（role='user'）。
    if (shortWindowGuard && role === 'assistant') {
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
                wa_message_id: normalizedWaMessageId,
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
                wa_message_id: normalizedWaMessageId,
                text: normalizedText,
            };
        }
        safe = groupFiltered.kept[0];
    }

    const messageHash = buildMessageHash(safe.role, safe.text, safe.timestamp);
    const insertResult = await dbConn.prepare(
        'INSERT IGNORE INTO wa_messages (creator_id, role, operator, text, timestamp, message_hash, wa_message_id) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(creatorId, safe.role, safe.operator, safe.text, safe.timestamp, messageHash, normalizedWaMessageId);
    const persisted = Number(insertResult?.changes || 0) > 0;

    if (persisted) {
        try { invalidateMessageCache(creatorId); } catch (_) {}
        if (req) {
            await writeAudit(auditAction, 'wa_messages', messageHash, null, {
                creator_id: creatorId,
                role: safe.role,
                operator: safe.operator,
                timestamp: safe.timestamp,
                wa_message_id: normalizedWaMessageId,
            }, req);
        }
    }

    return {
        handled: true,
        persisted,
        duplicate: !persisted,
        blocked: false,
        reason: persisted ? null : 'duplicate',
        timestamp: safe.timestamp,
        operator: safe.operator,
        message_hash: messageHash,
        wa_message_id: normalizedWaMessageId,
        text: safe.text,
    };
}

module.exports = {
    persistDirectMessageRecord,
};
