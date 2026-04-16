import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const sftRouter = require('../server/routes/sft')
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

const exportSftRecords = getRouteHandler(sftRouter, 'get', '/sft-export')

test('GET /api/sft-export prefers formal generation tracking columns over context fallback', async () => {
  const res = createRes()
  const row = {
    id: 1,
    human_selected: 'opt2',
    human_output: 'final reply',
    similarity: 92,
    model_opt1: 'candidate A',
    model_opt2: 'candidate B',
    is_custom_input: 0,
    reviewed_by: 'system',
    created_at: '2026-04-16 11:00:00',
    scene: 'trial_intro',
    system_prompt_used: 'captured prompt',
    system_prompt_version: 'v2_Beau',
    chosen_output: 'candidate B',
    rejected_output: 'candidate A',
    retrieval_snapshot_id: 101,
    generation_log_id: 202,
    provider: 'minimax',
    model: 'mini-max-typing',
    scene_source: 'detected',
    pipeline_version: 'reply_generation_v2',
    context_json: JSON.stringify({
      client_id: '15550021',
      scene: 'trial_intro',
      input_text: 'creator says hi',
      retrieval_snapshot_id: 999,
      generation_log_id: 999,
      provider: 'context-provider',
      model: 'context-model',
      scene_source: 'context-scene',
      pipeline_version: 'context-pipeline',
    }),
    message_history: JSON.stringify([
      { role: 'user', text: 'creator says hi' },
      { role: 'me', text: 'operator reply' },
    ]),
    owner: 'Beau',
  }

  const stubDb = {
    prepare(sql) {
      if (sql.includes('FROM sft_memory sm')) {
        return {
          async all(status, limit, offset) {
            assert.equal(status, 'approved')
            assert.equal(limit, 10)
            assert.equal(offset, 0)
            return [row]
          },
        }
      }
      throw new Error(`Unexpected SQL: ${sql}`)
    },
  }

  await withDbStub(stubDb, async () => {
    await exportSftRecords({
      query: { format: 'json', limit: '10', include_retrieval: 'false' },
      auth: { role: 'admin' },
    }, res)
  })

  assert.equal(res.statusCode, 200)
  assert.equal(Array.isArray(res.body), true)
  assert.equal(res.body.length, 1)
  assert.equal(res.body[0].messages[0].content, 'captured prompt')
  assert.equal(res.body[0].metadata.retrieval_snapshot_id, 101)
  assert.equal(res.body[0].metadata.generation_log_id, 202)
  assert.equal(res.body[0].metadata.provider, 'minimax')
  assert.equal(res.body[0].metadata.model, 'mini-max-typing')
  assert.equal(res.body[0].metadata.scene_source, 'detected')
  assert.equal(res.body[0].metadata.pipeline_version, 'reply_generation_v2')
})
