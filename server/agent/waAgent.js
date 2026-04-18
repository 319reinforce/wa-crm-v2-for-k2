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

const db = require('../../db');
const {
    start: startWaService,
    getStatus: getWaStatus,
    getQrValue,
    sendMessage,
    sendMedia,
    getClient,
} = require('../services/waService');
const {
    start: startWaWorker,
    stop: stopWaWorker,
    getProgress: getWaWorkerProgress,
} = require('../waWorker');
const { assertNoGroupSend } = require('../services/groupSendGuard');
const { normalizeOperatorName } = require('../utils/operator');
const {
    CMD_SEND_MESSAGE,
    CMD_SEND_MEDIA,
    CMD_AUDIT_RECENT_MESSAGES,
    CMD_SHUTDOWN,
    EVT_QR,
    EVT_READY,
    EVT_ERROR,
    EVT_DISCONNECTED,
    EVT_HEARTBEAT,
    TYPE_CMD,
    makeCommandResult,
    makeEvent,
} = require('./ipcProtocol');

const WA_OWNER = normalizeOperatorName(process.env.WA_OWNER, 'Beau');
const WA_SESSION_ID = String(process.env.WA_SESSION_ID || '').trim();
const WA_API_BASE = process.env.WA_API_BASE || 'http://127.0.0.1:3000';
const AGENT_TAG = `${WA_OWNER}/${WA_SESSION_ID}`;
const HEARTBEAT_INTERVAL_MS = parseInt(process.env.WA_AGENT_HEARTBEAT_MS || '5000', 10);

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
    return String(value || '').replace(/\D/g, '');
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

async function fetchAuditMessagesByPhone(phone, limit = 120) {
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
            const fetched = await chat.fetchMessages({ limit: Math.max(20, Math.min(limit, 2000)) });
            const messages = Array.isArray(fetched) ? fetched : [];
            return {
                ok: true,
                phone: normalizedTarget,
                name: chat.name || chat.contact?.pushname || 'Unknown',
                messages: messages.map((message) => ({
                    role: getWaMessageRole(message),
                    text: getWaMessageText(message),
                    timestamp: getWaMessageTimestampMs(message),
                    message_id: typeof message?.id === 'string'
                        ? message.id
                        : (message?.id?._serialized || message?.id?.id || null),
                })),
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
    const result = await withTimeout(
        fetchAuditMessagesByPhone(phone, limit),
        45000,
        'audit_recent_messages timeout'
    ).catch((error) => ({ ok: false, error: error.message || String(error) }));
    return {
        ...result,
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
    const client = getClient();
    if (!client) return;

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

async function main() {
    console.log('═'.repeat(60));
    console.log(`  WA Agent 启动中... (${AGENT_TAG})`);
    console.log(`  pid=${process.pid}  api_base=${WA_API_BASE}`);
    console.log('═'.repeat(60));

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

    try {
        await startWaWorker({ syncHistory: true });
    } catch (err) {
        console.error(`[waAgent:${AGENT_TAG}] waWorker start failed:`, err.message);
        emitEvent(EVT_ERROR, { message: `waWorker start failed: ${err.message}` });
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
