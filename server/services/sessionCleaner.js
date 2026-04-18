/**
 * sessionCleaner — 定期清理 user_sessions 里过期 7 天以上的行
 *
 * 目的:防止 user_sessions 无限增长。过期/revoked 保留 7 天便于审计回溯。
 * 运行在主进程内,setInterval 每日一次;startup 时先跑一次。
 */
const userSessionRepo = require('./userSessionRepo');

const CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000; // 每日
let timerHandle = null;

async function runOnce() {
    try {
        const res = await userSessionRepo.cleanupStaleSessions();
        const affected = res?.affectedRows ?? res?.changes ?? 0;
        if (affected > 0) {
            console.log(`[sessionCleaner] purged ${affected} stale sessions`);
        }
    } catch (err) {
        console.error('[sessionCleaner] cleanup failed:', err?.message || err);
    }
}

function start() {
    if (timerHandle) return;
    // 首次延后 1 分钟跑,避免 startup 高峰
    setTimeout(runOnce, 60 * 1000);
    timerHandle = setInterval(runOnce, CLEANUP_INTERVAL_MS);
    timerHandle.unref?.();
    console.log('[sessionCleaner] started (daily)');
}

function stop() {
    if (!timerHandle) return;
    clearInterval(timerHandle);
    timerHandle = null;
}

module.exports = { start, stop, runOnce };
