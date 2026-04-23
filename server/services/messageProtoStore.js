/**
 * @fileoverview Baileys proto.IMessage 存储：内存 LRU + DB 只读 fallback。
 *
 * 用途：
 *   getMessage 回调需要根据 key 还原原消息 proto 做重传/解密。
 *   - 热消息（近期 N 条）命中 LRU，微秒级返回。
 *   - 冷消息（LRU 驱逐后）走 DB 读 wa_messages.proto_bytes 列，一次 query 回 warm LRU。
 *
 * 写入职责：不在此处。proto_bytes 的 DB 写路径由 waWorker.insertMessages 统一处理
 *   （它已经有完整的去重、transaction、media 链路）。本模块只负责：
 *     - put(sessionId, waMsgId, protoMsg)  同步写 LRU
 *     - get(sessionId, { remoteJid, id })  LRU miss → DB → warm LRU → return
 *
 * 多 session 隔离：LRU key 带 sessionId 前缀。DB 层 wa_message_id 组合 UNIQUE(wa_message_id, creator_id)，
 *   同一 wa_message_id 可能跨 creator 存多行（例如 lotus 手机 session + 对话对端 session 同时
 *   观察到同一全局 message id）。getMessage 场景下 proto_bytes 内容一致，取最新插入的一条。
 */
'use strict';
const { getDb } = require('../../db');

const DEFAULT_LRU_SIZE = parseInt(process.env.WA_PROTO_LRU_SIZE || '5000', 10);

/**
 * 极简 LRU：Map 自带插入顺序，delete+set 即可"移到末尾"。
 */
class LruMap {
    constructor(capacity) {
        this.capacity = Math.max(1, capacity | 0);
        this.map = new Map();
    }
    get(key) {
        if (!this.map.has(key)) return undefined;
        const v = this.map.get(key);
        this.map.delete(key);
        this.map.set(key, v);
        return v;
    }
    set(key, val) {
        if (this.map.has(key)) this.map.delete(key);
        this.map.set(key, val);
        if (this.map.size > this.capacity) {
            const oldest = this.map.keys().next().value;
            if (oldest !== undefined) this.map.delete(oldest);
        }
    }
    size() { return this.map.size; }
    clear() { this.map.clear(); }
}

const lru = new LruMap(DEFAULT_LRU_SIZE);

let _baileysProto = null;
function getProto() {
    if (_baileysProto) return _baileysProto;
    const baileys = require('@whiskeysockets/baileys');
    _baileysProto = baileys.proto;
    return _baileysProto;
}

/**
 * 测试辅助：注入一个伪 proto 对象，避免依赖真实 baileys。
 * 生产代码不应调用。传 null 重置。
 * @param {{ Message: { encode: (m: any) => { finish: () => Uint8Array }, decode: (b: Uint8Array) => any } } | null} fakeProto
 */
function _setProtoForTests(fakeProto) {
    _baileysProto = fakeProto;
}

function lruKey(sessionId, msgId) {
    return `${sessionId}::${msgId}`;
}

/**
 * 把 proto.IMessage 编码成 Buffer，给 insertMessages 塞到 DB。
 * @param {object} protoMsg  proto.IMessage
 * @returns {Buffer|null}
 */
function encodeProto(protoMsg) {
    if (!protoMsg) return null;
    try {
        const proto = getProto();
        return Buffer.from(proto.Message.encode(protoMsg).finish());
    } catch (err) {
        console.warn('[messageProtoStore] encodeProto failed:', err.message);
        return null;
    }
}

/**
 * 把 DB 里读出的 Buffer 解码回 proto.IMessage。
 * @param {Buffer|Uint8Array|null} bytes
 * @returns {object|null}
 */
function decodeProto(bytes) {
    if (!bytes || !bytes.length) return null;
    try {
        const proto = getProto();
        return proto.Message.decode(bytes);
    } catch (err) {
        console.warn('[messageProtoStore] decodeProto failed:', err.message);
        return null;
    }
}

/**
 * 写入 LRU（不触 DB；DB 写由 insertMessages 负责）。
 * @param {string} sessionId
 * @param {string} msgId
 * @param {object} protoMsg  proto.IMessage
 */
function put(sessionId, msgId, protoMsg) {
    if (!sessionId || !msgId || !protoMsg) return;
    lru.set(lruKey(sessionId, msgId), protoMsg);
}

/**
 * 读 proto.IMessage：先 LRU，miss 走 DB，命中后回灌 LRU。
 * @param {string} sessionId
 * @param {{ remoteJid?: string, id: string, fromMe?: boolean }} key
 * @returns {Promise<object|null>} proto.IMessage 或 null
 */
async function get(sessionId, key) {
    if (!key?.id) return null;
    const lkey = lruKey(sessionId, key.id);
    const cached = lru.get(lkey);
    if (cached) return cached;

    try {
        const db = getDb();
        // 组合 UNIQUE(wa_message_id, creator_id) 下可能有多行，取最新 id。
        const row = await db.prepare(
            'SELECT proto_bytes FROM wa_messages ' +
            'WHERE wa_message_id = ? AND proto_driver = ? AND proto_bytes IS NOT NULL ' +
            'ORDER BY id DESC LIMIT 1'
        ).get(key.id, 'baileys');
        if (!row?.proto_bytes) return null;
        const protoMsg = decodeProto(row.proto_bytes);
        if (protoMsg) lru.set(lkey, protoMsg);
        return protoMsg;
    } catch (err) {
        console.warn(`[messageProtoStore] get miss→DB failed (msgId=${key.id}): ${err.message}`);
        return null;
    }
}

/**
 * 观测：LRU 当前条目数。测试/指标用。
 */
function size() { return lru.size(); }

/**
 * 测试辅助：清空 LRU。生产代码不应调用。
 */
function _resetForTests() { lru.clear(); }

module.exports = {
    put,
    get,
    size,
    encodeProto,
    decodeProto,
    _resetForTests,
    _setProtoForTests,
};
