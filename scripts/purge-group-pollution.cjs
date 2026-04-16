#!/usr/bin/env node
require('dotenv').config();

const db = require('../db');
const { purgeCreatorMessagesMatchingGroups } = require('../server/services/groupMessageService');

function parsePositiveInt(value, fallback = null) {
  const n = Number.parseInt(value, 10);
  if (!Number.isInteger(n) || n <= 0) return fallback;
  return n;
}

function isDestructivePurgeAllowed(env = process.env) {
  return env.SMOKE_PURGE_GROUP_POLLUTION === '1'
    || env.GROUP_POLLUTION_PURGE_CONFIRM === '1';
}

async function main() {
  if (!isDestructivePurgeAllowed(process.env)) {
    console.error('[purge-group-pollution] destructive purge is disabled by default; set SMOKE_PURGE_GROUP_POLLUTION=1 or GROUP_POLLUTION_PURGE_CONFIRM=1 to continue');
    process.exit(2);
  }

  const db2 = db.getDb();
  const targetCreatorId = parsePositiveInt(process.env.GROUP_POLLUTION_CREATOR_ID, null);
  const targetOperator = String(process.env.GROUP_POLLUTION_OPERATOR || '').trim();

  const where = [];
  const params = [];
  if (targetCreatorId) {
    where.push('creator_id = ?');
    params.push(targetCreatorId);
  }
  if (targetOperator) {
    where.push('operator = ?');
    params.push(targetOperator);
  }

  const pairs = await db2.prepare(`
    SELECT DISTINCT creator_id, operator
    FROM wa_messages
    WHERE operator IS NOT NULL
      AND TRIM(operator) <> ''
      ${where.length > 0 ? `AND ${where.join(' AND ')}` : ''}
    ORDER BY creator_id ASC, operator ASC
  `).all(...params);

  let purgedTotal = 0;
  const changedPairs = [];

  for (const pair of pairs) {
    const creatorId = Number.parseInt(pair.creator_id, 10);
    const operator = String(pair.operator || '').trim();
    if (!Number.isInteger(creatorId) || creatorId <= 0 || !operator) continue;

    const purged = await purgeCreatorMessagesMatchingGroups(db2, {
      creatorId,
      operator,
    });
    if (!purged) continue;

    purgedTotal += Number(purged || 0);
    changedPairs.push({
      creator_id: creatorId,
      operator,
      purged,
    });
  }

  const summary = {
    pairs_checked: pairs.length,
    pairs_changed: changedPairs.length,
    purged_total: purgedTotal,
    changed_samples: changedPairs.slice(0, 20),
  };
  console.log(JSON.stringify(summary, null, 2));

  await db.closeDb();
}

module.exports = {
  main,
  _private: {
    isDestructivePurgeAllowed,
    parsePositiveInt,
  },
};

if (require.main === module) {
  main().catch(async (error) => {
    console.error('[purge-group-pollution] failed:', error.message);
    try {
      await db.closeDb();
    } catch (_) {}
    process.exit(1);
  });
}
