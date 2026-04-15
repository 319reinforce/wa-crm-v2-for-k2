#!/usr/bin/env node

const db = require('../db');
const { mergeDuplicateCreatorIntoCanonical } = require('../server/services/creatorMergeService');
const { persistLifecycleForCreator } = require('../server/services/lifecyclePersistenceService');
const { rebuildReplyStrategyForCreator } = require('../server/services/replyStrategyService');

function readArg(flag, fallback = null) {
  const idx = process.argv.indexOf(flag);
  if (idx === -1) return fallback;
  const value = process.argv[idx + 1];
  if (value == null || value.startsWith('--')) return fallback;
  return value;
}

function hasFlag(flag) {
  return process.argv.includes(flag);
}

async function main() {
  const sourceCreatorId = Number(readArg('--source', '265'));
  const targetCreatorId = Number(readArg('--target', '1037'));
  const reason = String(readArg('--reason', 'duplicate_cleanup') || 'duplicate_cleanup').trim();
  const operator = String(readArg('--operator', process.env.USER || 'codex') || 'codex').trim();
  const allowDistinctPhones = !hasFlag('--strict-phones');

  if (!Number.isFinite(sourceCreatorId) || sourceCreatorId <= 0) {
    throw new Error(`invalid --source ${JSON.stringify(readArg('--source'))}`);
  }
  if (!Number.isFinite(targetCreatorId) || targetCreatorId <= 0) {
    throw new Error(`invalid --target ${JSON.stringify(readArg('--target'))}`);
  }
  if (sourceCreatorId === targetCreatorId) {
    throw new Error('--source and --target must be different');
  }

  const merged = await mergeDuplicateCreatorIntoCanonical({
    sourceCreatorId,
    targetCreatorId,
    reason,
    operator,
    allowDistinctPhones,
  });
  if (!merged?.merged) {
    throw new Error(`merge skipped: ${JSON.stringify(merged)}`);
  }

  const conn = db.getDb();
  const lifecycleRet = await persistLifecycleForCreator(conn, targetCreatorId, {
    triggerType: 'duplicate_merge',
    triggerId: `${sourceCreatorId}->${targetCreatorId}`,
    triggerSource: 'duplicate_cleanup_script',
    operator,
  });
  const strategyRet = await rebuildReplyStrategyForCreator({
    creatorId: targetCreatorId,
    trigger: 'duplicate_merge',
    force: true,
    allowSoftAdjust: true,
  });
  const source = await conn.prepare('SELECT id, primary_name, wa_phone FROM creators WHERE id = ? LIMIT 1').get(sourceCreatorId);
  const target = await conn.prepare('SELECT id, primary_name, wa_phone, wa_owner FROM creators WHERE id = ? LIMIT 1').get(targetCreatorId);

  console.log(JSON.stringify({
    ok: true,
    merged,
    lifecycle: lifecycleRet ? {
      stage_key: lifecycleRet.lifecycle?.stage_key || null,
      lifecycle_changed: lifecycleRet.lifecycleChanged || false,
    } : null,
    strategy: strategyRet,
    source_exists: !!source,
    target,
  }, null, 2));
}

main()
  .catch((err) => {
    console.error('[merge-creator-duplicate] FAIL:', err.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await db.closeDb();
    } catch (_) {}
  });
