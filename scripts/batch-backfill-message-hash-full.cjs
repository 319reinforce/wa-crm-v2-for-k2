#!/usr/bin/env node
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { getDb, closeDb } = require('../db');

const DEFAULT_OWNERS = ['Beau', 'Jiawen', 'Yiyun'];
const DEFAULT_BATCH_LIMIT = 2000;

function parseArgs(argv) {
  const out = {
    apply: false,
    owners: DEFAULT_OWNERS,
    batchLimit: DEFAULT_BATCH_LIMIT,
  };
  for (const arg of argv) {
    if (arg === '--apply') out.apply = true;
    if (arg.startsWith('--owners=')) {
      const raw = arg.slice('--owners='.length);
      out.owners = raw.split(',').map((v) => v.trim()).filter(Boolean);
    }
    if (arg.startsWith('--batch-limit=')) {
      out.batchLimit = Math.max(100, parseInt(arg.slice('--batch-limit='.length), 10) || DEFAULT_BATCH_LIMIT);
    }
  }
  return out;
}

function buildMessageHash(role, text, timestamp) {
  return crypto
    .createHash('sha256')
    .update(`${role || ''}|${text || ''}|${timestamp || ''}`)
    .digest('hex');
}

function ensureDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function toIsoForName(value = new Date()) {
  return value.toISOString().replace(/[:.]/g, '-');
}

async function fetchCreatorsWithNullHash(db, owner) {
  return await db.prepare(`
    SELECT c.id, c.primary_name
    FROM creators c
    JOIN wa_messages m ON m.creator_id = c.id
    WHERE c.wa_owner = ?
      AND m.message_hash IS NULL
    GROUP BY c.id, c.primary_name
    ORDER BY c.id ASC
  `).all(owner);
}

async function countDuplicatesExact(db, creatorId) {
  const row = await db.prepare(`
    SELECT COALESCE(SUM(cnt - 1), 0) AS dupes
    FROM (
      SELECT COUNT(*) AS cnt
      FROM wa_messages
      WHERE creator_id = ?
      GROUP BY role, text, timestamp
      HAVING cnt > 1
    ) t
  `).get(creatorId);
  return Number(row?.dupes) || 0;
}

async function deleteExactDuplicates(db, creatorId) {
  const result = await db.prepare(`
    DELETE m1 FROM wa_messages m1
    JOIN wa_messages m2
      ON m1.creator_id = m2.creator_id
     AND m1.role = m2.role
     AND m1.text = m2.text
     AND m1.timestamp = m2.timestamp
     AND m1.id > m2.id
    WHERE m1.creator_id = ?
  `).run(creatorId);
  return Number(result?.changes || 0);
}

async function backfillHashes(db, creatorId, batchLimit) {
  let updated = 0;
  let deleted = 0;
  const safeLimit = Number.isFinite(batchLimit) ? Math.max(100, Math.floor(batchLimit)) : DEFAULT_BATCH_LIMIT;
  const selectSql = `
    SELECT id, role, text, timestamp
    FROM wa_messages
    WHERE creator_id = ?
      AND message_hash IS NULL
    ORDER BY id ASC
    LIMIT ${safeLimit}
  `;
  const selectStmt = db.prepare(selectSql);
  const updateStmt = db.prepare('UPDATE wa_messages SET message_hash = ? WHERE id = ?');
  const deleteStmt = db.prepare('DELETE FROM wa_messages WHERE id = ?');

  while (true) {
    const rows = await selectStmt.all(creatorId);
    if (!rows.length) break;
    for (const row of rows) {
      const hash = buildMessageHash(row.role, row.text, row.timestamp);
      try {
        const res = await updateStmt.run(hash, row.id);
        if (res?.changes) updated += res.changes;
      } catch (_) {
        const res = await deleteStmt.run(row.id);
        if (res?.changes) deleted += res.changes;
      }
    }
    if (rows.length < batchLimit) break;
  }

  return { updated, deleted };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const db = getDb();
  const report = {
    generated_at: new Date().toISOString(),
    apply: options.apply,
    owners: options.owners,
    batch_limit: options.batchLimit,
    results: [],
  };

  console.log('[batch-backfill-message-hash-full] options=', {
    apply: options.apply,
    owners: options.owners,
    batch_limit: options.batchLimit,
  });

  for (const owner of options.owners) {
    const creators = await fetchCreatorsWithNullHash(db, owner);
    for (const creator of creators) {
      const dupCount = await countDuplicatesExact(db, creator.id);
      let deleted = 0;
      let hashBackfill = { updated: 0, deleted: 0 };

      if (options.apply) {
        deleted = await deleteExactDuplicates(db, creator.id);
        hashBackfill = await backfillHashes(db, creator.id, options.batchLimit);
      }

      const result = {
        owner,
        creator_id: creator.id,
        creator_name: creator.primary_name,
        duplicate_count: dupCount,
        deleted_duplicates: deleted,
        hash_backfill: hashBackfill,
      };
      report.results.push(result);

      console.log('[batch-backfill-message-hash-full] processed', result);
    }
  }

  report.summary = report.results.reduce((acc, item) => {
    acc.creators += 1;
    acc.duplicates += item.duplicate_count || 0;
    acc.deleted_duplicates += item.deleted_duplicates || 0;
    acc.hash_updated += item.hash_backfill?.updated || 0;
    acc.hash_deleted += item.hash_backfill?.deleted || 0;
    return acc;
  }, {
    creators: 0,
    duplicates: 0,
    deleted_duplicates: 0,
    hash_updated: 0,
    hash_deleted: 0,
  });

  const reportPath = path.resolve(process.cwd(), 'reports', 'message-hash-backfill-full', `${toIsoForName()}.json`);
  ensureDir(reportPath);
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');

  console.log('[batch-backfill-message-hash-full] summary=', report.summary);
  console.log('[batch-backfill-message-hash-full] report_path=', reportPath);

  await closeDb();
}

main().catch(async (error) => {
  console.error('[batch-backfill-message-hash-full] fatal:', error.message);
  await closeDb();
  process.exit(1);
});
