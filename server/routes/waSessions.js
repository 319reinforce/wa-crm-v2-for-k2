/**
 * WA Sessions CRUD Router
 *
 * 前端 AccountsPanel 管理账号用。仅 admin 角色可访问(非 owner-scoped token)。
 *
 * GET    /api/wa/sessions           — 列出所有 session + 运行时状态
 * POST   /api/wa/sessions           — 创建 session
 * DELETE /api/wa/sessions/:id       — 删除 session(可选 ?purge_auth=true 删 LocalAuth 目录)
 * POST   /api/wa/sessions/:id/restart       — 重启 agent
 * POST   /api/wa/sessions/:id/desired-state — 切换 desired_state('running' | 'stopped')
 * GET    /api/wa/sessions/:id/qr    — 获取当前 QR 二维码(Registry 内存态,非文件 IPC)
 */
const express = require('express');
const path = require('path');
const fs = require('fs');
const QRCode = require('qrcode');

const router = express.Router();
const sessionRepository = require('../services/sessionRepository');
const { getRegistry } = require('../services/sessionRegistry');
const { getLockedOwner } = require('../middleware/appAuth');
const { normalizeOperatorName } = require('../utils/operator');

// 返回"当前用户能看到的 owner 范围":
//   - admin / service → null (代表不限)
//   - operator(DB) or env owner-scoped → 锁定的 owner 名
function getEffectiveOwnerScope(req) {
    const a = req?.auth;
    if (!a) return 'UNAUTHORIZED';
    if (a.source === 'db' && a.role === 'admin') return null;
    if (a.source === 'env' && a.role === 'service') return null;
    if (a.source === 'env' && a.role === 'admin') return null;
    const locked = normalizeOperatorName(a.owner, null) || getLockedOwner(req);
    if (locked) return locked;
    return 'UNAUTHORIZED';
}

// 对写操作校验 session 归属(target owner 必须在 scope 内);scope=null 即 admin 通行
function ensureSessionInScope(req, res, sessionRow) {
    const scope = getEffectiveOwnerScope(req);
    if (scope === 'UNAUTHORIZED') {
        res.status(403).json({ ok: false, error: 'Forbidden' });
        return false;
    }
    if (scope === null) return true;
    const sessionOwner = normalizeOperatorName(sessionRow?.owner, null);
    if (sessionOwner && sessionOwner === scope) return true;
    res.status(403).json({
        ok: false,
        error: `Forbidden: session owner ${sessionRow?.owner || '?'} not in your scope (${scope})`,
    });
    return false;
}

function sanitizeSessionId(raw) {
    const s = String(raw || '').trim();
    if (!s) return '';
    return s.replace(/[^a-zA-Z0-9._-]/g, '_').toLowerCase();
}

function formatSession(row, agentState = null) {
    return {
        session_id: row.session_id,
        owner: row.owner,
        aliases: row.aliases || [],
        desired_state: row.desired_state,
        runtime_state: row.runtime_state,
        runtime_phase: row.runtime_phase,
        runtime_pid: row.runtime_pid,
        last_heartbeat_at: row.last_heartbeat_at,
        last_ready_at: row.last_ready_at,
        last_exit_code: row.last_exit_code,
        last_exit_signal: row.last_exit_signal,
        restart_count: row.restart_count,
        last_restart_at: row.last_restart_at,
        last_error: row.last_error,
        account_phone: row.account_phone,
        account_pushname: row.account_pushname,
        account_bound_at: row.account_bound_at,
        created_at: row.created_at,
        updated_at: row.updated_at,
        agent: agentState
            ? {
                pid: agentState.pid,
                state: agentState.state,
                ready: agentState.ready,
                has_qr: !!agentState.qr_value,
                last_heartbeat_ms_ago: agentState.last_heartbeat_ms_ago,
                worker_phase: agentState.worker?.phase || null,
            }
            : null,
    };
}

