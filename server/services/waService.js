/**
 * WhatsApp Service — 多账号版本
 * 支持在单个容器中运行多个 WhatsApp client 实例
 */
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const { EventEmitter } = require('events');
const path = require('path');
const fs = require('fs');
const { assertNoGroupSend } = require('./groupSendGuard');
const {
    normalizeOperatorName,
    getOperatorProfileByPhone,
    resolveOperatorByPhone,
} = require('../utils/operator');

let qrterminal;
try { qrterminal = require('qrcode-terminal'); } catch(e) { qrterminal = null; }

const VERBOSE_LOGS = process.env.LOG_VERBOSE === 'true';
const PRINT_QR_IN_TERMINAL = process.env.WA_PRINT_QR !== 'false';
const RECONNECT_DELAY_MS = 5000;
const READY_PROBE_INTERVAL_MS = 2000;

/**
 * Session 配置解析
 */
function parseSessionConfig() {
    const raw = process.env.WA_SESSIONS;
    if (!raw) {
        // 默认单个 session
        return [{
            port: parseInt(process.env.PORT || '3000', 10),
            sessionId: process.env.WA_SESSION_ID || process.env.PORT || '3000',
            owner: normalizeOperatorName(process.env.WA_OWNER, 'Beau'),
        }];
    }

    try {
        const parsed = JSON.parse(raw);
        const sessions = Array.isArray(parsed) ? parsed : Object.values(parsed);
        return sessions.map((s, idx) => ({
            port: parseInt(s.port || s.PORT || (3000 + idx), 10),
            sessionId: String(s.sessionId || s.session_id || s.SESSION_ID || (3000 + idx)).trim(),
            owner: normalizeOperatorName(s.owner || s.OWNER || 'Beau', 'Beau'),
        }));
    } catch (err) {
        console.error('[WA Service] WA_SESSIONS 解析失败:', err.message);
        return [];
    }
}

/**
 * 解析 auth root
 */
function resolveAuthRoot(sessionId) {
    const configured = String(process.env.WA_AUTH_ROOT || process.env.WWEBJS_AUTH_ROOT || '').trim();
    if (configured) {
        // 每个 session 一个子目录
        return path.join(path.resolve(configured), `session-${sessionId}`);
    }
    return path.join(__dirname, `../../.wwebjs_auth/session-${sessionId}`);
}

/**
 * 解析 chrome executable path
 */
function resolveChromeExecutablePath() {
    const explicit = String(process.env.WA_CHROME_EXECUTABLE_PATH || process.env.PUPPETEER_EXECUTABLE_PATH || '').trim();
    if (explicit) return explicit;

    const candidates = process.platform === 'darwin'
        ? [
            '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
            '/Applications/Chromium.app/Contents/MacOS/Chromium',
        ]
        : [
            '/usr/bin/chromium',
            '/usr/bin/chromium-browser',
            '/usr/bin/google-chrome',
            '/usr/bin/google-chrome-stable',
        ];

    return candidates.find((candidate) => fs.existsSync(candidate)) || undefined;
}

function sanitizeSessionId(value, fallback = '3000') {
    const raw = String(value || fallback).trim();
    const safe = raw.replace(/[^a-zA-Z0-9._-]/g, '_');
    return safe || fallback;
}

function maskPhone(phone) {
    const digits = String(phone || '').replace(/\D/g, '');
    if (digits.length <= 4) return '***';
    return `***${digits.slice(-4)}`;
}

/**
 * WhatsApp Service 实例类
 * 每个实例管理一个 WhatsApp client
 */
class WhatsAppService {
    constructor({ port, sessionId, owner, authRootDir }) {
        this.port = port;
        this.sessionId = sanitizeSessionId(sessionId, String(port));
        this.owner = normalizeOperatorName(owner, 'Beau');
        this.authRootDir = authRootDir;
        this.sessionDir = path.join(this.authRootDir, `session-${this.sessionId}`);

        this.client = null;
        this.ready = false;
        this.qr = null;
        this.lastError = null;
        this.accountPhone = null;
        this.accountPushname = null;
        this.detectedOwner = null;
        this.detectedOwnerProfile = null;
        this.qrRefreshCount = 0;
        this.lastQrAt = null;
        this.reconnectTimer = null;
        this.ee = new EventEmitter();
        this.initialized = false;
    }

