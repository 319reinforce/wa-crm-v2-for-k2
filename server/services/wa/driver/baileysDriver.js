/**
 * @fileoverview Baileys WebSocket driver for whatsapp-mgr.
 *
 * Implements WaDriver interface using @whiskeysockets/baileys.
 * Key decisions:
 * - Auth: useMultiFileAuthState → separate .baileys_auth/ folder (no conflict with wwebjs)
 * - Reconnect: maps DisconnectReason; auto-reconnect on non-fatal errors
 * - Media: downloadMediaMessage + re-upload via Baileys sendMessage
 * - Incoming messages: messages.upsert via sock.ev, buffered in _msgBuffer
 * - fetchRecentMessages: ring buffer per JID (Baileys has no chat.fetchMessages)
 */
'use strict';
const { EventEmitter } = require('events');
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');
const { URL } = require('url');

const { normalizeJid, isGroupJid, jidToPhoneE164 } = require('./jidUtils');

const RECONNECT_DELAY_MS = 5000;
const BUFFER_SIZE = 200; // per-jid ring buffer for fetchRecentMessages

/**
 * @param {string} url
 * @returns {Promise<Buffer>}
 */
function downloadToBuffer(url) {
    return new Promise((resolve, reject) => {
        const parsedUrl = new URL(url);
        const transport = parsedUrl.protocol === 'https:' ? https : http;
        const req = transport.get(url, { headers: { 'User-Agent': 'K2Lab-Bot/1.0' } }, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                downloadToBuffer(res.headers.location).then(resolve).catch(reject);
                return;
            }
            if (res.statusCode !== 200) {
                reject(new Error(`HTTP ${res.statusCode}`)); return;
            }
            const chunks = [];
            res.on('data', c => chunks.push(c));
            res.on('end', () => resolve(Buffer.concat(chunks)));
        });
        req.on('error', reject);
        req.setTimeout(30000, () => { req.destroy(); reject(new Error('download timeout')); });
    });
}

/**
 * @param {string} mimeType
 * @returns {'image'|'audio'|'video'|'document'|'sticker'}
 */
function categorizeMime(mimeType) {
    if (!mimeType) return 'document';
    if (mimeType === 'image/webp') return 'sticker';
    if (mimeType.startsWith('image/')) return 'image';
    if (mimeType.startsWith('audio/')) return 'audio';
    if (mimeType.startsWith('video/')) return 'video';
    return 'document';
}

// ---- DisconnectReason codes from baileys ----
const LOGGED_OUT_CODES = new Set([
    401, // Logged out
    428, // connectionReplaced
]);

const FATAL_CODES = new Set([
    515, // restartRequired
    515, // serverRestart
    500, // unknown
]);

/**
 * @implements WaDriver
 */
class BaileysDriver extends EventEmitter {
    /**
     * @param {import('./types').SessionConfig} cfg
     */
    constructor(cfg) {
        super();
        this.cfg = cfg;
        this.sessionId = String(cfg.sessionId || 'default').replace(/[^a-zA-Z0-9._-]/g, '_');
        /** @type {any} Baileys WASocket instance */
        this._sock = null;
        this._ready = false;
        this._qr = null;
        this._lastError = null;
        this._accountPhone = null;
        this._authDir = path.join(cfg.authRootDir, `session-${this.sessionId}`);

        // Per-jid message ring buffer for fetchRecentMessages()
        /** @type {Map<string, import('./types').IncomingMessage[]>} */
        this._msgBuffer = new Map();

        // Proxyquire target for tests
        this._baileysModule = null;
    }

    // ---- WaDriver public interface ----

    getStatus() {
        return {
            ready: this._ready,
            hasQr: !!this._qr,
            accountPhone: this._accountPhone,
            driverName: 'baileys',
            error: this._lastError,
            owner: this.cfg.owner,
        };
    }

    getQR() { return this._qr; }

