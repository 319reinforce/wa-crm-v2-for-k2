/**
 * WA CRM v2 Server — 模块化入口
 * 端口可配置：process.env.PORT (默认 3000)
 */
require('dotenv').config();
const express = require('express');
const path = require('path');
const net = require('net');
const db = require('../db');

const jsonBody = require('./middleware/jsonBody');
const timeout = require('./middleware/timeout');
const { requireAppAuth } = require('./middleware/appAuth');
const messagesRouter = require('./routes/messages');
const creatorsRouter = require('./routes/creators');
const statsRouter = require('./routes/stats');
const aiRouter = require('./routes/ai');
const sftRouter = require('./routes/sft');
const policyRouter = require('./routes/policy');
const auditRouter = require('./routes/audit');
const profileRouter = require('./routes/profile');
const eventsRouter = require('./routes/events');
const experienceRouter = require('./routes/experience');
const waRouter = require('./routes/wa');
const trainingRouter = require('./routes/training');
const { start: startWaWorker, stop: stopWaWorker, getProgress: getWaWorkerProgress } = require('./waWorker');
const { start: startWaService } = require('./services/waService');

const app = express();
const PORT = parseInt(process.env.PORT || '3000', 10);
const DISABLE_WA_SERVICE = process.env.DISABLE_WA_SERVICE ***REMOVED***= 'true';
const DISABLE_WA_WORKER = process.env.DISABLE_WA_WORKER ***REMOVED***= 'true';
const EVENT_BROADCAST_TOKEN = process.env.EVENT_BROADCAST_TOKEN;
const WA_SESSION_ID = String(process.env.WA_SESSION_ID || PORT).trim();
const WA_OWNER = process.env.WA_OWNER || 'Beau';

// ***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED*** SSE 实时广播 ***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED***
const sseClients = new Set();

// GET /api/events/subscribe — 前端 SSE 订阅
app.get('/api/events/subscribe', requireAppAuth, (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    sseClients.add(res);
    console.log(`[SSE] Client connected (total: ${sseClients.size})`);

    req.on('close', () => {
        sseClients.delete(res);
        console.log(`[SSE] Client disconnected (total: ${sseClients.size})`);
    });
});

// POST /api/events/broadcast — populate_db.cjs 调用，广播刷新事件
app.post('/api/events/broadcast', (req, res) => {
    if (!EVENT_BROADCAST_TOKEN) {
        return res.status(503).json({ ok: false, error: 'EVENT_BROADCAST_TOKEN not configured' });
    }
    const auth = req.headers.authorization || '';
    if (auth !***REMOVED*** `Bearer ${EVENT_BROADCAST_TOKEN}`) {
        return res.status(401).json({ ok: false, error: 'Unauthorized' });
    }
    const { event = 'creators-updated' } = req.body || {};
    const message = `event: ${event}\ndata: ${JSON.stringify({ refreshed: true })}\n\n`;
    sseClients.forEach(client => {
        try { client.write(message); } catch (e) { sseClients.delete(client); }
    });
    console.log(`[SSE] Broadcast "${event}" to ${sseClients.size} clients`);
    res.json({ ok: true, clients: sseClients.size });
});

// SSE 心跳：每 25 秒向所有客户端发送一次 ping，防止连接被中间件关闭
setInterval(() => {
    if (sseClients.size ***REMOVED***= 0) return;
    const ping = `: ping ${Date.now()}\n\n`;
    sseClients.forEach(client => {
        try { client.write(ping); } catch (e) { sseClients.delete(client); }
    });
}, 25000);

// ***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED*** 端口检测 ***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED***

/**
 * 检查端口是否可用
 * @param {number} port
 * @returns {Promise<boolean>}
 */
function isPortAvailable(port) {
    return new Promise((resolve) => {
        const server = net.createServer();
        server.once('error', (err) => {
            if (err.code ***REMOVED***= 'EADDRINUSE') {
                resolve(false);
            } else {
                resolve(false);
            }
        });
        server.once('listening', () => {
            server.close(() => resolve(true));
        });
        server.listen(port, '0.0.0.0');
    });
}

function isWaRuntimeError(error) {
    const text = `${error?.stack || ''}\n${error?.message || error || ''}`;
    return (
        text.includes('whatsapp-web.js') ||
        text.includes('puppeteer-core') ||
        text.includes('Execution context was destroyed') ||
        text.includes('Could not load response body for this request') ||
        text.includes('Protocol error (Runtime.callFunctionOn)')
    );
}

/**
 * 带重试的端口绑定
 * @param {object} app - Express app
 * @param {number} port
 * @param {number} retries - 重试次数
 * @returns {Promise<http.Server>}
 */
