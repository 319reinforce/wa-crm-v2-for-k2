/**
 * @fileoverview baileysDriver history sync 单测：
 *   - messaging-history.set → emit history_set / history_latest_seen
 *   - fetchMessageHistory 30s 超时 + 返回值
 *   - connection open 时 _historySyncLatestSeen 重置
 *   - LEGACY_MODE 下不订阅 history sync 事件
 *
 * 策略：通过 Module._load 拦截 require('@whiskeysockets/baileys')，
 * 注入一个可控的 fake sock（含 ev EventEmitter + 方法 stubs）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import Module from 'node:module';
import { EventEmitter } from 'node:events';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const require = createRequire(import.meta.url);

// ---- Fake @whiskeysockets/baileys ----
const fakeProto = {
    Message: {
        encode: (m) => ({ finish: () => Buffer.from(JSON.stringify(m || {})) }),
        decode: (b) => JSON.parse(Buffer.from(b).toString()),
    },
};

let currentFakeSock = null;
function makeFakeSock() {
    const ev = new EventEmitter();
    const sock = {
        ev,
        user: { id: '85255550001@s.whatsapp.net' },
        end: () => {},
        sendMessage: async () => ({ key: { id: 'mock-id' }, messageTimestamp: Math.floor(Date.now() / 1000) }),
        onWhatsApp: async (jid) => [{ jid, exists: true }],
        updateMediaMessage: async () => {},
        fetchMessageHistory: async (count, oldestKey, ts) => 'fake-ondemand-session-id',
    };
    currentFakeSock = sock;
    return sock;
}

function buildFakeBaileys() {
    return {
        default: (/* config */) => makeFakeSock(),  // makeWASocket
        useMultiFileAuthState: async (/* dir */) => ({
            state: {},
            saveCreds: async () => {},
        }),
        Browsers: {
            ubuntu: (app) => ['Ubuntu', app || 'Chrome', '22.04.4'],
            macOS: (app) => ['Mac OS', app || 'Desktop', '10.15.7'],
            windows: (app) => ['Windows', app || 'Desktop', '10.0.19045'],
        },
        DisconnectReason: {
            loggedOut: 401,
            connectionReplaced: 428,
            restartRequired: 515,
        },
        fetchLatestBaileysVersion: async () => ({ version: [2, 3000, 1] }),
        downloadMediaMessage: async () => Buffer.alloc(0),
        proto: fakeProto,
    };
}

// ---- Fake pino (测试环境 node_modules 未装) ----
// Baileys 要求 logger.child()，pino() 返回的对象满足这个接口。
function fakePino(/* opts */) {
    const logger = {
        level: 'silent',
        trace: () => {},
        debug: () => {},
        info: () => {},
        warn: () => {},
        error: () => {},
        fatal: () => {},
        child: () => logger,
    };
    return logger;
}
fakePino.default = fakePino;

// ---- Hook Module._load ----
const origLoad = Module._load;
Module._load = function(id, parent, isMain) {
    if (id === '@whiskeysockets/baileys') return buildFakeBaileys();
    if (id === 'pino') return fakePino;
    return origLoad.call(this, id, parent, isMain);
};

// ---- Stub db.js before loading protoStore (get() 会触碰 db) ----
require.cache[require.resolve('../db')] = {
    id: require.resolve('../db'),
    filename: require.resolve('../db'),
    loaded: true,
    exports: {
        getDb: () => ({ prepare: () => ({ get: async () => undefined }) }),
        closeDb: () => {},
    },
};

// ---- Helpers ----
const BaileysDriver = require('../server/services/wa/driver/baileysDriver');

function makeDriver(overrides = {}) {
    const authRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'baileys-test-'));
    return new BaileysDriver({
        sessionId: overrides.sessionId || 'test-session',
        owner: 'tester',
        authRootDir: authRoot,
        driverMeta: {},
        ...overrides,
    });
}

async function startAndReady(driver) {
    await driver.start();
    // fake connection.update → open 触发 ready emit
    currentFakeSock.ev.emit('connection.update', { connection: 'open' });
    // driver.ready is set synchronously in the handler
    assert.equal(driver._ready, true, '连接 open 后 driver 应就绪');
}

// ================== Tests ==================