// GET /api/wa/sessions
router.get('/', async (req, res) => {
    try {
        const scope = getEffectiveOwnerScope(req);
        if (scope === 'UNAUTHORIZED') return res.status(403).json({ ok: false, error: 'Forbidden' });

        const sessions = await sessionRepository.listSessions();
        const visible = scope === null
            ? sessions
            : sessions.filter((row) => normalizeOperatorName(row.owner, null) === scope);
        const registry = getRegistry();
        const payload = visible.map((row) => {
            const agentState = registry?.getAgentState(row.session_id) || null;
            return formatSession(row, agentState);
        });
        const summary = {
            total: payload.length,
            running: payload.filter((s) => s.desired_state === 'running').length,
            ready: payload.filter((s) => s.agent?.ready).length,
            stopped: payload.filter((s) => s.desired_state === 'stopped').length,
            crashed: payload.filter((s) => s.runtime_state === 'crashed').length,
            registry_enabled: !!registry?.isEnabled(),
        };
        res.json({ ok: true, sessions: payload, summary });
    } catch (err) {
        console.error('[waSessions] list failed:', err);
        res.status(500).json({ ok: false, error: err.message });
    }
});

// POST /api/wa/sessions
router.post('/', async (req, res) => {
    try {
        const scope = getEffectiveOwnerScope(req);
        if (scope === 'UNAUTHORIZED') return res.status(403).json({ ok: false, error: 'Forbidden' });

        const { session_id, owner, aliases = [] } = req.body || {};
        const cleanId = sanitizeSessionId(session_id);
        const cleanOwner = String(owner || '').trim();
        if (!cleanId) return res.status(400).json({ ok: false, error: 'session_id required' });
        if (!cleanOwner) return res.status(400).json({ ok: false, error: 'owner required' });

        // operator 只能建自己 owner 的 session
        if (scope !== null) {
            const normalizedCleanOwner = normalizeOperatorName(cleanOwner, null);
            if (normalizedCleanOwner !== scope) {
                return res.status(403).json({
                    ok: false,
                    error: `Forbidden: cannot create session for owner ${cleanOwner} (your scope: ${scope})`,
                });
            }
        }
        const cleanAliases = Array.isArray(aliases)
            ? aliases.map((a) => String(a).trim().toLowerCase()).filter(Boolean)
            : [];

        const created = await sessionRepository.createSession({
            session_id: cleanId,
            owner: cleanOwner,
            aliases: cleanAliases,
            created_by: req.auth?.username || 'admin',
        });

        // 触发 Registry spawn(如果启用)
        const registry = getRegistry();
        if (registry?.isEnabled()) {
            registry.spawnAgent(created.session_id).catch((err) => {
                console.error(`[waSessions] spawn ${created.session_id} failed:`, err.message);
            });
        }

        res.json({ ok: true, session: formatSession(created) });
    } catch (err) {
        if (err.code === 'OWNER_ALREADY_ACTIVE') {
            return res.status(409).json({
                ok: false,
                error: err.message,
                existing: err.existing ? { session_id: err.existing.session_id, owner: err.existing.owner } : null,
                code: 'OWNER_ALREADY_ACTIVE',
            });
        }
        if (err.code === 'SESSION_ID_EXISTS') {
            return res.status(409).json({
                ok: false,
                error: err.message,
                code: 'SESSION_ID_EXISTS',
            });
        }
        console.error('[waSessions] create failed:', err);
        res.status(500).json({ ok: false, error: err.message });
    }
});

// DELETE /api/wa/sessions/:id
router.delete('/:id', async (req, res) => {
    try {
        const sessionId = sanitizeSessionId(req.params.id);
        if (!sessionId) return res.status(400).json({ ok: false, error: 'invalid session id' });

        const existing = await sessionRepository.getSessionBySessionId(sessionId);
        if (!existing) return res.status(404).json({ ok: false, error: 'session not found' });
        if (!ensureSessionInScope(req, res, existing)) return;

        const registry = getRegistry();
        if (registry?.isEnabled()) {
            try {
                await registry.stopAgent(sessionId, { planned: true });
            } catch (_) {}
        }

        await sessionRepository.deleteSession(sessionId);

        const purgeAuth = String(req.query.purge_auth || '').toLowerCase() === 'true';
        let authPurged = false;
        if (purgeAuth) {
            const authRoot = process.env.WA_AUTH_ROOT
                || process.env.WWEBJS_AUTH_ROOT
                || path.join(__dirname, '../../.wwebjs_auth');
            const sessionDir = path.join(authRoot, `session-${sessionId}`);
            try {
                if (fs.existsSync(sessionDir)) {
                    fs.rmSync(sessionDir, { recursive: true, force: true });
                    authPurged = true;
                }
            } catch (err) {
                console.warn(`[waSessions] purge auth dir failed: ${err.message}`);
            }
        }

        res.json({ ok: true, session_id: sessionId, auth_purged: authPurged });
    } catch (err) {
        console.error('[waSessions] delete failed:', err);
        res.status(500).json({ ok: false, error: err.message });
    }
});

