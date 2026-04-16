import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const appAuth = require('../server/middleware/appAuth')
const trainingRouter = require('../server/routes/training')
const {
  getInternalServiceToken,
  getInternalServiceHeaders,
} = require('../server/utils/internalAuth')

async function withEnv(patch, fn) {
  const previous = {}
  for (const [key, value] of Object.entries(patch)) {
    previous[key] = process.env[key]
    if (value === null) delete process.env[key]
    else process.env[key] = value
  }
  const restore = () => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
  try {
    return await fn()
  } finally {
    restore()
  }
}

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

test('admin login token remains preferred over internal service token', () => {
  return withEnv({
    APP_LOGIN_USERNAME: 'k2',
    APP_LOGIN_PASSWORD: 'weiaifadian2026',
    API_AUTH_TOKEN: 'admin-token',
    INTERNAL_SERVICE_TOKEN: 'service-token',
  }, () => {
    const primary = appAuth.getPrimaryLoginTokenEntry()

    assert.equal(primary?.token, 'admin-token')
    assert.equal(primary?.role, 'admin')
    assert.equal(getInternalServiceToken(), 'service-token')
  })
})

test('requireAppAuth accepts internal service token without localhost bypass', async () => {
  await withEnv({
    NODE_ENV: 'production',
    LOCAL_API_AUTH_BYPASS: 'false',
    API_AUTH_TOKEN: '',
    CRM_ADMIN_TOKEN: '',
    WA_ADMIN_TOKEN: '',
    INTERNAL_SERVICE_TOKEN: 'service-token',
  }, async () => {
    const req = {
      headers: { authorization: 'Bearer service-token' },
      query: {},
      ip: '10.0.0.8',
      socket: { remoteAddress: '10.0.0.8' },
      hostname: 'service.local',
    }
    const res = createRes()
    let nextCalled = false

    await appAuth.requireAppAuth(req, res, () => {
      nextCalled = true
    })

    assert.equal(nextCalled, true)
    assert.equal(req.auth?.role, 'service')
    assert.equal(res.statusCode, 200)
  })
})

test('requireAppAuth accepts cookie token when Authorization header is absent', async () => {
  await withEnv({
    NODE_ENV: 'production',
    LOCAL_API_AUTH_BYPASS: 'false',
    API_AUTH_TOKEN: 'admin-token',
  }, async () => {
    const req = {
      headers: { cookie: `${appAuth.APP_AUTH_COOKIE_NAME}=admin-token` },
      query: {},
      ip: '10.0.0.8',
      socket: { remoteAddress: '10.0.0.8' },
      hostname: 'app.local',
    }
    const res = createRes()
    let nextCalled = false

    await appAuth.requireAppAuth(req, res, () => {
      nextCalled = true
    })

    assert.equal(nextCalled, true)
    assert.equal(req.auth?.role, 'admin')
    assert.equal(res.statusCode, 200)
  })
})

test('requireAppAuth rejects legacy query-string token fallback', async () => {
  await withEnv({
    NODE_ENV: 'production',
    LOCAL_API_AUTH_BYPASS: 'false',
    API_AUTH_TOKEN: 'admin-token',
  }, async () => {
    const req = {
      headers: {},
      query: { token: 'admin-token' },
      ip: '10.0.0.8',
      socket: { remoteAddress: '10.0.0.8' },
      hostname: 'app.local',
    }
    const res = createRes()
    let nextCalled = false

    await appAuth.requireAppAuth(req, res, () => {
      nextCalled = true
    })

    assert.equal(nextCalled, false)
    assert.equal(res.statusCode, 401)
  })
})

test('internal service headers include bearer token when available', () => {
  return withEnv({
    INTERNAL_SERVICE_TOKEN: 'service-token',
    TRAINING_TRIGGER_TOKEN: '',
  }, () => {
    const headers = getInternalServiceHeaders({ 'Content-Type': 'application/json' })
    assert.equal(headers.Authorization, 'Bearer service-token')
    assert.equal(headers['Content-Type'], 'application/json')
  })
})

test('training trigger helper rejects owner-scoped tokens', () => {
  const req = { auth: { role: 'owner', owner: 'Beau', owner_locked: true } }
  const res = createRes()

  const allowed = trainingRouter._private.ensureTrainingTriggerAccess(req, res)

  assert.equal(allowed, false)
  assert.equal(res.statusCode, 403)
})

test('training trigger helper allows service/admin tokens', () => {
  const serviceReq = { auth: { role: 'service' } }
  const adminReq = { auth: { role: 'admin' } }

  assert.equal(trainingRouter._private.ensureTrainingTriggerAccess(serviceReq, createRes()), true)
  assert.equal(trainingRouter._private.ensureTrainingTriggerAccess(adminReq, createRes()), true)
})
