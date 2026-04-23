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
const protoStore = require('../../messageProtoStore');

const RECONNECT_DELAY_MS = 5000;
const BUFFER_SIZE = 200; // per-jid ring buffer for fetchRecentMessages
const FETCH_HISTORY_TIMEOUT_MS = 30_000;

// LEGACY_MODE kill switch：遇到 Baileys 兼容性问题时设 WA_BAILEYS_LEGACY_MODE=true
// 强制回退到 Web(Ubuntu/Chrome) browser + syncFullHistory:false 的旧行为，
// 相当于改造前的 Baileys 驱动（纯事件驱动、无历史同步）。仅作为紧急回退，不长期维护。
const LEGACY_MODE = String(process.env.WA_BAILEYS_LEGACY_MODE || '').toLowerCase() === 'true';

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

        // LID → PN 映射：WA 1:1 对话 remoteJid 可能是 LID（@lid 别名），DB
        // creators.wa_phone 存的是 PN（真实号码）。两种标识不通用必须映射。
        //
        // 映射来源：
        //   1) sendMessage 时 onWhatsApp 返回的 {jid, lid} 对（6.17.x 不稳定，
        //      大概率没 lid 字段）
        //   2) 发送回显关联：sendMessage 内部记 {key.id → 目标 PN jid}，
        //      messages.upsert 收到 fromMe=true 的消息时以 key.id 反查记下
        //      的 PN，跟当前事件的 remoteJid (LID) 建立映射。这是确定性路径，
        //      只要你发过一次消息给某个 contact，他以后回的 LID 就能解出 PN。
        /** @type {Map<string, string>} lidJid → pnJid */
        this._lidToPnMap = new Map();
        /** @type {Map<string, string>} outgoing msg key.id → target PN jid */
        this._sentIdToTargetJid = new Map();
        this._SENT_ID_MAP_CAP = 500;
        // 最近一次 outgoing 的 PN jid + 时间戳，用于兜底：未映射 LID 若在 2min
        // 窗口内就认定是刚发出消息的那个 chat（1:1 场景下大概率正确；多 chat
        // 并发场景有错配风险，打 warn 方便审计）。
        this._lastOutgoingPnJid = null;
        this._lastOutgoingAt = 0;
        this._LID_TIMING_WINDOW_MS = 2 * 60 * 1000;

        // 历史同步：标记 isLatest=true 是否已见。每次连接建立后重置，用于
        // 避免同一 socket 生命周期内重复 emit 'history_latest_seen'。
        this._historySyncLatestSeen = false;

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

        const baileys = require('@whiskeysockets/baileys');
        const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, Browsers, fetchLatestBaileysVersion, downloadMediaMessage } = baileys;
        this._baileysModule = { makeWASocket, useMultiFileAuthState, DisconnectReason, downloadMediaMessage };

        const { state, saveCreds } = await useMultiFileAuthState(this._authDir);

        // Baileys 要求 logger 实现 pino 接口（含 child()），裸 { level: 'silent' }
        // 会让 makeWASocket 在内部调用 logger.child(...) 时抛 TypeError。
        const pino = require('pino');
        const baileysLogger = pino({ level: 'silent' });

        // Browser 三元组决定 WA 服务端行为：
        //   - Web 变体 (Ubuntu/Chrome)：轻量，但服务端不推完整历史
        //   - Desktop 变体 (macOS/Desktop)：WA 当 companion desktop 设备处理，推全量历史
        // 历史同步需要 Desktop + syncFullHistory:true 组合（官方文档要求）。
        // LEGACY_MODE=true 时回退到 Web 变体（无历史同步能力）。
        let browserTuple;
        if (LEGACY_MODE) {
            browserTuple = (Browsers && typeof Browsers.ubuntu === 'function')
                ? Browsers.ubuntu('Chrome')
                : ['Ubuntu', 'Chrome', '22.04.4'];
        } else {
            browserTuple = (Browsers && typeof Browsers.macOS === 'function')
                ? Browsers.macOS('Desktop')
                : ['Mac OS', 'Desktop', '10.15.7'];
        }

        // 动态拉最新版本号，避免协议过时导致 405。失败就用编译期常量。
        let version;
        try {
            if (typeof fetchLatestBaileysVersion === 'function') {
                const r = await fetchLatestBaileysVersion();
                version = r?.version;
            }
        } catch (_) { /* 忽略，用 baileys 默认 */ }

        // getMessage 回调：Baileys 在消息重传/引用解密/编辑时调用此回调还原原消息 proto。
        // 热消息命中 protoStore LRU，冷消息查 DB（wa_messages.proto_bytes）。返回 undefined
        // 时 Baileys 会跳过该操作（而非抛错）。见 messageProtoStore.js。
        const sessionId = this.sessionId;
        const getMessage = async (key) => {
            const msg = await protoStore.get(sessionId, key);
            return msg || undefined;  // 必须 undefined 不是 null
        };

        this._sock = makeWASocket({
            auth: state,
            printQRInTerminal: false,
            logger: baileysLogger,
            browser: browserTuple,
            ...(version ? { version } : {}),
            // Desktop 模式 + syncFullHistory:true → 服务端推全量 messaging-history.set 事件。
            // LEGACY_MODE 下保留旧行为（无历史同步）。
            syncFullHistory: !LEGACY_MODE,
            markOnlineOnConnect: false,
            connectTimeoutMs: 60_000,
            keepAliveIntervalMs: 30_000,
            getMessage,
        });

        console.log(`[BaileysDriver:${this.sessionId}] socket 已创建 browser=${JSON.stringify(browserTuple)} version=${JSON.stringify(version || 'default')} syncFullHistory=${!LEGACY_MODE} legacy=${LEGACY_MODE}`);

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
                // 重置 history sync 观测位：新连接会重新推 messaging-history.set，
                // worker 的 gap-fill 逻辑应该基于新连接的 isLatest 信号再跑一次。
                this._historySyncLatestSeen = false;
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
                    // LID ↔ PN 映射建立：fromMe 回显的 key.id 与我们 sendMessage
                    // 记下的 target PN 关联；若 remoteJid 回显是 LID，就建立映射
                    this._maybeLearnLidMapping(msg);
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

        // 尝试从 baileys 的其它事件里挖出 LID↔PN 映射。Baileys 6.17.16 的
        // onWhatsApp 不返回 lid，唯有通过这些事件捕获对方 contact 的 lid 字段
        // （若 WhatsApp 服务端下发）。

        this._sock.ev.on('contacts.upsert', (contacts) => {
            for (const c of contacts) {
                if (c?.id && c?.lid) {
                    this._lidToPnMap.set(String(c.lid), String(c.id));
                    console.log(`[BaileysDriver:${this.sessionId}] contacts.upsert mapped LID ${c.lid} → PN ${c.id}`);
                }
            }
        });
        this._sock.ev.on('contacts.update', (updates) => {
            for (const u of updates) {
                if (u?.id && u?.lid) {
                    this._lidToPnMap.set(String(u.lid), String(u.id));
                    console.log(`[BaileysDriver:${this.sessionId}] contacts.update mapped LID ${u.lid} → PN ${u.id}`);
                }
            }
        });
        this._sock.ev.on('chats.upsert', (chats) => {
            for (const c of chats) {
                if (c?.id && c?.lid) {
                    this._lidToPnMap.set(String(c.lid), String(c.id));
                    console.log(`[BaileysDriver:${this.sessionId}] chats.upsert mapped LID ${c.lid} → PN ${c.id}`);
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

        // messaging-history.set：Baileys 官方历史同步事件。
        // 触发时机：
        //   1) 首次连接 + syncFullHistory:true → 服务端推全量历史（分批多次触发，isLatest 最后一次为 true）
        //   2) fetchMessageHistory() 按需调用返回 → 通过同一事件异步回传（syncType=ON_DEMAND）
        // payload 字段：{ chats, contacts, messages, syncType, progress, isLatest }
        //
        // 设计：driver 只做透传 + LID 映射补充，业务过滤（roster/eligibility）留给 waWorker 层，
        // 保持与 wwebjs syncHistory 的语义一致。
        if (!LEGACY_MODE) {
            this._sock.ev.on('messaging-history.set', (payload) => {
                try {
                    const { chats = [], contacts = [], messages = [], syncType, progress, isLatest } = payload || {};
                    // LID ↔ PN 映射：messaging-history.set 里的 contacts 可能带 lid 字段（Issue #2077 有时为空）
                    for (const c of contacts) {
                        if (c?.id && c?.lid) {
                            this._lidToPnMap.set(String(c.lid), String(c.id));
                        }
                    }
                    console.log(`[BaileysDriver:${this.sessionId}] messaging-history.set chats=${chats.length} contacts=${contacts.length} messages=${messages.length} syncType=${syncType} progress=${progress} isLatest=${!!isLatest}`);
                    // 原始 payload 透传给 waService → waWorker。Worker 用 driver.normalizeRawMessage
                    // 把每条 proto 消息 normalize 成 IncomingMessage 后走 insertMessages。
                    this.emit('history_set', {
                        messages,
                        syncType,
                        progress,
                        isLatest: !!isLatest,
                    });
                    if (isLatest === true && !this._historySyncLatestSeen) {
                        this._historySyncLatestSeen = true;
                        this.emit('history_latest_seen');
                    }
                } catch (err) {
                    console.error(`[BaileysDriver:${this.sessionId}] messaging-history.set handler error:`, err.message);
                }
            });
        }

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
        const startedAt = Date.now();
        const jid = normalizeJid(phoneE164, 'baileys');
        console.log(`[BaileysDriver:${this.sessionId}] sendMessage → ${jid} len=${String(text || '').length}`);

        // 预检：目标号码是否在 WhatsApp 上。onWhatsApp 结果为空/exists=false 时
        // sock.sendMessage 会永久等 ack，父进程 30s 超时（用户看到的 command timeout）。
        try {
            if (typeof this._sock.onWhatsApp === 'function') {
                const check = await Promise.race([
                    this._sock.onWhatsApp(jid),
                    new Promise((resolve) => setTimeout(() => resolve(null), 5000)),
                ]);
                const entry = Array.isArray(check) ? check[0] : null;
                console.log(`[BaileysDriver:${this.sessionId}] onWhatsApp raw: ${JSON.stringify(check)}`);
                if (!entry?.exists) {
                    console.warn(`[BaileysDriver:${this.sessionId}] onWhatsApp: ${jid} NOT registered (check=${JSON.stringify(check)})`);
                    return { ok: false, error: `phone ${phoneE164} 未注册 WhatsApp 或 lid 未解析` };
                }
                // 建立 LID ↔ PN 映射：onWhatsApp 返回 { jid: <pn>, lid: <lid>, exists }
                if (entry.lid && entry.jid) {
                    this._lidToPnMap.set(String(entry.lid), String(entry.jid));
                    console.log(`[BaileysDriver:${this.sessionId}] mapped LID ${entry.lid} → PN ${entry.jid}`);
                }
            }
        } catch (err) {
            console.warn(`[BaileysDriver:${this.sessionId}] onWhatsApp 预检失败: ${err.message}，继续尝试直发`);
        }

        try {
            // 硬超时 20s（父进程 30s，留 10s 给结果回传）
            const sent = await Promise.race([
                this._sock.sendMessage(jid, { text }),
                new Promise((_, reject) => setTimeout(() => reject(new Error('baileys sendMessage 20s 无 ack')), 20000)),
            ]);
            const elapsed = Date.now() - startedAt;
            const msgId = String(sent?.key?.id || '');
            // 记 msg id → 目标 PN jid + 最近 outgoing 时间戳，用于多级 LID
            // 还原策略（见 _maybeLearnLidMapping、_normalizeMessage fallback）
            if (msgId) {
                if (this._sentIdToTargetJid.size >= this._SENT_ID_MAP_CAP) {
                    const firstKey = this._sentIdToTargetJid.keys().next().value;
                    if (firstKey) this._sentIdToTargetJid.delete(firstKey);
                }
                this._sentIdToTargetJid.set(msgId, jid);
            }
            this._lastOutgoingPnJid = jid;
            this._lastOutgoingAt = Date.now();
            console.log(`[BaileysDriver:${this.sessionId}] sendMessage ok messageId=${msgId} ${elapsed}ms`);
            return {
                ok: true,
                // 对齐 wwebjs 返回字段名，下游 CRM persist 依赖 messageId；
                // 同时保留 id 给内部引用（但父 IPC envelope 会覆盖它）
                messageId: msgId,
                timestamp: typeof sent?.messageTimestamp === 'number' ? sent.messageTimestamp * 1000 : Date.now(),
                chatId: phoneE164,
            };
        } catch (err) {
            const elapsed = Date.now() - startedAt;
            console.error(`[BaileysDriver:${this.sessionId}] sendMessage 失败 ${elapsed}ms: ${err?.message || err}`);
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
                messageId: String(sent?.key?.id || ''),
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

    /**
     * 按需向 WA 服务端请求一段历史消息（对标 wwebjs 的 syncHistory gap-fill）。
     * 结果**不**通过 Promise 返回，而是通过 `messaging-history.set` 事件异步回传
     * （syncType=ON_DEMAND）。waWorker 的 history_set 处理器会把结果落库。
     *
     * 已知 bug（Baileys Issue #1934）：某些版本下 `sock.fetchMessageHistory()` 返回
     * 成功但 `messaging-history.set` 回调不触发。30s 超时 + 调用方（worker）的
     * 每个 roster 达人循环重试是对这个 bug 的兜底。
     *
     * @param {number} count 请求消息数（建议 50-200）
     * @param {{ remoteJid: string, id: string, fromMe: boolean }} oldestKey  DB 里最旧消息的 key
     * @param {number} oldestTsMs  DB 里最旧消息的时间戳（毫秒）
     * @returns {Promise<string|null>} sessionId 或 null
     */
    async fetchMessageHistory(count, oldestKey, oldestTsMs) {
        if (!this._sock || !this._ready) return null;
        // 注：不再根据 LEGACY_MODE 短路。syncFullHistory（初始全量推送）受
        // LEGACY_MODE 控制属于协议层差异（需要 macOS Desktop browser identity），
        // 但 sock.fetchMessageHistory 是独立的 on-demand RPC，不依赖初始同步能力，
        // Ubuntu/Chrome 身份也能发起（前端 sync 按钮 / worker gap-fill 等场景需要）。
        // 真无效时 WA 服务端要么不回 messaging-history.set、要么直接报错，本方法
        // 已有 30s 超时兜底。
        if (typeof this._sock.fetchMessageHistory !== 'function') {
            console.warn(`[BaileysDriver:${this.sessionId}] sock.fetchMessageHistory 不存在（Baileys Issue #2083），跳过`);
            return null;
        }
        // Baileys API 期望秒级时间戳（Long 或 number）
        const tsSec = Math.floor(Number(oldestTsMs || 0) / 1000);
        let timeoutId = null;
        try {
            const result = await Promise.race([
                this._sock.fetchMessageHistory(count, oldestKey, tsSec),
                new Promise((_, reject) => {
                    timeoutId = setTimeout(
                        () => reject(new Error(`fetchMessageHistory ${FETCH_HISTORY_TIMEOUT_MS / 1000}s timeout`)),
                        FETCH_HISTORY_TIMEOUT_MS
                    );
                }),
            ]);
            return typeof result === 'string' ? result : null;
        } catch (err) {
            console.error(`[BaileysDriver:${this.sessionId}] fetchMessageHistory failed:`, err?.message || err);
            return null;
        } finally {
            // 必须清 timer，否则 Promise.race 先 resolve 时 setTimeout 仍在事件循环中
            // 持有 30s，生产每调用一次泄漏一个 timer，测试进程退出卡 30s。
            if (timeoutId) clearTimeout(timeoutId);
        }
    }

    /**
     * Public wrapper：把 Baileys 原生 WebMessageInfo 转成内部 IncomingMessage 格式。
     * 供 waWorker 处理 messaging-history.set 事件时复用（避免在 worker 里重写 LID 映射、
     * 媒体下载、text 抽取等逻辑）。
     *
     * 副作用：同步把 proto.IMessage 写入 protoStore LRU（getMessage 回调路径需要）。
     *
     * @param {any} rawMsg  Baileys 原生消息（proto.IWebMessageInfo）
     * @returns {Promise<import('./types').IncomingMessage|null>}
     */
    async normalizeRawMessage(rawMsg) {
        return this._normalizeMessage(rawMsg);
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

        // WhatsApp 1:1 对话里 remoteJid 可能是 PN (@s.whatsapp.net) 或 LID (@lid)
        // 两种格式，同一个人的不同标识。DB creators.wa_phone 存 PN 格式（真实号码）。
        // LID 是 WA 内部别名、值和手机号完全不同；直接当号码用会创建野生 creator。
        //
        // 三级兜底找 PN:
        //   1. 如果 remoteJid 本身就是 PN (@s.whatsapp.net) → 直接用
        //   2. 如果 key.senderPn / msg.senderPn 存在 → 用它（baileys 6.x 某些版本有）
        //   3. 否则查 _lidToPnMap（sendMessage 时从 onWhatsApp 结果缓存的 LID→PN）
        const resolvePnJid = (jidCandidate) => {
            if (!jidCandidate) return null;
            const str = String(jidCandidate);
            if (str.endsWith('@s.whatsapp.net') || str.endsWith('@g.us')) return str;
            if (str.endsWith('@lid')) {
                const pn = this._lidToPnMap.get(str);
                if (pn) return pn;
                // 兜底：最近 2min 内刚给某 PN 发过消息 → 假设是同一 chat 回复
                if (this._lastOutgoingPnJid && Date.now() - this._lastOutgoingAt < this._LID_TIMING_WINDOW_MS) {
                    this._lidToPnMap.set(str, this._lastOutgoingPnJid);
                    console.warn(`[BaileysDriver:${this.sessionId}] LID ${str} resolved by timing heuristic → PN ${this._lastOutgoingPnJid} (lastSent ${Date.now() - this._lastOutgoingAt}ms ago)`);
                    return this._lastOutgoingPnJid;
                }
                console.warn(`[BaileysDriver:${this.sessionId}] LID ${str} 无法还原 PN (no map entry, no recent outgoing), using LID as-is`);
            }
            return str;
        };

        const chatJidForPhone = !fromMe && !isGroup
            ? (key.senderPn || msg?.senderPn || resolvePnJid(key.remoteJid))
            : key.remoteJid;

        const chatId = jidToPhoneE164(chatJidForPhone);
        const from = jidToPhoneE164(fromMe ? chatJidForPhone : (key.participant || chatJidForPhone));

        // Proto 持久化：把 msg.message（proto.IMessage）同步写 LRU 并编码为 Buffer。
        // - LRU 让 getMessage 回调热路径命中微秒级（进程内常驻）
        // - 编码后的 proto_bytes 通过 normalized 向上传给 insertMessages → wa_messages.proto_bytes 冷存储
        //   （跨进程重启后仍可从 DB 读回）
        const protoIMessage = msg?.message || null;
        let protoBytes = null;
        if (protoIMessage) {
            try {
                protoStore.put(this.sessionId, String(key.id), protoIMessage);
                protoBytes = protoStore.encodeProto(protoIMessage);
            } catch (err) {
                // 不阻塞主链路：proto 持久化失败 getMessage 回调会 miss，
                // WA 会降级处理（要么放弃重传要么让用户重发）。
                console.warn(`[BaileysDriver:${this.sessionId}] proto encode failed (msgId=${key.id}): ${err.message}`);
            }
        }

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
            // baileys 在消息上直接带 pushName（发送方自己设置的显示名）/ verifiedBizName（企业认证名）。
            // 只在 fromMe=false 时填 — fromMe 的 pushName 是本账号自己的名字，填进去会污染对方 creator。
            // 拿不到名字时宁可留 null，让 waWorker 走 'Unknown' fallback → canonicalCreatorResolver 会按
            // GENERIC_NAME_BLOCKLIST 跳过 primary_name fuzzy 匹配，避免串台。
            authorName: !fromMe ? (msg?.pushName || msg?.verifiedBizName || null) : null,
            media: null,
            raw: msg,
            // 交给 insertMessages 做 DB 冷存储。仅 baileys driver 设置。
            protoBytes,
            protoDriver: protoBytes ? 'baileys' : null,
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

    /**
     * 用 fromMe 回显建立 LID↔PN 映射。
     * 场景：我们 sendMessage(pnJid, ...)，WhatsApp 把这条消息回显给本会话
     * 作为 fromMe=true 的 messages.upsert 事件。如果回显的 remoteJid 是 @lid，
     * 那就是同一 chat 的 LID 别名；结合 sendMessage 存的 key.id → pnJid，
     * 可以精确地学到 LID → PN 映射。对方以后再回消息的 remoteJid @lid 就
     * 能反解出真实手机号。
     * @param {any} msg raw baileys message
     */
    _maybeLearnLidMapping(msg) {
        const key = msg?.key;
        if (!key?.fromMe) return;
        const remoteJid = String(key.remoteJid || '');
        if (!remoteJid.endsWith('@lid')) return;
        const msgId = String(key.id || '');
        if (!msgId) return;
        const targetPnJid = this._sentIdToTargetJid.get(msgId);
        if (!targetPnJid) return;
        if (this._lidToPnMap.get(remoteJid) === targetPnJid) return;
        this._lidToPnMap.set(remoteJid, targetPnJid);
        console.log(`[BaileysDriver:${this.sessionId}] learned LID ${remoteJid} → PN ${targetPnJid} (via fromMe reflection msgId=${msgId})`);
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
