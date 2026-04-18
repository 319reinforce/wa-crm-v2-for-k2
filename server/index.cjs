/**
 * WA CRM v2 Server — 模块化入口
 * 端口可配置：process.env.PORT (默认 3000)
 */
require('dotenv').config();
const express = require('express');
const os = require('os');
const path = require('path');
const net = require('net');
const db = require('../db');

const jsonBody = require('./middleware/jsonBody');
const timeout = require('./middleware/timeout');
const {
    requireAppAuth,
    getPrimaryLoginTokenEntry,
    setAppAuthCookie,
    clearAppAuthCookie,
} = require('./middleware/appAuth');
const messagesRouter = require('./routes/messages');
const creatorsRouter = require('./routes/creators');
const statsRouter = require('./routes/stats');
const aiRouter = require('./routes/ai');
const sftRouter = require('./routes/sft');
const policyRouter = require('./routes/policy');
const auditRouter = require('./routes/audit');
const profileRouter = require('./routes/profile');
const profileAnalysisRouter = require('./routes/profileAnalysis');
const eventsRouter = require('./routes/events');
const experienceRouter = require('./routes/experience');
const strategyRouter = require('./routes/strategy');
const lifecycleRouter = require('./routes/lifecycle');
const waRouter = require('./routes/wa');
const trainingRouter = require('./routes/training');
const { listStatusSessions, readSessionStatus } = require('./services/waIpc');
const waSessionsMigration = require('../migrate-wa-sessions');
const legacySessionsBootstrap = require('./bootstrap/migrateLegacySessions');
const sessionRepository = require('./services/sessionRepository');
const { initRegistry } = require('./services/sessionRegistry');

const app = express();
const PORT = parseInt(process.env.PORT || '3000', 10);
const EVENT_BROADCAST_TOKEN = process.env.EVENT_BROADCAST_TOKEN;

function getConfiguredLogin() {
    return {
        username: String(process.env.APP_LOGIN_USERNAME || '').trim(),
        password: String(process.env.APP_LOGIN_PASSWORD || '').trim(),
    };
}

// ================== SSE 实时广播 ==================
const sseClients = new Set();

// GET /api/events/subscribe — 前端 SSE 订阅
// EventSource 通过同源 httpOnly cookie 复用认证态
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
// 该路由注册在全局 jsonBody 之前，因此显式挂载一次解析中间件
app.post('/api/events/broadcast', jsonBody, (req, res) => {
    if (!EVENT_BROADCAST_TOKEN) {
        return res.status(503).json({ ok: false, error: 'EVENT_BROADCAST_TOKEN not configured' });
    }
    const auth = req.headers.authorization || '';
    if (auth !== `Bearer ${EVENT_BROADCAST_TOKEN}`) {
        return res.status(401).json({ ok: false, error: 'Unauthorized' });
    }
    const ALLOWED_EVENTS = ['creators-updated', 'refresh', 'sft-updated', 'events-updated'];
    const rawEvent = (req.body || {}).event;
    const event = ALLOWED_EVENTS.includes(rawEvent) ? rawEvent : 'creators-updated';
    const message = `event: ${event}\ndata: ${JSON.stringify({ refreshed: true })}\n\n`;
    sseClients.forEach(client => {
        try { client.write(message); } catch (e) { sseClients.delete(client); }
    });
    console.log(`[SSE] Broadcast "${event}" to ${sseClients.size} clients`);
    res.json({ ok: true, clients: sseClients.size });
});

// SSE 心跳：每 25 秒向所有客户端发送一次 ping，防止连接被中间件关闭
setInterval(() => {
    if (sseClients.size === 0) return;
    const ping = `: ping ${Date.now()}\n\n`;
    sseClients.forEach(client => {
        try { client.write(ping); } catch (e) { sseClients.delete(client); }
    });
}, 25000);

// ================== 端口检测 ==================

/**
 * 检查端口是否可用
 * @param {number} port
 * @returns {Promise<boolean>}
 */
