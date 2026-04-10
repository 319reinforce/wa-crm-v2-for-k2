/**
 * WA Worker — WhatsApp 聊天记录爬虫（单账号版）
 * 实时监听 + 增量轮询，数据写入 MySQL
 *
 * 启动方式：node server/index.cjs（自动启动）
 */

require('dotenv').config();
const { getDb } = require('../db');
const { getClient, waitForReady, stop: stopWaService } = require('./services/waService');
const {
    analyzeCreatorEligibility,
    getMessageText,
    normalizeCreatorOwner,
    normalizePhone,
} = require('./services/creatorEligibilityService');

// ***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED*** 配置 ***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED***

const POLL_INTERVAL_MS = 5 * 60 * 1000;   // 增量轮询间隔（5分钟）
const HISTORY_MSG_LIMIT = 200;            // 历史消息拉取条数
const BASE_URL = `http://localhost:${process.env.PORT || 3000}`; // 画像服务调用地址

// ***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED*** 达人准入过滤 ***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED***

function mapMessagesForEligibility(messages = []) {
    return (messages || []).map((message) => ({
        text: getMessageText(message),
        timestamp: message?.timestamp || message?.timestamp_ms || 0,
    }));
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

function dedupKey(msg) {
    const ts = msg.timestamp || 0;  // WhatsApp API 使用秒，统一与 DB 存储格式一致
    return `${msg.chat?.id?.SerializedString || msg.from}||${msg.id}||${ts}`;
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
    const nowSec = Math.floor(Date.now() / 1000);  // 统一用秒
    const ops = messages.map(m => [
        creatorId,
        m.role || 'user',
        m.text || m.body || '',
        m.timestamp || m.timestamp_ms || nowSec
    ]);
    const placeholders = ops.map(() => '(?, ?, ?, ?)').join(', ');
    try {
        await db2.prepare(
            `INSERT IGNORE INTO wa_messages (creator_id, role, text, timestamp)
             VALUES ${placeholders}`
        ).run(...ops.flat());
        return ops.length;
    } catch (e) {
        console.error('[WA Worker] insertMessages error:', e.message);
        return 0;
    }
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
    let row = await db2.prepare('SELECT id FROM creators WHERE wa_phone = ?').get(normalizedPhone);
    if (row) {
        await db2.prepare('UPDATE creators SET primary_name = ?, updated_at = NOW() WHERE id = ?')
            .run(name || 'Unknown', row.id);
        return row.id;
    }
    const result = await db2.prepare(
        'INSERT INTO creators (primary_name, wa_phone, wa_owner, source) VALUES (?, ?, ?, ?)'
    ).run(name || 'Unknown', normalizedPhone, normalizeCreatorOwner('Beau'), 'wa');
    return result.lastInsertRowid;
}

// ***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED*** 历史同步 ***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED***

async function syncHistory(client) {
    progress.phase = 'sync';
    progress.processedChats = 0;
    progress.totalChats = 0;
    progress.newMessages = 0;
    progress.errors = [];

    let chats;
    try {
        chats = await client.getChats();
    } catch (e) {
        console.error('[WA Worker] getChats failed:', e.message);
        progress.clientError = e.message;
        return;
    }

    const privateChats = chats.filter(c => !c.isGroup);
    progress.totalChats = privateChats.length;
    console.log(`[WA Worker] 发现 ${privateChats.length} 个私聊，开始同步...`);

    for (let i = 0; i < privateChats.length; i++) {
        const chat = privateChats[i];
        const pct = Math.round((i / privateChats.length) * 100);
        process.stdout.write(`\r[WA Worker] ${progress.bar()} ${pct}% (${i}/${privateChats.length})  `);

        try {
            const contact = await chat.getContact().catch(() => null);
            if (!contact) { progress.processedChats++; continue; }

            const phone = normalizePhone(contact.number || '');
            const name = contact.name || contact.pushname || 'Unknown';

            let wamessages;
            try {
                wamessages = await chat.fetchMessages({ limit: HISTORY_MSG_LIMIT });
            } catch (e) {
                if (e.message.includes('detached Frame')) {
                    console.log(`\n[WA Worker] ${name}: Frame detached，跳过`);
                } else {
                    console.error(`\n[WA Worker] fetchMessages error for ${name}:`, e.message);
                    progress.errors.push(`${name}: ${e.message}`);
                }
                progress.processedChats++;
                continue;
            }

            const eligibility = getEligibilityForHistory(phone, name, wamessages);
            if (!eligibility.eligible) {
                progress.processedChats++;
                continue;
            }

            const creatorId = await getOrCreateCreator(phone, name);

            const nowSec = Math.floor(Date.now() / 1000);
            const msgsForDb = wamessages.map(m => ({
                role: m.fromMe ? 'me' : 'user',
                text: m.body,
                timestamp: m.timestamp || nowSec
            }));

            const inserted = await insertMessages(creatorId, msgsForDb);
            progress.newMessages += inserted;

            if (inserted > 0) {
                await touchCreator(creatorId);  // 更新达人活跃时间
                console.log(`\n[WA Worker] ✅ ${name}: +${inserted} 条新消息`);
            }
        } catch (e) {
            console.error(`\n[WA Worker] chat error:`, e.message);
            progress.errors.push(`chat ${i}: ${e.message}`);
        }

        progress.processedChats++;
    }

    console.log(`\n[WA Worker] 历史同步完成: +${progress.newMessages} 条消息`);
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
                recentMsgs = chat ? await chat.fetchMessages({ limit: 8 }) : [];
            } catch (_) {}

            const eligibility = getEligibilityForRealtime(phone, name, recentMsgs);
            if (!eligibility.eligible) return;
            existingCreator = { id: await getOrCreateCreator(phone, name) };
        }

        const creatorId = existingCreator.id;
        const nowSec = Math.floor(Date.now() / 1000);
        const inserted = await insertMessages(creatorId, [{
            role: msg.fromMe ? 'me' : 'user',
            text: msg.body,
            timestamp: msg.timestamp || nowSec
        }]);

        if (inserted > 0) {
            await touchCreator(creatorId);  // 更新达人活跃时间
            console.log(`[WA Worker] 📩 ${name}: ${(msg.body || '').slice(0, 50)}`);
            messageHandlers.forEach(fn => {
                try { fn({ phone, name, text: msg.body, creatorId }); } catch (_) {}
            });

            // 触发客户画像系统：标签提取 + MiniMax summary 刷新
            fetch(`${BASE_URL}/api/profile-agent/event`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    event_type: 'wa_message',
                    client_id: phone,  // wa_phone 是 client_id
                    data: { text: msg.body, role: msg.fromMe ? 'me' : 'user' }
                })
            }).catch(() => {});  // 非阻塞，不影响主流程
        }
    } catch (e) {
        console.error('[WA Worker] handleIncomingMessage error:', e.message);
    }
}