test('messaging-history.set — emit history_set 带完整 payload', async () => {
    const driver = makeDriver();
    await startAndReady(driver);

    const received = [];
    driver.on('history_set', (p) => received.push(p));

    currentFakeSock.ev.emit('messaging-history.set', {
        chats: [{ id: '85255550001@s.whatsapp.net' }],
        contacts: [],
        messages: [
            { key: { id: 'M1', remoteJid: '85255550001@s.whatsapp.net', fromMe: false }, messageTimestamp: 1000, message: { conversation: 'hi' } },
            { key: { id: 'M2', remoteJid: '85255550001@s.whatsapp.net', fromMe: false }, messageTimestamp: 2000, message: { conversation: 'yo' } },
        ],
        syncType: 2,  // FULL
        progress: 50,
        isLatest: false,
    });

    assert.equal(received.length, 1);
    assert.equal(received[0].messages.length, 2);
    assert.equal(received[0].syncType, 2);
    assert.equal(received[0].progress, 50);
    assert.equal(received[0].isLatest, false);

    await driver.stop();
});

test('messaging-history.set — isLatest:true 触发 history_latest_seen (仅一次)', async () => {
    const driver = makeDriver({ sessionId: 'latest-test' });
    await startAndReady(driver);

    let latestCount = 0;
    driver.on('history_latest_seen', () => latestCount++);

    // 第一次 isLatest: true
    currentFakeSock.ev.emit('messaging-history.set', {
        messages: [], chats: [], contacts: [], syncType: 2, progress: 100, isLatest: true,
    });
    assert.equal(latestCount, 1);

    // 第二次 isLatest: true（同一连接生命周期内）应不再触发
    currentFakeSock.ev.emit('messaging-history.set', {
        messages: [], chats: [], contacts: [], syncType: 2, progress: 100, isLatest: true,
    });
    assert.equal(latestCount, 1, '同一连接内 history_latest_seen 只 emit 一次');

    await driver.stop();
});

test('messaging-history.set — 重连后 _historySyncLatestSeen 重置，允许再次 emit', async () => {
    const driver = makeDriver({ sessionId: 'reconnect-test' });
    await startAndReady(driver);

    let latestCount = 0;
    driver.on('history_latest_seen', () => latestCount++);

    // 第一次连接的 history sync 完成
    currentFakeSock.ev.emit('messaging-history.set', {
        messages: [], chats: [], contacts: [], isLatest: true,
    });
    assert.equal(latestCount, 1);

    // 模拟重连：connection.update connection='open' 再次触发
    currentFakeSock.ev.emit('connection.update', { connection: 'open' });
    assert.equal(driver._historySyncLatestSeen, false, '重连后 _historySyncLatestSeen 应重置');

    // 重连后再次收到 isLatest:true
    currentFakeSock.ev.emit('messaging-history.set', {
        messages: [], chats: [], contacts: [], isLatest: true,
    });
    assert.equal(latestCount, 2, '重连后应能再次触发 history_latest_seen');

    await driver.stop();
});

test('messaging-history.set — contacts.lid 灌入 LID↔PN 映射', async () => {
    const driver = makeDriver({ sessionId: 'lid-test' });
    await startAndReady(driver);

    currentFakeSock.ev.emit('messaging-history.set', {
        messages: [],
        chats: [],
        contacts: [
            { id: '85255550001@s.whatsapp.net', lid: '123456@lid' },
            { id: '85255550002@s.whatsapp.net' },  // 无 lid，跳过
        ],
        isLatest: false,
    });

    assert.equal(driver._lidToPnMap.get('123456@lid'), '85255550001@s.whatsapp.net');
    assert.equal(driver._lidToPnMap.size, 1);

    await driver.stop();
});

test('fetchMessageHistory — 返回 sessionId 字符串', async () => {
    const driver = makeDriver({ sessionId: 'fetch-test' });
    await startAndReady(driver);

    const result = await driver.fetchMessageHistory(50, { remoteJid: '85255550001@s.whatsapp.net', id: 'M1', fromMe: false }, 1000000);
    assert.equal(result, 'fake-ondemand-session-id');

    await driver.stop();
});

test('fetchMessageHistory — 未 ready 返回 null', async () => {
    const driver = makeDriver({ sessionId: 'notready-test' });
    await driver.start();
    // 不 emit connection open，driver._ready 保持 false
    const result = await driver.fetchMessageHistory(50, { remoteJid: 'x', id: 'y', fromMe: false }, 1000);
    assert.equal(result, null);

    await driver.stop();
});

