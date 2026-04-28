/**
 * @fileoverview jidUtils unit tests.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { normalizeJid, isGroupJid, jidToPhoneE164, bareJid } = require('../driver/jidUtils.js');

test('jidUtils — normalizeJid', () => {
  assert.equal(normalizeJid('+85255550001', 'baileys'), '85255550001@s.whatsapp.net');
  assert.equal(normalizeJid('+12025550001', 'baileys'), '12025550001@s.whatsapp.net');
  assert.equal(normalizeJid('+85255550001', 'wwebjs'), '85255550001@c.us');
  assert.equal(normalizeJid('85255550001', 'baileys'), '85255550001@s.whatsapp.net');
  assert.equal(normalizeJid('(410) 801-0355', 'baileys'), '14108010355@s.whatsapp.net');
  assert.equal(normalizeJid('+86 138 0000 0001', 'baileys'), '8613800000001@s.whatsapp.net');
  assert.ok(normalizeJid('+85255550001').endsWith('@s.whatsapp.net'));
});

test('jidUtils — isGroupJid', () => {
  assert.ok(isGroupJid('123456789-987654321@g.us'));
  assert.ok(!isGroupJid('85255550001@s.whatsapp.net'));
  assert.ok(!isGroupJid('85255550001@c.us'));
  assert.ok(!isGroupJid(null));
  assert.ok(!isGroupJid(''));
  assert.ok(!isGroupJid(undefined));
});

test('jidUtils — jidToPhoneE164', () => {
  assert.equal(jidToPhoneE164('85255550001@s.whatsapp.net'), '+85255550001');
  assert.equal(jidToPhoneE164('85255550001@c.us'), '+85255550001');
  assert.equal(jidToPhoneE164('123456789-987654321@g.us'), '+123456789-987654321');
  assert.equal(jidToPhoneE164('85255550001@s.whatsapp.net:123456'), '+85255550001');
  assert.equal(jidToPhoneE164(''), '');
  assert.equal(jidToPhoneE164(null), '');
});

test('jidUtils — bareJid', () => {
  assert.equal(bareJid('85255550001@s.whatsapp.net:ABC123'), '85255550001@s.whatsapp.net');
  assert.equal(bareJid('85255550001@s.whatsapp.net'), '85255550001@s.whatsapp.net');
});
