/**
 * @fileoverview wwebjs driver — chromium-backed implementation.
 *
 * Migrated from WhatsAppService in waService.js (commit 2 of 8).
 * Implements WaDriver interface. Uses whatsapp-web.js Client under the hood.
 */
'use strict';
const { Client, LocalAuth } = require('whatsapp-web.js');
const { EventEmitter } = require('events');
const path = require('path');
const fs = require('fs');

const { normalizeOperatorName, resolveOperatorByPhone, getOperatorProfileByPhone } = require('../../../utils/operator');
const { isGroupJid } = require('./jidUtils');

let qrterminal;
try { qrterminal = require('qrcode-terminal'); } catch (e) { qrterminal = null; }

const VERBOSE_LOGS = process.env.LOG_VERBOSE === 'true';
const PRINT_QR_IN_TERMINAL = process.env.WA_PRINT_QR !== 'false';
const RECONNECT_DELAY_MS = 5000;
const READY_PROBE_INTERVAL_MS = 2000;

// ---- utils (migrated from waService.js) ----

function sanitizeSessionId(value, fallback = '3000') {
    const raw = String(value || fallback).trim();
    return raw.replace(/[^a-zA-Z0-9._-]/g, '_') || fallback;
}

function maskPhone(phone) {
    const digits = String(phone || '').replace(/\D/g, '');
    return digits.length <= 4 ? '***' : `***${digits.slice(-4)}`;
}

// ---- WwebjsDriver ----

/**
 * @implements WaDriver
 */
