/**
 * WhatsApp Service — 单账号版本（Beau）
 */
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const { EventEmitter } = require('events');
const path = require('path');
const fs = require('fs');
const {
    normalizeOperatorName,
    getOperatorProfileByPhone,
    resolveOperatorByPhone,
} = require('../utils/operator');
let qrterminal;
try { qrterminal = require('qrcode-terminal'); } catch(e) { qrterminal = null; }

function sanitizeSessionId(value, fallback = '3000') {
    const raw = String(value || fallback).trim();
    const safe = raw.replace(/[^a-zA-Z0-9._-]/g, '_');
    return safe || fallback;
}

// 会话目录支持显式 WA_SESSION_ID，便于同机多 session 并行
const WA_PORT = parseInt(process.env.PORT || '3000', 10);
const WA_SESSION_ID = sanitizeSessionId(process.env.WA_SESSION_ID, String(WA_PORT));
const WA_OWNER = normalizeOperatorName(process.env.WA_OWNER, 'Beau');
const SESSION_DIR = path.join(__dirname, `../../.wwebjs_auth/session-${WA_SESSION_ID}`);
if (!fs.existsSync(SESSION_DIR)) fs.mkdirSync(SESSION_DIR, { recursive: true });

// Shared EventEmitter so waWorker can wait for ready
const ee = new EventEmitter();

let client = null;
let ready = false;
let qr = null;
let reconnectTimer = null;  // 断开重连定时器，可清除
let lastError = null;
let accountPhone = null;
let accountPushname = null;
let detectedOwner = null;
let detectedOwnerProfile = null;
let qrRefreshCount = 0;
let lastQrAt = null;
const VERBOSE_LOGS = process.env.LOG_VERBOSE === 'true';
const PRINT_QR_IN_TERMINAL = process.env.WA_PRINT_QR !== 'false';
const RECONNECT_DELAY_MS = 5000;

function maskPhone(phone) {
    const digits = String(phone || '').replace(/\D/g, '');
    if (digits.length <= 4) return '***';
    return `***${digits.slice(-4)}`;
}

function clearReconnectTimer() {
    if (!reconnectTimer) return;
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
}

function extractSelfPhone(cli) {
    const widUser = cli?.info?.wid?.user;
    if (widUser) return `+${String(widUser).replace(/\D/g, '')}`;
    const serialized = cli?.info?.wid?._serialized;
    if (serialized && serialized.includes('@')) {
        const raw = serialized.split('@')[0];
        return `+${String(raw).replace(/\D/g, '')}`;
    }
    return null;
}

function getResolvedOwner() {
    return detectedOwner || WA_OWNER;
}

function scheduleReconnect(reason = 'unknown') {
    clearReconnectTimer();
    console.log(`[WA Service:${WA_SESSION_ID}] ${reason}，${RECONNECT_DELAY_MS / 1000}秒后重试初始化...`);
    reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        initClient();
    }, RECONNECT_DELAY_MS);
}

function handleClientFailure(error, reason = '初始化失败') {
    const message = error?.message || String(error || reason);
    ready = false;
    qr = null;
    lastError = message;
    accountPhone = null;
    accountPushname = null;
    detectedOwner = null;
    detectedOwnerProfile = null;
    qrRefreshCount = 0;
    lastQrAt = null;
    ee.emit('failed', new Error(message));
    console.error(`[WA Service:${WA_SESSION_ID}] ${reason}: ${message}`);

    if (client) {
        try {
            client.removeAllListeners();
            client.destroy().catch(() => {});
        } catch (_) {}
        client = null;
    }

    scheduleReconnect(reason);
}

