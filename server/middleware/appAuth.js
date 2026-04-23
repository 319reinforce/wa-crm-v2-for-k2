/**
 * appAuth — API auth guard for sensitive routes
 * Supports:
 * - global admin tokens
 * - owner-scoped tokens (locked to one operator/session)
 */
const { normalizeOperatorName } = require('../utils/operator');
const { getInternalServiceTokenEntry } = require('../utils/internalAuth');
const sessionRepository = require('../services/sessionRepository');
const userSessionRepo = require('../services/userSessionRepo');

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
    const role = entry.role || (owner ? 'owner' : 'admin');
    const source = entry.source || 'env';
    // operator: owner 锁贯穿读+写;viewer: 只锁写(跨 owner 可读);admin: 不锁
    const writeOwnerLocked = !!owner && (role === 'operator' || role === 'viewer' || role === 'owner');
    const readOwnerLocked = !!owner && role !== 'viewer' && role !== 'admin';
    return {
        token: entry.token || '',
        token_key: entry.key || '',
        username: String(entry.username || owner || 'authorized').trim() || 'authorized',
        owner,
        session_id: sessionId,
        owner_locked: readOwnerLocked || writeOwnerLocked,
        owner_locked_read: readOwnerLocked,
        owner_locked_write: writeOwnerLocked,
        role,
        source,                            // 'db' (DB session) | 'env' (env token)
        token_principal: entry.token_principal || entry.username || entry.key || null,
        user_id: entry.user_id || null,    // DB session 时有,env token 时 null
    };
}

// 从 DB session 构造 req.auth 所需 entry
// operator / viewer 都绑定 operator_name;admin 不绑。
// viewer 的读隔离通过 getLockedOwner 的 HTTP 方法感知来解锁(只在写方法时生效)。
function entryFromDbSession({ sessionRow, token }) {
    const role = sessionRow.user.role;
    const operatorName = (role === 'operator' || role === 'viewer')
        ? normalizeOperatorName(sessionRow.user.operator_name, null)
        : null;
    return {
        key: 'DB_SESSION',
        token,
        username: sessionRow.user.username,
        owner: operatorName,
        session_id: null,
        role,
        source: 'db',
        token_principal: sessionRow.user.username,
        user_id: sessionRow.user.id,
    };
}

// HTTP 安全方法(读取类)
const SAFE_HTTP_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function isSafeMethod(req) {
    return SAFE_HTTP_METHODS.has(String(req?.method || '').toUpperCase());
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

// 返回当前请求应受限于的 owner;null 表示跨 owner 放行。
// - admin:始终 null(不受限)
// - operator:始终返回 operator_name
// - viewer:GET/HEAD/OPTIONS 返回 null(可跨 owner 读),其他方法返回 operator_name(只能写自己的)
function getLockedOwner(req) {
    const owner = normalizeOperatorName(req?.auth?.owner, null);
    if (!owner) return null;
    const role = String(req?.auth?.role || '').toLowerCase();
    if (role === 'viewer' && isSafeMethod(req)) return null;
    return owner;
}

// 只关心"写层面"的 owner 约束:viewer 即使是读,也要知道他的归属以便前端判断
function getWriteLockedOwner(req) {
    return normalizeOperatorName(req?.auth?.owner, null);
}

// session_id 用于决定"通过哪个 WA session 发送",对写操作有意义。
// viewer 即使在读路径也可能需要拿到自己的 session_id(理论上读不依赖,但保持语义稳定):
// 始终用 write-locked owner 查询,避免 viewer 读时返回 null 引发下游意外。
function getLockedSessionId(req) {
    const owner = getWriteLockedOwner(req);
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

function attachAuth(req, entry) {
    req.auth = buildAuthContext(entry);
    req.user = {
        name: req.auth.username,
        owner: req.auth.owner,
        owner_locked: req.auth.owner_locked,
        session_id: req.auth.session_id,
    };
}

async function requireAppAuth(req, res, next) {
    const allowLocalBypass = process.env.LOCAL_API_AUTH_BYPASS === 'true';

    if (process.env.NODE_ENV !== 'production' && allowLocalBypass && isLocalRequest(req)) {
        if (!warnedForBypass) {
            warnedForBypass = true;
            console.warn('[appAuth] localhost bypass enabled outside production');
        }
        attachAuth(req, {
            key: 'LOCAL_BYPASS',
            token: '',
            username: 'local-bypass',
            role: 'admin',
            source: 'env',
            token_principal: 'LOCAL_BYPASS',
        });
        return next();
    }

    const token = extractToken(req);
    if (!token) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    // 先查 DB session(人类用户,per-user token)
    try {
        const sessionRow = await userSessionRepo.findActiveSessionByToken(token);
        if (sessionRow) {
            attachAuth(req, entryFromDbSession({ sessionRow, token }));
            return next();
        }
    } catch (err) {
        console.error('[appAuth] DB session lookup failed:', err?.message || err);
        // fall through to env token 匹配,不让 DB 故障把 service 也挡住
    }

    // 回退到 env token(service/admin env/owner-locked env)
    const envEntry = getTokenEntryByToken(token);
    if (envEntry) {
        attachAuth(req, { ...envEntry, source: 'env', token_principal: envEntry.key });
        return next();
    }

    return res.status(401).json({ error: 'Unauthorized' });
}

// 人类管理员专属(users CRUD / policy 写 / audit 管理视图)
function requireHumanAdmin(req, res, next) {
    if (req?.auth?.source === 'db' && req?.auth?.role === 'admin') {
        return next();
    }
    return res.status(403).json({
        ok: false,
        error: 'Forbidden: human admin required (DB-backed session)',
    });
}

// 销毁性 admin-only 门禁（Phase 1a）：拒绝 owner-scoped token + service token。
// 只看 req.auth.role === 'admin'；必须挂在 requireAppAuth 之后，req.auth 由其填充。
// 与 requireHumanAdmin 的区别：这里不强制 source === 'db'（env 层将来若出现 admin
// 角色也应放行，而目前 buildTokenEntries 里 env 只出 role='service'，行为等价）。
function requireAdminOnly(req, res, next) {
    if (req?.auth?.role === 'admin') return next();
    return res.status(403).json({
        ok: false,
        error: 'Forbidden: admin role required',
    });
}

// 管理员 or 内部服务(waSessions 跨 owner 动作 / training 触发)
function requireAdminOrService(req, res, next) {
    const a = req?.auth;
    if (!a) return res.status(401).json({ error: 'Unauthorized' });
    if (a.source === 'db' && a.role === 'admin') return next();
    if (a.source === 'env' && a.role === 'service') return next();
    return res.status(403).json({
        ok: false,
        error: 'Forbidden: admin or service role required',
    });
}

module.exports = {
    APP_AUTH_COOKIE_NAME,
    APP_AUTH_COOKIE_MAX_AGE_SECONDS,
    requireAppAuth,
    requireHumanAdmin,
    requireAdminOnly,
    requireAdminOrService,
    getAllowedTokens,
    getPrimaryLoginTokenEntry,
    getLockedOwner,
    getWriteLockedOwner,
    getLockedSessionId,
    isSafeMethod,
    matchesOwnerScope,
    resolveScopedOwner,
    sendOwnerScopeForbidden,
    setAppAuthCookie,
    clearAppAuthCookie,
};
