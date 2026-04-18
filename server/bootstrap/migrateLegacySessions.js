/**
 * migrateLegacySessions — 一次性迁移旧 session 配置到 wa_sessions 表
 *
 * 来源优先级(从高到低):
 *   1. ecosystem.wa-crawlers.config.cjs 的 apps[].env(最权威,owner + session_id 都有)
 *   2. process.env.WA_SESSIONS(JSON)
 *   3. process.env.WA_SESSION_TARGETS(JSON,router 侧老配置)
 *   4. .wwebjs_auth/session-* 目录扫描(只能兜底 session_id,不猜 owner;孤儿目录打 WARN)
 *
 * 幂等:已在 DB 的 session_id 跳过不覆盖;aliases 等字段不会被低优先级源覆盖。
 *
 * 调用时机:API 进程 startup 里,wa_sessions 表建表后、SessionRegistry.bootstrap 前。
 */
const fs = require('fs');
const path = require('path');
const repo = require('../services/sessionRepository');
const { normalizeOperatorName } = require('../utils/operator');

const ECOSYSTEM_PATH = path.join(__dirname, '../../ecosystem.wa-crawlers.config.cjs');
const DEFAULT_AUTH_ROOT = path.join(__dirname, '../../.wwebjs_auth');

function parseEcosystemSessions() {
    if (!fs.existsSync(ECOSYSTEM_PATH)) return [];
    try {
        // 清除 require 缓存避免重复跑时拿旧值
        delete require.cache[require.resolve(ECOSYSTEM_PATH)];
        const mod = require(ECOSYSTEM_PATH);
        const apps = Array.isArray(mod?.apps) ? mod.apps : [];
        return apps
            .map((app) => ({
                session_id: String(app?.env?.WA_SESSION_ID || '').trim(),
                owner: normalizeOperatorName(app?.env?.WA_OWNER, app?.env?.WA_OWNER),
            }))
            .filter((item) => item.session_id && item.owner);
    } catch (err) {
        console.warn(`[migrateLegacySessions] ecosystem parse failed: ${err.message}`);
        return [];
    }
}

function parseJsonEnvSessions(envVarName) {
    const raw = process.env[envVarName];
    if (!raw) return [];
    try {
        const parsed = JSON.parse(raw);
        const items = Array.isArray(parsed) ? parsed : Object.values(parsed || {});
        return items
            .map((item) => ({
                session_id: String(item?.sessionId || item?.session_id || item?.SESSION_ID || '').trim(),
                owner: normalizeOperatorName(
                    item?.owner || item?.OWNER,
                    item?.owner || item?.OWNER,
                ),
            }))
            .filter((item) => item.session_id && item.owner);
    } catch (err) {
        console.warn(`[migrateLegacySessions] ${envVarName} parse failed: ${err.message}`);
        return [];
    }
}

function scanAuthDirs() {
    const authRoot = process.env.WA_AUTH_ROOT
        || process.env.WWEBJS_AUTH_ROOT
        || DEFAULT_AUTH_ROOT;
    if (!fs.existsSync(authRoot)) return [];
    try {
        return fs.readdirSync(authRoot)
            .filter((name) => name.startsWith('session-'))
            .map((name) => name.slice('session-'.length))
            .filter(Boolean);
    } catch (err) {
        console.warn(`[migrateLegacySessions] auth dir scan failed: ${err.message}`);
        return [];
    }
}

async function run() {
    console.log('[migrateLegacySessions] start');

    const existing = await repo.listSessions();
    const existingSessionIds = new Set(existing.map((s) => s.session_id));
    const existingOwners = new Set(
        existing
            .filter((s) => s.desired_state === 'running')
            .map((s) => normalizeOperatorName(s.owner, s.owner))
            .filter(Boolean),
    );

    let fromEcosystem = 0;
    let fromWaSessions = 0;
    let fromWaSessionTargets = 0;
    const orphans = [];

    // 1) ecosystem
    for (const item of parseEcosystemSessions()) {
        if (existingSessionIds.has(item.session_id)) continue;
        if (existingOwners.has(item.owner)) {
            console.warn(`[migrateLegacySessions] skip ecosystem session "${item.session_id}" because owner "${item.owner}" already has active session`);
            continue;
        }
        try {
            await repo.createSession({
                session_id: item.session_id,
                owner: item.owner,
                aliases: [],
                created_by: 'migrate:ecosystem',
            });
            existingSessionIds.add(item.session_id);
            existingOwners.add(item.owner);
            fromEcosystem += 1;
        } catch (err) {
            console.warn(`[migrateLegacySessions] ecosystem insert "${item.session_id}" failed: ${err.message}`);
        }
    }

    // 2) WA_SESSIONS env
    for (const item of parseJsonEnvSessions('WA_SESSIONS')) {
        if (existingSessionIds.has(item.session_id)) continue;
        if (existingOwners.has(item.owner)) continue;
        try {
            await repo.createSession({
                session_id: item.session_id,
                owner: item.owner,
                aliases: [],
                created_by: 'migrate:env:WA_SESSIONS',
            });
            existingSessionIds.add(item.session_id);
            existingOwners.add(item.owner);
            fromWaSessions += 1;
        } catch (err) {
            console.warn(`[migrateLegacySessions] WA_SESSIONS insert "${item.session_id}" failed: ${err.message}`);
        }
    }

    // 3) WA_SESSION_TARGETS env
    for (const item of parseJsonEnvSessions('WA_SESSION_TARGETS')) {
        if (existingSessionIds.has(item.session_id)) continue;
        if (existingOwners.has(item.owner)) continue;
        try {
            await repo.createSession({
                session_id: item.session_id,
                owner: item.owner,
                aliases: [],
                created_by: 'migrate:env:WA_SESSION_TARGETS',
            });
            existingSessionIds.add(item.session_id);
            existingOwners.add(item.owner);
            fromWaSessionTargets += 1;
        } catch (err) {
            console.warn(`[migrateLegacySessions] WA_SESSION_TARGETS insert "${item.session_id}" failed: ${err.message}`);
        }
    }

    // 4) auth dir 扫描(只 warn,不自动入库)
    for (const sid of scanAuthDirs()) {
        if (existingSessionIds.has(sid)) continue;
        orphans.push(sid);
    }

    // 报告
    console.log(`[migrateLegacySessions] from ecosystem: ${fromEcosystem} new`);
    console.log(`[migrateLegacySessions] from WA_SESSIONS env: ${fromWaSessions} new`);
    console.log(`[migrateLegacySessions] from WA_SESSION_TARGETS env: ${fromWaSessionTargets} new`);
    if (orphans.length) {
        console.warn(`[migrateLegacySessions] orphan auth dirs (need manual add via UI): ${orphans.join(', ')}`);
    }
    const total = await repo.listSessions();
    console.log(`[migrateLegacySessions] done. Total sessions in DB: ${total.length}`);

    return {
        ecosystem: fromEcosystem,
        waSessions: fromWaSessions,
        waSessionTargets: fromWaSessionTargets,
        orphans,
        total: total.length,
    };
}

module.exports = { run };

// 允许直接命令行运行
if (require.main === module) {
    require('dotenv').config();
    const db = require('../../db');
    run()
        .then(async () => { try { await db.closeDb(); } catch (_) {} process.exit(0); })
        .catch(async (err) => {
            console.error('[migrateLegacySessions] failed:', err);
            try { await db.closeDb(); } catch (_) {}
            process.exit(1);
        });
}
