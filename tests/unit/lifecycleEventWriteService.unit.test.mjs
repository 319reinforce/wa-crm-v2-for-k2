import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  buildLifecycleEventRequestsFromLegacyPayload,
} = require('../../server/services/lifecycleEventWriteService');

test('maps truthy legacy lifecycle flags to canonical event requests', () => {
  const plan = buildLifecycleEventRequestsFromLegacyPayload({
    agency_bound: 1,
    ev_trial_active: true,
    ev_gmv_5k: true,
    ev_gmv_10k: false,
  });

  assert.deepEqual(plan.unmappedFields, []);
  assert.ok(plan.ignoredFields.includes('joinbrands_link.ev_gmv_10k'));
  assert.deepEqual(
    plan.eventRequests.map((item) => [item.event_key, item.status]).sort(),
    [
      ['agency_bound', 'active'],
      ['gmv_milestone', 'completed'],
      ['trial_7day', 'active'],
    ],
  );
  const gmv = plan.eventRequests.find((item) => item.event_key === 'gmv_milestone');
  assert.equal(gmv.meta.threshold, 5000);
});

test('keeps neutral form defaults as ignored no-ops', () => {
  const plan = buildLifecycleEventRequestsFromLegacyPayload({
    beta_status: 'not_introduced',
    monthly_fee_status: 'pending',
    monthly_fee_amount: 0,
    video_count: 0,
    video_target: 35,
    agency_bound: 0,
    ev_trial_active: false,
    ev_monthly_started: false,
    ev_agency_bound: false,
    ev_churned: false,
  });

  assert.deepEqual(plan.eventRequests, []);
  assert.deepEqual(plan.unmappedFields, []);
  assert.ok(plan.ignoredFields.includes('wa_crm_data.video_target'));
  assert.ok(plan.ignoredFields.includes('joinbrands_link.ev_churned'));
});

test('blocks non-canonical legacy lifecycle values instead of silently writing old tables', () => {
  const plan = buildLifecycleEventRequestsFromLegacyPayload({
    beta_status: 'introduced',
    monthly_fee_amount: 20,
    video_count: 3,
    ev_whatsapp_shared: true,
  });

  assert.deepEqual(plan.eventRequests, []);
  assert.deepEqual(plan.unmappedFields.sort(), [
    'joinbrands_link.ev_whatsapp_shared',
    'wa_crm_data.beta_status',
    'wa_crm_data.monthly_fee_amount',
    'wa_crm_data.video_count',
  ]);
});

test('maps terminal and monthly payment statuses to canonical facts', () => {
  const plan = buildLifecycleEventRequestsFromLegacyPayload({
    beta_status: 'churned',
    monthly_fee_status: 'paid',
    monthly_fee_deducted: 1,
  });

  assert.deepEqual(
    plan.eventRequests.map((item) => [item.event_key, item.status]).sort(),
    [
      ['churned', 'active'],
      ['monthly_challenge', 'completed'],
    ],
  );
  assert.deepEqual(plan.unmappedFields, []);
});
