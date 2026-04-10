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

// ***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED*** SSE 实时广播 ***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED***
const sseClients = new Set();

// GET /api/events/subscribe — 前端 SSE 订阅
app.get('/api/events/subscribe', (req, res) => {
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

/**
 * 带重试的端口绑定
 * @param {object} app - Express app
 * @param {number} port
 * @param {number} retries - 重试次数
 * @returns {Promise<http.Server>}
 */
async function tryListenWithRetry(app, port, retries = 3) {
    const lastError = await new Promise(async (resolve) => {
        for (let attempt = 1; attempt <= retries; attempt++) {
            const available = await isPortAvailable(port);
            if (available) {
                const server = app.listen(port, '0.0.0.0');
                return resolve(null); // 成功，无错误
            }

            if (attempt < retries) {
                console.log(`[Port ${port}] 被占用，${attempt}秒后重试... (${attempt}/${retries})`);
                await new Promise(r => setTimeout(r, 1000));
            } else {
                const error = new Error(`端口 ${port} 已被占用，请使用 PORT 环境变量指定其他端口，例如: PORT=3001 node server/index.cjs`);
                error.code = 'EADDRINUSE';
                resolve(error);
            }
        }
    });

    if (lastError) throw lastError;
    return app;
}

// 中间件
app.use(jsonBody);
app.use(timeout);

// 静态文件（前端构建产物）
app.use(express.static(path.join(__dirname, '../public')));

// 路由注册
// 注意：messages 路由需要在 creators 路由之前挂载
app.use('/api/creators/:id/messages', messagesRouter);
app.use('/api/creators', creatorsRouter);
app.use('/api', statsRouter);
app.use('/api', aiRouter);
app.use('/api', sftRouter);
app.use('/api', policyRouter);
app.use('/api', auditRouter);
app.use('/api', profileRouter);
app.use('/api/events', eventsRouter);
app.use('/api/experience', experienceRouter);
app.use('/api/wa', waRouter);
app.use('/api/training', trainingRouter);

// WA Worker 路由
app.get('/api/wa-worker/status', (req, res) => {
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

        // 先启动 WhatsApp Service（端口确认可用后才初始化）
        console.log(`[WA Service] 启动 WhatsApp Client (PORT=${PORT})...`);
        startWaService();

        // 再启动 WA Worker（后台运行，不阻塞 HTTP）
        startWaWorker({ syncHistory: true }).catch(err => {
            console.error('[WA Worker] 启动失败:', err.message);
        });
    } catch (err) {
        console.error(`\n❌ 服务器启动失败: ${err.message}`);
        process.exit(1);
    }
})();
