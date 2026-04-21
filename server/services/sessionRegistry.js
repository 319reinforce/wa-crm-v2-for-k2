/**
 * SessionRegistry — agent 子进程 supervisor
 *
 * 职责:
 *   - 根据 wa_sessions 表(desired_state='running')动态 fork / respawn agent
 *   - 双向 IPC:向 agent 发命令 + 接 agent 事件(qr/ready/heartbeat/...)
 *   - 定期 reconciliation:对齐 desired vs runtime,处理 crash/stale
 *   - 命令超时、指数退避重启、stagger spawn、优雅关停
 *
 * NOTE: 本模块仅在 `WA_AGENTS_ENABLED=true` 时真正 fork 子进程。
 *       默认关闭,留给运维在切流时显式开启,避免和 PM2 crawler 双活。
 */
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { fork } = require('child_process');
const { EventEmitter } = require('events');

const sessionRepository = require('./sessionRepository');
const sseBus = require('../events/sseBus');
const { perfLog } = require('./perfLog');
const {
    CMD_SHUTDOWN,
    TYPE_CMD_RESULT,
    TYPE_EVENT,
    EVT_QR,
    EVT_READY,
    EVT_ERROR,
    EVT_DISCONNECTED,
    EVT_HEARTBEAT,
    EVT_WA_MESSAGE,
    makeCommand,
} = require('../agent/ipcProtocol');

const AGENT_SCRIPT = path.join(__dirname, '../agent/waAgent.js');
const DEFAULT_LOG_DIR = path.join(__dirname, '../../logs/agents');

const STAGGER_SPAWN_MS = 500;
const RECONCILIATION_INTERVAL_MS = 5000;
const HEARTBEAT_STALE_MS = 30 * 1000;      // >30s 无心跳 → stale
const HEARTBEAT_FORCE_RESTART_MS = 60 * 1000; // >60s 无心跳 → 强制重启
const COMMAND_TIMEOUT_MS = 30 * 1000;
const AUDIT_COMMAND_TIMEOUT_MS = 60 * 1000;
const SHUTDOWN_GRACE_MS = 8 * 1000;
const RESTART_BASE_DELAY_MS = 1000;
const RESTART_MAX_DELAY_MS = 30 * 1000;