    getStatus() {
        return {
            ready: this.ready,
            hasQr: !!this.qr,
            error: this.lastError,
            session_id: this.sessionId,
            configured_owner: this.owner,
            owner: this.getResolvedOwner(),
            owner_source: this.detectedOwner ? 'phone_map' : 'env',
            account_phone: this.accountPhone,
            account_pushname: this.accountPushname,
            operator_profile: this.detectedOwnerProfile,
            qr_refresh_count: this.qrRefreshCount,
            last_qr_at: this.lastQrAt,
        };
    }

    getResolvedOwner() {
        return this.detectedOwner || this.owner;
    }

    getQrValue() {
        return this.qr;
    }

    getReady() {
        return this.ready;
    }

    getClient() {
        return this.client;
    }

    clearReconnectTimer() {
        if (!this.reconnectTimer) return;
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
    }

    extractSelfPhone(cli) {
        const widUser = cli?.info?.wid?.user;
        if (widUser) return `+${String(widUser).replace(/\D/g, '')}`;
        const serialized = cli?.info?.wid?._serialized;
        if (serialized && serialized.includes('@')) {
            const raw = serialized.split('@')[0];
            return `+${String(raw).replace(/\D/g, '')}`;
        }
        return null;
    }

    async detectLoggedInPageState() {
        if (!this.client?.pupPage || this.client.pupPage.isClosed()) return { loggedIn: false };
        try {
            return await this.client.pupPage.evaluate(() => ({
                loggedIn: !!window.Store && !!window.AuthStore && !!document.querySelector('#pane-side'),
                title: document.title || '',
            }));
        } catch (_) {
            return { loggedIn: false };
        }
    }

    async ensureReadyFromPageProbe() {
        if (this.ready) return true;
        const probe = await this.detectLoggedInPageState();
        if (!probe.loggedIn) return false;

        this.ready = true;
        this.qr = null;
        this.lastError = null;
        this.qrRefreshCount = 0;
        this.lastQrAt = null;
        this.clearReconnectTimer();
        const nextPhone = this.extractSelfPhone(this.client);
        if (nextPhone) {
            this.accountPhone = nextPhone;
            this.accountPushname = this.client?.info?.pushname || this.accountPushname || null;
            this.detectedOwner = resolveOperatorByPhone(this.accountPhone, this.detectedOwner || null);
            this.detectedOwnerProfile = getOperatorProfileByPhone(this.accountPhone) || this.detectedOwnerProfile || null;
        }
        console.log(`[WA Service:${this.sessionId}] 使用页面探针恢复 ready 状态 (${probe.title || 'WhatsApp'})`);
        this.ee.emit('ready');
        return true;
    }

