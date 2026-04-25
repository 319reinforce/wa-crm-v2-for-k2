#!/usr/bin/env node
require('dotenv').config();

const db = require('../db');
const {
  detectEventsWithMiniMax,
  parseEventMeta,
} = require('../server/services/eventVerificationService');
const {
  persistLifecycleForCreator,
} = require('../server/services/lifecyclePersistenceService');

const args = process.argv.slice(2);

function getArg(name, fallback = null) {
  const prefix = `${name}=`;
  const found = args.find((arg) => arg.startsWith(prefix));
  if (!found) return fallback;
  return found.slice(prefix.length);
}

function hasFlag(name) {
  return args.includes(name);
}

function toPositiveInt(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? Math.trunc(numeric) : fallback;
}

function toSqlDatetime(value = null) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeOwner(value) {
  const text = String(value || '').trim();
  if (/^yiyun$/i.test(text)) return 'Yiyun';
  if (/^beau$/i.test(text)) return 'Beau';
  return text || 'Beau';
}

function eventStatusForCandidate(candidate, { promoteTier2 = false } = {}) {
  const suggested = String(candidate?.suggested_status || 'draft').trim().toLowerCase();
  const allowed = new Set(['draft', 'active', 'completed', 'cancelled']);
  if (!allowed.has(suggested)) return 'draft';
  if (Number(candidate?.evidence_tier || 0) >= 3) return suggested;
  if (Number(candidate?.evidence_tier || 0) >= 2 && promoteTier2) return suggested;
  return 'draft';
}

function buildMeta(candidate, message, runId, status) {
  const base = parseEventMeta(candidate?.meta);
  return {
    ...base,
    source_anchor: candidate.source_anchor || {
      message_id: message.id,
      timestamp: message.timestamp,
      message_hash: message.message_hash || null,
    },
    backfill: {
      run_id: runId,
      source: 'backfill-minimax-events',
      source_message_id: Number(message.id),
      status_written: status,
    },
  };
}

async function hasBackfilledEvent(dbConn, creatorId, eventKey, messageId) {
  const rows = await dbConn.prepare(`
    SELECT id, meta
    FROM events
    WHERE creator_id = ?
      AND event_key = ?
      AND trigger_source = 'minimax_history'
    ORDER BY id DESC
    LIMIT 50
  `).all(creatorId, eventKey);
  return rows.some((row) => Number(parseEventMeta(row.meta)?.backfill?.source_message_id || 0) === Number(messageId));
}

async function insertCandidate(dbConn, creator, message, candidate, runId, options) {
  const status = eventStatusForCandidate(candidate, options);
  if (await hasBackfilledEvent(dbConn, creator.id, candidate.event_key, message.id)) {
    return { inserted: false, skipped: true, reason: 'duplicate_backfill' };
  }

  const meta = buildMeta(candidate, message, runId, status);
  const startAt = toSqlDatetime(Number(message.timestamp || 0));
  if (options.dryRun) {
    return { inserted: false, dryRun: true, status, meta };
  }

  const result = await dbConn.prepare(`
    INSERT INTO events (
      creator_id,
      event_key,
      event_type,
      owner,
      status,
      trigger_source,
      trigger_text,
      start_at,
      meta
    ) VALUES (?, ?, ?, ?, ?, 'minimax_history', ?, ?, ?)
  `).run(
    creator.id,
    candidate.event_key,
    candidate.event_type,
    normalizeOwner(creator.wa_owner),
    status,
    String(candidate.reason || candidate.trigger_text || message.text || '').slice(0, 500),
    startAt,
    JSON.stringify(meta),
  );
  return { inserted: true, id: result.lastInsertRowid, status };
}

async function fetchCreators(dbConn, options) {
  const params = [];
  let where = 'WHERE c.wa_phone IS NOT NULL';
  if (options.creatorId) {
    where += ' AND c.id = ?';
    params.push(options.creatorId);
  }
  if (options.owner) {
    where += ' AND c.wa_owner = ?';
    params.push(options.owner);
  }
  const limitSql = options.creatorLimit > 0 ? ` LIMIT ${options.creatorLimit}` : '';
  return dbConn.prepare(`
    SELECT c.id, c.primary_name, c.wa_phone, c.wa_owner, COUNT(wm.id) AS message_count
    FROM creators c
    JOIN wa_messages wm ON wm.creator_id = c.id
    ${where}
    GROUP BY c.id
    ORDER BY c.id ASC
    ${limitSql}
  `).all(...params);
}

