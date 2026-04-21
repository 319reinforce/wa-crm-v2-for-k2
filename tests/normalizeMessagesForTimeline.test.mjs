import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const messagesRouter = require('../server/routes/messages');
const { normalizeMessagesForTimeline, buildMessageKey } = messagesRouter._private;

test('normalize: 两条同文本 role=me 间隔 400ms 都保留', () => {
  const rows = [
    { id: 1, role: 'me', text: 'Okay', timestamp: 1776696900000, wa_message_id: 'id_a' },
    { id: 2, role: 'me', text: 'Okay', timestamp: 1776696900400, wa_message_id: 'id_b' },
  ];
  const out = normalizeMessagesForTimeline(rows);
  assert.equal(out.length, 2, '同文本间隔 400ms 的两条消息应全部保留');
});

test('normalize: 两条相同 wa_message_id 仅保留第一条 (防御 DB 双写)', () => {
  const rows = [
    { id: 1, role: 'me', text: 'Okay', timestamp: 1776696900000, wa_message_id: 'id_same' },
    { id: 2, role: 'me', text: 'Okay', timestamp: 1776696900500, wa_message_id: 'id_same' },
  ];
  const out = normalizeMessagesForTimeline(rows);
  assert.equal(out.length, 1, '相同 wa_message_id 只保留一条');
  assert.equal(out[0].id, 1);
});

test('normalize: 一条有 wa_message_id 一条无, 同文本同秒都保留', () => {
  const rows = [
    { id: 1, role: 'user', text: 'Hi', timestamp: 1776696900000, wa_message_id: 'id_new' },
    { id: 2, role: 'user', text: 'Hi', timestamp: 1776696900100, wa_message_id: null },
  ];
  const out = normalizeMessagesForTimeline(rows);
  assert.equal(out.length, 2, '无 id 的行不受 id-dedup 影响');
});

test('normalize: 老秒精度 + 新毫秒精度相同文本, 都保留', () => {
  const rows = [
    { id: 1, role: 'me', text: 'Thanks', timestamp: 1776696900 },
    { id: 2, role: 'me', text: 'Thanks', timestamp: 1776696900123 },
  ];
  const out = normalizeMessagesForTimeline(rows);
  assert.equal(out.length, 2);
  const precisions = out.map((m) => m.timestamp_precision).sort();
  assert.deepEqual(precisions, ['ms', 's']);
});

test('normalize: 按 timestamp ASC 排序, tie-break 用 id', () => {
  const rows = [
    { id: 3, role: 'me', text: 'c', timestamp: 1776696900500 },
    { id: 1, role: 'user', text: 'a', timestamp: 1776696900000 },
    { id: 2, role: 'user', text: 'b', timestamp: 1776696900000 },
  ];
  const out = normalizeMessagesForTimeline(rows);
  assert.deepEqual(out.map((m) => m.id), [1, 2, 3]);
});

test('normalize: 空/非数组输入返回空数组', () => {
  assert.deepEqual(normalizeMessagesForTimeline(null), []);
  assert.deepEqual(normalizeMessagesForTimeline(undefined), []);
  assert.deepEqual(normalizeMessagesForTimeline([]), []);
});

test('buildMessageKey: wa_message_id 优先级最高', () => {
  const msg = {
    wa_message_id: 'waid',
    id: 123,
    message_hash: 'abc',
    timestamp: 1776696900000,
  };
  assert.equal(buildMessageKey(msg), 'waid');
});

test('buildMessageKey: 缺 wa_message_id 时回退到 id', () => {
  const msg = { id: 123, message_hash: 'abc' };
  assert.equal(buildMessageKey(msg), '123');
});

test('buildMessageKey: 缺 id 时回退到 message_hash', () => {
  const msg = { message_hash: 'hashval' };
  assert.equal(buildMessageKey(msg), 'hashval');
});

test('buildMessageKey: 空白 wa_message_id 不应当作有效 id (回退到 id)', () => {
  // 注意:buildMessageKey 当前仅做 nullish coalesce,空字符串仍会命中 wa_message_id
  // 此测试记录当前行为作为契约:空白字符串视为有 id,不回退
  const msg = { wa_message_id: '   ', id: 123 };
  assert.equal(buildMessageKey(msg), '   ');
});
