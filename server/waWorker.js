/**
 * WA Worker — WhatsApp 聊天记录爬虫（单账号版）
 * 实时监听 + 增量轮询，数据写入 MySQL
 *
 * 启动方式：node server/index.cjs（自动启动）
 */

require('dotenv').config();
const { getDb } = require('../db');
const { getClient, waitForReady, stop: stopWaService, getResolvedOwner, getDriverName, onDriverEvent } = require('./services/waService');
const { sha256 } = require('./utils/crypto');
const { normalizeOperatorName } = require('./utils/operator');
const {
    analyzeCreatorEligibility,
    getMessageText,
    normalizeCreatorOwner,
    normalizePhone,
} = require('./services/creatorEligibilityService');
const { resolveCanonicalCreator, invalidateOperatorCache } = require('./services/canonicalCreatorResolver');
const { getPrimaryAssignmentsByOperator } = require('./services/operatorRosterService');
const {
    filterShortWindowDuplicates,
    toTimestampMs,
} = require('./services/messageDedupService');
const { extractWaMessageId } = require('./utils/waMessageId');

// Optional-require for message cache (perf-cache branch). No-op when not present.
let invalidateMessageCache = () => {};
try {
    const cache = require('./services/messageCache');
    if (cache && typeof cache.invalidateCreator === 'function') {
        invalidateMessageCache = cache.invalidateCreator;
    }
} catch (_) {
    // messageCache module not installed; leave no-op.
}
const {
    ensureGroupMessageSchema,
    filterDirectMessagesAgainstGroups,
    persistGroupMessages,
    purgeCreatorMessagesMatchingGroups,
} = require('./services/groupMessageService');
const { getInternalServiceHeaders } = require('./utils/internalAuth');
const { perfLog } = require('./services/perfLog');
const { downloadAndStoreIncomingMedia, createIncomingMediaAsset } = require('./services/waIncomingMediaService');

// 从已序列化的消息对象中提取 _mediaData 并存储为 media asset
// _mediaData 是 WWebJS 的 MediaData 对象（含 data/base64 和 mimetype）
async function processMediaDataFromMessage(msg) {
    const mediaData = msg._mediaData;
    if (!mediaData?.data || !mediaData?.mimetype) return null;
    try {
        const { asset: mediaAsset, compressed } = await createIncomingMediaAsset({
            mimeType: mediaData.mimetype,
            dataBase64: mediaData.data,
            meta: {
                source: 'poll',
                wa_msg_id: msg.id?._serialized || msg.id,
                from_me: msg.fromMe || false,
            },
        });
        return {
            mediaAssetId: mediaAsset.id,
            mediaType: mediaData.mimetype.startsWith('image/') ? 'image'
                : mediaData.mimetype.startsWith('video/') ? 'video'
                : mediaData.mimetype.startsWith('audio/') ? 'audio'
                : 'document',
            mime: mediaData.mimetype,
            size: mediaData.data.length,
            width: msg.width || null,
            height: msg.height || null,
            caption: (msg.body || msg.caption || '').trim() || null,
            thumbnail: mediaData.thumbnailhash ? 'available' : null,
            downloadStatus: 'success',
        };
    } catch (err) {
        console.warn(`${LOG_PREFIX}[Media] processMediaData failed: ${err.message}`);
        return null;
    }
}

// ================== 配置 ==================

function parsePollIntervalMs(rawValue) {
    const parsed = parseInt(rawValue || '', 10);
    if (!Number.isInteger(parsed) || parsed <= 0) return 60 * 1000;
    return Math.max(15 * 1000, parsed);
}

function formatPollInterval(intervalMs) {
    if (intervalMs % (60 * 1000) === 0) {
        return `${intervalMs / 60 / 1000} 分钟`;
    }
    return `${Math.round(intervalMs / 1000)} 秒`;
}

const POLL_INTERVAL_MS = parsePollIntervalMs(process.env.WA_POLL_INTERVAL_MS);   // 增量轮询间隔（默认60秒）
const HISTORY_MSG_LIMIT = 500;            // 常规历史消息拉取条数
const POLL_FETCH_LIMIT = 50;              // 增量轮询拉取条数
const ROSTER_HISTORY_MSG_LIMIT = 100000;  // roster 白名单全历史回溯上限
const GROUP_HISTORY_MSG_LIMIT = 300;
const GROUP_POLL_FETCH_LIMIT = 80;
const WA_OWNER = normalizeOperatorName(process.env.WA_OWNER, 'Beau');
const WA_SESSION_ID = String(process.env.WA_SESSION_ID || process.env.PORT || '3000').trim();
const BASE_URL = process.env.WA_API_BASE || `http://localhost:${process.env.PORT || 3000}`; // 画像服务调用地址
const WORKER_TAG = `${WA_SESSION_ID}`;
const LOG_PREFIX = `[WA Worker:${WA_OWNER}/${WORKER_TAG}]`;
const DIRECT_CHAT_SUFFIXES = ['@c.us', '@lid'];

function maskPhone(phone) {
    const digits = String(phone || '').replace(/\D/g, '');
    if (digits.length <= 4) return '***';
    return `***${digits.slice(-4)}`;
}

function resolveCurrentOwner() {
    return normalizeOperatorName(getResolvedOwner(), WA_OWNER);
}

// ================== 达人准入过滤 ==================

function mapMessagesForEligibility(messages = []) {
    return (messages || []).map((message) => ({
        text: getWaMessageText(message),
        timestamp: getWaMessageTimestampMs(message),
    }));
}

function normalizeChatPhoneForLookup(phone) {
    return normalizePhone(phone).replace(/[^\d+]/g, '');
}

function phoneToChatId(phone) {
    const cleanPhone = normalizeChatPhoneForLookup(phone);
    if (!cleanPhone) return null;
    return cleanPhone.startsWith('+')
        ? `${cleanPhone.slice(1)}@c.us`
        : `${cleanPhone}@c.us`;
}

function extractSerializedChatId(entity) {
    return String(
        entity?.id?._serialized
        || entity?.id?.SerializedString
        || entity?.chatId?._serialized
        || entity?.chatId?.SerializedString
        || entity?.chat?.id?._serialized
        || entity?.chat?.id?.SerializedString
        || entity?.from
        || entity?.to
        || entity?._data?.id?.remote
        || entity?.rawData?.id?.remote
        || ''
    );
}

function isDirectChatId(chatId) {
    const normalized = String(chatId || '').trim().toLowerCase();
    if (!normalized) return false;
    if (normalized.endsWith('@g.us')) return false;
    if (normalized.endsWith('@broadcast')) return false;
    if (normalized === 'status@broadcast') return false;
    return DIRECT_CHAT_SUFFIXES.some((suffix) => normalized.endsWith(suffix));
}

function isGroupChatId(chatId) {
    const normalized = String(chatId || '').trim().toLowerCase();
    return normalized.endsWith('@g.us');
}

function isDirectChat(chat) {
    if (!chat) return false;
    if (chat?.isGroup === true) return false;
    return isDirectChatId(extractSerializedChatId(chat));
}

function isGroupChat(chat) {
    if (!chat) return false;
    if (chat?.isGroup === true) return true;
    return isGroupChatId(extractSerializedChatId(chat));
}

function isDirectMessage(message, chat = null) {
    const candidates = [
        extractSerializedChatId(message),
        message?.author,
        message?._data?.author,
        message?.rawData?.author,
    ].filter(Boolean);

    for (const candidate of candidates) {
        const value = String(candidate).toLowerCase();
        if (value.endsWith('@g.us') || value.endsWith('@broadcast')) return false;
        if (isDirectChatId(value)) return true;
    }

    return isDirectChat(chat);
}

