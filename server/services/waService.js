/**
 * WhatsApp Service — 多账号版本
 *
 * ⚠️  Legacy facade (commit 2/8): this file now delegates to WwebjsDriver.
 * All new code should use server/services/wa/index.js → createDriver() instead.
 *
 * Supports running multiple WhatsApp client instances in a single container.
 *
 * Public API (unchanged — backward compatible with waSessionRouter, waWorker):
 *   WhatsAppService — class (now backed by WwebjsDriver internally)
 *   parseSessionConfig() — env → session config list
 *   resolveAuthRoot(sessionId) — env → auth root dir
 *   startAllServices() / stopAllServices()
 *   sendMessage(phone, text) / sendMedia(phone, media) — single-session shortcut
 *   getStatus() / getQrValue() / getReady() / waitForReady()
 *   getClient() — returns internal Client (backward compat; null on baileys)
 *   createWorkerPoller(service)
 */
'use strict';
const { EventEmitter } = require('events');
const path = require('path');
const { createDriver } = require('./wa/index');
const {
    normalizeOperatorName,
    getOperatorProfileByPhone,
    resolveOperatorByPhone,
} = require('../utils/operator');

let qrterminal;
try { qrterminal = require('qrcode-terminal'); } catch (e) { qrterminal = null; }

const VERBOSE_LOGS = process.env.LOG_VERBOSE === 'true';
const PRINT_QR_IN_TERMINAL = process.env.WA_PRINT_QR !== 'false';
const RECONNECT_DELAY_MS = 5000;
const READY_PROBE_INTERVAL_MS = 2000;

function sanitizeSessionId(value, fallback = '3000') {
    const raw = String(value || fallback).trim();
    return raw.replace(/[^a-zA-Z0-9._-]/g, '_') || fallback;
}

function maskPhone(phone) {
    const digits = String(phone || '').replace(/\D/g, '');
    return digits.length <= 4 ? '***' : `***${digits.slice(-4)}`;
}

function resolveDriverName(value) {
    const raw = String(value || '').trim().toLowerCase();
    if (raw === 'baileys' || raw === 'wwebjs') return raw;
    return null;
}

function defaultDriverName() {
    return resolveDriverName(process.env.WA_DRIVER)
        || resolveDriverName(process.env.WA_DEFAULT_DRIVER)
        || 'wwebjs';
}

/**
 * Parse session configs from WA_SESSIONS env var.
 * @returns {Array<{port:number, sessionId:string, owner:string, driver:'wwebjs'|'baileys'}>}
 */
function parseSessionConfig() {
    const raw = process.env.WA_SESSIONS;
    const fallbackDriver = defaultDriverName();
    if (!raw) {
        return [{
            port: parseInt(process.env.PORT || '3000', 10),
            sessionId: process.env.WA_SESSION_ID || process.env.PORT || '3000',
            owner: normalizeOperatorName(process.env.WA_OWNER, 'Beau'),
            driver: fallbackDriver,
        }];
    }
    try {
        const parsed = JSON.parse(raw);
        const sessions = Array.isArray(parsed) ? parsed : Object.values(parsed);
        return sessions.map((s, idx) => ({
            port: parseInt(s.port || s.PORT || (3000 + idx), 10),
            sessionId: String(s.sessionId || s.session_id || s.SESSION_ID || (3000 + idx)).trim(),
            owner: normalizeOperatorName(s.owner || s.OWNER || 'Beau', 'Beau'),
            driver: resolveDriverName(s.driver || s.DRIVER) || fallbackDriver,
        }));
    } catch (err) {
        console.error('[WA Service] WA_SESSIONS 解析失败:', err.message);
        return [];
    }
}

function resolveAuthRoot(sessionId) {
    const configured = String(process.env.WA_AUTH_ROOT || process.env.WWEBJS_AUTH_ROOT || '').trim();
    if (configured) {
        return path.join(path.resolve(configured), `session-${sessionId}`);
    }
    return path.join(__dirname, `../../.wwebjs_auth/session-${sessionId}`);
}

function resolveAuthRootForDriver(driver) {
    if (driver === 'baileys') {
        const base = String(process.env.WA_BAILEYS_AUTH_ROOT || '').trim();
        return base ? path.resolve(base) : path.join(__dirname, '../../.baileys_auth');
    }
    const base = String(process.env.WA_AUTH_ROOT || process.env.WWEBJS_AUTH_ROOT || '').trim();
    return base ? path.resolve(base) : path.join(__dirname, '../../.wwebjs_auth');
}

