const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { perfLog } = require('./perfLog');

const ROOT_DIR = path.join(__dirname, '../../.wa_ipc');

// Phase 2: fs.watch 替 250ms 轮询。关闭开关 WA_IPC_USE_FS_WATCH=false 回到旧逻辑。
const WA_IPC_USE_FS_WATCH =
    String(process.env.WA_IPC_USE_FS_WATCH || 'true').toLowerCase() !== 'false';
const FALLBACK_POLL_INTERVAL_MS = 5000; // watcher 静默死时兜底的慢轮询
const STATUS_DIR = path.join(ROOT_DIR, 'status');
const COMMANDS_DIR = path.join(ROOT_DIR, 'commands');
const RESULTS_DIR = path.join(ROOT_DIR, 'results');

function ensureDir(dirPath) {
    fs.mkdirSync(dirPath, { recursive: true });
}

function sanitizeSessionId(value, fallback = 'unknown') {
    const raw = String(value || fallback).trim();
    const safe = raw.replace(/[^a-zA-Z0-9._-]/g, '_');
    return safe || fallback;
}

function ensureSessionDirs(sessionId) {
    const safeSessionId = sanitizeSessionId(sessionId);
    ensureDir(ROOT_DIR);
    ensureDir(STATUS_DIR);
    ensureDir(path.join(COMMANDS_DIR, safeSessionId, 'pending'));
    ensureDir(path.join(COMMANDS_DIR, safeSessionId, 'processing'));
    ensureDir(path.join(RESULTS_DIR, safeSessionId));
    return safeSessionId;
}

function statusFilePath(sessionId) {
    return path.join(STATUS_DIR, `${sanitizeSessionId(sessionId)}.json`);
}

function resultFilePath(sessionId, commandId) {
    return path.join(RESULTS_DIR, sanitizeSessionId(sessionId), `${commandId}.json`);
}

function pendingDir(sessionId) {
    return path.join(COMMANDS_DIR, sanitizeSessionId(sessionId), 'pending');
}

function processingDir(sessionId) {
    return path.join(COMMANDS_DIR, sanitizeSessionId(sessionId), 'processing');
}

function writeJsonAtomic(filePath, payload) {
    const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
    fs.writeFileSync(tempPath, JSON.stringify(payload, null, 2));
    fs.renameSync(tempPath, filePath);
}

function writeSessionStatus(sessionId, payload) {
    ensureSessionDirs(sessionId);
    writeJsonAtomic(statusFilePath(sessionId), {
        session_id: sanitizeSessionId(sessionId),
        updated_at: new Date().toISOString(),
        ...payload,
    });
}

