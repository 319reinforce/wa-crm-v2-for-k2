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
    if (/^[A-Za-z0-9+/=]{512,}$/.test(compact) && compact.length % 4 === 0) return true;
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

function isValidWindow(minTs, maxTs) {
    return Number.isFinite(minTs) && Number.isFinite(maxTs) && maxTs >= minTs;
}

async function cleanupDuplicateMessages(db2, creatorId, minTs, maxTs, { full = false } = {}) {
    const useWindow = !full && isValidWindow(minTs, maxTs);
    const windowFilter = useWindow
        ? 'AND m1.timestamp BETWEEN ? AND ? AND m2.timestamp BETWEEN ? AND ?'
        : '';
    const params = [creatorId];
    if (useWindow) params.push(minTs, maxTs, minTs, maxTs);
    const result = await db2.prepare(`
        DELETE m1 FROM wa_messages m1
        JOIN wa_messages m2
          ON m1.creator_id = m2.creator_id
         AND m1.role = m2.role
         AND m1.text = m2.text
         AND m1.timestamp = m2.timestamp
         AND m1.id > m2.id
        WHERE m1.creator_id = ?
          ${windowFilter}
          AND (m1.message_hash IS NULL OR m2.message_hash IS NULL)
    `).run(...params);
    return Number(result?.changes || 0);
}

async function backfillMessageHashes(db2, creatorId, minTs, maxTs, {
    full = false,
    limit = 2000,
} = {}) {
    const safeLimit = Number.isFinite(limit) ? Math.max(100, Math.floor(limit)) : 2000;
    const useWindow = !full && isValidWindow(minTs, maxTs);
    const windowFilter = useWindow
        ? 'AND timestamp BETWEEN ? AND ?'
        : '';
    const params = [creatorId];
    if (useWindow) params.push(minTs, maxTs);
    const rows = await db2.prepare(`
        SELECT id, role, text, timestamp
        FROM wa_messages
        WHERE creator_id = ?
          AND message_hash IS NULL
          ${windowFilter}
        ORDER BY id ASC
        LIMIT ${safeLimit}
    `).all(...params);
    if (!rows.length) return { updated: 0, deleted: 0 };
    let updated = 0;
    let deleted = 0;
    const updateStmt = db2.prepare('UPDATE wa_messages SET message_hash = ? WHERE id = ?');
    const deleteStmt = db2.prepare('DELETE FROM wa_messages WHERE id = ?');
    for (const row of rows) {
        const hash = buildMessageHash(row.role, row.text, row.timestamp);
        try {
            const res = await updateStmt.run(hash, row.id);
            if (res?.changes) updated += res.changes;
        } catch (_) {
            const res = await deleteStmt.run(row.id);
            if (res?.changes) deleted += res.changes;
        }
    }
    return { updated, deleted };
}

