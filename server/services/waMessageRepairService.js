const db = require('../../db');
const { sha256 } = require('../utils/crypto');
const { normalizeMessageText } = require('./messageDedupService');

const NEAR_WINDOW_MS = 2 * 60 * 1000;
const QUERY_PADDING_MS = 12 * 60 * 60 * 1000;

function isBinaryLikePayload(text) {
    const value = String(text || '').trim();
    if (!value) return false;
    if (/^data:image\/[a-z0-9.+-]+;base64,/i.test(value)) return true;
    if (/^data:[^;]+;base64,[A-Za-z0-9+/=\s]+$/i.test(value)) return true;
    const compact = value.replace(/\s+/g, '');
    if (/^\/9j\/[A-Za-z0-9+/=]{64,}$/.test(compact)) return true;
    if (/^[A-Za-z0-9+/=]{512,}$/.test(compact) && compact.length % 4 ***REMOVED***= 0) return true;
    return false;
}

function isUsefulText(text) {
    const normalized = normalizeMessageText(text);
    if (!normalized) return false;
    if (isBinaryLikePayload(normalized)) return false;
    return normalized.length > 0;
}

function buildMessageHash(role, text, timestamp) {
    return sha256(`${role || ''}|${text || ''}|${timestamp || ''}`);
}

function normalizeRawMessages(rawMessages = []) {
    const dedup = new Set();
    return (Array.isArray(rawMessages) ? rawMessages : [])
        .map((message) => {
            const role = message?.role ***REMOVED***= 'me' ? 'me' : 'user';
            const text = normalizeMessageText(message?.text);
            const timestamp = Number(message?.timestamp) || 0;
            const messageId = String(message?.message_id || '').trim() || null;
            return {
                role,
                text,
                normalizedText: text,
                timestamp,
                message_id: messageId,
            };
        })
        .filter((message) => message.timestamp > 0 && isUsefulText(message.text))
        .filter((message) => {
            const key = `${message.role}\u0000${message.normalizedText}\u0000${message.timestamp}`;
            if (dedup.has(key)) return false;
            dedup.add(key);
            return true;
        })
        .sort((a, b) => a.timestamp - b.timestamp);
}

function findNearest(rows, predicate, rawMessage, excludedIds = new Set()) {
    let best = null;
    let bestDelta = Number.POSITIVE_INFINITY;
    for (const row of rows) {
        if (row?.id && excludedIds.has(row.id)) continue;
        if (!predicate(row)) continue;
        const delta = Math.abs((Number(row.timestamp) || 0) - rawMessage.timestamp);
        if (delta > NEAR_WINDOW_MS) continue;
        if (delta < bestDelta) {
            best = row;
            bestDelta = delta;
        }
    }
    return best;
}