function readJsonSafe(filePath) {
    try {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (_) {
        return null;
    }
}

function readSessionStatus(sessionId) {
    return readJsonSafe(statusFilePath(sessionId));
}

function listStatusSessions() {
    ensureDir(STATUS_DIR);
    return fs.readdirSync(STATUS_DIR)
        .filter((name) => name.endsWith('.json'))
        .map((name) => name.replace(/\.json$/, ''))
        .sort();
}

function createSessionCommand(sessionId, payload) {
    const safeSessionId = ensureSessionDirs(sessionId);
    const commandId = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
    const filePath = path.join(pendingDir(safeSessionId), `${commandId}.json`);
    writeJsonAtomic(filePath, {
        id: commandId,
        session_id: safeSessionId,
        created_at: new Date().toISOString(),
        ...payload,
    });
    perfLog('cmd_sent', {
        cmdId: commandId,
        sessionId: safeSessionId,
        cmd: payload && payload.cmd,
    });
    return commandId;
}

function claimNextSessionCommand(sessionId) {
    const safeSessionId = ensureSessionDirs(sessionId);
    const dir = pendingDir(safeSessionId);
    const files = fs.readdirSync(dir)
        .filter((name) => name.endsWith('.json'))
        .sort();
    if (files.length === 0) return null;

    for (const file of files) {
        const source = path.join(dir, file);
        const target = path.join(processingDir(safeSessionId), file);
        try {
            fs.renameSync(source, target);
            const command = readJsonSafe(target);
            if (!command) {
                fs.unlinkSync(target);
                continue;
            }
            perfLog('cmd_claimed', {
                cmdId: command.id,
                sessionId: safeSessionId,
                cmd: command.cmd,
                createdAt: command.created_at,
            });
            return { command, filePath: target };
        } catch (_) {
            continue;
        }
    }
    return null;
}

function completeClaimedCommand(claimed, result) {
    if (!claimed?.command?.session_id || !claimed?.command?.id) return;
    const sessionId = claimed.command.session_id;
    ensureSessionDirs(sessionId);
    writeJsonAtomic(resultFilePath(sessionId, claimed.command.id), {
        id: claimed.command.id,
        session_id: sessionId,
        completed_at: new Date().toISOString(),
        ...result,
    });
    try {
        fs.unlinkSync(claimed.filePath);
    } catch (_) {}
    perfLog('cmd_completed', {
        cmdId: claimed.command.id,
        sessionId,
        cmd: claimed.command.cmd,
        ok: result && result.ok !== false,
    });
}

// ===== fs.watch 驱动的结果等待（Phase 2）=====

// 每个 sessionId 维护一个 watcher + 挂起 resolver 表。
// 结构：sessionId -> { watcher, resolvers: Map<cmdId, {resolve, reject, timer, startedAt}>, fallbackTimer }
const resultWatchers = new Map();

function tryResolveResult(state, safeSessionId, commandId, via) {
    const entry = state.resolvers.get(commandId);
    if (!entry) return false;
    const fp = resultFilePath(safeSessionId, commandId);
    if (!fs.existsSync(fp)) return false;
    const payload = readJsonSafe(fp);
    try { fs.unlinkSync(fp); } catch (_) {}
    clearTimeout(entry.timer);
    state.resolvers.delete(commandId);
    perfLog('cmd_wait_end', {
        cmdId: commandId,
        sessionId: safeSessionId,
        outcome: 'resolved',
        waitedMs: Date.now() - entry.startedAt,
        ok: payload && payload.ok !== false,
        via,
    });
    entry.resolve(payload || { ok: false, error: 'invalid command result' });
    return true;
}

function initResultWatcher(safeSessionId) {
    const existing = resultWatchers.get(safeSessionId);
    if (existing) return existing;
    const dir = path.join(RESULTS_DIR, safeSessionId);
    ensureDir(dir);
    const state = {
        resolvers: new Map(),
        watcher: null,
        fallbackTimer: null,
    };

    try {
        state.watcher = fs.watch(dir, { persistent: false }, (_eventType, filename) => {
            if (!filename || !filename.endsWith('.json')) return;
            const commandId = filename.slice(0, -'.json'.length);
            tryResolveResult(state, safeSessionId, commandId, 'watcher');
        });
        state.watcher.on('error', (err) => {
            console.error(`[waIpc] result watcher error for ${safeSessionId}:`, err.message);
        });
    } catch (err) {
        console.error(`[waIpc] fs.watch init failed for ${safeSessionId}, fallback polling only:`, err.message);
        state.watcher = null;
    }

    // Fallback 慢轮询：应对 watcher 静默死、跨 FS 事件丢失。
    state.fallbackTimer = setInterval(() => {
        for (const commandId of Array.from(state.resolvers.keys())) {
            tryResolveResult(state, safeSessionId, commandId, 'fallback_poll');
        }
    }, FALLBACK_POLL_INTERVAL_MS);
    state.fallbackTimer.unref && state.fallbackTimer.unref();

    resultWatchers.set(safeSessionId, state);
    return state;
}

async function waitForSessionCommandResult(sessionId, commandId, timeoutMs = 20000) {
    const safeSessionId = ensureSessionDirs(sessionId);
    const started = Date.now();
    perfLog('cmd_wait_start', {
        cmdId: commandId,
        sessionId: safeSessionId,
        timeoutMs,
    });

    if (!WA_IPC_USE_FS_WATCH) {
        return legacyWaitForSessionCommandResult(safeSessionId, commandId, timeoutMs, started);
    }

    const state = initResultWatcher(safeSessionId);

    return new Promise((resolve, reject) => {
        // Drain:若结果文件已经存在（watcher 注册前 agent 就完成了命令），直接取。
        const fp = resultFilePath(safeSessionId, commandId);
        if (fs.existsSync(fp)) {
            const payload = readJsonSafe(fp);
            try { fs.unlinkSync(fp); } catch (_) {}
            perfLog('cmd_wait_end', {
                cmdId: commandId,
                sessionId: safeSessionId,
                outcome: 'resolved',
                waitedMs: Date.now() - started,
                ok: payload && payload.ok !== false,
                via: 'drain',
            });
            return resolve(payload || { ok: false, error: 'invalid command result' });
        }

        const timer = setTimeout(() => {
            state.resolvers.delete(commandId);
            perfLog('cmd_wait_end', {
                cmdId: commandId,
                sessionId: safeSessionId,
                outcome: 'timeout',
                waitedMs: Date.now() - started,
            });
            reject(new Error(`session command timeout: ${safeSessionId}/${commandId}`));
        }, timeoutMs);

        state.resolvers.set(commandId, { resolve, reject, timer, startedAt: started });
    });
}

async function legacyWaitForSessionCommandResult(safeSessionId, commandId, timeoutMs, started) {
    const filePath = resultFilePath(safeSessionId, commandId);
    while (Date.now() - started < timeoutMs) {
        if (fs.existsSync(filePath)) {
            const payload = readJsonSafe(filePath);
            try { fs.unlinkSync(filePath); } catch (_) {}
            perfLog('cmd_wait_end', {
                cmdId: commandId,
                sessionId: safeSessionId,
                outcome: 'resolved',
                waitedMs: Date.now() - started,
                ok: payload && payload.ok !== false,
                via: 'legacy_poll',
            });
            return payload || { ok: false, error: 'invalid command result' };
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
    }
    perfLog('cmd_wait_end', {
        cmdId: commandId,
        sessionId: safeSessionId,
        outcome: 'timeout',
        waitedMs: Date.now() - started,
        via: 'legacy_poll',
    });
    throw new Error(`session command timeout: ${safeSessionId}/${commandId}`);
}

// ===== fs.watch 驱动的命令队列监听（agent 侧使用）=====

function watchSessionCommandQueue(sessionId, onChange) {
    const safeSessionId = ensureSessionDirs(sessionId);
    if (!WA_IPC_USE_FS_WATCH) return () => {};
    const dir = pendingDir(safeSessionId);
    let watcher;
    try {
        watcher = fs.watch(dir, { persistent: false }, (_eventType, filename) => {
            if (!filename || !filename.endsWith('.json')) return;
            // 命令文件（commandId.json）或 writeJsonAtomic 的临时文件
            // （.tmp-*）都会触发；handler 幂等，多余触发不是问题。
            try { onChange(); } catch (err) {
                console.error(`[waIpc] queue onChange handler error for ${safeSessionId}:`, err.message);
            }
        });
        watcher.on('error', (err) => {
            console.error(`[waIpc] queue watcher error for ${safeSessionId}:`, err.message);
        });
    } catch (err) {
        console.error(`[waIpc] fs.watch queue init failed for ${safeSessionId}:`, err.message);
        return () => {};
    }

    // 启动时 drain：可能已经有 pending 文件（服务启动前就入队了）。
    process.nextTick(() => {
        try { onChange(); } catch (_) {}
    });

    return () => {
        if (watcher) watcher.close();
    };
}

// ===== 优雅关闭 =====

function shutdownIpc() {
    for (const [sessionId, state] of resultWatchers) {
        if (state.watcher) {
            try { state.watcher.close(); } catch (_) {}
        }
        if (state.fallbackTimer) clearInterval(state.fallbackTimer);
        for (const [cmdId, entry] of state.resolvers) {
            clearTimeout(entry.timer);
            try { entry.reject(new Error('ipc shutdown')); } catch (_) {}
        }
        state.resolvers.clear();
        resultWatchers.delete(sessionId);
    }
}

module.exports = {
    createSessionCommand,
    claimNextSessionCommand,
    completeClaimedCommand,
    listStatusSessions,
    readSessionStatus,
    sanitizeSessionId,
    waitForSessionCommandResult,
    watchSessionCommandQueue,
    shutdownIpc,
    writeSessionStatus,
};
