#!/usr/bin/env node
/**
 * 设置“正式上线统计起点” marker。
 *
 * 用法：
 *   node scripts/start-formal-launch-metrics.cjs
 *   node scripts/start-formal-launch-metrics.cjs --at=2026-04-12
 *   node scripts/start-formal-launch-metrics.cjs --at=2026-04-12T00:00:00+08:00
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const db = require('../db');

const args = process.argv.slice(2);
const atArg = args.find((item) => item.startsWith('--at='));
const OUTPUT_PATH = process.env.FORMAL_LAUNCH_MARKER_PATH || 'docs/rag/formal-launch-window.json';

function parseLaunchAt(input) {
    if (!input) {
        const d = new Date(Date.now() + 24 * 60 * 60 * 1000);
        const yyyy = d.getFullYear();
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        return new Date(`${yyyy}-${mm}-${dd}T00:00:00.000+08:00`);
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(input)) {
        return new Date(`${input}T00:00:00.000+08:00`);
    }
    return new Date(input);
}

function ensureDir(filePath) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

async function main() {
    const inputAt = atArg ? atArg.split('=')[1] : '';
    const launchAt = parseLaunchAt(inputAt);
    if (!Number.isFinite(launchAt.getTime())) {
        throw new Error(`invalid --at value: ${inputAt}`);
    }

    const now = new Date();
    const db2 = db.getDb();

    // 仅当起点 <= 当前时间时，记录 ID 基线；未来起点使用纯时间窗口，避免“提前截断”。
    let baseline = null;
    if (launchAt.getTime() <= now.getTime()) {
        const [glRow, sftRow, fbRow] = await Promise.all([
            db2.prepare('SELECT COALESCE(MAX(id), 0) AS max_id FROM generation_log').get(),
            db2.prepare('SELECT COALESCE(MAX(id), 0) AS max_id FROM sft_memory').get(),
            db2.prepare('SELECT COALESCE(MAX(id), 0) AS max_id FROM sft_feedback').get(),
        ]);
        baseline = {
            generation_log_max_id: glRow?.max_id || 0,
            sft_memory_max_id: sftRow?.max_id || 0,
            sft_feedback_max_id: fbRow?.max_id || 0,
        };
    }

    const payload = {
        launch_at: launchAt.toISOString(),
        created_at: now.toISOString(),
        note: 'Official metrics baseline for post-launch reporting',
        baseline_mode: baseline ? 'id_window' : 'time_window',
        baseline,
    };

    const abs = path.resolve(process.cwd(), OUTPUT_PATH);
    ensureDir(abs);
    fs.writeFileSync(abs, JSON.stringify(payload, null, 2) + '\n');

    console.log('[formal-launch-metrics] marker saved');
    console.log(`- file: ${OUTPUT_PATH}`);
    console.log(`- launch_at: ${payload.launch_at}`);
    console.log(`- baseline_mode: ${payload.baseline_mode}`);
    if (payload.baseline) {
        console.log(`- generation_log_max_id: ${payload.baseline.generation_log_max_id}`);
        console.log(`- sft_memory_max_id: ${payload.baseline.sft_memory_max_id}`);
        console.log(`- sft_feedback_max_id: ${payload.baseline.sft_feedback_max_id}`);
    } else {
        console.log('- baseline: null (future launch time, will use time window)');
    }

    await db.closeDb();
}

main().catch((err) => {
    console.error('[start-formal-launch-metrics] fatal:', err.message);
    db.closeDb().catch(() => {});
    process.exit(1);
});

