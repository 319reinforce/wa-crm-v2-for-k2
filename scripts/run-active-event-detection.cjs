#!/usr/bin/env node
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const db = require('../db');
const {
  ensureActiveEventDetectionSchema,
  enqueueCreatorEventDetection,
  enqueueCreatorsWithNewMessages,
  processCreatorEventDetection,
  processPendingEventDetections,
} = require('../server/services/activeEventDetectionService');

const args = process.argv.slice(2);

function hasFlag(name) {
  return args.includes(name);
}

function getArg(name, fallback = null) {
  const prefix = `${name}=`;
  const found = args.find((arg) => arg.startsWith(prefix));
  if (!found) return fallback;
  return found.slice(prefix.length);
}

function toPositiveInt(value, fallback = null) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? Math.trunc(numeric) : fallback;
}

function toTimestampMs(value = null) {
  if (!value) return null;
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) return numeric > 1e12 ? Math.floor(numeric) : Math.floor(numeric * 1000);
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

async function findCreatorIdsByName(dbConn, name) {
  const q = String(name || '').trim();
  if (!q) return [];
  return dbConn.prepare(`
    SELECT id, primary_name, wa_owner
    FROM creators
    WHERE primary_name LIKE ?
    ORDER BY id ASC
    LIMIT 10
  `).all(`%${q}%`);
}

async function main() {
  const dbConn = db.getDb();
  await ensureActiveEventDetectionSchema(dbConn);

  const options = {
    write: hasFlag('--write'),
    advanceCursor: hasFlag('--advance-cursor') || hasFlag('--write'),
    provider: getArg('--provider', 'keyword'),
    limit: toPositiveInt(getArg('--limit'), 10),
    messageLimit: toPositiveInt(getArg('--message-limit'), 80),
    owner: getArg('--owner', null),
    creatorId: toPositiveInt(getArg('--creator'), null),
    creatorName: getArg('--creator-name', null),
    sinceTimestamp: toTimestampMs(getArg('--since', null)),
    reason: getArg('--reason', 'manual_active_detection'),
    enqueueNew: hasFlag('--enqueue-new'),
    processPending: hasFlag('--process-pending'),
    output: getArg('--output', path.join('reports', `active-event-detection-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}.json`)),
  };

  if ((options.provider === 'minimax' || options.provider === 'llm') && !process.env.MINIMAX_API_KEY) {
    throw new Error('MINIMAX_API_KEY is required for --provider=minimax');
  }

  const enqueues = [];
  const results = [];
  let creatorRows = [];
  if (options.creatorId) {
    creatorRows = [{ id: options.creatorId }];
  } else if (options.creatorName) {
    creatorRows = await findCreatorIdsByName(dbConn, options.creatorName);
  }

  if (options.enqueueNew) {
    enqueues.push(await enqueueCreatorsWithNewMessages(dbConn, {
      owner: options.owner,
      creatorId: options.creatorId,
      limit: options.limit,
      reason: options.reason,
      sinceTimestamp: options.sinceTimestamp,
    }));
  }

  for (const creator of creatorRows) {
    if (options.write || options.advanceCursor || hasFlag('--enqueue')) {
      const enqueue = await enqueueCreatorEventDetection(dbConn, {
        creatorId: creator.id,
        reason: options.reason,
        fromTimestamp: options.sinceTimestamp,
      });
      enqueues.push(enqueue);
    }
    results.push(await processCreatorEventDetection(dbConn, creator.id, options));
  }

  if (options.processPending || (creatorRows.length === 0 && !options.enqueueNew)) {
    results.push(...await processPendingEventDetections(dbConn, options));
  }

  const report = {
    generated_at: new Date().toISOString(),
    mode: options.write ? 'write' : 'dry_run',
    provider: options.provider,
    options,
    enqueues,
    results,
  };
  fs.mkdirSync(path.dirname(options.output), { recursive: true });
  fs.writeFileSync(options.output, `${JSON.stringify(report, null, 2)}\n`);

  console.log(JSON.stringify({
    mode: report.mode,
    provider: report.provider,
    advance_cursor: options.advanceCursor,
    enqueued_groups: enqueues.length,
    processed_creators: results.length,
    scanned_messages: results.reduce((sum, item) => sum + Number(item.scanned_messages || 0), 0),
    candidates: results.reduce((sum, item) => sum + Number(item.candidate_count || 0), 0),
    written: results.reduce((sum, item) => sum + Number(item.written_count || 0), 0),
    errors: results.reduce((sum, item) => sum + Number(item.error_count || 0), 0),
    output: options.output,
  }, null, 2));

  await db.closeDb();
}

main().catch(async (err) => {
  console.error(err);
  await db.closeDb().catch(() => {});
  process.exit(1);
});
