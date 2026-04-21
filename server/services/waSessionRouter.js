const fs = require('fs');
const path = require('path');
const db = require('../../db');
const { normalizeOperatorName } = require('../utils/operator');
const {
    reconcileCreatorMessagesFromRaw,
    syncCreatorMessagesFromRaw,
    replaceCreatorMessagesFromRaw,
} = require('./waMessageRepairService');
const {
    getAssignmentByCreatorId,
    getSessionIdForOperator,
} = require('./operatorRosterService');
const {
    createSessionCommand,
    listStatusSessions,
    readSessionStatus,
    sanitizeSessionId,
    waitForSessionCommandResult,
} = require('./waIpc');
const { assertNoGroupSend } = require('./groupSendGuard');
const sessionRepository = require('./sessionRepository');
const { getRegistry } = require('./sessionRegistry');
const creatorCache = require('./creatorCache');

const REPAIR_QUEUE_DIR = path.join(__dirname, '../../.wa_ipc/repair-queue');
// Phase 3: REPAIR_QUEUE_POLL_MS 本来硬编码 15000ms；补 env 覆盖入口以便
// 必要时在线调整（默认保持 15s，不缩短——polling 是兜底，缩短只增压不降延迟）
function parseRepairPollMs(raw) {
    const parsed = parseInt(raw || '', 10);
    if (!Number.isInteger(parsed) || parsed < 1000) return 15000;
    return parsed;
}
const REPAIR_QUEUE_POLL_MS = parseRepairPollMs(process.env.REPAIR_QUEUE_POLL_MS);
let repairQueueTimer = null;
let repairQueueBusy = false;

function ensureRepairQueueDir() {
    fs.mkdirSync(REPAIR_QUEUE_DIR, { recursive: true });
}

function repairQueuePath(sessionId) {
    return path.join(REPAIR_QUEUE_DIR, `${sanitizeSessionId(sessionId)}.json`);
}

