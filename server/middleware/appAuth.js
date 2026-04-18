/**
 * appAuth — API auth guard for sensitive routes
 * Supports:
 * - global admin tokens
 * - owner-scoped tokens (locked to one operator/session)
 */
const { normalizeOperatorName } = require('../utils/operator');
const { getInternalServiceTokenEntry } = require('../utils/internalAuth');
const sessionRepository = require('../services/sessionRepository');

const ADMIN_TOKEN_ENV_KEYS = [
    'API_AUTH_TOKEN',
    'CRM_ADMIN_TOKEN',
    'WA_ADMIN_TOKEN',
];

const OWNER_SCOPED_TOKEN_CONFIGS = [
    { key: 'BEAU_ACCESS_TOKEN', owner: 'Beau' },
    { key: 'YIYUN_ACCESS_TOKEN', owner: 'Yiyun' },
    { key: 'JIAWEN_ACCESS_TOKEN', owner: 'Jiawen' },
];

const APP_AUTH_COOKIE_NAME = 'wa_crm_app_auth';
const APP_AUTH_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 12;

let warnedForBypass = false;

function isLocalRequest(req) {
    const candidates = [
        req.ip,
        req.socket?.remoteAddress,
        req.connection?.remoteAddress,
        req.hostname,
    ].filter(Boolean).map((value) => String(value).trim().toLowerCase());

    return candidates.some((value) => (
        value === '127.0.0.1'
        || value === '::1'
        || value === '::ffff:127.0.0.1'
        || value === 'localhost'
    ));
}

// 运行时从 wa_sessions 表(in-memory 缓存)查 owner → session_id;
// 缓存未 warm 时回退到 owner 小写作为兜底(通常只在 startup 前几百毫秒发生)
function getSessionIdForOwner(owner) {
    const normalizedOwner = normalizeOperatorName(owner, null);
    if (!normalizedOwner) return null;
    const cached = sessionRepository.getActiveSessionIdByOwnerCached(normalizedOwner);
    if (cached) return cached;
    return String(normalizedOwner).trim().toLowerCase() || null;
}

let _tokenEntriesCache = null;

function buildTokenEntries() {
    if (_tokenEntriesCache) return _tokenEntriesCache;
    const seen = new Set();
    const entries = [];

    for (const key of ADMIN_TOKEN_ENV_KEYS) {
        const token = String(process.env[key] || '').trim();
        if (!token || seen.has(token)) continue;
        seen.add(token);
        entries.push({
            key,
            token,
            owner: null,
            session_id: null,
            username: String(process.env.APP_LOGIN_USERNAME || '').trim() || 'authorized',
            role: 'admin',
        });
    }

    for (const item of OWNER_SCOPED_TOKEN_CONFIGS) {
        const token = String(process.env[item.key] || '').trim();
        if (!token || seen.has(token)) continue;
        const owner = normalizeOperatorName(item.owner, item.owner);
        seen.add(token);
        entries.push({
            key: item.key,
            token,
            owner,
            session_id: getSessionIdForOwner(owner),
            username: owner || 'owner',
            role: 'owner',
        });
    }

    const internalTokenEntry = getInternalServiceTokenEntry();
    if (internalTokenEntry && !seen.has(internalTokenEntry.token)) {
        seen.add(internalTokenEntry.token);
        entries.push({
            key: internalTokenEntry.key,
            token: internalTokenEntry.token,
            owner: null,
            session_id: null,
            username: 'internal-service',
            role: 'service',
        });
    }

    _tokenEntriesCache = entries;
    return entries;
}

function getTokenEntryByToken(token) {
    const normalized = String(token || '').trim();
    if (!normalized) return null;
    return buildTokenEntries().find((item) => item.token === normalized) || null;
}

function getAllowedTokens() {
    return buildTokenEntries().map((item) => item.token);
}

function getPrimaryLoginTokenEntry() {
    return buildTokenEntries().find((item) => item.role === 'admin') || null;
}

function buildAuthContext(entry = {}) {
    const owner = normalizeOperatorName(entry.owner, null);
    const sessionId = String(entry.session_id || getSessionIdForOwner(owner) || '').trim() || null;
    return {
        token: entry.token || '',
        token_key: entry.key || '',
        username: String(entry.username || owner || 'authorized').trim() || 'authorized',
        owner,
        session_id: sessionId,
        owner_locked: !!owner,
        role: entry.role || (owner ? 'owner' : 'admin'),
    };
}

