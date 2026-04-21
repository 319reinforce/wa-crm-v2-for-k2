/**
 * perfLog — Phase 0 结构化性能日志
 *
 * 用法：
 *   const { perfLog } = require('./perfLog');
 *   perfLog('cmd_sent', { cmdId, sessionId, cmd });
 *
 * 输出：当 env PERF_LOG_ENABLED=true 时，向 stdout 写一行 JSON：
 *   {"perf_log":true,"phase":"cmd_sent","ts":1712345678901,"pid":12345,"cmdId":"...",...}
 *
 * 禁用时是 no-op（不拼字符串，不序列化），生产默认不产生任何开销。
 *
 * 配合 pm2 logrotate 和 jq 聚合分析端到端 p50/p95/p99。
 */

const PERF_LOG_ENABLED =
    String(process.env.PERF_LOG_ENABLED || '').toLowerCase() === 'true';

function perfLog(phase, fields) {
    if (!PERF_LOG_ENABLED) return;
    const entry = {
        perf_log: true,
        phase,
        ts: Date.now(),
        pid: process.pid,
        ...(fields || {}),
    };
    try {
        process.stdout.write(JSON.stringify(entry) + '\n');
    } catch (_) {
        // stdout 写失败不抛：perfLog 永不影响业务路径
    }
}

function perfLogEnabled() {
    return PERF_LOG_ENABLED;
}

module.exports = { perfLog, perfLogEnabled };
