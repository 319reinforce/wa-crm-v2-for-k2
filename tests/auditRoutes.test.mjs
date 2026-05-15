import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const auditRouter = require('../server/routes/audit')
const db = require('../db')

function createRes() {
  return {
    statusCode: 200,
    body: null,
    headers: {},
    status(code) {
      this.statusCode = code
      return this
    },
    json(payload) {
      this.body = payload
      return this
    },
    setHeader(name, value) {
      this.headers[name] = value
      return this
    },
    end(payload) {
      this.body = payload
      return this
    },
  }
}

function getRouteHandler(router, method, path) {
  const layer = router.stack.find((item) => item.route?.path === path && item.route.methods?.[method])
  if (!layer) throw new Error(`Route ${method.toUpperCase()} ${path} not found`)
  return layer.route.stack[layer.route.stack.length - 1].handle
}

async function withDbStub(stubDb, fn) {
  const originalGetDb = db.getDb
  db.getDb = () => stubDb
  try {
    await fn()
  } finally {
    db.getDb = originalGetDb
  }
}

const getGenerationLogDetail = getRouteHandler(auditRouter, 'get', '/generation-log/:id')
const getRetrievalSnapshotDetail = getRouteHandler(auditRouter, 'get', '/retrieval-snapshot/:id')
const getAuditLog = getRouteHandler(auditRouter, 'get', '/audit-log')
const getEvaluationSummary = getRouteHandler(auditRouter, 'get', '/generation-log/evaluation-summary')

test('fetchGenerationRows uses a parameterized LIMIT when one is requested', async () => {
  let capturedSql = ''
  let capturedArgs = null
  const stubDb = {
    prepare(sql) {
      capturedSql = sql
      return {
        async all(...args) {
          capturedArgs = args
          return [{ grounding_json: '{}' }]
        },
      }
    },
  }

  await withDbStub(stubDb, async () => {
    await auditRouter._private.fetchGenerationRows({ owner: 'Beau', limit: 25 })
  })

  assert.match(capturedSql, /ORDER BY gl\.created_at DESC\s+LIMIT \?/)
  assert.deepEqual(capturedArgs, ['Beau', 25])
})

test('fetchGenerationRows keeps the unlimited query path free of LIMIT interpolation', async () => {
  let capturedSql = ''
  let capturedArgs = null
  const stubDb = {
    prepare(sql) {
      capturedSql = sql
      return {
        async all(...args) {
          capturedArgs = args
          return [{ grounding_json: '{}' }]
        },
      }
    },
  }

  await withDbStub(stubDb, async () => {
    await auditRouter._private.fetchGenerationRows({ hours: 12 })
  })

  assert.doesNotMatch(capturedSql, /\bLIMIT\b/)
  assert.deepEqual(capturedArgs, [12])
})