function getChatRecencyTs(chat) {
    const raw = chat?.timestamp
        ?? chat?._data?.t
        ?? chat?.lastMessage?.timestamp
        ?? chat?.lastMessage?._data?.t
        ?? 0;
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) return 0;
    return n > 1e12 ? Math.floor(n) : Math.floor(n * 1000);
}

function pickPreferredChatEntry(current, candidate) {
    if (!current) return candidate;
    const currentTs = Number(current.recencyTs || 0);
    const candidateTs = Number(candidate.recencyTs || 0);
    if (candidateTs > currentTs) return candidate;
    if (candidateTs < currentTs) return current;

    const currentId = String(current.chatId || '');
    const candidateId = String(candidate.chatId || '');
    if (!currentId) return candidate;
    if (!candidateId) return current;
    return candidateId > currentId ? candidate : current;
}

const DIRECT_CHAT_CACHE_TTL_MS = 60 * 1000;
let directChatCache = {
    entries: null,
    byPhone: new Map(),
    expiresAt: 0,
};
let groupChatCache = {
    entries: null,
    expiresAt: 0,
};

function getCachedDirectChatEntry(phone) {
    if (!directChatCache.entries) return null;
    if (Date.now() > directChatCache.expiresAt) return null;
    return directChatCache.byPhone.get(phone) || null;
}

async function buildDirectChatEntries(client, { force = false } = {}) {
    const now = Date.now();
    if (!force && directChatCache.entries && now <= directChatCache.expiresAt) {
        return directChatCache.entries;
    }
    const chats = await client.getChats();
    const byPhone = new Map();
    for (const chat of chats || []) {
        if (!isDirectChat(chat)) continue;
        const contact = await chat.getContact().catch(() => null);
        if (!contact?.number) continue;
        const phone = normalizePhone(contact.number || '');
        if (!phone) continue;
        const entry = {
            chat,
            contact,
            phone,
            name: contact.name || contact.pushname || chat.name || 'Unknown',
            recencyTs: getChatRecencyTs(chat),
            chatId: extractSerializedChatId(chat),
        };
        byPhone.set(phone, pickPreferredChatEntry(byPhone.get(phone), entry));
    }
    const entries = [...byPhone.values()];
    directChatCache = {
        entries,
        byPhone,
        expiresAt: now + DIRECT_CHAT_CACHE_TTL_MS,
    };
    return entries;
}

async function buildGroupChatEntries(client, { force = false } = {}) {
    const now = Date.now();
    if (!force && groupChatCache.entries && now <= groupChatCache.expiresAt) {
        return groupChatCache.entries;
    }
    const chats = await client.getChats();
    const entries = (chats || [])
        .filter((chat) => isGroupChat(chat))
        .map((chat) => ({
            chat,
            chatId: extractSerializedChatId(chat),
            name: chat?.name || 'Unnamed Group',
            recencyTs: getChatRecencyTs(chat),
        }))
        .filter((entry) => entry.chatId);
    groupChatCache = {
        entries,
        expiresAt: now + DIRECT_CHAT_CACHE_TTL_MS,
    };
    return entries;
}

function buildRosterIndex(rows = []) {
    const byPhone = new Map();
    const all = [];
    for (const row of rows || []) {
        if (!row?.creator_id) continue;
        const normalizedPhone = normalizePhone(row.wa_phone || '');
        const entry = {
            ...row,
            wa_phone: normalizedPhone,
            normalized_phone: normalizedPhone,
        };
        all.push(entry);
        if (normalizedPhone) {
            byPhone.set(normalizedPhone, entry);
        }
    }
    return { all, byPhone };
}

async function loadRosterIndex() {
    const rows = await getPrimaryAssignmentsByOperator(resolveCurrentOwner());
    return buildRosterIndex(rows);
}

function getEligibilityForHistory(phone, name, messages = []) {
    return analyzeCreatorEligibility(phone, name, mapMessagesForEligibility(messages), { mode: 'history' });
}

function getEligibilityForRealtime(phone, name, messages = []) {
    return analyzeCreatorEligibility(phone, name, mapMessagesForEligibility(messages), { mode: 'realtime' });
}

// ================== 消息去重缓存 ==================
// Key: `${chatId}|${msgId}|${timestamp}`，10分钟自动过期
// 防止实时 handler 和轮询同时拉取同一条消息
const dedupCache = new Map();
const DEDUP_TTL_MS = 10 * 60 * 1000;

function getWaMessageTimestampMs(message) {
    const raw = message?.timestamp_ms
        ?? message?.timestamp
        ?? message?.t
        ?? message?._data?.t
        ?? message?.rawData?.t
        ?? 0;
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) return 0;
    return n > 1e12 ? Math.floor(n) : Math.floor(n * 1000);
}

function getWaMessageRole(message) {
    const boolCandidates = [
        message?.fromMe,
        message?.id?.fromMe,
        message?._data?.fromMe,
        message?._data?.id?.fromMe,
        message?.rawData?.fromMe,
        message?.rawData?.id?.fromMe,
        message?.data?.fromMe,
        message?.data?.id?.fromMe,
    ];
    for (const candidate of boolCandidates) {
        if (typeof candidate === 'boolean') return candidate ? 'me' : 'user';
    }

    const directionCandidates = [
        message?.self,
        message?.selfDir,
        message?._data?.self,
        message?._data?.selfDir,
        message?.rawData?.self,
        message?.rawData?.selfDir,
    ];
    for (const candidate of directionCandidates) {
        if (candidate === 'out') return 'me';
        if (candidate === 'in') return 'user';
    }

    return 'user';
}

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

function getWaMessageText(message) {
    const text = String(
        message?.body
        ?? message?.text
        ?? message?.caption
        ?? ''
    );
    return isBinaryLikePayload(text) ? '' : text;
}

function getWaMessageAuthorJid(message) {
    return String(
        message?.author
        ?? message?._data?.author
        ?? message?.rawData?.author
        ?? ''
    ).trim() || null;
}

function getWaMessageAuthorName(message) {
    return String(
        message?.authorName
        ?? message?._data?.notifyName
        ?? message?.rawData?.notifyName
        ?? ''
    ).trim() || null;
}

function buildMessageHash(role, text, timestampMs) {
    return sha256(`${role || ''}|${text || ''}|${timestampMs || ''}`);
}

function dedupKey(msg) {
    const ts = getWaMessageTimestampMs(msg);
    const chatId = msg.chat?.id?._serialized || msg.chat?.id?.SerializedString || msg.from || '';
    const messageId = typeof msg.id === 'string'
        ? msg.id
        : msg.id?._serialized || msg.id?.id || JSON.stringify(msg.id || '');
    return `${chatId}||${messageId}||${ts}`;
}

function isAlreadyProcessed(msg) {
    const key = dedupKey(msg);
    if (dedupCache.has(key)) return true;
    if (dedupCache.size > 50000) dedupCache.clear();
    dedupCache.set(key, true);
    setTimeout(() => dedupCache.delete(key), DEDUP_TTL_MS);
    return false;
}

// ================== 进度追踪 ==================

