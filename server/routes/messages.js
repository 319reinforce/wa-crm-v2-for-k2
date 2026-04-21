/**
 * Messages routes
 * GET /api/creators/:id/messages, POST /api/creators/:id/messages
 */
const express = require('express');
const router = express.Router({ mergeParams: true });
const db = require('../../db');
const { getLockedOwner, matchesOwnerScope, sendOwnerScopeForbidden } = require('../middleware/appAuth');
const { normalizeOperatorName } = require('../utils/operator');
const { toTimestampMs } = require('../services/messageDedupService');
const { persistDirectMessageRecord } = require('../services/directMessagePersistenceService');

function isLegacySecondTimestamp(value) {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 && n < 1e12;
}

function buildMessageKey(message, index = 0) {
    // wa_message_id 是 WhatsApp 原生幂等键,优先使用;
    // 缺失时回退到 DB 自增 id / message_hash / 组合 key。
    return String(
        message?.wa_message_id
        ?? message?.id
        ?? message?.message_hash
        ?? `${message?.creator_id || ''}:${message?.role || ''}:${toTimestampMs(message?.timestamp)}:${index}`
    );
}

function normalizeMessagesForTimeline(messages = []) {
    const rows = Array.isArray(messages) ? messages : [];

    // 以 wa_message_id 为主去重(防 DB 双写这种假设性场景);同一 wa_message_id 只保留第一次出现。
    // 缺 id 的行按原样保留,由下游 UI 自行以 DB id 辨识。
    const seenWaIds = new Set();
    const normalized = [];
    rows.forEach((message, index) => {
        const rawWaId = typeof message?.wa_message_id === 'string' ? message.wa_message_id.trim() : '';
        if (rawWaId) {
            if (seenWaIds.has(rawWaId)) return;
            seenWaIds.add(rawWaId);
        }
        const legacySecond = isLegacySecondTimestamp(message?.timestamp);
        const timestampMs = toTimestampMs(message?.timestamp);
        normalized.push({
            ...message,
            timestamp_raw: message?.timestamp ?? null,
            timestamp_precision: legacySecond ? 's' : 'ms',
            timestamp: timestampMs,
            message_key: buildMessageKey(message, index),
        });
    });

    normalized.sort((a, b) => {
        if (a.timestamp !== b.timestamp) return a.timestamp - b.timestamp;
        const aId = Number(a.id || 0);
        const bId = Number(b.id || 0);
        if (aId !== bId) return aId - bId;
        return String(a.message_key).localeCompare(String(b.message_key));
    });

    return normalized;
}

async function ensureCreatorAccess(req, res, creatorId) {
    const row = await db.getDb().prepare(
        'SELECT id, wa_owner FROM creators WHERE id = ? LIMIT 1'
    ).get(creatorId);
    if (!row) {
        res.status(404).json({ ok: false, error: 'Creator not found' });
        return null;
    }
    const lockedOwner = getLockedOwner(req);
    if (lockedOwner && !matchesOwnerScope(req, row.wa_owner)) {
        sendOwnerScopeForbidden(res, lockedOwner);
        return null;
    }
    return row;
}

