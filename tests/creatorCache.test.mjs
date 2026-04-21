import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

// Stub redis client before loading creatorCache so getRedis() returns our fake.
const redisStore = new Map()
const fakeRedis = {
    async get(key) {
        return redisStore.has(key) ? redisStore.get(key) : null
    },
    async setex(key, _ttl, value) {
        redisStore.set(key, value)
    },
    async mget(...keys) {
        return keys.map((k) => (redisStore.has(k) ? redisStore.get(k) : null))
    },
    pipeline() {
        const ops = []
        return {
            setex(key, _ttl, value) {
                ops.push(['setex', key, value])
                return this
            },
            del(key) {
                ops.push(['del', key])
                return this
            },
            async exec() {
                for (const [op, key, value] of ops) {
                    if (op === 'setex') redisStore.set(key, value)
                    if (op === 'del') redisStore.delete(key)
                }
            },
        }
    },
    async del(key) {
        redisStore.delete(key)
    },
}

require.cache[require.resolve('../server/services/creatorCacheClient')] = {
    exports: {
        getRedis: () => fakeRedis,
        isAvailable: () => true,
        shutdown: async () => {},
    },
}

const creatorCache = require('../server/services/creatorCache')

function buildDbStub(rows) {
    const byId = new Map(rows.map((r) => [r.id, r]))
    const byPhone = new Map(rows.map((r) => [r.wa_phone, r]))
    const calls = { byId: [], byPhone: [], byIds: [] }
    return {
        calls,
        prepare(sql) {
            return {
                async get(arg) {
                    if (/WHERE id = \?/.test(sql)) {
                        calls.byId.push({ sql, arg })
                        return byId.get(Number(arg)) || null
                    }
                    if (/WHERE wa_phone = \?/.test(sql)) {
                        calls.byPhone.push({ sql, arg })
                        return byPhone.get(String(arg)) || null
                    }
                    return null
                },
                async all(...args) {
                    if (/WHERE id IN /.test(sql)) {
                        calls.byIds.push({ sql, args })
                        return args.map((id) => byId.get(Number(id))).filter(Boolean)
                    }
                    return []
                },
            }
        },
    }
}

const creator3443 = {
    id: 3443,
    primary_name: 'lotus17515211693',
    wa_phone: '8617515211693',
    wa_owner: 'WangYouKe',
    source: 'manual',
    is_active: 1,
}

test('parseRequiredColumns returns null for "*" and lowercase list otherwise', () => {
    const { parseRequiredColumns } = creatorCache._internal
    assert.equal(parseRequiredColumns('*'), null)
    assert.equal(parseRequiredColumns(''), null)
    assert.deepEqual(parseRequiredColumns('id, Wa_Phone'), ['id', 'wa_phone'])
})

test('validateCachedRow returns the row when every requested column is present', () => {
    const { validateCachedRow } = creatorCache._internal
    const row = { id: 1, wa_phone: '111', wa_owner: 'Beau' }
    assert.equal(validateCachedRow(row, 'id, wa_phone, wa_owner'), row)
})

test('validateCachedRow treats missing columns (legacy partial cache) as miss', () => {
    const { validateCachedRow } = creatorCache._internal
    const partial = { id: 3443, wa_owner: 'WangYouKe' }
    assert.equal(validateCachedRow(partial, 'id, primary_name, wa_phone, wa_owner'), null)
})

test('validateCachedRow treats null column values as present', () => {
    const { validateCachedRow } = creatorCache._internal
    const row = { id: 1, keeper_username: null, wa_owner: 'Beau' }
    assert.equal(validateCachedRow(row, 'id, keeper_username, wa_owner'), row)
})

test('getCreator caches the full row even when caller requests narrow fields', async () => {
    redisStore.clear()
    const db = buildDbStub([creator3443])

    // A narrow-field caller runs first and populates the cache.
    const narrow = await creatorCache.getCreator(db, 3443, 'id, wa_owner')
    assert.equal(narrow.wa_phone, '8617515211693', 'narrow caller still gets full row back')
    assert.deepEqual(
        Object.keys(narrow).sort(),
        Object.keys(creator3443).sort(),
        'cache stores the complete row regardless of requested fields',
    )

    // A later wide-field caller must NOT get a partial row.
    const wide = await creatorCache.getCreator(db, 3443, 'id, primary_name, wa_phone, wa_owner')
    assert.equal(wide.wa_phone, '8617515211693', 'wide-field caller reads wa_phone from cache')
    assert.equal(db.calls.byId.length, 1, 'second call is served from cache, not DB')
})

test('getCreator recovers from legacy partial cache entry by re-querying DB', async () => {
    redisStore.clear()
    redisStore.set('creator:id:3443', JSON.stringify({ id: 3443, wa_owner: 'WangYouKe' }))
    const db = buildDbStub([creator3443])

    const row = await creatorCache.getCreator(db, 3443, 'id, primary_name, wa_phone, wa_owner')
    assert.equal(row.wa_phone, '8617515211693', 'partial cached row triggers DB refresh')
    assert.equal(db.calls.byId.length, 1, 'DB queried exactly once to refill cache')

    const cachedAfter = JSON.parse(redisStore.get('creator:id:3443'))
    assert.equal(cachedAfter.wa_phone, '8617515211693', 'cache now holds the full row')
})

test('getCreatorByPhone warms id cache with the full row', async () => {
    redisStore.clear()
    const db = buildDbStub([creator3443])

    const row = await creatorCache.getCreatorByPhone(db, '8617515211693', 'wa_owner')
    assert.equal(row.wa_phone, '8617515211693')

    const cachedById = JSON.parse(redisStore.get('creator:id:3443'))
    assert.equal(cachedById.wa_phone, '8617515211693', 'id-keyed warm cache has wa_phone')
})

test('getCreatorsByIds falls back to DB when any cached entry is partial', async () => {
    redisStore.clear()
    // id:1 cached partial, id:2 not cached at all.
    redisStore.set('creator:id:1', JSON.stringify({ id: 1, wa_owner: 'Beau' }))
    const rows = [
        { id: 1, primary_name: 'a', wa_phone: '1', wa_owner: 'Beau', source: 'manual', is_active: 1 },
        { id: 2, primary_name: 'b', wa_phone: '2', wa_owner: 'Yiyun', source: 'manual', is_active: 1 },
    ]
    const db = buildDbStub(rows)

    const map = await creatorCache.getCreatorsByIds(db, [1, 2], 'id, wa_phone, wa_owner')
    assert.equal(map.get(1).wa_phone, '1', 'partial id:1 cache triggers DB refetch')
    assert.equal(map.get(2).wa_phone, '2', 'uncached id:2 fetched from DB')
    assert.equal(db.calls.byIds.length, 1, 'single batch DB query for both misses')
    assert.deepEqual([...db.calls.byIds[0].args].sort(), [1, 2])
})
