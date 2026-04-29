/**
 * waAgent — session 子进程入口
 *
 * 由父进程(SessionRegistry)通过 child_process.fork() 启动,
 * 通过 process.send / process.on('message') 做双向 IPC。
 *
 * 环境变量(由父进程注入):
 *   - WA_SESSION_ID : session 标识(必填)
 *   - WA_OWNER      : owner 名(必填)
 *   - WA_API_BASE   : 回调 API 地址(给 waWorker 用)
 *   其它 WA_* 配置和 process.env 一起继承
 *
 * 行为:
 *   1. 启动 WhatsAppService + waWorker(和老 crawler 一样)
 *   2. 定时向父进程 send heartbeat(默认 5s)
 *   3. 订阅 WA client 的 qr / ready / disconnected 事件,实时推父
 *   4. 监听父命令 send_message / send_media / audit / shutdown
 */
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const db = require('../../db');
const {
    start: startWaService,
    getStatus: getWaStatus,
    getQrValue,
    sendMessage,
    sendMedia,
    getClient,
    getDriver,
    getDriverName,
    onDriverEvent,
    offDriverEvent,
} = require('../services/waService');
const {
    start: startWaWorker,
    stop: stopWaWorker,
    getProgress: getWaWorkerProgress,
    registerMessageHandler,
} = require('../waWorker');
const { assertNoGroupSend } = require('../services/groupSendGuard');
const { normalizeOperatorName } = require('../utils/operator');
const { normalizeJid: toBaileysJid } = require('../services/wa/driver/jidUtils');
const {
    CMD_SEND_MESSAGE,
    CMD_SEND_MEDIA,
    CMD_AUDIT_RECENT_MESSAGES,
    CMD_REPAIR_BAILEYS_HISTORY,
    CMD_SHUTDOWN,
    EVT_QR,
    EVT_READY,
    EVT_ERROR,
    EVT_DISCONNECTED,
    EVT_HEARTBEAT,
    EVT_WA_MESSAGE,
    TYPE_CMD,
    makeCommandResult,
    makeEvent,
} = require('./ipcProtocol');

const WA_OWNER = normalizeOperatorName(process.env.WA_OWNER, 'Beau');
const WA_SESSION_ID = String(process.env.WA_SESSION_ID || '').trim();
const WA_API_BASE = process.env.WA_API_BASE || 'http://127.0.0.1:3000';
const AGENT_TAG = `${WA_OWNER}/${WA_SESSION_ID}`;
const HEARTBEAT_INTERVAL_MS = parseInt(process.env.WA_AGENT_HEARTBEAT_MS || '5000', 10);
const BAILEYS_AUDIT_HISTORY_WAIT_MS = Math.max(
    1000,
    parseInt(process.env.WA_BAILEYS_AUDIT_HISTORY_WAIT_MS || '8000', 10) || 8000
);
const BAILEYS_AUDIT_HISTORY_IDLE_MS = Math.max(
    500,
    parseInt(process.env.WA_BAILEYS_AUDIT_HISTORY_IDLE_MS || '1500', 10) || 1500
);

const DIRECT_CHAT_SUFFIXES = ['@c.us', '@lid'];

let heartbeatTimer = null;
let isShuttingDown = false;
let commandInFlight = false;

if (!WA_SESSION_ID) {
    console.error('[waAgent] WA_SESSION_ID is required');
    process.exit(1);
}

if (!process.send) {
    console.error('[waAgent] must be started via child_process.fork (IPC not available)');
    process.exit(1);
}

// ================== IPC helpers ==================

function sendToParent(message) {
    if (!process.send) return;
    try {
        process.send(message);
    } catch (err) {
        console.error(`[waAgent:${AGENT_TAG}] send to parent failed:`, err.message);
    }
}

function emitEvent(kind, payload = {}) {
    sendToParent(makeEvent(kind, payload));
}

function emitCommandResult(id, result) {
    sendToParent(makeCommandResult(id, result));
}

// ================== WA helpers(从 waCrawler 精简) ==================

function withTimeout(promise, timeoutMs, label) {
    return Promise.race([
        promise,
        new Promise((_, reject) => {
            setTimeout(() => reject(new Error(label || `timeout after ${timeoutMs}ms`)), timeoutMs);
        }),
    ]);
}

function isRecoverableFrameError(error) {
    const message = String(error?.message || '');
    return message.includes('detached Frame')
        || message.includes('Execution context was destroyed')
        || message.includes('Cannot find context with specified id');
}

