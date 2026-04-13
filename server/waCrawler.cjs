/**
 * WA Crawler 入口（无 HTTP 服务）
 * 用于同机并行启动多个 WhatsApp 抓取 session，统一写入同一 MySQL。
 *
 * 示例：
 *   WA_SESSION_ID=beau WA_OWNER=Beau WA_API_BASE=http://127.0.0.1:3000 node server/waCrawler.cjs
 *   WA_SESSION_ID=yiyun WA_OWNER=Yiyun WA_API_BASE=http://127.0.0.1:3000 node server/waCrawler.cjs
 */
require('dotenv').config();
const db = require('../db');
const {
    start: startWaService,
    getStatus: getWaStatus,
    getQrValue,
    sendMessage,
    sendMedia,
    getClient,
} = require('./services/waService');
const {
    start: startWaWorker,
    stop: stopWaWorker,
    getProgress: getWaWorkerProgress,
} = require('./waWorker');
const {
    claimNextSessionCommand,
    completeClaimedCommand,
    writeSessionStatus,
} = require('./services/waIpc');
const { normalizeOperatorName } = require('./utils/operator');
const { normalizePhone } = require('./services/creatorEligibilityService');

const WA_OWNER = normalizeOperatorName(process.env.WA_OWNER, 'Beau');
const WA_SESSION_ID = String(process.env.WA_SESSION_ID || process.env.PORT || '3000').trim();
const WA_API_BASE = process.env.WA_API_BASE || `http://127.0.0.1:${process.env.PORT || 3000}`;
const CRAWLER_TAG = `${WA_OWNER}/${WA_SESSION_ID}`;
let statusTimer = null;
let commandTimer = null;
let commandInFlight = false;

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
    const text = String(message?.body ?? message?.text ?? message?.caption ?? '');
    return isBinaryLikePayload(text) ? '' : text;
}