// GET /api/creators/:id/messages
router.get('/', async (req, res) => {
    try {
        const creatorId = parseInt(req.params.id);
        const limit = Math.min(parseInt(req.query.limit) || 100, 1000);
        const offset = parseInt(req.query.offset) || 0;
        const aroundMessageId = parseInt(req.query.around_message_id) || 0;
        const aroundTimestamp = toTimestampMs(req.query.around_timestamp);
        const windowBefore = Math.min(Math.max(parseInt(req.query.window_before) || 5, 0), 50);
        const windowAfter = Math.min(Math.max(parseInt(req.query.window_after) || 4, 0), 50);
        const safeLimit = Number.isFinite(limit) && limit > 0 ? limit : 100;
        const safeOffset = Number.isFinite(offset) && offset >= 0 ? offset : 0;
        const dbConn = db.getDb();
        const creator = await ensureCreatorAccess(req, res, creatorId);
        if (!creator) return;

        const { total } = await dbConn.prepare(
            'SELECT COUNT(*) as total FROM wa_messages WHERE creator_id = ?'
        ).get(creatorId);

        // Return the latest window by default so the chat pane matches the left list's
        // "last conversation" ordering while still rendering messages chronologically.
        // MySQL prepared statements may reject LIMIT/OFFSET placeholders in some driver paths.
        // These values are validated integers, so inline them and keep creator_id parameterized.
        let messages = [];
        let mode = 'latest';
        let anchorMessage = null;

        if (aroundMessageId > 0 || aroundTimestamp > 0) {
            if (aroundMessageId > 0) {
                anchorMessage = await dbConn.prepare(`
                    SELECT *
                    FROM wa_messages
                    WHERE creator_id = ? AND id = ?
                    LIMIT 1
                `).get(creatorId, aroundMessageId);
            }

            if (!anchorMessage && aroundTimestamp > 0) {
                anchorMessage = await dbConn.prepare(`
                    SELECT *
                    FROM wa_messages
                    WHERE creator_id = ?
                    ORDER BY ABS(timestamp - ?), id DESC
                    LIMIT 1
                `).get(creatorId, aroundTimestamp);
            }

            if (anchorMessage) {
                const anchorTs = Number(anchorMessage.timestamp || 0);
                const anchorId = Number(anchorMessage.id || 0);
                const beforeRows = await dbConn.prepare(`
                    SELECT *
                    FROM wa_messages
                    WHERE creator_id = ?
                      AND (timestamp < ? OR (timestamp = ? AND id < ?))
                    ORDER BY timestamp DESC, id DESC
                    LIMIT ${windowBefore}
                `).all(creatorId, anchorTs, anchorTs, anchorId);
                const afterRows = await dbConn.prepare(`
                    SELECT *
                    FROM wa_messages
                    WHERE creator_id = ?
                      AND (timestamp > ? OR (timestamp = ? AND id > ?))
                    ORDER BY timestamp ASC, id ASC
                    LIMIT ${windowAfter}
                `).all(creatorId, anchorTs, anchorTs, anchorId);

                messages = [...beforeRows.reverse(), anchorMessage, ...afterRows];
                mode = 'anchor_window';
            }
        }

        if (messages.length === 0) {
            messages = await dbConn.prepare(
                `SELECT * FROM (
                    SELECT * FROM wa_messages
                    WHERE creator_id = ?
                    ORDER BY timestamp DESC, id DESC
                    LIMIT ${safeLimit} OFFSET ${safeOffset}
                ) recent
                ORDER BY timestamp ASC, id ASC`
            ).all(creatorId);
        }
        const normalizedMessages = normalizeMessagesForTimeline(messages);

        res.json({
            messages: normalizedMessages,
            total,
            returned: normalizedMessages.length,
            deduped_dropped: messages.length - normalizedMessages.length,
            limit: safeLimit,
            offset: safeOffset,
            mode,
            anchor_message_id: anchorMessage?.id || null,
        });
    } catch (err) {
        console.error('Error fetching messages:', err);
        res.status(500).json({ error: err.message });
    }
});

// POST /api/creators/:id/messages
router.post('/', async (req, res) => {
    try {
        const { role, text, timestamp } = req.body;
        if (!role || !text) {
            return res.status(400).json({ error: 'role and text required' });
        }
        const creatorId = parseInt(req.params.id);
        const ts = toTimestampMs(timestamp);
        const ownerRow = await ensureCreatorAccess(req, res, creatorId);
        if (!ownerRow) return;
        const operator = normalizeOperatorName(ownerRow?.wa_owner, ownerRow?.wa_owner || null);
        const persistResult = await persistDirectMessageRecord({
            dbConn: db.getDb(),
            creatorId,
            role,
            operator,
            text,
            timestamp: ts,
            req,
        });

        res.json({
            ok: true,
            id: creatorId,
            timestamp: persistResult.timestamp,
            blocked: !!persistResult.blocked,
            reason: persistResult.reason,
            persisted: !!persistResult.persisted,
            duplicate: !!persistResult.duplicate,
            message_hash: persistResult.message_hash || null,
        });
    } catch (err) {
        console.error('Error inserting message:', err);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
module.exports._private = {
    normalizeMessagesForTimeline,
    buildMessageKey,
    isLegacySecondTimestamp,
};