function isPortAvailable(port) {
    return new Promise((resolve) => {
        const server = net.createServer();
        server.once('error', (err) => {
            if (err.code === 'EADDRINUSE') {
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

function getLanUrls(port) {
    const interfaces = os.networkInterfaces();
    const urls = [];
    for (const addresses of Object.values(interfaces)) {
        for (const address of addresses || []) {
            if (!address || address.family !== 'IPv4' || address.internal) continue;
            urls.push(`http://${address.address}:${port}`);
        }
    }
    return [...new Set(urls)];
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

app.post('/api/auth/login', (req, res) => {
    const { username: expectedUsername, password: expectedPassword } = getConfiguredLogin();
    const loginTokenEntry = getPrimaryLoginTokenEntry();
    const issuedToken = loginTokenEntry?.token || '';
    if (!expectedUsername || !expectedPassword || !issuedToken) {
        return res.status(503).json({ error: 'Login auth not configured' });
    }

    const username = String(req.body?.username || '').trim();
    const password = String(req.body?.password || '');
    if (username !== expectedUsername || password !== expectedPassword) {
        return res.status(401).json({ error: 'Invalid username or password' });
    }

    setAppAuthCookie(res, issuedToken);
    res.json({
        ok: true,
        authenticated: true,
        username: expectedUsername,
        token: issuedToken,
    });
});

// 轻量认证探针：前端用它判断当前 token 是否有效
app.get('/api/auth/session', requireAppAuth, (req, res) => {
    setAppAuthCookie(res, req.auth?.token || '');
    res.json({
        ok: true,
        authenticated: true,
        username: req.auth?.username || 'authorized',
        role: req.auth?.role || 'admin',
        owner: req.auth?.owner || null,
        owner_locked: !!req.auth?.owner_locked,
        session_id: req.auth?.session_id || null,
    });
});

app.post('/api/auth/logout', (req, res) => {
    clearAppAuthCookie(res);
    res.json({ ok: true, authenticated: false });
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
app.use('/api', requireAppAuth, profileAnalysisRouter);
app.use('/api/events', requireAppAuth, eventsRouter);
app.use('/api/experience', requireAppAuth, experienceRouter);
app.use('/api', requireAppAuth, strategyRouter);
app.use('/api', requireAppAuth, lifecycleRouter);
app.use('/api/wa', requireAppAuth, waRouter);
app.use('/api/training', requireAppAuth, trainingRouter);

// WA Agents 健康检查(CI/CD Docker healthcheck 使用,公开端点)
// 200 = DB 连通 + Registry 启用时所有 desired=running 的 agent 至少有一个 ready
// 503 = 关键条件不满足;Registry 未启用时只要 DB 连通就返回 200
app.get('/api/wa/agents/health', async (req, res) => {
    try {
        await require('./services/sessionRepository').listSessions(); // DB probe
    } catch (err) {
        return res.status(503).json({ ok: false, error: 'db unreachable', detail: err.message });
    }

    const { getRegistry } = require('./services/sessionRegistry');
    const registry = getRegistry();
    if (!registry || !registry.isEnabled()) {
        return res.json({ ok: true, registry_enabled: false, agents: [], summary: { total: 0, ready: 0, stale: 0 } });
    }

    const agents = registry.listAgents();
    const now = Date.now();
    const withAge = agents.map((a) => ({
        session_id: a.session_id,
        owner: a.owner,
        pid: a.pid,
        state: a.state,
        ready: a.ready,
        last_heartbeat_ms_ago: a.last_heartbeat_ms_ago,
    }));
    const stale = withAge.filter((a) => a.last_heartbeat_ms_ago != null && a.last_heartbeat_ms_ago > 30000);
    const ready = withAge.filter((a) => a.ready && a.state === 'ready');

    const summary = {
        total: withAge.length,
        ready: ready.length,
        stale: stale.length,
    };
    const healthy = ready.length > 0 || withAge.length === 0;
    res.status(healthy ? 200 : 503).json({
        ok: healthy,
        registry_enabled: true,
        agents: withAge,
        summary,
    });
});

// WA Worker 路由
// 聚合所有 agent 进程的 worker 状态,Registry 启用时优先读内存态,
// 否则回退到 .wa_ipc/status/*.json
// 为兼容 WorkerStatusBar 保留单 session 形状:owner-scoped token 只返回自己的,
// admin token 返回第一个 ready 的 session(或第一个 session)
app.get('/api/wa-worker/status', requireAppAuth, (req, res) => {
    const lockedOwner = req.auth?.owner || null;

    // 优先从 Registry 读(Node IPC 路径)
    const { getRegistry } = require('./services/sessionRegistry');
    const registry = getRegistry();
    if (registry?.isEnabled()) {
        const agents = registry.listAgents();
        const matchOwner = lockedOwner
            ? agents.find((a) => a.owner === lockedOwner)
            : null;
        const primary = matchOwner || agents.find((a) => a.ready) || agents[0] || null;
        if (primary) {
            return res.json({
                ...(primary.worker || {}),
                session_id: primary.session_id,
                owner: primary.owner || null,
                clientReady: !!primary.ready,
                clientError: primary.last_error || null,
                last_heartbeat_at: primary.last_heartbeat_at || null,
            });
        }
    }

    // Fallback:文件 IPC status(PM2 crawler 路径)
    const sessions = listStatusSessions()
        .map((sessionId) => readSessionStatus(sessionId))
        .filter(Boolean);

    const matchOwner = lockedOwner
        ? sessions.find((s) => (s.owner || s.configured_owner) === lockedOwner)
        : null;
    const primary = matchOwner
        || sessions.find((s) => s.ready)
        || sessions[0]
        || null;

    if (!primary) {
        res.json({ phase: 'idle', clientReady: false, clientError: null });
        return;
    }
    res.json({
        ...(primary.worker || {}),
        session_id: primary.session_id,
        owner: primary.owner || primary.configured_owner || null,
        clientReady: !!primary.ready,
        clientError: primary.error || null,
        last_heartbeat_at: primary.updated_at || null,
    });
});

// ================== 启动服务器 ==================

(async () => {
    try {
        // 1) 运行 wa_sessions schema 迁移(幂等)
        try {
            await waSessionsMigration.run({ silent: true });
            console.log('[Startup] wa_sessions schema migration done');
        } catch (err) {
            console.error('[Startup] wa_sessions schema migration failed:', err.message);
            throw err;
        }

        // 2) 一次性迁移旧 session 配置(ecosystem / env / auth dirs)
        try {
            await legacySessionsBootstrap.run();
        } catch (err) {
            console.warn('[Startup] legacy sessions bootstrap error:', err.message);
        }

        // 3) 预热 sessionRepository 缓存,启动后台刷新循环
        try {
            await sessionRepository.warmCache();
            sessionRepository.startCacheRefreshLoop();
            console.log(`[Startup] sessionRepository cache warmed (${sessionRepository.listSessionsCached().length} sessions)`);
        } catch (err) {
            console.error('[Startup] sessionRepository warm cache failed:', err.message);
            throw err;
        }

        // 4) 初始化 SessionRegistry(feature-flag 默认关)
        //    WA_AGENTS_ENABLED=true 时才会 fork agent 子进程,避免和 PM2 crawler 双活
        const registry = initRegistry();
        if (registry.isEnabled()) {
            try {
                await registry.bootstrap();
                console.log('[Startup] SessionRegistry bootstrapped');
            } catch (err) {
                console.error('[Startup] SessionRegistry bootstrap failed:', err.message);
                // 不 throw:registry 失败不应阻挡 API 起来
            }
        } else {
            console.log('[Startup] SessionRegistry disabled (set WA_AGENTS_ENABLED=true to enable)');
        }

        const server = await tryListenWithRetry(app, PORT, 3);
        const lanUrls = getLanUrls(PORT);
        console.log(`\n✅ WA CRM v2 Server (modular)`);
        console.log(`   Local:   http://localhost:${PORT}`);
        if (lanUrls.length > 0) {
            console.log(`   LAN:     ${lanUrls.join(', ')}`);
        } else {
            console.log(`   LAN:     unavailable`);
        }
        console.log(`   PID:     ${process.pid}`);
        console.log(`   MySQL:   ${process.env.DB_NAME || 'wa_crm_v2'}\n`);

        // graceful shutdown
        const shutdown = async (signal) => {
            console.log(`${signal} received, shutting down gracefully...`);
            sessionRepository.stopCacheRefreshLoop();
            try {
                await registry.shutdown();
            } catch (err) {
                console.error('[Shutdown] registry.shutdown error:', err.message);
            }
            server.close(async () => {
                await db.closeDb();
                console.log('Server closed.');
                process.exit(0);
            });
            setTimeout(() => {
                console.log('Forcing exit after timeout.');
                process.exit(1);
            }, 10000);
        };

        process.on('SIGTERM', () => shutdown('SIGTERM'));
        process.on('SIGINT', () => shutdown('SIGINT'));
        process.on('unhandledRejection', (reason) => {
            console.error('[Process] Unhandled rejection:', reason);
        });
        process.on('uncaughtException', (error) => {
            console.error('[Process] Uncaught exception:', error);
            process.exit(1);
        });
    } catch (err) {
        console.error(`\n❌ 服务器启动失败: ${err.message}`);
        process.exit(1);
    }
})();
