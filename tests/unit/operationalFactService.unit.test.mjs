import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  buildOperationalFactRequestsFromLegacyPayload,
} = require('../../server/services/operationalFactService');

test('maps billing and progress legacy fields to operational fact requests', () => {
  const plan = buildOperationalFactRequestsFromLegacyPayload({
    monthly_fee_amount: 20,
    video_count: 3,
    video_target: 35,
    video_last_checked: 1777200000000,
  });

  assert.deepEqual(plan.handledFields.sort(), [
    'wa_crm_data.monthly_fee_amount',
    'wa_crm_data.video_count',
    'wa_crm_data.video_last_checked',
    'wa_crm_data.video_target',
  ]);
  assert.deepEqual(
    plan.requests.map((item) => [item.kind, item.event_key]).sort(),
    [
      ['billing', 'monthly_challenge'],
      ['progress', 'monthly_challenge'],
    ],
  );
  const progress = plan.requests.find((item) => item.kind === 'progress');
  assert.equal(progress.video_count, 3);
  assert.equal(progress.video_target, 35);
  assert.match(progress.last_checked_at, /^\d{4}-\d{2}-\d{2} /);
});

test('maps agency deadline clearing to a deadline fact', () => {
  const plan = buildOperationalFactRequestsFromLegacyPayload({
    agency_deadline: null,
  });

  assert.deepEqual(plan.handledFields, ['wa_crm_data.agency_deadline']);
  assert.equal(plan.requests.length, 1);
  assert.equal(plan.requests[0].kind, 'deadline');
  assert.equal(plan.requests[0].deadline_key, 'agency_deadline');
  assert.equal(plan.requests[0].deadline_at, null);
  assert.equal(plan.requests[0].status, 'cleared');
});