function parseCookies(headerValue) {
    const header = String(headerValue || '').trim();
    if (!header) return {};
    return header.split(';').reduce((cookies, pair) => {
        const [rawName, ...rest] = pair.split('=');
        const name = String(rawName || '').trim();
        if (!name) return cookies;
        const rawValue = rest.join('=').trim();
        try {
            cookies[name] = decodeURIComponent(rawValue);
        } catch (_) {
            cookies[name] = rawValue;
        }
        return cookies;
    }, {});
}

function extractToken(req) {
    const authHeader = String(req.headers.authorization || '');
    if (authHeader.startsWith('Bearer ')) {
        return authHeader.slice(7).trim();
    }
    const cookies = parseCookies(req.headers.cookie);
    return String(cookies[APP_AUTH_COOKIE_NAME] || '').trim();
}

function buildCookieAttributes(maxAgeSeconds) {
    const parts = [
        'Path=/',
        'HttpOnly',
        'SameSite=Strict',
    ];
    if (process.env.NODE_ENV === 'production') {
        parts.push('Secure');
    }
    if (Number.isFinite(maxAgeSeconds)) {
        parts.push(`Max-Age=${maxAgeSeconds}`);
    }
    return parts.join('; ');
}

function setAppAuthCookie(res, token) {
    const normalizedToken = String(token || '').trim();
    if (!normalizedToken) {
        return clearAppAuthCookie(res);
    }
    res.setHeader(
        'Set-Cookie',
        `${APP_AUTH_COOKIE_NAME}=${encodeURIComponent(normalizedToken)}; ${buildCookieAttributes(APP_AUTH_COOKIE_MAX_AGE_SECONDS)}`
    );
}

function clearAppAuthCookie(res) {
    res.setHeader(
        'Set-Cookie',
        `${APP_AUTH_COOKIE_NAME}=; ${buildCookieAttributes(0)}; Expires=Thu, 01 Jan 1970 00:00:00 GMT`
    );
}

function getLockedOwner(req) {
    return normalizeOperatorName(req?.auth?.owner, null);
}

function getLockedSessionId(req) {
    const owner = getLockedOwner(req);
    return String(req?.auth?.session_id || getSessionIdForOwner(owner) || '').trim() || null;
}

function matchesOwnerScope(req, owner) {
    const lockedOwner = getLockedOwner(req);
    if (!lockedOwner) return true;
    return normalizeOperatorName(owner, null) === lockedOwner;
}

function resolveScopedOwner(req, owner, fallback = null) {
    return getLockedOwner(req) || normalizeOperatorName(owner, fallback);
}

function sendOwnerScopeForbidden(res, lockedOwner) {
    return res.status(403).json({
        ok: false,
        error: lockedOwner
            ? `Forbidden: token locked to owner ${lockedOwner}`
            : 'Forbidden',
    });
}

function requireAppAuth(req, res, next) {
    const allowLocalBypass = process.env.LOCAL_API_AUTH_BYPASS === 'true';

    if (process.env.NODE_ENV !== 'production' && allowLocalBypass && isLocalRequest(req)) {
        if (!warnedForBypass) {
            warnedForBypass = true;
            console.warn('[appAuth] localhost bypass enabled outside production');
        }
        req.auth = buildAuthContext({
            key: 'LOCAL_BYPASS',
            token: '',
            username: 'local-bypass',
            role: 'admin',
        });
        req.user = {
            name: req.auth.username,
            owner: req.auth.owner,
            owner_locked: req.auth.owner_locked,
            session_id: req.auth.session_id,
        };
        return next();
    }

    const allowed = getAllowedTokens();
    if (allowed.length === 0) {
        return res.status(503).json({ error: 'API auth not configured' });
    }
    const token = extractToken(req);
    const entry = getTokenEntryByToken(token);
    if (!entry) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    req.auth = buildAuthContext(entry);
    req.user = {
        name: req.auth.username,
        owner: req.auth.owner,
        owner_locked: req.auth.owner_locked,
        session_id: req.auth.session_id,
    };
    next();
}

module.exports = {
    APP_AUTH_COOKIE_NAME,
    APP_AUTH_COOKIE_MAX_AGE_SECONDS,
    requireAppAuth,
    getAllowedTokens,
    getPrimaryLoginTokenEntry,
    getLockedOwner,
    getLockedSessionId,
    matchesOwnerScope,
    resolveScopedOwner,
    sendOwnerScopeForbidden,
    setAppAuthCookie,
    clearAppAuthCookie,
};
