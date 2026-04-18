/**
 * sessionRepository — wa_sessions 表的 DB 封装 + in-memory 缓存
 *
 * 目的:
 * - 取代 appAuth.js / operatorRosterService.js / waSessionRouter.js 里三处
 *   SESSION_BY_OPERATOR 硬编码表
 * - 为 SessionRegistry 提供 desired/runtime 状态读写
 * - 为 auth 中间件等热路径提供 sync 缓存接口(避免每次打 DB)
 *
 * 缓存策略:
 * - 启动时 warmCache() 同步加载一次到 Map
 * - 每 30s 后台 refreshCache()
 * - 本进程对 DB 的写入(createSession / setDesired / deleteSession)完成后
 *   显式 invalidateCache() 让下一次 sync 读走到最新值
 * - EventEmitter 广播 changes,Registry 可订阅(Step 3 用)
 */
const { EventEmitter } = require('events');
const db = require('../../db');
const { normalizeOperatorName } = require('../utils/operator');

const CACHE_REFRESH_INTERVAL_MS = 30 * 1000;

const emitter = new EventEmitter();

let cacheByOwner = new Map();       // owner(normalized) -> session_id
let cacheBySessionId = new Map();   // session_id -> row
let cacheByAlias = new Map();       // alias(lower) -> session_id
let cacheWarmedAt = 0;
let cacheRefreshTimer = null;

// ================== DB 层(async) ==================

function parseAliases(raw) {
    if (!raw) return [];
    if (Array.isArray(raw)) return raw;
    if (typeof raw === 'string') {
        try {
            const parsed = JSON.parse(raw);
            return Array.isArray(parsed) ? parsed : [];
        } catch (_) {
            return [];
        }
    }
    return [];
}

function normalizeSessionIdValue(value) {
    const raw = String(value || '').trim();
    if (!raw) return null;
    return raw.replace(/[^a-zA-Z0-9._-]/g, '_').toLowerCase();
}

function rowToSession(row) {
    if (!row) return null;
    return {
        id: row.id,
        session_id: row.session_id,
        owner: row.owner,
        aliases: parseAliases(row.aliases),
        desired_state: row.desired_state,
        desired_state_changed_at: row.desired_state_changed_at,
        desired_state_changed_by: row.desired_state_changed_by,
        runtime_state: row.runtime_state,
        runtime_phase: row.runtime_phase,
        runtime_pid: row.runtime_pid,
        last_heartbeat_at: row.last_heartbeat_at,
        last_ready_at: row.last_ready_at,
        last_exit_code: row.last_exit_code,
        last_exit_signal: row.last_exit_signal,
        restart_count: Number(row.restart_count || 0),
        last_restart_at: row.last_restart_at,
        last_error: row.last_error,
        account_phone: row.account_phone,
        account_pushname: row.account_pushname,
        account_bound_at: row.account_bound_at,
        created_at: row.created_at,
        created_by: row.created_by,
        updated_at: row.updated_at,
    };
}

async function listSessions() {
    const rows = await db.getDb().prepare(`
        SELECT * FROM wa_sessions ORDER BY id ASC
    `).all();
    return rows.map(rowToSession);
}

async function getSessionBySessionId(sessionId) {
    const row = await db.getDb().prepare(
        `SELECT * FROM wa_sessions WHERE session_id = ? LIMIT 1`
    ).get(sessionId);
    return rowToSession(row);
}

async function getActiveSessionByOwner(owner) {
    const normalized = normalizeOperatorName(owner, owner);
    if (!normalized) return null;
    const row = await db.getDb().prepare(
        `SELECT * FROM wa_sessions
          WHERE owner = ? AND desired_state = 'running'
          ORDER BY id ASC LIMIT 1`
    ).get(normalized);
    return rowToSession(row);
}

async function createSession({ session_id, owner, aliases = [], created_by = null }) {
    const normalizedOwner = normalizeOperatorName(owner, owner);
    if (!normalizedOwner) {
        throw new Error('owner is required');
    }
    const cleanSessionId = normalizeSessionIdValue(session_id);
    if (!cleanSessionId) {
        throw new Error('session_id is required');
    }

    const existing = await getActiveSessionByOwner(normalizedOwner);
    if (existing) {
        const err = new Error(`owner already has active session: ${existing.session_id}`);
        err.code = 'OWNER_ALREADY_ACTIVE';
        err.existing = existing;
        throw err;
    }

    const existingBySessionId = await getSessionBySessionId(cleanSessionId);
    if (existingBySessionId) {
        const err = new Error(`session_id already exists: ${cleanSessionId}`);
        err.code = 'SESSION_ID_EXISTS';
        err.existing = existingBySessionId;
        throw err;
    }

    await db.getDb().prepare(`
        INSERT INTO wa_sessions (session_id, owner, aliases, desired_state, created_by)
        VALUES (?, ?, ?, 'running', ?)
    `).run(
        cleanSessionId,
        normalizedOwner,
        JSON.stringify(Array.isArray(aliases) ? aliases : []),
        created_by || null,
    );

    invalidateCache();
    const created = await getSessionBySessionId(cleanSessionId);
    emitter.emit('session-created', created);
    return created;
}

async function setDesiredState(sessionId, state, changedBy = null) {
    if (state !== 'running' && state !== 'stopped') {
        throw new Error(`invalid desired_state: ${state}`);
    }
    await db.getDb().prepare(`
        UPDATE wa_sessions
           SET desired_state = ?,
               desired_state_changed_at = CURRENT_TIMESTAMP,
               desired_state_changed_by = ?
         WHERE session_id = ?
    `).run(state, changedBy || null, sessionId);
    invalidateCache();
    emitter.emit('desired-state-changed', { session_id: sessionId, state });
}

