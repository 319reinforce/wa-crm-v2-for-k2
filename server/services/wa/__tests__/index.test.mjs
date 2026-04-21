/**
 * @fileoverview wa/index.js factory tests.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createDriver, resolveSessionConfigFromRow } = require('../index.js');

test('createDriver — selects wwebjsDriver', async () => {
  const d = await createDriver({ sessionId: 't', owner: 't', driver: 'wwebjs', authRootDir: '/tmp' });
  assert.ok(d);
});

test('createDriver — selects baileysDriver', async () => {
  const d = await createDriver({ sessionId: 't', owner: 't', driver: 'baileys', authRootDir: '/tmp' });
  assert.ok(d);
});

test('createDriver — falls back to wwebjs when driver unset', async () => {
  const orig = process.env.WA_DEFAULT_DRIVER;
  delete process.env.WA_DEFAULT_DRIVER;
  try {
    const d = await createDriver({ sessionId: 't', owner: 't', authRootDir: '/tmp' });
    assert.ok(d);
  } finally {
    if (orig !== undefined) process.env.WA_DEFAULT_DRIVER = orig;
  }
});

test('createDriver — throws on unknown driver', async () => {
  await assert.rejects(
    createDriver({ sessionId: 't', owner: 't', driver: 'puppeteer', authRootDir: '/tmp' }),
    /unknown driver/
  );
});

test('resolveSessionConfigFromRow — wwebjs session', () => {
  const row = { session_id: 'beau', owner: 'owner1', driver: 'wwebjs', driver_meta: null };
  const cfg = resolveSessionConfigFromRow(row);
  assert.equal(cfg.sessionId, 'beau');
  assert.equal(cfg.owner, 'owner1');
  assert.equal(cfg.driver, 'wwebjs');
  assert.ok(cfg.authRootDir.includes('.wwebjs_auth'));
});

test('resolveSessionConfigFromRow — baileys session', () => {
  const row = { session_id: 'test', owner: 'owner1', driver: 'baileys', driver_meta: { v: 1 } };
  const cfg = resolveSessionConfigFromRow(row);
  assert.equal(cfg.driver, 'baileys');
  assert.ok(cfg.authRootDir.includes('.baileys_auth'));
  assert.deepEqual(cfg.driverMeta, { v: 1 });
});

test('resolveSessionConfigFromRow — defaults to wwebjs when null', () => {
  const cfg = resolveSessionConfigFromRow({ session_id: 's1', owner: 'o1', driver: null, driver_meta: null });
  assert.equal(cfg.driver, 'wwebjs');
});

test('resolveSessionConfigFromRow — WA_DEFAULT_DRIVER env fallback', () => {
  const orig = process.env.WA_DEFAULT_DRIVER;
  process.env.WA_DEFAULT_DRIVER = 'baileys';
  try {
    const cfg = resolveSessionConfigFromRow({ session_id: 's1', owner: 'o1', driver: null, driver_meta: null });
    assert.equal(cfg.driver, 'baileys');
  } finally {
    if (orig !== undefined) process.env.WA_DEFAULT_DRIVER = orig;
    else delete process.env.WA_DEFAULT_DRIVER;
  }
});

test('resolveSessionConfigFromRow — custom WA_BAILEYS_AUTH_ROOT', () => {
  const orig = process.env.WA_BAILEYS_AUTH_ROOT;
  process.env.WA_BAILEYS_AUTH_ROOT = '/custom/baileys';
  try {
    const cfg = resolveSessionConfigFromRow({ session_id: 's1', owner: 'o1', driver: 'baileys', driver_meta: null });
    assert.equal(cfg.authRootDir, '/custom/baileys');
  } finally {
    if (orig !== undefined) process.env.WA_BAILEYS_AUTH_ROOT = orig;
    else delete process.env.WA_BAILEYS_AUTH_ROOT;
  }
});