import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const repairService = require('../server/services/waMessageRepairService')

test('reconcile plan keeps legitimate repeated messages when only one raw copy remains', () => {
  const existingRows = [
    { id: 1, role: 'user', text: 'ok', normalizedText: 'ok', timestamp: 1000 },
    { id: 2, role: 'user', text: 'ok', normalizedText: 'ok', timestamp: 2000 },
  ]
  const normalizedRaw = [
    { role: 'user', text: 'ok', normalizedText: 'ok', timestamp: 1000 },
  ]

  const plan = repairService._private.planReconcileOperations(existingRows, normalizedRaw)

  assert.equal(plan.deletes.length, 0)
  assert.equal(plan.inserts.length, 0)
  assert.equal(plan.roleUpdates.length, 0)
})

test('reconcile plan deletes only exact duplicate leftovers', () => {
  const existingRows = [
    { id: 1, role: 'user', text: 'ok', normalizedText: 'ok', timestamp: 1000 },
    { id: 2, role: 'user', text: 'ok', normalizedText: 'ok', timestamp: 1000 },
  ]
  const normalizedRaw = [
    { role: 'user', text: 'ok', normalizedText: 'ok', timestamp: 1000 },
  ]

  const plan = repairService._private.planReconcileOperations(existingRows, normalizedRaw)

  assert.equal(plan.deletes.length, 1)
  assert.equal(plan.deletes[0].id, 2)
})

test('windowed replace safety blocks possibly truncated raw slices by default', () => {
  const blocked = repairService._private.assessWindowedReplaceSafety({
    rawCount: 800,
    rawFetchLimit: 800,
    deleteAll: false,
    allowPartialWindowReplace: false,
  })
  const allowedComplete = repairService._private.assessWindowedReplaceSafety({
    rawCount: 120,
    rawFetchLimit: 800,
    deleteAll: false,
    allowPartialWindowReplace: false,
  })
  const forced = repairService._private.assessWindowedReplaceSafety({
    rawCount: 800,
    rawFetchLimit: 800,
    deleteAll: false,
    allowPartialWindowReplace: true,
  })

  assert.equal(blocked.safe, false)
  assert.equal(blocked.reason, 'raw_slice_limit_reached')
  assert.equal(allowedComplete.safe, true)
  assert.equal(forced.safe, true)
})

test('normalize raw messages preserves native ids and baileys proto driver for anchors', () => {
  const normalized = repairService._private.normalizeRawMessages([
    {
      role: 'me',
      text: 'hello',
      timestamp: 1776696900000,
      message_id: 'BAE123',
      proto_driver: 'baileys',
    },
  ])

  assert.equal(normalized.length, 1)
  assert.equal(normalized[0].message_id, 'BAE123')
  assert.equal(normalized[0].proto_driver, 'baileys')
})
