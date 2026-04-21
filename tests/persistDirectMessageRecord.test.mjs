import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { persistDirectMessageRecord } = require('../server/services/directMessagePersistenceService');

// 极简 mock dbConn:记录每次 prepare 的 sql + .run 参数,.run 返回 { changes:1 } 模拟 INSERT 成功;
// SELECT 语句返回空列表(覆盖 short-window 与 group-conflict filter 的查询路径)。
function makeMockDb({ insertChanges = 1 } = {}) {
  const calls = [];
  const prepare = (sql) => ({
    async run(...params) {
      calls.push({ type: 'run', sql, params });
      if (/^INSERT\b/i.test(sql)) {
        return { changes: insertChanges, lastInsertRowid: 100 };
      }
      return { changes: 0 };
    },
    async all(...params) {
      calls.push({ type: 'all', sql, params });
      // filterShortWindowDuplicates / filterDirectMessagesAgainstGroups 的 SELECT 都返回空行
      return [];
    },
    async get(...params) {
      calls.push({ type: 'get', sql, params });
      return null;
    },
  });
  return { prepare, calls };
}

test('persistDirectMessageRecord: role=user 不触发 short-window guard', async () => {
  const db = makeMockDb();
  const res = await persistDirectMessageRecord({
    dbConn: db,
    creatorId: 1,
    role: 'user',
    operator: 'Beau',
    text: 'Hello world, this is a longer text for the guard window',
    timestamp: 1776696900000,
    groupConflictGuard: false,
  });
  assert.equal(res.persisted, true, 'role=user should persist');
  assert.equal(res.blocked, false);
  const sqls = db.calls.map((c) => c.sql).join('\n');
  // filterShortWindowDuplicates 对应 SELECT wa_messages WHERE ... timestamp BETWEEN ... 的查询
  // role=user 不应触发,所以 SELECT 不应出现跟 short-window 相关的 pattern
  const hasShortWindowSelect = /wa_messages[\s\S]*timestamp[\s\S]*BETWEEN|timestamp[\s\S]*>=[\s\S]*timestamp[\s\S]*<=/i.test(sqls);
  assert.equal(hasShortWindowSelect, false, 'short-window query should not fire for role=user');
});

test('persistDirectMessageRecord: role=me 不触发 short-window guard', async () => {
  const db = makeMockDb();
  const res = await persistDirectMessageRecord({
    dbConn: db,
    creatorId: 1,
    role: 'me',
    operator: 'Beau',
    text: 'Reply from operator: here is a long enough text',
    timestamp: 1776696900000,
    groupConflictGuard: false,
  });
  assert.equal(res.persisted, true);
  assert.equal(res.blocked, false);
});

test('persistDirectMessageRecord: role=assistant 仍触发 short-window guard (SELECT 发生)', async () => {
  const db = makeMockDb();
  await persistDirectMessageRecord({
    dbConn: db,
    creatorId: 1,
    role: 'assistant',
    operator: 'Beau',
    text: 'AI generated reply, long enough text content',
    timestamp: 1776696900000,
    groupConflictGuard: false,
  });
  const hasAnySelect = db.calls.some((c) => c.type === 'all' && /SELECT/i.test(c.sql));
  assert.equal(hasAnySelect, true, 'assistant 应走 short-window SELECT 查询');
});

test('persistDirectMessageRecord: INSERT 语句带 wa_message_id 列', async () => {
  const db = makeMockDb();
  await persistDirectMessageRecord({
    dbConn: db,
    creatorId: 1,
    role: 'me',
    operator: 'Beau',
    text: 'Hi from operator',
    timestamp: 1776696900000,
    waMessageId: 'true_12345@c.us_ABCDEF',
    groupConflictGuard: false,
  });
  const insertCall = db.calls.find((c) => /^INSERT\b/i.test(c.sql));
  assert.ok(insertCall, 'INSERT should be called');
  assert.match(insertCall.sql, /wa_message_id/, 'INSERT 语句应包含 wa_message_id 列');
  assert.equal(insertCall.params.length, 7, '7 个参数: creator_id, role, operator, text, timestamp, message_hash, wa_message_id');
  assert.equal(insertCall.params[6], 'true_12345@c.us_ABCDEF', '最后一个参数应为 wa_message_id');
});

test('persistDirectMessageRecord: waMessageId 为空字符串或 null 时入库为 null', async () => {
  const db = makeMockDb();
  await persistDirectMessageRecord({
    dbConn: db,
    creatorId: 1,
    role: 'me',
    operator: 'Beau',
    text: 'Hi',
    waMessageId: '   ',
    groupConflictGuard: false,
  });
  const insertCall = db.calls.find((c) => /^INSERT\b/i.test(c.sql));
  assert.equal(insertCall.params[6], null);
});

test('persistDirectMessageRecord: 返回值包含 wa_message_id 字段', async () => {
  const db = makeMockDb();
  const res = await persistDirectMessageRecord({
    dbConn: db,
    creatorId: 1,
    role: 'me',
    operator: 'Beau',
    text: 'Hi',
    waMessageId: 'id_value',
    groupConflictGuard: false,
  });
  assert.equal(res.wa_message_id, 'id_value');
});

test('persistDirectMessageRecord: duplicate 时返回 persisted=false, duplicate=true', async () => {
  const db = makeMockDb({ insertChanges: 0 });
  const res = await persistDirectMessageRecord({
    dbConn: db,
    creatorId: 1,
    role: 'me',
    operator: 'Beau',
    text: 'Hi',
    waMessageId: 'id_value',
    groupConflictGuard: false,
  });
  assert.equal(res.persisted, false);
  assert.equal(res.duplicate, true);
  assert.equal(res.blocked, false);
  assert.equal(res.reason, 'duplicate');
});

test('persistDirectMessageRecord: 必填参数缺失抛错', async () => {
  const db = makeMockDb();
  await assert.rejects(
    persistDirectMessageRecord({ dbConn: db, creatorId: null, role: 'me', text: 'x' }),
    /creatorId, role, and text are required/
  );
  await assert.rejects(
    persistDirectMessageRecord({ dbConn: db, creatorId: 1, role: '', text: 'x' }),
    /creatorId, role, and text are required/
  );
  await assert.rejects(
    persistDirectMessageRecord({ creatorId: 1, role: 'me', text: 'x' }),
    /dbConn is required/
  );
});