function isWWebChatLoadingError(error) {
    const message = String(error?.message || error || '');
    return message.includes('waitForChatLoading')
        || message.includes('Cannot read properties of undefined');
}

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
    const candidates = [
        message?.fromMe,
        message?.id?.fromMe,
        message?._data?.fromMe,
        message?._data?.id?.fromMe,
        message?.rawData?.fromMe,
    ];
    for (const c of candidates) {
        if (typeof c === 'boolean') return c ? 'me' : 'user';
    }
    return 'user';
}

function getWaMessageText(message) {
    return String(
        message?.body
        || message?._data?.body
        || message?.rawData?.body
        || ''
    );
}

function normalizePhoneDigits(value) {
    const digits = String(value || '').replace(/\D/g, '');
    if (digits.length === 10) return `1${digits}`;
    return digits;
}

function phoneToChatId(phone) {
    const digits = normalizePhoneDigits(phone);
    if (!digits) return null;
    return `${digits}@c.us`;
}

function isDirectChatId(chatId) {
    const normalized = String(chatId || '').trim().toLowerCase();
    if (!normalized) return false;
    if (normalized.endsWith('@g.us')) return false;
    if (normalized.endsWith('@broadcast')) return false;
    return DIRECT_CHAT_SUFFIXES.some((suffix) => normalized.endsWith(suffix));
}

// ================== Command handlers ==================

async function handleSendMessage(payload = {}) {
    const targetGuard = assertNoGroupSend(payload.phone, { source: 'wa_agent.send_message' });
    if (!targetGuard.ok) {
        return { ok: false, error: targetGuard.error };
    }
    const result = await sendMessage(payload.phone, payload.text);
    return {
        ...result,
        routed_session_id: WA_SESSION_ID,
        routed_operator: WA_OWNER,
    };
}

async function handleSendMedia(payload = {}) {
    const targetGuard = assertNoGroupSend(payload.phone, { source: 'wa_agent.send_media' });
    if (!targetGuard.ok) {
        return { ok: false, error: targetGuard.error };
    }
    const result = await sendMedia(payload.phone, {
        caption: payload.caption || '',
        media_path: payload.media_path || null,
        media_url: payload.media_url || null,
        mime_type: payload.mime_type || null,
        file_name: payload.file_name || null,
        data_base64: payload.data_base64 || null,
    });
    return {
        ...result,
        routed_session_id: WA_SESSION_ID,
        routed_operator: WA_OWNER,
    };
}

function mapBaileysIncomingToAuditMessage(message, targetDigits = '') {
    if (!message || message.isGroup || message.unresolvedLid) return null;
    const chatDigits = normalizePhoneDigits(message.chatId || message.from || '');
    if (targetDigits && chatDigits && chatDigits !== targetDigits) return null;
    const text = String(message.text || '').trim();
    if (!text && !message.media) return null;
    return {
        role: message.fromMe ? 'me' : 'user',
        text,
        timestamp: typeof message.timestamp === 'number' ? message.timestamp : Date.now(),
        message_id: message.id || null,
        proto_driver: message.protoDriver || 'baileys',
    };
}

