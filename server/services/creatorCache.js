/**
 * creatorCache — Phase 4 Redis cache for hot creator lookups.
 *
 * Cache-aside pattern:
 *   1. Try cache (id or phone key)
 *   2. On miss: query MySQL, store in cache with TTL
 *   3. On write path: invalidate affected keys
 *
 * Target: `SELECT ... FROM creators WHERE id=?` and `WHERE wa_phone=?`
 *         called ~20x per /api/creators list render + SSE broadcasts.
 *
 * Env vars:
 *   REDIS_ENABLED          (default: true)
 *   REDIS_HOST / REDIS_PORT
 *   REDIS_CREATOR_TTL_SEC  (default: 60s — short for consistency, enough to cut DB load)
 *   REDIS_CREATOR_WARM     (default: false — whether to warm cache on startup)
 */

const { getRedis, isAvailable } = require('./creatorCacheClient');

// Env config
const TTL_SEC = parseInt(process.env.REDIS_CREATOR_TTL_SEC || '60', 10);

// Cache keys are shared across all callers regardless of the `fields` each one
// asks for, so we must always persist the full row; otherwise a narrow-field
// caller would overwrite a wide-field caller's payload and return partial rows
// (e.g. a cached row without `wa_phone` → `creator has empty wa_phone`).
const FULL_ROW_SELECT = '*';

// Key prefixes
const K_ID    = (id)    => `creator:id:${id}`;
const K_PHONE = (phone) => {
    const normalized = normalizeCacheKey(phone);
    return `creator:phone:${normalized}`;
};

/**
 * Normalize phone for cache key consistency.
 * Handles +, spaces, dashes, parentheses.
 */
function normalizeCacheKey(phone) {
    if (!phone) return '';
    return String(phone)
        .replace(/\+/g, '')
        .replace(/[\s\-()]/g, '')
        .trim()
        .toLowerCase();
}

/**
 * Parse a SQL SELECT field list into required column names.
 * Returns `null` if the list includes `*` (no column-level check needed).
 */
function parseRequiredColumns(fields) {
    const raw = String(fields || '').trim();
    if (!raw || raw === '*') return null;
    const cols = raw
        .split(',')
        .map((f) => f.trim().toLowerCase())
        .filter(Boolean);
    if (cols.includes('*')) return null;
    return cols;
}

/**
 * Validate that a cached row satisfies the caller's `fields` request.
 * Returns the row if it exposes every requested column (null values count as
 * present); returns null when the row is missing columns so the caller falls
 * back to DB (protects against legacy partial cache entries).
 */
function validateCachedRow(row, fields) {
    if (!row || typeof row !== 'object') return null;
    const required = parseRequiredColumns(fields);
    if (!required) return row;
    for (const col of required) {
        if (!Object.prototype.hasOwnProperty.call(row, col)) {
            return null;
        }
    }
    return row;
}

// ─── Read path ─────────────────────────────────────────────────────────────

/**
 * Fetch a single creator by id from cache, falling back to MySQL.
 *
 * NOTE: The `fields` parameter only gates cache-hit validation; the DB query
 * always selects `*` so the cache payload is uniform across all callers.
 *
 * @param {object} dbConn   - better-sqlite3 connection
 * @param {number|string} creatorId
 * @param {string} [fields] - SELECT fields the caller expects (default: all common ones)
 * @returns {Promise<object|null>}
 */
async function getCreator(dbConn, creatorId, fields = 'id, primary_name, wa_phone, wa_owner') {
    const redis = getRedis();
    const id = Number(creatorId) || 0;
    if (!id) return null;

    if (redis) {
        try {
            const cached = await redis.get(K_ID(id));
            if (cached) {
                const parsed = JSON.parse(cached);
                const validated = validateCachedRow(parsed, fields);
                if (validated) return validated;
            }
        } catch (err) {
            console.warn(`[creatorCache] get id=${id} cache read error: ${err.message}`);
        }
    }

    // Cache miss (or partial cached row) — query DB for the full row.
    const row = await dbConn.prepare(
        `SELECT ${FULL_ROW_SELECT} FROM creators WHERE id = ? LIMIT 1`
    ).get(id);

    if (row && redis) {
        try {
            await redis.setex(K_ID(id), TTL_SEC, JSON.stringify(row));
        } catch (err) {
            console.warn(`[creatorCache] set id=${id} cache write error: ${err.message}`);
        }
    }

    return row || null;
}

/**
 * Fetch a single creator by wa_phone from cache, falling back to MySQL.
 *
 * @param {object} dbConn
 * @param {string} phone
 * @param {string[]} fields
 * @returns {Promise<object|null>}
 */
async function getCreatorByPhone(dbConn, phone, fields = 'id, primary_name, wa_phone, wa_owner') {
    const redis = getRedis();
    const normalized = normalizeCacheKey(phone);
    if (!normalized) return null;

    if (redis) {
        try {
            const cached = await redis.get(K_PHONE(normalized));
            if (cached) {
                const parsed = JSON.parse(cached);
                const validated = validateCachedRow(parsed, fields);
                if (validated) return validated;
            }
        } catch (err) {
            console.warn(`[creatorCache] get phone=${normalized} cache read error: ${err.message}`);
        }
    }

    // Cache miss (or partial cached row) — query DB for the full row.
    const row = await dbConn.prepare(
        `SELECT ${FULL_ROW_SELECT} FROM creators WHERE wa_phone = ? LIMIT 1`
    ).get(phone);

    if (row && redis) {
        try {
            await redis.setex(K_PHONE(normalized), TTL_SEC, JSON.stringify(row));
            // Also warm the id key for future id-based lookups
            await redis.setex(K_ID(row.id), TTL_SEC, JSON.stringify(row));
        } catch (err) {
            console.warn(`[creatorCache] set phone=${normalized} cache write error: ${err.message}`);
        }
    }

    return row || null;
}