async function fetchMessagesViaStore(chat, limit = 120) {
    const client = getClient();
    const chatId = chat?.id?._serialized || chat?.id?.SerializedString;
    if (!client?.pupPage || !chatId) return [];

    try {
        if (typeof chat.syncHistory ***REMOVED***= 'function') {
            await chat.syncHistory().catch(() => false);
        }
    } catch (_) {}

    await new Promise((resolve) => setTimeout(resolve, 1500));

    return await client.pupPage.evaluate(async (targetChatId, targetLimit) => {
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

async function fetchMessagesWithFallback(chat, limit = 120) {
    try {
        return await chat.fetchMessages({ limit });
    } catch (e) {
        const message = String(e?.message || '');
        if (isRecoverableFrameError(e)) {
            throw e;
        }
        if (!message.includes('waitForChatLoading')) {
            throw e;
        }
        console.warn(`[waCrawler:${CRAWLER_TAG}] fetchMessages fallback via Store.Chat for ${chat?.name || chat?.id?._serialized || 'unknown chat'}`);
        return await fetchMessagesViaStore(chat, limit);
    }
}

async function resolveChatByPhone(phone) {
    const client = getClient();
    if (!client) return null;

    const normalizedTarget = normalizePhone(phone);
    if (!normalizedTarget) return null;
    const chats = await client.getChats();
    for (const chat of chats) {
        if (chat.isGroup) continue;
        const contact = await chat.getContact().catch(() => null);
        if (!contact) continue;
        const chatPhone = normalizePhone(contact.number || '');
        if (chatPhone && chatPhone ***REMOVED***= normalizedTarget) {
            return { chat, contact };
        }
    }

    const cleanPhone = normalizedTarget.replace(/[^\d+]/g, '');
    if (!cleanPhone) return null;
    const chatId = cleanPhone.startsWith('+')
        ? `${cleanPhone.slice(1)}@c.us`
        : `${cleanPhone}@c.us`;

    try {
        const wid = await client.getNumberId(chatId).catch(() => null);
        const resolvedChatId = wid?._serialized || chatId;
        const chat = await client.getChatById(resolvedChatId).catch(() => null);
        if (!chat || chat.isGroup) return null;
        const contact = await chat.getContact().catch(() => null);
        return { chat, contact };
    } catch (_) {
        return null;
    }
}

async function fetchAuditMessagesByPhone(phone, limit = 120) {
    const client = getClient();
    if (!client) return { ok: false, error: 'WhatsApp client not initialized' };

    const normalizedTarget = normalizePhone(phone);
    for (let attempt = 1; attempt <= 3; attempt++) {
        let resolved = null;
        try {
            resolved = await resolveChatByPhone(normalizedTarget);
        } catch (error) {
            if (!isRecoverableFrameError(error) || attempt ***REMOVED***= 3) {
                return { ok: false, error: error.message || String(error) };
            }
            console.warn(`[waCrawler:${CRAWLER_TAG}] resolveChat retry for ${normalizedTarget} after frame reset (${attempt}/3)`);
            await new Promise((resolve) => setTimeout(resolve, 2000 * attempt));
            continue;
        }
        if (!resolved?.chat) break;

        try {
            const messages = await fetchMessagesWithFallback(resolved.chat, limit);
            return {
                ok: true,
                phone: normalizedTarget,
                name: resolved.contact?.name || resolved.contact?.pushname || resolved.chat.name || 'Unknown',
                messages: (messages || []).map((message) => ({
                    role: getWaMessageRole(message),
                    text: getWaMessageText(message),
                    timestamp: getWaMessageTimestampMs(message),
                    message_id: typeof message?.id ***REMOVED***= 'string'
                        ? message.id
                        : message?.id?._serialized || message?.id?.id || null,
                })),
            };
        } catch (error) {
            if (!isRecoverableFrameError(error) || attempt ***REMOVED***= 3) {
                return { ok: false, error: error.message || String(error) };
            }
            console.warn(`[waCrawler:${CRAWLER_TAG}] audit retry for ${normalizedTarget} after frame reset (${attempt}/3)`);
            await new Promise((resolve) => setTimeout(resolve, 2000 * attempt));
        }
    }
    return { ok: false, error: `chat not found for ${normalizedTarget}` };
}

function publishStatus(extra = {}) {
    try {
        writeSessionStatus(WA_SESSION_ID, {
            ...getWaStatus(),
            qr_value: getQrValue(),
            worker: getWaWorkerProgress(),
            pid: process.pid,
            owner: extra.owner || getWaStatus().owner || WA_OWNER,
            configured_owner: WA_OWNER,
            api_base: WA_API_BASE,
            running: true,
            ...extra,
        });
    } catch (err) {
        console.error(`[waCrawler:${CRAWLER_TAG}] publish status failed:`, err.message);
    }
}

async function processSessionCommands() {
    if (commandInFlight) return;
    commandInFlight = true;
    try {
        const claimed = claimNextSessionCommand(WA_SESSION_ID);
        if (!claimed) return;

        const payload = claimed.command || {};
        if (payload.type ***REMOVED***= 'send_message') {
            const result = await sendMessage(payload.phone, payload.text);
            completeClaimedCommand(claimed, {
                ...result,
                routed_session_id: WA_SESSION_ID,
                routed_operator: WA_OWNER,
            });
            publishStatus();
            return;
        }
        if (payload.type ***REMOVED***= 'send_media') {
            const mediaPayload = payload.payload || {};
            const result = await sendMedia(payload.phone, {
                caption: mediaPayload.caption || payload.caption || '',
                media_path: mediaPayload.media_path || null,
                media_url: mediaPayload.media_url || null,
                mime_type: mediaPayload.mime_type || null,
                file_name: mediaPayload.file_name || null,
                data_base64: mediaPayload.data_base64 || null,
            });
            completeClaimedCommand(claimed, {
                ...result,
                routed_session_id: WA_SESSION_ID,
                routed_operator: WA_OWNER,
            });
            publishStatus();
            return;
        }
        if (payload.type ***REMOVED***= 'audit_recent_messages') {
            const auditPayload = payload.payload || {};
            const result = await withTimeout(
                fetchAuditMessagesByPhone(
                    auditPayload.phone || payload.phone,
                    Number(auditPayload.limit || payload.limit || 120)
                ),
                45000,
                'audit_recent_messages timeout'
            ).catch((error) => ({
                ok: false,
                error: error.message,
            }));
            completeClaimedCommand(claimed, {
                ...result,
                routed_session_id: WA_SESSION_ID,
                routed_operator: WA_OWNER,
            });
            publishStatus();
            return;
        }

        completeClaimedCommand(claimed, {
            ok: false,
            error: `unsupported command type: ${payload.type || 'unknown'}`,
            routed_session_id: WA_SESSION_ID,
            routed_operator: WA_OWNER,
        });
    } catch (err) {
        console.error(`[waCrawler:${CRAWLER_TAG}] process command failed:`, err.message);
    } finally {
        commandInFlight = false;
    }
}

async function main() {
    console.log('═'.repeat(60));
    console.log(`  WA Crawler 启动中... (${CRAWLER_TAG})`);
    console.log(`  Profile API: ${WA_API_BASE}`);
    console.log('═'.repeat(60));

    startWaService();
    publishStatus();
    statusTimer = setInterval(() => publishStatus(), 2000);
    commandTimer = setInterval(() => {
        processSessionCommands().catch((err) => {
            console.error(`[waCrawler:${CRAWLER_TAG}] command loop failed:`, err.message);
        });
    }, 1000);
    await startWaWorker({ syncHistory: true });
    publishStatus();
}

let isShuttingDown = false;
async function shutdown(signal) {
    if (isShuttingDown) return;
    isShuttingDown = true;
    console.log(`[waCrawler:${CRAWLER_TAG}] ${signal} received, shutting down...`);
    if (statusTimer) clearInterval(statusTimer);
    if (commandTimer) clearInterval(commandTimer);
    publishStatus({
        ready: false,
        hasQr: false,
        running: false,
        error: `${signal} shutdown`,
        stopped_at: new Date().toISOString(),
    });
    try {
        stopWaWorker();
    } catch (_) {}
    try {
        await db.closeDb();
    } catch (_) {}
    process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

if (require.main ***REMOVED***= module) {
    main().catch(async (err) => {
        console.error(`[waCrawler:${CRAWLER_TAG}] fatal:`, err.message);
        try { await db.closeDb(); } catch (_) {}
        process.exit(1);
    });
}

module.exports = { main, shutdown };
