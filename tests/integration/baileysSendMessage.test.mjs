/**
 * @fileoverview Baileys driver integration tests.
 *
 * Prerequisites:
 *   WA_INTEGRATION=1
 *   TEST_WA_NUMBER=+852XXXXXXXXX
 *   A separate WhatsApp account to send test messages to
 *   .baileys_auth/test must be scannable (fresh auth dir)
 *
 * Run:
 *   WA_INTEGRATION=1 node --test tests/integration/baileysSendMessage.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

if (process.env.WA_INTEGRATION !== '1') {
    test.skip('WA_INTEGRATION=1 required', () => {});
}
else {
    const BaileysDriver = require('../server/services/wa/driver/baileysDriver.js');
    const TEST_NUMBER = process.env.TEST_WA_NUMBER || '+85255550001';
    const SESSION_ID = 'test';
    const AUTH_ROOT = '/tmp/wa-bails-test';

    test('BaileysDriver — start and get QR', async () => {
        const driver = new BaileysDriver({
            sessionId: SESSION_ID,
            owner: 'integration_test',
            driver: 'baileys',
            authRootDir: AUTH_ROOT,
        });
        driver.start();
        // Give it a moment to emit QR
        await new Promise(r => setTimeout(r, 2000));
        const qr = driver.getQR();
        assert.ok(qr, 'QR should be generated on fresh auth');
        const status = driver.getStatus();
        assert.equal(status.driverName, 'baileys');
        assert.ok(!status.ready, 'not ready until QR scanned');
        await driver.stop();
    });

    test('BaileysDriver — sendMessage returns SendResult shape', async () => {
        const driver = new BaileysDriver({
            sessionId: SESSION_ID,
            owner: 'integration_test',
            driver: 'baileys',
            authRootDir: AUTH_ROOT,
        });
        // Without auth, sendMessage should return error
        const result = await driver.sendMessage(TEST_NUMBER, 'test from integration suite');
        assert.ok('ok' in result, 'SendResult must have ok field');
        assert.ok('id' in result || 'error' in result, 'SendResult must have id or error');
        await driver.stop();
    });

    test('BaileysDriver — sendMedia with data_base64', async () => {
        const driver = new BaileysDriver({
            sessionId: SESSION_ID,
            owner: 'integration_test',
            driver: 'baileys',
            authRootDir: AUTH_ROOT,
        });
        // 1x1 red PNG
        const pngB64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==';
        const result = await driver.sendMedia(TEST_NUMBER, {
            data_base64: pngB64,
            mime_type: 'image/png',
            caption: 'integration test media',
        });
        assert.ok('ok' in result);
        await driver.stop();
    });
}