/**
 * Batch fetch creators by id — cache-aside with Redis MGET.
 *
 * NOTE: `fields` only gates cache-hit validation; DB queries always SELECT *.
 *
 * @param {object} dbConn
 * @param {number[]} creatorIds
 * @param {string} [fields] - SELECT fields the caller expects
 * @returns {Promise<Map<number, object|null>>}  id → creator row (null = not found)
 */
async function getCreatorsByIds(dbConn, creatorIds, fields = 'id, primary_name, wa_phone, wa_owner') {
    const ids = [...new Set(
        creatorIds.map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0)
    )];
    if (ids.length === 0) return new Map();

    const redis = getRedis();
    const result = new Map();
    const missIds = [];

    // Try cache lookup
    if (redis) {
        try {
            const keys = ids.map(K_ID);
            const cached = await redis.mget(...keys);
            for (let i = 0; i < ids.length; i++) {
                const cachedRow = cached[i];
                if (cachedRow) {
                    try {
                        const parsed = JSON.parse(cachedRow);
                        const validated = validateCachedRow(parsed, fields);
                        if (validated) {
                            result.set(ids[i], validated);
                            continue;
                        }
                    } catch (_) {}
                }
                missIds.push(ids[i]);
            }
        } catch (err) {
            console.warn(`[creatorCache] mget batch cache read error: ${err.message}`);
            missIds.push(...ids);
        }
    } else {
        missIds.push(...ids);
    }

    // Fetch misses from DB (always full row for cache uniformity).
    if (missIds.length > 0) {
        const placeholders = missIds.map(() => '?').join(',');
        const rows = await dbConn.prepare(
            `SELECT ${FULL_ROW_SELECT} FROM creators WHERE id IN (${placeholders})`
        ).all(...missIds);

        const rowMap = new Map(rows.map((r) => [r.id, r]));
        for (const id of ids) {
            if (!result.has(id)) {
                result.set(id, rowMap.get(id) || null);
            }
        }

        // Write misses to cache
        if (redis) {
            try {
                const pipeline = redis.pipeline();
                for (const row of rows) {
                    pipeline.setex(K_ID(row.id), TTL_SEC, JSON.stringify(row));
                }
                await pipeline.exec();
            } catch (err) {
                console.warn(`[creatorCache] batch cache write error: ${err.message}`);
            }
        }
    }

    return result;
}

// ─── Write path ───────────────────────────────────────────────────────────

/**
 * Invalidate all cache keys for a creator.
 * Call this on every creator mutation (update, merge, etc.)
 *
 * @param {number|string} creatorId
 * @param {string} [phone]  — if known, invalidate phone key too
 */
async function invalidateCreator(creatorId, phone = null) {
    const redis = getRedis();
    if (!redis) return;

    const id = Number(creatorId) || 0;
    if (!id) return;

    try {
        const pipeline = redis.pipeline();
        pipeline.del(K_ID(id));
        if (phone) {
            pipeline.del(K_PHONE(normalizeCacheKey(phone)));
        }
        await pipeline.exec();
    } catch (err) {
        console.warn(`[creatorCache] invalidate id=${id} error: ${err.message}`);
    }
}

/**
 * Invalidate by phone (when wa_phone changes).
 */
async function invalidateByPhone(phone) {
    const redis = getRedis();
    if (!redis) return;

    const normalized = normalizeCacheKey(phone);
    if (!normalized) return;

    try {
        await redis.del(K_PHONE(normalized));
    } catch (err) {
        console.warn(`[creatorCache] invalidate phone=${normalized} error: ${err.message}`);
    }
}

// ─── Warm (optional, not called on startup by default) ─────────────────────

/**
 * Warm cache for a list of creator ids.
 * Only warm if REDIS_CREATOR_WARM=true.
 *
 * @param {object} dbConn
 * @param {number[]} creatorIds
 */
async function warmCache(dbConn, creatorIds) {
    if (!isAvailable()) return;
    if (String(process.env.REDIS_CREATOR_WARM || '').toLowerCase() !== 'true') return;

    try {
        await getCreatorsByIds(dbConn, creatorIds);
    } catch (err) {
        console.warn(`[creatorCache] warmCache error: ${err.message}`);
    }
}

// ─── Debug / health ────────────────────────────────────────────────────────

function cacheStats() {
    const redis = getRedis();
    return {
        enabled: !!redis,
        ttl_sec: TTL_SEC,
    };
}

module.exports = {
    getCreator,
    getCreatorByPhone,
    getCreatorsByIds,
    invalidateCreator,
    invalidateByPhone,
    warmCache,
    cacheStats,
    _internal: {
        parseRequiredColumns,
        validateCachedRow,
        normalizeCacheKey,
    },
};