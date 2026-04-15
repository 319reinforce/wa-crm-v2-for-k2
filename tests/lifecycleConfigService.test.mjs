import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  DEFAULT_POLICY_KEY,
  buildDefaultPayload,
  normalizeConfig,
  extractPayloadFromRow,
  toRuntimeOptions,
} = require('../server/services/lifecycleConfigService');

test('buildDefaultPayload returns default lifecycle config payload', () => {
  const payload = buildDefaultPayload();

  assert.equal(payload.policy_key, DEFAULT_POLICY_KEY);
  assert.equal(payload.policy_version, 'v2');
  assert.equal(payload.config.revenue_requires_gmv, true);
  assert.equal(payload.config.revenue_gmv_threshold, 2000);
});

test('normalizeConfig keeps GMV gate on and coerces threshold', () => {
  const config = normalizeConfig({
    revenue_requires_gmv: 0,
    revenue_gmv_threshold: '3500',
  });

  assert.equal(config.revenue_requires_gmv, true);
  assert.equal(config.revenue_gmv_threshold, 3500);
});

test('extractPayloadFromRow falls back to defaults when row missing', () => {
  const payload = extractPayloadFromRow(null);

  assert.equal(payload.policy_key, DEFAULT_POLICY_KEY);
  assert.equal(payload.source, 'default');
  assert.equal(payload.updated_at, null);
  assert.equal(payload.config.revenue_requires_gmv, true);
});

test('extractPayloadFromRow uses db config when policy content is valid', () => {
  const payload = extractPayloadFromRow({
    policy_key: DEFAULT_POLICY_KEY,
    policy_version: 'v3',
    applicable_scenarios: JSON.stringify(['lifecycle_management', 'ops_console']),
    updated_at: '2026-04-13T00:00:00.000Z',
    is_active: 1,
    policy_content: JSON.stringify({
      config: {
        revenue_requires_gmv: false,
        revenue_gmv_threshold: 5000,
      },
    }),
  });

  assert.equal(payload.source, 'db');
  assert.equal(payload.policy_version, 'v3');
  assert.deepEqual(payload.applicable_scenarios, ['lifecycle_management', 'ops_console']);
  assert.equal(payload.config.revenue_requires_gmv, true);
  assert.equal(payload.config.revenue_gmv_threshold, 5000);
  assert.equal(payload.updated_at, '2026-04-13T00:00:00.000Z');
});

test('extractPayloadFromRow falls back to defaults when policy content is malformed', () => {
  const payload = extractPayloadFromRow({
    policy_key: DEFAULT_POLICY_KEY,
    policy_version: 'v2',
    applicable_scenarios: 'not-json',
    policy_content: '{bad json',
  });

  assert.equal(payload.source, 'db');
  assert.equal(payload.policy_version, 'v2');
  assert.equal(payload.config.revenue_requires_gmv, true);
  assert.equal(payload.config.revenue_gmv_threshold, 2000);
});

test('toRuntimeOptions returns fixed GMV runtime rule', () => {
  const runtime = toRuntimeOptions({ revenue_requires_gmv: false, revenue_gmv_threshold: 4200 });
  assert.equal(runtime.revenueRequiresGmv, true);
  assert.equal(runtime.revenueGmvThreshold, 4200);
});