function generateCommandId() {
    return `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
}

function now() {
    return Date.now();
}

class SessionRegistry {
    constructor({ repository = sessionRepository, logDir = DEFAULT_LOG_DIR, enabled = false } = {}) {
        this.repo = repository;
        this.logDir = logDir;
        this.enabled = enabled;
        this.emitter = new EventEmitter();

        // sessionId -> { child, state, lastHeartbeat, ready, qr, pendingCommands, restartAttempts, nextRestartAt, desiredShutdown, logStream }
        this.agents = new Map();
        this.spawnQueue = [];
        this.spawnInProgress = false;
        this.reconcilerTimer = null;
        this.shuttingDown = false;

        if (enabled) {
            try { fs.mkdirSync(logDir, { recursive: true }); } catch (_) {}
        }
    }

    // ================== lifecycle ==================

    async bootstrap() {
        if (!this.enabled) {
            console.log('[SessionRegistry] disabled (WA_AGENTS_ENABLED != true); skipping agent spawn');
            return;
        }
        const sessions = await this.repo.listSessions();
        const running = sessions.filter((s) => s.desired_state === 'running');
        console.log(`[SessionRegistry] bootstrap: ${running.length} running session(s)`);
        for (const session of running) {
            this._enqueueSpawn(session.session_id);
        }
        this._startReconciler();
        this._processSpawnQueue().catch((err) => {
            console.error('[SessionRegistry] initial spawn queue failed:', err.message);
        });
    }

    async shutdown() {
        if (this.shuttingDown) return;
        this.shuttingDown = true;
        if (this.reconcilerTimer) {
            clearInterval(this.reconcilerTimer);
            this.reconcilerTimer = null;
        }
        const sessionIds = Array.from(this.agents.keys());
        console.log(`[SessionRegistry] shutdown: stopping ${sessionIds.length} agent(s)`);
        await Promise.all(sessionIds.map((sid) => this.stopAgent(sid, { planned: true }).catch(() => {})));
    }

    // ================== spawn / stop ==================

    _enqueueSpawn(sessionId) {
        if (this.spawnQueue.includes(sessionId)) return;
        if (this.agents.has(sessionId)) return;
        this.spawnQueue.push(sessionId);
    }

    async _processSpawnQueue() {
        if (this.spawnInProgress) return;
        this.spawnInProgress = true;
        try {
            while (this.spawnQueue.length > 0) {
                const sessionId = this.spawnQueue.shift();
                try {
                    await this.spawnAgent(sessionId);
                } catch (err) {
                    console.error(`[SessionRegistry] spawn ${sessionId} failed:`, err.message);
                }
                if (this.spawnQueue.length > 0) {
                    await new Promise((resolve) => setTimeout(resolve, STAGGER_SPAWN_MS));
                }
            }
        } finally {
            this.spawnInProgress = false;
        }
    }

    async spawnAgent(sessionId) {
        if (!this.enabled) return null;
        if (this.agents.has(sessionId)) return this.agents.get(sessionId);

        const sessionRow = await this.repo.getSessionBySessionId(sessionId);
        if (!sessionRow) {
            throw new Error(`session not found: ${sessionId}`);
        }
        if (sessionRow.desired_state !== 'running') {
            console.warn(`[SessionRegistry] skip spawn ${sessionId}: desired_state=${sessionRow.desired_state}`);
            return null;
        }

        const logPath = path.join(this.logDir, `${sessionId}.log`);
        const logStream = fs.createWriteStream(logPath, { flags: 'a' });

        const child = fork(AGENT_SCRIPT, [], {
            env: {
                ...process.env,
                WA_SESSION_ID: sessionRow.session_id,
                WA_OWNER: sessionRow.owner,
            },
            stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
        });

        const prefixLine = (line) => `[${new Date().toISOString()}] ${line}\n`;
        child.stdout.on('data', (buf) => {
            const text = buf.toString();
            for (const line of text.split('\n')) {
                if (line) logStream.write(prefixLine(line));
            }
        });
        child.stderr.on('data', (buf) => {
            const text = buf.toString();
            for (const line of text.split('\n')) {
                if (line) logStream.write(prefixLine(`STDERR ${line}`));
            }
        });

        const agent = {
            sessionId,
            owner: sessionRow.owner,
            child,
            pid: child.pid,
            state: 'starting',
            ready: false,
            qrValue: null,
            qrRefreshCount: 0,
            lastQrAt: null,
            accountPhone: null,
            accountPushname: null,
            lastHeartbeat: 0,
            lastError: null,
            workerProgress: null,
            pendingCommands: new Map(),
            restartAttempts: 0,
            nextRestartDelayMs: RESTART_BASE_DELAY_MS,
            nextRestartAt: 0,
            desiredShutdown: false,
            logStream,
            spawnedAt: now(),
        };
        this.agents.set(sessionId, agent);

        child.on('message', (msg) => this._handleAgentMessage(sessionId, msg));
        child.on('exit', (code, signal) => this._handleAgentExit(sessionId, code, signal));
        child.on('error', (err) => {
            console.error(`[SessionRegistry:${sessionId}] child error:`, err.message);
        });

        // 清空上一轮崩溃残留的 error/exit_* 字段,避免 UI 一直显示旧错误
        await this.repo.setRuntimeState(sessionId, {
            state: 'starting',
            pid: child.pid,
            error: null,
            exit_code: null,
            exit_signal: null,
        });
        console.log(`[SessionRegistry] spawned ${sessionId} (pid=${child.pid})`);
        this.emitter.emit('agent-spawned', { sessionId, pid: child.pid });
        return agent;
    }

    async stopAgent(sessionId, { planned = true } = {}) {
        const agent = this.agents.get(sessionId);
        if (!agent) return;
        agent.desiredShutdown = planned;

        // 先尝试 graceful IPC shutdown
        try {
            const id = generateCommandId();
            agent.child.send(makeCommand(id, CMD_SHUTDOWN, {}));
        } catch (_) {}

        // 超时后 SIGKILL
        const killTimer = setTimeout(() => {
            if (agent.child && !agent.child.killed) {
                try { agent.child.kill('SIGKILL'); } catch (_) {}
            }
        }, SHUTDOWN_GRACE_MS);

        await new Promise((resolve) => {
            if (!agent.child || agent.child.killed || agent.child.exitCode !== null) {
                resolve();
                return;
            }
            agent.child.once('exit', () => {
                clearTimeout(killTimer);
                resolve();
            });
        });
        clearTimeout(killTimer);
    }

    async restartAgent(sessionId) {
        await this.stopAgent(sessionId, { planned: true });
        // stopAgent 会触发 exit handler,如果 desired=running,handler 会自动重 spawn
        // 但为了确定性,这里直接再 spawn 一次(如果被 handler 抢先也没关系,重复 spawn 会 no-op)
        this._enqueueSpawn(sessionId);
        await this._processSpawnQueue();
    }

    // ================== IPC handlers ==================

    _handleAgentMessage(sessionId, msg) {
        const agent = this.agents.get(sessionId);
        if (!agent || !msg || typeof msg !== 'object') return;

        if (msg.type === TYPE_CMD_RESULT) {
            const pending = agent.pendingCommands.get(msg.id);
            if (pending) {
                clearTimeout(pending.timer);
                agent.pendingCommands.delete(msg.id);
                pending.resolve({ ...msg, id: undefined, type: undefined });
            }
            return;
        }

        if (msg.type === TYPE_EVENT) {
            agent.lastHeartbeat = now();
            switch (msg.kind) {
                case EVT_QR:
                    agent.qrValue = msg.qr_value || null;
                    agent.qrRefreshCount = msg.qr_refresh_count || 0;
                    agent.lastQrAt = msg.last_qr_at || null;
                    agent.state = 'starting';
                    break;
                case EVT_READY:
                    agent.ready = true;
                    agent.state = 'ready';
                    agent.accountPhone = msg.account_phone || null;
                    agent.accountPushname = msg.account_pushname || null;
                    agent.qrValue = null;
                    agent.restartAttempts = 0;
                    agent.nextRestartDelayMs = RESTART_BASE_DELAY_MS;
                    this.repo.setRuntimeState(sessionId, {
                        state: 'ready',
                        ready_at: new Date(),
                        account_phone: msg.account_phone || null,
                        account_pushname: msg.account_pushname || null,
                        error: null,
                    }).catch(() => {});
                    break;
                case EVT_HEARTBEAT:
                    agent.workerProgress = msg.worker || null;
                    agent.ready = !!msg.ready;
                    if (msg.ready) {
                        agent.state = 'ready';
                        agent.accountPhone = msg.account_phone || agent.accountPhone;
                        agent.accountPushname = msg.account_pushname || agent.accountPushname;
                    }
                    this.repo.setRuntimeState(sessionId, {
                        phase: msg.worker?.phase || null,
                        heartbeat_at: new Date(agent.lastHeartbeat),
                    }).catch(() => {});
                    break;
                case EVT_ERROR:
                    agent.lastError = msg.message || null;
                    this.repo.setRuntimeState(sessionId, {
                        error: msg.message || null,
                    }).catch(() => {});
                    break;
                case EVT_DISCONNECTED:
                    agent.ready = false;
                    agent.state = 'crashed';
                    agent.lastError = msg.reason || 'disconnected';
                    this.repo.setRuntimeState(sessionId, {
                        state: 'crashed',
                        error: msg.reason || null,
                    }).catch(() => {});
                    break;
                case EVT_WA_MESSAGE:
                    // 不入 Registry state,只转发给 SSE(实际消息持久化在 agent 侧 worker 里)
                    perfLog('agent_msg_ipc_recv', {
                        sessionId,
                        waMsgId: msg.message_id || null,
                        role: msg.role || null,
                        wahTimestamp: msg.timestamp || null,
                    });
                    sseBus.broadcast('wa-message', {
                        session_id: sessionId,
                        owner: agent.owner,
                        chat_id: msg.chat_id || null,
                        from_phone: msg.from_phone || null,
                        to_phone: msg.to_phone || null,
                        role: msg.role || null,
                        text: msg.text || '',
                        timestamp: msg.timestamp || Date.now(),
                        message_id: msg.message_id || null,
                    });
                    break;
                default:
                    // 其它事件(未来扩展用)透传给外部订阅者
                    break;
            }

            // 状态类事件对外广播(前端 WorkerStatusBar 可替代 5s 轮询)
            if (msg.kind === EVT_READY || msg.kind === EVT_DISCONNECTED || msg.kind === EVT_QR || msg.kind === EVT_ERROR) {
                sseBus.broadcast('wa-session-status', {
                    session_id: sessionId,
                    owner: agent.owner,
                    kind: msg.kind,
                    ready: agent.ready,
                    has_qr: !!agent.qrValue,
                    account_phone: agent.accountPhone,
                    account_pushname: agent.accountPushname,
                    last_error: agent.lastError,
                });
            }

            this.emitter.emit('agent-event', { sessionId, kind: msg.kind, payload: msg });
        }
    }

    _handleAgentExit(sessionId, code, signal) {
        const agent = this.agents.get(sessionId);
        if (!agent) return;

        console.log(`[SessionRegistry] agent ${sessionId} exited code=${code} signal=${signal} planned=${agent.desiredShutdown}`);
        try { agent.logStream.end(`[${new Date().toISOString()}] [registry] exit code=${code} signal=${signal}\n`); } catch (_) {}

        // 清理 pending commands
        for (const [cmdId, pending] of agent.pendingCommands) {
            clearTimeout(pending.timer);
            pending.reject(new Error('agent exited'));
            agent.pendingCommands.delete(cmdId);
        }

        this.agents.delete(sessionId);

        this.repo.setRuntimeState(sessionId, {
            state: agent.desiredShutdown ? 'stopped' : 'crashed',
            pid: null,
            exit_code: typeof code === 'number' ? code : null,
            exit_signal: signal || null,
        }).catch(() => {});

        // 如果是主动停的,不自动重启;否则按退避策略准备下次 spawn(reconciler 会接手)
        if (!agent.desiredShutdown && !this.shuttingDown) {
            const nextDelay = Math.min(agent.nextRestartDelayMs, RESTART_MAX_DELAY_MS);
            console.log(`[SessionRegistry] agent ${sessionId} crashed, will retry in ${nextDelay}ms (attempt ${agent.restartAttempts + 1})`);
            setTimeout(() => {
                // 只有当 DB 里仍 desired=running 时才重新排队
                this.repo.getSessionBySessionId(sessionId).then((row) => {
                    if (row?.desired_state === 'running' && !this.agents.has(sessionId)) {
                        this._enqueueSpawn(sessionId);
                        this._processSpawnQueue().catch(() => {});
                    }
                }).catch(() => {});
            }, nextDelay);
            // 记录 restart 计数
            this.repo.incrementRestartCount(sessionId).catch(() => {});
        }

        this.emitter.emit('agent-exited', { sessionId, code, signal, planned: agent.desiredShutdown });
    }

    // ================== commands (router 用) ==================

    async sendCommand(sessionId, cmd, payload = {}, timeoutMs = null) {
        const agent = this.agents.get(sessionId);
        if (!agent) {
            return { ok: false, error: `agent not running for session ${sessionId}` };
        }
        if (!agent.ready) {
            return { ok: false, error: `agent not ready for session ${sessionId}` };
        }

        const effectiveTimeout = Number.isFinite(timeoutMs) && timeoutMs > 0
            ? timeoutMs
            : (cmd === 'audit_recent_messages' ? AUDIT_COMMAND_TIMEOUT_MS : COMMAND_TIMEOUT_MS);

        return new Promise((resolve, reject) => {
            const commandId = generateCommandId();
            const timer = setTimeout(() => {
                agent.pendingCommands.delete(commandId);
                resolve({ ok: false, error: `command timeout: ${cmd}` });
            }, effectiveTimeout);
            agent.pendingCommands.set(commandId, { resolve, reject, timer });
            try {
                agent.child.send(makeCommand(commandId, cmd, payload));
            } catch (err) {
                clearTimeout(timer);
                agent.pendingCommands.delete(commandId);
                resolve({ ok: false, error: `send failed: ${err.message}` });
            }
        });
    }

    // ================== status queries ==================

    getAgentState(sessionId) {
        const agent = this.agents.get(sessionId);
        if (!agent) return null;
        return {
            session_id: sessionId,
            owner: agent.owner,
            pid: agent.pid,
            state: agent.state,
            ready: agent.ready,
            qr_value: agent.qrValue,
            qr_refresh_count: agent.qrRefreshCount,
            last_qr_at: agent.lastQrAt,
            account_phone: agent.accountPhone,
            account_pushname: agent.accountPushname,
            last_heartbeat_at: agent.lastHeartbeat ? new Date(agent.lastHeartbeat).toISOString() : null,
            last_heartbeat_ms_ago: agent.lastHeartbeat ? (now() - agent.lastHeartbeat) : null,
            last_error: agent.lastError,
            worker: agent.workerProgress,
            restart_attempts: agent.restartAttempts,
            spawned_at: new Date(agent.spawnedAt).toISOString(),
        };
    }

    listAgents() {
        return Array.from(this.agents.keys()).map((sid) => this.getAgentState(sid));
    }

    isEnabled() {
        return !!this.enabled;
    }

    on(event, listener) { this.emitter.on(event, listener); }
    off(event, listener) { this.emitter.off(event, listener); }

    // ================== reconciliation ==================

    _startReconciler() {
        if (this.reconcilerTimer) return;
        this.reconcilerTimer = setInterval(() => {
            this._reconcileOnce().catch((err) => {
                console.error('[SessionRegistry] reconciliation error:', err.message);
            });
        }, RECONCILIATION_INTERVAL_MS);
        if (this.reconcilerTimer.unref) this.reconcilerTimer.unref();
    }

    async _reconcileOnce() {
        if (!this.enabled || this.shuttingDown) return;
        const sessions = await this.repo.listSessions();
        const sessionIdsInDB = new Set();

        for (const session of sessions) {
            sessionIdsInDB.add(session.session_id);
            const agent = this.agents.get(session.session_id);

            if (session.desired_state === 'running') {
                if (!agent) {
                    // 该跑但没在跑 → 排队 spawn
                    this._enqueueSpawn(session.session_id);
                    continue;
                }
                // 心跳监控
                const sinceHeartbeat = agent.lastHeartbeat ? (now() - agent.lastHeartbeat) : Infinity;
                if (sinceHeartbeat > HEARTBEAT_FORCE_RESTART_MS && agent.state === 'ready') {
                    console.warn(`[SessionRegistry] ${session.session_id} heartbeat stale >${HEARTBEAT_FORCE_RESTART_MS}ms, forcing restart`);
                    agent.restartAttempts += 1;
                    agent.nextRestartDelayMs = Math.min(agent.nextRestartDelayMs * 2, RESTART_MAX_DELAY_MS);
                    this.restartAgent(session.session_id).catch(() => {});
                } else if (sinceHeartbeat > HEARTBEAT_STALE_MS && agent.state === 'ready') {
                    agent.state = 'stale';
                    await this.repo.setRuntimeState(session.session_id, { state: 'stale' }).catch(() => {});
                }
            } else if (session.desired_state === 'stopped' && agent) {
                // 该停但还在跑 → 停
                console.log(`[SessionRegistry] ${session.session_id} desired=stopped, stopping agent`);
                this.stopAgent(session.session_id, { planned: true }).catch(() => {});
            }
        }

        // DB 里没有但 agent 还在 → 删除 session 时兜底
        for (const sid of this.agents.keys()) {
            if (!sessionIdsInDB.has(sid)) {
                console.log(`[SessionRegistry] ${sid} not in DB anymore, stopping`);
                this.stopAgent(sid, { planned: true }).catch(() => {});
            }
        }

        if (this.spawnQueue.length > 0) {
            this._processSpawnQueue().catch(() => {});
        }
    }
}

// 单例导出(全进程只应有一个 Registry)
let instance = null;

function getRegistry() {
    return instance;
}

function initRegistry({ enabled = process.env.WA_AGENTS_ENABLED === 'true', logDir } = {}) {
    if (instance) return instance;
    instance = new SessionRegistry({ repository: sessionRepository, logDir, enabled });
    return instance;
}

module.exports = {
    SessionRegistry,
    initRegistry,
    getRegistry,
};