    /**
     * @param {number} [timeoutMs=120000]
     * @returns {Promise<void>}
     */
    waitForReady(timeoutMs = 120000) {
        return new Promise((resolve, reject) => {
            if (this._ready) { resolve(); return; }
            if (this._lastError) { reject(new Error(this._lastError)); return; }
            const tid = setTimeout(() => {
                this.off('ready', onReady); this.off('failed', onFailed);
                reject(new Error('等待 WhatsApp 就绪超时'));
            }, timeoutMs);
            const onReady = () => { clearTimeout(tid); this.off('failed', onFailed); resolve(); };
            const onFailed = (err) => { clearTimeout(tid); this.off('ready', onReady); reject(err instanceof Error ? err : new Error(String(err))); };
            this.once('ready', onReady);
            this.once('failed', onFailed);
        });
    }

    async start() {
        if (this._sock) return;

        if (!fs.existsSync(this._authDir)) fs.mkdirSync(this._authDir, { recursive: true });

        const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
        this._baileysModule = { makeWASocket, useMultiFileAuthState, DisconnectReason };

        const { state, saveCreds } = await useMultiFileAuthState(this._authDir);

        // Baileys 要求 logger 实现 pino 接口（含 child()），裸 { level: 'silent' }
        // 会让 makeWASocket 在内部调用 logger.child(...) 时抛 TypeError。
        // 用真的 pino，保留 silent 以避免噪声。
        const pino = require('pino');
        const baileysLogger = pino({ level: 'silent' });

        this._sock = makeWASocket({
            auth: state,
            printQRInTerminal: false,
            logger: baileysLogger,
            browser: ['K2Lab-Bot', 'Chrome', '1.0'],
            syncFullHistory: false,
            markOnlineOnConnect: false,
            // Larger timeout for slow connections
            connectTimeoutMs: 60_000,
            keepAliveIntervalMs: 30_000,
        });

        this._sock.ev.on('creds.update', saveCreds);

        this._sock.ev.on('connection.update', (u) => {
            const { qr, connection, lastDisconnect } = u;

            if (qr) {
                this._qr = qr;
                this._ready = false;
                this.emit('qr', qr);
                return;
            }

            if (connection === 'open') {
                this._ready = true;
                this._qr = null;
                this._lastError = null;
                const rawId = this._sock.user?.id || '';
                // Baileys user.id format: "85255550001@s.whatsapp.net"
                this._accountPhone = rawId ? jidToPhoneE164(rawId) : null;
                this.emit('ready');
                return;
            }

            if (connection === 'close') {
                const reasonCode = lastDisconnect?.error?.output?.statusCode;
                const shouldReconnect = !LOGGED_OUT_CODES.has(reasonCode);
                this._ready = false;
                const info = { reason: reasonCode, autoReconnect: shouldReconnect };
                this.emit('disconnect', info);
                if (shouldReconnect) {
                    console.log(`[BaileysDriver:${this.sessionId}] reconnecting in ${RECONNECT_DELAY_MS}ms (reason=${reasonCode})`);
                    setTimeout(() => this._reconnect(), RECONNECT_DELAY_MS);
                } else {
                    this._lastError = `logged out (code=${reasonCode}), please rescan QR`;
                    this.emit('failed', new Error(this._lastError));
                }
                return;
            }
        });

        this._sock.ev.on('messages.upsert', async ({ messages, type }) => {
            if (!['notify', 'append'].includes(type)) return;
            for (const msg of messages) {
                try {
                    const normalized = await this._normalizeMessage(msg);
                    if (!normalized) continue;
                    this._bufferMessage(normalized);
                    if (normalized.isGroup) this.emit('group_message', normalized);
                    else this.emit('message', normalized);
                } catch (err) {
                    console.error(`[BaileysDriver:${this.sessionId}] normalize error:`, err.message);
                }
            }
        });

        this._sock.ev.on('groups.upsert', (groups) => {
            // Groups upsert — we emit a synthetic group_message for each group's metadata update
            // (actual messages still come via messages.upsert)
            for (const group of groups) {
                console.log(`[BaileysDriver:${this.sessionId}] new group: ${group.id}`);
            }
        });

        // Store reference for tests
        this._DisconnectReason = DisconnectReason;
    }

    async stop() {
        if (this._sock) {
            try { this._sock.end(); } catch (_) {}
            this._sock = null;
        }
        this._ready = false;
        this._qr = null;
    }

