import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

// 本测试用 mock dbConn 验证 migration 脚本的幂等分支:
// - column 不存在 → 执行 ALTER ADD COLUMN
// - column 存在 → 跳过 ADD COLUMN
// - index 不存在 → 执行 ADD UNIQUE KEY
// - index 存在 → 跳过
// 真实 MySQL 连接下的端到端校验由用户本地 start-up 时的 [Startup] wa_message_id migration done 日志覆盖。

// 动态 require 需要 mock 全局 db 模块。先清缓存,然后替换 require 缓存中的 db.js。
function resetDbMock(mockGetDb) {
  const dbPath = require.resolve('../db');
  require.cache[dbPath] = {
    id: dbPath,
    filename: dbPath,
    loaded: true,
    exports: { getDb: () => mockGetDb },
  };
  const migratePath = require.resolve('../migrate-wa-message-id');
  delete require.cache[migratePath];
  return require('../migrate-wa-message-id');
}

function buildMockDbConn(state) {
  // state: { hasColumn: bool, hasIndex: bool }
  // 记录所有 prepare().run() 或 prepare().all() 调用
  const runs = [];
  const prepare = (sql) => ({
    async all(...params) {
      runs.push({ type: 'all', sql, params });
      if (/information_schema\.COLUMNS/i.test(sql)) {
        return state.hasColumn ? [{ COLUMN_NAME: 'wa_message_id' }] : [];
      }
      if (/information_schema\.STATISTICS/i.test(sql)) {
        return state.hasIndex ? [{ INDEX_NAME: 'uk_wa_message_id' }] : [];
      }
      return [];
    },
    async run(...params) {
      runs.push({ type: 'run', sql, params });
      if (/^ALTER TABLE/i.test(sql) && /ADD COLUMN/i.test(sql)) {
        state.hasColumn = true;
      }
      if (/^ALTER TABLE/i.test(sql) && /ADD UNIQUE KEY/i.test(sql)) {
        state.hasIndex = true;
      }
      return { changes: 1 };
    },
  });
  return { prepare, runs };
}

test('migrate: 首次运行时创建 column 与 unique index', async () => {
  const state = { hasColumn: false, hasIndex: false };
  const dbConn = buildMockDbConn(state);
  const migrate = resetDbMock(dbConn);
  await migrate.run({ silent: true });
  assert.equal(state.hasColumn, true, 'column 应已创建');
  assert.equal(state.hasIndex, true, 'index 应已创建');
  const runStmts = dbConn.runs.filter((r) => r.type === 'run').map((r) => r.sql);
  assert.ok(runStmts.some((sql) => /ADD COLUMN wa_message_id/.test(sql)), '应执行 ADD COLUMN');
  assert.ok(runStmts.some((sql) => /ADD UNIQUE KEY uk_wa_message_id/.test(sql)), '应执行 ADD UNIQUE KEY');
});

test('migrate: column 与 index 都已存在时不执行任何 ALTER', async () => {
  const state = { hasColumn: true, hasIndex: true };
  const dbConn = buildMockDbConn(state);
  const migrate = resetDbMock(dbConn);
  await migrate.run({ silent: true });
  const alters = dbConn.runs.filter((r) => r.type === 'run');
  assert.equal(alters.length, 0, '已存在时不应执行 ALTER');
});

test('migrate: 仅 column 已存在时只补 index', async () => {
  const state = { hasColumn: true, hasIndex: false };
  const dbConn = buildMockDbConn(state);
  const migrate = resetDbMock(dbConn);
  await migrate.run({ silent: true });
  assert.equal(state.hasIndex, true);
  const alters = dbConn.runs.filter((r) => r.type === 'run').map((r) => r.sql);
  assert.equal(alters.length, 1);
  assert.match(alters[0], /ADD UNIQUE KEY/);
});

test('migrate: 两次跑完全幂等', async () => {
  const state = { hasColumn: false, hasIndex: false };
  const dbConn = buildMockDbConn(state);
  const migrate = resetDbMock(dbConn);
  await migrate.run({ silent: true });
  const firstRunCount = dbConn.runs.filter((r) => r.type === 'run').length;
  await migrate.run({ silent: true });
  const secondRunCount = dbConn.runs.filter((r) => r.type === 'run').length;
  assert.equal(secondRunCount, firstRunCount, '第二次跑不应触发新的 ALTER');
});