async function tryListenWithRetry(app, port, retries = 3) {
    for (let attempt = 1; attempt <= retries; attempt++) {
        const available = await isPortAvailable(port);
        if (available) {
            return app.listen(port, '0.0.0.0'); // 返回 HTTP Server
        }
        if (attempt < retries) {
            console.log(`[Port ${port}] 被占用，${attempt}秒后重试... (${attempt}/${retries})`);
            await new Promise(r => setTimeout(r, 1000));
        } else {
            throw new Error(`端口 ${port} 已被占用，请使用 PORT 环境变量指定其他端口，例如: PORT=3001 node server/index.cjs`);
        }
    }
}

// 中间件
app.use(jsonBody);
app.use(timeout);

// 静态文件（前端构建产物）
app.use(express.static(path.join(__dirname, '../public')));

// 基础健康检查保持公开，供进程探活和本地冒烟使用
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// 路由注册
// 注意：messages 路由需要在 creators 路由之前挂载
app.use('/api/creators/:id/messages', requireAppAuth, messagesRouter);
app.use('/api/creators', requireAppAuth, creatorsRouter);
app.use('/api', requireAppAuth, statsRouter);
app.use('/api', requireAppAuth, aiRouter);
app.use('/api', requireAppAuth, sftRouter);
app.use('/api', requireAppAuth, policyRouter);
app.use('/api', requireAppAuth, auditRouter);
app.use('/api', requireAppAuth, profileRouter);
app.use('/api/events', requireAppAuth, eventsRouter);
app.use('/api/experience', requireAppAuth, experienceRouter);
app.use('/api/wa', requireAppAuth, waRouter);
app.use('/api/training', requireAppAuth, trainingRouter);

// WA Worker 路由
app.get('/api/wa-worker/status', requireAppAuth, (req, res) => {
    res.json(getWaWorkerProgress());
});

// ***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED*** 启动服务器 ***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED***

(async () => {
    try {
        const server = await tryListenWithRetry(app, PORT, 3);
        console.log(`\n✅ WA CRM v2 Server (modular)`);
        console.log(`   Local:   http://localhost:${PORT}`);
        console.log(`   LAN:     http://192.168.1.51:${PORT}`);
        console.log(`   PID:     ${process.pid}`);
        console.log(`   MySQL:   ${process.env.DB_NAME || 'wa_crm_v2'}\n`);

        // graceful shutdown
        const shutdown = async (signal) => {
            console.log(`${signal} received, shutting down gracefully...`);
            stopWaWorker();
            server.close(async () => {
                await db.closeDb();
                console.log('Server closed.');
                process.exit(0);
            });
            // 强制退出，防止 WA Worker 卡住
            setTimeout(() => {
                console.log('Forcing exit after timeout.');
                process.exit(1);
            }, 10000);
        };

        process.on('SIGTERM', () => shutdown('SIGTERM'));
        process.on('SIGINT', () => shutdown('SIGINT'));
        process.on('unhandledRejection', (reason) => {
            if (isWaRuntimeError(reason)) {
                console.error('[WA Service] 捕获到非致命 unhandledRejection，已隔离 WA 模块:', reason?.message || reason);
                stopWaWorker();
                return;
            }
            console.error('[Process] Unhandled rejection:', reason);
        });
        process.on('uncaughtException', (error) => {
            if (isWaRuntimeError(error)) {
                console.error('[WA Service] 捕获到非致命 uncaughtException，已隔离 WA 模块:', error?.message || error);
                stopWaWorker();
                return;
            }
            console.error('[Process] Uncaught exception:', error);
            process.exit(1);
        });

        // 先启动 WhatsApp Service（端口确认可用后才初始化）
        if (!DISABLE_WA_SERVICE) {
            console.log(`[WA Service] 启动 WhatsApp Client (PORT=${PORT}, session=${WA_SESSION_ID}, owner=${WA_OWNER})...`);
            startWaService();
        } else {
            console.log('[WA Service] 已禁用（DISABLE_WA_SERVICE=true）');
        }

        // 再启动 WA Worker（后台运行，不阻塞 HTTP）
        if (!DISABLE_WA_WORKER) {
            startWaWorker({ syncHistory: true }).catch(err => {
                console.error('[WA Worker] 启动失败:', err.message);
            });
        } else {
            console.log('[WA Worker] 已禁用（DISABLE_WA_WORKER=true）');
        }
    } catch (err) {
        console.error(`\n❌ 服务器启动失败: ${err.message}`);
        process.exit(1);
    }
})();
