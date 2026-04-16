import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import path from 'node:path'

const require = createRequire(import.meta.url)
const smokeScript = require('../scripts/test-smoke.cjs')
const purgeScript = require('../scripts/purge-group-pollution.cjs')

test('smoke runner skips destructive group purge unless explicitly enabled', () => {
  assert.equal(
    smokeScript._private.shouldRunDestructiveGroupPollutionPurge({}),
    false
  )
  assert.equal(
    smokeScript._private.shouldRunDestructiveGroupPollutionPurge({
      SMOKE_PURGE_GROUP_POLLUTION: '0',
    }),
    false
  )
  assert.equal(
    smokeScript._private.shouldRunDestructiveGroupPollutionPurge({
      SMOKE_PURGE_GROUP_POLLUTION: '1',
    }),
    true
  )
})

test('purge script also requires explicit destructive confirmation', () => {
  assert.equal(purgeScript._private.isDestructivePurgeAllowed({}), false)
  assert.equal(
    purgeScript._private.isDestructivePurgeAllowed({
      GROUP_POLLUTION_PURGE_CONFIRM: '1',
    }),
    true
  )
  assert.equal(
    purgeScript._private.isDestructivePurgeAllowed({
      SMOKE_PURGE_GROUP_POLLUTION: '1',
    }),
    true
  )
})

test('purge script exits early without touching the database when not confirmed', () => {
  const scriptPath = path.resolve(process.cwd(), 'scripts/purge-group-pollution.cjs')
  const result = spawnSync(process.execPath, [scriptPath], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      SMOKE_PURGE_GROUP_POLLUTION: '0',
      GROUP_POLLUTION_PURGE_CONFIRM: '0',
    },
    encoding: 'utf8',
  })

  assert.equal(result.status, 2)
  assert.match(
    result.stderr,
    /destructive purge is disabled by default/
  )
})