function dedupeAuditMessages(messages = []) {
    const seen = new Set();
    const out = [];
    for (const message of messages || []) {
        if (!message) continue;
        const key = message.message_id
            ? `id:${message.message_id}`
            : `rt:${message.role || ''}\u0000${message.text || ''}\u0000${message.timestamp || ''}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(message);
    }
    return out.sort((a, b) => (Number(a.timestamp) || 0) - (Number(b.timestamp) || 0));
}

function mapWWebMessageToAuditMessage(message) {
    return {
        role: getWaMessageRole(message),
        text: getWaMessageText(message),
        timestamp: getWaMessageTimestampMs(message),
        message_id: typeof message?.id === 'string'
            ? message.id
            : (message?.id?._serialized || message?.id?.id || message?._data?.id?._serialized || null),
    };
}

async function fetchWWebMessagesViaStore(client, chatId, limit) {
    if (!client?.pupPage || !chatId) {
        throw new Error('WWeb Store fallback unavailable');
    }

    return await client.pupPage.evaluate(async (targetChatId, targetLimit) => {
        const store = window.Store;
        if (!store?.Chat) {
            throw new Error('WWeb Store.Chat unavailable');
        }
        const widFactory = store.WidFactory || window.WidFactory || null;
        const chatWid = widFactory?.createWid
            ? widFactory.createWid(targetChatId)
            : targetChatId;
        const model = store.Chat.get(chatWid)
            || store.Chat.get(targetChatId)
            || (typeof store.Chat.find === 'function' ? await store.Chat.find(chatWid) : null)
            || (typeof store.Chat.find === 'function' ? await store.Chat.find(targetChatId) : null);
        if (!model?.msgs || typeof model.msgs.getModelsArray !== 'function') return [];

        const rawMessages = model.msgs
            .getModelsArray()
            .filter((m) => !m.isNotification)
            .sort((a, b) => (Number(a.t || 0) > Number(b.t || 0) ? 1 : -1));
        const safeLimit = Math.max(20, Math.min(Number(targetLimit) || 120, 2000));
        const sliced = rawMessages.slice(-safeLimit);
        return sliced.map((msgObj) => {
            if (window.WWebJS?.getMessageModel) {
                return window.WWebJS.getMessageModel(msgObj);
            }
            return {
                id: msgObj.id,
                body: msgObj.body || msgObj.caption || '',
                timestamp: msgObj.t,
                fromMe: !!msgObj.id?.fromMe,
                _data: {
                    body: msgObj.body || msgObj.caption || '',
                    t: msgObj.t,
                    fromMe: !!msgObj.id?.fromMe,
                    id: msgObj.id,
                },
            };
        });
    }, chatId, limit);
}

async function fetchWWebMessagesWithFallback(client, chat, chatId, limit) {
    const safeLimit = Math.max(20, Math.min(limit, 2000));
    try {
        const fetched = await chat.fetchMessages({ limit: safeLimit });
        return {
            messages: Array.isArray(fetched) ? fetched : [],
            source: 'wweb_fetch_messages',
        };
    } catch (error) {
        if (!isWWebChatLoadingError(error)) throw error;
        console.warn(`[waAgent:${AGENT_TAG}] WWeb fetchMessages failed, using Store.Chat fallback: ${error.message || error}`);
        await new Promise((resolve) => setTimeout(resolve, 1500));
        try {
            const fallback = await fetchWWebMessagesViaStore(client, chatId, safeLimit);
            return {
                messages: Array.isArray(fallback) ? fallback : [],
                source: 'wweb_store_fallback',
                fallback_error: error.message || String(error),
            };
        } catch (fallbackError) {
            return {
                messages: [],
                source: 'wweb_store_fallback_failed',
                fallback_error: `${error.message || String(error)}; Store fallback failed: ${fallbackError.message || String(fallbackError)}`,
            };
        }
    }
}

function createBaileysHistoryCollector({ driver, targetDigits, limit }) {
    const collected = [];
    let settled = false;
    let timeoutId = null;
    let idleId = null;
    let resolvePromise = null;

    const cleanup = () => {
        try { offDriverEvent('history_set', onHistorySet); } catch (_) {}
        if (timeoutId) clearTimeout(timeoutId);
        if (idleId) clearTimeout(idleId);
        timeoutId = null;
        idleId = null;
    };
    const finish = () => {
        if (settled) return;
        settled = true;
        cleanup();
        if (resolvePromise) resolvePromise(dedupeAuditMessages(collected));
    };
    const armIdle = () => {
        if (idleId) clearTimeout(idleId);
        idleId = setTimeout(finish, BAILEYS_AUDIT_HISTORY_IDLE_MS);
        if (typeof idleId.unref === 'function') idleId.unref();
    };
    const onHistorySet = (payload = {}) => {
        const rawMessages = Array.isArray(payload.messages) ? payload.messages : [];
        if (rawMessages.length === 0) return;
        Promise.resolve()
            .then(async () => {
                for (const rawMsg of rawMessages) {
                    const normalized = await driver.normalizeRawMessage(rawMsg).catch(() => null);
                    const mapped = mapBaileysIncomingToAuditMessage(normalized, targetDigits);
                    if (mapped) collected.push(mapped);
                    if (collected.length >= limit) break;
                }
                if (collected.length >= limit) finish();
                else if (collected.length > 0) armIdle();
            })
            .catch(() => {});
    };

    const promise = new Promise((resolve) => {
        resolvePromise = resolve;
        onDriverEvent('history_set', onHistorySet);
        timeoutId = setTimeout(finish, BAILEYS_AUDIT_HISTORY_WAIT_MS);
        if (typeof timeoutId.unref === 'function') timeoutId.unref();
    });

    return {
        wait: () => promise,
        cancel: () => finish(),
    };
}

async function fetchAuditMessagesViaBaileys(phone, limit, creatorId) {
    // Baileys 同步两条路：
    //   1. ring buffer（_msgBuffer，driver 启动后看到的 ≤200 条/JID live 消息）→ 立即返回
    //   2. driver.fetchMessageHistory（PR #47 引入）→ 异步从 WA 服务端拉历史，
    //      结果通过 messaging-history.set 事件流入 handleBaileysHistoryBatch → wa_messages。
    //      前端用户需要 ~5-30s 后刷新才能看到新增历史。
    // 没有 baileys-keyed anchor 消息（creator 完全没收过 baileys 消息）则跳过 #2。
    let driver;
    try {
        driver = getDriver();
    } catch (_) {
        driver = null;
    }
    if (!driver) return { ok: false, error: 'baileys driver not initialized' };
    const status = typeof driver.getStatus === 'function' ? driver.getStatus() : { ready: false };
    if (!status.ready) return { ok: false, error: 'baileys driver not ready' };

    const normalizedTarget = normalizePhoneDigits(phone);
    if (!normalizedTarget) return { ok: false, error: 'invalid phone' };

    const phoneE164 = `+${normalizedTarget}`;
    const safeLimit = Math.max(20, Math.min(parseInt(limit, 10) || 120, 2000));

    // 1. ring buffer（同步）
    let buffered = [];
    try {
        buffered = await driver.fetchRecentMessages(phoneE164, safeLimit);
    } catch (error) {
        return { ok: false, error: error.message || String(error) };
    }
    const bufferMessages = dedupeAuditMessages(
        (buffered || [])
            .map((m) => mapBaileysIncomingToAuditMessage(m, normalizedTarget))
            .filter(Boolean)
    );

    // 2. fetchMessageHistory（异步触发）— 需 anchor key
    let historyFetchAsync = null;
    let historyMessages = [];
    if (creatorId && typeof driver.fetchMessageHistory === 'function') {
        try {
            // 用最旧的 Baileys-keyed 消息作 anchor（向更早历史回溯）。
            // 不能使用 WWeb 旧 message_id 伪装 Baileys key；两套 id 形状不同，
            // 传错会导致 WA 服务端无响应或返回不可用历史。
            const anchor = await db.getDb().prepare(
                "SELECT timestamp, wa_message_id, role FROM wa_messages " +
                "WHERE creator_id = ? AND proto_driver = 'baileys' AND wa_message_id IS NOT NULL " +
                "ORDER BY timestamp ASC LIMIT 1"
            ).get(creatorId);
            if (anchor?.wa_message_id) {
                const jid = toBaileysJid(phoneE164, 'baileys');
                const oldestKey = {
                    remoteJid: jid,
                    id: String(anchor.wa_message_id),
                    fromMe: anchor.role === 'me',
                };
                const tsMs = Number(anchor.timestamp) || Date.now();
                const collector = typeof driver.normalizeRawMessage === 'function'
                    ? createBaileysHistoryCollector({ driver, targetDigits: normalizedTarget, limit: safeLimit })
                    : null;
                const requestedSessionId = await driver.fetchMessageHistory(safeLimit, oldestKey, tsMs);
                if (requestedSessionId && collector) {
                    historyMessages = await collector.wait();
                } else if (collector) {
                    collector.cancel();
                }
                historyFetchAsync = {
                    requested: !!requestedSessionId,
                    session_id: requestedSessionId || null,
                    anchor_message_id: anchor.wa_message_id,
                    anchor_timestamp: tsMs,
                    count: safeLimit,
                    waited_ms: requestedSessionId ? BAILEYS_AUDIT_HISTORY_WAIT_MS : 0,
                    collected_count: historyMessages.length,
                };
            } else {
                historyFetchAsync = {
                    requested: false,
                    reason: 'no baileys anchor message in DB (need one baileys-keyed message first)',
                };
            }
        } catch (anchorErr) {
            console.warn(`[waAgent:${AGENT_TAG}] anchor lookup failed: ${anchorErr.message}`);
            historyFetchAsync = { requested: false, reason: anchorErr.message };
        }
    }

    const messages = dedupeAuditMessages([...bufferMessages, ...historyMessages]).slice(-safeLimit);

    return {
        ok: true,
        phone: normalizedTarget,
        name: 'Unknown',
        messages,
        baileys_buffer_count: bufferMessages.length,
        baileys_buffer_only: !historyFetchAsync?.requested,
        baileys_history_fetch: historyFetchAsync,
    };
}

async function fetchAuditMessagesByPhone(phone, limit = 120, creatorId = null) {
    // baileys 走独立路径 — 没有 wwebjs 的 client API
    if (getDriverName() === 'baileys') {
        return await fetchAuditMessagesViaBaileys(phone, limit, creatorId);
    }

    const client = getClient();
    if (!client) return { ok: false, error: 'WA client not ready' };

    const normalizedTarget = normalizePhoneDigits(phone);
    if (!normalizedTarget) return { ok: false, error: 'invalid phone' };

    const chatId = phoneToChatId(normalizedTarget);
    if (!chatId) return { ok: false, error: 'invalid phone' };

    for (let attempt = 1; attempt <= 3; attempt += 1) {
        try {
            const chat = await client.getChatById(chatId);
            if (!chat || !isDirectChatId(chat.id?._serialized || chatId)) {
                return { ok: false, error: `chat not found for ${normalizedTarget}` };
            }
            const fetched = await fetchWWebMessagesWithFallback(client, chat, chat.id?._serialized || chatId, Math.max(20, Math.min(limit, 2000)));
            const messages = Array.isArray(fetched.messages) ? fetched.messages : [];
            return {
                ok: true,
                phone: normalizedTarget,
                name: chat.name || chat.contact?.pushname || 'Unknown',
                messages: messages.map(mapWWebMessageToAuditMessage),
                audit_source: fetched.source,
                fallback_error: fetched.fallback_error || null,
            };
        } catch (error) {
            if (!isRecoverableFrameError(error) || attempt === 3) {
                return { ok: false, error: error.message || String(error) };
            }
            await new Promise((resolve) => setTimeout(resolve, 2000 * attempt));
        }
    }
    return { ok: false, error: `chat not found for ${normalizedTarget}` };
}

async function handleAuditRecentMessages(payload = {}) {
    const phone = payload.phone;
    const limit = Number(payload.limit || 120);
    const creatorId = payload.creator_id ? Number(payload.creator_id) : null;
    const result = await withTimeout(
        fetchAuditMessagesByPhone(phone, limit, creatorId),
        45000,
        'audit_recent_messages timeout'
    ).catch((error) => ({ ok: false, error: error.message || String(error) }));
    return {
        ...result,
        routed_session_id: WA_SESSION_ID,
        routed_operator: WA_OWNER,
    };
}

async function handleRepairBaileysHistory(payload = {}) {
    if (getDriverName() !== 'baileys') {
        return {
            ok: false,
            error: 'repair_baileys_history requires baileys driver',
            routed_session_id: WA_SESSION_ID,
            routed_operator: WA_OWNER,
        };
    }
    const phone = payload.phone || '';
    const limit = Math.max(50, Math.min(parseInt(payload.limit, 10) || 500, 2000));
    const creatorId = Number(payload.creator_id || 0) || null;
    const result = await withTimeout(
        fetchAuditMessagesViaBaileys(phone, limit, creatorId),
        60000,
        'repair_baileys_history timeout'
    ).catch((error) => ({ ok: false, error: error.message || String(error) }));
    return {
        ...result,
        repair_mode: 'baileys_history',
        routed_session_id: WA_SESSION_ID,
        routed_operator: WA_OWNER,
    };
}

async function handleCommand(envelope) {
    if (commandInFlight) {
        // 父进程应该串行发命令,这里只是保险
        emitCommandResult(envelope.id, { ok: false, error: 'agent busy' });
        return;
    }
    commandInFlight = true;
    try {
        const { cmd, payload } = envelope;
        let result;
        switch (cmd) {
            case CMD_SEND_MESSAGE:
                result = await handleSendMessage(payload);
                break;
            case CMD_SEND_MEDIA:
                result = await handleSendMedia(payload);
                break;
            case CMD_AUDIT_RECENT_MESSAGES:
                result = await handleAuditRecentMessages(payload);
                break;
            case CMD_REPAIR_BAILEYS_HISTORY:
                result = await handleRepairBaileysHistory(payload);
                break;
            case CMD_SHUTDOWN:
                emitCommandResult(envelope.id, { ok: true, stopping: true });
                await gracefulShutdown('IPC_SHUTDOWN');
                return;
            default:
                result = { ok: false, error: `unknown cmd: ${cmd}` };
        }
        emitCommandResult(envelope.id, result);
    } catch (err) {
        emitCommandResult(envelope.id, { ok: false, error: err.message || String(err) });
    } finally {
        commandInFlight = false;
    }
}

// ================== Heartbeat & event wiring ==================

function emitHeartbeat() {
    try {
        const status = getWaStatus();
        emitEvent(EVT_HEARTBEAT, {
            ready: !!status.ready,
            hasQr: !!status.hasQr,
            owner: status.owner || WA_OWNER,
            account_phone: status.account_phone || null,
            account_pushname: status.account_pushname || null,
            worker: getWaWorkerProgress(),
            pid: process.pid,
        });
    } catch (err) {
        // 心跳失败不应杀死 agent,只记录
        console.error(`[waAgent:${AGENT_TAG}] heartbeat emit failed:`, err.message);
    }
}

function wireClientEvents() {
    // 旧行为：wwebjs 模式要求 getClient() 非空才挂监听。baileys 模式 getClient()
    // 必然返回 null，但 probe() 只用 getWaStatus()/getQrValue() 这类 facade API，
    // 两种 driver 都可用，不应因为 client 缺失就放弃转发 QR/ready 到父进程。
    const client = getClient();
    if (!client) {
        console.log(`[waAgent:${AGENT_TAG}] wireClientEvents: no wwebjs Client (baileys 模式?)，仍启动 status probe 以转发 QR/ready 给父进程`);
    }

    const forwardedFlags = { qr: false, ready: false };

    // 状态变化通过 status 对比推断,避免在 waService 里加 hook
    // 每次 heartbeat 前检查一次 qr/ready 变化
    const originalEmitHeartbeat = emitHeartbeat;
    let lastReady = null;
    let lastQrCount = 0;
    let lastDisconnectReason = null;

    const probe = () => {
        try {
            const status = getWaStatus();
            if (status.hasQr && (status.qr_refresh_count || 0) !== lastQrCount) {
                lastQrCount = status.qr_refresh_count || 0;
                emitEvent(EVT_QR, {
                    qr_value: getQrValue(),
                    qr_refresh_count: lastQrCount,
                    last_qr_at: status.last_qr_at || null,
                });
            }
            if (status.ready !== lastReady) {
                lastReady = status.ready;
                if (status.ready) {
                    emitEvent(EVT_READY, {
                        owner: status.owner,
                        account_phone: status.account_phone,
                        account_pushname: status.account_pushname,
                    });
                }
            }
            if (status.error && status.error !== lastDisconnectReason) {
                lastDisconnectReason = status.error;
                emitEvent(EVT_DISCONNECTED, { reason: status.error });
            }
            originalEmitHeartbeat();
        } catch (err) {
            console.error(`[waAgent:${AGENT_TAG}] probe failed:`, err.message);
        }
    };

    heartbeatTimer = setInterval(probe, HEARTBEAT_INTERVAL_MS);
    if (heartbeatTimer.unref) heartbeatTimer.unref();
    probe();
}

// ================== Lifecycle ==================

async function gracefulShutdown(signal) {
    if (isShuttingDown) return;
    isShuttingDown = true;
    console.log(`[waAgent:${AGENT_TAG}] ${signal} received, shutting down...`);
    if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
    }
    try { stopWaWorker(); } catch (_) {}
    try { await db.closeDb(); } catch (_) {}
    // 给父进程一点时间把残余 stdout/stderr 收走
    setTimeout(() => process.exit(0), 100);
}

// 清理 Chromium 残留锁文件(容器异常退出后 SingletonLock/Cookie/Socket 残留)
function cleanStaleChromiumLocks() {
    const authRoot = process.env.WA_AUTH_ROOT
        || process.env.WWEBJS_AUTH_ROOT
        || path.join(__dirname, '../../.wwebjs_auth');
    const sessionDir = path.join(authRoot, `session-${WA_SESSION_ID}`);
    if (!fs.existsSync(sessionDir)) return;
    const lockNames = ['SingletonLock', 'SingletonCookie', 'SingletonSocket'];
    let removed = 0;
    const walk = (dir) => {
        try {
            for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
                const full = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    walk(full);
                } else if (lockNames.includes(entry.name) || entry.isSymbolicLink()) {
                    try { fs.unlinkSync(full); removed += 1; } catch (_) {}
                }
            }
        } catch (_) {}
    };
    walk(sessionDir);
    if (removed > 0) {
        console.log(`[waAgent:${AGENT_TAG}] cleaned ${removed} stale Chromium lock file(s)`);
    }
}

async function main() {
    console.log('═'.repeat(60));
    console.log(`  WA Agent 启动中... (${AGENT_TAG})`);
    console.log(`  pid=${process.pid}  api_base=${WA_API_BASE}`);
    console.log('═'.repeat(60));

    cleanStaleChromiumLocks();

    // IPC 命令监听
    process.on('message', (msg) => {
        if (!msg || typeof msg !== 'object') return;
        if (msg.type === TYPE_CMD) {
            handleCommand(msg).catch((err) => {
                console.error(`[waAgent:${AGENT_TAG}] handleCommand fatal:`, err.message);
            });
        }
    });

    // 启动 WA service 和 worker
    startWaService();
    wireClientEvents();
    registerMessageHandler((message) => {
        const digits = normalizePhoneDigits(message?.phone || '');
        if (!digits) return;
        emitEvent(EVT_WA_MESSAGE, {
            chat_id: `${digits}@c.us`,
            from_phone: `+${digits}`,
            to_phone: `+${digits}`,
            role: message?.role || null,
            text: message?.text || '',
            timestamp: message?.timestamp || Date.now(),
            message_id: message?.message_id || null,
            creator_id: message?.creatorId || null,
            source: 'wa_worker_persistence',
        });
    });

    try {
        await startWaWorker({ syncHistory: true });
    } catch (err) {
        console.error(`[waAgent:${AGENT_TAG}] waWorker start failed:`, err.message);
        emitEvent(EVT_ERROR, { message: `waWorker start failed: ${err.message}` });
    }

    // Step 7: 实时转发 WA message 事件给父进程,供 SSE 广播给前端
    // 独立于 waWorker 的持久化监听,仅做 "UI refresh hint"
    const client = getClient();
    if (client) {
        const forwardMessage = (message) => {
            try {
                const chatId = message?.from || message?.to || message?.id?.remote || null;
                const fromMe = !!(message?.fromMe || message?.id?.fromMe);
                const fromDigits = String(message?.from || '').replace(/@.*$/, '').replace(/\D/g, '');
                const toDigits = String(message?.to || '').replace(/@.*$/, '').replace(/\D/g, '');
                const text = getWaMessageText(message);
                const timestamp = getWaMessageTimestampMs(message);
                emitEvent(EVT_WA_MESSAGE, {
                    chat_id: chatId,
                    from_phone: fromDigits ? `+${fromDigits}` : null,
                    to_phone: toDigits ? `+${toDigits}` : null,
                    role: fromMe ? 'me' : 'user',
                    text,
                    timestamp,
                    message_id: typeof message?.id === 'string' ? message.id : (message?.id?._serialized || null),
                });
            } catch (err) {
                console.error(`[waAgent:${AGENT_TAG}] forwardMessage failed:`, err.message);
            }
        };
        client.on('message', forwardMessage);
        client.on('message_create', (msg) => {
            if (msg?.fromMe) forwardMessage(msg);  // 只转发自己发的,避免和 'message' 重复
        });
    }
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('disconnect', () => {
    // 父进程 IPC 通道关闭 = 父挂了,不能继续
    console.error(`[waAgent:${AGENT_TAG}] parent IPC disconnected, exiting`);
    gracefulShutdown('PARENT_DISCONNECT');
});
process.on('uncaughtException', (err) => {
    console.error(`[waAgent:${AGENT_TAG}] uncaughtException:`, err);
    emitEvent(EVT_ERROR, { message: `uncaughtException: ${err.message}` });
});
process.on('unhandledRejection', (reason) => {
    console.error(`[waAgent:${AGENT_TAG}] unhandledRejection:`, reason);
    emitEvent(EVT_ERROR, { message: `unhandledRejection: ${reason?.message || reason}` });
});

if (require.main === module) {
    main().catch(async (err) => {
        console.error(`[waAgent:${AGENT_TAG}] fatal:`, err);
        try { await db.closeDb(); } catch (_) {}
        process.exit(1);
    });
}

module.exports = { main, gracefulShutdown };