const progress = {
    phase: 'idle',          // idle | init | sync | live
    totalChats: 0,
    processedChats: 0,
    newMessages: 0,
    errors: [],
    startedAt: null,
    lastPollAt: null,
    clientReady: false,
    clientError: null,
    owner: WA_OWNER,
    sessionId: WA_SESSION_ID,

    progressPct() {
        if (this.phase === 'init') return 5;
        if (this.phase === 'sync') {
            return this.totalChats > 0
                ? Math.round(5 + (this.processedChats / this.totalChats) * 85)
                : 5;
        }
        if (this.phase === 'live') return 100;
        return 0;
    },
    bar() {
        const pct = this.progressPct();
        const filled = Math.round(pct / 5);
        const empty = 20 - filled;
        return '█'.repeat(filled) + '░'.repeat(empty);
    },
    summary() {
        return `[${this.phase.toUpperCase()}] ${this.bar()} ${this.progressPct()}% | `
            + `${this.processedChats}/${this.totalChats} 达人 | `
            + `+${this.newMessages} 新消息 | `
            + `错误 ${this.errors.length}`;
    }
};

// ================== 消息写入 MySQL ==================

async function insertMessages(creatorId, messages) {
    if (!messages || messages.length === 0) return 0;
    const db2 = getDb();
    await ensureGroupMessageSchema(db2);
    const normalizedMessages = messages.map((m) => {
        const role = m.role || getWaMessageRole(m);
        const text = m.text || getWaMessageText(m);
        const timestampMs = m.timestamp_ms || m.timestamp
            ? toTimestampMs(m.timestamp || m.timestamp_ms)
            : getWaMessageTimestampMs(m);
        // wa_message_id 优先取调用方显式传入;否则从 WA 原始消息对象抽取。
        const waMessageId = typeof m.wa_message_id === 'string' && m.wa_message_id.trim()
            ? m.wa_message_id.trim()
            : extractWaMessageId(m.source || m.raw || m);
        return {
            creator_id: creatorId,
            role,
            operator: resolveCurrentOwner(),
            text,
            timestamp: timestampMs,
            wa_message_id: waMessageId || null,
            // 媒体字段（来自 downloadAndStoreIncomingMedia 结果）
            media_asset_id:         m.mediaInfo?.mediaAssetId || null,
            media_type:             m.mediaInfo?.mediaType || null,
            media_mime:             m.mediaInfo?.mime || null,
            media_size:             m.mediaInfo?.size || null,
            media_width:            m.mediaInfo?.width || null,
            media_height:           m.mediaInfo?.height || null,
            media_caption:          m.mediaInfo?.caption || null,
            media_thumbnail:        m.mediaInfo?.thumbnail || null,
            media_download_status:  m.mediaInfo?.mediaAssetId ? 'success' : (m.mediaInfo?.media_download_status || null),
        };
    });

    // short-window guard 仅对 role='assistant' 生效,避免误伤人工/镜像 outbound 与 inbound
    const assistantRows = normalizedMessages.filter((m) => m.role === 'assistant');
    const nonAssistantRows = normalizedMessages.filter((m) => m.role !== 'assistant');
    let kept = nonAssistantRows;
    if (assistantRows.length > 0) {
        const deduped = await filterShortWindowDuplicates(db2, creatorId, assistantRows, {
            windowMs: 15 * 60 * 1000,
            minTextLength: 12,
        });
        if (deduped.dropped.length > 0) {
            console.warn(`${LOG_PREFIX} short-window duplicate blocked (assistant): creator=${creatorId} dropped=${deduped.dropped.length}`);
        }
        kept = kept.concat(deduped.kept);
    }

    const groupFiltered = await filterDirectMessagesAgainstGroups(db2, {
        sessionId: WA_SESSION_ID,
        operator: resolveCurrentOwner(),
        messages: kept,
    });

    if (groupFiltered.dropped.length > 0) {
        console.warn(`${LOG_PREFIX} group contamination blocked: creator=${creatorId} dropped=${groupFiltered.dropped.length}`);
    }

    const ops = groupFiltered.kept.map((m) => {
        const messageHash = buildMessageHash(m.role, m.text, m.timestamp);
        return [
            creatorId, m.role, m.operator, m.text, m.timestamp, messageHash,
            m.wa_message_id || null,
            m.media_asset_id, m.media_type, m.media_mime, m.media_size,
            m.media_width, m.media_height, m.media_caption, m.media_thumbnail,
            m.media_download_status,
        ];
    }).filter(([, , , text, timestampMs, , , mediaAssetId]) =>
        (text && timestampMs > 0) || mediaAssetId
    );
    if (ops.length === 0) return 0;
    try {
        const result = await db2.prepare(
            `INSERT IGNORE INTO wa_messages
             (creator_id, role, operator, text, timestamp, message_hash,
              wa_message_id,
              media_asset_id, media_type, media_mime, media_size,
              media_width, media_height, media_caption, media_thumbnail,
              media_download_status)
             VALUES ${ops.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ')}`
        ).run(...ops.flat());
        const changes = Number(result?.changes || 0);
        if (changes > 0) {
            try { invalidateMessageCache(creatorId); } catch (_) {}
        }
        return ops.length;
    } catch (e) {
        console.error(`${LOG_PREFIX} insertMessages error:`, e.message);
        return 0;
    }
}

async function persistGroupChatMessages(chat, messages) {
    const db2 = getDb();
    await ensureGroupMessageSchema(db2);
    const chatId = extractSerializedChatId(chat);
    if (!chatId || !isGroupChatId(chatId)) return 0;
    const mapped = (messages || []).map((message) => ({
        role: getWaMessageRole(message),
        text: getWaMessageText(message),
        timestamp: getWaMessageTimestampMs(message),
        author_jid: getWaMessageAuthorJid(message),
        author_name: getWaMessageAuthorName(message),
    }));
    const result = await persistGroupMessages({
        dbConn: db2,
        sessionId: WA_SESSION_ID,
        operator: resolveCurrentOwner(),
        chatId,
        groupName: chat?.name || 'Unnamed Group',
        messages: mapped,
    });
    return Number(result?.inserted || 0);
}

async function fetchMessagesViaStore(chat, limit = HISTORY_MSG_LIMIT) {
    const c = getClient();
    const chatId = chat?.id?._serialized || chat?.id?.SerializedString;
    if (!c?.pupPage || !chatId) return [];

    try {
        if (typeof chat.syncHistory === 'function') {
            await chat.syncHistory().catch(() => false);
        }
    } catch (_) {}

    await new Promise((resolve) => setTimeout(resolve, 1500));

    // 在浏览器上下文中：获取原始 Message 对象，下载媒体，然后序列化
    return await c.pupPage.evaluate(async (targetChatId, targetLimit) => {
        const chatWid = window.Store.WidFactory.createWid(targetChatId);
        const model = window.Store.Chat.get(chatWid) ?? await window.Store.Chat.find(chatWid);
        if (!model?.msgs) return [];
        const msgs = model.msgs
            .getModelsArray()
            .filter((m) => !m.isNotification)
            .sort((a, b) => (a.t > b.t ? 1 : -1));
        const sliced = Number.isFinite(targetLimit) && targetLimit > 0
            ? msgs.slice(-targetLimit)
            : msgs;

        // 批量下载媒体（最多并发 3 个）
        const results = [];
        for (let i = 0; i < sliced.length; i += 3) {
            const batch = sliced.slice(i, i + 3);
            const batchResults = await Promise.all(
                batch.map(async (msgObj) => {
                    try {
                        if (msgObj.hasMedia) {
                            // 有媒体：在原始 Message 对象上调用 downloadMedia()
                            const mediaData = await Promise.race([
                                msgObj.downloadMedia(),
                                new Promise((_, reject) =>
                                    setTimeout(() => reject(new Error('download_timeout')), 15000)
                                ),
                            ]);
                            const serialized = window.WWebJS.getMessageModel(msgObj);
                            if (mediaData?.data) {
                                serialized._mediaData = mediaData; // 附加到序列化对象
                            }
                            return serialized;
                        }
                    } catch (_) {}
                    return window.WWebJS.getMessageModel(msgObj);
                })
            );
            results.push(...batchResults);
            // 批次间延迟，防止限流
            if (i + 3 < sliced.length) {
                await new Promise(r => setTimeout(r, 500));
            }
        }
        return results;
    }, chatId, limit);
}