function readRepairQueue(sessionId) {
    ensureRepairQueueDir();
    const filePath = repairQueuePath(sessionId);
    try {
        const raw = fs.readFileSync(filePath, 'utf8');
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch (_) {
        return [];
    }
}

function writeRepairQueue(sessionId, items) {
    ensureRepairQueueDir();
    const filePath = repairQueuePath(sessionId);
    const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
    fs.writeFileSync(tempPath, JSON.stringify(items, null, 2));
    fs.renameSync(tempPath, filePath);
}

function enqueueRepairJob(sessionId, payload) {
    if (!sessionId) return null;
    const queue = readRepairQueue(sessionId);
    const key = payload.creator_id ? `creator:${payload.creator_id}` : `phone:${payload.phone || ''}`;
    const now = new Date().toISOString();
    const existingIndex = queue.findIndex((item) => item?.key === key);
    const next = {
        key,
        created_at: now,
        updated_at: now,
        attempts: 0,
        ...payload,
    };
    if (existingIndex >= 0) {
        queue[existingIndex] = { ...queue[existingIndex], ...next, updated_at: now };
    } else {
        queue.push(next);
    }
    writeRepairQueue(sessionId, queue);
    return next;
}

function startRepairQueueWorker() {
    if (repairQueueTimer) return;
    ensureRepairQueueDir();
    repairQueueTimer = setInterval(() => {
        processRepairQueue().catch((err) => {
            console.warn('[WA Repair Queue] processing failed:', err.message);
        });
    }, REPAIR_QUEUE_POLL_MS);
}

async function processRepairQueue() {
    if (repairQueueBusy) return;
    repairQueueBusy = true;
    try {
        ensureRepairQueueDir();
        const files = fs.readdirSync(REPAIR_QUEUE_DIR).filter((name) => name.endsWith('.json'));
        for (const file of files) {
            const sessionId = file.replace(/\.json$/, '');
            const status = readSessionStatus(sessionId);
            if (!status?.ready || status?.worker?.phase !== 'live') continue;

            const queue = readRepairQueue(sessionId);
            if (queue.length === 0) continue;

            const remaining = [];
            for (const item of queue) {
                const attempts = Number(item?.attempts || 0);
                if (attempts >= 1) continue;

                const payload = {
                    creator_id: item.creator_id || null,
                    phone: item.phone || '',
                    session_id: sessionId,
                    operator: item.operator || null,
                    fetch_limit: item.fetch_limit || 500,
                    full_dedup: !!item.full_dedup,
                };
                const result = await reconcileRoutedContact(payload);
                if (!result?.ok) {
                    remaining.push({
                        ...item,
                        attempts: attempts + 1,
                        last_error: result?.error || 'unknown error',
                        updated_at: new Date().toISOString(),
                    });
                    continue;
                }
            }

            if (remaining.length === 0) {
                try {
                    fs.unlinkSync(repairQueuePath(sessionId));
                } catch (_) {}
            } else {
                writeRepairQueue(sessionId, remaining);
            }
        }
    } finally {
        repairQueueBusy = false;
    }
}

const STATUS_STALE_MS = 15000;

// alias 从 wa_sessions 表(in-memory 缓存)的 aliases JSON 字段读
// 例如 wa_sessions.aliases = ["sybil","wangyouke"] 会把这些别名映射到对应 session_id
function normalizeSessionId(value) {
    if (value === null || value === undefined) return null;
    const raw = String(value).trim();
    if (!raw) return null;
    const safe = sanitizeSessionId(raw, '');
    const normalized = String(safe || '').trim().toLowerCase();
    if (!normalized) return null;
    const resolved = sessionRepository.resolveSessionIdByAliasCached(normalized);
    return resolved || normalized;
}

function getDefaultTargets() {
    return [
        { session_id: 'beau', owner: 'Beau' },
        { session_id: 'yiyun', owner: 'Yiyun' },
        { session_id: 'youke', owner: 'WangYouKe' },
        { session_id: 'jiawen', owner: 'Jiawen' },
    ];
}

function parseRemoteTargets() {
    const raw = process.env.WA_SESSION_TARGETS;
    if (!raw) return [];

    let parsed;
    try {
        parsed = JSON.parse(raw);
    } catch (err) {
        console.error('[WA Session Router] WA_SESSION_TARGETS 解析失败:', err.message);
        return [];
    }

    const items = Array.isArray(parsed) ? parsed : Object.values(parsed || {});
    return items
        .map((item) => ({
            session_id: normalizeSessionId(item?.session_id || item?.sessionId),
            owner: normalizeOperatorName(item?.owner, item?.owner),
        }))
        .filter((item) => item.session_id);
}

function getSessionRegistry() {
    const map = new Map();

    // 优先 wa_sessions 表(in-memory 缓存)
    for (const session of sessionRepository.listSessionsCached()) {
        if (!session?.session_id) continue;
        map.set(session.session_id, {
            session_id: session.session_id,
            owner: normalizeOperatorName(session.owner, session.owner || null),
        });
    }

    // 缓存未 warm 或 DB 未迁移时回退到旧配置源
    if (map.size === 0) {
        for (const item of [...getDefaultTargets(), ...parseRemoteTargets()]) {
            if (!item?.session_id) continue;
            if (!map.has(item.session_id)) {
                map.set(item.session_id, {
                    session_id: item.session_id,
                    owner: item.owner || null,
                });
            }
        }
    }

    // 还要覆盖 IPC 已有 status 但 DB 未记录的 session(异常情况兜底)
    for (const sessionId of listStatusSessions()) {
        if (!map.has(sessionId)) {
            const status = readSessionStatus(sessionId);
            map.set(sessionId, {
                session_id: sessionId,
                owner: normalizeOperatorName(status?.configured_owner || status?.owner, status?.owner || null),
            });
        }
    }

    return [...map.values()];
}

function isPidAlive(pid) {
    const numericPid = Number(pid);
    if (!Number.isInteger(numericPid) || numericPid <= 0) return false;
    try {
        process.kill(numericPid, 0);
        return true;
    } catch (_) {
        return false;
    }
}

function isFreshStatus(updatedAt) {
    if (!updatedAt) return false;
    const ts = Date.parse(updatedAt);
    if (Number.isNaN(ts)) return false;
    return (Date.now() - ts) <= STATUS_STALE_MS;
}

async function resolveOperator({ creatorId, operator, phone }) {
    const explicit = normalizeOperatorName(operator, operator);
    if (explicit) return explicit;

    if (creatorId) {
        const assignment = await getAssignmentByCreatorId(creatorId);
        if (assignment?.operator) return normalizeOperatorName(assignment.operator, assignment.operator);

        const row = await creatorCache.getCreator(db.getDb(), creatorId, 'wa_owner');
        const ownerById = normalizeOperatorName(row?.wa_owner, row?.wa_owner || null);
        if (ownerById) return ownerById;
    }

    if (phone) {
        const row = await creatorCache.getCreatorByPhone(db.getDb(), phone, 'wa_owner');
        const ownerByPhone = normalizeOperatorName(row?.wa_owner, row?.wa_owner || null);
        if (ownerByPhone) return ownerByPhone;
    }

    return null;
}

async function resolveSessionTarget({ sessionId, operator, creatorId, phone, allowFallback = true }) {
    const registry = getSessionRegistry();
    const explicitSessionId = normalizeSessionId(sessionId);
    const resolvedOperator = await resolveOperator({ creatorId, operator, phone });
    const operatorSessionId = normalizeSessionId(getSessionIdForOperator(resolvedOperator));

    const desiredSessionId = explicitSessionId || operatorSessionId;
    const target = desiredSessionId
        ? registry.find((item) => item.session_id === desiredSessionId) || null
        : (resolvedOperator
            ? registry.find((item) => normalizeOperatorName(item.owner, item.owner) === resolvedOperator) || null
            : null);

    const fallback = allowFallback ? (target || registry[0] || null) : null;
    const resolvedSessionId = target?.session_id || fallback?.session_id || null;
    return {
        operator: resolvedOperator || target?.owner || fallback?.owner || null,
        session_id: resolvedSessionId,
        target: target || fallback,
        registry,
    };
}

function buildSessionStatus(session) {
    // 优先用 Registry 内存态(Node IPC 路径)
    const registry = getRegistry();
    const agentState = registry?.getAgentState(session.session_id);
    if (agentState) {
        return {
            session_id: session.session_id,
            owner: agentState.owner || session.owner,
            configured_owner: session.owner,
            ready: !!agentState.ready,
            hasQr: !!agentState.qr_value,
            qr_value: agentState.qr_value || null,
            qr_refresh_count: agentState.qr_refresh_count || 0,
            last_qr_at: agentState.last_qr_at || null,
            account_phone: agentState.account_phone || null,
            account_pushname: agentState.account_pushname || null,
            worker: agentState.worker || null,
            pid: agentState.pid || null,
            running: !!agentState.pid,
            error: agentState.last_error || null,
            updated_at: agentState.last_heartbeat_at,
            is_local: false,
            source: 'registry',
        };
    }

    // Fallback:文件 IPC status(PM2 crawler 路径)
    const status = readSessionStatus(session.session_id);
    if (!status) {
        return {
            session_id: session.session_id,
            owner: session.owner,
            configured_owner: session.owner,
            ready: false,
            hasQr: false,
            error: 'No session heartbeat',
            running: false,
            is_local: false,
            source: 'none',
        };
    }
    const running = isPidAlive(status.pid) && isFreshStatus(status.updated_at);
    const derivedError = running
        ? status.error || null
        : (status.error || 'Session heartbeat stale');
    return {
        ...status,
        session_id: status.session_id || session.session_id,
        owner: status.owner || session.owner,
        configured_owner: status.configured_owner || session.owner,
        ready: running ? !!status.ready : false,
        hasQr: running ? !!status.hasQr : false,
        running,
        error: derivedError,
        is_local: false,
        source: 'file-ipc',
    };
}

// 优先走 SessionRegistry(Node IPC,延迟 <10ms);如果 Registry 没启用或对应 agent
// 不在 Map 里,回退到文件 IPC(老 PM2 crawler 路径)。
async function sendViaSessionCommand(sessionId, type, payload) {
    const registry = getRegistry();
    const agentState = registry?.getAgentState(sessionId);

    // sync 阶段拒绝 audit(和老路径行为保持一致)
    const workerPhase = agentState?.worker?.phase || readSessionStatus(sessionId)?.worker?.phase;
    if (type === 'audit_recent_messages' && workerPhase === 'sync') {
        return {
            ok: false,
            error: 'session syncing',
            status_phase: workerPhase,
            retry_after_ms: 60000,
            routed_session_id: sessionId,
            routed_operator: payload?.operator || agentState?.owner || null,
        };
    }

    // Registry 路径:agent ready 时直接走 Node IPC
    if (registry?.isEnabled() && agentState?.ready) {
        const timeoutMs = type === 'audit_recent_messages' ? 60000 : 30000;
        const result = await registry.sendCommand(sessionId, type, payload, timeoutMs);
        return {
            ...result,
            routed_session_id: result?.routed_session_id || sessionId,
            routed_operator: result?.routed_operator || payload?.operator || agentState?.owner || null,
        };
    }

    // Fallback:文件 IPC(PM2 crawler 路径)
    const commandId = createSessionCommand(sessionId, {
        type,
        payload,
        phone: payload.phone,
        text: payload.text,
        caption: payload.caption || null,
        media_asset_id: payload.media_asset_id || null,
        operator: payload.operator || null,
        creator_id: payload.creator_id || null,
    });
    const timeoutMs = type === 'audit_recent_messages' ? 60000 : 30000;
    return await waitForSessionCommandResult(sessionId, commandId, timeoutMs);
}

async function sendRoutedMessage({ phone, text, session_id, operator, creator_id }) {
    const targetGuard = assertNoGroupSend(phone, { source: 'session_router.send_message' });
    if (!targetGuard.ok) return { ok: false, error: targetGuard.error };

    const resolved = await resolveSessionTarget({
        sessionId: session_id,
        operator,
        creatorId: creator_id,
        phone,
        allowFallback: false,
    });
    if (!resolved.session_id) {
        return { ok: false, error: 'No target session resolved' };
    }

    const result = await sendViaSessionCommand(resolved.session_id, 'send_message', {
        phone,
        text,
        operator: resolved.operator,
        creator_id,
    });
    return {
        ...result,
        routed_session_id: result?.routed_session_id || resolved.session_id,
        routed_operator: result?.routed_operator || resolved.operator,
    };
}

async function sendRoutedMedia({
    phone,
    caption = '',
    media_asset_id = null,
    media_path = null,
    media_url = null,
    mime_type = null,
    file_name = null,
    session_id,
    operator,
    creator_id,
}) {
    const targetGuard = assertNoGroupSend(phone, { source: 'session_router.send_media' });
    if (!targetGuard.ok) return { ok: false, error: targetGuard.error };

    const resolved = await resolveSessionTarget({
        sessionId: session_id,
        operator,
        creatorId: creator_id,
        phone,
        allowFallback: false,
    });
    if (!resolved.session_id) {
        return { ok: false, error: 'No target session resolved' };
    }

    const result = await sendViaSessionCommand(resolved.session_id, 'send_media', {
        phone,
        caption,
        media_asset_id,
        media_path,
        media_url,
        mime_type,
        file_name,
        operator: resolved.operator,
        creator_id,
    });
    return {
        ...result,
        routed_session_id: result?.routed_session_id || resolved.session_id,
        routed_operator: result?.routed_operator || resolved.operator,
    };
}

async function getRoutedStatus({ all = false, session_id = null, operator = null, creator_id = null } = {}) {
    if (all) {
        const sessions = getSessionRegistry().map(buildSessionStatus);
        return {
            sessions,
            summary: {
                total: sessions.length,
                ready: sessions.filter((item) => item.ready).length,
                waiting_for_qr: sessions.filter((item) => !item.ready && item.hasQr).length,
                errored: sessions.filter((item) => !!item.error).length,
            },
        };
    }

    const resolved = await resolveSessionTarget({
        sessionId: session_id,
        operator,
        creatorId: creator_id,
        allowFallback: false,
    });
    if (!resolved.target) {
        return { ok: false, ready: false, hasQr: false, error: 'No target session resolved' };
    }
    return buildSessionStatus(resolved.target);
}

async function getRoutedQr({ session_id, operator, creator_id }) {
    const resolved = await resolveSessionTarget({
        sessionId: session_id,
        operator,
        creatorId: creator_id,
        allowFallback: false,
    });
    if (!resolved.target) return null;
    const status = buildSessionStatus(resolved.target);
    return status?.qr_value || null;
}

async function reconcileRoutedContact({
    creator_id,
    phone,
    session_id,
    operator,
    fetch_limit = 500,
    full_dedup = true,
}) {
    const creatorId = Number(creator_id) || 0;
    const creatorRow = creatorId
        ? await creatorCache.getCreator(db.getDb(), creatorId, 'id, primary_name, wa_phone, wa_owner')
        : (phone
            ? await creatorCache.getCreatorByPhone(db.getDb(), phone, 'id, primary_name, wa_phone, wa_owner')
            : null);

    if (!creatorRow) {
        return { ok: false, error: 'Creator not found' };
    }
    if (!creatorRow.wa_phone) {
        return { ok: false, error: 'Creator has no wa_phone' };
    }

    const resolved = await resolveSessionTarget({
        sessionId: session_id,
        operator: operator || creatorRow.wa_owner,
        creatorId: creatorRow.id,
        phone: creatorRow.wa_phone,
        allowFallback: false,
    });
    if (!resolved.session_id) {
        return { ok: false, error: 'No target session resolved' };
    }

    const rawResult = await sendViaSessionCommand(resolved.session_id, 'audit_recent_messages', {
        phone: creatorRow.wa_phone,
        limit: Math.max(100, Math.min(parseInt(fetch_limit, 10) || 500, 2000)),
        operator: resolved.operator,
        creator_id: creatorRow.id,
    });
    if (!rawResult?.ok) {
        if (rawResult?.error === 'session syncing') {
            const queued = enqueueRepairJob(resolved.session_id, {
                creator_id: creatorRow.id,
                phone: creatorRow.wa_phone,
                operator: resolved.operator,
                fetch_limit,
                full_dedup,
            });
            return {
                ok: true,
                queued: true,
                queued_at: queued?.created_at || new Date().toISOString(),
                creator_id: creatorRow.id,
                creator_name: creatorRow.primary_name,
                wa_phone: creatorRow.wa_phone,
                routed_session_id: resolved.session_id,
                routed_operator: resolved.operator,
            };
        }
        return {
            ok: false,
            error: rawResult?.error || 'audit_recent_messages failed',
            routed_session_id: resolved.session_id,
            routed_operator: resolved.operator,
        };
    }

    const summary = await reconcileCreatorMessagesFromRaw({
        creatorId: creatorRow.id,
        creatorName: creatorRow.primary_name,
        operator: resolved.operator,
        sessionId: resolved.session_id,
        rawMessages: rawResult.messages || [],
        fullDedup: !!full_dedup,
        dryRun: false,
    });

    return {
        ok: true,
        creator_id: creatorRow.id,
        creator_name: creatorRow.primary_name,
        wa_phone: creatorRow.wa_phone,
        fetched_raw_count: Array.isArray(rawResult.messages) ? rawResult.messages.length : 0,
        reconciliation: summary,
        routed_session_id: resolved.session_id,
        routed_operator: resolved.operator,
    };
}

async function syncRoutedContact({
    creator_id,
    phone,
    session_id,
    operator,
    fetch_limit = 200,
    full_dedup = false,
}) {
    const creatorId = Number(creator_id) || 0;
    const creatorRow = creatorId
        ? await creatorCache.getCreator(db.getDb(), creatorId, 'id, primary_name, wa_phone, wa_owner')
        : (phone
            ? await creatorCache.getCreatorByPhone(db.getDb(), phone, 'id, primary_name, wa_phone, wa_owner')
            : null);

    if (!creatorRow) {
        return { ok: false, error: 'Creator not found' };
    }
    if (!creatorRow.wa_phone) {
        return { ok: false, error: 'Creator has no wa_phone' };
    }

    const resolved = await resolveSessionTarget({
        sessionId: session_id,
        operator: operator || creatorRow.wa_owner,
        creatorId: creatorRow.id,
        phone: creatorRow.wa_phone,
        allowFallback: false,
    });
    if (!resolved.session_id) {
        return { ok: false, error: 'No target session resolved' };
    }

    const rawResult = await sendViaSessionCommand(resolved.session_id, 'audit_recent_messages', {
        phone: creatorRow.wa_phone,
        limit: Math.max(50, Math.min(parseInt(fetch_limit, 10) || 200, 1000)),
        operator: resolved.operator,
        creator_id: creatorRow.id,
    });
    if (!rawResult?.ok) {
        return {
            ok: false,
            error: rawResult?.error || 'audit_recent_messages failed',
            routed_session_id: resolved.session_id,
            routed_operator: resolved.operator,
        };
    }

    const summary = await syncCreatorMessagesFromRaw({
        creatorId: creatorRow.id,
        creatorName: creatorRow.primary_name,
        operator: resolved.operator,
        sessionId: resolved.session_id,
        rawMessages: rawResult.messages || [],
        fullDedup: !!full_dedup,
        dryRun: false,
    });

    return {
        ok: true,
        creator_id: creatorRow.id,
        creator_name: creatorRow.primary_name,
        wa_phone: creatorRow.wa_phone,
        fetched_raw_count: Array.isArray(rawResult.messages) ? rawResult.messages.length : 0,
        synchronization: summary,
        routed_session_id: resolved.session_id,
        routed_operator: resolved.operator,
    };
}

async function replaceRoutedContact({
    creator_id,
    phone,
    session_id,
    operator,
    fetch_limit = 800,
    force = false,
    delete_all = false,
    full_dedup = true,
}) {
    const creatorId = Number(creator_id) || 0;
    const creatorRow = creatorId
        ? await creatorCache.getCreator(db.getDb(), creatorId, 'id, primary_name, wa_phone, wa_owner')
        : (phone
            ? await creatorCache.getCreatorByPhone(db.getDb(), phone, 'id, primary_name, wa_phone, wa_owner')
            : null);

    if (!creatorRow) {
        return { ok: false, error: 'Creator not found' };
    }
    if (!creatorRow.wa_phone) {
        return { ok: false, error: 'Creator has no wa_phone' };
    }

    const resolved = await resolveSessionTarget({
        sessionId: session_id,
        operator: operator || creatorRow.wa_owner,
        creatorId: creatorRow.id,
        phone: creatorRow.wa_phone,
        allowFallback: false,
    });
    if (!resolved.session_id) {
        return { ok: false, error: 'No target session resolved' };
    }

    const rawResult = await sendViaSessionCommand(resolved.session_id, 'audit_recent_messages', {
        phone: creatorRow.wa_phone,
        limit: Math.max(200, Math.min(parseInt(fetch_limit, 10) || 800, 2000)),
        operator: resolved.operator,
        creator_id: creatorRow.id,
    });
    if (!rawResult?.ok) {
        return {
            ok: false,
            error: rawResult?.error || 'audit_recent_messages failed',
            routed_session_id: resolved.session_id,
            routed_operator: resolved.operator,
        };
    }

    const rawMessages = Array.isArray(rawResult.messages) ? rawResult.messages : [];
    const rawCount = rawMessages.length;
    if (rawCount === 0) {
        return {
            ok: false,
            error: 'No raw messages fetched',
            routed_session_id: resolved.session_id,
            routed_operator: resolved.operator,
        };
    }

    const timestamps = rawMessages
        .map((message) => Number(message?.timestamp) || 0)
        .filter((ts) => ts > 0)
        .sort((a, b) => a - b);
    if (timestamps.length === 0) {
        return {
            ok: false,
            error: 'Raw messages missing timestamps',
            routed_session_id: resolved.session_id,
            routed_operator: resolved.operator,
        };
    }

    const minTs = Math.max(0, timestamps[0] - 12 * 60 * 60 * 1000);
    const maxTs = timestamps[timestamps.length - 1] + 12 * 60 * 60 * 1000;
    const existingRow = delete_all
        ? await db.getDb().prepare(`
            SELECT COUNT(*) AS count
            FROM wa_messages
            WHERE creator_id = ?
        `).get(creatorRow.id)
        : await db.getDb().prepare(`
            SELECT COUNT(*) AS count
            FROM wa_messages
            WHERE creator_id = ?
              AND timestamp BETWEEN ? AND ?
        `).get(creatorRow.id, minTs, maxTs);
    const existingCount = Number(existingRow?.count) || 0;
    const minAllowed = Math.max(20, Math.floor(existingCount * 0.6));
    if (!force && rawCount < minAllowed) {
        return {
            ok: false,
            error: 'Raw messages too few to safely replace',
            fetched_raw_count: rawCount,
            existing_count: existingCount,
            min_required: minAllowed,
            routed_session_id: resolved.session_id,
            routed_operator: resolved.operator,
        };
    }

    const summary = await replaceCreatorMessagesFromRaw({
        creatorId: creatorRow.id,
        creatorName: creatorRow.primary_name,
        operator: resolved.operator,
        sessionId: resolved.session_id,
        rawMessages,
        rawFetchLimit: Math.max(200, Math.min(parseInt(fetch_limit, 10) || 800, 2000)),
        deleteAll: delete_all,
        allowPartialWindowReplace: !!force,
        fullDedup: !!full_dedup,
        dryRun: false,
    });
    if (summary?.applied === false) {
        return {
            ok: false,
            error: 'Raw slice may be truncated; unsafe window replace skipped',
            fetched_raw_count: rawCount,
            existing_count: summary.existing_count,
            skipped_reason: summary.skipped_reason,
            replacement: summary,
            forced: !!force,
            delete_all: !!delete_all,
            routed_session_id: resolved.session_id,
            routed_operator: resolved.operator,
        };
    }

    return {
        ok: true,
        creator_id: creatorRow.id,
        creator_name: creatorRow.primary_name,
        wa_phone: creatorRow.wa_phone,
        fetched_raw_count: rawCount,
        replacement: summary,
        forced: !!force,
        delete_all: !!delete_all,
        routed_session_id: resolved.session_id,
        routed_operator: resolved.operator,
    };
}

startRepairQueueWorker();

module.exports = {
    getRoutedQr,
    getRoutedStatus,
    getSessionRegistry,
    reconcileRoutedContact,
    syncRoutedContact,
    replaceRoutedContact,
    resolveSessionTarget,
    sendRoutedMessage,
    sendRoutedMedia,
};
