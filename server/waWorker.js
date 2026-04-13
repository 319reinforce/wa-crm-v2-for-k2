/**
 * WA Worker — WhatsApp 聊天记录爬虫（单账号版）
 * 实时监听 + 增量轮询，数据写入 MySQL
 *
 * 启动方式：node server/index.cjs（自动启动）
 */

require('dotenv').config();
const { getDb } = require('../db');
const { getClient, waitForReady, stop: stopWaService, getResolvedOwner } = require('./services/waService');
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

// ***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED*** 配置 ***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED***

function parsePollIntervalMs(rawValue) {
    const parsed = parseInt(rawValue || '', 10);
    if (!Number.isInteger(parsed) || parsed <= 0) return 60 * 1000;
    return Math.max(15 * 1000, parsed);
}

function formatPollInterval(intervalMs) {
    if (intervalMs % (60 * 1000) ***REMOVED***= 0) {
        return `${intervalMs / 60 / 1000} 分钟`;
    }
    return `${Math.round(intervalMs / 1000)} 秒`;
}

const POLL_INTERVAL_MS = parsePollIntervalMs(process.env.WA_POLL_INTERVAL_MS);   // 增量轮询间隔（默认60秒）
const HISTORY_MSG_LIMIT = 500;            // 常规历史消息拉取条数
const POLL_FETCH_LIMIT = 50;              // 增量轮询拉取条数
const ROSTER_HISTORY_MSG_LIMIT = 100000;  // roster 白名单全历史回溯上限
const WA_OWNER = normalizeOperatorName(process.env.WA_OWNER, 'Beau');
const WA_SESSION_ID = String(process.env.WA_SESSION_ID || process.env.PORT || '3000').trim();
const BASE_URL = process.env.WA_API_BASE || `http://localhost:${process.env.PORT || 3000}`; // 画像服务调用地址
const WORKER_TAG = `${WA_SESSION_ID}`;
const LOG_PREFIX = `[WA Worker:${WA_OWNER}/${WORKER_TAG}]`;

function resolveCurrentOwner() {
    return normalizeOperatorName(getResolvedOwner(), WA_OWNER);
}

// ***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED*** 达人准入过滤 ***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED***

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

// ***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED*** 消息去重缓存 ***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED***
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
        if (typeof candidate ***REMOVED***= 'boolean') return candidate ? 'me' : 'user';
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
        if (candidate ***REMOVED***= 'out') return 'me';
        if (candidate ***REMOVED***= 'in') return 'user';
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
    if (/^[A-Za-z0-9+/=]{512,}$/.test(compact) && compact.length % 4 ***REMOVED***= 0) return true;
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

function buildMessageHash(role, text, timestampMs) {
    return sha256(`${role || ''}|${text || ''}|${timestampMs || ''}`);
}

function dedupKey(msg) {
    const ts = getWaMessageTimestampMs(msg);
    const chatId = msg.chat?.id?._serialized || msg.chat?.id?.SerializedString || msg.from || '';
    const messageId = typeof msg.id ***REMOVED***= 'string'
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

// ***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED*** 进度追踪 ***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED***

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
        if (this.phase ***REMOVED***= 'init') return 5;
        if (this.phase ***REMOVED***= 'sync') {
            return this.totalChats > 0
                ? Math.round(5 + (this.processedChats / this.totalChats) * 85)
                : 5;
        }
        if (this.phase ***REMOVED***= 'live') return 100;
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

// ***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED*** 消息写入 MySQL ***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED***

async function insertMessages(creatorId, messages) {
    if (!messages || messages.length ***REMOVED***= 0) return 0;
    const db2 = getDb();
    const normalizedMessages = messages.map((m) => {
        const role = m.role || getWaMessageRole(m);
        const text = m.text || getWaMessageText(m);
        const timestampMs = m.timestamp_ms || m.timestamp
            ? toTimestampMs(m.timestamp || m.timestamp_ms)
            : getWaMessageTimestampMs(m);
        return {
            creator_id: creatorId,
            role,
            operator: resolveCurrentOwner(),
            text,
            timestamp: timestampMs,
        };
    });

    const { kept, dropped } = await filterShortWindowDuplicates(db2, creatorId, normalizedMessages, {
        windowMs: 15 * 60 * 1000,
        minTextLength: 12,
    });

    if (dropped.length > 0) {
        console.warn(`${LOG_PREFIX} short-window duplicate blocked: creator=${creatorId} dropped=${dropped.length}`);
    }

    const ops = kept.map((m) => {
        const messageHash = buildMessageHash(m.role, m.text, m.timestamp);
        return [creatorId, m.role, m.operator, m.text, m.timestamp, messageHash];
    }).filter(([, , , text, timestampMs]) => text && timestampMs > 0);
    const placeholders = ops.map(() => '(?, ?, ?, ?, ?, ?)').join(', ');
    if (ops.length ***REMOVED***= 0) return 0;
    try {
        await db2.prepare(
            `INSERT IGNORE INTO wa_messages (creator_id, role, operator, text, timestamp, message_hash)
             VALUES ${placeholders}`
        ).run(...ops.flat());
        return ops.length;
    } catch (e) {
        console.error(`${LOG_PREFIX} insertMessages error:`, e.message);
        return 0;
    }
}

async function fetchMessagesViaStore(chat, limit = HISTORY_MSG_LIMIT) {
    const c = getClient();
    const chatId = chat?.id?._serialized || chat?.id?.SerializedString;
    if (!c?.pupPage || !chatId) return [];

    try {
        if (typeof chat.syncHistory ***REMOVED***= 'function') {
            await chat.syncHistory().catch(() => false);
        }
    } catch (_) {}

    await new Promise((resolve) => setTimeout(resolve, 1500));

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
        return sliced.map((m) => window.WWebJS.getMessageModel(m));
    }, chatId, limit);
}

