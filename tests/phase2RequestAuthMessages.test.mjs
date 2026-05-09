import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const require = createRequire(import.meta.url)
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const {
  REQUEST_ID_HEADER,
  normalizeRequestId,
  requestIdMiddleware,
} = require('../server/middleware/requestId')
const messagesRouter = require('../server/routes/messages')

test('request id middleware reuses safe incoming request id', () => {
  const req = { headers: { 'x-request-id': 'ui:req-123' } }
  const headers = {}
  const res = { setHeader: (key, value) => { headers[key] = value } }
  let nextCalled = false

  requestIdMiddleware(req, res, () => { nextCalled = true })

  assert.equal(req.id, 'ui:req-123')
  assert.equal(req.requestId, 'ui:req-123')
  assert.equal(headers[REQUEST_ID_HEADER], 'ui:req-123')
  assert.equal(nextCalled, true)
})

test('request id middleware rejects unsafe incoming values and generates a replacement', () => {
  const req = { headers: { 'x-request-id': 'bad value with spaces' } }
  const headers = {}
  const res = { setHeader: (key, value) => { headers[key] = value } }

  requestIdMiddleware(req, res, () => {})

  assert.notEqual(req.id, 'bad value with spaces')
  assert.equal(headers[REQUEST_ID_HEADER], req.id)
  assert.match(req.id, /^[A-Za-z0-9._:-]+$/)
})

test('normalizeRequestId enforces length and character safety', () => {
  assert.equal(normalizeRequestId('abc-123_:.xyz'), 'abc-123_:.xyz')
  assert.equal(normalizeRequestId('abc 123'), '')
  assert.equal(normalizeRequestId('x'.repeat(129)), '')
})

test('messages select projection does not expose raw proto bytes or SELECT star', () => {
  const select = messagesRouter._private.WA_MESSAGES_SELECT
  assert.doesNotMatch(select, /wm\.\*/)
  assert.doesNotMatch(select, /proto_bytes/)
  assert.doesNotMatch(select, /proto_driver/)
  assert.match(select, /wm\.wa_message_id/)
  assert.match(select, /media_url/)
  assert.match(select, /mime_type/)
})

test('app auth utility exposes cross-tab subscription hooks', () => {
  const source = readFileSync(path.join(__dirname, '..', 'src/utils/appAuth.js'), 'utf8')
  assert.match(source, /const AUTH_CHANGE_EVENT = 'app-auth-change'/)
  assert.match(source, /window\.addEventListener\('storage', onStorage\)/)
  assert.match(source, /APP_AUTH_STORAGE_KEYS\.includes\(event\.key\)/)
  assert.match(source, /window\.dispatchEvent\(new CustomEvent\(AUTH_CHANGE_EVENT/)
})
