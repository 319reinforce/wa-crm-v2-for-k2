import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { buildLifecycle, extractSignals, OPTION0_TEMPLATES } = require('../server/services/lifecycleService');

test('extractSignals detects WA join, agency bound and gmv threshold from mixed payload', () => {
  const signals = extractSignals({
    message_facts: { wa_joined: true },
    wacrm: { agency_bound: 1 },
    keeper: { keeper_gmv: 2600 },
  });

  assert.equal(signals.waJoined, true);
  assert.equal(signals.agencyBound, true);
  assert.equal(signals.gmvReached, true);
});

test('buildLifecycle keeps acquisition as default stage before WA join', () => {
  const lifecycle = buildLifecycle({
    beta_status: 'not_introduced',
    agency_bound: 0,
  });

  assert.equal(lifecycle.stage_key, 'acquisition');
  assert.equal(lifecycle.option0.key, OPTION0_TEMPLATES.acquisition.key);
  assert.equal(lifecycle.flags.wa_joined, false);
  assert.equal(lifecycle.has_conflicts, false);
});

test('buildLifecycle enters acquisition after first effective WA message', () => {
  const lifecycle = buildLifecycle({
    message_facts: { wa_joined: true },
  });

  assert.equal(lifecycle.stage_key, 'acquisition');
  assert.equal(lifecycle.flags.wa_joined, true);
  assert.ok(lifecycle.entry_signals.includes('wa_first_effective_message'));
});

test('buildLifecycle enters activation when 7-day challenge is completed', () => {
  const lifecycle = buildLifecycle({
    message_facts: { wa_joined: true },
    joinbrands: { ev_trial_7day: 1 },
  });

  assert.equal(lifecycle.stage_key, 'activation');
  assert.ok(lifecycle.entry_signals.includes('trial_7day_completed'));
});

test('buildLifecycle treats trial completion semantics in trigger_text as activation', () => {
  const lifecycle = buildLifecycle({
    message_facts: { wa_joined: true },
    events: [
      {
        event_key: 'trial_7day',
        event_type: 'challenge',
        status: 'active',
        trigger_text: 'Creator completed the 7-day trial and is moving to the monthly beta program.',
      },
    ],
  });

  assert.equal(lifecycle.stage_key, 'activation');
  assert.equal(lifecycle.flags.trial_completed, true);
  assert.equal(lifecycle.flags.trial_completed_semantic, true);
  assert.ok(lifecycle.entry_signals.includes('trial_7day_completed'));
});

test('buildLifecycle enters retention when agency is bound and gmv is below threshold', () => {
  const lifecycle = buildLifecycle({
    message_facts: { wa_joined: true },
    wacrm: { agency_bound: 1 },
    keeper: { keeper_gmv: 600 },
  });

  assert.equal(lifecycle.stage_key, 'retention');
  assert.equal(lifecycle.flags.agency_bound, true);
});

test('buildLifecycle enters revenue when gmv reaches threshold even without agency bound', () => {
  const lifecycle = buildLifecycle({
    message_facts: { wa_joined: true },
    keeper: { keeper_gmv: 2200 },
  }, { revenueGmvThreshold: 2000 });

  assert.equal(lifecycle.stage_key, 'revenue');
  assert.ok(lifecycle.entry_reason.includes('2000'));
});

test('buildLifecycle respects configurable gmv threshold for revenue', () => {
  const lifecycle = buildLifecycle({
    message_facts: { wa_joined: true },
    wacrm: { agency_bound: 1 },
    keeper: { keeper_gmv: 2200 },
  }, { revenueGmvThreshold: 5000 });

  assert.equal(lifecycle.stage_key, 'retention');
});

test('buildLifecycle keeps revenue as main stage when referral is active in parallel', () => {
  const lifecycle = buildLifecycle({
    message_facts: { wa_joined: true },
    events: [{ event_key: 'referral', event_type: 'referral', status: 'completed' }],
    keeper: { keeper_gmv: 2600 },
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

test('extractSignals promotes agency/gmv/referral from events table rows', () => {
  const signals = extractSignals({
    message_facts: { wa_joined: true },
    events: [
      { event_key: 'agency_bound', event_type: 'agency', status: 'active' },
      { event_key: 'gmv_milestone', event_type: 'gmv', status: 'active' },
      { event_key: 'referral', event_type: 'referral', status: 'completed' },
    ],
  });

  assert.equal(signals.agencyBound, true);
  assert.equal(signals.gmvReached, true);
  assert.equal(signals.referral, true);
});

test('extractSignals ignores weak MiniMax evidence for main lifecycle movement', () => {
  const signals = extractSignals({
    message_facts: { wa_joined: true },
    events: [
      {
        event_key: 'agency_bound',
        event_type: 'agency',
        status: 'active',
        meta: {
          evidence_contract: {
            evidence_tier: 1,
            source_kind: 'current_text',
          },
        },
      },
      {
        event_key: 'gmv_milestone',
        event_type: 'gmv',
        status: 'active',
        meta: {
          evidence_contract: {
            evidence_tier: 0,
            source_kind: 'keyword',
          },
        },
      },
    ],
  });

  assert.equal(signals.agencyBound, false);
  assert.equal(signals.gmvReached, false);
});

test('extractSignals ignores generated event keys even when event_type looks lifecycle-like', () => {
  const signals = extractSignals({
    message_facts: { wa_joined: true },
    events: [
      { event_key: 'violation_appeal', event_type: 'challenge', status: 'active' },
      { event_key: 'jb_touchpoint_20260424', event_type: 'agency', status: 'completed' },
      { event_key: 'gmv_milestone_10k', event_type: 'gmv', status: 'completed' },
    ],
  });

  assert.equal(signals.trialInProgress, false);
  assert.equal(signals.agencyBound, false);
  assert.equal(signals.gmvReached, false);
});
