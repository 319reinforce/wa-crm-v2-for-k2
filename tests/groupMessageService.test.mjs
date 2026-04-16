import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const groupMessageService = require('../server/services/groupMessageService')

test('buildConflictKey distinguishes role and exact timestamp', () => {
  const sameTextUser = groupMessageService.buildConflictKey({
    role: 'user',
    text: 'ok',
    timestamp: 1710000000000,
  })
  const sameTextMe = groupMessageService.buildConflictKey({
    role: 'me',
    text: 'ok',
    timestamp: 1710000000000,
  })
  const sameSecondDifferentMs = groupMessageService.buildConflictKey({
    role: 'user',
    text: 'ok',
    timestamp: 1710000000123,
  })

  assert.notEqual(sameTextUser, sameTextMe)
  assert.notEqual(sameTextUser, sameSecondDifferentMs)
})

test('group scope helper requires both session and operator when both are available', () => {
  const scoped = groupMessageService._private.buildGroupScopeMatch({
    sessionId: 'session-beau',
    operator: 'Beau',
  })

  assert.match(scoped.clause, /AND/)
  assert.equal(scoped.params.length, 4)
})

test('group scope helper falls back to single-dimension scope only when necessary', () => {
  const sessionOnly = groupMessageService._private.buildGroupScopeMatch({
    sessionId: 'session-beau',
    operator: '',
  })
  const operatorOnly = groupMessageService._private.buildGroupScopeMatch({
    sessionId: '',
    operator: 'Beau',
  })

  assert.equal(sessionOnly.params.length, 2)
  assert.equal(operatorOnly.params.length, 2)
  assert.doesNotMatch(sessionOnly.clause, /AND/)
  assert.doesNotMatch(operatorOnly.clause, /AND/)
})
