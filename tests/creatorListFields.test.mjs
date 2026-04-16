import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const creatorsRouter = require('../server/routes/creators')

test('parseRequestedCreatorFields normalizes comma-separated field list', () => {
  const fields = creatorsRouter._private.parseRequestedCreatorFields(' wa_phone, Wa_Owner ,, ')
  assert.equal(fields.has('wa_phone'), true)
  assert.equal(fields.has('wa_owner'), true)
  assert.equal(fields.size, 2)
})

test('creator list only exposes wa_phone for privileged roles with explicit field request', () => {
  const fields = new Set(['wa_phone'])
  assert.equal(creatorsRouter._private.shouldExposeCreatorListPhone({ auth: { role: 'admin' } }, fields), true)
  assert.equal(creatorsRouter._private.shouldExposeCreatorListPhone({ auth: { role: 'service' } }, fields), true)
  assert.equal(creatorsRouter._private.shouldExposeCreatorListPhone({ auth: { role: 'owner' } }, fields), false)
})

test('creator list keeps wa_phone hidden when field is not explicitly requested', () => {
  const fields = new Set()
  assert.equal(creatorsRouter._private.shouldExposeCreatorListPhone({ auth: { role: 'admin' } }, fields), false)
})

test('creator update audit payload keeps only whitelisted fields', () => {
  const payload = creatorsRouter._private.buildCreatorUpdateAuditPayload({
    primary_name: 'Alice',
    wa_phone: '+15550001',
    wa_owner: 'Beau',
    keeper_username: 'alice_keeper',
    ignored: 'nope',
  })

  assert.deepEqual(payload, {
    primary_name: 'Alice',
    wa_phone: '+15550001',
    wa_owner: 'Beau',
    keeper_username: 'alice_keeper',
  })
})

test('creator wacrm audit payload keeps only accepted update fields', () => {
  const payload = creatorsRouter._private.buildCreatorWacrmAuditPayload({
    beta_status: 'active',
    next_action: 'follow up tomorrow',
    ev_gmv_5k: true,
    wa_phone: '+15550001',
    ignored: 'nope',
  }, {
    updatedFields: ['wacrm.beta_status', 'wacrm.next_action', 'jb.ev_gmv_5k'],
    lifecycleChanged: true,
  })

  assert.deepEqual(payload, {
    changes: {
      beta_status: 'active',
      next_action: 'follow up tomorrow',
      ev_gmv_5k: true,
    },
    updated: ['wacrm.beta_status', 'wacrm.next_action', 'jb.ev_gmv_5k'],
    lifecycle_before: null,
    lifecycle_after: null,
    lifecycle_changed: true,
    reply_strategy: null,
  })
})