function initClient() {
    if (client) return client;

    console.log(`[WA Service:${WA_SESSION_ID}] 初始化 WhatsApp Client... (owner=${WA_OWNER})`);
    lastError = null;

    client = new Client({
        authStrategy: new LocalAuth({
            dir: SESSION_DIR,
            dataPath: SESSION_DIR,
        }),
        puppeteer: {
            executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox'],
        },
    });

    client.on('qr', (q) => {
        qr = q;
        qrRefreshCount += 1;
        lastQrAt = new Date().toISOString();
        console.log(`[WA Service:${WA_SESSION_ID}] 需要扫码认证 (QR#${qrRefreshCount} at ${lastQrAt})`);
        if (PRINT_QR_IN_TERMINAL && qrterminal) {
            console.log('═'.repeat(50));
            console.log(`QR 刷新 #${qrRefreshCount} (${lastQrAt})`);
            try {
                qrterminal.generate(q, { small: true });
            } catch (_) {
                console.log('QR:', q);
            }
            console.log('═'.repeat(50));
        } else if (PRINT_QR_IN_TERMINAL) {
            console.log('QR:', q);
        }
        console.log(`WhatsApp → ⋮ → 已关联的设备 → 关联新设备 扫码上方二维码`);
    });

    client.on('ready', () => {
        ready = true;
        qr = null;
        lastError = null;
        qrRefreshCount = 0;
        lastQrAt = null;
        accountPhone = extractSelfPhone(client);
        accountPushname = client?.info?.pushname || null;
        detectedOwner = resolveOperatorByPhone(accountPhone, null);
        detectedOwnerProfile = getOperatorProfileByPhone(accountPhone);
        clearReconnectTimer();
        const resolved = getResolvedOwner();
        const source = detectedOwner ? 'phone_map' : 'env';
        console.log(`[WA Service:${WA_SESSION_ID}] WhatsApp 已就绪! owner=${resolved} source=${source} phone=${maskPhone(accountPhone)}`);
        if (detectedOwner && detectedOwner !== WA_OWNER) {
            console.warn(`[WA Service:${WA_SESSION_ID}] owner mismatch: env=${WA_OWNER}, detected=${detectedOwner}; 优先使用 detected`);
        }
        ee.emit('ready');
    });

    client.on('auth_failure', (message) => {
        handleClientFailure(new Error(message || 'auth_failure'), '认证失败');
    });

    client.on('disconnected', (reason) => {
        handleClientFailure(new Error(String(reason || 'disconnected')), '已断开');
    });

    client.on('change_state', (state) => {
        if (VERBOSE_LOGS) {
            console.log(`[WA Service:${WA_SESSION_ID}] state=${state}`);
        }
    });

    client.initialize().catch((error) => {
        handleClientFailure(error, '初始化失败');
    });
    return client;
}

/**
 * 启动 WhatsApp Client（由 server/index.cjs 在端口确认可用后调用）
 * 不再自动调用，支持多实例时按序初始化
 */
function start() {
    initClient();
}

async function sendMessage(phone, text) {
    if (!client || !ready) {
        return { ok: false, error: 'WhatsApp 未就绪，请先扫码认证' };
    }
    try {
        const cleanPhone = phone.replace(/[^\d+]/g, '');
        const chatId = cleanPhone.startsWith('+')
            ? cleanPhone.substring(1) + '@c.us'
            : cleanPhone + '@c.us';
        const messageId = await client.sendMessage(chatId, text);
        if (VERBOSE_LOGS) {
            console.log(`[WA Service:${WA_SESSION_ID}] 发送成功 → ${maskPhone(phone)}: ${text.slice(0, 50)}`);
        }
        return { ok: true, messageId };
    } catch (err) {
        console.error(`[WA Service:${WA_SESSION_ID}] 发送失败 → ${maskPhone(phone)}:`, err.message);
        return { ok: false, error: err.message };
    }
}

async function resolveMediaPayload({ media_path, media_url, mime_type, file_name, data_base64 }) {
    if (data_base64 && mime_type) {
        return new MessageMedia(mime_type, String(data_base64), file_name || 'image');
    }
    if (media_path) {
        return MessageMedia.fromFilePath(String(media_path));
    }
    if (media_url) {
        return await MessageMedia.fromUrl(String(media_url), {
            unsafeMime: true,
            filename: file_name || undefined,
        });
    }
    throw new Error('media payload missing: provide media_path, media_url, or data_base64');
}

