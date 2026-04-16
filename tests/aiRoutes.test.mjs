import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

function createRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code
      return this
    },
    json(payload) {
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

function loadAiRouterWithStubs(overrides = {}) {
  const servicePath = require.resolve('../server/services/replyGenerationService')
  const routerPath = require.resolve('../server/routes/ai')
  const service = require(servicePath)
  const originals = {}

  for (const [key, stub] of Object.entries(overrides)) {
    originals[key] = service[key]
    service[key] = stub
  }

  delete require.cache[routerPath]
  const router = require(routerPath)

  return {
    router,
    restore() {
      delete require.cache[routerPath]
      for (const [key, original] of Object.entries(originals)) {
        service[key] = original
      }
    },
  }
}

test('POST /api/ai/generate-candidates delegates to replyGenerationService with unified route name', async () => {
  let capturedArgs = null
  const { router, restore } = loadAiRouterWithStubs({
    generateReplyCandidates: async (args) => {
      capturedArgs = args
      return {
        opt1: 'candidate A',
        opt2: 'candidate B',
        systemPrompt: 'prompt body',
        systemPromptVersion: 'v2_Beau',
        provider: 'minimax',
        model: 'mini-max-typing',
        retrievalSnapshotId: 31,
        generationLogId: 41,
        pipelineVersion: 'reply_generation_v2',
      }
    },
  })

  try {
    const handler = getRouteHandler(router, 'post', '/ai/generate-candidates')
    const req = {
      body: {
        client_id: '15550011',
        scene: 'trial_intro',
        topicContext: 'topic',
        richContext: 'rich',
        conversationSummary: 'summary',
        query_text: 'hello',
        latest_user_message: 'latest hello',
        messages: [{ role: 'user', content: 'hello there' }],
        model: 'mini-max-typing',
        max_tokens: 222,
        temperature: [0.8, 0.4],
      },
      auth: { role: 'admin' },
    }
    const res = createRes()

    await handler(req, res)

    assert.equal(capturedArgs.clientId, '15550011')
    assert.equal(capturedArgs.routeName, 'generate-candidates')
    assert.equal(capturedArgs.maxTokens, 222)
    assert.deepEqual(capturedArgs.temperature, [0.8, 0.4])
    assert.equal(res.body.opt1, 'candidate A')
    assert.equal(res.body.generationLogId, 41)
    assert.equal(res.body.pipelineVersion, 'reply_generation_v2')
  } finally {
    restore()
  }
})

test('POST /api/minimax preserves compatibility response while delegating to unified service', async () => {
  let capturedArgs = null
  const compatPayload = {
    id: 'minimax-compat',
    type: 'message',
    role: 'assistant',
    provider: 'minimax',
    model: 'mini-max-typing',
    generationLogId: 52,
    content: [{ type: 'text', text: 'compat A' }],
    content_opt1: [{ type: 'text', text: 'compat A' }],
    content_opt2: [{ type: 'text', text: 'compat B' }],
  }
  const { router, restore } = loadAiRouterWithStubs({
    generateCandidatesFromMessages: async (args) => {
      capturedArgs = args
      return compatPayload
    },
  })

  try {
    const handler = getRouteHandler(router, 'post', '/minimax')
    const req = {
      body: {
        client_id: '15550012',
        retrieval_snapshot_id: 61,
        scene: 'follow_up',
        messages: [{ role: 'user', content: 'need help' }],
        max_tokens: 333,
        temperature: [0.9, 0.2],
      },
      auth: { role: 'admin' },
    }
    const res = createRes()

    await handler(req, res)

    assert.equal(capturedArgs.clientId, '15550012')
    assert.equal(capturedArgs.retrievalSnapshotId, 61)
    assert.equal(capturedArgs.routeName, 'minimax')
    assert.deepEqual(capturedArgs.temperature, [0.9, 0.2])
    assert.deepEqual(res.body, compatPayload)
  } finally {
    restore()
  }
})