test('generation-log evaluation summary aggregates SFT dashboard requests behind one route', async () => {
  const res = createRes()
  const preparedSql = []
  const generationRows = [{
    id: 31,
    client_id: '15550009',
    retrieval_snapshot_id: 9,
    provider: 'openai',
    model: 'gpt-4o',
    route: 'generate-candidates',
    ab_bucket: 'openai',
    scene: 'trial_intro',
    operator: 'Beau',
    message_count: 3,
    prompt_version: 'v2',
    latency_ms: 900,
    status: 'success',
    error_message: null,
    created_at: '2026-05-08 10:00:00',
    grounding_json: '{"rag":{"enabled":true,"hit_count":1,"hits":[{"source_id":"sop-1","source_type":"policy"}]}}',
  }]
  const stubDb = {
    prepare(sql) {
      preparedSql.push(sql)
      return {
        async get(...args) {
          if (/FROM sft_feedback sf/.test(sql)) {
            assert.deepEqual(args, [24])
            return { count: 1 }
          }
          return {}
        },
        async all(...args) {
          if (/FROM creators\s+WHERE wa_phone IN \(\?\)/.test(sql)) {
            assert.ok(Array.isArray(args[0]))
            return args[0].map((phone) => ({ wa_phone: phone, wa_owner: 'Beau' }))
          }
          if (/FROM sft_memory sm/.test(sql) && /sm\.status/.test(sql)) {
            assert.deepEqual(args, [24])
            return [{ id: 41, human_selected: 'custom', status: 'approved', context_json: '{}', created_at: '2026-05-08 10:05:00' }]
          }
          if (/FROM sft_memory sm/.test(sql) && /sm\.id/.test(sql)) {
            assert.deepEqual(args, [])
            return [
              { id: 41, human_selected: 'opt1', scene: null, context_json: '{"client_id":"15550009","scene":"trial_intro"}', created_at: '2026-05-08 10:05:00' },
              { id: 42, human_selected: 'opt2', scene: null, context_json: '{"client_id":"15550009","scene":"trial_intro"}', created_at: '2026-05-08 10:06:00' },
              { id: 43, human_selected: 'custom', scene: null, context_json: '{"client_id":"15550009","scene":"trial_intro"}', created_at: '2026-05-08 10:07:00' },
            ]
          }
          if (/FROM generation_log gl/.test(sql) && /gl\.latency_ms/.test(sql) && !/grounding_json/.test(sql)) {
            assert.equal(args.length, 1)
            return [
              { client_id: '15550009', provider: 'openai', route: 'generate-candidates', status: 'success', latency_ms: 900, created_at: '2026-05-08 10:00:00' },
              { client_id: '15550009', provider: 'openai', route: 'generate-candidates', status: 'success', latency_ms: 900, created_at: '2026-05-08 10:01:00' },
            ]
          }
          if (/FROM generation_log gl/.test(sql)) {
            assert.ok(args.includes(20) || args.includes(24))
            return generationRows
          }
          return []
        },
      }
    },
  }

  await withDbStub(stubDb, async () => {
    await getEvaluationSummary({ query: {}, auth: { role: 'admin' } }, res)
  })

  assert.equal(res.statusCode, 200)
  assert.equal(res.body.ab_evaluation.total_records, 3)
  assert.equal(res.body.generation_stats.total, 2)
  assert.equal(res.body.generation_recent[0].provider, 'openai')
  assert.equal(res.body.rag_observation.generation.rag_hit_count, 1)
  assert.equal(res.body.rag_sources.recent[0].rag_hit_count, 1)
  assert.ok(preparedSql.some((sql) => /generation-log\/evaluation-summary/.test(sql)) === false)
})

test('AB evaluation summary preserves LEFT semantics with app-layer owner merge', async () => {
  const stubDb = {
    prepare(sql) {
      return {
        async all(...args) {
          if (/FROM sft_memory sm/.test(sql)) {
            assert.doesNotMatch(sql, /\bJOIN\b/i)
            assert.deepEqual(args, [])
            return [
              { id: 1, human_selected: 'opt1', context_json: '{"client_id":"phone-a","scene":"intro"}', scene: null, created_at: '2026-05-08 09:00:00' },
              { id: 2, human_selected: 'custom', context_json: '{"client_id":"phone-missing","scene":"intro"}', scene: null, created_at: '2026-05-08 10:00:00' },
              { id: 3, human_selected: 'opt2', context_json: '{"client_id":"phone-b","scene":"follow"}', scene: null, created_at: '2026-05-09 10:00:00' },
            ]
          }
          if (/FROM creators/.test(sql)) {
            assert.deepEqual(args, [['phone-a', 'phone-missing', 'phone-b']])
            return [
              { wa_phone: 'phone-a', wa_owner: 'Beau' },
              { wa_phone: 'phone-b', wa_owner: 'Yiyun' },
            ]
          }
          return []
        },
      }
    },
  }

  await withDbStub(stubDb, async () => {
    const summary = await auditRouter._private.buildAbEvaluationSummary()
    assert.equal(summary.total_records, 3)
    assert.equal(summary.by_owner.Beau.total, 1)
    assert.equal(summary.by_owner.Yiyun.total, 1)
    assert.equal(summary.by_owner.Unknown.total, 1)
    assert.equal(summary.by_owner.Unknown.custom_count, 1)
    assert.equal(summary.by_scene.intro.total, 2)
    assert.deepEqual(summary.by_day.map((row) => row.date), ['2026-05-08', '2026-05-09'])
  })
})