async function fetchMessagesWithFallback(chat, limit = HISTORY_MSG_LIMIT) {
    const minExpected = Math.min(Math.max(Math.floor(limit * 0.35), 20), limit);
    try {
        const primary = await chat.fetchMessages({ limit });
        if (Array.isArray(primary) && primary.length >= minExpected) {
            return primary;
        }
        const secondary = await fetchMessagesViaStore(chat, limit);
        if (Array.isArray(secondary) && secondary.length > (primary?.length || 0)) {
            console.warn(`${LOG_PREFIX} fetchMessages hydrated via Store.Chat for ${chat?.name || chat?.id?._serialized || 'unknown chat'} (${primary?.length || 0} -> ${secondary.length})`);
            return secondary;
        }
        return primary;
    } catch (e) {
        const message = String(e?.message || '');
        if (!message.includes('waitForChatLoading')) {
            throw e;
        }
        console.warn(`${LOG_PREFIX} fetchMessages fallback via Store.Chat for ${chat?.name || chat?.id?._serialized || 'unknown chat'}`);
        return await fetchMessagesViaStore(chat, limit);
    }
}

async function resolveChatByPhone(client, phone) {
    const normalizedTarget = normalizePhone(phone || '');
    if (!normalizedTarget) return null;

    try {
        const cached = getCachedDirectChatEntry(normalizedTarget);
        if (cached) return cached.chat;

        const chatEntries = await buildDirectChatEntries(client);
        const matched = chatEntries
            .filter((entry) => entry.phone === normalizedTarget)
            .sort((a, b) => Number(b.recencyTs || 0) - Number(a.recencyTs || 0));
        if (matched.length > 0) {
            return matched[0].chat;
        }
    } catch (_) {}

    const chatId = phoneToChatId(normalizedTarget);
    if (!chatId) return null;

    let resolvedChatId = chatId;
    try {
        const wid = await client.getNumberId(chatId).catch(() => null);
        if (wid?._serialized) {
            resolvedChatId = wid._serialized;
        }
    } catch (_) {}

    try {
        const chat = await client.getChatById(resolvedChatId);
        if (!isDirectChat(chat)) return null;
        const contact = await chat.getContact().catch(() => null);
        const chatPhone = normalizePhone(contact?.number || '');
        if (chatPhone && chatPhone !== normalizedTarget) return null;
        return chat;
    } catch (_) {
        return null;
    }
}

async function syncRosterCreatorHistory(client, assignment, chat = null) {
    if (!assignment?.creator_id || !assignment?.wa_phone) return 0;

    const targetChat = chat || await resolveChatByPhone(client, assignment.wa_phone);
    if (!isDirectChat(targetChat)) return 0;

    const contact = await targetChat.getContact().catch(() => null);
    const name = contact?.name || contact?.pushname || assignment.primary_name || assignment.raw_name || 'Unknown';

    let wamessages;
    try {
        wamessages = await fetchMessagesWithFallback(targetChat, ROSTER_HISTORY_MSG_LIMIT);
    } catch (e) {
        console.warn(`${LOG_PREFIX} roster history fetch failed: creator=${assignment.creator_id} phone=${maskPhone(assignment.wa_phone)} error=${e.message}`);
        return 0;
    }

    const creatorId = assignment.creator_id;
    const inserted = await insertMessages(creatorId, wamessages.map((m) => ({
        role: getWaMessageRole(m),
        text: getWaMessageText(m),
        timestamp: getWaMessageTimestampMs(m),
        wa_message_id: extractWaMessageId(m),
    })));

    await getOrCreateCreator(assignment.wa_phone, name);
    if (inserted > 0) {
        await touchCreator(creatorId);
        console.log(`${LOG_PREFIX} 🧩 roster backfill ${name}: +${inserted} 条历史消息`);
    }
    return inserted;
}

// ================== 获取或创建达人 ==================

async function touchCreator(creatorId) {
    try {
        const db2 = getDb();
        await db2.prepare('UPDATE creators SET updated_at = NOW() WHERE id = ?').run(creatorId);
    } catch (_) {}
}

async function ensureCreatorRuntimeRows(creatorId) {
    const normalizedCreatorId = Number(creatorId || 0);
    if (!Number.isFinite(normalizedCreatorId) || normalizedCreatorId <= 0) {
        return creatorId;
    }
    try {
        const db2 = getDb();
        await db2.prepare('INSERT IGNORE INTO wa_crm_data (creator_id) VALUES (?)').run(normalizedCreatorId);
    } catch (error) {
        console.warn(`${LOG_PREFIX} ensureCreatorRuntimeRows failed for creator#${normalizedCreatorId}: ${error.message}`);
    }
    return normalizedCreatorId;
}

async function getOrCreateCreator(phone, name) {
    const db2 = getDb();
    const normalizedPhone = normalizePhone(phone);
    const resolved = await resolveCanonicalCreator({
        phone: normalizedPhone,
        name,
        operator: resolveCurrentOwner(),
    });
    if (resolved?.creatorId) {
        return await ensureCreatorRuntimeRows(resolved.creatorId);
    }

    let row = await db2.prepare('SELECT id, wa_owner FROM creators WHERE wa_phone = ?').get(normalizedPhone);
    if (row) {
        if (!row.wa_owner) {
            await db2.prepare('UPDATE creators SET primary_name = ?, wa_owner = ?, updated_at = NOW() WHERE id = ?')
                .run(name || 'Unknown', normalizeCreatorOwner(resolveCurrentOwner()), row.id);
        } else {
            await db2.prepare('UPDATE creators SET primary_name = ?, updated_at = NOW() WHERE id = ?')
                .run(name || 'Unknown', row.id);
        }
        return await ensureCreatorRuntimeRows(row.id);
    }
    const result = await db2.prepare(
        'INSERT INTO creators (primary_name, wa_phone, wa_owner, source) VALUES (?, ?, ?, ?)'
    ).run(name || 'Unknown', normalizedPhone, normalizeCreatorOwner(resolveCurrentOwner()), 'wa').catch(async (error) => {
        const message = String(error?.message || '');
        if (!message.includes('Duplicate entry') || !message.includes('wa_phone')) {
            throw error;
        }

        const existing = await db2.prepare('SELECT id, wa_owner FROM creators WHERE wa_phone = ?').get(normalizedPhone);
        if (!existing) {
            throw error;
        }

        if (!existing.wa_owner) {
            await db2.prepare('UPDATE creators SET primary_name = ?, wa_owner = ?, updated_at = NOW() WHERE id = ?')
                .run(name || 'Unknown', normalizeCreatorOwner(resolveCurrentOwner()), existing.id);
        } else {
            await db2.prepare('UPDATE creators SET primary_name = ?, updated_at = NOW() WHERE id = ?')
                .run(name || 'Unknown', existing.id);
        }

        return { lastInsertRowid: existing.id };
    });
    invalidateOperatorCache(resolveCurrentOwner());
    return await ensureCreatorRuntimeRows(result.lastInsertRowid);
}