    /**
     * @param {string} phoneE164  e.g. "+85255550001"
     * @param {string} text
     * @returns {Promise<import('./types').SendResult>}
     */
    async sendMessage(phoneE164, text) {
        if (!this._sock || !this._ready) {
            return { ok: false, error: 'WhatsApp 未就绪，请先扫码认证' };
        }
        try {
            const jid = normalizeJid(phoneE164, 'baileys');
            const sent = await this._sock.sendMessage(jid, { text });
            return {
                ok: true,
                id: String(sent?.key?.id || ''),
                timestamp: typeof sent?.messageTimestamp === 'number' ? sent.messageTimestamp * 1000 : Date.now(),
                chatId: phoneE164,
            };
        } catch (err) {
            return { ok: false, error: err?.message || String(err) };
        }
    }

    /**
     * @param {string} phoneE164
     * @param {import('./types').MediaPayload} media
     * @returns {Promise<import('./types').SendResult>}
     */
    async sendMedia(phoneE164, media) {
        const { media_path, media_url, data_base64, mime_type, file_name, caption } = media;
        if (!this._sock || !this._ready) {
            return { ok: false, error: 'WhatsApp 未就绪，请先扫码认证' };
        }
        const jid = normalizeJid(phoneE164, 'baileys');
        const category = categorizeMime(mime_type);
        let content, tmpPath;
        try {
            if (media_path) {
                content = { [category]: { url: media_path }, caption, fileName: file_name };
            } else if (media_url) {
                tmpPath = path.join('/tmp', `${Date.now()}-${Math.random().toString(36).slice(2)}`);
                const buf = await downloadToBuffer(media_url);
                fs.writeFileSync(tmpPath, buf);
                content = { [category]: { url: tmpPath }, caption, fileName: file_name };
            } else if (data_base64) {
                content = {
                    [category]: Buffer.from(data_base64, 'base64'),
                    mimetype: mime_type || 'application/octet-stream',
                    caption,
                    fileName: file_name,
                };
            } else {
                return { ok: false, error: 'media payload missing: provide media_path, media_url, or data_base64' };
            }
            const sent = await this._sock.sendMessage(jid, content);
            return {
                ok: true,
                id: String(sent?.key?.id || ''),
                timestamp: typeof sent?.messageTimestamp === 'number' ? sent.messageTimestamp * 1000 : Date.now(),
                chatId: phoneE164,
            };
        } catch (err) {
            return { ok: false, error: err?.message || String(err) };
        } finally {
            if (tmpPath) fs.unlink(tmpPath, () => {});
        }
    }

    /**
     * @param {string} phoneE164
     * @param {number} [limit=50]
     * @returns {Promise<import('./types').IncomingMessage[]>}
     */
    async fetchRecentMessages(phoneE164, limit = 50) {
        const jid = normalizeJid(phoneE164, 'baileys');
        const buf = this._msgBuffer.get(jid) || [];
        return buf.slice(-limit);
    }

    async fetchGroups() {
        if (!this._sock || !this._ready) return [];
        try {
            const groups = await this._sock.groupFetchAllParticipating();
            return Object.entries(groups).map(([id, meta]) => ({
                id,
                name: meta.subject || meta.subjectOwner || '',
                size: meta.participants?.length || 0,
                subjectOwner: meta.subjectOwner || null,
            }));
        } catch (err) {
            console.error(`[BaileysDriver:${this.sessionId}] fetchGroups:`, err.message);
            return [];
        }
    }

    async fetchGroupMessages(chatId, limit = 50) {
        const buf = this._msgBuffer.get(chatId) || [];
        return buf.slice(-limit);
    }

    // ---- private ----

    async _reconnect() {
        if (this._sock) {
            try { this._sock.end(); } catch (_) {}
            this._sock = null;
        }
        this._ready = false;
        await this.start();
    }

