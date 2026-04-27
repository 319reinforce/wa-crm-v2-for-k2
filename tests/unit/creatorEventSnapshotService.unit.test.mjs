import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { buildCompatFlags } = require('../../server/services/creatorEventSnapshotService');

test('creator event snapshot only owns canonical compatibility flags', () => {
  const flags = buildCompatFlags([]);

  assert.equal(flags.ev_trial_7day, false);
  assert.equal(flags.ev_agency_bound, false);
  assert.equal(Object.prototype.hasOwnProperty.call(flags, 'ev_monthly_invited'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(flags, 'ev_whatsapp_shared'), false);
});

test('creator event snapshot maps canonical events to compatibility flags', () => {
  const flags = buildCompatFlags([
    { event_key: 'trial_7day', status: 'completed' },
    { event_key: 'agency_bound', status: 'active' },
    { event_key: 'gmv_milestone', status: 'completed', meta: JSON.stringify({ threshold: 5000 }) },
  ]);

  assert.equal(flags.ev_trial_7day, true);
  assert.equal(flags.ev_trial_active, false);
  assert.equal(flags.ev_agency_bound, true);
  assert.equal(flags.ev_gmv_2k, true);
  assert.equal(flags.ev_gmv_5k, true);
  assert.equal(flags.ev_gmv_10k, false);
});
