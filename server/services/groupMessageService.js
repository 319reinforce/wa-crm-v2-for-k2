const db = require('../../db');
const { sha256 } = require('../utils/crypto');
const { normalizeMessageText, toTimestampMs } = require('./messageDedupService');

let schemaReady = false;
const REQUIRED_GROUP_MESSAGE_TABLES = ['wa_group_chats', 'wa_group_messages'];

function normalizeRole(value) {
    return value === 'me' ? 'me' : 'user';
}

function normalizeGroupName(value) {
    return String(value || '').trim() || 'Unnamed Group';
}

function normalizeChatId(value) {
    return String(value || '').trim();
}

function isUsefulText(text) {
    const normalized = normalizeMessageText(text);
    return !!normalized;
}

function extractAuthorPhone(authorJid = '') {
    const raw = String(authorJid || '').trim();
    if (!raw) return null;
    return raw.split('@')[0] || null;
}

function buildGroupMessageHash({ chatId, authorJid, role, text, timestamp }) {
    return sha256(`${chatId || ''}|${authorJid || ''}|${role || ''}|${text || ''}|${timestamp || ''}`);
}

function buildMessageFingerprint(text, timestamp, role = '') {
    const normalizedText = normalizeMessageText(text);
    const normalizedRole = normalizeRole(role);
    const timestampMs = toTimestampMs(timestamp);
    return sha256(`${normalizedRole}|${normalizedText || ''}|${timestampMs || 0}`);
}

function buildConflictKey({ role, text, timestamp }) {
    const normalizedText = normalizeMessageText(text);
    const timestampMs = toTimestampMs(timestamp);
    if (!normalizedText || timestampMs <= 0) return '';
    return `${normalizeRole(role)}\u0000${normalizedText}\u0000${timestampMs}`;
}

function buildGroupScopeMatch({ sessionId, operator }) {
    const normalizedSessionId = String(sessionId || '').trim();
    const normalizedOperator = String(operator || '').trim();

    if (normalizedSessionId && normalizedOperator) {
        return {
            clause: '((gm.session_id = ? OR gc.session_id = ?) AND (gm.operator = ? OR gc.operator = ?))',
            params: [normalizedSessionId, normalizedSessionId, normalizedOperator, normalizedOperator],
        };
    }
    if (normalizedSessionId) {
        return {
            clause: '(gm.session_id = ? OR gc.session_id = ?)',
            params: [normalizedSessionId, normalizedSessionId],
        };
    }
    if (normalizedOperator) {
        return {
            clause: '(gm.operator = ? OR gc.operator = ?)',
            params: [normalizedOperator, normalizedOperator],
        };
    }
    return { clause: '', params: [] };
}

async function findScopedGroupConflicts(dbConn, {
    sessionId,
    operator,
    messages,
}) {
    const normalized = (Array.isArray(messages) ? messages : [])
        .map((message) => ({
            ...message,
            role: normalizeRole(message?.role),
            text: normalizeMessageText(message?.text),
            timestamp: toTimestampMs(message?.timestamp),
        }))
        .filter((message) => message.timestamp > 0 && isUsefulText(message.text));
    if (normalized.length === 0) {
        return { normalized, pollutedKeys: new Set() };
    }

    const scope = buildGroupScopeMatch({ sessionId, operator });
    if (!scope.clause) {
        return { normalized, pollutedKeys: new Set() };
    }

    const candidateKeys = new Set(normalized.map((message) => buildConflictKey(message)).filter(Boolean));
    if (candidateKeys.size === 0) {
        return { normalized, pollutedKeys: new Set() };
    }

    const minTs = Math.min(...normalized.map((message) => message.timestamp));
    const maxTs = Math.max(...normalized.map((message) => message.timestamp));
    const roles = [...new Set(normalized.map((message) => normalizeRole(message.role)))];
    const roleClause = roles.length > 0
        ? `AND gm.role IN (${roles.map(() => '?').join(', ')})`
        : '';
    const rows = await dbConn.prepare(`
        SELECT gm.role, gm.text, gm.timestamp
        FROM wa_group_messages gm
        JOIN wa_group_chats gc ON gc.id = gm.group_chat_id
        WHERE ${scope.clause}
          AND gm.timestamp BETWEEN ? AND ?
          ${roleClause}
    `).all(...scope.params, minTs, maxTs, ...roles);

    const pollutedKeys = new Set();
    for (const row of rows) {
        const key = buildConflictKey(row);
        if (!key) continue;
        if (candidateKeys.has(key)) {
            pollutedKeys.add(key);
        }
    }

    return { normalized, pollutedKeys };
}

async function ensureGroupMessageSchema(dbConn = db.getDb()) {
    if (schemaReady) return;
    const rows = await dbConn.prepare(`
        SELECT TABLE_NAME AS table_name
        FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME IN (${REQUIRED_GROUP_MESSAGE_TABLES.map(() => '?').join(', ')})
    `).all(...REQUIRED_GROUP_MESSAGE_TABLES);
    const existing = new Set(rows.map((row) => row.table_name));
    const missing = REQUIRED_GROUP_MESSAGE_TABLES.filter((table) => !existing.has(table));
    if (missing.length > 0) {
        throw new Error(`WA group message schema is missing ${missing.join(', ')}; run server/migrations/006_managed_runtime_tables.sql`);
    }
    schemaReady = true;
}

