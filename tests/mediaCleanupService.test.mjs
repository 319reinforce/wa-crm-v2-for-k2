import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)

// ----- Mock db module in require.cache so mediaCleanupService picks it up -----
const dbPath = path.resolve(__dirname, '../db.js')

// A stub mysql-like db with programmable responses per SQL pattern
function makeStubDb(plan) {
    // plan: array of { match: (sql) => boolean, get?, all?, run? }
    const calls = []
    const getDb = () => ({
        prepare(sql) {
            const entry = plan.find(p => p.match(sql))
            return {
                get: async (...params) => {
                    calls.push({ sql, params, kind: 'get' })
                    return entry?.get ? entry.get(...params) : null
                },
                all: async (...params) => {
                    calls.push({ sql, params, kind: 'all' })
                    return entry?.all ? entry.all(...params) : []
                },
                run: async (...params) => {
                    calls.push({ sql, params, kind: 'run' })
                    return entry?.run ? entry.run(...params) : { lastInsertRowid: 1, changes: 1 }
                },
            }
        },
    })
    return { getDb, closeDb: async () => {}, calls }
}

function withMockedDb(stub, fn) {
    const fakeModule = { exports: stub }
    require.cache[dbPath] = {
        id: dbPath,
        filename: dbPath,
        loaded: true,
        exports: stub,
    }
    try {
        // Also clear mediaCleanupService cache so it picks up fresh db
        const servicePath = path.resolve(__dirname, '../server/services/mediaCleanupService.js')
        delete require.cache[servicePath]
        return fn()
    } finally {
        delete require.cache[dbPath]
    }
}

test('getRetentionCutoff — 返回 Date,减去了 RETENTION_DAYS 天', () => {
    const stub = makeStubDb([])
    withMockedDb(stub, () => {
        const { getRetentionCutoff, RETENTION_DAYS } = require('../server/services/mediaCleanupService')
        const cutoff = getRetentionCutoff()
        assert.ok(cutoff instanceof Date)
        const now = Date.now()
        const diffDays = (now - cutoff.getTime()) / (1000 * 60 * 60 * 24)
        // 允许 ±1 天误差(时区/执行延迟)
        assert.ok(Math.abs(diffDays - RETENTION_DAYS) < 1,
            `expected cutoff ~${RETENTION_DAYS} days ago, got ${diffDays.toFixed(2)} days`)
    })
})

test('常量导出合理默认值', () => {
    const stub = makeStubDb([])
    withMockedDb(stub, () => {
        const { RETENTION_DAYS, PURGE_AFTER_DAYS, BATCH_SIZE } = require('../server/services/mediaCleanupService')
        assert.ok(typeof RETENTION_DAYS === 'number' && RETENTION_DAYS > 0)
        assert.ok(typeof PURGE_AFTER_DAYS === 'number' && PURGE_AFTER_DAYS > 0)
        assert.ok(typeof BATCH_SIZE === 'number' && BATCH_SIZE > 0)
    })
})

test('cleanupBatch — 正例:到期资产被标记为 deleted,计数器正确', async () => {
    const plan = [
        // ensureSchema 的 CREATE INDEX IF NOT EXISTS
        { match: (sql) => /CREATE INDEX IF NOT EXISTS/i.test(sql), run: async () => ({ lastInsertRowid: 0, changes: 0 }) },
        // 查候选
        {
            match: (sql) => /FROM media_assets.*storage_tier\s*=\s*'hot'/is.test(sql),
            all: async () => [
                { id: 101, file_path: '/x/a.jpg', storage_key: 'a.jpg', sha256_hash: 'h1', storage_provider: 'local', mime_type: 'image/jpeg', file_size: 1000 },
                { id: 102, file_path: '/x/b.jpg', storage_key: 'b.jpg', sha256_hash: 'h2', storage_provider: 'local', mime_type: 'image/jpeg', file_size: 2000 },
            ],
        },
        // UPDATE 标记 deleted
        { match: (sql) => /UPDATE media_assets.*status\s*=\s*'deleted'/is.test(sql), run: async () => ({ lastInsertRowid: 0, changes: 1 }) },
    ]
    const stub = makeStubDb(plan)

    await withMockedDb(stub, async () => {
        const { cleanupBatch } = require('../server/services/mediaCleanupService')
        // 传入 retentionDays=30, jobId=1
        const result = await cleanupBatch(30, 1)
        assert.equal(result.deleted, 2)
        assert.equal(result.checked, 2)
        assert.ok(Array.isArray(result.errors))
        assert.equal(result.errors.length, 0)
    })
})

