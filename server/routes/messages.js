/**
 * Messages routes
 * GET /api/creators/:id/messages, POST /api/creators/:id/messages
 */
const express = require('express');
const router = express.Router({ mergeParams: true });
const db = require('../../db');
const { sha256 } = require('../utils/crypto');
const { normalizeOperatorName } = require('../utils/operator');
const { writeAudit } = require('../middleware/audit');
const { filterShortWindowDuplicates, toTimestampMs } = require('../services/messageDedupService');

function isLegacySecondTimestamp(value) {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 && n < 1e12;
}

function buildMessageHash(role, text, timestampMs) {
    return sha256(`${role || ''}|${text || ''}|${timestampMs || ''}`);
}

function getSecPairKey(message) {
    return [
        message?.role || '',
        message?.text || '',
        Math.floor(toTimestampMs(message?.timestamp) / 1000),
    ].join('\u0000');
}

function buildMessageKey(message, index = 0) {
    return String(
        message?.id
        ?? message?.message_hash
        ?? `${message?.creator_id || ''}:${message?.role || ''}:${toTimestampMs(message?.timestamp)}:${index}`
    );
}

function normalizeMessagesForTimeline(messages = []) {
    const rows = Array.isArray(messages) ? messages : [];
    const msPairKeys = new Set();

    for (const message of rows) {
        if (!isLegacySecondTimestamp(message?.timestamp)) {
            msPairKeys.add(getSecPairKey(message));
        }
    }

    const normalized = [];
    rows.forEach((message, index) => {
        const legacySecond = isLegacySecondTimestamp(message?.timestamp);
        if (legacySecond && msPairKeys.has(getSecPairKey(message))) {
            return;
        }

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

// GET /api/creators/:id/messages
router.get('/', async (req, res) => {
    try {
        const creatorId = parseInt(req.params.id);
        const limit = Math.min(parseInt(req.query.limit) || 100, 1000);
        const offset = parseInt(req.query.offset) || 0;
        const safeLimit = Number.isFinite(limit) && limit > 0 ? limit : 100;
        const safeOffset = Number.isFinite(offset) && offset >= 0 ? offset : 0;
        const dbConn = db.getDb();

        const { total } = await dbConn.prepare(
            'SELECT COUNT(*) as total FROM wa_messages WHERE creator_id = ?'
        ).get(creatorId);

        // Return the latest window by default so the chat pane matches the left list's
        // "last conversation" ordering while still rendering messages chronologically.
        // MySQL prepared statements may reject LIMIT/OFFSET placeholders in some driver paths.
        // These values are validated integers, so inline them and keep creator_id parameterized.
        const messages = await dbConn.prepare(
            `SELECT * FROM (
                SELECT * FROM wa_messages
                WHERE creator_id = ?
                ORDER BY timestamp DESC, id DESC
                LIMIT ${safeLimit} OFFSET ${safeOffset}
            ) recent
            ORDER BY timestamp ASC, id ASC`
        ).all(creatorId);
        const normalizedMessages = normalizeMessagesForTimeline(messages);

        res.json({
            messages: normalizedMessages,
            total,
            returned: normalizedMessages.length,
            deduped_dropped: messages.length - normalizedMessages.length,
            limit: safeLimit,
            offset: safeOffset,
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
        const ownerRow = await db.getDb().prepare('SELECT wa_owner FROM creators WHERE id = ?').get(creatorId);
        const operator = normalizeOperatorName(ownerRow?.wa_owner, ownerRow?.wa_owner || null);
        const { kept } = await filterShortWindowDuplicates(db.getDb(), creatorId, [{
            creator_id: creatorId,
            role,
            operator,
            text,
            timestamp: ts,
        }], {
            windowMs: 15 * 60 * 1000,
            minTextLength: 12,
        });
        if (kept.length === 0) {
            return res.json({ ok: true, id: creatorId, timestamp: ts, blocked: true, reason: 'short_window_duplicate' });
        }
        const safe = kept[0];
        const messageHash = buildMessageHash(safe.role, safe.text, safe.timestamp);

        await db.getDb().prepare(
            'INSERT IGNORE INTO wa_messages (creator_id, role, operator, text, timestamp, message_hash) VALUES (?, ?, ?, ?, ?, ?)'
        ).run(creatorId, safe.role, safe.operator, safe.text, safe.timestamp, messageHash);

        await writeAudit('message_create', 'wa_messages', messageHash, null, {
            creator_id: creatorId,
            role: safe.role,
            operator: safe.operator,
            timestamp: safe.timestamp,
        }, req);

        res.json({ ok: true, id: creatorId, timestamp: safe.timestamp });
    } catch (err) {
        console.error('Error inserting message:', err);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