// ================== 历史同步 ==================

async function syncHistory(client) {
    progress.phase = 'sync';
    progress.processedChats = 0;
    progress.totalChats = 0;
    progress.newMessages = 0;
    progress.errors = [];

    const rosterIndex = await loadRosterIndex();
    let chatEntries;
    try {
        chatEntries = await buildDirectChatEntries(client);
    } catch (e) {
        console.error(`${LOG_PREFIX} getChats failed:`, e.message);
        progress.clientError = e.message;
        return;
    }

    const processedRosterPhones = new Set();
    progress.totalChats = chatEntries.length;
    console.log(`${LOG_PREFIX} 发现 ${chatEntries.length} 个私聊，开始同步...`);

    for (let i = 0; i < chatEntries.length; i++) {
        const entry = chatEntries[i];
        const chat = entry.chat;
        const pct = Math.round((i / chatEntries.length) * 100);
        process.stdout.write(`\r${LOG_PREFIX} ${progress.bar()} ${pct}% (${i}/${chatEntries.length})  `);

        try {
            const contact = entry.contact || await chat.getContact().catch(() => null);
            if (!contact) { progress.processedChats++; continue; }

            const phone = entry.phone || normalizePhone(contact.number || '');
            const name = entry.name || contact.name || contact.pushname || 'Unknown';

            const rosterAssignment = rosterIndex.byPhone.get(phone) || null;
            let wamessages;
            try {
                wamessages = await fetchMessagesWithFallback(
                    chat,
                    rosterAssignment ? ROSTER_HISTORY_MSG_LIMIT : HISTORY_MSG_LIMIT
                );
            } catch (e) {
                if (e.message.includes('detached Frame')) {
                    console.log(`\n${LOG_PREFIX} ${name}: Frame detached，跳过`);
                } else {
                    console.error(`\n${LOG_PREFIX} fetchMessages error for ${name}:`, e.message);
                    progress.errors.push(`${name}: ${e.message}`);
                }
                progress.processedChats++;
                continue;
            }

            const eligibility = rosterAssignment
                ? { eligible: true, reasons: ['roster_whitelist'], metrics: {} }
                : getEligibilityForHistory(phone, name, wamessages);
            if (!eligibility.eligible) {
                progress.processedChats++;
                continue;
            }

            const creatorId = rosterAssignment?.creator_id || await getOrCreateCreator(phone, name);
            if (rosterAssignment) {
                processedRosterPhones.add(phone);
                await getOrCreateCreator(phone, name);
            }

            // 处理消息中的媒体（来自 fetchMessagesViaStore 的 _mediaData）
            const withMedia = wamessages.filter(m => m._mediaData?.data);
            const mediaResults = {};
            if (withMedia.length > 0) {
                const results = await Promise.all(
                    withMedia.map(m => processMediaDataFromMessage(m).catch(() => null))
                );
                results.forEach((info, i) => {
                    if (info) mediaResults[withMedia[i].id?._serialized || withMedia[i].id] = info;
                });
            }

            const msgsForDb = wamessages.map(m => {
                const mediaInfo = mediaResults[m.id?._serialized || m.id] || null;
                return {
                    role: getWaMessageRole(m),
                    text: getWaMessageText(m),
                    timestamp: getWaMessageTimestampMs(m),
                    wa_message_id: extractWaMessageId(m),
                    mediaInfo,
                };
            });

            const inserted = await insertMessages(creatorId, msgsForDb);
            progress.newMessages += inserted;

            if (inserted > 0) {
                await touchCreator(creatorId);  // 更新达人活跃时间
                console.log(`\n${LOG_PREFIX} ✅ ${name}: +${inserted} 条新消息`);
            }
        } catch (e) {
            console.error(`\n${LOG_PREFIX} chat error:`, e.message);
            progress.errors.push(`chat ${i}: ${e.message}`);
        }

        progress.processedChats++;
    }

    const pendingRosterAssignments = rosterIndex.all.filter((assignment) => {
        if (!assignment?.wa_phone) return false;
        return !processedRosterPhones.has(assignment.wa_phone);
    });

    if (pendingRosterAssignments.length > 0) {
        console.log(`${LOG_PREFIX} roster 定向回补 ${pendingRosterAssignments.length} 位不在当前 chat list 的达人...`);
    }

    for (const assignment of pendingRosterAssignments) {
        try {
            const inserted = await syncRosterCreatorHistory(client, assignment);
            progress.newMessages += inserted;
        } catch (e) {
            console.warn(`${LOG_PREFIX} roster 定向回补失败: creator=${assignment.creator_id} error=${e.message}`);
            progress.errors.push(`roster ${assignment.creator_id}: ${e.message}`);
        }
    }

    console.log(`\n${LOG_PREFIX} 历史同步完成: +${progress.newMessages} 条消息`);

    try {
        await syncGroupHistory(client);
    } catch (e) {
        console.warn(`${LOG_PREFIX} 群聊同步失败: ${e.message}`);
        progress.errors.push(`groups: ${e.message}`);
    }
}

async function syncGroupHistory(client) {
    const groupEntries = await buildGroupChatEntries(client, { force: true });
    if (groupEntries.length === 0) return;

    console.log(`${LOG_PREFIX} 发现 ${groupEntries.length} 个群聊，开始独立归档...`);
    for (const entry of groupEntries) {
        try {
            const groupMessages = await fetchMessagesWithFallback(entry.chat, GROUP_HISTORY_MSG_LIMIT);
            const inserted = await persistGroupChatMessages(entry.chat, groupMessages);
            if (inserted > 0) {
                console.log(`${LOG_PREFIX}[Group] ${entry.name}: +${inserted} 条群聊消息`);
            }
        } catch (error) {
            console.warn(`${LOG_PREFIX}[Group] ${entry.name}: ${error.message}`);
        }
    }
}

// ================== 实时消息监听 ==================

let messageHandlers = [];

function registerMessageHandler(fn) {
    messageHandlers.push(fn);
}

async function notifyProfileAgentEvent(phone, text, role) {
    try {
        const response = await fetch(`${BASE_URL}/api/profile-agent/event`, {
            method: 'POST',
            headers: getInternalServiceHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({
                event_type: 'wa_message',
                client_id: phone,
                data: { text, role },
            }),
            signal: AbortSignal.timeout(15000),
        });
        if (!response.ok) {
            const detail = await response.text().catch(() => '');
            console.warn(`${LOG_PREFIX} profile-agent event failed for ${maskPhone(phone)}: HTTP ${response.status}${detail ? ` ${detail.slice(0, 120)}` : ''}`);
        }
    } catch (e) {
        console.warn(`${LOG_PREFIX} profile-agent event failed for ${maskPhone(phone)}: ${e.message}`);
    }
}

async function notifyProfileAnalysisHook({ creatorId, phone, insertedCount = 1, sampleText = '' }) {
    try {
        const response = await fetch(`${BASE_URL}/api/profile-analysis/hook`, {
            method: 'POST',
            headers: getInternalServiceHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({
                creator_id: creatorId || null,
                client_id: phone || null,
                inserted_count: Math.max(0, Number(insertedCount) || 0),
                sample_text: String(sampleText || '').slice(0, 180),
            }),
            signal: AbortSignal.timeout(15000),
        });
        if (!response.ok) {
            const detail = await response.text().catch(() => '');
            console.warn(`${LOG_PREFIX} profile-analysis hook failed for ${maskPhone(phone)}: HTTP ${response.status}${detail ? ` ${detail.slice(0, 120)}` : ''}`);
        }
    } catch (error) {
        console.warn(`${LOG_PREFIX} profile-analysis hook failed for ${maskPhone(phone)}: ${error.message}`);
    }
}

