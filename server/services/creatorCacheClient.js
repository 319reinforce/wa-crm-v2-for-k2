/**
 * Redis client singleton — Phase 4 creator cache infrastructure.
 *
 * Usage:
 *   const { redis } = require('./creatorCacheClient');
 *   if (!redis) return; // Redis unavailable, skip cache
 *
 * Env vars:
 *   REDIS_HOST=redis        (default: 127.0.0.1)
 *   REDIS_PORT=6379         (default: 6379)
 *   REDIS_ENABLED=true      (default: true — disable with 'false' for local dev)
 *   REDIS_CONNECT_TIMEOUT_MS=2000
 */

let _redis = null;
let _initAttempted = false;

function createClient() {
    const enabled = String(process.env.REDIS_ENABLED || 'true').toLowerCase() !== 'false';
    if (!enabled) {
        console.log('[CreatorCache] Redis disabled (REDIS_ENABLED=false)');
        return null;
    }

    const Redis = require('ioredis');
    const host = String(process.env.REDIS_HOST || '127.0.0.1');
    const port = parseInt(process.env.REDIS_PORT || '6379', 10);
    const connectTimeout = parseInt(process.env.REDIS_CONNECT_TIMEOUT_MS || '2000', 10);

    const client = new Redis({
        host,
        port,
        connectTimeout,
        maxRetriesPerRequest: 1,
        retryStrategy: (times) => {
            if (times > 1) {
                console.warn(`[CreatorCache] Redis connect retry #${times} failed, giving up`);
                return null; // stop retrying
            }
            return Math.min(times * 200, 1000);
        },
        lazyConnect: true,
    });

    client.on('connect', () => {
        console.log(`[CreatorCache] Connected to Redis ${host}:${port}`);
    });

    client.on('error', (err) => {
        // Only log on first error to avoid spam
        if (!_initAttempted) return;
        console.error(`[CreatorCache] Redis error: ${err.message}`);
    });

    client.on('close', () => {
        console.warn('[CreatorCache] Redis connection closed');
    });

    return client;
}

function getRedis() {
    if (!_initAttempted) {
        _initAttempted = true;
        _redis = createClient();
        if (_redis) {
            // Attempt async connect; don't block startup
            _redis.connect().catch((err) => {
                console.warn(`[CreatorCache] Initial connect failed: ${err.message} — cache disabled`);
                _redis = null;
            });
        }
    }
    return _redis;
}

function isAvailable() {
    return getRedis() !== null;
}

async function shutdown() {
    if (_redis) {
        try {
            await _redis.quit();
            console.log('[CreatorCache] Redis connection closed');
        } catch (_) {}
        _redis = null;
        _initAttempted = false;
    }
}

module.exports = { getRedis, isAvailable, shutdown };
