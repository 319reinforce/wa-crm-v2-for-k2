import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  _private,
} = require('../../server/services/dataRetentionService');

test('retention target exposes rollup and purge capability for ai usage logs', () => {
  const target = _private.resolveTarget({
    policy_key: 'ai_usage_logs_180d',
    table_name: 'ai_usage_logs',
    date_column: 'created_at',
  });

  assert.equal(target.rollup, 'ai_usage_daily');
  assert.equal(target.hardDeleteAllowed, true);
  assert.equal(target.action, 'archive_mark');
});

test('retention target keeps wa message purge unsupported even with a window', () => {
  const target = _private.resolveTarget({
    policy_key: 'wa_messages_365d',
    table_name: 'wa_messages',
    date_column: 'created_at',
  });

  assert.equal(target.rollup, 'wa_messages_monthly');
  assert.equal(target.hardDeleteAllowed, false);
});

test('retention identifier validation rejects unsupported table names', () => {
  assert.throws(() => _private.resolveTarget({
    policy_key: 'bad',
    table_name: 'wa_messages;DROP',
    date_column: 'created_at',
  }), /Unsafe table name/);
});