class WwebjsDriver extends EventEmitter {
    /**
     * @param {import('./types').SessionConfig} cfg
     */
    constructor(cfg) {
        super();
        /** @type {import('./types').SessionConfig} */
        this.cfg = cfg;
        this.sessionId = sanitizeSessionId(cfg.sessionId, cfg.sessionId || 'default');
        /** @type {Client|null} */
        this._client = null;
        this._ready = false;
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

    // ---- public WaDriver interface ----

    /** @returns {import('./types').DriverStatus} */
    getStatus() {
        return {
            ready: this._ready,
            hasQr: !!this._qr,
            accountPhone: this._accountPhone,
            driverName: 'wwebjs',
            error: this._lastError,
            owner: this._detectedOwner || this.cfg.owner,
        };
    }

    getQR() { return this._qr; }

    /**
     * @param {number} [timeoutMs=120000]
     * @returns {Promise<void>}
     */
    waitForReady(timeoutMs = 120000) {
        return new Promise((resolve, reject) => {
            let probeTimer = null;
            if (this._ready) { resolve(); return; }
            if (this._lastError && !this._client) {
                reject(new Error(this._lastError)); return;
            }
            const tid = setTimeout(() => {
                clearInterval(probeTimer);
                this.off('ready', onReady);
                this.off('failed', onFailed);
                reject(new Error('等待 WhatsApp 就绪超时'));
            }, timeoutMs);
            const onReady = () => {
                clearTimeout(tid); clearInterval(probeTimer); this.off('failed', onFailed); resolve();
            };
            const onFailed = (err) => {
                clearTimeout(tid); clearInterval(probeTimer); this.off('ready', onReady);
                reject(err instanceof Error ? err : new Error(String(err)));
            };
            this.once('ready', onReady);
            this.once('failed', onFailed);
            probeTimer = setInterval(() => {
                this._probePageState().catch(() => {});
            }, READY_PROBE_INTERVAL_MS);
            this._probePageState().catch(() => {});
        });
    }

    start() {
        if (this._initialized) return;
        this._initialized = true;
        this._initClient();
    }

    /** @returns {Client|null} backward-compat for waWorker that attaches message listeners */
    getClient() { return this._client; }

    async stop() {
        this._clearReconnectTimer();
        if (this._client) {
            this._client.removeAllListeners('disconnected');
            this._client.removeAllListeners('auth_failure');
            this._client.destroy().catch(() => {});
            this._client = null;
        }
        this._ready = false;
        this._qr = null;
        this._qrRefreshCount = 0;
        this._lastQrAt = null;
        this._initialized = false;
    }

    /**
     * @param {string} phoneE164
     * @param {string} text
     * @returns {Promise<import('./types').SendResult>}
     */
    async sendMessage(phoneE164, text) {
        if ((!this._client || !this._ready) && !(await this._ensureReadyFromPageProbe())) {
            return { ok: false, error: 'WhatsApp 未就绪，请先扫码认证' };
        }
        try {
            const digits = phoneE164.replace(/[^\d]/g, '');
            const chatId = digits + '@c.us';
            const sent = await this._client.sendMessage(chatId, text);
            const rawId = sent?.id?._serialized || sent?.id?.id || sent?.id || '';
            const ts = typeof sent?.timestamp === 'number' ? sent.timestamp * 1000 : Date.now();
            if (VERBOSE_LOGS) {
                console.log(`[WwebjsDriver:${this.sessionId}] 发送成功 → ${maskPhone(phoneE164)}`);
            }
            return { ok: true, id: rawId, timestamp: ts, chatId: phoneE164 };
        } catch (err) {
            console.error(`[WwebjsDriver:${this.sessionId}] 发送失败 → ${maskPhone(phoneE164)}:`, err.message);
            return { ok: false, error: err.message };
        }
    }

    /**
     * @param {string} phoneE164
     * @param {import('./types').MediaPayload} media
     * @returns {Promise<import('./types').SendResult>}
     */
    async sendMedia(phoneE164, media) {
        const { media_path, media_url, mime_type, file_name, data_base64, caption } = media;
        if ((!this._client || !this._ready) && !(await this._ensureReadyFromPageProbe())) {
            return { ok: false, error: 'WhatsApp 未就绪，请先扫码认证' };
        }
        try {
            const prepared = await this._resolveMediaPayload({ media_path, media_url, data_base64, mime_type, file_name });
            const opts = {};
            if (caption && String(caption).trim()) opts.caption = String(caption).trim();
            const sent = await this._client.sendMessage(phoneE164.replace(/[^\d]/g, '') + '@c.us', prepared, opts);
            const rawId = sent?.id?._serialized || sent?.id?.id || sent?.id || '';
            const ts = typeof sent?.timestamp === 'number' ? sent.timestamp * 1000 : Date.now();
            return { ok: true, id: rawId, timestamp: ts, chatId: phoneE164 };
        } catch (err) {
            const msg = String(err?.message || '').trim();
            return { ok: false, error: msg.length <= 1 ? 'WhatsApp rejected media send' : msg };
        }
    }

    async fetchRecentMessages(phoneE164, limit = 50) {
        // Stub — implemented by waWorker polling, not driver
        return [];
    }

    async fetchGroups() {
        // Stub — implemented by waWorker polling, not driver
        return [];
    }

    async fetchGroupMessages(chatId, limit = 50) {
        return [];
    }

    // ---- private ----

    _extractSelfPhone() {
        const widUser = this._client?.info?.wid?.user;
        if (widUser) return `+${String(widUser).replace(/\D/g, '')}`;
        const serialized = this._client?.info?.wid?._serialized;
        if (serialized && serialized.includes('@')) {
            return `+${serialized.split('@')[0].replace(/\D/g, '')}`;
        }
        return null;
    }

    async _probePageState() {
        if (!this._client?.pupPage || this._client.pupPage.isClosed()) return { loggedIn: false };
        try {
            return await this._client.pupPage.evaluate(() => ({
                loggedIn: !!window.Store && !!document.querySelector('#pane-side'),
                title: document.title || '',
            }));
        } catch (_) { return { loggedIn: false }; }
    }

    async _ensureReadyFromPageProbe() {
        if (this._ready) return true;
        const probe = await this._probePageState();
        if (!probe.loggedIn) return false;
        this._ready = true;
        this._qr = null;
        this._lastError = null;
        this._qrRefreshCount = 0;
        this._lastQrAt = null;
        this._clearReconnectTimer();
        const phone = this._extractSelfPhone();
        if (phone) {
            this._accountPhone = phone;
            this._accountPushname = this._client?.info?.pushname || this._accountPushname || null;
            this._detectedOwner = resolveOperatorByPhone(this._accountPhone, this._detectedOwner || null);
            this._detectedOwnerProfile = getOperatorProfileByPhone(this._accountPhone) || this._detectedOwnerProfile || null;
        }
        console.log(`[WwebjsDriver:${this.sessionId}] page-probe restored ready state`);
        this.emit('ready');
        return true;
    }

    _scheduleReconnect(reason = 'unknown') {
        this._clearReconnectTimer();
        console.log(`[WwebjsDriver:${this.sessionId}] ${reason}，${RECONNECT_DELAY_MS/1000}s 后重试...`);
        this._reconnectTimer = setTimeout(() => {
            this._reconnectTimer = null;
            this._initClient();
        }, RECONNECT_DELAY_MS);
    }

    _handleFailure(error, reason = '初始化失败') {
        const msg = error?.message || String(error || reason);
        this._ready = false;
        this._qr = null;
        this._lastError = msg;
        this._accountPhone = null;
        this._accountPushname = null;
        this._detectedOwner = null;
        this._detectedOwnerProfile = null;
        this._qrRefreshCount = 0;
        this._lastQrAt = null;
        this.emit('failed', new Error(msg));
        console.error(`[WwebjsDriver:${this.sessionId}] ${reason}: ${msg}`);
        if (this._client) {
            try { this._client.removeAllListeners(); this._client.destroy().catch(() => {}); } catch (_) {}
            this._client = null;
        }
        this._scheduleReconnect(reason);
    }

    _clearReconnectTimer() {
        if (this._reconnectTimer) { clearTimeout(this._reconnectTimer); this._reconnectTimer = null; }
    }

    _resolveChromeExecutablePath() {
        const explicit = String(process.env.WA_CHROME_EXECUTABLE_PATH || process.env.PUPPETEER_EXECUTABLE_PATH || '').trim();
        if (explicit) return explicit;
        const candidates = process.platform === 'darwin'
            ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium']
            : ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable'];
        return candidates.find(c => fs.existsSync(c)) || undefined;
    }

    _initClient() {
        if (this._client) return this._client;

        const sessionDir = path.join(this.cfg.authRootDir, `session-${this.sessionId}`);
        if (!fs.existsSync(sessionDir)) fs.mkdirSync(sessionDir, { recursive: true });

        const chromePath = this._resolveChromeExecutablePath();
        console.log(`[WwebjsDriver:${this.sessionId}] init WA client (auth_root=${sessionDir}, browser=${chromePath || 'auto'})`);
        this._lastError = null;

        const puppeteerArgs = [
            '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
            '--disable-gpu', '--disable-web-security',
            ...String(process.env.WA_PUPPETEER_ARGS || '').split(/\s+/).filter(Boolean),
        ];
        const puppeteerConfig = {
            headless: process.env.WA_HEADLESS !== 'false',
            args: [...new Set(puppeteerArgs)],
            timeout: parseInt(process.env.WA_PUPPETEER_LAUNCH_TIMEOUT_MS || '90000', 10),
        };
        if (chromePath) puppeteerConfig.executablePath = chromePath;

        this._client = new Client({
            authStrategy: new LocalAuth({ dir: sessionDir, dataPath: sessionDir }),
            puppeteer: puppeteerConfig,
        });

        this._client.on('qr', (q) => {
            this._qr = q;
            this._qrRefreshCount += 1;
            this._lastQrAt = new Date().toISOString();
            console.log(`[WwebjsDriver:${this.sessionId}] QR#${this._qrRefreshCount}`);
            if (PRINT_QR_IN_TERMINAL) {
                if (qrterminal) qrterminal.generate(q, { small: true });
                else console.log('QR:', q);
                console.log('WhatsApp → ⋮ → 已关联的设备 → 关联新设备 扫码上方二维码');
            }
            this.emit('qr', q);
        });

        this._client.on('ready', () => {
            this._ready = true; this._qr = null; this._lastError = null;
            this._qrRefreshCount = 0; this._lastQrAt = null;
            this._accountPhone = this._extractSelfPhone();
            this._accountPushname = this._client?.info?.pushname || null;
            this._detectedOwner = resolveOperatorByPhone(this._accountPhone, null);
            this._detectedOwnerProfile = getOperatorProfileByPhone(this._accountPhone);
            this._clearReconnectTimer();
            console.log(`[WwebjsDriver:${this.sessionId}] ready (phone=${maskPhone(this._accountPhone)}, owner=${this._detectedOwner || this.cfg.owner})`);
            this.emit('ready');
        });

        this._client.on('auth_failure', (msg) => this._handleFailure(new Error(msg), '认证失败'));
        this._client.on('disconnected', (r) => this._handleFailure(new Error(String(r)), '已断开'));
        this._client.on('change_state', (s) => {
            if (VERBOSE_LOGS) console.log(`[WwebjsDriver:${this.sessionId}] state=${s}`);
        });

        this._client.initialize().catch((err) => this._handleFailure(err, '初始化失败'));
        return this._client;
    }

    async _resolveMediaPayload({ media_path, media_url, data_base64, mime_type, file_name }) {
        const { MessageMedia } = require('whatsapp-web.js');
        if (data_base64 && mime_type) return new MessageMedia(mime_type, String(data_base64), file_name || 'image');
        if (media_path) return MessageMedia.fromFilePath(String(media_path));
        if (media_url) return MessageMedia.fromUrl(String(media_url), { unsafeMime: true, filename: file_name || undefined });
        throw new Error('media payload missing: provide media_path, media_url, or data_base64');
    }
}

module.exports = WwebjsDriver;