async function setRuntimeState(sessionId, {
    state = null,
    phase = null,
    pid = null,
    heartbeat_at = null,
    ready_at = null,
    exit_code = null,
    exit_signal = null,
    error = null,
    account_phone = null,
    account_pushname = null,
} = {}) {
    const fields = [];
    const values = [];
    const setIf = (col, val, transform = (v) => v) => {
        if (val === null || val === undefined) return;
        fields.push(`${col} = ?`);
        values.push(transform(val));
    };

    setIf('runtime_state', state);
    setIf('runtime_phase', phase);
    setIf('runtime_pid', pid);
    setIf('last_heartbeat_at', heartbeat_at, (v) => v instanceof Date ? v : new Date(v));
    setIf('last_ready_at', ready_at, (v) => v instanceof Date ? v : new Date(v));
    setIf('last_exit_code', exit_code);
    setIf('last_exit_signal', exit_signal);
    setIf('last_error', error);
    setIf('account_phone', account_phone);
    setIf('account_pushname', account_pushname);

    if (account_phone || account_pushname) {
        fields.push('account_bound_at = COALESCE(account_bound_at, CURRENT_TIMESTAMP)');
    }

    if (fields.length === 0) return;

    values.push(sessionId);
    await db.getDb().prepare(`
        UPDATE wa_sessions SET ${fields.join(', ')} WHERE session_id = ?
    `).run(...values);
}

async function incrementRestartCount(sessionId) {
    await db.getDb().prepare(`
        UPDATE wa_sessions
           SET restart_count = restart_count + 1,
               last_restart_at = CURRENT_TIMESTAMP
         WHERE session_id = ?
    `).run(sessionId);
}

async function deleteSession(sessionId) {
    await db.getDb().prepare(`
        DELETE FROM wa_sessions WHERE session_id = ?
    `).run(sessionId);
    invalidateCache();
    emitter.emit('session-deleted', { session_id: sessionId });
}

// ================== 缓存层(sync 接口) ==================

async function warmCache() {
    const sessions = await listSessions();
    const nextByOwner = new Map();
    const nextBySessionId = new Map();
    const nextByAlias = new Map();

    for (const session of sessions) {
        nextBySessionId.set(session.session_id, session);
        if (session.desired_state === 'running') {
            const ownerKey = normalizeOperatorName(session.owner, session.owner);
            if (ownerKey) nextByOwner.set(ownerKey, session.session_id);
        }
        for (const alias of session.aliases || []) {
            const aliasKey = String(alias || '').trim().toLowerCase();
            if (aliasKey) nextByAlias.set(aliasKey, session.session_id);
        }
    }

    cacheByOwner = nextByOwner;
    cacheBySessionId = nextBySessionId;
    cacheByAlias = nextByAlias;
    cacheWarmedAt = Date.now();
    emitter.emit('cache-refreshed', { size: sessions.length });
}

function invalidateCache() {
    // 标记需要刷新;后台 timer 或下次显式 refresh 会重拉
    // 这里直接触发一次异步刷新(fire-and-forget),让并发读获得新值
    warmCache().catch((err) => {
        console.error('[sessionRepository] cache refresh failed:', err.message);
    });
}

function startCacheRefreshLoop() {
    if (cacheRefreshTimer) return;
    cacheRefreshTimer = setInterval(() => {
        warmCache().catch((err) => {
            console.error('[sessionRepository] cache refresh (periodic) failed:', err.message);
        });
    }, CACHE_REFRESH_INTERVAL_MS);
    if (cacheRefreshTimer.unref) cacheRefreshTimer.unref();
}

function stopCacheRefreshLoop() {
    if (cacheRefreshTimer) {
        clearInterval(cacheRefreshTimer);
        cacheRefreshTimer = null;
    }
}

function getActiveSessionIdByOwnerCached(owner) {
    const normalized = normalizeOperatorName(owner, owner);
    if (!normalized) return null;
    return cacheByOwner.get(normalized) || null;
}

function getSessionBySessionIdCached(sessionId) {
    if (!sessionId) return null;
    return cacheBySessionId.get(sessionId) || null;
}

function resolveSessionIdByAliasCached(raw) {
    if (!raw) return null;
    const key = String(raw).trim().toLowerCase();
    if (!key) return null;
    // 先尝试直接 session_id 命中
    if (cacheBySessionId.has(key)) return key;
    // 再查 alias 表
    return cacheByAlias.get(key) || null;
}

function listSessionsCached() {
    return Array.from(cacheBySessionId.values());
}

function isCacheWarmed() {
    return cacheWarmedAt > 0;
}

module.exports = {
    // async DB
    listSessions,
    getSessionBySessionId,
    getActiveSessionByOwner,
    createSession,
    setDesiredState,
    setRuntimeState,
    incrementRestartCount,
    deleteSession,

    // sync cache
    warmCache,
    invalidateCache,
    startCacheRefreshLoop,
    stopCacheRefreshLoop,
    getActiveSessionIdByOwnerCached,
    getSessionBySessionIdCached,
    resolveSessionIdByAliasCached,
    listSessionsCached,
    isCacheWarmed,

    // events
    on: emitter.on.bind(emitter),
    off: emitter.off.bind(emitter),
};
