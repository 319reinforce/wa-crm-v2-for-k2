const PHONE_LIKE_PATTERN = /(\+?\d[\d\s().-]{8,}\d)/g;
const REDACTED = '[REDACTED]';

function normalizeLevel(level) {
    const normalized = String(level || '').toLowerCase();
    if (normalized === 'error' || normalized === 'warn' || normalized === 'info' || normalized === 'debug') {
        return normalized;
    }
    return 'info';
}

function sanitizeScalar(value) {
    if (typeof value !== 'string') return value;
    return value.replace(PHONE_LIKE_PATTERN, REDACTED);
}

function sanitizeLogValue(value) {
    if (Array.isArray(value)) return value.map((item) => sanitizeLogValue(item));
    if (!value || typeof value !== 'object') return sanitizeScalar(value);
    return Object.entries(value).reduce((result, [key, fieldValue]) => {
        const normalizedKey = String(key || '').toLowerCase();
        if (
            normalizedKey.includes('token')
            || normalizedKey.includes('password')
            || normalizedKey.includes('secret')
            || normalizedKey === 'authorization'
            || normalizedKey === 'cookie'
            || normalizedKey === 'wa_phone'
            || normalizedKey === 'phone'
            || normalizedKey === 'client_id'
        ) {
            result[key] = REDACTED;
            return result;
        }
        result[key] = sanitizeLogValue(fieldValue);
        return result;
    }, {});
}

function buildRequestFields(req) {
    if (!req) return {};
    return sanitizeLogValue({
        requestId: req.id || req.requestId || null,
        method: req.method || null,
        path: req.originalUrl || req.url || req.path || null,
        authRole: req.auth?.role || null,
        authSource: req.auth?.source || null,
        ownerScope: req.auth?.owner || null,
        userId: req.auth?.user_id || null,
    });
}

function logServerEvent(level, event, fields = {}, req = null) {
    const logLevel = normalizeLevel(level);
    const payload = sanitizeLogValue({
        ts: new Date().toISOString(),
        level: logLevel,
        event: String(event || 'server_event'),
        ...buildRequestFields(req),
        ...fields,
    });
    const line = JSON.stringify(payload);
    const writer = console[logLevel] || console.log;
    writer.call(console, line);
    return payload;
}

function requestErrorLogMiddleware(req, res, next) {
    if (!req.originalUrl?.startsWith('/api/')) return next();
    const startedAt = Date.now();
    res.on('finish', () => {
        if (res.statusCode < 500) return;
        logServerEvent('error', 'api_response_error', {
            status: res.statusCode,
            durationMs: Date.now() - startedAt,
        }, req);
    });
    next();
}

module.exports = {
    REDACTED,
    sanitizeLogValue,
    logServerEvent,
    requestErrorLogMiddleware,
};