async function notifyProfilePipelines({ creatorId, phone, text = '', role = 'user', insertedCount = 1 }) {
    const safeText = String(text || '').trim();
    const tasks = [
        notifyProfileAnalysisHook({ creatorId, phone, insertedCount, sampleText: safeText }),
    ];
    if (safeText) {
        tasks.push(notifyProfileAgentEvent(phone, safeText, role));
    }
    await Promise.allSettled(tasks);
}

async function handleIncomingMessage(msg) {
    const handleStartedAt = Date.now();
    const waMsgId = extractWaMessageId(msg);
    perfLog('wa_event_received', {
        source: 'worker',
        sessionId: WA_SESSION_ID,
        owner: WA_OWNER,
        waMsgId,
        fromMe: msg && msg.fromMe === true,
        eventTimestamp: getWaMessageTimestampMs(msg),
    });
    try {
        const msgChat = await msg.getChat().catch(() => msg.chat || null);
        if (isGroupChat(msgChat)) {
            await persistGroupChatMessages(msgChat, [msg]);
            perfLog('wa_event_handled', {
                source: 'worker',
                waMsgId,
                outcome: 'group',
                durationMs: Date.now() - handleStartedAt,
            });
            return;
        }
        if (!isDirectMessage(msg, msgChat)) return;
        if (isAlreadyProcessed(msg)) return;  // 防止与轮询重复

        const contact = await msg.getContact().catch(() => null);
        if (!contact) return;

        const phone = normalizePhone(contact.number || '');
        const name = contact.name || contact.pushname || 'Unknown';
        const db2 = getDb();
        let existingCreator = await db2.prepare('SELECT id FROM creators WHERE wa_phone = ?').get(phone);

        if (!existingCreator) {
            let recentMsgs = [];
            try {
                const chat = msgChat || await msg.getChat().catch(() => null);
                if (!isDirectChat(chat)) return;
                recentMsgs = chat ? await fetchMessagesWithFallback(chat, 8) : [];
            } catch (_) {}

            const eligibility = getEligibilityForRealtime(phone, name, recentMsgs);
            if (!eligibility.eligible) return;
            existingCreator = { id: await getOrCreateCreator(phone, name) };
        } else {
            existingCreator = { id: await getOrCreateCreator(phone, name) };
        }

        const creatorId = existingCreator.id;

        // 下载并存储媒体（图片）
        let mediaInfo = null;
        if (msg.hasMedia) {
            try {
                mediaInfo = await Promise.race([
                    downloadAndStoreIncomingMedia(msg, {
                        creatorId,
                        operator: resolveCurrentOwner(),
                    }),
                    new Promise((_, reject) =>
                        setTimeout(() => reject(new Error('media_download_timeout')), 30000)
                    ),
                ]);
            } catch (err) {
                console.warn(`${LOG_PREFIX}[media] download failed: ${err.message}`);
                mediaInfo = { media_download_status: 'failed' };
            }
        }

        const inserted = await insertMessages(creatorId, [{
            role: getWaMessageRole(msg),
            text: getWaMessageText(msg),
            timestamp: getWaMessageTimestampMs(msg),
            wa_message_id: extractWaMessageId(msg),
            mediaInfo,
        }]);

        if (inserted > 0) {
            await touchCreator(creatorId);  // 更新达人活跃时间
            const preview = msg.hasMedia
                ? `[Media: ${msg.mimetype || 'image'}] ${getWaMessageText(msg).slice(0, 40)}`
                : getWaMessageText(msg).slice(0, 50);
            console.log(`${LOG_PREFIX} 📩 ${name}: ${preview}`);
            messageHandlers.forEach(fn => {
                try { fn({ phone, name, text: getWaMessageText(msg), creatorId }); } catch (_) {}
            });

            // 触发客户画像系统：旧画像链路 + profile-analysis hook
            notifyProfilePipelines({
                creatorId,
                phone,
                text: getWaMessageText(msg),
                role: getWaMessageRole(msg),
                insertedCount: inserted,
            });
        }
        perfLog('wa_event_handled', {
            source: 'worker',
            waMsgId,
            creatorId: existingCreator && existingCreator.id,
            role: getWaMessageRole(msg),
            inserted,
            outcome: inserted > 0 ? 'inserted' : 'skipped',
            durationMs: Date.now() - handleStartedAt,
        });
    } catch (e) {
        console.error(`${LOG_PREFIX} handleIncomingMessage error:`, e.message);
        perfLog('wa_event_handled', {
            source: 'worker',
            waMsgId,
            outcome: 'error',
            errorMessage: e && e.message,
            durationMs: Date.now() - handleStartedAt,
        });
    }
}

/**
 * Baileys IncomingMessage 专用持久化路径（C2.2）。
 * 与 handleIncomingMessage(wwebjs) 不同：baileys 给的是归一化后的
 * IncomingMessage 对象，不是 wwebjs Message。共享 getOrCreateCreator /
 * insertMessages / touchCreator / messageHandlers / notifyProfilePipelines。
 *
 * 群消息（isGroup=true）暂不落库，等 wa_group_messages 也支持 baileys 后再接。
 */
async function handleBaileysIncomingMessage(incoming) {
    const handleStartedAt = Date.now();
    const waMsgId = incoming?.id || null;
    perfLog('wa_event_received', {
        source: 'worker',
        sessionId: WA_SESSION_ID,
        owner: WA_OWNER,
        driver: 'baileys',
        waMsgId,
        fromMe: !!incoming?.fromMe,
        eventTimestamp: typeof incoming?.timestamp === 'number' ? incoming.timestamp : null,
    });
    try {
        if (incoming?.isGroup) {
            perfLog('wa_event_handled', {
                source: 'worker', waMsgId,
                outcome: 'group_skipped_baileys',
                durationMs: Date.now() - handleStartedAt,
            });
            return;
        }
        const phone = normalizePhone(incoming?.chatId || incoming?.from || '');
        if (!phone) return;
        const text = incoming?.text || '';
        if (!text && !incoming?.media) return;

        const name = incoming?.authorName || 'Unknown';
        const db2 = getDb();
        const existing = await db2.prepare('SELECT id FROM creators WHERE wa_phone = ?').get(phone);

        let creatorId;
        if (existing) {
            creatorId = await getOrCreateCreator(phone, name);
        } else {
            // Baileys 没有 fetchRecentMessages 的预取历史，走空消息 eligibility
            const eligibility = getEligibilityForRealtime(phone, name, []);
            if (!eligibility.eligible) {
                perfLog('wa_event_handled', {
                    source: 'worker', waMsgId,
                    outcome: 'ineligible_new_creator',
                    reason: eligibility.reason || null,
                    durationMs: Date.now() - handleStartedAt,
                });
                return;
            }
            creatorId = await getOrCreateCreator(phone, name);
        }

        const role = incoming.fromMe ? 'me' : 'user';
        const timestampMs = typeof incoming.timestamp === 'number' ? incoming.timestamp : Date.now();
        const inserted = await insertMessages(creatorId, [{
            role,
            text,
            timestamp: timestampMs,
            wa_message_id: incoming.id || null,
        }]);

        if (inserted > 0) {
            await touchCreator(creatorId);
            console.log(`${LOG_PREFIX} 📩 ${name} (baileys): ${text.slice(0, 50)}`);
            messageHandlers.forEach(fn => {
                try { fn({ phone, name, text, creatorId }); } catch (_) {}
            });
            notifyProfilePipelines({ creatorId, phone, text, role, insertedCount: inserted });
        }

        perfLog('wa_event_handled', {
            source: 'worker',
            waMsgId,
            creatorId,
            role,
            inserted,
            outcome: inserted > 0 ? 'inserted' : 'skipped',
            durationMs: Date.now() - handleStartedAt,
        });
    } catch (e) {
        console.error(`${LOG_PREFIX} handleBaileysIncomingMessage error:`, e.message);
        perfLog('wa_event_handled', {
            source: 'worker',
            waMsgId,
            outcome: 'error',
            errorMessage: e && e.message,
            durationMs: Date.now() - handleStartedAt,
        });
    }
}