async function fetchMessages(dbConn, creatorId, options) {
  const params = [creatorId];
  let where = 'WHERE creator_id = ? AND text IS NOT NULL AND TRIM(text) <> ""';
  if (options.sinceMs) {
    where += ' AND timestamp >= ?';
    params.push(options.sinceMs);
  }
  const limitSql = options.messageLimit > 0 ? ` LIMIT ${options.messageLimit}` : '';
  return dbConn.prepare(`
    SELECT id, creator_id, role, text, timestamp, message_hash
    FROM wa_messages
    ${where}
    ORDER BY timestamp ASC, id ASC
    ${limitSql}
  `).all(...params);
}

async function main() {
  if (!process.env.MINIMAX_API_KEY) {
    throw new Error('MINIMAX_API_KEY is not set');
  }

  const options = {
    dryRun: !hasFlag('--write'),
    planOnly: hasFlag('--plan-only'),
    rebuildLifecycle: hasFlag('--rebuild-lifecycle'),
    promoteTier2: hasFlag('--promote-tier2'),
    creatorId: toPositiveInt(getArg('--creator'), null),
    owner: getArg('--owner', null),
    creatorLimit: toPositiveInt(getArg('--creator-limit'), hasFlag('--all') ? 0 : 10),
    messageLimit: toPositiveInt(getArg('--message-limit-per-creator'), hasFlag('--all') ? 0 : 80),
    sleepMs: toPositiveInt(getArg('--sleep-ms'), 250),
    sinceMs: getArg('--since') ? new Date(getArg('--since')).getTime() : null,
  };
  if (options.sinceMs && Number.isNaN(options.sinceMs)) {
    throw new Error('--since must be a valid date');
  }

  const dbConn = db.getDb();
  const runId = `minimax_history_${new Date().toISOString().replace(/[:.]/g, '-')}`;
  const stats = {
    creators: 0,
    messages: 0,
    detections: 0,
    inserted: 0,
    skipped: 0,
    errors: 0,
    lifecycleRebuilt: 0,
  };
  const touchedCreators = new Set();

  console.log('=== MiniMax historical event backfill ===');
  console.log(`mode: ${options.dryRun ? 'dry-run' : 'write'}`);
  console.log(`plan_only: ${options.planOnly ? 'yes' : 'no'}`);
  console.log(`creator_limit: ${options.creatorLimit || 'all'}`);
  console.log(`message_limit_per_creator: ${options.messageLimit || 'all'}`);
  console.log(`rebuild_lifecycle: ${options.rebuildLifecycle ? 'yes' : 'no'}`);

  const creators = await fetchCreators(dbConn, options);
  for (const creator of creators) {
    stats.creators += 1;
    const owner = normalizeOwner(creator.wa_owner);
    const messages = await fetchMessages(dbConn, creator.id, options);
    console.log(`[creator ${creator.id}] ${creator.primary_name || '-'} owner=${owner} messages=${messages.length}`);
    if (options.planOnly) {
      stats.messages += messages.length;
      continue;
    }

    for (const message of messages) {
      stats.messages += 1;
      try {
        const ret = await detectEventsWithMiniMax({
          dbConn,
          creatorId: Number(creator.id),
          owner,
          text: message.text,
          sourceAnchor: {
            message_id: message.id,
            timestamp: message.timestamp,
            message_hash: message.message_hash || null,
          },
          contextWindow: { before: 5, after: 4 },
        });
        const candidates = ret.normalized.detected || [];
        stats.detections += candidates.length;
        for (const candidate of candidates) {
          const writeResult = await insertCandidate(dbConn, creator, message, candidate, runId, options);
          if (writeResult.inserted || writeResult.dryRun) {
            stats.inserted += 1;
            touchedCreators.add(Number(creator.id));
            console.log(`  ${options.dryRun ? '[dry]' : '[+]'} msg=${message.id} ${candidate.event_key} tier=${candidate.evidence_tier} status=${writeResult.status}`);
          } else {
            stats.skipped += 1;
          }
        }
        if (options.sleepMs > 0) await sleep(options.sleepMs);
      } catch (err) {
        stats.errors += 1;
        console.log(`  [error] msg=${message.id} ${err.message}`);
      }
    }
  }

  if (!options.dryRun && options.rebuildLifecycle && touchedCreators.size > 0) {
    for (const creatorId of touchedCreators) {
      const ret = await persistLifecycleForCreator(dbConn, creatorId, {
        triggerType: 'minimax_history_backfill',
        triggerId: runId,
        triggerSource: 'backfill-minimax-events',
        operator: 'system',
        writeSnapshot: true,
        writeTransition: true,
      });
      if (ret) stats.lifecycleRebuilt += 1;
    }
  }

  console.log('\n=== Summary ===');
  Object.entries(stats).forEach(([key, value]) => console.log(`${key}: ${value}`));
  console.log(`run_id: ${runId}`);
  await db.closeDb();
}

main().catch(async (err) => {
  console.error(err.message);
  await db.closeDb().catch(() => {});
  process.exitCode = 1;
});