async function upsertGroupChat({
    dbConn = db.getDb(),
    sessionId,
    operator,
    chatId,
    groupName,
    lastActive,
}) {
    await ensureGroupMessageSchema(dbConn);
    const normalizedSessionId = String(sessionId || '').trim();
    const normalizedChatId = normalizeChatId(chatId);
    if (!normalizedSessionId || !normalizedChatId) return null;

    await dbConn.prepare(`
        INSERT INTO wa_group_chats (session_id, operator, chat_id, group_name, last_active, last_synced)
        VALUES (?, ?, ?, ?, ?, NOW())
        ON DUPLICATE KEY UPDATE
            operator = VALUES(operator),
            group_name = VALUES(group_name),
            last_active = GREATEST(COALESCE(last_active, 0), COALESCE(VALUES(last_active), 0)),
            last_synced = NOW()
    `).run(
        normalizedSessionId,
        operator || null,
        normalizedChatId,
        normalizeGroupName(groupName),
        Number.isFinite(Number(lastActive)) ? Number(lastActive) : null
    );

    return await dbConn.prepare(`
        SELECT id, session_id, operator, chat_id, group_name, last_active, last_synced
        FROM wa_group_chats
        WHERE session_id = ? AND chat_id = ?
        LIMIT 1
    `).get(normalizedSessionId, normalizedChatId);
}

function normalizeGroupMessages(messages = [], { chatId } = {}) {
    const dedup = new Set();
    return (Array.isArray(messages) ? messages : [])
        .map((message) => {
            const text = normalizeMessageText(message?.text || message?.body || '');
            const timestamp = toTimestampMs(message?.timestamp || message?.timestamp_ms || 0);
            const authorJid = String(message?.author_jid || message?.author || '').trim() || null;
            const role = normalizeRole(message?.role);
            const fingerprint = buildMessageFingerprint(text, timestamp, role);
            return {
                role,
                text,
                timestamp,
                author_jid: authorJid,
                author_phone: extractAuthorPhone(authorJid),
                author_name: String(message?.author_name || '').trim() || null,
                message_hash: buildGroupMessageHash({
                    chatId,
                    authorJid,
                    role,
                    text,
                    timestamp,
                }),
                message_fingerprint: fingerprint,
            };
        })
        .filter((message) => message.timestamp > 0 && isUsefulText(message.text))
        .filter((message) => {
            const key = `${message.message_hash}|${message.message_fingerprint}`;
            if (dedup.has(key)) return false;
            dedup.add(key);
            return true;
        });
}

async function persistGroupMessages({
    dbConn = db.getDb(),
    sessionId,
    operator,
    chatId,
    groupName,
    messages,
}) {
    await ensureGroupMessageSchema(dbConn);
    const groupChat = await upsertGroupChat({
        dbConn,
        sessionId,
        operator,
        chatId,
        groupName,
        lastActive: Math.max(...normalizeGroupMessages(messages, { chatId }).map((item) => item.timestamp), 0),
    });
    if (!groupChat?.id) {
        return { ok: false, inserted: 0 };
    }

    const normalizedMessages = normalizeGroupMessages(messages, { chatId });
    if (normalizedMessages.length === 0) {
        return { ok: true, inserted: 0, group_chat_id: groupChat.id };
    }

    const values = normalizedMessages.map((message) => [
        groupChat.id,
        String(sessionId || '').trim(),
        operator || null,
        normalizeChatId(chatId),
        message.role,
        message.author_jid,
        message.author_phone,
        message.author_name,
        message.text,
        message.timestamp,
        message.message_hash,
        message.message_fingerprint,
    ]);
    const placeholders = values.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ');
    const insertResult = await dbConn.prepare(`
        INSERT IGNORE INTO wa_group_messages (
            group_chat_id,
            session_id,
            operator,
            chat_id,
            role,
            author_jid,
            author_phone,
            author_name,
            text,
            timestamp,
            message_hash,
            message_fingerprint
        )
        VALUES ${placeholders}
    `).run(...values.flat());

    await dbConn.prepare(`
        UPDATE wa_group_chats
        SET group_name = ?, last_active = GREATEST(COALESCE(last_active, 0), ?), last_synced = NOW()
        WHERE id = ?
    `).run(
        normalizeGroupName(groupName),
        Math.max(...normalizedMessages.map((item) => item.timestamp), 0),
        groupChat.id
    );

    return {
        ok: true,
        inserted: Number(insertResult?.changes || 0),
        group_chat_id: groupChat.id,
    };
}