test('AB evaluation owner scope filters after app-layer LEFT merge', async () => {
  const stubDb = {
    prepare(sql) {
      return {
        async all() {
          if (/FROM sft_memory sm/.test(sql)) {
            assert.doesNotMatch(sql, /\bJOIN\b/i)
            return [
              { id: 1, human_selected: 'opt1', context_json: '{"client_id":"phone-a","scene":"intro"}', scene: null, created_at: '2026-05-08 09:00:00' },
              { id: 2, human_selected: 'custom', context_json: '{"client_id":"phone-missing","scene":"intro"}', scene: null, created_at: '2026-05-08 10:00:00' },
              { id: 3, human_selected: 'opt2', context_json: '{"client_id":"phone-b","scene":"follow"}', scene: null, created_at: '2026-05-09 10:00:00' },
            ]
          }
          if (/FROM creators/.test(sql)) {
            return [
              { wa_phone: 'phone-a', wa_owner: 'Beau' },
              { wa_phone: 'phone-b', wa_owner: 'Yiyun' },
            ]
          }
          return []
        },
      }
    },
  }

  await withDbStub(stubDb, async () => {
    const summary = await auditRouter._private.buildAbEvaluationSummary({ owner: 'Beau' })
    assert.equal(summary.total_records, 1)
    assert.equal(summary.opt1_selected, 1)
    assert.deepEqual(Object.keys(summary.by_owner), ['Beau'])
    assert.equal(summary.by_scene.intro.total, 1)
  })
})

test('generation stats owner scope filters after app-layer creator lookup', async () => {
  const stubDb = {
    prepare(sql) {
      return {
        async all(...args) {
          if (/FROM generation_log gl/.test(sql)) {
            assert.doesNotMatch(sql, /\bJOIN\b/i)
            assert.equal(args.length, 1)
            return [
              { client_id: 'phone-a', provider: 'openai', route: 'reply', status: 'success', latency_ms: 100, created_at: '2026-05-08 09:00:00' },
              { client_id: 'phone-b', provider: 'minimax', route: 'reply', status: 'failed', latency_ms: 500, created_at: '2026-05-08 10:00:00' },
              { client_id: 'phone-missing', provider: 'openai', route: 'audit', status: 'success', latency_ms: null, created_at: '2026-05-09 10:00:00' },
            ]
          }
          if (/FROM creators/.test(sql)) {
            return [
              { wa_phone: 'phone-a', wa_owner: 'Beau' },
              { wa_phone: 'phone-b', wa_owner: 'Yiyun' },
            ]
          }
          return []
        },
      }
    },
  }

  await withDbStub(stubDb, async () => {
    const globalSummary = await auditRouter._private.buildGenerationStatsSummary({ days: 7 })
    assert.equal(globalSummary.total, 3)
    assert.equal(globalSummary.success_count, 2)
    assert.equal(globalSummary.failed_count, 1)
    assert.equal(globalSummary.avg_latency_ms, 300)
    assert.deepEqual(globalSummary.by_provider, [
      { provider: 'openai', count: 2 },
      { provider: 'minimax', count: 1 },
    ])

    const scopedSummary = await auditRouter._private.buildGenerationStatsSummary({ owner: 'Beau', days: 7 })
    assert.equal(scopedSummary.total, 1)
    assert.equal(scopedSummary.success_count, 1)
    assert.deepEqual(scopedSummary.by_provider, [{ provider: 'openai', count: 1 }])
    assert.deepEqual(scopedSummary.by_day, [{ date: '2026-05-08', total: 1, success_count: 1, failed_count: 0 }])
  })
})

test('audit-log response redacts record_id and nested sensitive payload fields', async () => {
  const res = createRes()
  const stubDb = {
    prepare(sql) {
      assert.match(sql, /SELECT \* FROM audit_log WHERE 1=1/)
      return {
        async all(...args) {
          assert.deepEqual(args, [50, 0])
          return [{
            id: 1,
            action: 'client_profile_update',
            table_name: 'client_profiles',
            record_id: '15550001111',
            after_value: JSON.stringify({
              client_id: '15550001111',
              nested: {
                wa_phone: '+1 555 000 2222',
                items: [{ record_id: '15550003333' }],
              },
            }),
            before_value: {
              token: 'top-secret',
              details: {
                phone: '+1 555 000 4444',
              },
            },
          }]
        },
      }
    },
  }

  await withDbStub(stubDb, async () => {
    // DB-backed admin 才能查管理全量视图
    await getAuditLog({ query: {}, auth: { role: 'admin', source: 'db', user_id: 1 } }, res)
  })

  assert.equal(res.statusCode, 200)
  assert.equal(res.body[0].record_id, '[REDACTED]')
  assert.deepEqual(res.body[0].after_value, {
    client_id: '[REDACTED]',
    nested: {
      wa_phone: '[REDACTED]',
      items: [{ record_id: '[REDACTED]' }],
    },
  })
  assert.deepEqual(res.body[0].before_value, {
    token: '[REDACTED]',
    details: {
      phone: '[REDACTED]',
    },
  })
})