// ================== 增量轮询 ==================

let pollInterval = null;

async function pollOnce(client) {
    try {
        const chatEntries = await buildDirectChatEntries(client);
        let newTotal = 0;
        const rosterIndex = await loadRosterIndex();

        // 构建 WhatsApp 当前聊天列表的 phone 集合
        const chatPhones = new Set();
        for (const entry of chatEntries) {
            const phone = entry.phone;
            if (!phone) continue;
            chatPhones.add(phone);
        }

        // 轮询 WhatsApp 聊天列表中的达人
        for (const entry of chatEntries) {
            const chat = entry.chat;
            const contact = entry.contact;
            const phone = entry.phone;
            const name = entry.name;
            if (!phone) continue;
            const rosterAssignment = rosterIndex.byPhone.get(phone) || null;
            const phoneEligibility = rosterAssignment
                ? { eligible: true, reasons: ['roster_whitelist'], metrics: {} }
                : getEligibilityForRealtime(phone, name, []);
            if (!phoneEligibility.eligible && phoneEligibility.reasons.every((reason) =>
                ['cn_phone', 'non_target_phone', 'internal_contact'].includes(reason)
            )) {
                continue;
            }

            const creatorId = rosterAssignment?.creator_id || await getOrCreateCreator(phone, name);
            if (rosterAssignment) {
                await getOrCreateCreator(phone, name);
            }
            const db2 = getDb();
            const lastRow = await db2.prepare(
                'SELECT timestamp FROM wa_messages WHERE creator_id = ? ORDER BY timestamp DESC LIMIT 1'
            ).get(creatorId);

            let wamessages;
            try {
                wamessages = await fetchMessagesWithFallback(chat, POLL_FETCH_LIMIT);
            } catch (e) {
                // 遇到 waitForChatLoading 等错误，尝试等待重试一次
                try {
                    await new Promise(r => setTimeout(r, 3000));
                    wamessages = await fetchMessagesWithFallback(chat, POLL_FETCH_LIMIT);
                } catch (_) { continue; }
            }

            const eligibility = rosterAssignment
                ? { eligible: true, reasons: ['roster_whitelist'], metrics: {} }
                : getEligibilityForRealtime(phone, name, wamessages);
            if (!eligibility.eligible) continue;

            const newer = (wamessages || []).filter(m => {
                if (isAlreadyProcessed(m)) return false;
                const ts = getWaMessageTimestampMs(m);
                if (!ts) return false;
                return ts > toTimestampMs(lastRow?.timestamp || 0);
            });

            if (newer.length > 0) {
                // 处理消息中的媒体（来自 fetchMessagesViaStore 的 _mediaData）
                const withMedia = newer.filter(m => m._mediaData?.data);
                const mediaResults = {};
                if (withMedia.length > 0) {
                    const results = await Promise.all(
                        withMedia.map(m => processMediaDataFromMessage(m).catch(() => null))
                    );
                    results.forEach((info, i) => {
                        if (info) mediaResults[withMedia[i].id?._serialized || withMedia[i].id] = info;
                    });
                }
                const inserted = await insertMessages(creatorId, newer.map(m => {
                    const mediaInfo = mediaResults[m.id?._serialized || m.id] || null;
                    return {
                        role: getWaMessageRole(m),
                        text: getWaMessageText(m),
                        timestamp: getWaMessageTimestampMs(m),
                        wa_message_id: extractWaMessageId(m),
                        mediaInfo,
                    };
                }));
                newTotal += inserted;
                if (inserted > 0) {
                    await touchCreator(creatorId);
                    console.log(`${LOG_PREFIX}[Poll] ${name}: +${inserted} 条新消息`);
                    // Phase 3: 轮询兜底捕获的消息数 = event path miss。
                    // 对每条 inserted 打 perfLog，便于分析脚本聚合 miss-rate。
                    for (const m of newer) {
                        const ts = getWaMessageTimestampMs(m);
                        const waMsgId = extractWaMessageId(m);
                        if (!waMsgId) continue;
                        perfLog('wa_poll_inserted', {
                            sessionId: WA_SESSION_ID,
                            owner: WA_OWNER,
                            creatorId,
                            waMsgId,
                            role: getWaMessageRole(m),
                            messageTimestamp: ts,
                            ageMs: ts ? Date.now() - ts : null,
                            source: 'poll',
                        });
                    }
                    const sampleMessage = newer.find((item) => getWaMessageText(item)) || newer[0];
                    notifyProfilePipelines({
                        creatorId,
                        phone,
                        text: getWaMessageText(sampleMessage),
                        role: getWaMessageRole(sampleMessage),
                        insertedCount: inserted,
                    });
                }
            }
        }

        // 轮询数据库里有但 WhatsApp 聊天列表里没有的达人（对方没发过消息的情况）
        const db2 = getDb();
        const targetedRosterAssignments = rosterIndex.all.filter((assignment) => {
            if (!assignment?.wa_phone) return false;
            return !chatPhones.has(assignment.wa_phone);
        });
        for (const assignment of targetedRosterAssignments) {
            const chat = await resolveChatByPhone(client, assignment.wa_phone);
            if (!isDirectChat(chat)) continue;

            const lastRow = await db2.prepare(
                'SELECT timestamp FROM wa_messages WHERE creator_id = ? ORDER BY timestamp DESC LIMIT 1'
            ).get(assignment.creator_id);

            let wamessages;
            try {
                wamessages = await fetchMessagesWithFallback(chat, POLL_FETCH_LIMIT);
            } catch (_) {
                continue;
            }

            const newer = (wamessages || []).filter((m) => {
                if (isAlreadyProcessed(m)) return false;
                const ts = getWaMessageTimestampMs(m);
                if (!ts) return false;
                return ts > toTimestampMs(lastRow?.timestamp || 0);
            });

            if (newer.length === 0) continue;

            // 处理消息中的媒体（来自 fetchMessagesViaStore 的 _mediaData）
            const withMedia = newer.filter(m => m._mediaData?.data);
            const mediaResults = {};
            if (withMedia.length > 0) {
                const results = await Promise.all(
                    withMedia.map(m => processMediaDataFromMessage(m).catch(() => null))
                );
                results.forEach((info, i) => {
                    if (info) mediaResults[withMedia[i].id?._serialized || withMedia[i].id] = info;
                });
            }

            const inserted = await insertMessages(assignment.creator_id, newer.map((m) => {
                const mediaInfo = mediaResults[m.id?._serialized || m.id] || null;
                return {
                    role: getWaMessageRole(m),
                    text: getWaMessageText(m),
                    timestamp: getWaMessageTimestampMs(m),
                    wa_message_id: extractWaMessageId(m),
                    mediaInfo,
                };
            }));
            newTotal += inserted;
            if (inserted > 0) {
                await touchCreator(assignment.creator_id);
                console.log(`${LOG_PREFIX}[Poll][Roster] ${assignment.primary_name || assignment.raw_name || maskPhone(assignment.wa_phone)}: +${inserted} 条新消息`);
                // Phase 3: roster 路径 poll 兜底的 miss 也打 perfLog
                for (const m of newer) {
                    const ts = getWaMessageTimestampMs(m);
                    const waMsgId = extractWaMessageId(m);
                    if (!waMsgId) continue;
                    perfLog('wa_poll_inserted', {
                        sessionId: WA_SESSION_ID,
                        owner: WA_OWNER,
                        creatorId: assignment.creator_id,
                        waMsgId,
                        role: getWaMessageRole(m),
                        messageTimestamp: ts,
                        ageMs: ts ? Date.now() - ts : null,
                        source: 'poll_roster',
                    });
                }
                const sampleMessage = newer.find((item) => getWaMessageText(item)) || newer[0];
                notifyProfilePipelines({
                    creatorId: assignment.creator_id,
                    phone: assignment.wa_phone,
                    text: getWaMessageText(sampleMessage),
                    role: getWaMessageRole(sampleMessage),
                    insertedCount: inserted,
                });
            }
        }

        const groupEntries = await buildGroupChatEntries(client);
        for (const entry of groupEntries) {
            let groupMessages;
            try {
                groupMessages = await fetchMessagesWithFallback(entry.chat, GROUP_POLL_FETCH_LIMIT);
            } catch (_) {
                continue;
            }
            const inserted = await persistGroupChatMessages(entry.chat, groupMessages);
            if (inserted > 0) {
                console.log(`${LOG_PREFIX}[Poll][Group] ${entry.name}: +${inserted} 条群聊消息`);
            }
        }

        progress.lastPollAt = new Date();
        progress.newMessages += newTotal;
        if (newTotal > 0) {
            console.log(`${LOG_PREFIX}[Poll] 本轮增量: +${newTotal} 条消息`);
        }
    } catch (e) {
        console.error(`${LOG_PREFIX}[Poll] error:`, e.message);
    }
}

