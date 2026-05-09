/**
 * SSE Bus — 后端进程内广播管道
 *
 * 所有 SSE 客户端(前端 EventSource)注册后,任意模块通过 broadcast(event, data)
 * 向所有客户端推事件。替代 index.cjs 里的 inline sseClients Set。
 */

const { perfLog } = require('../services/perfLog');
const { logServerEvent } = require('../middleware/structuredLog');

const clients = new Map();
const DEFAULT_MAX_CLIENTS = 100;

function getMaxClients() {
    const parsed = Number.parseInt(process.env.SSE_MAX_CLIENTS || '', 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_MAX_CLIENTS;
    return parsed;
}

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

function summarizeClients() {
    const byOwner = {};
    const byRole = {};
    for (const meta of clients.values()) {
        const owner = meta.ownerScope || 'unscoped';
        const role = meta.authRole || 'unknown';
        byOwner[owner] = (byOwner[owner] || 0) + 1;
        byRole[role] = (byRole[role] || 0) + 1;
    }
    return {
        total: clients.size,
        max: getMaxClients(),
        byOwner,
        byRole,
    };
}

function canAcceptClient() {
    return clients.size < getMaxClients();
}

function addClient(res, meta = {}) {
    if (!canAcceptClient()) {
        return {
            accepted: false,
            reason: 'client_limit',
            count: clients.size,
            max: getMaxClients(),
            close: () => {},
        };
    }

    const clientMeta = {
        connectedAt: new Date().toISOString(),
        requestId: meta.requestId || null,
        ownerScope: meta.ownerScope || null,
        authRole: meta.authRole || null,
        userId: meta.userId || null,
    };
    clients.set(res, clientMeta);
    const close = () => clients.delete(res);
    res.on('close', close);

    try {
        res.write(`event: sse-meta\ndata: ${JSON.stringify({
            request_id: clientMeta.requestId,
            owner_scope: clientMeta.ownerScope,
            auth_role: clientMeta.authRole,
        })}\n\n`);
    } catch (_) {
        clients.delete(res);
    }

    return {
        accepted: clients.has(res),
        count: clients.size,
        max: getMaxClients(),
        close,
    };
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
    const stats = summarizeClients();
    perfLog('sse_broadcast', {
        event: eventName,
        recipients: stats.total,
        waMsgId: data && (data.message_id || data.wa_message_id),
        sessionId: data && data.session_id,
        role: data && data.role,
        source: data && data.source,
    });
    if (clients.size === 0) return 0;
    const eventData = data && typeof data === 'object' && !Array.isArray(data)
        ? data
        : { value: data };
    const payload = data === undefined ? '' : JSON.stringify({
        ...eventData,
        _meta: {
            event: eventName,
            recipients: stats.total,
            emitted_at: new Date().toISOString(),
        },
    });
    const message = `event: ${eventName}\ndata: ${payload}\n\n`;
    const dead = [];
    for (const client of clients.keys()) {
        try {
            client.write(message);
        } catch (err) {
            dead.push(client);
            logServerEvent('warn', 'sse_client_write_failed', {
                event: eventName,
                error: err?.message || String(err),
                client: clients.get(client),
            });
        }
    }
    for (const client of dead) clients.delete(client);
    return clients.size;
}

function ping() {
    if (clients.size === 0) return;
    const msg = `: ping ${Date.now()}\n\n`;
    const dead = [];
    for (const client of clients.keys()) {
        try { client.write(msg); } catch (_) { dead.push(client); }
    }
    for (const client of dead) clients.delete(client);
}

function count() {
    return clients.size;
}

function resetForTests() {
    clients.clear();
    recentWaMessageIds.clear();
}

module.exports = {
    addClient,
    broadcast,
    ping,
    count,
    canAcceptClient,
    summarizeClients,
    _private: {
        resetForTests,
        getMaxClients,
        shouldSkipWaMessageDuplicate,
    },
};
