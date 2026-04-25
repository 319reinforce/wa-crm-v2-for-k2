#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const db = require('../db');
const {
  rebuildCreatorEventSnapshot,
} = require('../server/services/creatorEventSnapshotService');
const {
  persistLifecycleForCreator,
} = require('../server/services/lifecyclePersistenceService');
const {
  rebuildReplyStrategyForCreator,
} = require('../server/services/replyStrategyService');

function hasFlag(name) {
  return process.argv.includes(name);
}

async function main() {
  const write = hasFlag('--write');
  const dbConn = db.getDb();

  const summary = await dbConn.prepare(`
    SELECT e.source_kind, e.review_state, e.lifecycle_effect, e.event_key, e.status,
           COUNT(DISTINCT e.id) AS total,
           SUM(CASE WHEN ee.source_message_id IS NOT NULL THEN 1 ELSE 0 END) AS with_message_anchor,
           SUM(CASE WHEN ee.source_quote IS NOT NULL AND TRIM(ee.source_quote) <> '' THEN 1 ELSE 0 END) AS with_quote
    FROM events e
    LEFT JOIN event_evidence ee ON ee.event_id = e.id
    WHERE COALESCE(e.evidence_tier, 0) >= 2
    GROUP BY e.source_kind, e.review_state, e.lifecycle_effect, e.event_key, e.status
    ORDER BY e.source_kind, e.event_key, e.status
  `).all();

  const downgradeRows = await dbConn.prepare(`
    SELECT e.id, e.creator_id, e.event_key, e.status, e.trigger_source, e.trigger_text,
           e.source_kind, e.review_state, e.evidence_tier, e.lifecycle_effect
    FROM events e
    LEFT JOIN event_evidence ee ON ee.event_id = e.id
    WHERE COALESCE(e.evidence_tier, 0) >= 2
      AND e.source_kind = 'migration'
      AND COALESCE(e.review_state, 'unreviewed') = 'unreviewed'
      AND e.trigger_source = 'v1_import'
      AND e.event_key = 'agency_bound'
      AND COALESCE(e.trigger_text, '') = 'legacy agency binding'
      AND ee.source_message_id IS NULL
    GROUP BY e.id
    ORDER BY e.id ASC
  `).all();

  const affectedCreatorIds = [...new Set(downgradeRows.map((row) => Number(row.creator_id)).filter(Boolean))];
  let downgraded = 0;
  let snapshotsRebuilt = 0;
  let lifecyclePersisted = 0;
  let lifecycleChanged = 0;
  let strategyRebuilt = 0;
  const changedCreators = [];

  if (write && downgradeRows.length > 0) {
    await dbConn.prepare(`
      UPDATE events e
      LEFT JOIN event_evidence ee ON ee.event_id = e.id
      SET e.evidence_tier = 1,
          e.review_state = 'uncertain',
          e.lifecycle_effect = 'none',
          e.source_kind = 'migration_review',
          e.updated_at = CURRENT_TIMESTAMP
      WHERE COALESCE(e.evidence_tier, 0) >= 2
        AND e.source_kind = 'migration'
        AND COALESCE(e.review_state, 'unreviewed') = 'unreviewed'
        AND e.trigger_source = 'v1_import'
        AND e.event_key = 'agency_bound'
        AND COALESCE(e.trigger_text, '') = 'legacy agency binding'
        AND ee.source_message_id IS NULL
    `).run();
    downgraded = downgradeRows.length;

    for (const creatorId of affectedCreatorIds) {
      const before = await dbConn.prepare('SELECT stage_key FROM creator_lifecycle_snapshot WHERE creator_id = ?').get(creatorId).catch(() => null);
      await rebuildCreatorEventSnapshot(dbConn, creatorId);
      snapshotsRebuilt += 1;
      await persistLifecycleForCreator(dbConn, creatorId, {
        triggerType: 'tier2_compat_downgrade',
        triggerSource: 'events',
      });
      lifecyclePersisted += 1;
      const after = await dbConn.prepare('SELECT stage_key FROM creator_lifecycle_snapshot WHERE creator_id = ?').get(creatorId).catch(() => null);
      if ((before?.stage_key || null) !== (after?.stage_key || null)) {
        lifecycleChanged += 1;
        changedCreators.push({ creator_id: creatorId, before: before?.stage_key || null, after: after?.stage_key || null });
        await rebuildReplyStrategyForCreator({
          creatorId,
          trigger: 'tier2_compat_downgrade',
          allowSoftAdjust: false,
        }).catch(() => null);
        strategyRebuilt += 1;
      }
    }
  }

  const result = {
    generated_at: new Date().toISOString(),
    mode: write ? 'write' : 'dry_run',
    tier2_summary: summary,
    downgrade_policy: {
      reason: 'legacy v1_import agency_bound placeholder lacks a source message anchor and only says "legacy agency binding"',
      new_evidence_tier: 1,
      new_review_state: 'uncertain',
      new_lifecycle_effect: 'none',
      new_source_kind: 'migration_review',
    },
    downgrade_candidates: downgradeRows.length,
    affected_creator_count: affectedCreatorIds.length,
    downgraded,
    snapshots_rebuilt: snapshotsRebuilt,
    lifecycle_persisted: lifecyclePersisted,
    lifecycle_changed: lifecycleChanged,
    strategy_rebuilt: strategyRebuilt,
    changed_creators: changedCreators,
    sample_event_ids: downgradeRows.slice(0, 20).map((row) => row.id),
  };

  const reportPath = path.join(process.cwd(), 'reports', `tier2-compat-event-audit-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}.json`);
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ ...result, report_path: reportPath }, null, 2));

  if (typeof db.closeDb === 'function') {
    await db.closeDb();
  }
}

main().catch(async (err) => {
  console.error(err);
  if (typeof db.closeDb === 'function') {
    await db.closeDb().catch(() => {});
  }
  process.exit(1);
});
