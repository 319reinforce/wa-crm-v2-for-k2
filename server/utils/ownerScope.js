const {
    getLockedOwner,
    matchesOwnerScope,
    resolveScopedOwner,
    sendOwnerScopeForbidden,
} = require('../middleware/appAuth');
const { normalizeOperatorName } = require('./operator');
const creatorCache = require('../services/creatorCache');

async function findCreatorByClientId(dbConn, clientId, fields = 'id, wa_owner') {
    const normalizedClientId = String(clientId || '').trim();
    if (!normalizedClientId) return null;
    return await creatorCache.getCreatorByPhone(dbConn, normalizedClientId, fields);
}

async function ensureClientScope(req, res, dbConn, clientId, options = {}) {
    const {
        required = false,
        fieldName = 'client_id',
        fields = 'id, wa_owner',
        notFoundMessage = 'Creator not found for client_id',
    } = options;
    const normalizedClientId = String(clientId || '').trim();
    const lockedOwner = getLockedOwner(req);

    if (!normalizedClientId) {
        if (required) {
            res.status(400).json({ ok: false, error: `${fieldName} required` });
            return { ok: false };
        }
        return {
            ok: true,
            clientId: '',
            row: null,
            owner: null,
            lockedOwner,
        };
    }

    const row = await findCreatorByClientId(dbConn, normalizedClientId, fields);
    if (!row) {
        res.status(404).json({ ok: false, error: notFoundMessage });
        return { ok: false };
    }

    const owner = normalizeOperatorName(row.wa_owner, row.wa_owner);
    if (lockedOwner && !matchesOwnerScope(req, owner)) {
        sendOwnerScopeForbidden(res, lockedOwner);
        return { ok: false };
    }

    return {
        ok: true,
        clientId: normalizedClientId,
        row,
        owner,
        lockedOwner,
    };
}

function resolveRequestedOwnerScope(req, res, requestedOwner, fallback = null) {
    const lockedOwner = getLockedOwner(req);
    const normalizedRequestedOwner = normalizeOperatorName(requestedOwner, null);

    if (lockedOwner && normalizedRequestedOwner && !matchesOwnerScope(req, normalizedRequestedOwner)) {
        sendOwnerScopeForbidden(res, lockedOwner);
        return { ok: false, owner: null, requestedOwner: normalizedRequestedOwner };
    }

    return {
        ok: true,
        owner: resolveScopedOwner(req, normalizedRequestedOwner, fallback),
        requestedOwner: normalizedRequestedOwner,
        lockedOwner,
    };
}

async function resolveClientAndOwnerScope(req, res, dbConn, options = {}) {
    const {
        clientId,
        requestedOwner,
        clientRequired = false,
        clientFieldName = 'client_id',
        ownerFieldName = 'operator',
        clientFields = 'id, wa_owner',
        notFoundMessage = 'Creator not found for client_id',
    } = options;

    const clientScope = await ensureClientScope(req, res, dbConn, clientId, {
        required: clientRequired,
        fieldName: clientFieldName,
        fields: clientFields,
        notFoundMessage,
    });
    if (!clientScope.ok) {
        return { ok: false };
    }

    const ownerScope = resolveRequestedOwnerScope(req, res, requestedOwner, clientScope.owner || null);
    if (!ownerScope.ok) {
        return { ok: false };
    }

    if (clientScope.owner && ownerScope.requestedOwner && clientScope.owner !== ownerScope.requestedOwner) {
        res.status(400).json({
            ok: false,
            error: `${ownerFieldName} does not match client owner`,
        });
        return { ok: false };
    }

    return {
        ok: true,
        clientScope,
        owner: clientScope.owner || ownerScope.owner,
        requestedOwner: ownerScope.requestedOwner,
        lockedOwner: clientScope.lockedOwner || ownerScope.lockedOwner,
    };
}

function hasPrivilegedRole(req) {
    const role = String(req?.auth?.role || '').trim().toLowerCase();
    return role === 'admin' || role === 'service';
}

module.exports = {
    sendOwnerScopeForbidden,
    findCreatorByClientId,
    ensureClientScope,
    resolveRequestedOwnerScope,
    resolveClientAndOwnerScope,
    hasPrivilegedRole,
};