async function fetchMessagesWithFallback(chat, limit = HISTORY_MSG_LIMIT) {
    try {
        return await chat.fetchMessages({ limit });
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
    const chatId = phoneToChatId(phone);
    if (!chatId) return null;

    let resolvedChatId = chatId;
    try {
        const wid = await client.getNumberId(chatId).catch(() => null);
        if (wid?._serialized) {
            resolvedChatId = wid._serialized;
        }
    } catch (_) {}

    try {
        return await client.getChatById(resolvedChatId);
    } catch (_) {
        return null;
    }
}

async function syncRosterCreatorHistory(client, assignment, chat = null) {
    if (!assignment?.creator_id || !assignment?.wa_phone) return 0;

    const targetChat = chat || await resolveChatByPhone(client, assignment.wa_phone);
    if (!targetChat || targetChat.isGroup) return 0;

    const contact = await targetChat.getContact().catch(() => null);
    const name = contact?.name || contact?.pushname || assignment.primary_name || assignment.raw_name || 'Unknown';

    let wamessages;
    try {
        wamessages = await fetchMessagesWithFallback(targetChat, ROSTER_HISTORY_MSG_LIMIT);
    } catch (e) {
        console.warn(`${LOG_PREFIX} roster history fetch failed: creator=${assignment.creator_id} phone=${assignment.wa_phone} error=${e.message}`);
        return 0;
    }

    const creatorId = assignment.creator_id;
    const inserted = await insertMessages(creatorId, wamessages.map((m) => ({
        role: getWaMessageRole(m),
        text: getWaMessageText(m),
        timestamp: getWaMessageTimestampMs(m),
    })));

    await getOrCreateCreator(assignment.wa_phone, name);
    if (inserted > 0) {
        await touchCreator(creatorId);
        console.log(`${LOG_PREFIX} 🧩 roster backfill ${name}: +${inserted} 条历史消息`);
    }
    return inserted;
}

// ***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED*** 获取或创建达人 ***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED***

async function touchCreator(creatorId) {
    try {
        const db2 = getDb();
        await db2.prepare('UPDATE creators SET updated_at = NOW() WHERE id = ?').run(creatorId);
    } catch (_) {}
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
        return resolved.creatorId;
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
        return row.id;
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
    return result.lastInsertRowid;
}

// ***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED*** 历史同步 ***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED***

async function syncHistory(client) {
    progress.phase = 'sync';
    progress.processedChats = 0;
    progress.totalChats = 0;
    progress.newMessages = 0;
    progress.errors = [];

    const rosterIndex = await loadRosterIndex();
    let chats;
    try {
        chats = await client.getChats();
    } catch (e) {
        console.error(`${LOG_PREFIX} getChats failed:`, e.message);
        progress.clientError = e.message;
        return;
    }

    const privateChats = chats.filter(c => !c.isGroup);
    const processedRosterPhones = new Set();
    progress.totalChats = privateChats.length;
    console.log(`${LOG_PREFIX} 发现 ${privateChats.length} 个私聊，开始同步...`);

    for (let i = 0; i < privateChats.length; i++) {
        const chat = privateChats[i];
        const pct = Math.round((i / privateChats.length) * 100);
        process.stdout.write(`\r${LOG_PREFIX} ${progress.bar()} ${pct}% (${i}/${privateChats.length})  `);

        try {
            const contact = await chat.getContact().catch(() => null);
            if (!contact) { progress.processedChats++; continue; }

            const phone = normalizePhone(contact.number || '');
            const name = contact.name || contact.pushname || 'Unknown';

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

            const msgsForDb = wamessages.map(m => ({
                role: getWaMessageRole(m),
                text: getWaMessageText(m),
                timestamp: getWaMessageTimestampMs(m),
            }));

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
}

// ***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED*** 实时消息监听 ***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED***

let messageHandlers = [];

function registerMessageHandler(fn) {
    messageHandlers.push(fn);
}

async function handleIncomingMessage(msg) {
    try {
        if (msg.chat?.isGroup) return;
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
                const chat = await msg.getChat();
                recentMsgs = chat ? await fetchMessagesWithFallback(chat, 8) : [];
            } catch (_) {}

            const eligibility = getEligibilityForRealtime(phone, name, recentMsgs);
            if (!eligibility.eligible) return;
            existingCreator = { id: await getOrCreateCreator(phone, name) };
        } else {
            existingCreator = { id: await getOrCreateCreator(phone, name) };
        }

        const creatorId = existingCreator.id;
        const inserted = await insertMessages(creatorId, [{
            role: getWaMessageRole(msg),
            text: getWaMessageText(msg),
            timestamp: getWaMessageTimestampMs(msg),
        }]);

        if (inserted > 0) {
            await touchCreator(creatorId);  // 更新达人活跃时间
            console.log(`${LOG_PREFIX} 📩 ${name}: ${getWaMessageText(msg).slice(0, 50)}`);
            messageHandlers.forEach(fn => {
                try { fn({ phone, name, text: getWaMessageText(msg), creatorId }); } catch (_) {}
            });

            // 触发客户画像系统：标签提取 + MiniMax summary 刷新
            fetch(`${BASE_URL}/api/profile-agent/event`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    event_type: 'wa_message',
                    client_id: phone,  // wa_phone 是 client_id
                    data: { text: getWaMessageText(msg), role: getWaMessageRole(msg) }
                })
            }).catch(() => {});  // 非阻塞，不影响主流程
        }
    } catch (e) {
        console.error(`${LOG_PREFIX} handleIncomingMessage error:`, e.message);
    }
}

