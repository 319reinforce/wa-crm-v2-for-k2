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
const bcrypt = require('bcryptjs');
const userSessionRepo = require('./services/userSessionRepo');
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
const waSessionsRouter = require('./routes/waSessions');
const trainingRouter = require('./routes/training');
const usersRouter = require('./routes/users');
const operatorRosterRouter = require('./routes/operatorRoster');
const aiProvidersRouter = require('./routes/aiProviders');
const { listStatusSessions, readSessionStatus } = require('./services/waIpc');
const waSessionsMigration = require('../migrate-wa-sessions');
const usersAuthMigration = require('../migrate-users-auth');
const auditLogUserFieldsMigration = require('../migrate-audit-log-user-fields');
const waMessageIdMigration = require('../migrate-wa-message-id');
const waMessagesMediaMigration = require('../migrate-wa-messages-media');
const mediaLifecycleMigration = require('../migrate-media-lifecycle');
const waDriverMigration = require('../migrate-wa-sessions-driver');
const aiProviderConfigMigration = require('../migrate-ai-provider-config');
const sessionCleaner = require('./services/sessionCleaner');
const legacySessionsBootstrap = require('./bootstrap/migrateLegacySessions');
const sessionRepository = require('./services/sessionRepository');
const { initRegistry } = require('./services/sessionRegistry');
const sseBus = require('./events/sseBus');
const { perfLog, perfLogEnabled } = require('./services/perfLog');
const { shutdownIpc } = require('./services/waIpc');

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
// 底层 bus 从 sseBus 模块拿,这里只负责 HTTP 侧订阅和 broadcast 接口

// GET /api/events/subscribe — 前端 SSE 订阅
// EventSource 通过同源 httpOnly cookie 复用认证态
app.get('/api/events/subscribe', requireAppAuth, (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    // HTTP/2 禁止 connection-specific 头（RFC 9113 §8.2.2），否则走 HTTP/2 反代会触发
    // 客户端 ERR_HTTP2_PROTOCOL_ERROR。HTTP/1.1 下 Node 默认已是 keep-alive。
    if (req.httpVersionMajor < 2) {
        res.setHeader('Connection', 'keep-alive');
    }
    // 显式禁压缩：即便上游误启 gzip/br 也被强制 identity，避免 SSE 被缓冲
    res.setHeader('Content-Encoding', 'identity');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    sseBus.addClient(res);
    console.log(`[SSE] Client connected (total: ${sseBus.count()})`);

    req.on('close', () => {
        console.log(`[SSE] Client disconnected (total: ${sseBus.count()})`);
    });
});

// POST /api/events/broadcast — populate_db.cjs 调用，广播刷新事件
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
    const remaining = sseBus.broadcast(event, { refreshed: true });
    console.log(`[SSE] Broadcast "${event}" to ${remaining} clients`);
    res.json({ ok: true, clients: remaining });
});

// SSE 心跳:每 25s 防中间件关闭
setInterval(() => sseBus.ping(), 25000);

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
// compression: 让 origin 自己回 gzip，避免 Cloudflare 再做一次 Brotli 压缩
// （动态 API 无法边缘缓存，Cloudflare 每次都要重新压缩 350KB 响应，占 TTFB 500-900ms）
// origin 回 gzip 后 Cloudflare 默认会透传已压缩响应，不再重编
//
// filter：SSE（text/event-stream）必须排除，否则响应会被缓冲，HTTP/2 流会异常。
// 不再依赖路由注册顺序，任何后续挪动路由都不会让 SSE 被误压缩。
const _compression = require('compression');
app.use(_compression({
    threshold: 1024,
    filter: (req, res) => {
        if (req.headers.accept && req.headers.accept.includes('text/event-stream')) return false;
        const ct = res.getHeader('Content-Type');
        if (ct && String(ct).includes('text/event-stream')) return false;
        const cc = res.getHeader('Cache-Control');
        if (cc && String(cc).includes('no-transform')) return false;
        return _compression.filter(req, res);
    },
}));
app.use(jsonBody);
app.use(timeout);

// Phase 0 perf telemetry:只在 PERF_LOG_ENABLED=true 时挂载，生产默认零开销
if (perfLogEnabled()) {
    app.use((req, res, next) => {
        if (!req.path || !req.path.startsWith('/api/')) return next();
        const startedAt = Date.now();
        res.on('finish', () => {
            perfLog('rest_response', {
                method: req.method,
                path: req.path,
                status: res.statusCode,
                durationMs: Date.now() - startedAt,
            });
        });
        next();
    });
}

// 静态文件（前端构建产物）
app.use(express.static(path.join(__dirname, '../public')));

// 基础健康检查保持公开，供进程探活和本地冒烟使用
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// WA Agents 健康检查(Docker healthcheck + CI/CD 监控用,公开端点)
// 必须在所有 app.use('/api', requireAppAuth, ...) 挂载之前注册,
// 否则会被 /api 的 requireAppAuth 前缀中间件拦截返回 401
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
    const summary = { total: withAge.length, ready: ready.length, stale: stale.length };
    const healthy = ready.length > 0 || withAge.length === 0;
    res.status(healthy ? 200 : 503).json({
        ok: healthy,
        registry_enabled: true,
        agents: withAge,
        summary,
    });
});