// ***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED*** 增量轮询 ***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED***

let pollInterval = null;

async function pollOnce(client) {
    try {
        const nowSec = Math.floor(Date.now() / 1000);
        const chats = await client.getChats();
        let newTotal = 0;

        // 构建 WhatsApp 当前聊天列表的 phone 集合
        const chatPhones = new Set();
        for (const chat of chats) {
            if (chat.isGroup) continue;
            const contact = await chat.getContact().catch(() => null);
            if (!contact?.number) continue;
            chatPhones.add(contact.number);
        }

        // 轮询 WhatsApp 聊天列表中的达人
        for (const chat of chats) {
            if (chat.isGroup) continue;
            const contact = await chat.getContact().catch(() => null);
            if (!contact) continue;

            const phone = normalizePhone(contact.number || '');
            const name = contact.name || contact.pushname || 'Unknown';
            const phoneEligibility = getEligibilityForRealtime(phone, name, []);
            if (!phoneEligibility.eligible && phoneEligibility.reasons.every((reason) =>
                ['cn_phone', 'non_target_phone', 'internal_contact'].includes(reason)
            )) {
                continue;
            }

            const db2 = getDb();
            const lastRow = await db2.prepare(
                'SELECT timestamp FROM wa_messages WHERE creator_id IN (SELECT id FROM creators WHERE wa_phone = ?) ORDER BY timestamp DESC LIMIT 1'
            ).get(phone);
            if (!lastRow) continue;

            let wamessages;
            try {
                wamessages = await chat.fetchMessages({ limit: 50 });
            } catch (e) {
                // 遇到 waitForChatLoading 等错误，尝试等待重试一次
                try {
                    await new Promise(r => setTimeout(r, 3000));
                    wamessages = await chat.fetchMessages({ limit: 50 });
                } catch (_) { continue; }
            }

            const eligibility = getEligibilityForRealtime(phone, name, wamessages);
            if (!eligibility.eligible) continue;

            const newer = (wamessages || []).filter(m => {
                if (isAlreadyProcessed(m)) return false;
                const ts = m.timestamp || 0;
                return ts > lastRow.timestamp;
            });

            if (newer.length > 0) {
                const creatorId = await getOrCreateCreator(phone, name);
                const inserted = await insertMessages(creatorId, newer.map(m => ({
                    role: m.fromMe ? 'me' : 'user',
                    text: m.body,
                    timestamp: m.timestamp || nowSec
                })));
                newTotal += inserted;
                if (inserted > 0) {
                    await touchCreator(creatorId);
                    console.log(`[WA Worker][Poll] ${name}: +${inserted} 条新消息`);

                    // 触发客户画像系统（每批次只发一次，避免刷接口）
                    fetch(`${BASE_URL}/api/profile-agent/event`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            event_type: 'wa_message',
                            client_id: phone,
                            data: { text: newer[0].body, role: newer[0].fromMe ? 'me' : 'user' }
                        })
                    }).catch(() => {});
                }
            }
        }

        // 轮询数据库里有但 WhatsApp 聊天列表里没有的达人（对方没发过消息的情况）
        const db2 = getDb();
        const dbCreators = await db2.prepare('SELECT id, wa_phone FROM creators WHERE is_active = 1').all();
        for (const creator of dbCreators) {
            if (chatPhones.has(creator.wa_phone)) continue;  // 已由上面的循环处理
            const lastRow = await db2.prepare(
                'SELECT timestamp FROM wa_messages WHERE creator_id = ? ORDER BY timestamp DESC LIMIT 1'
            ).get(creator.id);
            if (!lastRow) continue;
            // 已有过期检查，这里只补时间戳接近现在但缺失的记录
            // 暂时跳过，因为对方没发消息我们就无法拉取
        }

        progress.lastPollAt = new Date();
        progress.newMessages += newTotal;
        if (newTotal > 0) {
            console.log(`[WA Worker][Poll] 本轮增量: +${newTotal} 条消息`);
        }
    } catch (e) {
        console.error('[WA Worker][Poll] error:', e.message);
    }
}