// ***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED*** 增量轮询 ***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED***

let pollInterval = null;

async function pollOnce(client) {
    try {
        const chats = await client.getChats();
        let newTotal = 0;
        const rosterIndex = await loadRosterIndex();

        // 构建 WhatsApp 当前聊天列表的 phone 集合
        const chatPhones = new Set();
        for (const chat of chats) {
            if (chat.isGroup) continue;
            const contact = await chat.getContact().catch(() => null);
            if (!contact?.number) continue;
            const phone = normalizePhone(contact.number || '');
            chatPhones.add(phone);
        }

        // 轮询 WhatsApp 聊天列表中的达人
        for (const chat of chats) {
            if (chat.isGroup) continue;
            const contact = await chat.getContact().catch(() => null);
            if (!contact) continue;

            const phone = normalizePhone(contact.number || '');
            const name = contact.name || contact.pushname || 'Unknown';
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
                const inserted = await insertMessages(creatorId, newer.map(m => ({
                    role: getWaMessageRole(m),
                    text: getWaMessageText(m),
                    timestamp: getWaMessageTimestampMs(m),
                })));
                newTotal += inserted;
                if (inserted > 0) {
                    await touchCreator(creatorId);
                    console.log(`${LOG_PREFIX}[Poll] ${name}: +${inserted} 条新消息`);

                    // 触发客户画像系统（每批次只发一次，避免刷接口）
                    fetch(`${BASE_URL}/api/profile-agent/event`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            event_type: 'wa_message',
                            client_id: phone,
                            data: { text: getWaMessageText(newer[0]), role: getWaMessageRole(newer[0]) }
                        })
                    }).catch(() => {});
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
            if (!chat || chat.isGroup) continue;

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

            if (newer.length ***REMOVED***= 0) continue;

            const inserted = await insertMessages(assignment.creator_id, newer.map((m) => ({
                role: getWaMessageRole(m),
                text: getWaMessageText(m),
                timestamp: getWaMessageTimestampMs(m),
            })));
            newTotal += inserted;
            if (inserted > 0) {
                await touchCreator(assignment.creator_id);
                console.log(`${LOG_PREFIX}[Poll][Roster] ${assignment.primary_name || assignment.raw_name || assignment.wa_phone}: +${inserted} 条新消息`);
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

// ***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED*** Worker 启动 ***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED***

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

    const c = getClient();
    if (!c) {
        console.error(`${LOG_PREFIX} WhatsApp Client 未初始化`);
        progress.clientError = 'Client 未初始化';
        return;
    }

    progress.clientReady = true;
    progress.clientError = null;

    // 注册实时监听
    c.on('message', (msg) => handleIncomingMessage(msg));

    // 历史同步
    if (options.syncHistory !***REMOVED*** false) {
        await syncHistory(c);
    }

    // 启动增量轮询
    startPolling(c);

    progress.phase = 'live';
    console.log('═'.repeat(60));
    console.log(`  WA Worker 已就绪 (实时监听 + 增量轮询) (${WORKER_TAG})`);
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

// ***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED*** 导出 ***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED***

module.exports = { start, stop, getProgress, registerMessageHandler };