function extractMessageId(result) {
    if (!result) return null;
    if (typeof result === 'string') return result;
    return result?.id?._serialized || result?.id?.id || result?.id || null;
}

async function sendMedia(phone, media = {}) {
    if (!client || !ready) {
        return { ok: false, error: 'WhatsApp 未就绪，请先扫码认证' };
    }
    try {
        const cleanPhone = String(phone || '').replace(/[^\d+]/g, '');
        const chatId = cleanPhone.startsWith('+')
            ? cleanPhone.substring(1) + '@c.us'
            : cleanPhone + '@c.us';
        const preparedMedia = await resolveMediaPayload(media);
        const sendOptions = {};
        if (media.caption && String(media.caption).trim()) {
            sendOptions.caption = String(media.caption).trim();
        }
        const sent = await client.sendMessage(chatId, preparedMedia, sendOptions);
        const messageId = extractMessageId(sent);
        if (VERBOSE_LOGS) {
            console.log(`[WA Service:${WA_SESSION_ID}] 图片发送成功 → ${maskPhone(phone)} msg=${messageId || 'n/a'}`);
        }
        return { ok: true, messageId };
    } catch (err) {
        const rawMessage = String(err?.message || '').trim();
        const safeMessage = rawMessage.length <= 1 ? 'WhatsApp rejected media send' : rawMessage;
        console.error(`[WA Service:${WA_SESSION_ID}] 图片发送失败 → ${maskPhone(phone)}:`, safeMessage);
        return { ok: false, error: safeMessage };
    }
}

function getStatus() {
    return {
        ready,
        hasQr: !!qr,
        error: lastError,
        session_id: WA_SESSION_ID,
        configured_owner: WA_OWNER,
        owner: getResolvedOwner(),
        owner_source: detectedOwner ? 'phone_map' : 'env',
        account_phone: accountPhone,
        account_pushname: accountPushname,
        operator_profile: detectedOwnerProfile,
        qr_refresh_count: qrRefreshCount,
        last_qr_at: lastQrAt,
    };
}

function getQrValue() {
    return qr;
}

/**
 * 等待 WhatsApp Client 就绪（最多 timeoutMs）
 * @returns {Promise<void>}
 */
function waitForReady(timeoutMs = 120000) {
    return new Promise((resolve, reject) => {
        if (ready) { resolve(); return; }
        if (lastError && !client) {
            reject(new Error(lastError));
            return;
        }
        const tid = setTimeout(() => {
            ee.removeListener('ready', onReady);
            ee.removeListener('failed', onFailed);
            reject(new Error('等待 WhatsApp 就绪超时'));
        }, timeoutMs);
        function onReady() {
            clearTimeout(tid);
            ee.removeListener('failed', onFailed);
            resolve();
        }
        function onFailed(error) {
            clearTimeout(tid);
            ee.removeListener('ready', onReady);
            reject(error instanceof Error ? error : new Error(String(error || 'WA 初始化失败')));
        }
        ee.once('ready', onReady);
        ee.once('failed', onFailed);
    });
}

/**
 * 停止 WhatsApp Service，清除所有定时器
 * 注意：destroy 前先移除 disconnected 监听，避免关闭时触发重连定时器
 */
function stop() {
    clearReconnectTimer();
    if (client) {
        client.removeAllListeners('disconnected');
        client.removeAllListeners('auth_failure');
        client.destroy().catch(() => {});
        client = null;
    }
    ready = false;
    qr = null;
    qrRefreshCount = 0;
    lastQrAt = null;
}

module.exports = {
    sendMessage,
    sendMedia,
    getStatus,
    getQrValue,
    getResolvedOwner,
    getClient: () => client,
    getReady: () => ready,
    waitForReady,
    stop,
    start,
};
