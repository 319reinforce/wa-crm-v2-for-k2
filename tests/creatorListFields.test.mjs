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

test('projectLifecycleForList keeps only list-consumed fields, drops heavy metadata', () => {
  const fullLifecycle = {
    stage_key: 'retention',
    stage_label: 'Retention（留存）',
    flags: { referral_active: true, wa_joined: false, beta_status: 'active' },
    has_conflicts: true,
    // 以下应被剥离
    option0: { label: 'big', next_action_template: 'x'.repeat(200), next_action_template_en: 'y'.repeat(200) },
    rule_flags: { revenue_gmv_threshold: 2000 },
    primary_facts: { wa_joined: false },
    goal: '阶段目标文字'.repeat(10),
    exit_signal_hint: '退出提示',
    entry_reason: '进入原因',
    entry_signals: ['agency_bound'],
    conflicts: [{ type: 'x' }],
    evaluated_at: '2026-04-18T00:00:00Z',
    snapshot_version: 'lifecycle_v4',
    model: 'AARRR',
  }
  const projected = creatorsRouter._private.projectLifecycleForList(fullLifecycle)
  assert.deepEqual(projected, {
    stage_key: 'retention',
    stage_label: 'Retention（留存）',
    flags: { referral_active: true, wa_joined: false, beta_status: 'active' },
    has_conflicts: true,
  })
  // 验证白名单就是公开期望的这四个
  assert.deepEqual(
    [...creatorsRouter._private.LIST_LIFECYCLE_ALLOWED_KEYS].sort(),
    ['flags', 'has_conflicts', 'stage_key', 'stage_label'],
  )
})

test('projectLifecycleForList returns null for null or non-object input', () => {
  assert.equal(creatorsRouter._private.projectLifecycleForList(null), null)
  assert.equal(creatorsRouter._private.projectLifecycleForList(undefined), null)
  assert.equal(creatorsRouter._private.projectLifecycleForList('not-an-object'), null)
})

test('projectLifecycleForList omits missing optional fields without inserting undefined', () => {
  const partial = { stage_key: 'acquisition' }
  const projected = creatorsRouter._private.projectLifecycleForList(partial)
  assert.deepEqual(projected, { stage_key: 'acquisition' })
  assert.equal('stage_label' in projected, false)
  assert.equal('flags' in projected, false)
  assert.equal('has_conflicts' in projected, false)
})
