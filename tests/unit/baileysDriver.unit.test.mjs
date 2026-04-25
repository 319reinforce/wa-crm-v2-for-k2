/**
 * @fileoverview BaileysDriver unit tests — no real WhatsApp account needed.
 *
 * Run: node --test tests/unit/baileysDriver.unit.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const BaileysDriver = require('../../server/services/wa/driver/baileysDriver.js');

test('BaileysDriver — class shape from module', () => {
    assert.ok(typeof BaileysDriver === 'function', 'should be a constructor function');
});

test('BaileysDriver — instantiation with required config', () => {
    const driver = new BaileysDriver({
        sessionId: 'unit-test',
        owner: 'unit',
        authRootDir: '/tmp/wa-bails-unit',
        driver: 'baileys',
    });
    assert.ok(driver, 'instance created');
    assert.ok(typeof driver.start === 'function');
    assert.ok(typeof driver.stop === 'function');
    assert.ok(typeof driver.getStatus === 'function');
    assert.ok(typeof driver.sendMessage === 'function');
    assert.ok(typeof driver.sendMedia === 'function');
    assert.ok(typeof driver.fetchRecentMessages === 'function');
    assert.ok(typeof driver.waitForReady === 'function');
});

test('BaileysDriver — getStatus before start returns not ready', () => {
    const driver = new BaileysDriver({
        sessionId: 'unit-test',
        owner: 'unit',
        authRootDir: '/tmp/wa-bails-unit',
        driver: 'baileys',
    });
    const status = driver.getStatus();
    assert.equal(status.driverName, 'baileys', 'driverName must be baileys');
    assert.equal(status.ready, false, 'ready must be false before start');
    assert.equal(status.hasQr, false, 'hasQr false before auth');
    assert.equal(status.accountPhone, null, 'accountPhone null before auth');
});

test('BaileysDriver — start() returns a promise and stop closes async setup', async () => {
    const driver = new BaileysDriver({
        sessionId: 'unit-test',
        owner: 'unit',
        authRootDir: '/tmp/wa-bails-unit',
        driver: 'baileys',
    });
    const ret = driver.start();
    assert.ok(ret instanceof Promise, 'start() must return Promise');
    await ret.catch(() => {});
    await driver.stop();
});

test('BaileysDriver — sendMessage without auth returns error shape', async () => {
    const driver = new BaileysDriver({
        sessionId: 'unit-test',
        owner: 'unit',
        authRootDir: '/tmp/wa-bails-unit',
        driver: 'baileys',
    });
    const result = await driver.sendMessage('+85255550000', 'unit test');
    assert.ok('ok' in result, 'must have ok field');
    assert.ok(!result.ok, 'should be not ok without auth');
    assert.ok('error' in result, 'must have error field');
});

test('BaileysDriver — sendMedia without auth returns error shape', async () => {
    const driver = new BaileysDriver({
        sessionId: 'unit-test',
        owner: 'unit',
        authRootDir: '/tmp/wa-bails-unit',
        driver: 'baileys',
    });
    const result = await driver.sendMedia('+85255550000', {
        data_base64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==',
        mime_type: 'image/png',
    });
    assert.ok('ok' in result);
    assert.ok(!result.ok);
});

test('BaileysDriver — fetchRecentMessages without auth returns empty array', async () => {
    const driver = new BaileysDriver({
        sessionId: 'unit-test',
        owner: 'unit',
        authRootDir: '/tmp/wa-bails-unit',
        driver: 'baileys',
    });
    const msgs = await driver.fetchRecentMessages('+85255550000', 10);
    assert.ok(Array.isArray(msgs), 'should return array');
    assert.equal(msgs.length, 0, 'should be empty without auth');
});

test('BaileysDriver — getQR before auth returns null', () => {
    const driver = new BaileysDriver({
        sessionId: 'unit-test',
        owner: 'unit',
        authRootDir: '/tmp/wa-bails-unit',
        driver: 'baileys',
    });
    const qr = driver.getQR();
    assert.equal(qr, null, 'QR must be null before auth');
});

test('BaileysDriver — isEventEmitter', () => {
    const driver = new BaileysDriver({
        sessionId: 'unit-test',
        owner: 'unit',
        authRootDir: '/tmp/wa-bails-unit',
        driver: 'baileys',
    });
    const { EventEmitter } = require('node:events');
    assert.ok(driver instanceof EventEmitter, 'must extend EventEmitter');
    assert.ok(typeof driver.on === 'function');
    assert.ok(typeof driver.emit === 'function');
    assert.ok(typeof driver.off === 'function');
});
