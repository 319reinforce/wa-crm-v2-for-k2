import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const require = createRequire(import.meta.url)
const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(__dirname, '..')

const {
  createRateLimiter,
  resetRateLimitStores,
} = require('../server/middleware/rateLimit')
const {
  requestErrorLogMiddleware,
  sanitizeLogValue,
} = require('../server/middleware/structuredLog')
const sseBus = require('../server/events/sseBus')

function createReq(overrides = {}) {
  return {
    method: 'POST',
    path: '/api/example',
    originalUrl: '/api/example',
    headers: {},
    ip: '127.0.0.1',
    auth: { role: 'admin', source: 'db', user_id: 7, username: 'admin' },
    ...overrides,
  }
}

function createRes() {
  const res = new EventEmitter()
  res.statusCode = 200
  res.headers = {}
  res.body = null
  res.setHeader = (key, value) => { res.headers[key] = value }
  res.status = (code) => {
    res.statusCode = code
    return res
  }
  res.json = (payload) => {
    res.body = payload
    return res
  }
  return res
}

test('Phase 5 rate limiter returns 429 with retry metadata after the configured burst', () => {
  resetRateLimitStores()
  const limiter = createRateLimiter({
    name: 'phase5_test',
    windowMs: 60_000,
    max: 2,
    methods: ['POST'],
    keyGenerator: () => 'same-client',
  })

  let nextCalls = 0
  const req = createReq()

  limiter(req, createRes(), () => { nextCalls += 1 })
  limiter(req, createRes(), () => { nextCalls += 1 })

  const warnings = []
  const originalWarn = console.warn
  console.warn = (line) => warnings.push(line)
  try {
    const limitedRes = createRes()
    limiter(req, limitedRes, () => { nextCalls += 1 })

    assert.equal(nextCalls, 2)
    assert.equal(limitedRes.statusCode, 429)
    assert.equal(limitedRes.body.error, 'Too many requests')
    assert.equal(limitedRes.headers['X-RateLimit-Limit'], '2')
    assert.ok(Number(limitedRes.headers['Retry-After']) >= 1)
    const parsed = JSON.parse(warnings[0])
    assert.equal(parsed.event, 'rate_limited')
    assert.equal(parsed.requestId, null)
    assert.equal(parsed.limiter, 'phase5_test')
    assert.ok(parsed.keyHash)
  } finally {
    console.warn = originalWarn
    resetRateLimitStores()
  }
})

test('request error logging emits structured JSON with request ID and redaction', () => {
  const errors = []
  const originalError = console.error
  console.error = (line) => errors.push(line)
  try {
    const req = createReq({
      id: 'phase5:req-1',
      requestId: 'phase5:req-1',
      originalUrl: '/api/ai/generate-candidates',
      path: '/api/ai/generate-candidates',
      auth: { role: 'operator', source: 'db', owner: 'Beau', user_id: 12 },
    })
    const res = createRes()
    requestErrorLogMiddleware(req, res, () => {})
    res.statusCode = 502
    res.emit('finish')

    assert.equal(errors.length, 1)
    const parsed = JSON.parse(errors[0])
    assert.equal(parsed.event, 'api_response_error')
    assert.equal(parsed.requestId, 'phase5:req-1')
    assert.equal(parsed.status, 502)
    assert.equal(parsed.ownerScope, 'Beau')

    assert.deepEqual(sanitizeLogValue({
      client_id: '+1 555 111 2222',
      nested: { wa_phone: '+15551112222', message: 'call +1 555 111 2222' },
    }), {
      client_id: '[REDACTED]',
      nested: { wa_phone: '[REDACTED]', message: 'call [REDACTED]' },
    })
  } finally {
    console.error = originalError
  }
})

test('SSE bus caps clients, emits scoped metadata, and cleans up on close', () => {
  const originalMax = process.env.SSE_MAX_CLIENTS
  process.env.SSE_MAX_CLIENTS = '1'
  sseBus._private.resetForTests()

  try {
    const first = createRes()
    first.writes = []
    first.write = (chunk) => {
      first.writes.push(chunk)
      return true
    }

    const accepted = sseBus.addClient(first, {
      requestId: 'phase5:sse-1',
      ownerScope: 'Yiyun',
      authRole: 'operator',
      userId: 5,
    })

    assert.equal(accepted.accepted, true)
    assert.equal(sseBus.count(), 1)
    assert.match(first.writes[0], /event: sse-meta/)
    assert.match(first.writes[0], /phase5:sse-1/)
    assert.equal(sseBus.canAcceptClient(), false)

    const second = createRes()
    const rejected = sseBus.addClient(second, { requestId: 'phase5:sse-2' })
    assert.equal(rejected.accepted, false)
    assert.equal(rejected.reason, 'client_limit')
    assert.equal(sseBus.count(), 1)

    first.emit('close')
    assert.equal(sseBus.count(), 0)
  } finally {
    if (originalMax === undefined) delete process.env.SSE_MAX_CLIENTS
    else process.env.SSE_MAX_CLIENTS = originalMax
    sseBus._private.resetForTests()
  }
})

test('Phase 5 middleware is mounted on auth, AI, media, write, and SSE paths', () => {
  const source = readFileSync(join(repoRoot, 'server/index.cjs'), 'utf8')
  assert.match(source, /app\.use\(rateLimiters\.apiWrite\)/)
  assert.match(source, /app\.post\('\/api\/auth\/login', rateLimiters\.authLogin/)
  assert.match(source, /app\.use\('\/api', requireAppAuth, rateLimiters\.ai, aiRouter\)/)
  assert.match(source, /app\.use\('\/api\/wa', requireAppAuth, rateLimiters\.mediaUpload, waRouter\)/)
  assert.match(source, /sseBus\.canAcceptClient\(\)/)
  assert.match(source, /sse_client_limit_reached/)
})
