#!/usr/bin/env node
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { getDb, closeDb } = require('../db');
const { createSessionCommand, waitForSessionCommandResult } = require('../server/services/waIpc');
const { reconcileCreatorMessagesFromRaw } = require('../server/services/waMessageRepairService');

const SESSION_ID = 'beau';
const OPERATOR = 'Beau';
const BATCH_SIZE = 5;
const FETCH_LIMIT = 120;
const REPORT_ROOT = path.resolve(process.cwd(), 'reports', 'beau-nightly-role-heartbeat');
const STATE_PATH = path.resolve(process.cwd(), 'docs', 'wa', 'beau-nightly-role-heartbeat-state.json');

function parseArgs(argv) {
    const out = {
        dryRun: false,
        notify: true,
        batchSize: BATCH_SIZE,
        fetchLimit: FETCH_LIMIT,
    };
    for (const arg of argv) {
        if (arg ***REMOVED***= '--dry-run') out.dryRun = true;
        if (arg ***REMOVED***= '--no-notify') out.notify = false;
        if (arg.startsWith('--batch-size=')) out.batchSize = Math.max(1, parseInt(arg.slice('--batch-size='.length), 10) || BATCH_SIZE);
        if (arg.startsWith('--fetch-limit=')) out.fetchLimit = Math.max(20, parseInt(arg.slice('--fetch-limit='.length), 10) || FETCH_LIMIT);
    }
    return out;
}