// POST /api/wa/sessions/:id/restart
router.post('/:id/restart', async (req, res) => {
    try {
        const sessionId = sanitizeSessionId(req.params.id);
        if (!sessionId) return res.status(400).json({ ok: false, error: 'invalid session id' });

        const existing = await sessionRepository.getSessionBySessionId(sessionId);
        if (!existing) return res.status(404).json({ ok: false, error: 'session not found' });
        if (!ensureSessionInScope(req, res, existing)) return;

        const registry = getRegistry();
        if (!registry?.isEnabled()) {
            return res.status(503).json({ ok: false, error: 'SessionRegistry disabled' });
        }

        registry.restartAgent(sessionId).catch((err) => {
            console.error(`[waSessions] restart ${sessionId} failed:`, err.message);
        });
        res.json({ ok: true, session_id: sessionId, restarting: true });
    } catch (err) {
        console.error('[waSessions] restart failed:', err);
        res.status(500).json({ ok: false, error: err.message });
    }
});

// POST /api/wa/sessions/:id/desired-state
router.post('/:id/desired-state', async (req, res) => {
    try {
        const sessionId = sanitizeSessionId(req.params.id);
        const { state } = req.body || {};
        if (!sessionId) return res.status(400).json({ ok: false, error: 'invalid session id' });
        if (state !== 'running' && state !== 'stopped') {
            return res.status(400).json({ ok: false, error: 'state must be running or stopped' });
        }

        const existing = await sessionRepository.getSessionBySessionId(sessionId);
        if (!existing) return res.status(404).json({ ok: false, error: 'session not found' });
        if (!ensureSessionInScope(req, res, existing)) return;

        await sessionRepository.setDesiredState(sessionId, state, req.auth?.username || 'admin');
        // reconciler 会在下一次 tick 自动对齐,但也可以主动触发 stop/spawn 加快响应
        const registry = getRegistry();
        if (registry?.isEnabled()) {
            if (state === 'running') {
                registry.spawnAgent(sessionId).catch(() => {});
            } else {
                registry.stopAgent(sessionId, { planned: true }).catch(() => {});
            }
        }

        res.json({ ok: true, session_id: sessionId, desired_state: state });
    } catch (err) {
        console.error('[waSessions] desired-state failed:', err);
        res.status(500).json({ ok: false, error: err.message });
    }
});

// GET /api/wa/sessions/:id/qr
router.get('/:id/qr', async (req, res) => {
    try {
        const sessionId = sanitizeSessionId(req.params.id);
        if (!sessionId) return res.status(400).json({ ok: false, error: 'invalid session id' });

        const existing = await sessionRepository.getSessionBySessionId(sessionId);
        if (!existing) return res.status(404).json({ ok: false, error: 'session not found' });
        if (!ensureSessionInScope(req, res, existing)) return;

        const registry = getRegistry();
        const agentState = registry?.getAgentState(sessionId);
        const rawQr = agentState?.qr_value || null;
        if (!rawQr) {
            return res.status(404).json({
                ok: false,
                message: agentState?.ready ? 'session already authenticated' : 'no QR available',
                ready: !!agentState?.ready,
            });
        }
        const dataUrl = await QRCode.toDataURL(rawQr, {
            margin: 2,
            width: 300,
            color: { dark: '#000000', light: '#ffffff' },
        });
        res.json({
            ok: true,
            qr: dataUrl,
            qr_refresh_count: agentState.qr_refresh_count || 0,
            last_qr_at: agentState.last_qr_at || null,
        });
    } catch (err) {
        console.error('[waSessions] qr failed:', err);
        res.status(500).json({ ok: false, error: err.message });
    }
});

module.exports = router;
