import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  aggregateEventStats,
  canEventDriveLifecycle,
  isCanonicalLifecycleEventKey,
  isGeneratedLifecycleEventKey,
  normalizeLifecycleEventRow,
} = require('../server/services/eventLifecycleFacts');

test('canonical lifecycle helper rejects generated and weak events', () => {
  assert.equal(isCanonicalLifecycleEventKey('agency_bound'), true);
  assert.equal(isGeneratedLifecycleEventKey('jb_touchpoint_20260424'), true);
  assert.equal(isCanonicalLifecycleEventKey('jb_touchpoint_20260424'), false);

  assert.equal(canEventDriveLifecycle({
    event_key: 'agency_bound',
    status: 'active',
    meta: { evidence_contract: { evidence_tier: 1 } },
  }), false);

  assert.equal(canEventDriveLifecycle({
    event_key: 'agency_bound',
    status: 'active',
    meta: { evidence_contract: { evidence_tier: 2 } },
  }), true);

  assert.equal(canEventDriveLifecycle({
    event_key: 'agency_bound',
    status: 'active',
    meta: {
      evidence_contract: { evidence_tier: 2 },
      lifecycle_overlay: { drives_main_stage: false },
    },
  }), false);

  assert.equal(canEventDriveLifecycle({
    event_key: 'violation_appeal',
    event_type: 'challenge',
    status: 'completed',
  }), false);
});

test('normalizeLifecycleEventRow parses meta and normalizes pending status to draft', () => {
  const row = normalizeLifecycleEventRow({
    creator_id: '42',
    event_key: 'trial_7day',
    status: 'pending',
    meta: '{"evidence_contract":{"evidence_tier":2}}',
  });

  assert.equal(row.creator_id, 42);
  assert.equal(row.status, 'draft');
  assert.equal(row.meta.evidence_contract.evidence_tier, 2);
});

test('aggregateEventStats separates detected, business, and confirmed event metrics', () => {
  const stats = aggregateEventStats([
    {
      id: 1,
      event_key: 'agency_bound',
      status: 'active',
      created_at: '2026-04-24 10:00:00',
      start_at: '2026-04-23 10:00:00',
      meta: { evidence_contract: { evidence_tier: 2 } },
    },
    {
      id: 2,
      event_key: 'gmv_milestone',
      status: 'completed',
      created_at: '2026-04-23 10:00:00',
      start_at: '2026-04-24 12:00:00',
      meta: {
        evidence_contract: { evidence_tier: 3 },
        verification: {
          review_status: 'confirmed',
          verified_at: '2026-04-24T15:00:00.000Z',
        },
      },
    },
    {
      id: 3,
      event_key: 'jb_touchpoint_20260424',
      status: 'completed',
      created_at: '2026-04-24 09:00:00',
      meta: {},
    },
    {
      id: 4,
      event_key: 'trial_7day',
      status: 'active',
      created_at: '2026-04-24 09:00:00',
      meta: { evidence_contract: { evidence_tier: 1 } },
    },
  ], {
    yesterdayKey: '2026-04-24',
    timeZone: 'UTC',
  });

  assert.equal(stats.total_events, 4);
  assert.equal(stats.total_canonical_events, 3);
  assert.equal(stats.total_lifecycle_driving_events, 2);
  assert.equal(stats.yesterday_detected_events, 3);
  assert.equal(stats.yesterday_business_events, 1);
  assert.equal(stats.yesterday_confirmed_events, 1);
});