function ensureDir(filePath) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function readJsonSafe(filePath, fallback) {
    try {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (_) {
        return fallback;
    }
}

function writeJson(filePath, payload) {
    ensureDir(filePath);
    fs.writeFileSync(filePath, JSON.stringify(payload, null, 2) + '\n');
}

function toIsoForName(value = new Date()) {
    return value.toISOString().replace(/[:.]/g, '-');
}

function toShanghaiDateTime(date = new Date()) {
    return new Intl.DateTimeFormat('zh-CN', {
        timeZone: 'Asia/Shanghai',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
    }).format(date).replace(/\//g, '-');
}

async function fetchBatchCreators(db, cursor, batchSize) {
    const rows = await db.prepare(`
        SELECT c.id, c.primary_name, c.wa_phone, c.wa_owner, c.updated_at, c.created_at,
               MAX(m.timestamp) AS last_message_ts
        FROM creators c
        LEFT JOIN wa_messages m ON m.creator_id = c.id
        WHERE c.wa_owner = ?
          AND c.is_active = 1
          AND c.wa_phone IS NOT NULL
          AND c.wa_phone <> '0'
        GROUP BY c.id, c.primary_name, c.wa_phone, c.wa_owner, c.updated_at, c.created_at
        ORDER BY COALESCE(MAX(m.timestamp), UNIX_TIMESTAMP(c.updated_at) * 1000, UNIX_TIMESTAMP(c.created_at) * 1000) DESC, c.id ASC
    `).all(OPERATOR);
    if (rows.length ***REMOVED***= 0) return { creators: [], nextCursor: 0, total: 0 };

    const safeCursor = Number.isInteger(cursor) && cursor >= 0 ? cursor % rows.length : 0;
    const creators = [];
    for (let i = 0; i < Math.min(batchSize, rows.length); i += 1) {
        creators.push(rows[(safeCursor + i) % rows.length]);
    }
    return {
        creators,
        nextCursor: (safeCursor + creators.length) % rows.length,
        total: rows.length,
    };
}

async function fetchRawMessagesForCreator(creator, limit) {
    const commandId = createSessionCommand(SESSION_ID, {
        type: 'audit_recent_messages',
        payload: {
            phone: creator.wa_phone,
            limit,
        },
    });
    return await waitForSessionCommandResult(SESSION_ID, commandId, 30000);
}

async function reconcileCreator(db, creator, rawMessages, { dryRun }) {
    return await reconcileCreatorMessagesFromRaw({
        creatorId: creator.id,
        creatorName: creator.primary_name,
        operator: OPERATOR,
        rawMessages,
        dryRun,
    });
}

function runCommand(command, args) {
    return spawnSync(command, args, {
        cwd: process.cwd(),
        env: process.env,
        encoding: 'utf8',
    });
}

function sendReportToReinforce(report) {
    const search = runCommand('lark-cli', ['im', '+chat-search', '--as', 'user', '--query', 'reinforce', '--format', 'json']);
    if (search.status !***REMOVED*** 0) {
        throw new Error(search.stderr || search.stdout || 'chat search failed');
    }
    const parsed = JSON.parse(search.stdout || '{}');
    const chats = Array.isArray(parsed?.data?.chats)
        ? parsed.data.chats
        : (Array.isArray(parsed?.items) ? parsed.items : (Array.isArray(parsed) ? parsed : []));
    const chat = chats[0];
    if (!chat?.chat_id) {
        throw new Error('Reinforce chat not found');
    }

    const markdown = [
        `# 审查结果｜Beau 夜间聊天 role/context 心跳`,
        `日期：${toShanghaiDateTime(new Date())}`,
        '',
        `- 批次：${report.batch.batch_index}/${report.batch.total_batches_estimate}`,
        `- 本轮达人：${report.batch.creators.length} 人`,
        `- role 修正：${report.summary.updated_total}`,
        `- 补齐消息：${report.summary.inserted_total}`,
        '',
        '## 本轮明细',
        ...report.results.map((item) => (
            `- ${item.creator_name}（${item.creator_id}）：检查 ${item.checked_messages} 条，修正 ${item.updated_count}，补齐 ${item.inserted_count}`
        )),
        '',
        `报告文件：${report.report_path}`,
    ].join('\n');

    const send = runCommand('lark-cli', [
        'im',
        '+messages-send',
        '--as',
        'bot',
        '--chat-id',
        chat.chat_id,
        '--markdown',
        markdown,
    ]);
    if (send.status !***REMOVED*** 0) {
        throw new Error(send.stderr || send.stdout || 'message send failed');
    }
    return send.stdout.trim();
}

async function main() {
    const options = parseArgs(process.argv.slice(2));
    const db = getDb();
    const state = readJsonSafe(STATE_PATH, {
        cursor: 0,
        runs: 0,
    });

    const batch = await fetchBatchCreators(db, state.cursor, options.batchSize);
    const batchIndex = Math.floor((state.cursor || 0) / Math.max(1, options.batchSize)) + 1;
    const totalBatchesEstimate = Math.max(1, Math.ceil(batch.total / Math.max(1, options.batchSize)));
    const results = [];

    for (const creator of batch.creators) {
        const rawResult = await fetchRawMessagesForCreator(creator, options.fetchLimit);
        if (!rawResult?.ok) {
            results.push({
                creator_id: creator.id,
                creator_name: creator.primary_name,
                checked_messages: 0,
                inserted_count: 0,
                updated_count: 0,
                inserted_samples: [],
                updated_samples: [],
                error: rawResult?.error || 'audit failed',
            });
            continue;
        }
        const item = await reconcileCreator(db, creator, rawResult.messages, { dryRun: options.dryRun });
        results.push(item);
    }

    const summary = {
        inserted_total: results.reduce((sum, item) => sum + (item.inserted_count || 0), 0),
        updated_total: results.reduce((sum, item) => sum + (item.updated_count || 0), 0),
        deleted_total: results.reduce((sum, item) => sum + (item.deleted_count || 0), 0),
        error_count: results.filter((item) => item.error).length,
    };

    const reportDir = path.join(REPORT_ROOT, toIsoForName());
    fs.mkdirSync(reportDir, { recursive: true });
    const report = {
        generated_at: new Date().toISOString(),
        dry_run: options.dryRun,
        batch: {
            session_id: SESSION_ID,
            operator: OPERATOR,
            batch_size: options.batchSize,
            fetch_limit: options.fetchLimit,
            batch_index: batchIndex,
            total_batches_estimate: totalBatchesEstimate,
            creators: batch.creators.map((creator) => ({
                id: creator.id,
                primary_name: creator.primary_name,
                wa_phone: creator.wa_phone,
            })),
        },
        summary,
        results,
        report_path: reportDir,
    };

    const reportPath = path.join(reportDir, 'summary.json');
    writeJson(reportPath, report);

    const nextState = {
        cursor: batch.nextCursor,
        runs: Number(state.runs || 0) + 1,
        last_run_at: report.generated_at,
        last_report_path: reportPath,
    };
    writeJson(STATE_PATH, nextState);

    let notifyResult = null;
    if (!options.dryRun && options.notify) {
        try {
            notifyResult = sendReportToReinforce(report);
        } catch (error) {
            notifyResult = `notify_failed: ${error.message}`;
        }
    }

    console.log(JSON.stringify({
        reportPath,
        statePath: STATE_PATH,
        summary,
        notifyResult,
    }, null, 2));
}

main()
    .catch((error) => {
        console.error('[beau-nightly-role-heartbeat] failed:', error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await closeDb().catch(() => {});
    });