/**
 * WhatsAppService — facade backed by WwebjsDriver.
 *
 * Maintains the same public interface as before so callers (waSessionRouter,
 * waWorker, routes/wa.js) don't need to change.
 *
 * For new code, use: const driver = await createDriver(sessionConfig)
 */
class WhatsAppService extends EventEmitter {
    /** @param {{ port:number, sessionId:string, owner:string, authRootDir?:string, driver?:'wwebjs'|'baileys', driverMeta?:object }} cfg */
    constructor({ port, sessionId, owner, authRootDir, driver, driverMeta }) {
        super();
        this.port = port;
        this.sessionId = sanitizeSessionId(sessionId, String(port));
        this.owner = normalizeOperatorName(owner, 'Beau');
        this.driver = resolveDriverName(driver) || defaultDriverName();
        this.driverMeta = driverMeta || {};
        this.authRootDir = authRootDir || resolveAuthRootForDriver(this.driver);
        /** @type {import('./wa/driver/types').WaDriver|null} */
        this._driver = null;
        this._client = null; // legacy — set for backward compat with code that calls getClient()
        this._qr = null;
        this._lastError = null;
        this._accountPhone = null;
        this._accountPushname = null;
        this._detectedOwner = null;
        this._detectedOwnerProfile = null;
        this._qrRefreshCount = 0;
        this._lastQrAt = null;
        this._reconnectTimer = null;
        this._initialized = false;
    }

    getStatus() {
        if (this._driver) {
            const s = this._driver.getStatus();
            return {
                ready: s.ready,
                hasQr: s.hasQr,
                error: s.error,
                session_id: this.sessionId,
                configured_owner: this.owner,
                owner: s.owner || this.owner,
                owner_source: this._detectedOwner ? 'phone_map' : 'env',
                account_phone: s.accountPhone || this._accountPhone,
                account_pushname: this._accountPushname,
                operator_profile: this._detectedOwnerProfile,
                qr_refresh_count: this._qrRefreshCount,
                last_qr_at: this._lastQrAt,
            };
        }
        // fallback before driver is set
        return {
            ready: false, hasQr: !!this._qr, error: this._lastError,
            session_id: this.sessionId, configured_owner: this.owner,
            owner: this.owner, account_phone: null,
        };
    }

    getResolvedOwner() {
        return this._detectedOwner || this.owner;
    }

    getQrValue() {
        return this._driver ? this._driver.getQR() : this._qr;
    }

    getReady() {
        return this._driver ? this._driver.getStatus().ready : false;
    }

    /** @returns {any} wwebjs Client or null (backward compat) */
    getClient() {
        return this._client;
    }

    clearReconnectTimer() {
        if (!this._reconnectTimer) return;
        clearTimeout(this._reconnectTimer);
        this._reconnectTimer = null;
    }

    extractSelfPhone() {
        const cli = this._client;
        if (!cli?.info?.wid) return null;
        const widUser = cli.info.wid.user;
        if (widUser) return `+${String(widUser).replace(/\D/g, '')}`;
        const serialized = cli.info.wid._serialized;
        if (serialized && serialized.includes('@')) {
            return `+${serialized.split('@')[0].replace(/\D/g, '')}`;
        }
        return null;
    }

    async detectLoggedInPageState() {
        if (!this._client?.pupPage || this._client.pupPage.isClosed()) return { loggedIn: false };
        try {
            return await this._client.pupPage.evaluate(() => ({
                loggedIn: !!window.Store && !!document.querySelector('#pane-side'),
                title: document.title || '',
            }));
        } catch (_) { return { loggedIn: false }; }
    }

    async ensureReadyFromPageProbe() {
        if (this.getReady()) return true;
        const probe = await this.detectLoggedInPageState();
        if (!probe.loggedIn) return false;
        this._qr = null; this._lastError = null; this._qrRefreshCount = 0; this._lastQrAt = null;
        this.clearReconnectTimer();
        const phone = this.extractSelfPhone();
        if (phone) {
            this._accountPhone = phone;
            this._accountPushname = this._client?.info?.pushname || this._accountPushname || null;
            this._detectedOwner = resolveOperatorByPhone(this._accountPhone, this._detectedOwner || null);
            this._detectedOwnerProfile = getOperatorProfileByPhone(this._accountPhone) || this._detectedOwnerProfile || null;
        }
        console.log(`[WA Service:${this.sessionId}] page-probe restored ready`);
        this.emit('ready');
        return true;
    }

