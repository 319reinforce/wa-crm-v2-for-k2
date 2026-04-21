import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { extractWaMessageId } = require('../server/utils/waMessageId');

test('extractWaMessageId: returns null for null / undefined / non-object', () => {
  assert.equal(extractWaMessageId(null), null);
  assert.equal(extractWaMessageId(undefined), null);
  assert.equal(extractWaMessageId('x'), null);
  assert.equal(extractWaMessageId(123), null);
});

test('extractWaMessageId: returns null when no id-like fields present', () => {
  assert.equal(extractWaMessageId({}), null);
  assert.equal(extractWaMessageId({ body: 'hi' }), null);
});

test('extractWaMessageId: picks from id._serialized (whatsapp-web.js 常见形态)', () => {
  const msg = { id: { _serialized: 'true_12345@c.us_ABCDEF' } };
  assert.equal(extractWaMessageId(msg), 'true_12345@c.us_ABCDEF');
});

test('extractWaMessageId: picks from _data.id._serialized (嵌套形态)', () => {
  const msg = { _data: { id: { _serialized: 'false_678@c.us_XYZ' } } };
  assert.equal(extractWaMessageId(msg), 'false_678@c.us_XYZ');
});

test('extractWaMessageId: picks from rawData.id._serialized', () => {
  const msg = { rawData: { id: { _serialized: 'raw_id_value' } } };
  assert.equal(extractWaMessageId(msg), 'raw_id_value');
});

test('extractWaMessageId: accepts string-form msg.id (部分事件路径)', () => {
  const msg = { id: 'true_12345@c.us_SIMPLE' };
  assert.equal(extractWaMessageId(msg), 'true_12345@c.us_SIMPLE');
});

test('extractWaMessageId: trims whitespace and respects max length', () => {
  const msg = { id: { _serialized: '  abc123  ' } };
  assert.equal(extractWaMessageId(msg), 'abc123');

  const tooLong = 'x'.repeat(200);
  assert.equal(extractWaMessageId({ id: { _serialized: tooLong } }), null);
});

test('extractWaMessageId: 优先级 id > _data.id > rawData.id', () => {
  const msg = {
    id: { _serialized: 'primary' },
    _data: { id: { _serialized: 'secondary' } },
    rawData: { id: { _serialized: 'tertiary' } },
  };
  assert.equal(extractWaMessageId(msg), 'primary');
});

test('extractWaMessageId: 跳过 empty / invalid id, 回退到下一个', () => {
  const msg = {
    id: { _serialized: '' },
    _data: { id: { _serialized: 'fallback' } },
  };
  assert.equal(extractWaMessageId(msg), 'fallback');
});