    /**
     * Normalize a Baileys proto message to IncomingMessage shape.
     * @param {any} msg  Baileys proto message
     * @returns {Promise<import('./types').IncomingMessage|null>}
     */
    async _normalizeMessage(msg) {
        const key = msg?.key;
        if (!key?.remoteJid || !key?.id) return null;

        const rawText = this._extractText(msg);
        const fromMe = !!key.fromMe;
        const isGroup = isGroupJid(key.remoteJid);
        const chatId = jidToPhoneE164(key.remoteJid);
        const from = jidToPhoneE164(fromMe ? key.remoteJid : (key.participant || key.remoteJid));

        /** @type {import('./types').IncomingMessage} */
        const normalized = {
            id: String(key.id || ''),
            chatId,
            from,
            fromMe,
            isGroup,
            timestamp: typeof msg?.messageTimestamp === 'number' ? msg.messageTimestamp * 1000 : Date.now(),
            role: fromMe ? 'me' : 'user',
            text: rawText || '',
            authorJid: isGroup ? String(key.participant || '') : null,
            authorName: null,
            media: null,
            raw: msg,
        };

        // Normalize media
        const mediaNode = this._extractMediaNode(msg);
        if (mediaNode) {
            try {
                const downloaded = await this._downloadMedia(msg, mediaNode);
                if (downloaded) {
                    normalized.media = downloaded;
                    // If there's a caption, include it in text
                    if (!normalized.text && mediaNode.caption) {
                        normalized.text = mediaNode.caption;
                    }
                }
            } catch (err) {
                console.warn(`[BaileysDriver:${this.sessionId}] media download failed:`, err.message);
            }
        }

        return normalized;
    }

    /** @param {any} msg @returns {string|null} */
    _extractText(msg) {
        const m = msg?.message;
        if (!m) return '';
        // conversation
        if (m.conversation) return m.conversation;
        // extendedTextMessage (includes text, quoted, etc.)
        if (m.extendedTextMessage?.text) return m.extendedTextMessage.text;
        // imageMessage / videoMessage / audioMessage / documentMessage — caption in child
        for (const type of ['imageMessage', 'videoMessage', 'audioMessage', 'documentMessage', 'stickerMessage']) {
            if (m[type]?.caption) return m[type].caption;
        }
        // protocolMessage (delete, etc.)
        if (m.protocolMessage) return '';
        return '';
    }

    /** @param {any} msg @returns {any|null} */
    _extractMediaNode(msg) {
        const m = msg?.message;
        if (!m) return null;
        for (const type of ['imageMessage', 'videoMessage', 'audioMessage', 'documentMessage', 'stickerMessage']) {
            if (m[type]) return { type, ...m[type] };
        }
        return null;
    }

    /**
     * Download media from a Baileys message and save to MEDIA_LOCAL_DIR.
     * @param {any} msg
     * @param {any} mediaNode
     * @returns {Promise<{mimeType:string, fileName:string, size:number, localPath:string}|null>}
     */
    async _downloadMedia(msg, mediaNode) {
        if (!this._sock) return null;
        const { downloadMediaMessage } = this._baileysModule || require('@whiskeysockets/baileys');
        const mimeType = mediaNode?.mimetype || mediaNode?.mediaType || 'application/octet-stream';
        const ext = (require('mime-types').extension(mimeType)) || 'bin';
        const localPath = path.join(
            process.env.MEDIA_LOCAL_DIR || path.join(process.cwd(), 'data/media-assets'),
            `${Date.now()}-${String(msg?.key?.id || Math.random().toString(36)).slice(0, 16)}.${ext}`
        );
        // Ensure directory
        const dir = path.dirname(localPath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        const buffer = await downloadMediaMessage(msg, 'buffer', {}, {
            logger: require('pino')({ level: 'silent' }),
            reuploadRequest: this._sock.updateMediaMessage,
        });
        fs.writeFileSync(localPath, buffer);
        return {
            mimeType,
            fileName: mediaNode?.fileName || path.basename(localPath),
            size: buffer.length,
            localPath,
        };
    }

    /** @param {import('./types').IncomingMessage} msg */
    _bufferMessage(msg) {
        const jid = normalizeJid(msg.chatId, 'baileys');
        let buf = this._msgBuffer.get(jid);
        if (!buf) { buf = []; this._msgBuffer.set(jid, buf); }
        buf.push(msg);
        if (buf.length > BUFFER_SIZE) buf.shift();
    }
}

module.exports = BaileysDriver;