test('generation-log detail returns parsed payloads and retrieval snapshot summary', async () => {
  const res = createRes()
  const stubDb = {
    prepare(sql) {
      assert.match(sql, /FROM generation_log gl/)
      return {
        async get(id) {
          assert.equal(id, 11)
          return {
            id: 11,
            client_id: '15550001',
            retrieval_snapshot_id: 7,
            provider: 'minimax',
            model: 'mini-max-typing',
            route: 'generate-candidates',
            ab_bucket: 'minimax',
            scene: 'trial_intro',
            operator: 'Beau',
            temperature_json: '[0.8,0.4]',
            message_count: 4,
            prompt_version: 'v2_Beau_pol',
            latency_ms: 1234,
            status: 'success',
            error_message: null,
            created_at: '2026-04-16 10:00:00',
            retrieval_operator: 'Beau',
            retrieval_scene: 'trial_intro',
            retrieval_prompt_version: 'v2_Beau_pol',
            snapshot_hash: 'snap_hash_1',
            grounding_json: '{"rag":{"enabled":true,"hit_count":2,"hits":[{"source_id":"doc-1"}]}}',
            topic_context: 'topic block',
            rich_context: 'rich block',
            conversation_summary: 'summary block',
            owner: 'Beau',
          }
        },
      }
    },
  }

  await withDbStub(stubDb, async () => {
    await getGenerationLogDetail({ params: { id: '11' }, auth: { role: 'admin' } }, res)
  })

  assert.equal(res.statusCode, 200)
  assert.equal(res.body.id, 11)
  assert.deepEqual(res.body.temperature, [0.8, 0.4])
  assert.equal(res.body.rag.hit_count, 2)
  assert.equal(res.body.retrieval_snapshot.id, 7)
  assert.equal(res.body.retrieval_snapshot.snapshot_hash, 'snap_hash_1')
})

test('generation-log detail blocks foreign owner-scoped token', async () => {
  const res = createRes()
  const stubDb = {
    prepare() {
      return {
        async get() {
          return {
            id: 12,
            client_id: '15550002',
            retrieval_snapshot_id: null,
            provider: 'openai',
            model: 'gpt-4o',
            route: 'minimax',
            ab_bucket: 'openai',
            scene: 'follow_up',
            operator: 'Yiyun',
            temperature_json: '[0.8,0.4]',
            message_count: 2,
            prompt_version: 'v2_Yiyun',
            latency_ms: 500,
            status: 'success',
            error_message: null,
            created_at: '2026-04-16 10:00:00',
            retrieval_operator: null,
            retrieval_scene: null,
            retrieval_prompt_version: null,
            snapshot_hash: null,
            grounding_json: '{}',
            topic_context: null,
            rich_context: null,
            conversation_summary: null,
            owner: 'Yiyun',
          }
        },
      }
    },
  }

  await withDbStub(stubDb, async () => {
    await getGenerationLogDetail({ params: { id: '12' }, auth: { owner: 'Beau', owner_locked: true, role: 'owner' } }, res)
  })

  assert.equal(res.statusCode, 403)
  assert.equal(res.body?.ok, false)
})

test('retrieval-snapshot detail returns parsed grounding payload', async () => {
  const res = createRes()
  const stubDb = {
    prepare(sql) {
      assert.match(sql, /FROM retrieval_snapshot rs/)
      return {
        async get(id) {
          assert.equal(id, 21)
          return {
            id: 21,
            client_id: '15550003',
            operator: 'Beau',
            scene: 'trial_intro',
            system_prompt_version: 'v2_Beau_mem_pol',
            snapshot_hash: 'snap_hash_21',
            grounding_json: '{"memory":[{"memory_key":"tone"}],"rag":{"enabled":false}}',
            topic_context: 'topic',
            rich_context: 'rich',
            conversation_summary: 'summary',
            created_at: '2026-04-16 10:30:00',
            owner: 'Beau',
          }
        },
      }
    },
  }

  await withDbStub(stubDb, async () => {
    await getRetrievalSnapshotDetail({ params: { id: '21' }, auth: { role: 'admin' } }, res)
  })

  assert.equal(res.statusCode, 200)
  assert.equal(res.body.id, 21)
  assert.equal(res.body.system_prompt_version, 'v2_Beau_mem_pol')
  assert.deepEqual(res.body.grounding_json, {
    memory: [{ memory_key: 'tone' }],
    rag: { enabled: false },
  })
})