    scheduleReconnect(reason = 'unknown') {
        this.clearReconnectTimer();
        console.log(`[WA Service:${this.sessionId}] ${reason}，${RECONNECT_DELAY_MS/1000}s 后重试...`);
        this._reconnectTimer = setTimeout(() => {
            this._reconnectTimer = null;
            this._initDriver();
        }, RECONNECT_DELAY_MS);
    }

    handleClientFailure(error, reason = '初始化失败') {
        const message = error?.message || String(error || reason);
        this._qr = null; this._lastError = message;
        this._accountPhone = null; this._accountPushname = null;
        this._detectedOwner = null; this._detectedOwnerProfile = null;
        this._qrRefreshCount = 0; this._lastQrAt = null;
        this.emit('failed', new Error(message));
        console.error(`[WA Service:${this.sessionId}] ${reason}: ${message}`);
        this.scheduleReconnect(reason);
    }

    async _initDriver() {
        if (this._driver) return;

        const cfg = {
            sessionId: this.sessionId,
            owner: this.owner,
            driver: this.driver,
            authRootDir: this.authRootDir,
            driverMeta: this.driverMeta,
        };
        console.log(`[WA Service:${this.sessionId}] init driver=${this.driver} authRoot=${this.authRootDir}`);

        this._driver = await createDriver(cfg);

        // Forward driver events to this facade's emitter
        this._driver.on('ready', () => {
            this._qr = null; this._lastError = null; this._qrRefreshCount = 0; this._lastQrAt = null;
            const status = this._driver.getStatus();
            this._accountPhone = status.accountPhone;
            const phone = this._accountPhone || this.extractSelfPhone();
            if (phone) {
                this._accountPushname = this._client?.info?.pushname || null;
                this._detectedOwner = resolveOperatorByPhone(phone, null);
                this._detectedOwnerProfile = getOperatorProfileByPhone(phone);
            }
            this.clearReconnectTimer();
            console.log(`[WA Service:${this.sessionId}] ready (phone=${maskPhone(this._accountPhone)})`);
            this.emit('ready');
        });

        this._driver.on('qr', (q) => {
            this._qr = q; this._qrRefreshCount += 1; this._lastQrAt = new Date().toISOString();
            console.log(`[WA Service:${this.sessionId}] QR#${this._qrRefreshCount}`);
            if (PRINT_QR_IN_TERMINAL) {
                if (qrterminal) qrterminal.generate(q, { small: true });
                else console.log('QR:', q);
                console.log('WhatsApp → ⋮ → 已关联的设备 → 关联新设备');
            }
            this.emit('qr', q);
        });

        this._driver.on('failed', (err) => this.handleClientFailure(err, 'driver failed'));

        // Forward inbound message events so waWorker / subscribers can listen at
        // the facade layer instead of reaching into the driver.
        // Shape: baileys → IncomingMessage, wwebjs → raw wwebjs Message (until C2.2 unifies).
        this._driver.on('message', (msg) => this.emit('message', msg));
        this._driver.on('group_message', (msg) => this.emit('group_message', msg));
        this._driver.on('disconnect', (info) => this.emit('disconnect', info));
        // Baileys history sync 事件透传（wwebjs driver 不发这些事件）。
        // history_set: { messages, syncType, progress, isLatest }
        // history_latest_seen: 无 payload，表示本轮全量同步完成（可开始 gap-fill）
        this._driver.on('history_set', (payload) => this.emit('history_set', payload));
        this._driver.on('history_latest_seen', () => this.emit('history_latest_seen'));

        await this._driver.start();

        // Backward compat: waWorker / some routes still read getClient() to attach
        // real-time listeners on the wwebjs Client. For baileys this stays null
        // and those consumers must subscribe to the facade's own events instead.
        this._client = (this.driver === 'wwebjs' && typeof this._driver.getClient === 'function')
            ? this._driver.getClient()
            : null;
    }

    start() {
        if (this._initialized) return;
        this._initialized = true;
        this._initDriver().catch((err) => this.handleClientFailure(err, 'driver init'));
    }