function startPolling(client) {
    if (pollInterval) clearInterval(pollInterval);
    pollOnce(client).catch(console.error);
    pollInterval = setInterval(() => pollOnce(client).catch(console.error), POLL_INTERVAL_MS);
    console.log(`${LOG_PREFIX} 增量轮询已启动 (每${formatPollInterval(POLL_INTERVAL_MS)})`);
}

// ================== Worker 启动 ==================

let started = false;
let startRetryTimer = null;
const START_RETRY_DELAY_MS = 10000;

function scheduleStartRetry(options = {}) {
    if (startRetryTimer) return;
    console.log(`${LOG_PREFIX} ${START_RETRY_DELAY_MS / 1000}秒后重试启动...`);
    startRetryTimer = setTimeout(() => {
        startRetryTimer = null;
        start(options).catch((err) => {
            console.error(`${LOG_PREFIX} 重试启动失败:`, err.message);
        });
    }, START_RETRY_DELAY_MS);
}

async function start(options = {}) {
    if (started) {
        console.log(`${LOG_PREFIX} 已启动，请勿重复调用`);
        return;
    }
    started = true;
    progress.startedAt = new Date();
    progress.phase = 'init';

    console.log('═'.repeat(60));
    console.log(`  WA Worker 启动中... (${WORKER_TAG})`);
    console.log(`  轮询间隔: ${formatPollInterval(POLL_INTERVAL_MS)}`);
    console.log(`  Profile API: ${BASE_URL}`);
    console.log('═'.repeat(60));

    // 等待 Client 就绪（最多2分钟）
    try {
        await waitForReady(120000);
    } catch (e) {
        console.error(`${LOG_PREFIX} ${e.message}，请先扫码认证`);
        progress.clientError = e.message;
        progress.phase = 'idle';
        started = false;
        scheduleStartRetry(options);
        return;
    }

    const driverName = (typeof getDriverName === 'function' ? getDriverName() : null) || 'wwebjs';
    const c = getClient();

    // wwebjs 模式：必须拿到底层 Client 才能挂监听和跑 Puppeteer-driven 同步
    if (driverName === 'wwebjs' && !c) {
        console.error(`${LOG_PREFIX} WhatsApp Client 未初始化`);
        progress.clientError = 'Client 未初始化';
        return;
    }

    progress.clientReady = true;
    progress.clientError = null;

    if (driverName === 'wwebjs') {
        // 注册实时监听（'message' 不触发 fromMe，需额外挂 'message_create' 才能捕获操作员手机端发出的消息）
        c.on('message', (msg) => handleIncomingMessage(msg));
        c.on('message_create', (msg) => {
            if (msg?.fromMe) handleIncomingMessage(msg);
        });

        // 历史同步
        if (options.syncHistory !== false) {
            await syncHistory(c);
        }

        // 启动增量轮询
        startPolling(c);

        progress.phase = 'live';
        console.log('═'.repeat(60));
        console.log(`  WA Worker 已就绪 (wwebjs 实时监听 + 增量轮询) (${WORKER_TAG})`);
        console.log('═'.repeat(60));
        return;
    }

    // Baileys 模式：driver 通过 WebSocket 收消息，没有 Puppeteer Chat，
    // 跳过 syncHistory + Puppeteer 轮询，订阅 facade 'message' 事件直接持久化。
    if (typeof onDriverEvent !== 'function') {
        console.error(`${LOG_PREFIX} driver=${driverName}: facade 缺 onDriverEvent，无法订阅消息事件`);
        progress.clientError = 'facade onDriverEvent missing';
        return;
    }
    onDriverEvent('message', (incoming) => {
        handleBaileysIncomingMessage(incoming).catch((err) => {
            console.error(`${LOG_PREFIX} baileys message handler 异常:`, err.message);
        });
    });
    onDriverEvent('group_message', (incoming) => {
        // 群持久化暂未接；事件仍然穿过 handler 以走 perfLog 和未来扩展
        handleBaileysIncomingMessage(incoming).catch(() => {});
    });
    progress.phase = 'live';
    console.log('═'.repeat(60));
    console.log(`  WA Worker 已就绪 (driver=${driverName}, 事件驱动持久化 1:1 消息) (${WORKER_TAG})`);
    console.log('═'.repeat(60));
}

function stop() {
    if (pollInterval) clearInterval(pollInterval);
    pollInterval = null;
    if (startRetryTimer) {
        clearTimeout(startRetryTimer);
        startRetryTimer = null;
    }
    stopWaService();
    started = false;
    progress.phase = 'idle';
    progress.clientReady = false;
    progress.clientError = null;
    console.log(`${LOG_PREFIX} 已停止`);
}

function getProgress() {
    return {
        phase: progress.phase,
        totalChats: progress.totalChats,
        processedChats: progress.processedChats,
        newMessages: progress.newMessages,
        errors: progress.errors,
        lastPollAt: progress.lastPollAt,
        clientReady: progress.clientReady,
        clientError: progress.clientError,
        owner: progress.owner,
        sessionId: progress.sessionId,
        resolvedOwner: resolveCurrentOwner(),
        pollIntervalMs: POLL_INTERVAL_MS,
        uptime: progress.startedAt ? Date.now() - progress.startedAt.getTime() : 0,
    };
}

// ================== 导出 ==================

module.exports = { start, stop, getProgress, registerMessageHandler };