async function reconcileCreatorMessagesFromRaw({
    creatorId,
    creatorName,
    operator,
    rawMessages,
    dryRun = false,
}) {
    const normalizedRaw = normalizeRawMessages(rawMessages);
    if (normalizedRaw.length ***REMOVED***= 0) {
        return {
            creator_id: creatorId,
            creator_name: creatorName,
            checked_messages: 0,
            inserted_count: 0,
            updated_count: 0,
            deleted_count: 0,
            inserted_samples: [],
            updated_samples: [],
            deleted_samples: [],
            note: 'no useful raw messages',
        };
    }

    const db2 = db.getDb();
    const minTs = normalizedRaw[0].timestamp - QUERY_PADDING_MS;
    const maxTs = normalizedRaw[normalizedRaw.length - 1].timestamp + QUERY_PADDING_MS;
    const existingRows = (await db2.prepare(`
        SELECT id, role, text, timestamp
        FROM wa_messages
        WHERE creator_id = ?
          AND timestamp BETWEEN ? AND ?
        ORDER BY timestamp ASC, id ASC
    `).all(creatorId, minTs, maxTs)).map((row) => ({
        ...row,
        timestamp: Number(row.timestamp) || 0,
        normalizedText: normalizeMessageText(row.text),
    }));

    const matchedIds = new Set();
    const effectiveRows = [];
    const inserts = [];
    const roleUpdates = [];

    for (const rawMessage of normalizedRaw) {
        const sameRoleNear = findNearest(
            existingRows,
            (row) => row.role ***REMOVED***= rawMessage.role && row.normalizedText ***REMOVED***= rawMessage.normalizedText,
            rawMessage,
            matchedIds
        );
        if (sameRoleNear) {
            matchedIds.add(sameRoleNear.id);
            effectiveRows.push({
                id: sameRoleNear.id,
                role: sameRoleNear.role,
                normalizedText: sameRoleNear.normalizedText,
                timestamp: sameRoleNear.timestamp,
            });
            continue;
        }

        const diffRoleNear = existingRows.filter((row) =>
            !matchedIds.has(row.id)
            && row.role !***REMOVED*** rawMessage.role
            && row.normalizedText ***REMOVED***= rawMessage.normalizedText
            && Math.abs(row.timestamp - rawMessage.timestamp) <= NEAR_WINDOW_MS
        );

        if (diffRoleNear.length ***REMOVED***= 1) {
            const candidate = diffRoleNear[0];
            matchedIds.add(candidate.id);
            roleUpdates.push({
                id: candidate.id,
                from_role: candidate.role,
                to_role: rawMessage.role,
                text: rawMessage.text,
                timestamp: rawMessage.timestamp,
            });
            effectiveRows.push({
                id: candidate.id,
                role: rawMessage.role,
                normalizedText: rawMessage.normalizedText,
                timestamp: candidate.timestamp,
            });
            continue;
        }

        inserts.push(rawMessage);
        effectiveRows.push({
            id: null,
            role: rawMessage.role,
            normalizedText: rawMessage.normalizedText,
            timestamp: rawMessage.timestamp,
        });
    }

    const deletes = [];
    for (const row of existingRows) {
        if (matchedIds.has(row.id)) continue;
        const supportedByRaw = effectiveRows.some((effective) =>
            effective.normalizedText ***REMOVED***= row.normalizedText
            && Math.abs(effective.timestamp - row.timestamp) <= NEAR_WINDOW_MS
        );
        if (!supportedByRaw) continue;
        deletes.push({
            id: row.id,
            role: row.role,
            text: row.text,
            timestamp: row.timestamp,
        });
    }

    if (!dryRun) {
        if (roleUpdates.length > 0) {
            const stmt = db2.prepare('UPDATE wa_messages SET role = ? WHERE id = ?');
            for (const row of roleUpdates) {
                await stmt.run(row.to_role, row.id);
            }
        }

        if (deletes.length > 0) {
            const stmt = db2.prepare('DELETE FROM wa_messages WHERE id = ?');
            for (const row of deletes) {
                await stmt.run(row.id);
            }
        }

        if (inserts.length > 0) {
            const values = inserts.map((row) => [
                creatorId,
                row.role,
                operator || null,
                row.text,
                row.timestamp,
                buildMessageHash(row.role, row.text, row.timestamp),
            ]);
            const placeholders = values.map(() => '(?, ?, ?, ?, ?, ?)').join(', ');
            await db2.prepare(`
                INSERT IGNORE INTO wa_messages (creator_id, role, operator, text, timestamp, message_hash)
                VALUES ${placeholders}
            `).run(...values.flat());
        }

        if (roleUpdates.length > 0 || deletes.length > 0 || inserts.length > 0) {
            await db2.prepare('UPDATE creators SET updated_at = NOW() WHERE id = ?').run(creatorId);
        }
    }

    return {
        creator_id: creatorId,
        creator_name: creatorName,
        checked_messages: normalizedRaw.length,
        inserted_count: inserts.length,
        updated_count: roleUpdates.length,
        deleted_count: deletes.length,
        inserted_samples: inserts.slice(0, 3),
        updated_samples: roleUpdates.slice(0, 3),
        deleted_samples: deletes.slice(0, 3),
    };
}

async function syncCreatorMessagesFromRaw({
    creatorId,
    creatorName,
    operator,
    rawMessages,
    dryRun = false,
}) {
    const normalizedRaw = normalizeRawMessages(rawMessages);
    if (normalizedRaw.length ***REMOVED***= 0) {
        return {
            creator_id: creatorId,
            creator_name: creatorName,
            checked_messages: 0,
            inserted_count: 0,
            skipped_count: 0,
            inserted_samples: [],
            note: 'no useful raw messages',
        };
    }

    const db2 = db.getDb();
    const minTs = Math.max(0, normalizedRaw[0].timestamp - QUERY_PADDING_MS);
    const maxTs = normalizedRaw[normalizedRaw.length - 1].timestamp + QUERY_PADDING_MS;
    const existingRows = await db2.prepare(`
        SELECT role, text, timestamp
        FROM wa_messages
        WHERE creator_id = ?
          AND timestamp BETWEEN ? AND ?
    `).all(creatorId, minTs, maxTs);

    const existingKeys = new Set(existingRows.map((row) => {
        const role = row?.role ***REMOVED***= 'me' ? 'me' : 'user';
        const text = normalizeMessageText(row?.text);
        const timestamp = Number(row?.timestamp) || 0;
        return `${role}\u0000${text}\u0000${timestamp}`;
    }));

    const inserts = normalizedRaw.filter((row) => {
        const key = `${row.role}\u0000${row.normalizedText}\u0000${row.timestamp}`;
        if (existingKeys.has(key)) return false;
        existingKeys.add(key);
        return true;
    });

    if (!dryRun && inserts.length > 0) {
        const values = inserts.map((row) => [
            creatorId,
            row.role,
            operator || null,
            row.text,
            row.timestamp,
            buildMessageHash(row.role, row.text, row.timestamp),
        ]);
        const placeholders = values.map(() => '(?, ?, ?, ?, ?, ?)').join(', ');
        await db2.prepare(`
            INSERT IGNORE INTO wa_messages (creator_id, role, operator, text, timestamp, message_hash)
            VALUES ${placeholders}
        `).run(...values.flat());
        await db2.prepare('UPDATE creators SET updated_at = NOW() WHERE id = ?').run(creatorId);
    }

    return {
        creator_id: creatorId,
        creator_name: creatorName,
        checked_messages: normalizedRaw.length,
        inserted_count: inserts.length,
        skipped_count: normalizedRaw.length - inserts.length,
        inserted_samples: inserts.slice(0, 3),
    };
}

module.exports = {
    reconcileCreatorMessagesFromRaw,
    syncCreatorMessagesFromRaw,
};
