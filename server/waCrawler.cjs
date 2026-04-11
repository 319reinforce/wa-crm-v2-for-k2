/**
 * WA Crawler 入口（无 HTTP 服务）
 * 用于同机并行启动多个 WhatsApp 抓取 session，统一写入同一 MySQL。
 *
 * 示例：
 *   WA_SESSION_ID=beau WA_OWNER=Beau WA_API_BASE=http://127.0.0.1:3000 node server/waCrawler.cjs
 *   WA_SESSION_ID=yiyun WA_OWNER=Yiyun WA_API_BASE=http://127.0.0.1:3000 node server/waCrawler.cjs
 */
require('dotenv').config();
const db = require('../db');
const {
    start: startWaService,
    getStatus: getWaStatus,
    getQrValue,
    sendMessage,
} = require('./services/waService');
const {
    start: startWaWorker,
    stop: stopWaWorker,
    getProgress: getWaWorkerProgress,
} = require('./waWorker');
const {
    claimNextSessionCommand,
    completeClaimedCommand,
    writeSessionStatus,
} = require('./services/waIpc');
const { normalizeOperatorName } = require('./utils/operator');

const WA_OWNER = normalizeOperatorName(process.env.WA_OWNER, 'Beau');
const WA_SESSION_ID = String(process.env.WA_SESSION_ID || process.env.PORT || '3000').trim();
const WA_API_BASE = process.env.WA_API_BASE || `http://127.0.0.1:${process.env.PORT || 3000}`;
const CRAWLER_TAG = `${WA_OWNER}/${WA_SESSION_ID}`;
let statusTimer = null;
let commandTimer = null;
let commandInFlight = false;

function publishStatus(extra = {}) {
    try {
        writeSessionStatus(WA_SESSION_ID, {
            ...getWaStatus(),
            qr_value: getQrValue(),
            worker: getWaWorkerProgress(),
            pid: process.pid,
            owner: extra.owner || getWaStatus().owner || WA_OWNER,
            configured_owner: WA_OWNER,
            api_base: WA_API_BASE,
            running: true,
            ...extra,
        });
    } catch (err) {
        console.error(`[waCrawler:${CRAWLER_TAG}] publish status failed:`, err.message);
    }
}

async function processSessionCommands() {
    if (commandInFlight) return;
    commandInFlight = true;
    try {
        const claimed = claimNextSessionCommand(WA_SESSION_ID);
        if (!claimed) return;

        const payload = claimed.command || {};
        if (payload.type ***REMOVED***= 'send_message') {
            const result = await sendMessage(payload.phone, payload.text);
            completeClaimedCommand(claimed, {
                ...result,
                routed_session_id: WA_SESSION_ID,
                routed_operator: WA_OWNER,
            });
            publishStatus();
            return;
        }

        completeClaimedCommand(claimed, {
            ok: false,
            error: `unsupported command type: ${payload.type || 'unknown'}`,
            routed_session_id: WA_SESSION_ID,
            routed_operator: WA_OWNER,
        });
    } catch (err) {
        console.error(`[waCrawler:${CRAWLER_TAG}] process command failed:`, err.message);
    } finally {
        commandInFlight = false;
    }
}

async function main() {
    console.log('═'.repeat(60));
    console.log(`  WA Crawler 启动中... (${CRAWLER_TAG})`);
    console.log(`  Profile API: ${WA_API_BASE}`);
    console.log('═'.repeat(60));

    startWaService();
    publishStatus();
    statusTimer = setInterval(() => publishStatus(), 2000);
    commandTimer = setInterval(() => {
        processSessionCommands().catch((err) => {
            console.error(`[waCrawler:${CRAWLER_TAG}] command loop failed:`, err.message);
        });
    }, 1000);
    await startWaWorker({ syncHistory: true });
    publishStatus();
}

let isShuttingDown = false;
async function shutdown(signal) {
    if (isShuttingDown) return;
    isShuttingDown = true;
    console.log(`[waCrawler:${CRAWLER_TAG}] ${signal} received, shutting down...`);
    if (statusTimer) clearInterval(statusTimer);
    if (commandTimer) clearInterval(commandTimer);
    publishStatus({
        ready: false,
        hasQr: false,
        running: false,
        error: `${signal} shutdown`,
        stopped_at: new Date().toISOString(),
    });
    try {
        stopWaWorker();
    } catch (_) {}
    try {
        await db.closeDb();
    } catch (_) {}
    process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

if (require.main ***REMOVED***= module) {
    main().catch(async (err) => {
        console.error(`[waCrawler:${CRAWLER_TAG}] fatal:`, err.message);
        try { await db.closeDb(); } catch (_) {}
        process.exit(1);
    });
}

module.exports = { main, shutdown };
