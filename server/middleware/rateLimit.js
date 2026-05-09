const crypto = require('crypto');
const { logServerEvent } = require('./structuredLog');

const stores = new Set();

function parsePositiveInt(value, fallback) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    return parsed;
}

function getClientAddress(req) {
    const forwarded = String(req.headers?.['x-forwarded-for'] || '').split(',')[0].trim();
    return forwarded || req.ip || req.socket?.remoteAddress || req.connection?.remoteAddress || 'unknown';
}

function defaultKeyGenerator(req) {
    const auth = req.auth || {};
    const principal = auth.user_id
        ? `user:${auth.user_id}`
        : auth.username
            ? `username:${auth.username}`
            : auth.token_principal
                ? `principal:${auth.token_principal}`
                : `ip:${getClientAddress(req)}`;
    return `${principal}:${String(req.method || 'GET').toUpperCase()}:${req.baseUrl || ''}${req.route?.path || req.path || req.originalUrl || ''}`;
}

function hashKey(value) {
    return crypto.createHash('sha256').update(String(value || '')).digest('hex').slice(0, 16);
}

function createRateLimiter(options = {}) {
    const name = String(options.name || 'rate_limit');
    const windowMs = parsePositiveInt(options.windowMs, 60_000);
    const max = parsePositiveInt(options.max, 60);
    const methods = new Set((options.methods || []).map((method) => String(method).toUpperCase()));
    const keyGenerator = typeof options.keyGenerator === 'function' ? options.keyGenerator : defaultKeyGenerator;
    const skip = typeof options.skip === 'function' ? options.skip : () => false;
    const store = new Map();
    stores.add(store);

    function middleware(req, res, next) {
        const method = String(req.method || 'GET').toUpperCase();
        if (methods.size > 0 && !methods.has(method)) return next();
        if (skip(req)) return next();

        const now = Date.now();
        const rawKey = keyGenerator(req);
        const key = `${name}:${rawKey}`;
        let bucket = store.get(key);
        if (!bucket || bucket.resetAt <= now) {
            bucket = { count: 0, resetAt: now + windowMs };
            store.set(key, bucket);
        }

        bucket.count += 1;
        const remaining = Math.max(0, max - bucket.count);
        const retryAfterSeconds = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));

        if (typeof res.setHeader === 'function') {
            res.setHeader('X-RateLimit-Limit', String(max));
            res.setHeader('X-RateLimit-Remaining', String(remaining));
            res.setHeader('X-RateLimit-Reset', String(Math.ceil(bucket.resetAt / 1000)));
        }

        if (bucket.count <= max) return next();

        if (typeof res.setHeader === 'function') {
            res.setHeader('Retry-After', String(retryAfterSeconds));
        }
        logServerEvent('warn', 'rate_limited', {
            limiter: name,
            keyHash: hashKey(rawKey),
            count: bucket.count,
            max,
            retryAfterSeconds,
        }, req);
        return res.status(429).json({
            ok: false,
            error: 'Too many requests',
            retry_after_seconds: retryAfterSeconds,
        });
    }

    middleware._store = store;
    middleware._config = { name, windowMs, max };
    return middleware;
}

function resetRateLimitStores() {
    for (const store of stores) store.clear();
}

function isUnsafeMethod(req) {
    return !['GET', 'HEAD', 'OPTIONS'].includes(String(req.method || 'GET').toUpperCase());
}

function createOperationalRateLimiters() {
    const loginMax = parsePositiveInt(process.env.RATE_LIMIT_AUTH_LOGIN_MAX, 5);
    const aiMax = parsePositiveInt(process.env.RATE_LIMIT_AI_MAX, 20);
    const mediaMax = parsePositiveInt(process.env.RATE_LIMIT_MEDIA_MAX, 10);
    const writeMax = parsePositiveInt(process.env.RATE_LIMIT_WRITE_MAX, 120);

    return {
        authLogin: createRateLimiter({
            name: 'auth_login',
            windowMs: parsePositiveInt(process.env.RATE_LIMIT_AUTH_LOGIN_WINDOW_MS, 60_000),
            max: loginMax,
            methods: ['POST'],
            keyGenerator: (req) => {
                const username = String(req.body?.username || '').trim().toLowerCase() || 'unknown';
                return `ip:${getClientAddress(req)}:username:${username}`;
            },
        }),
        ai: createRateLimiter({
            name: 'ai_generation',
            windowMs: parsePositiveInt(process.env.RATE_LIMIT_AI_WINDOW_MS, 60_000),
            max: aiMax,
            methods: ['POST'],
            skip: (req) => !/^\/?(minimax|ai\/|translate)/.test(String(req.path || '').replace(/^\/+/, '')),
        }),
        mediaUpload: createRateLimiter({
            name: 'media_upload',
            windowMs: parsePositiveInt(process.env.RATE_LIMIT_MEDIA_WINDOW_MS, 60_000),
            max: mediaMax,
            methods: ['POST'],
            skip: (req) => {
                const url = String(req.originalUrl || req.url || '');
                return !/^\/api\/wa\/(media-assets|send-media)(\/|\?|$)/.test(url);
            },
        }),
        apiWrite: createRateLimiter({
            name: 'api_write',
            windowMs: parsePositiveInt(process.env.RATE_LIMIT_WRITE_WINDOW_MS, 60_000),
            max: writeMax,
            skip: (req) => {
                if (!String(req.originalUrl || '').startsWith('/api/')) return true;
                if (!isUnsafeMethod(req)) return true;
                if (String(req.originalUrl || '').startsWith('/api/auth/login')) return true;
                return false;
            },
        }),
    };
}

module.exports = {
    createRateLimiter,
    createOperationalRateLimiters,
    resetRateLimitStores,
    getClientAddress,
    hashKey,
};
