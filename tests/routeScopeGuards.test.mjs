import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const profileRouter = require('../server/routes/profile')
const aiRouter = require('../server/routes/ai')
const experienceRouter = require('../server/routes/experience')

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

function createDbConn(ownerByClient = {}) {
  return {
    prepare() {
      return {
        async get(clientId) {
          const owner = ownerByClient[clientId]
          if (!owner) return null
          return {
            id: 1,
            wa_owner: owner,
            primary_name: 'Creator',
          }
        },
      }
    },
  }
}

test('profile scope helper blocks foreign client for owner-scoped token', async () => {
  const req = { auth: { owner: 'Beau', owner_locked: true, role: 'owner' } }
  const res = createRes()
  const dbConn = createDbConn({ '15550001': 'Yiyun' })

  const result = await profileRouter._private.ensureProfileClientScope(req, res, dbConn, '15550001')

  assert.equal(result.ok, false)
  assert.equal(res.statusCode, 403)
})

test('profile scope helper allows matching owner client', async () => {
  const req = { auth: { owner: 'Beau', owner_locked: true, role: 'owner' } }
  const res = createRes()
  const dbConn = createDbConn({ '15550002': 'Beau' })

  const result = await profileRouter._private.ensureProfileClientScope(req, res, dbConn, '15550002')

  assert.equal(result.ok, true)
  assert.equal(result.owner, 'Beau')
  assert.equal(res.statusCode, 200)
})

test('ai scope helper blocks foreign client for owner-scoped token', async () => {
  const req = { auth: { owner: 'Beau', owner_locked: true, role: 'owner' } }
  const res = createRes()
  const dbConn = createDbConn({ '15550003': 'Yiyun' })

  const result = await aiRouter._private.resolveAiRequestScope(req, res, dbConn, {
    clientId: '15550003',
    operator: null,
  })

  assert.equal(result.ok, false)
  assert.equal(res.statusCode, 403)
})

test('ai scope helper rejects operator mismatch against client owner', async () => {
  const req = { auth: { owner: null, owner_locked: false, role: 'admin' } }
  const res = createRes()
  const dbConn = createDbConn({ '15550004': 'Beau' })

  const result = await aiRouter._private.resolveAiRequestScope(req, res, dbConn, {
    clientId: '15550004',
    operator: 'Yiyun',
  })

  assert.equal(result.ok, false)
  assert.equal(res.statusCode, 400)
  assert.equal(res.body?.error, 'operator does not match client owner')
})

test('ai scope helper falls back to locked owner when client id is absent', async () => {
  const req = { auth: { owner: 'Beau', owner_locked: true, role: 'owner' } }
  const res = createRes()
  const dbConn = createDbConn({})

  const result = await aiRouter._private.resolveAiRequestScope(req, res, dbConn, {
    clientId: '',
    operator: null,
  })

  assert.equal(result.ok, true)
  assert.equal(result.owner, 'Beau')
})

test('experience scope helper blocks foreign operator for owner-scoped token', async () => {
  const req = { auth: { owner: 'Beau', owner_locked: true, role: 'owner' } }
  const res = createRes()
  const dbConn = createDbConn({})

  const result = await experienceRouter._private.resolveExperienceScope(req, res, dbConn, {
    clientId: '',
    operator: 'Yiyun',
  })

  assert.equal(result.ok, false)
  assert.equal(res.statusCode, 403)
})

test('experience scope helper rejects operator mismatch against client owner', async () => {
  const req = { auth: { owner: null, owner_locked: false, role: 'admin' } }
  const res = createRes()
  const dbConn = createDbConn({ '15550005': 'Beau' })

  const result = await experienceRouter._private.resolveExperienceScope(req, res, dbConn, {
    clientId: '15550005',
    operator: 'Yiyun',
  })

  assert.equal(result.ok, false)
  assert.equal(res.statusCode, 400)
  assert.equal(res.body?.error, 'operator does not match client owner')
})

test('experience scope helper resolves owner from client when operator omitted', async () => {
  const req = { auth: { owner: null, owner_locked: false, role: 'admin' } }
  const res = createRes()
  const dbConn = createDbConn({ '15550006': 'Beau' })

  const result = await experienceRouter._private.resolveExperienceScope(req, res, dbConn, {
    clientId: '15550006',
    operator: null,
  })

  assert.equal(result.ok, true)
  assert.equal(result.owner, 'Beau')
})