    async sendMessage(phone, text) {
        if (this._driver) return this._driver.sendMessage(phone, text);
        if ((!this._client || !this.getReady()) && !(await this.ensureReadyFromPageProbe())) {
            return { ok: false, error: 'WhatsApp 未就绪，请先扫码认证' };
        }
        try {
            const cleanPhone = phone.replace(/[^\d+]/g, '');
            const chatId = cleanPhone.startsWith('+') ? cleanPhone.substring(1) + '@c.us' : cleanPhone + '@c.us';
            const { Client, MessageMedia } = require('whatsapp-web.js');
            const messageId = await this._client.sendMessage(chatId, text);
            if (VERBOSE_LOGS) console.log(`[WA Service:${this.sessionId}] 发送 → ${maskPhone(phone)}`);
            return { ok: true, messageId };
        } catch (err) {
            return { ok: false, error: err.message };
        }
    }

    async sendMedia(phone, media = {}) {
        if (this._driver) return this._driver.sendMedia(phone, media);
        const { media_path, media_url, mime_type, file_name, data_base64, caption } = media;
        if ((!this._client || !this.getReady()) && !(await this.ensureReadyFromPageProbe())) {
            return { ok: false, error: 'WhatsApp 未就绪，请先扫码认证' };
        }
        try {
            const { Client, MessageMedia } = require('whatsapp-web.js');
            const cleanPhone = String(phone || '').replace(/[^\d+]/g, '');
            const chatId = cleanPhone.startsWith('+') ? cleanPhone.substring(1) + '@c.us' : cleanPhone + '@c.us';
            let prepared;
            if (data_base64 && mime_type) prepared = new MessageMedia(mime_type, String(data_base64), file_name || 'image');
            else if (media_path) prepared = MessageMedia.fromFilePath(String(media_path));
            else if (media_url) prepared = await MessageMedia.fromUrl(String(media_url), { unsafeMime: true, filename: file_name });
            else throw new Error('media payload missing');
            const opts = caption && String(caption).trim() ? { caption: String(caption).trim() } : {};
            const sent = await this._client.sendMessage(chatId, prepared, opts);
            const rawId = sent?.id?._serialized || sent?.id?.id || sent?.id || '';
            return { ok: true, messageId: rawId };
        } catch (err) {
            const msg = String(err?.message || '').trim();
            return { ok: false, error: msg.length <= 1 ? 'WhatsApp rejected media send' : msg };
        }
    }

    waitForReady(timeoutMs = 120000) {
        if (this._driver) return this._driver.waitForReady(timeoutMs);
        return new Promise((resolve, reject) => {
            let probeTimer = null;
            if (this.getReady()) { resolve(); return; }
            if (this._lastError && !this._client) { reject(new Error(this._lastError)); return; }
            const tid = setTimeout(() => {
                clearInterval(probeTimer); this.off('ready', onReady); this.off('failed', onFailed);
                reject(new Error('等待 WhatsApp 就绪超时'));
            }, timeoutMs);
            const onReady = () => { clearTimeout(tid); clearInterval(probeTimer); this.off('failed', onFailed); resolve(); };
            const onFailed = (err) => { clearTimeout(tid); clearInterval(probeTimer); this.off('ready', onReady); reject(err instanceof Error ? err : new Error(String(err))); };
            this.once('ready', onReady);
            this.once('failed', onFailed);
            probeTimer = setInterval(() => this.ensureReadyFromPageProbe().catch(() => {}), READY_PROBE_INTERVAL_MS);
            this.ensureReadyFromPageProbe().catch(() => {});
        });
    }

    stop() {
        this.clearReconnectTimer();
        if (this._driver) { this._driver.stop(); this._driver = null; }
        if (this._client) { this._client.removeAllListeners('disconnected'); this._client.removeAllListeners('auth_failure'); this._client.destroy().catch(() => {}); this._client = null; }
        this._qr = null; this._qrRefreshCount = 0; this._lastQrAt = null; this._initialized = false;
    }
}

// ================== Service Registry ==================

const services = new Map();
let authRootBase = '';

function initAuthRootBase() {
    const configured = String(process.env.WA_AUTH_ROOT || process.env.WWEBJS_AUTH_ROOT || '').trim();
    authRootBase = configured ? path.resolve(configured) : path.join(__dirname, '../../.wwebjs_auth');
}

function getService(sessionId) { return services.get(sessionId); }

