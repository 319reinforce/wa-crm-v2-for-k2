const db = require('../../db');
const { normalizeOperatorName } = require('../utils/operator');
const { getStatus, getQrValue, sendMessage, sendMedia } = require('./waService');
const { reconcileCreatorMessagesFromRaw, syncCreatorMessagesFromRaw } = require('./waMessageRepairService');
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
    if (value === null || value === undefined) return null;
    const raw = String(value).trim();
    if (!raw) return null;
    const safe = sanitizeSessionId(raw, '');
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

async function resolveOperator({ creatorId, operator, phone }) {
    const explicit = normalizeOperatorName(operator, operator);
    if (explicit) return explicit;

    if (creatorId) {
        const assignment = await getAssignmentByCreatorId(creatorId);
        if (assignment?.operator) return normalizeOperatorName(assignment.operator, assignment.operator);

        const row = await db.getDb().prepare('SELECT wa_owner FROM creators WHERE id = ?').get(creatorId);
        const ownerById = normalizeOperatorName(row?.wa_owner, row?.wa_owner || null);
        if (ownerById) return ownerById;
    }

    if (phone) {
        const row = await db.getDb().prepare('SELECT wa_owner FROM creators WHERE wa_phone = ? LIMIT 1').get(phone);
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

async function sendViaSessionCommand(sessionId, type, payload) {
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

async function sendRoutedMessage({ phone, text, session_id, operator, creator_id }, { bypass = false } = {}) {
    if (bypass) {
        return sendMessage(phone, text);
    }

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
}, { bypass = false } = {}) {
    if (bypass) {
        return sendMedia(phone, {
            caption,
            media_path,
            media_url,
            mime_type,
            file_name,
        });
    }

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
        allowFallback: false,
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
}, { bypass = false } = {}) {
    const creatorId = Number(creator_id) || 0;
    const creatorRow = creatorId
        ? await db.getDb().prepare('SELECT id, primary_name, wa_phone, wa_owner FROM creators WHERE id = ? LIMIT 1').get(creatorId)
        : (phone
            ? await db.getDb().prepare('SELECT id, primary_name, wa_phone, wa_owner FROM creators WHERE wa_phone = ? LIMIT 1').get(phone)
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
        rawMessages: rawResult.messages || [],
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
        bypass: !!bypass,
    };
}

async function syncRoutedContact({
    creator_id,
    phone,
    session_id,
    operator,
    fetch_limit = 200,
}, { bypass = false } = {}) {
    const creatorId = Number(creator_id) || 0;
    const creatorRow = creatorId
        ? await db.getDb().prepare('SELECT id, primary_name, wa_phone, wa_owner FROM creators WHERE id = ? LIMIT 1').get(creatorId)
        : (phone
            ? await db.getDb().prepare('SELECT id, primary_name, wa_phone, wa_owner FROM creators WHERE wa_phone = ? LIMIT 1').get(phone)
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
        rawMessages: rawResult.messages || [],
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
        bypass: !!bypass,
    };
}

module.exports = {
    getRoutedQr,
    getRoutedStatus,
    getSessionRegistry,
    reconcileRoutedContact,
    syncRoutedContact,
    resolveSessionTarget,
    sendRoutedMessage,
    sendRoutedMedia,
};
