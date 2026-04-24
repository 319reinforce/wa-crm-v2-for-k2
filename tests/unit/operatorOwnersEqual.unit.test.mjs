/**
 * @fileoverview ownersEqual / normalizeOperatorName unit tests.
 *
 * Run: node --test tests/unit/operatorOwnersEqual.unit.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const { ownersEqual, normalizeOperatorName } = require('../../server/utils/operator.js');

test('ownersEqual — 静态 roster 同一人不同别名', () => {
    assert.equal(ownersEqual('sybil', 'Jiawen'), true);
    assert.equal(ownersEqual('jiawen', 'Jiawen'), true);
    assert.equal(ownersEqual('alice', 'Yiyun'), true);
    assert.equal(ownersEqual('beau', 'yifan'), true);
});

test('ownersEqual — 动态 operator 大小写不一致（核心回归）', () => {
    // creators.wa_owner='jiawei' vs frontend 拿到 'Jiawei'（来自 roster_operator 列）
    // 这是 PR #66 修复的真实生产 bug
    assert.equal(ownersEqual('jiawei', 'Jiawei'), true);
    assert.equal(ownersEqual('Jiawei', 'jiawei'), true);
    assert.equal(ownersEqual('MARCO', 'marco'), true);
});

test('ownersEqual — 不同人返回 false', () => {
    assert.equal(ownersEqual('Jiawen', 'Beau'), false);
    assert.equal(ownersEqual('jiawei', 'jiawen'), false);
    assert.equal(ownersEqual('Yiyun', 'WangYouKe'), false);
});

test('ownersEqual — null/undefined/空串语义', () => {
    assert.equal(ownersEqual(null, null), true);
    assert.equal(ownersEqual(undefined, undefined), true);
    assert.equal(ownersEqual(null, undefined), true);
    assert.equal(ownersEqual('', null), true);
    assert.equal(ownersEqual('jiawei', null), false);
    assert.equal(ownersEqual(null, 'jiawei'), false);
});

test('ownersEqual — 前后空格容忍', () => {
    assert.equal(ownersEqual(' jiawei ', 'Jiawei'), true);
    assert.equal(ownersEqual('Jiawen', ' sybil '), true);
});

test('normalizeOperatorName — 静态 roster 映射到权威大小写', () => {
    assert.equal(normalizeOperatorName('beau', null), 'Beau');
    assert.equal(normalizeOperatorName('yifan', null), 'Beau');
    assert.equal(normalizeOperatorName('alice', null), 'Yiyun');
    assert.equal(normalizeOperatorName('sybil', null), 'Jiawen');
});

test('normalizeOperatorName — 动态 operator 原样返回（保留现有契约）', () => {
    // 这是根本 bug 的来源：动态 operator 没权威大小写
    // 但我们不强行 lowercase，避免影响别的数据写入路径
    assert.equal(normalizeOperatorName('jiawei', null), 'jiawei');
    assert.equal(normalizeOperatorName('Jiawei', null), 'Jiawei');
});
