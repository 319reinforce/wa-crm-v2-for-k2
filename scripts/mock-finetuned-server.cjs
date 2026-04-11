/**
 * Mock Finetuned Server
 *
 * 用于本地联调 /api/minimax 的 finetuned 路由，不用于生产。
 *
 * 启动：
 *   node scripts/mock-finetuned-server.cjs
 */
require('dotenv').config();
const http = require('http');

const PORT = parseInt(process.env.MOCK_FINETUNED_PORT || '8000', 10);

function readBody(req) {
    return new Promise((resolve, reject) => {
        let data = '';
        req.on('data', (chunk) => { data += chunk; });
        req.on('end', () => resolve(data));
        req.on('error', reject);
    });
}

function json(res, status, payload) {
    const text = JSON.stringify(payload);
    res.writeHead(status, {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(text),
    });
    res.end(text);
}

const server = http.createServer(async (req, res) => {
    try {
        if (req.method ***REMOVED***= 'GET' && req.url ***REMOVED***= '/health') {
            return json(res, 200, { ok: true, service: 'mock-finetuned', port: PORT });
        }

        if (req.method ***REMOVED***= 'POST' && req.url ***REMOVED***= '/v1/messages') {
            const raw = await readBody(req);
            const body = raw ? JSON.parse(raw) : {};
            const messages = Array.isArray(body.messages) ? body.messages : [];
            const lastUser = [...messages].reverse().find((m) => m.role ***REMOVED***= 'user');
            const userText = typeof lastUser?.content ***REMOVED***= 'string'
                ? lastUser.content
                : (Array.isArray(lastUser?.content) ? JSON.stringify(lastUser.content).slice(0, 80) : '');

            const reply = `【finetuned-mock】收到你的消息：${userText || 'hello'}。这是联调回复。`;
            return json(res, 200, {
                id: `mock-ft-${Date.now()}`,
                type: 'message',
                role: 'assistant',
                model: 'wa-crm-finetuned-mock',
                content: [{ type: 'text', text: reply }],
                stop_reason: 'end_turn',
            });
        }

        return json(res, 404, { error: 'not found' });
    } catch (err) {
        return json(res, 500, { error: err.message });
    }
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`[mock-finetuned] listening on http://localhost:${PORT}`);
    console.log(`[mock-finetuned] health: http://localhost:${PORT}/health`);
    console.log('[mock-finetuned] endpoint: POST /v1/messages');
});

process.on('SIGINT', () => {
    server.close(() => process.exit(0));
});
process.on('SIGTERM', () => {
    server.close(() => process.exit(0));
});

