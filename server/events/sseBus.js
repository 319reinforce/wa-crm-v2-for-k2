/**
 * SSE Bus — 后端进程内广播管道
 *
 * 所有 SSE 客户端(前端 EventSource)注册后,任意模块通过 broadcast(event, data)
 * 向所有客户端推事件。替代 index.cjs 里的 inline sseClients Set。
 */

const { perfLog } = require('../services/perfLog');

const clients = new Set();

// Phase 1: wa-message 事件按 message_id 去重，防止 sessionRegistry 路径 + persistence
// 路径同时启用时对同一条消息双推。窗口 60 秒足够覆盖两条路径的时间差。
const WA_MESSAGE_DEDUP_WINDOW_MS = 60_000;
const WA_MESSAGE_DEDUP_MAX = 10_000;
const recentWaMessageIds = new Map(); // waMsgId → expiryTs

function shouldSkipWaMessageDuplicate(data) {
    if (!data) return false;
    const msgId = data.message_id || data.wa_message_id;
    if (!msgId) return false;
    const now = Date.now();
    const expiry = recentWaMessageIds.get(msgId);
    if (expiry && expiry > now) return true;
    recentWaMessageIds.set(msgId, now + WA_MESSAGE_DEDUP_WINDOW_MS);
    if (recentWaMessageIds.size > WA_MESSAGE_DEDUP_MAX) {
        // 清掉过期项，避免无界增长（hot path 频率很低，此开销可接受）
        for (const [key, exp] of recentWaMessageIds) {
            if (exp <= now) recentWaMessageIds.delete(key);
        }
    }
    return false;
}

function addClient(res) {
    clients.add(res);
    res.on('close', () => clients.delete(res));
    return () => clients.delete(res);
}

function broadcast(eventName, data) {
    if (eventName === 'wa-message' && shouldSkipWaMessageDuplicate(data)) {
        perfLog('sse_broadcast_deduped', {
            event: eventName,
            waMsgId: data && (data.message_id || data.wa_message_id),
            source: data && data.source,
        });
        return clients.size;
    }
    perfLog('sse_broadcast', {
        event: eventName,
        recipients: clients.size,
        waMsgId: data && (data.message_id || data.wa_message_id),
        sessionId: data && data.session_id,
        role: data && data.role,
        source: data && data.source,
    });
    if (clients.size === 0) return 0;
    const payload = data === undefined ? '' : JSON.stringify(data);
    const message = `event: ${eventName}\ndata: ${payload}\n\n`;
    const dead = [];
    for (const client of clients) {
        try {
            client.write(message);
        } catch (_) {
            dead.push(client);
        }
    }
    for (const client of dead) clients.delete(client);
    return clients.size;
}

function ping() {
    if (clients.size === 0) return;
    const msg = `: ping ${Date.now()}\n\n`;
    const dead = [];
    for (const client of clients) {
        try { client.write(msg); } catch (_) { dead.push(client); }
    }
    for (const client of dead) clients.delete(client);
}

function count() {
    return clients.size;
}

module.exports = { addClient, broadcast, ping, count };
