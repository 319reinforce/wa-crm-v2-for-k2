const db = require('../../db');
const { normalizeOperatorName } = require('../utils/operator');
const { getStatus, getQrValue, sendMessage } = require('./waService');
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

const SESSION_ALIASES = {
    beau: 'beau',
    yiyun: 'yiyun',
    jiawen: 'jiawen',
    sybil: 'jiawen',
    youke: 'youke',
    wangyouke: 'youke',
};
const STATUS_STALE_MS = 15000;

function normalizeSessionId(value) {
    const safe = sanitizeSessionId(value || '');
    const normalized = String(safe || '').trim().toLowerCase();
    if (!normalized) return null;
    return SESSION_ALIASES[normalized] || normalized;
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
    for (const item of [...getDefaultTargets(), ...parseRemoteTargets()]) {
        if (!item?.session_id) continue;
        if (!map.has(item.session_id)) {
            map.set(item.session_id, {
                session_id: item.session_id,
                owner: item.owner || null,
            });
        }
    }

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

async function resolveOperator({ creatorId, operator }) {
    const explicit = normalizeOperatorName(operator, operator);
    if (explicit) return explicit;

    if (!creatorId) return null;

    const assignment = await getAssignmentByCreatorId(creatorId);
    if (assignment?.operator) return normalizeOperatorName(assignment.operator, assignment.operator);

    const row = await db.getDb().prepare('SELECT wa_owner FROM creators WHERE id = ?').get(creatorId);
    return normalizeOperatorName(row?.wa_owner, row?.wa_owner || null);
}

async function resolveSessionTarget({ sessionId, operator, creatorId }) {
    const registry = getSessionRegistry();
    const explicitSessionId = normalizeSessionId(sessionId);
    const resolvedOperator = await resolveOperator({ creatorId, operator });
    const operatorSessionId = normalizeSessionId(getSessionIdForOperator(resolvedOperator));

    const desiredSessionId = explicitSessionId || operatorSessionId;
    const target = desiredSessionId
        ? registry.find((item) => item.session_id ***REMOVED***= desiredSessionId) || null
        : (resolvedOperator
            ? registry.find((item) => normalizeOperatorName(item.owner, item.owner) ***REMOVED***= resolvedOperator) || null
            : null);

    const fallback = target || registry[0] || null;
    return {
        operator: resolvedOperator || fallback?.owner || null,
        session_id: desiredSessionId || fallback?.session_id || null,
        target: fallback,
        registry,
    };
}

function buildSessionStatus(session) {
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
    };
}

async function sendViaSessionCommand(sessionId, payload) {
    const commandId = createSessionCommand(sessionId, {
        type: 'send_message',
        payload,
        phone: payload.phone,
        text: payload.text,
        operator: payload.operator || null,
        creator_id: payload.creator_id || null,
    });
    return await waitForSessionCommandResult(sessionId, commandId, 30000);
}

async function sendRoutedMessage({ phone, text, session_id, operator, creator_id }, { bypass = false } = {}) {
    if (bypass) {
        return sendMessage(phone, text);
    }

    const resolved = await resolveSessionTarget({
        sessionId: session_id,
        operator,
        creatorId: creator_id,
    });
    if (!resolved.session_id) {
        return { ok: false, error: 'No target session resolved' };
    }

    const result = await sendViaSessionCommand(resolved.session_id, {
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

async function getRoutedStatus({ all = false, session_id = null, operator = null, creator_id = null } = {}) {
    if (!all && !session_id && !operator && !creator_id) {
        return {
            ...getStatus(),
            is_local: true,
        };
    }

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
    });
    if (!resolved.target) {
        return { ok: false, ready: false, hasQr: false, error: 'No target session resolved' };
    }
    return buildSessionStatus(resolved.target);
}

async function getRoutedQr({ session_id, operator, creator_id }, { bypass = false } = {}) {
    if (bypass) return getQrValue();

    const resolved = await resolveSessionTarget({
        sessionId: session_id,
        operator,
        creatorId: creator_id,
    });
    if (!resolved.target) return null;
    const status = buildSessionStatus(resolved.target);
    return status?.qr_value || null;
}

module.exports = {
    getRoutedQr,
    getRoutedStatus,
    getSessionRegistry,
    resolveSessionTarget,
    sendRoutedMessage,
};