test('fetchMessageHistory — sock.fetchMessageHistory 抛错时返回 null（不冒泡）', async () => {
    const driver = makeDriver({ sessionId: 'throw-test' });
    await startAndReady(driver);

    currentFakeSock.fetchMessageHistory = async () => { throw new Error('simulated WA error'); };

    const result = await driver.fetchMessageHistory(50, { remoteJid: 'x', id: 'y', fromMe: false }, 1000);
    assert.equal(result, null);

    await driver.stop();
});

test('fetchMessageHistory — sock 缺 fetchMessageHistory 方法返回 null（Issue #2083 兜底）', async () => {
    const driver = makeDriver({ sessionId: 'missing-api-test' });
    await startAndReady(driver);

    delete currentFakeSock.fetchMessageHistory;

    const result = await driver.fetchMessageHistory(50, { remoteJid: 'x', id: 'y', fromMe: false }, 1000);
    assert.equal(result, null);

    await driver.stop();
});

test('LEGACY_MODE=true — 不订阅 messaging-history.set，不 emit history_set', async () => {
    // 动态设置环境变量后重 require（因为 LEGACY_MODE 是模块顶层常量）
    const origLegacy = process.env.WA_BAILEYS_LEGACY_MODE;
    process.env.WA_BAILEYS_LEGACY_MODE = 'true';

    // 清掉 require.cache 让 LEGACY_MODE 重新求值
    delete require.cache[require.resolve('../server/services/wa/driver/baileysDriver')];
    const LegacyBaileysDriver = require('../server/services/wa/driver/baileysDriver');

    try {
        const authRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'baileys-legacy-'));
        const driver = new LegacyBaileysDriver({
            sessionId: 'legacy-test',
            owner: 'tester',
            authRootDir: authRoot,
            driverMeta: {},
        });

        await driver.start();
        currentFakeSock.ev.emit('connection.update', { connection: 'open' });

        let fired = 0;
        driver.on('history_set', () => fired++);

        // 触发 messaging-history.set — LEGACY_MODE 下根本没订阅，应无反应
        currentFakeSock.ev.emit('messaging-history.set', {
            messages: [{ key: { id: 'X1' }, messageTimestamp: 1, message: { conversation: 'x' } }],
            chats: [], contacts: [], isLatest: true,
        });

        assert.equal(fired, 0, 'LEGACY_MODE 下 history_set 不应 emit');
        await driver.stop();
    } finally {
        if (origLegacy === undefined) delete process.env.WA_BAILEYS_LEGACY_MODE;
        else process.env.WA_BAILEYS_LEGACY_MODE = origLegacy;
        // 恢复正常模式的 driver（让其他测试拿回正常的 module）
        delete require.cache[require.resolve('../server/services/wa/driver/baileysDriver')];
    }
});

test('normalizeRawMessage — 把 raw WebMessageInfo 转成 IncomingMessage 且带 protoBytes', async () => {
    // 需要重新 load 让 LEGACY_MODE 回到默认 false
    delete require.cache[require.resolve('../server/services/wa/driver/baileysDriver')];
    const Driver = require('../server/services/wa/driver/baileysDriver');
    const authRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'baileys-normalize-'));
    const driver = new Driver({
        sessionId: 'norm-test', owner: 't', authRootDir: authRoot, driverMeta: {},
    });
    await driver.start();
    currentFakeSock.ev.emit('connection.update', { connection: 'open' });

    const raw = {
        key: { id: 'NORM1', remoteJid: '85255550001@s.whatsapp.net', fromMe: false },
        messageTimestamp: 1700000,
        message: { conversation: 'normalized text' },
    };
    const out = await driver.normalizeRawMessage(raw);
    assert.ok(out, 'normalizeRawMessage 应返回对象');
    assert.equal(out.id, 'NORM1');
    assert.equal(out.text, 'normalized text');
    assert.equal(out.fromMe, false);
    assert.ok(Buffer.isBuffer(out.protoBytes), 'protoBytes 应为 Buffer');
    assert.equal(out.protoDriver, 'baileys');

    await driver.stop();
});

// ---- Teardown: restore Module._load ----
test.after(() => {
    Module._load = origLoad;
});
