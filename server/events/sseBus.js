/**
 * SSE Bus — 后端进程内广播管道
 *
 * 所有 SSE 客户端(前端 EventSource)注册后,任意模块通过 broadcast(event, data)
 * 向所有客户端推事件。替代 index.cjs 里的 inline sseClients Set。
 */

const { perfLog } = require('../services/perfLog');

const clients = new Set();

function addClient(res) {
    clients.add(res);
    res.on('close', () => clients.delete(res));
    return () => clients.delete(res);
}

function broadcast(eventName, data) {
    perfLog('sse_broadcast', {
        event: eventName,
        recipients: clients.size,
        waMsgId: data && (data.message_id || data.wa_message_id),
        sessionId: data && data.session_id,
        role: data && data.role,
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