test('cleanupBatch — 反例:候选为空时立刻返回,不抛错', async () => {
    const plan = [
        { match: (sql) => /CREATE INDEX IF NOT EXISTS/i.test(sql), run: async () => ({ changes: 0 }) },
        { match: (sql) => /FROM media_assets.*storage_tier\s*=\s*'hot'/is.test(sql), all: async () => [] },
    ]
    const stub = makeStubDb(plan)

    await withMockedDb(stub, async () => {
        const { cleanupBatch } = require('../server/services/mediaCleanupService')
        const result = await cleanupBatch(30, 1)
        assert.equal(result.deleted, 0)
        assert.equal(result.checked, 0)
        assert.equal(result.errors.length, 0)
    })
})

test('cleanupBatch — 重试场景:单条 UPDATE 抛错,错误记入 errors,其他继续', async () => {
    let updateCall = 0
    const plan = [
        { match: (sql) => /CREATE INDEX IF NOT EXISTS/i.test(sql), run: async () => ({ changes: 0 }) },
        {
            match: (sql) => /FROM media_assets.*storage_tier\s*=\s*'hot'/is.test(sql),
            all: async () => [
                { id: 201, file_path: '/x/a.jpg', storage_key: 'a.jpg', sha256_hash: 'h1', storage_provider: 'local', mime_type: 'image/jpeg', file_size: 1000 },
                { id: 202, file_path: '/x/b.jpg', storage_key: 'b.jpg', sha256_hash: 'h2', storage_provider: 'local', mime_type: 'image/jpeg', file_size: 2000 },
                { id: 203, file_path: '/x/c.jpg', storage_key: 'c.jpg', sha256_hash: 'h3', storage_provider: 'local', mime_type: 'image/jpeg', file_size: 3000 },
            ],
        },
        {
            match: (sql) => /UPDATE media_assets.*status\s*=\s*'deleted'/is.test(sql),
            run: async () => {
                updateCall++
                if (updateCall === 2) throw new Error('simulated db error')
                return { changes: 1 }
            },
        },
    ]
    const stub = makeStubDb(plan)

    await withMockedDb(stub, async () => {
        const { cleanupBatch } = require('../server/services/mediaCleanupService')
        const result = await cleanupBatch(30, 1)
        // 3 条候选,2 条成功,1 条失败
        assert.equal(result.checked, 3)
        assert.equal(result.deleted, 2)
        assert.equal(result.errors.length, 1)
        assert.match(result.errors[0], /id=202.*simulated db error/i)
    })
})

test('purgeDeletedAssets — 候选为空时立刻返回,purged=0', async () => {
    const plan = [
        { match: (sql) => /CREATE INDEX IF NOT EXISTS/i.test(sql), run: async () => ({ changes: 0 }) },
        { match: (sql) => /FROM media_assets.*status\s*=\s*'deleted'/is.test(sql), all: async () => [] },
    ]
    const stub = makeStubDb(plan)

    await withMockedDb(stub, async () => {
        const { purgeDeletedAssets } = require('../server/services/mediaCleanupService')
        const result = await purgeDeletedAssets(1)
        assert.equal(result.purged, 0)
        assert.equal(result.errors.length, 0)
    })
})

test('findCleanupCandidates — dry-run 预览:返回符合条件的列表,不写入', async () => {
    const plan = [
        { match: (sql) => /CREATE INDEX IF NOT EXISTS/i.test(sql), run: async () => ({ changes: 0 }) },
        {
            match: (sql) => /FROM media_assets/is.test(sql) && /storage_tier\s*=\s*'hot'/i.test(sql),
            all: async () => [
                { id: 301, mime_type: 'image/jpeg', file_size: 100000, created_at: new Date('2026-01-01') },
            ],
        },
    ]
    const stub = makeStubDb(plan)

    await withMockedDb(stub, async () => {
        const { findCleanupCandidates } = require('../server/services/mediaCleanupService')
        const result = await findCleanupCandidates(30)
        assert.ok(Array.isArray(result))
        assert.equal(result.length, 1)
        assert.equal(result[0].id, 301)
        // 验证没有调用 UPDATE(dry-run)
        const updates = stub.calls.filter(c => /UPDATE/i.test(c.sql))
        assert.equal(updates.length, 0)
    })
})
