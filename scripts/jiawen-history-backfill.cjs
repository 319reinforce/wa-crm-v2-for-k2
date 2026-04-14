#!/usr/bin/env node
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { getDb, closeDb } = require('../db');
const { createSessionCommand, waitForSessionCommandResult } = require('../server/services/waIpc');
const { reconcileCreatorMessagesFromRaw } = require('../server/services/waMessageRepairService');

const SESSION_ID = 'jiawen';
const OPERATOR = 'Jiawen';
const DEFAULT_FETCH_LIMIT = 500;
const DEFAULT_BATCH_SIZE = 10;

function parseArgs(argv) {
  const out = {
    dryRun: false,
    fetchLimit: DEFAULT_FETCH_LIMIT,
    batchSize: DEFAULT_BATCH_SIZE,
    cursor: 0,
    maxBatches: 0,
  };
  for (const arg of argv) {
    if (arg === '--dry-run') out.dryRun = true;
    if (arg.startsWith('--fetch-limit=')) out.fetchLimit = Math.max(100, parseInt(arg.slice('--fetch-limit='.length), 10) || DEFAULT_FETCH_LIMIT);
    if (arg.startsWith('--batch-size=')) out.batchSize = Math.max(1, parseInt(arg.slice('--batch-size='.length), 10) || DEFAULT_BATCH_SIZE);
    if (arg.startsWith('--cursor=')) out.cursor = Math.max(0, parseInt(arg.slice('--cursor='.length), 10) || 0);
    if (arg.startsWith('--max-batches=')) out.maxBatches = Math.max(0, parseInt(arg.slice('--max-batches='.length), 10) || 0);
  }
  return out;
}

function ensureDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function toIsoForName(value = new Date()) {
  return value.toISOString().replace(/[:.]/g, '-');
}

async function fetchCreators(db) {
  return await db.prepare(`
    SELECT c.id, c.primary_name, c.wa_phone, c.wa_owner,
           MAX(m.timestamp) AS last_message_ts
    FROM creators c
    LEFT JOIN wa_messages m ON m.creator_id = c.id
    WHERE c.wa_owner = ?
      AND c.is_active = 1
      AND c.wa_phone IS NOT NULL
      AND c.wa_phone <> '0'
    GROUP BY c.id, c.primary_name, c.wa_phone, c.wa_owner
    ORDER BY COALESCE(MAX(m.timestamp), UNIX_TIMESTAMP(c.updated_at) * 1000, UNIX_TIMESTAMP(c.created_at) * 1000) ASC, c.id ASC
  `).all(OPERATOR);
}

async function fetchRawMessages(phone, limit) {
  const commandId = createSessionCommand(SESSION_ID, {
    type: 'audit_recent_messages',
    payload: { phone, limit },
  });
  return await waitForSessionCommandResult(SESSION_ID, commandId, 60000);
}

async function reconcileCreator(db, creator, rawMessages, { dryRun }) {
  return await reconcileCreatorMessagesFromRaw({
    creatorId: creator.id,
    creatorName: creator.primary_name,
    operator: OPERATOR,
    rawMessages,
    fullDedup: true,
    dryRun,
  });
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const db = getDb();
  const creators = await fetchCreators(db);
  const report = {
    generated_at: new Date().toISOString(),
    operator: OPERATOR,
    session_id: SESSION_ID,
    fetch_limit: options.fetchLimit,
    batch_size: options.batchSize,
    dry_run: options.dryRun,
    total_creators: creators.length,
    results: [],
  };

  let cursor = Math.min(options.cursor, creators.length);
  let batchCount = 0;
  while (cursor < creators.length) {
    const batch = creators.slice(cursor, cursor + options.batchSize);
    for (const creator of batch) {
      const rawResult = await fetchRawMessages(creator.wa_phone, options.fetchLimit);
      if (!rawResult?.ok) {
        report.results.push({
          creator_id: creator.id,
          creator_name: creator.primary_name,
          checked_messages: 0,
          inserted_count: 0,
          updated_count: 0,
          deleted_count: 0,
          error: rawResult?.error || 'audit_failed',
        });
        continue;
      }
      const summary = await reconcileCreator(db, creator, rawResult.messages, { dryRun: options.dryRun });
      report.results.push(summary);
    }

    cursor += options.batchSize;
    batchCount += 1;
    if (options.maxBatches > 0 && batchCount >= options.maxBatches) break;
  }

  report.summary = report.results.reduce((acc, item) => {
    acc.checked += item.checked_messages || 0;
    acc.inserted += item.inserted_count || 0;
    acc.updated += item.updated_count || 0;
    acc.deleted += item.deleted_count || 0;
    acc.errors += item.error ? 1 : 0;
    return acc;
  }, { checked: 0, inserted: 0, updated: 0, deleted: 0, errors: 0 });

  const reportPath = path.resolve(process.cwd(), 'reports', 'jiawen-history-backfill', `${toIsoForName()}.json`);
  ensureDir(reportPath);
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');

  console.log('[jiawen-history-backfill] summary=', report.summary);
  console.log('[jiawen-history-backfill] report_path=', reportPath);

  await closeDb();
}

main().catch(async (error) => {
  console.error('[jiawen-history-backfill] fatal:', error.message);
  await closeDb();
  process.exit(1);
});
