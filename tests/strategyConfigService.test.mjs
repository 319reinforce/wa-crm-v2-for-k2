import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  DEFAULT_POLICY_KEY,
  buildDefaultPayload,
  normalizeStrategies,
  extractPayloadFromRow,
} = require('../server/services/strategyConfigService');

test('buildDefaultPayload returns configured default policy with two strategies', () => {
  const payload = buildDefaultPayload();
  assert.equal(payload.policy_key, DEFAULT_POLICY_KEY);
  assert.equal(payload.is_active, 1);
  assert.ok(Array.isArray(payload.applicable_scenarios));
  assert.equal(payload.strategies.length >= 2, true);
  assert.equal(payload.strategies[0].id, 'secondary_reach');
  assert.equal(payload.strategies[1].id, 'recall_pending');
});

test('normalizeStrategies supports camelCase and filters invalid rows', () => {
  const normalized = normalizeStrategies([
    {
      id: 'demo',
      name: '示例',
      memoryKey: 'strategy_demo',
      nameEn: 'Demo',
      shortDesc: 'short',
      aliases: ['示例'],
      priority: '7',
    },
    {
      id: '',
      name: 'bad',
      memoryKey: 'bad',
    },
  ]);

  assert.equal(normalized.length, 1);
  assert.equal(normalized[0].id, 'demo');
  assert.equal(normalized[0].memory_key, 'strategy_demo');
  assert.equal(normalized[0].name_en, 'Demo');
  assert.equal(normalized[0].priority, 7);
});

test('extractPayloadFromRow falls back to defaults when row missing', () => {
  const payload = extractPayloadFromRow(null);
  assert.equal(payload.policy_key, DEFAULT_POLICY_KEY);
  assert.equal(payload.source, 'default');
  assert.equal(payload.updated_at, null);
  assert.equal(payload.strategies.length > 0, true);
});

test('extractPayloadFromRow uses db strategies when policy_content valid', () => {
  const payload = extractPayloadFromRow({
    policy_key: DEFAULT_POLICY_KEY,
    policy_version: 'v99',
    applicable_scenarios: JSON.stringify(['mcn_binding']),
    updated_at: '2026-04-13T00:00:00.000Z',
    policy_content: JSON.stringify({
      strategies: [{
        id: 'custom_1',
        name: '自定义策略',
        memory_key: 'custom_memory_key',
        short_desc: 'db-desc',
      }],
    }),
  });

  assert.equal(payload.source, 'db');
  assert.equal(payload.policy_version, 'v99');
  assert.equal(payload.is_active, 1);
  assert.deepEqual(payload.applicable_scenarios, ['mcn_binding']);
  assert.equal(payload.strategies.length, 1);
  assert.equal(payload.strategies[0].id, 'custom_1');
  assert.equal(payload.updated_at, '2026-04-13T00:00:00.000Z');
});

test('extractPayloadFromRow falls back to defaults when db policy_content malformed', () => {
  const payload = extractPayloadFromRow({
    policy_key: DEFAULT_POLICY_KEY,
    policy_version: 'v2',
    applicable_scenarios: 'not-json',
    policy_content: '{bad json',
  });

  assert.equal(payload.source, 'default');
  assert.equal(payload.policy_version, 'v2');
  assert.equal(payload.is_active, 1);
  assert.equal(payload.strategies.length > 0, true);
});