function getServiceByOwner(owner) {
    const normalizedOwner = normalizeOperatorName(owner, owner);
    for (const service of services.values()) {
        if (normalizeOperatorName(service.owner, service.owner) === normalizedOwner) return service;
        if (normalizeOperatorName(service.getResolvedOwner(), service.getResolvedOwner()) === normalizedOwner) return service;
    }
    return null;
}

function getAllServices() { return Array.from(services.values()); }

function createServices() {
    initAuthRootBase();
    const configs = parseSessionConfig();
    console.log(`[WA Service] 配置了 ${configs.length} 个 WhatsApp Session`);
    for (const config of configs) {
        const driver = resolveDriverName(config.driver) || defaultDriverName();
        const service = new WhatsAppService({
            port: config.port,
            sessionId: config.sessionId,
            owner: config.owner,
            driver,
            authRootDir: resolveAuthRootForDriver(driver),
        });
        services.set(config.sessionId, service);
        console.log(`[WA Service] 注册 session: ${config.sessionId} (owner=${config.owner}, driver=${driver})`);
    }
    return services;
}

function startAllServices() {
    if (services.size === 0) createServices();
    for (const service of services.values()) service.start();
}

function stopAllServices() {
    for (const service of services.values()) service.stop();
}

function createWorkerPoller(service) {
    const POLL_INTERVAL_MS = parseInt(process.env.WA_POLL_INTERVAL_MS || '60000', 10);
    let pollTimer = null;
    let stopping = false;
    async function pollMessages() {
        if (stopping || !service.getReady()) return;
        // 轮询主逻辑在 waWorker.js 里，这里只负责 keep-alive tick。
    }
    function startPolling() {
        if (pollTimer) return;
        pollTimer = setInterval(() => {
            pollMessages().catch((err) => console.error(`[WA Worker:${service.sessionId}] 轮询异常:`, err.message));
        }, POLL_INTERVAL_MS);
    }
    function stopPolling() {
        stopping = true;
        if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    }
    return { startPolling, stopPolling };
}

function requireSingleService() {
    if (services.size === 0) throw new Error('[WA Service] no service registered in this process');
    if (services.size > 1) throw new Error(`[WA Service] ${services.size} services registered; legacy single-service API is forbidden in multi-session context`);
    for (const svc of services.values()) return svc;
    return null;
}

module.exports = {
    WhatsAppService,
    createServices,
    getService,
    getServiceByOwner,
    getAllServices,
    startAllServices,
    stopAllServices,
    requireSingleService,
    createWorkerPoller,
    // Single-session shortcuts
    sendMessage: (...args) => requireSingleService().sendMessage(...args),
    sendMedia: (...args) => requireSingleService().sendMedia(...args),
    getStatus: () => requireSingleService().getStatus(),
    getQrValue: () => requireSingleService().getQrValue(),
    getResolvedOwner: () => requireSingleService().getResolvedOwner(),
    getClient: (sessionId) => {
        if (sessionId) {
            const svc = services.get(String(sessionId));
            if (!svc) throw new Error(`[WA Service] unknown session: ${sessionId}`);
            return svc.getClient();
        }
        return requireSingleService().getClient();
    },
    getReady: () => requireSingleService().getReady(),
    getDriverName: (sessionId) => {
        if (sessionId) {
            const svc = services.get(String(sessionId));
            if (!svc) throw new Error(`[WA Service] unknown session: ${sessionId}`);
            return svc.driver;
        }
        return requireSingleService().driver;
    },
    onDriverEvent: (event, handler) => requireSingleService().on(event, handler),
    offDriverEvent: (event, handler) => requireSingleService().off(event, handler),
    // 直接暴露 driver 实例：waWorker 的 gap-fill 逻辑需要调 driver.fetchMessageHistory /
    // driver.normalizeRawMessage 这些 driver 特有方法（facade 不包装）。
    // 只暴露单 session 路径；多 session 按 sessionId 查找。
    getDriver: (sessionId) => {
        if (sessionId) {
            const svc = services.get(String(sessionId));
            if (!svc) throw new Error(`[WA Service] unknown session: ${sessionId}`);
            return svc._driver;
        }
        return requireSingleService()._driver;
    },
    waitForReady: (timeoutMs, sessionId) => {
        if (sessionId) {
            const svc = services.get(String(sessionId));
            if (!svc) throw new Error(`[WA Service] unknown session: ${sessionId}`);
            return svc.waitForReady(timeoutMs);
        }
        return requireSingleService().waitForReady(timeoutMs);
    },
    stop: stopAllServices,
    start: startAllServices,
};