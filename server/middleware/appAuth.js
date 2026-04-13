/**
 * appAuth — API auth guard for sensitive routes
 * Accepts any token from configured envs, via Authorization: Bearer <token>.
 */
const AUTH_TOKEN_ENV_KEYS = [
    'API_AUTH_TOKEN',
    'CRM_ADMIN_TOKEN',
    'WA_ADMIN_TOKEN',
    'AI_PROXY_TOKEN',
];
let warnedForBypass = false;

function isLocalRequest(req) {
    const candidates = [
        req.ip,
        req.socket?.remoteAddress,
        req.connection?.remoteAddress,
        req.hostname,
    ].filter(Boolean).map((value) => String(value).trim().toLowerCase());

    const isPrivateLan = (value) => (
        /^192\.168\.\d{1,3}\.\d{1,3}$/.test(value)
        || /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(value)
        || /^172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}$/.test(value)
        || /^::ffff:192\.168\.\d{1,3}\.\d{1,3}$/.test(value)
        || /^::ffff:10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(value)
        || /^::ffff:172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}$/.test(value)
    );

    return candidates.some((value) => (
        value === '127.0.0.1'
        || value === '::1'
        || value === '::ffff:127.0.0.1'
        || value === 'localhost'
        || isPrivateLan(value)
    ));
}

function getAllowedTokens() {
    return AUTH_TOKEN_ENV_KEYS
        .map((key) => process.env[key])
        .filter((value) => typeof value === 'string' && value.trim().length > 0)
        .map((value) => value.trim());
}

function extractToken(req) {
    const authHeader = String(req.headers.authorization || '');
    if (authHeader.startsWith('Bearer ')) {
        return authHeader.slice(7).trim();
    }
    const queryToken = typeof req.query?.token === 'string'
        ? req.query.token.trim()
        : '';
    return queryToken;
}

function requireAppAuth(req, res, next) {
    const allowed = getAllowedTokens();
    const allowLocalBypass = process.env.LOCAL_API_AUTH_BYPASS !== 'false';

    if (process.env.NODE_ENV !== 'production' && allowLocalBypass && isLocalRequest(req)) {
        if (!warnedForBypass) {
            warnedForBypass = true;
            console.warn('[appAuth] localhost bypass enabled outside production');
        }
        return next();
    }

    if (allowed.length === 0) {
        if (process.env.NODE_ENV !== 'production') {
            if (!warnedForBypass) {
                warnedForBypass = true;
                console.warn('[appAuth] no auth token configured; bypass enabled outside production');
            }
            return next();
        }
        return res.status(503).json({ error: 'API auth not configured' });
    }
    const token = extractToken(req);
    if (!token || !allowed.includes(token)) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
}

module.exports = { requireAppAuth, getAllowedTokens };