async function filterDirectMessagesAgainstGroups(dbConn, {
    sessionId,
    operator,
    messages,
}) {
    await ensureGroupMessageSchema(dbConn);
    const allMessages = Array.isArray(messages) ? messages : [];
    if (allMessages.length === 0) {
        return { kept: [], dropped: [] };
    }

    const { pollutedKeys } = await findScopedGroupConflicts(dbConn, {
        sessionId,
        operator,
        messages: allMessages,
    });

    // conflict key 仅由 (role, 有效文本, timestamp) 构造。媒体/空文本消息天然无 key,
    // 永远不会命中 pollutedKeys,应直接放行——而不是被当成 `normalized.length === 0`
    // 的 "没东西可 check" 连带丢弃。早期实现丢了这批消息导致达人发送图片时
    // insertMessages 收到空 kept、整条消息被静默吞掉。
    if (pollutedKeys.size === 0) {
        return { kept: allMessages, dropped: [] };
    }

    const kept = [];
    const dropped = [];
    for (const message of allMessages) {
        const key = buildConflictKey({
            role: message?.role,
            text: message?.text,
            timestamp: message?.timestamp,
        });
        if (key && pollutedKeys.has(key)) {
            dropped.push(message);
        } else {
            kept.push(message);
        }
    }
    return { kept, dropped };
}

async function purgeCreatorMessagesMatchingGroups(dbConn, {
    creatorId,
    sessionId,
    operator,
    minTs,
    maxTs,
}) {
    await ensureGroupMessageSchema(dbConn);
    const useWindow = Number.isFinite(Number(minTs)) && Number.isFinite(Number(maxTs)) && Number(maxTs) >= Number(minTs);
    const rows = useWindow
        ? await dbConn.prepare(`
            SELECT id, role, text, timestamp
            FROM wa_messages
            WHERE creator_id = ?
              AND timestamp BETWEEN ? AND ?
        `).all(creatorId, minTs, maxTs)
        : await dbConn.prepare(`
            SELECT id, role, text, timestamp
            FROM wa_messages
            WHERE creator_id = ?
        `).all(creatorId);
    if (!rows.length) return 0;
    const { pollutedKeys } = await findScopedGroupConflicts(dbConn, {
        sessionId,
        operator,
        messages: rows,
    });
    if (pollutedKeys.size === 0) return 0;

    const deleteIds = rows
        .filter((row) => pollutedKeys.has(buildConflictKey(row)))
        .map((row) => row.id);
    if (deleteIds.length === 0) return 0;

    const deletePlaceholders = deleteIds.map(() => '?').join(', ');
    const result = await dbConn.prepare(`
        DELETE FROM wa_messages
        WHERE creator_id = ?
          AND id IN (${deletePlaceholders})
    `).run(creatorId, ...deleteIds);
    return Number(result?.changes || 0);
}

async function listGroupChats({
    operator = '',
    sessionId = '',
    search = '',
    limit = 200,
}) {
    const dbConn = db.getDb();
    await ensureGroupMessageSchema(dbConn);
    const params = [];
    const where = ['1=1'];
    if (operator) {
        where.push('gc.operator = ?');
        params.push(operator);
    }
    if (sessionId) {
        where.push('gc.session_id = ?');
        params.push(String(sessionId).trim());
    }
    if (search) {
        where.push('gc.group_name LIKE ?');
        params.push(`%${String(search).trim()}%`);
    }

    return await dbConn.prepare(`
        SELECT
            gc.id,
            gc.session_id,
            gc.operator,
            gc.chat_id,
            gc.group_name,
            gc.last_active,
            gc.last_synced,
            COUNT(gm.id) AS msg_count
        FROM wa_group_chats gc
        LEFT JOIN wa_group_messages gm ON gm.group_chat_id = gc.id
        WHERE ${where.join(' AND ')}
        GROUP BY gc.id
        ORDER BY COALESCE(gc.last_active, 0) DESC, gc.id DESC
        LIMIT ${Math.max(1, Math.min(Number(limit) || 200, 500))}
    `).all(...params);
}

async function listGroupMessages(groupChatId, { limit = 100, offset = 0 } = {}) {
    const dbConn = db.getDb();
    await ensureGroupMessageSchema(dbConn);
    const safeLimit = Math.max(1, Math.min(Number(limit) || 100, 1000));
    const safeOffset = Math.max(0, Number(offset) || 0);
    const totalRow = await dbConn.prepare(`
        SELECT COUNT(*) AS total
        FROM wa_group_messages
        WHERE group_chat_id = ?
    `).get(groupChatId);
    const messages = await dbConn.prepare(`
        SELECT * FROM (
            SELECT *
            FROM wa_group_messages
            WHERE group_chat_id = ?
            ORDER BY timestamp DESC, id DESC
            LIMIT ${safeLimit} OFFSET ${safeOffset}
        ) recent
        ORDER BY timestamp ASC, id ASC
    `).all(groupChatId);
    return {
        messages,
        total: Number(totalRow?.total || 0),
        returned: messages.length,
        limit: safeLimit,
        offset: safeOffset,
    };
}

module.exports = {
    buildMessageFingerprint,
    buildConflictKey,
    ensureGroupMessageSchema,
    filterDirectMessagesAgainstGroups,
    listGroupChats,
    listGroupMessages,
    persistGroupMessages,
    purgeCreatorMessagesMatchingGroups,
    _private: {
        buildGroupScopeMatch,
        findScopedGroupConflicts,
        normalizeRole,
    },
};
