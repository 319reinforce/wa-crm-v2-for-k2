/**
 * driverSwitchCommands 命令仓库状态机单测。
 *
 * 验证:
 * - 新建默认 pending / progress='queued'
 * - get 返回拷贝不是引用（不可变）
 * - update 推进 pending → running → completed（startedAt/finishedAt 自动填）
 * - 终态不可再覆盖
 * - 未知 id 的 get / update 返回 null
 * - TTL 到期的终态命令被下次 create 顺手清掉
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { DriverSwitchCommandStore } = require('../../server/services/driverSwitchCommands');

test('create: pending / progress=queued / createdAt 现在', () => {
    const store = new DriverSwitchCommandStore();
    const rec = store.create({ sessionId: 'beau', fromDriver: 'wwebjs', toDriver: 'baileys' });
    assert.equal(rec.status, 'pending');
    assert.equal(rec.progress, 'queued');
    assert.equal(rec.sessionId, 'beau');
    assert.equal(rec.fromDriver, 'wwebjs');
    assert.equal(rec.toDriver, 'baileys');
    assert.equal(rec.type, 'change_driver');
    assert.equal(rec.startedAt, null);
    assert.equal(rec.finishedAt, null);
    assert.ok(rec.id && typeof rec.id === 'string');
    assert.ok(Math.abs(rec.createdAt - Date.now()) < 1000);
});

test('get: 返回拷贝, 外部修改不影响内部', () => {
    const store = new DriverSwitchCommandStore();
    const rec = store.create({ sessionId: 'x' });
    const got = store.get(rec.id);
    got.status = 'hacked';
    const fresh = store.get(rec.id);
    assert.equal(fresh.status, 'pending');
});

test('update: pending → running 填 startedAt', () => {
    const store = new DriverSwitchCommandStore();
    const rec = store.create({ sessionId: 'x' });
    const after = store.update(rec.id, { status: 'running', progress: 'updating_db' });
    assert.equal(after.status, 'running');
    assert.equal(after.progress, 'updating_db');
    assert.ok(after.startedAt >= rec.createdAt);
    assert.equal(after.finishedAt, null);
});

test('update: running → completed 填 finishedAt', () => {
    const store = new DriverSwitchCommandStore();
    const rec = store.create({ sessionId: 'x' });
    store.update(rec.id, { status: 'running' });
    const done = store.update(rec.id, { status: 'completed', result: { driver: 'baileys' } });
    assert.equal(done.status, 'completed');
    assert.ok(done.finishedAt && done.finishedAt >= done.startedAt);
    assert.deepEqual(done.result, { driver: 'baileys' });
});

test('update: 终态不可再覆盖（幂等）', () => {
    const store = new DriverSwitchCommandStore();
    const rec = store.create({ sessionId: 'x' });
    store.update(rec.id, { status: 'completed', result: { ok: true } });
    const after = store.update(rec.id, { status: 'pending', error: 'roll back' });
    assert.equal(after.status, 'completed');
    assert.equal(after.error, null);
});

test('update: 终态 timeout / failed 各自独立工作', () => {
    const store = new DriverSwitchCommandStore();
    const a = store.create({ sessionId: 'a' });
    const b = store.create({ sessionId: 'b' });
    store.update(a.id, { status: 'timeout', error: '30s polling exceeded' });
    store.update(b.id, { status: 'failed', error: 'db write failed' });
    assert.equal(store.get(a.id).status, 'timeout');
    assert.equal(store.get(b.id).status, 'failed');
});

test('get / update 未知 id 返回 null', () => {
    const store = new DriverSwitchCommandStore();
    assert.equal(store.get('00000000-0000-0000-0000-000000000000'), null);
    assert.equal(store.update('00000000-0000-0000-0000-000000000000', { status: 'running' }), null);
});

test('TTL: 过期的终态命令会在下次 create 时被清掉', () => {
    const store = new DriverSwitchCommandStore({ ttlMs: 100 });
    const old = store.create({ sessionId: 'old' });
    store.update(old.id, { status: 'completed' });
    // 伪造 finishedAt 让它"过期"
    store._cmds.get(old.id).finishedAt = Date.now() - 1000;
    store.create({ sessionId: 'new' });
    assert.equal(store.get(old.id), null);
});

test('listBySession: 按 createdAt desc 返回', async () => {
    const store = new DriverSwitchCommandStore();
    const a = store.create({ sessionId: 'beau', toDriver: 'baileys' });
    await new Promise((r) => setTimeout(r, 5));
    const b = store.create({ sessionId: 'beau', toDriver: 'wwebjs' });
    await new Promise((r) => setTimeout(r, 5));
    const c = store.create({ sessionId: 'yiyun', toDriver: 'baileys' });
    const beauList = store.listBySession('beau');
    assert.equal(beauList.length, 2);
    assert.equal(beauList[0].id, b.id);
    assert.equal(beauList[1].id, a.id);
});