// POST /api/auth/login — 纯 DB 鉴权(已移除 env 密码 fallback)
// 成功签发 per-user session token(64 hex 字符),写入 user_sessions 表并 set cookie
app.post('/api/auth/login', async (req, res) => {
    const username = String(req.body?.username || '').trim();
    const password = String(req.body?.password || '');
    if (!username || !password) {
        return res.status(400).json({ error: 'username and password are required' });
    }

    try {
        const user = await userSessionRepo.findActiveUserByUsername(username);
        if (!user || user.disabled) {
            return res.status(401).json({ error: 'Invalid username or password' });
        }
        if (userSessionRepo.isUserLocked(user)) {
            return res.status(423).json({ error: 'Account locked, try again later' });
        }

        const passwordOk = await bcrypt.compare(password, user.password_hash);
        if (!passwordOk) {
            await userSessionRepo.recordLoginFailure(user.id);
            return res.status(401).json({ error: 'Invalid username or password' });
        }

        await userSessionRepo.resetLoginFailures(user.id);
        const { token } = await userSessionRepo.createSession({
            userId: user.id,
            ipAddress: req.ip || req.connection?.remoteAddress || null,
            userAgent: String(req.get('User-Agent') || '').slice(0, 512),
        });
        setAppAuthCookie(res, token);
        return res.json({
            ok: true,
            authenticated: true,
            username: user.username,
            role: user.role,
            owner: user.role === 'operator' ? user.operator_name : null,
            owner_locked: user.role === 'operator',
            user_id: user.id,
            token,
        });
    } catch (err) {
        console.error('[auth/login] error:', err);
        return res.status(500).json({ error: 'Login failed' });
    }
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
        user_id: req.auth?.user_id || null,
        source: req.auth?.source || null,
    });
});

app.post('/api/auth/logout', async (req, res) => {
    const token = req.auth?.token
        || (String(req.headers.authorization || '').startsWith('Bearer ')
            ? String(req.headers.authorization).slice(7).trim()
            : null);
    if (token) {
        try { await userSessionRepo.revokeSession(token); } catch (_) { /* best-effort */ }
    }
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
app.use('/api/wa/sessions', requireAppAuth, waSessionsRouter);
app.use('/api/wa', requireAppAuth, waRouter);

// WA metrics endpoint (no auth — for internal Prometheus scraping)
app.use('/metrics/wa', (req, res, next) => {
    req.user = { username: 'metrics', role: 'admin' };
    next();
});
app.get('/metrics/wa', (req, res) => {
    res.set('Content-Type', 'text/plain; charset=utf-8');
    res.send(require('./services/waMetrics').prometheusText());
});

app.use('/api/training', requireAppAuth, trainingRouter);
app.use('/api/users', requireAppAuth, usersRouter);
app.use('/api/operator-roster', requireAppAuth, operatorRosterRouter);
app.use('/api/admin', aiProvidersRouter);

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

        // 0.1) wa_sessions driver column migration
        try {
            await waDriverMigration.run({ silent: true });
            console.log('[Startup] wa_driver schema migration done');
        } catch (err) {
            console.error('[Startup] wa_driver schema migration failed:', err.message);
            throw err;
        }

        // 1.1) users + user_sessions 迁移 + audit_log 扩列 + wa_messages 媒体扩列(幂等)
        try {
            await usersAuthMigration.run({ silent: true });
            await auditLogUserFieldsMigration.run({ silent: true });
            await waMessagesMediaMigration.run({ silent: true });
            console.log('[Startup] users/auth + media migration done');
        } catch (err) {
            console.error('[Startup] users/auth + media migration failed:', err.message);
            throw err;
        }

        // 1.2) wa_messages 增加 wa_message_id 幂等键列 + UNIQUE 索引
        try {
            await waMessageIdMigration.run({ silent: true });
            console.log('[Startup] wa_message_id migration done');
        } catch (err) {
            console.error('[Startup] wa_message_id migration failed:', err.message);
            throw err;
        }

        // 1.3) 媒体生命周期:media_assets 扩列 + cleanup_jobs / cleanup_exemptions 建表
        try {
            await mediaLifecycleMigration.run({ silent: true });
            console.log('[Startup] media-lifecycle migration done');
        } catch (err) {
            console.error('[Startup] media-lifecycle migration failed:', err.message);
            throw err;
        }

        // 1.4) AI provider 配置中心 (Phase 0 地基: 建 ai_provider_configs / ai_usage_logs / ai_usage_daily)
        try {
            await aiProviderConfigMigration.run({ silent: true });
            console.log('[Startup] ai-provider-config migration done');
        } catch (err) {
            console.error('[Startup] ai-provider-config migration failed:', err.message);
            throw err;
        }

        // 1.5) 启动 session 清理器
        sessionCleaner.start();

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
            try { shutdownIpc(); } catch (_) {}
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
