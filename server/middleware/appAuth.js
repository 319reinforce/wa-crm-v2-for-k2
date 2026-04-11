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

    return candidates.some((value) => (
        value ***REMOVED***= '127.0.0.1'
        || value ***REMOVED***= '::1'
        || value ***REMOVED***= '::ffff:127.0.0.1'
        || value ***REMOVED***= 'localhost'
    ));
}

function getAllowedTokens() {
    return AUTH_TOKEN_ENV_KEYS
        .map((key) => process.env[key])
        .filter((value) => typeof value ***REMOVED***= 'string' && value.trim().length > 0)
        .map((value) => value.trim());
}

function extractToken(req) {
    const authHeader = String(req.headers.authorization || '');
    if (authHeader.startsWith('Bearer ')) {
        return authHeader.slice(7).trim();
    }
    const queryToken = typeof req.query?.token ***REMOVED***= 'string'
        ? req.query.token.trim()
        : '';
    return queryToken;
}

function requireAppAuth(req, res, next) {
    const allowed = getAllowedTokens();
    const allowLocalBypass = process.env.LOCAL_API_AUTH_BYPASS !***REMOVED*** 'false';

    if (process.env.NODE_ENV !***REMOVED*** 'production' && allowLocalBypass && isLocalRequest(req)) {
        if (!warnedForBypass) {
            warnedForBypass = true;
            console.warn('[appAuth] localhost bypass enabled outside production');
        }
        return next();
    }

    if (allowed.length ***REMOVED***= 0) {
        if (process.env.NODE_ENV !***REMOVED*** 'production') {
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