function normalizeRawMessages(rawMessages = []) {
    const dedup = new Set();
    return (Array.isArray(rawMessages) ? rawMessages : [])
        .map((message) => {
            const role = message?.role === 'me' ? 'me' : 'user';
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
    fullDedup = false,
    dryRun = false,
}) {
    const normalizedRaw = normalizeRawMessages(rawMessages);
    if (normalizedRaw.length === 0) {
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
            (row) => row.role === rawMessage.role && row.normalizedText === rawMessage.normalizedText,
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
            && row.role !== rawMessage.role
            && row.normalizedText === rawMessage.normalizedText
            && Math.abs(row.timestamp - rawMessage.timestamp) <= NEAR_WINDOW_MS
        );

        if (diffRoleNear.length === 1) {
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
            effective.normalizedText === row.normalizedText
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

    let cleanup = null;
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

        const duplicateDeleted = await cleanupDuplicateMessages(db2, creatorId, minTs, maxTs, { full: fullDedup });
        const hashBackfill = await backfillMessageHashes(db2, creatorId, minTs, maxTs, { full: fullDedup });
        cleanup = { duplicate_deleted: duplicateDeleted, hash_backfill: hashBackfill };
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
        cleanup,
    };
}

async function syncCreatorMessagesFromRaw({
    creatorId,
    creatorName,
    operator,
    rawMessages,
    fullDedup = false,
    dryRun = false,
}) {
    const normalizedRaw = normalizeRawMessages(rawMessages);
    if (normalizedRaw.length === 0) {
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
        const role = row?.role === 'me' ? 'me' : 'user';
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

    let cleanup = null;
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

    if (!dryRun) {
        const duplicateDeleted = await cleanupDuplicateMessages(db2, creatorId, minTs, maxTs, { full: fullDedup });
        const hashBackfill = await backfillMessageHashes(db2, creatorId, minTs, maxTs, { full: fullDedup });
        cleanup = { duplicate_deleted: duplicateDeleted, hash_backfill: hashBackfill };
    }

    return {
        creator_id: creatorId,
        creator_name: creatorName,
        checked_messages: normalizedRaw.length,
        inserted_count: inserts.length,
        skipped_count: normalizedRaw.length - inserts.length,
        inserted_samples: inserts.slice(0, 3),
        cleanup,
    };
}

async function replaceCreatorMessagesFromRaw({
    creatorId,
    creatorName,
    operator,
    rawMessages,
    deleteAll = false,
    fullDedup = false,
    dryRun = false,
}) {
    const normalizedRaw = normalizeRawMessages(rawMessages);
    if (normalizedRaw.length === 0) {
        return {
            creator_id: creatorId,
            creator_name: creatorName,
            checked_messages: 0,
            inserted_count: 0,
            deleted_count: 0,
            inserted_samples: [],
            note: 'no useful raw messages',
        };
    }

    const db2 = db.getDb();
    const minTs = Math.max(0, normalizedRaw[0].timestamp - QUERY_PADDING_MS);
    const maxTs = normalizedRaw[normalizedRaw.length - 1].timestamp + QUERY_PADDING_MS;
    const existingCountRow = deleteAll
        ? await db2.prepare(`
            SELECT COUNT(*) AS count
            FROM wa_messages
            WHERE creator_id = ?
        `).get(creatorId)
        : await db2.prepare(`
            SELECT COUNT(*) AS count
            FROM wa_messages
            WHERE creator_id = ?
              AND timestamp BETWEEN ? AND ?
        `).get(creatorId, minTs, maxTs);
    const existingCount = Number(existingCountRow?.count) || 0;

    let cleanup = null;
    if (!dryRun) {
        if (deleteAll) {
            await db2.prepare(`
                DELETE FROM wa_messages
                WHERE creator_id = ?
            `).run(creatorId);
        } else {
            await db2.prepare(`
                DELETE FROM wa_messages
                WHERE creator_id = ?
                  AND timestamp BETWEEN ? AND ?
            `).run(creatorId, minTs, maxTs);
        }

        const values = normalizedRaw.map((row) => [
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

        const duplicateDeleted = await cleanupDuplicateMessages(db2, creatorId, minTs, maxTs, { full: fullDedup });
        const hashBackfill = await backfillMessageHashes(db2, creatorId, minTs, maxTs, { full: fullDedup });
        cleanup = { duplicate_deleted: duplicateDeleted, hash_backfill: hashBackfill };
    }

    return {
        creator_id: creatorId,
        creator_name: creatorName,
        checked_messages: normalizedRaw.length,
        inserted_count: normalizedRaw.length,
        deleted_count: existingCount,
        inserted_samples: normalizedRaw.slice(0, 3),
        deleted_scope: deleteAll ? 'all' : 'window',
        window_start: minTs,
        window_end: maxTs,
        cleanup,
    };
}

module.exports = {
    reconcileCreatorMessagesFromRaw,
    syncCreatorMessagesFromRaw,
    replaceCreatorMessagesFromRaw,
};
