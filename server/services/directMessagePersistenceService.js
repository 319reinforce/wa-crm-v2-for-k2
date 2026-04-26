const crypto = require('crypto');
const creatorCache = require('./creatorCache');
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
const {
    enqueueMessageForEventDetection,
} = require('./activeEventDetectionService');
const { normalizeOperatorName } = require('../utils/operator');
const { perfLog } = require('./perfLog');
const sseBus = require('../events/sseBus');

// Phase 1: 默认在持久化成功后广播 wa-message SSE，修复爬虫路径不推 SSE 的黑洞。
// SSE_PERSISTENCE_BROADCAST=false 可关闭（仅用于回滚）。
const SSE_PERSISTENCE_BROADCAST =
    String(process.env.SSE_PERSISTENCE_BROADCAST || 'true').toLowerCase() !== 'false';

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
    // 媒体字段（可选）：调用方在持久化媒体消息时传入，老 caller 不传等同 null。
    mediaAssetId = null,
    mediaType = null,
    mediaMime = null,
    mediaSize = null,
    mediaWidth = null,
    mediaHeight = null,
    mediaCaption = null,
    mediaThumbnail = null,
    mediaDownloadStatus = null,
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

    const persistStartedAt = Date.now();
    perfLog('persist_start', {
        creatorId,
        waMsgId: normalizedWaMessageId,
        role,
        operator: normalizedOperator,
        timestamp: timestampMs,
        auditAction,
    });

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
            perfLog('persist_end', {
                creatorId,
                waMsgId: normalizedWaMessageId,
                persisted: false,
                blocked: true,
                reason: 'short_window_duplicate',
                durationMs: Date.now() - persistStartedAt,
            });
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
            perfLog('persist_end', {
                creatorId,
                waMsgId: normalizedWaMessageId,
                persisted: false,
                blocked: true,
                reason: 'group_message_conflict',
                durationMs: Date.now() - persistStartedAt,
            });
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
    const normalizedMediaAssetId = Number.isFinite(Number(mediaAssetId)) && Number(mediaAssetId) > 0
        ? Number(mediaAssetId)
        : null;
    const resolvedDownloadStatus = mediaDownloadStatus
        || (normalizedMediaAssetId ? 'success' : null);
    const insertResult = await dbConn.prepare(
        `INSERT IGNORE INTO wa_messages
         (creator_id, role, operator, text, timestamp, message_hash, wa_message_id,
          media_asset_id, media_type, media_mime, media_size,
          media_width, media_height, media_caption, media_thumbnail,
          media_download_status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
        creatorId, safe.role, safe.operator, safe.text, safe.timestamp, messageHash, normalizedWaMessageId,
        normalizedMediaAssetId,
        mediaType || null,
        mediaMime || null,
        Number.isFinite(Number(mediaSize)) ? Number(mediaSize) : null,
        Number.isFinite(Number(mediaWidth)) ? Number(mediaWidth) : null,
        Number.isFinite(Number(mediaHeight)) ? Number(mediaHeight) : null,
        mediaCaption || null,
        mediaThumbnail || null,
        resolvedDownloadStatus
    );
    const persisted = Number(insertResult?.changes || 0) > 0;

    if (persisted) {
        try { invalidateMessageCache(creatorId); } catch (_) {}
        enqueueMessageForEventDetection(dbConn, {
            creatorId,
            messageId: insertResult.lastInsertRowid || null,
            timestamp: safe.timestamp,
            reason: auditAction === 'message_backfill' ? 'message_supplement' : 'message_ingest',
        }).catch((err) => {
            console.warn('[persistDirectMessageRecord] event detection enqueue failed:', err.message);
        });
        if (req) {
            await writeAudit(auditAction, 'wa_messages', messageHash, null, {
                creator_id: creatorId,
                role: safe.role,
                operator: safe.operator,
                timestamp: safe.timestamp,
                wa_message_id: normalizedWaMessageId,
            }, req);
        }
        if (SSE_PERSISTENCE_BROADCAST) {
            // 查 wa_phone 是为了复用现有前端匹配逻辑（按 from_phone/to_phone
            // 判断是否当前打开的会话）。这是一条短查询，不进事务。
            let waPhone = null;
            try {
                const row = await creatorCache.getCreator(dbConn, creatorId, 'wa_phone');
                waPhone = row && row.wa_phone ? String(row.wa_phone) : null;
            } catch (err) {
                console.error('[persistDirectMessageRecord] wa_phone lookup failed:', err.message);
            }
            try {
                sseBus.broadcast('wa-message', {
                    creator_id: creatorId,
                    message_id: normalizedWaMessageId,
                    wa_message_id: normalizedWaMessageId,
                    role: safe.role,
                    operator: safe.operator,
                    text: safe.text,
                    timestamp: safe.timestamp,
                    from_phone: waPhone,
                    to_phone: waPhone,
                    source: 'persistence',
                });
            } catch (err) {
                console.error('[persistDirectMessageRecord] SSE broadcast failed:', err.message);
            }
        }
    }

    perfLog('persist_end', {
        creatorId,
        waMsgId: normalizedWaMessageId,
        persisted,
        blocked: false,
        reason: persisted ? null : 'duplicate',
        durationMs: Date.now() - persistStartedAt,
    });

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
