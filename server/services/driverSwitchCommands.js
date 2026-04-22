/**
 * driverSwitchCommands — 进程级内存命令队列，用于 /sessions/:sid/driver 异步执行。
 *
 * 生命周期:
 *   pending → running → (completed | failed | timeout)
 *
 * 为什么不用持久化:
 * - 切换只在管理员触发，命令级 < 100/天
 * - 进程重启后状态消失是可接受的：reconciler 会按 DB 里 desired_state 继续推进
 * - 持久化进 DB 反而引入查询/清理负担
 *
 * 内存清理:
 * - 终态命令在 TTL (默认 10 分钟) 后清理
 * - create 时顺手清过期项，避免单独 timer
 */
'use strict';

const { randomUUID } = require('crypto');

const DEFAULT_TTL_MS = 10 * 60 * 1000;
const TERMINAL_STATUSES = new Set(['completed', 'failed', 'timeout']);

function nowMs() { return Date.now(); }

class DriverSwitchCommandStore {
    /** @param {{ ttlMs?: number }} [opts] */
    constructor(opts = {}) {
        this.ttlMs = opts.ttlMs || DEFAULT_TTL_MS;
        /** @type {Map<string, object>} */
        this._cmds = new Map();
    }

    /**
     * @param {{ sessionId: string, type?: string, fromDriver?: string, toDriver?: string, forced?: boolean, actor?: string }} input
     * @returns {object} 新命令记录
     */
    create(input) {
        this._gcExpired();
        const id = randomUUID();
        const record = {
            id,
            sessionId: String(input.sessionId || ''),
            type: input.type || 'change_driver',
            status: 'pending',
            progress: 'queued',
            fromDriver: input.fromDriver || null,
            toDriver: input.toDriver || null,
            forced: !!input.forced,
            actor: input.actor || null,
            result: null,
            error: null,
            createdAt: nowMs(),
            startedAt: null,
            finishedAt: null,
        };
        this._cmds.set(id, record);
        return { ...record };
    }

    get(id) {
        const r = this._cmds.get(String(id || ''));
        return r ? { ...r } : null;
    }

    /**
     * 更新命令状态；只允许 pending → running → terminal 这条单向通路。
     * 对未知 id 返回 null。
     */
    update(id, patch) {
        const r = this._cmds.get(String(id || ''));
        if (!r) return null;
        if (TERMINAL_STATUSES.has(r.status)) {
            // 终态不可覆盖
            return { ...r };
        }
        if (patch.status && patch.status !== r.status) {
            if (r.status === 'pending' && patch.status === 'running') r.startedAt = nowMs();
            if (TERMINAL_STATUSES.has(patch.status)) r.finishedAt = nowMs();
        }
        Object.assign(r, patch);
        return { ...r };
    }

    /** 返回某 session 的命令列表（调试用），按 createdAt desc */
    listBySession(sessionId) {
        const sid = String(sessionId || '');
        return Array.from(this._cmds.values())
            .filter((r) => r.sessionId === sid)
            .sort((a, b) => b.createdAt - a.createdAt)
            .map((r) => ({ ...r }));
    }

    /** 强制清理（测试用） */
    _clear() { this._cmds.clear(); }

    _gcExpired() {
        const cutoff = nowMs() - this.ttlMs;
        for (const [id, r] of this._cmds.entries()) {
            if (TERMINAL_STATUSES.has(r.status) && r.finishedAt && r.finishedAt < cutoff) {
                this._cmds.delete(id);
            }
        }
    }
}

// 进程级单例
const singleton = new DriverSwitchCommandStore();

module.exports = {
    DriverSwitchCommandStore,
    getStore: () => singleton,
};