    scheduleReconnect(reason = 'unknown') {
        this.clearReconnectTimer();
        console.log(`[WA Service:${this.sessionId}] ${reason}，${RECONNECT_DELAY_MS / 1000}秒后重试初始化...`);
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            this.initClient();
        }, RECONNECT_DELAY_MS);
    }

    handleClientFailure(error, reason = '初始化失败') {
        const message = error?.message || String(error || reason);
        this.ready = false;
        this.qr = null;
        this.lastError = message;
        this.accountPhone = null;
        this.accountPushname = null;
        this.detectedOwner = null;
        this.detectedOwnerProfile = null;
        this.qrRefreshCount = 0;
        this.lastQrAt = null;
        this.ee.emit('failed', new Error(message));
        console.error(`[WA Service:${this.sessionId}] ${reason}: ${message}`);

        if (this.client) {
            try {
                this.client.removeAllListeners();
                this.client.destroy().catch(() => {});
            } catch (_) {}
            this.client = null;
        }

        this.scheduleReconnect(reason);
    }

    initClient() {
        if (this.client) return this.client;

        // 确保 session 目录存在
        if (!fs.existsSync(this.sessionDir)) {
            fs.mkdirSync(this.sessionDir, { recursive: true });
        }

        const chromePath = resolveChromeExecutablePath();
        console.log(`[WA Service:${this.sessionId}] 初始化 WhatsApp Client... (owner=${this.owner}, auth_root=${this.sessionDir}, browser=${chromePath || 'auto'})`);
        this.lastError = null;

        const puppeteerArgs = [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--disable-web-security',
            ...(process.env.WA_PUPPETEER_ARGS || '').split(/\s+/).filter(Boolean),
        ];

        const puppeteerConfig = {
            headless: process.env.WA_HEADLESS !== 'false',
            args: [...new Set(puppeteerArgs)],
        };
        if (chromePath) {
            puppeteerConfig.executablePath = chromePath;
        }

        this.client = new Client({
            authStrategy: new LocalAuth({
                dir: this.sessionDir,
                dataPath: this.sessionDir,
            }),
            puppeteer: puppeteerConfig,
        });

        this.client.on('qr', (q) => {
            this.qr = q;
            this.qrRefreshCount += 1;
            this.lastQrAt = new Date().toISOString();
            console.log(`[WA Service:${this.sessionId}] 需要扫码认证 (QR#${this.qrRefreshCount} at ${this.lastQrAt})`);
            if (PRINT_QR_IN_TERMINAL && qrterminal) {
                console.log('═'.repeat(50));
                console.log(`QR 刷新 #${this.qrRefreshCount} (${this.lastQrAt})`);
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

        this.client.on('ready', () => {
            this.ready = true;
            this.qr = null;
            this.lastError = null;
            this.qrRefreshCount = 0;
            this.lastQrAt = null;
            this.accountPhone = this.extractSelfPhone(this.client);
            this.accountPushname = this.client?.info?.pushname || null;
            this.detectedOwner = resolveOperatorByPhone(this.accountPhone, null);
            this.detectedOwnerProfile = getOperatorProfileByPhone(this.accountPhone);
            this.clearReconnectTimer();
            const resolved = this.getResolvedOwner();
            const source = this.detectedOwner ? 'phone_map' : 'env';
            console.log(`[WA Service:${this.sessionId}] WhatsApp 已就绪! owner=${resolved} source=${source} phone=${maskPhone(this.accountPhone)}`);
            if (this.detectedOwner && this.detectedOwner !== this.owner) {
                console.warn(`[WA Service:${this.sessionId}] owner mismatch: env=${this.owner}, detected=${this.detectedOwner}; 优先使用 detected`);
            }
            this.ee.emit('ready');
        });

        this.client.on('auth_failure', (message) => {
            this.handleClientFailure(new Error(message || 'auth_failure'), '认证失败');
        });

        this.client.on('disconnected', (reason) => {
            this.handleClientFailure(new Error(String(reason || 'disconnected')), '已断开');
        });

        this.client.on('change_state', (state) => {
            if (VERBOSE_LOGS) {
                console.log(`[WA Service:${this.sessionId}] state=${state}`);
            }
        });

        this.client.initialize().catch((error) => {
            this.handleClientFailure(error, '初始化失败');
        });

        return this.client;
    }

    start() {
        if (this.initialized) return;
        this.initialized = true;
        this.initClient();
    }

    async sendMessage(phone, text) {
        const targetGuard = assertNoGroupSend(phone, { source: 'wa_service.send_message' });
        if (!targetGuard.ok) {
            return { ok: false, error: targetGuard.error };
        }
        if ((!this.client || !this.ready) && !(await this.ensureReadyFromPageProbe())) {
            return { ok: false, error: 'WhatsApp 未就绪，请先扫码认证' };
        }
        try {
            const cleanPhone = phone.replace(/[^\d+]/g, '');
            const chatId = cleanPhone.startsWith('+')
                ? cleanPhone.substring(1) + '@c.us'
                : cleanPhone + '@c.us';
            const messageId = await this.client.sendMessage(chatId, text);
            if (VERBOSE_LOGS) {
                console.log(`[WA Service:${this.sessionId}] 发送成功 → ${maskPhone(phone)}: ${text.slice(0, 50)}`);
            }
            return { ok: true, messageId };
        } catch (err) {
            console.error(`[WA Service:${this.sessionId}] 发送失败 → ${maskPhone(phone)}:`, err.message);
            return { ok: false, error: err.message };
        }
    }

    async resolveMediaPayload({ media_path, media_url, mime_type, file_name, data_base64 }) {
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

    extractMessageId(result) {
        if (!result) return null;
        if (typeof result === 'string') return result;
        return result?.id?._serialized || result?.id?.id || result?.id || null;
    }

    async sendMedia(phone, media = {}) {
        const targetGuard = assertNoGroupSend(phone, { source: 'wa_service.send_media' });
        if (!targetGuard.ok) {
            return { ok: false, error: targetGuard.error };
        }
        if ((!this.client || !this.ready) && !(await this.ensureReadyFromPageProbe())) {
            return { ok: false, error: 'WhatsApp 未就绪，请先扫码认证' };
        }
        try {
            const cleanPhone = String(phone || '').replace(/[^\d+]/g, '');
            const chatId = cleanPhone.startsWith('+')
                ? cleanPhone.substring(1) + '@c.us'
                : cleanPhone + '@c.us';
            const preparedMedia = await this.resolveMediaPayload(media);
            const sendOptions = {};
            if (media.caption && String(media.caption).trim()) {
                sendOptions.caption = String(media.caption).trim();
            }
            const sent = await this.client.sendMessage(chatId, preparedMedia, sendOptions);
            const messageId = this.extractMessageId(sent);
            if (VERBOSE_LOGS) {
                console.log(`[WA Service:${this.sessionId}] 图片发送成功 → ${maskPhone(phone)} msg=${messageId || 'n/a'}`);
            }
            return { ok: true, messageId };
        } catch (err) {
            const rawMessage = String(err?.message || '').trim();
            const safeMessage = rawMessage.length <= 1 ? 'WhatsApp rejected media send' : rawMessage;
            console.error(`[WA Service:${this.sessionId}] 图片发送失败 → ${maskPhone(phone)}:`, safeMessage);
            return { ok: false, error: safeMessage };
        }
    }

    waitForReady(timeoutMs = 120000) {
        return new Promise((resolve, reject) => {
            let probeTimer = null;
            if (this.ready) { resolve(); return; }
            if (this.lastError && !this.client) {
                reject(new Error(this.lastError));
                return;
            }
            const runProbe = async () => {
                try {
                    if (await this.ensureReadyFromPageProbe()) {
                        onReady();
                    }
                } catch (_) {}
            };
            const tid = setTimeout(() => {
                if (probeTimer) clearInterval(probeTimer);
                this.ee.removeListener('ready', onReady);
                this.ee.removeListener('failed', onFailed);
                reject(new Error('等待 WhatsApp 就绪超时'));
            }, timeoutMs);
            const onReady = () => {
                clearTimeout(tid);
                if (probeTimer) clearInterval(probeTimer);
                this.ee.removeListener('failed', onFailed);
                resolve();
            };
            const onFailed = (error) => {
                clearTimeout(tid);
                if (probeTimer) clearInterval(probeTimer);
                this.ee.removeListener('ready', onReady);
                reject(error instanceof Error ? error : new Error(String(error || 'WA 初始化失败')));
            };
            this.ee.once('ready', onReady);
            this.ee.once('failed', onFailed);
            probeTimer = setInterval(() => {
                runProbe().catch(() => {});
            }, READY_PROBE_INTERVAL_MS);
            runProbe().catch(() => {});
        });
    }

    stop() {
        this.clearReconnectTimer();
        if (this.client) {
            this.client.removeAllListeners('disconnected');
            this.client.removeAllListeners('auth_failure');
            this.client.destroy().catch(() => {});
            this.client = null;
        }
        this.ready = false;
        this.qr = null;
        this.qrRefreshCount = 0;
        this.lastQrAt = null;
        this.initialized = false;
    }
}

// ================== Service Registry ==================

const services = new Map();
let authRootBase = '';

function initAuthRootBase() {
    const configured = String(process.env.WA_AUTH_ROOT || process.env.WWEBJS_AUTH_ROOT || '').trim();
    if (configured) {
        authRootBase = path.resolve(configured);
    } else {
        authRootBase = path.join(__dirname, '../../.wwebjs_auth');
    }
}

function getService(sessionId) {
    return services.get(sessionId);
}

function getServiceByOwner(owner) {
    const normalizedOwner = normalizeOperatorName(owner, owner);
    for (const service of services.values()) {
        if (normalizeOperatorName(service.owner, service.owner) === normalizedOwner) {
            return service;
        }
        if (normalizeOperatorName(service.getResolvedOwner(), service.getResolvedOwner()) === normalizedOwner) {
            return service;
        }
    }
    return null;
}

function getAllServices() {
    return Array.from(services.values());
}

function createServices() {
    initAuthRootBase();
    const configs = parseSessionConfig();
    console.log(`[WA Service] 配置了 ${configs.length} 个 WhatsApp Session`);

    for (const config of configs) {
        const service = new WhatsAppService({
            port: config.port,
            sessionId: config.sessionId,
            owner: config.owner,
            authRootDir: authRootBase,
        });
        services.set(config.sessionId, service);
        console.log(`[WA Service] 注册 session: ${config.sessionId} (owner=${config.owner})`);
    }

    return services;
}

function startAllServices() {
    for (const service of services.values()) {
        service.start();
    }
}

function stopAllServices() {
    for (const service of services.values()) {
        service.stop();
    }
}

// 导出给 waWorker 用的轮询函数（保持 API 兼容）
function createWorkerPoller(service) {
    const POLL_INTERVAL_MS = parseInt(process.env.WA_POLL_INTERVAL_MS || '60000', 10);
    const HISTORY_MSG_LIMIT = parseInt(process.env.WA_HISTORY_MSG_LIMIT || '500', 10);
    const POLL_FETCH_LIMIT = parseInt(process.env.WA_POLL_FETCH_LIMIT || '50', 10);

    let pollTimer = null;
    let stopping = false;

    async function pollMessages() {
        if (stopping || !service.getReady()) return;
        // 轮询逻辑由 waWorker 调用
    }

    function startPolling() {
        if (pollTimer) return;
        pollTimer = setInterval(() => {
            pollMessages().catch((err) => {
                console.error(`[WA Worker:${service.sessionId}] 轮询异常:`, err.message);
            });
        }, POLL_INTERVAL_MS);
    }

    function stopPolling() {
        stopping = true;
        if (pollTimer) {
            clearInterval(pollTimer);
            pollTimer = null;
        }
    }

    return { startPolling, stopPolling };
}

// ================== Legacy API (单 session 兼容) ==================

// 为了向后兼容，提供默认 service 的快捷方法
function getDefaultService() {
    const configs = parseSessionConfig();
    if (configs.length === 0) return null;
    return services.get(configs[0].sessionId) || null;
}

module.exports = {
    // 类和工厂
    WhatsAppService,
    createServices,
    getService,
    getServiceByOwner,
    getAllServices,

    // 控制
    startAllServices,
    stopAllServices,

    // 轮询
    createWorkerPoller,

    // Legacy API (向后兼容)
    sendMessage: (...args) => getDefaultService()?.sendMessage(...args),
    sendMedia: (...args) => getDefaultService()?.sendMedia(...args),
    getStatus: (...args) => getDefaultService()?.getStatus(...args),
    getQrValue: (...args) => getDefaultService()?.getQrValue(...args),
    getResolvedOwner: (...args) => getDefaultService()?.getResolvedOwner(...args),
    getClient: (...args) => getDefaultService()?.getClient(...args),
    getReady: (...args) => getDefaultService()?.getReady(...args),
    waitForReady: (...args) => getDefaultService()?.waitForReady(...args),
    stop: stopAllServices,
    start: startAllServices,
};
