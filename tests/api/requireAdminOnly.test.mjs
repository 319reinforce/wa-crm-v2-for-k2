/**
 * requireAdminOnly middleware — Phase 1a gate for destructive admin endpoints.
 *
 * 合同（来自 docs/PHASE_1A_HANDOFF.md §1.2）:
 * - 必须挂在 requireAppAuth 之后，依赖 req.auth 已被填充
 * - req.auth.role === 'admin' 放行
 * - 其它 role / 缺失 auth / null auth 一律 403
 * - 不崩溃（无论 req.auth 的形状）
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { requireAdminOnly } = require('../../server/middleware/appAuth');

function createRes() {
  const res = {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
  return res;
}

function mkNext() {
  let called = 0;
  const fn = () => { called += 1; };
  fn.callCount = () => called;
  return fn;
}

test('admin role: 放行 next()，不写 status/body', () => {
  const req = { auth: { role: 'admin', token: 'x', owner: null } };
  const res = createRes();
  const next = mkNext();
  requireAdminOnly(req, res, next);
  assert.equal(next.callCount(), 1);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body, null);
});

test('owner role: 403 + error 提示 admin', () => {
  const req = { auth: { role: 'owner', owner: 'Beau' } };
  const res = createRes();
  const next = mkNext();
  requireAdminOnly(req, res, next);
  assert.equal(next.callCount(), 0);
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.ok, false);
  assert.match(res.body.error, /admin/i);
});

test('service role: 403（HIGH-1 修复核心：service token 不能调销毁性端点）', () => {
  const req = { auth: { role: 'service', source: 'env' } };
  const res = createRes();
  const next = mkNext();
  requireAdminOnly(req, res, next);
  assert.equal(next.callCount(), 0);
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.ok, false);
});

test('未经 requireAppAuth：req.auth === undefined，403 不崩', () => {
  const req = {};
  const res = createRes();
  const next = mkNext();
  assert.doesNotThrow(() => requireAdminOnly(req, res, next));
  assert.equal(next.callCount(), 0);
  assert.equal(res.statusCode, 403);
});

test('req.auth === null：403 不崩', () => {
  const req = { auth: null };
  const res = createRes();
  const next = mkNext();
  assert.doesNotThrow(() => requireAdminOnly(req, res, next));
  assert.equal(next.callCount(), 0);
  assert.equal(res.statusCode, 403);
});

test('未知 role：403', () => {
  const req = { auth: { role: 'something_else' } };
  const res = createRes();
  const next = mkNext();
  requireAdminOnly(req, res, next);
  assert.equal(next.callCount(), 0);
  assert.equal(res.statusCode, 403);
});
