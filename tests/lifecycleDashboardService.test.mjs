import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { getLifecycleDashboard } = require('../server/services/lifecycleDashboardService');

function createDbConnWithRows(rows) {
  return {
    prepare() {
      return {
        all: async () => rows,
      };
    },
  };
}

test('getLifecycleDashboard returns empty summary when snapshot table is missing', async () => {
  const dbConn = {
    prepare() {
      return {
        all: async () => {
          throw new Error("Table 'creator_lifecycle_snapshot' doesn't exist");
        },
      };
    },
  };

  const result = await getLifecycleDashboard(dbConn, {});
  assert.equal(result.total, 0);
  assert.equal(result.snapshot_ready, false);
  assert.equal(result.conflict_count, 0);
  assert.deepEqual(result.stage_counts, {});
});

test('getLifecycleDashboard aggregates stage counts, referral and conflicts', async () => {
  const rows = [
    {
      id: 1,
      primary_name: 'Alice',
      wa_owner: 'Beau',
      stage_key: 'revenue',
      stage_label: '收入',
      flags_json: JSON.stringify({ referral_active: true }),
      conflicts_json: JSON.stringify(['gmv_outpaces_stage']),
      entry_reason: 'agency_bound',
      evaluated_at: '2026-04-14 10:00:00',
    },
    {
      id: 2,
      primary_name: 'Bob',
      wa_owner: 'Yiyun',
      stage_key: 'activation',
      stage_label: '激活',
      flags_json: JSON.stringify({ referral_active: false }),
      conflicts_json: JSON.stringify([]),
      entry_reason: 'trial_7day',
      evaluated_at: '2026-04-14 10:01:00',
    },
  ];

  const result = await getLifecycleDashboard(createDbConnWithRows(rows), {});
  assert.equal(result.total, 2);
  assert.equal(result.snapshot_ready, true);
  assert.equal(result.stage_counts.revenue, 1);
  assert.equal(result.stage_counts.activation, 1);
  assert.equal(result.owner_stage_counts.Beau.revenue, 1);
  assert.equal(result.referral_active_count, 1);
  assert.equal(result.conflict_count, 1);
  assert.equal(result.conflicts[0].creator_name, 'Alice');
});
