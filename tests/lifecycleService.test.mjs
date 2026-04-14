import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { buildLifecycle, extractSignals, OPTION0_TEMPLATES } = require('../server/services/lifecycleService');

test('extractSignals detects agency bound and gmv>2k from mixed payload', () => {
  const signals = extractSignals({
    wacrm: { agency_bound: 1 },
    keeper: { keeper_gmv: 2600 },
  });

  assert.equal(signals.agencyBound, true);
  assert.equal(signals.gmv2k, true);
});

test('buildLifecycle defaults to acquisition', () => {
  const lifecycle = buildLifecycle({
    beta_status: 'not_introduced',
    agency_bound: 0,
  });

  assert.equal(lifecycle.stage_key, 'acquisition');
  assert.equal(lifecycle.option0.key, OPTION0_TEMPLATES.acquisition.key);
});

test('buildLifecycle enters activation when trial is active', () => {
  const lifecycle = buildLifecycle({
    joinbrands: { ev_trial_active: 1 },
  });

  assert.equal(lifecycle.stage_key, 'activation');
  assert.ok(lifecycle.entry_signals.includes('trial_7day_active'));
});

test('buildLifecycle enters retention when monthly challenge or gmv>2k exists', () => {
  const lifecycle = buildLifecycle({
    joinbrands: { ev_monthly_joined: 1 },
    wacrm: { agency_bound: 0 },
  });

  assert.equal(lifecycle.stage_key, 'retention');
});

test('buildLifecycle enters revenue when agency is bound (relaxed mode)', () => {
  const lifecycle = buildLifecycle({
    wacrm: { agency_bound: 1 },
    keeper: { keeper_gmv: 0 },
  }, { strictRevenueGmv: false });

  assert.equal(lifecycle.stage_key, 'revenue');
  assert.ok(lifecycle.entry_reason.includes('临时规则'));
});

test('buildLifecycle does not enter revenue when strictRevenueGmv is true and gmv is low', () => {
  const lifecycle = buildLifecycle({
    wacrm: { agency_bound: 1, beta_status: 'started' },
    keeper: { keeper_gmv: 1200 },
  }, { strictRevenueGmv: true });

  assert.notEqual(lifecycle.stage_key, 'revenue');
});

test('buildLifecycle keeps acquisition when only referral source is detected', () => {
  const lifecycle = buildLifecycle({
    source: 'referral',
    wacrm: { agency_bound: 0 },
  });

  assert.equal(lifecycle.stage_key, 'acquisition');
  assert.ok(lifecycle.entry_signals.includes('referral_source'));
  assert.equal(lifecycle.flags.referral_active, true);
});

test('buildLifecycle keeps revenue as main stage when referral is active in parallel', () => {
  const lifecycle = buildLifecycle({
    events: [{ event_key: 'referral', event_type: 'referral', status: 'completed' }],
    wacrm: { agency_bound: 1 },
  });

  assert.equal(lifecycle.stage_key, 'revenue');
  assert.equal(lifecycle.flags.referral_active, true);
});

test('buildLifecycle enters terminated when churned signal appears', () => {
  const lifecycle = buildLifecycle({
    joinbrands: { ev_churned: 1 },
  });

  assert.equal(lifecycle.stage_key, 'terminated');
  assert.equal(lifecycle.is_terminal, true);
});

test('buildLifecycle enters terminated when next_action says no contact', () => {
  const lifecycle = buildLifecycle({
    wacrm: { next_action: '拒绝绑定且不继续联系' },
    agency_bound: 0,
  });

  assert.equal(lifecycle.stage_key, 'terminated');
});

test('extractSignals promotes agency/gmv/monthly signals from events table rows', () => {
  const signals = extractSignals({
    events: [
      { event_key: 'agency_bound', event_type: 'agency', status: 'active' },
      { event_key: 'monthly_challenge', event_type: 'challenge', status: 'completed' },
      { event_key: 'gmv_milestone', event_type: 'gmv', status: 'active' },
    ],
  });

  assert.equal(signals.agencyBound, true);
  assert.equal(signals.monthlyStarted, true);
  assert.equal(signals.monthlyJoined, true);
  assert.equal(signals.gmv2k, true);
});

test('buildLifecycle enters terminated when termination event type is active', () => {
  const lifecycle = buildLifecycle({
    events: [
      { event_key: 'do_not_contact', event_type: 'termination', status: 'active' },
    ],
  });

  assert.equal(lifecycle.stage_key, 'terminated');
  assert.equal(lifecycle.is_terminal, true);
});

test('buildLifecycle emits conflict when agency bound but revenue is blocked by strict gmv rule', () => {
  const lifecycle = buildLifecycle({
    wacrm: { agency_bound: 1, beta_status: 'started' },
    keeper: { keeper_gmv: 1200 },
  }, { strictRevenueGmv: true, revenueGmvThreshold: 2000, agencyBoundMainline: true });

  assert.equal(lifecycle.stage_key, 'activation');
  assert.equal(lifecycle.has_conflicts, true);
  assert.ok(lifecycle.conflicts.some((item) => item.code === 'agency_bound_not_revenue'));
});
