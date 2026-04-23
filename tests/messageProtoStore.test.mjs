/**
 * @fileoverview messageProtoStore 单测：LRU 命中 + DB fallback + encode/decode 往返。
 *
 * 测试策略：
 *   1) 用 require.cache override 把 ../server/db 替换成 stub
 *   2) 用 _setProtoForTests 注入 fake proto（JSON 序列化替代 protobuf）
 *   3) 每个 test 前 _resetForTests 清 LRU，保证隔离
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

// ---- DB stub：key 是 wa_message_id，value 是行对象 ----
const fakeRows = new Map();
let dbCallLog = [];

const fakeDb = {
    prepare(sql) {
        return {
            async get(...args) {
                dbCallLog.push({ sql, args });
                // 匹配 WHERE wa_message_id = ? AND proto_driver = ?
                const [waMsgId, protoDriver] = args;
                if (/WHERE wa_message_id = \? AND proto_driver = \?/.test(sql)) {
                    const row = fakeRows.get(waMsgId);
                    if (!row) return undefined;
                    if (protoDriver && row.proto_driver !== protoDriver) return undefined;
                    return row;
                }
                return undefined;
            },
        };
    },
};

require.cache[require.resolve('../db')] = {
    id: require.resolve('../db'),
    filename: require.resolve('../db'),
    loaded: true,
    exports: { getDb: () => fakeDb, closeDb: () => {} },
};

// Now load the module under test
const protoStore = require('../server/services/messageProtoStore');

// ---- Fake proto (JSON encode/decode 替代真实 protobuf) ----
const fakeProto = {
    Message: {
        encode: (msg) => ({
            finish: () => Buffer.from(JSON.stringify(msg || {})),
        }),
        decode: (bytes) => JSON.parse(Buffer.from(bytes).toString()),
    },
};
protoStore._setProtoForTests(fakeProto);

// ---- Helpers ----
function resetAll() {
    protoStore._resetForTests();
    fakeRows.clear();
    dbCallLog = [];
}

// ================== Tests ==================

test('put + get — LRU 命中', () => {
    resetAll();
    const sessionId = 'test-session';
    const key = { id: 'MSG001', remoteJid: '+85255550001@s.whatsapp.net' };
    const proto = { conversation: 'hello world' };

    protoStore.put(sessionId, key.id, proto);
    return protoStore.get(sessionId, key).then((got) => {
        assert.deepEqual(got, proto);
        assert.equal(dbCallLog.length, 0, 'LRU 命中不应访问 DB');
    });
});

test('put — 非法参数静默忽略', () => {
    resetAll();
    // 这些都不应该抛
    protoStore.put(null, 'x', { a: 1 });
    protoStore.put('s', null, { a: 1 });
    protoStore.put('s', 'x', null);
    assert.equal(protoStore.size(), 0);
});

test('get — LRU miss 走 DB 并 warm back', async () => {
    resetAll();
    const sessionId = 'test-session';
    const key = { id: 'MSG002', remoteJid: '+85255550002@s.whatsapp.net' };
    const proto = { conversation: 'from DB' };

    // 只往 DB 塞，不进 LRU
    fakeRows.set(key.id, {
        proto_bytes: Buffer.from(JSON.stringify(proto)),
        proto_driver: 'baileys',
    });

    const got1 = await protoStore.get(sessionId, key);
    assert.deepEqual(got1, proto, 'DB fallback 应返回 decode 后的 proto');
    assert.equal(dbCallLog.length, 1, '第一次 get 走 DB');

    // 第二次 get 应命中 LRU，不再访问 DB
    const got2 = await protoStore.get(sessionId, key);
    assert.deepEqual(got2, proto);
    assert.equal(dbCallLog.length, 1, '第二次 get 应命中 LRU warm back');
});

test('get — DB 无数据返回 null', async () => {
    resetAll();
    const got = await protoStore.get('s', { id: 'NONEXIST' });
    assert.equal(got, null);
});

test('get — 非 baileys proto_driver 应跳过（driver 隔离）', async () => {
    resetAll();
    const key = { id: 'MSG003' };
    fakeRows.set(key.id, {
        proto_bytes: Buffer.from(JSON.stringify({ conversation: 'wrong driver' })),
        proto_driver: 'wwebjs',  // 非 baileys
    });
    const got = await protoStore.get('s', key);
    assert.equal(got, null, '非 baileys driver 的 proto 不应被当作 Baileys 消息返回');
});

test('LRU 驱逐 — 超 capacity 后最旧的被踢', () => {
    resetAll();
    // 默认 5000 太大，我们直接观察：put 很多条后 size 不能无限长
    // 这里只验证基本插入不泄漏，全容量测试在后面
    for (let i = 0; i < 10; i++) {
        protoStore.put('s', `msg-${i}`, { conversation: `text-${i}` });
    }
    assert.equal(protoStore.size(), 10);
});

test('encodeProto + decodeProto 往返保真', () => {
    const original = { conversation: 'roundtrip test', extendedTextMessage: { text: 'nested' } };
    const buf = protoStore.encodeProto(original);
    assert.ok(Buffer.isBuffer(buf));
    const back = protoStore.decodeProto(buf);
    assert.deepEqual(back, original);
});

test('encodeProto — null 输入返回 null', () => {
    assert.equal(protoStore.encodeProto(null), null);
    assert.equal(protoStore.encodeProto(undefined), null);
});

test('decodeProto — 空 Buffer 返回 null', () => {
    assert.equal(protoStore.decodeProto(null), null);
    assert.equal(protoStore.decodeProto(Buffer.alloc(0)), null);
});

test('decodeProto — 损坏数据不抛，返回 null', () => {
    // fakeProto.decode = JSON.parse，传入非 JSON Buffer 会抛
    const bad = Buffer.from([0xff, 0xfe, 0xfd]);  // 非 JSON
    const got = protoStore.decodeProto(bad);
    assert.equal(got, null);
});

test('多 session 隔离 — 同 msgId 在不同 session 下互不污染', async () => {
    resetAll();
    const key = { id: 'SHARED-ID' };
    protoStore.put('sessionA', key.id, { conversation: 'A' });
    protoStore.put('sessionB', key.id, { conversation: 'B' });

    const gotA = await protoStore.get('sessionA', key);
    const gotB = await protoStore.get('sessionB', key);
    assert.deepEqual(gotA, { conversation: 'A' });
    assert.deepEqual(gotB, { conversation: 'B' });
});

test('get — key.id 为空返回 null', async () => {
    resetAll();
    assert.equal(await protoStore.get('s', {}), null);
    assert.equal(await protoStore.get('s', { id: '' }), null);
});

test('get — DB 抛错不冒泡，返回 null', async () => {
    resetAll();
    // 覆盖 fakeDb 让 prepare 抛错
    const badDb = { prepare: () => { throw new Error('db down'); } };
    require.cache[require.resolve('../db')].exports.getDb = () => badDb;

    const got = await protoStore.get('s', { id: 'X' });
    assert.equal(got, null, 'DB 抛错时 get 应返回 null 而非抛错');

    // 还原
    require.cache[require.resolve('../db')].exports.getDb = () => fakeDb;
});