function startPolling(client) {
    if (pollInterval) clearInterval(pollInterval);
    pollOnce(client).catch(console.error);
    pollInterval = setInterval(() => pollOnce(client).catch(console.error), POLL_INTERVAL_MS);
    console.log(`[WA Worker] 增量轮询已启动 (每${POLL_INTERVAL_MS / 1000 / 60}分钟)`);
}

// ***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED*** Worker 启动 ***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED***

let started = false;

async function start(options = {}) {
    if (started) {
        console.log('[WA Worker] 已启动，请勿重复调用');
        return;
    }
    started = true;
    progress.startedAt = new Date();
    progress.phase = 'init';

    console.log('═'.repeat(60));
    console.log('  WA Worker 启动中...');
    console.log(`  轮询间隔: ${POLL_INTERVAL_MS / 1000 / 60} 分钟`);
    console.log('═'.repeat(60));

    // 等待 Client 就绪（最多2分钟）
    try {
        await waitForReady(120000);
    } catch (e) {
        console.error(`[WA Worker] ${e.message}，请先扫码认证`);
        progress.clientError = e.message;
        return;
    }

    const c = getClient();
    if (!c) {
        console.error('[WA Worker] WhatsApp Client 未初始化');
        progress.clientError = 'Client 未初始化';
        return;
    }

    progress.clientReady = true;

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
    console.log('  WA Worker 已就绪 (实时监听 + 增量轮询)');
    console.log('═'.repeat(60));
}

function stop() {
    if (pollInterval) clearInterval(pollInterval);
    pollInterval = null;
    stopWaService();
    started = false;
    progress.phase = 'idle';
    progress.clientReady = false;
    console.log('[WA Worker] 已停止');
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
        uptime: progress.startedAt ? Date.now() - progress.startedAt.getTime() : 0,
    };
}

// ***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED*** 导出 ***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED***

module.exports = { start, stop, getProgress, registerMessageHandler };
