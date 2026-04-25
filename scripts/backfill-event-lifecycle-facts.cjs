#!/usr/bin/env node
require('dotenv').config();

const crypto = require('crypto');
const db = require('../db');
const {
  CANONICAL_LIFECYCLE_EVENT_KEYS,
} = require('../server/constants/eventDecisionRules');
const {
  canEventDriveLifecycle,
  isCanonicalLifecycleEventKey,
  isGeneratedLifecycleEventKey,
  normalizeEventStatus,
  normalizeLifecycleEventRow,
  parseEventMeta,
} = require('../server/services/eventLifecycleFacts');

const args = process.argv.slice(2);
const CANONICAL = new Set(CANONICAL_LIFECYCLE_EVENT_KEYS);

function hasFlag(name) {
  return args.includes(name);
}

function toSqlDatetime(value = null) {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  const date = Number.isFinite(numeric) && numeric > 0
    ? new Date(numeric > 1e12 ? numeric : numeric * 1000)
    : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

function hashPayload(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value || {})).digest('hex');
}

function eventStateFromStatus(status) {
  const normalized = normalizeEventStatus(status);
  if (normalized === 'draft') return 'candidate';
  if (['active', 'completed', 'cancelled'].includes(normalized)) return normalized;
  return 'candidate';
}

function reviewStateFromMeta(meta = {}, status = '') {
  const raw = String(meta?.verification?.review_status || '').trim().toLowerCase();
  if (['confirmed', 'rejected', 'uncertain'].includes(raw)) return raw;
  const normalized = normalizeEventStatus(status);
  if (normalized === 'draft') return 'unreviewed';
  return 'unreviewed';
}

function sourceKindFromEvent(event = {}, meta = {}) {
  const explicit = String(meta?.evidence_contract?.source_kind || event.source_kind || '').trim().toLowerCase();
  if (explicit) return explicit;
  const source = String(event.trigger_source || '').trim().toLowerCase();
  if (source.includes('gmv_crosscheck') || source.includes('external')) return 'external_system';
  if (source.includes('manual')) return 'operator';
  if (source.includes('v1_import') || source.includes('migration') || source.includes('import')) return 'migration';
  if (source.includes('minimax') || source.includes('llm')) return 'llm';
  if (source.includes('semantic') || source.includes('detect')) return 'llm';
  return 'legacy_backfill';
}

function evidenceTierFromEvent(event = {}, meta = {}, sourceKind = '') {
  const explicit = meta?.evidence_contract?.evidence_tier ?? event.evidence_tier;
  if (explicit !== undefined && explicit !== null && explicit !== '') {
    const numeric = Number(explicit);
    if (Number.isFinite(numeric)) return Math.max(0, Math.min(Math.trunc(numeric), 3));
  }
  if (String(meta?.verification?.review_status || '').toLowerCase() === 'confirmed') return 2;
  if (!isCanonicalLifecycleEventKey(event.event_key)) return 0;
  const status = normalizeEventStatus(event.status);
  if (!['active', 'completed'].includes(status)) return 0;
  if (sourceKind === 'external_system') return 3;
  // Preserve current production behavior for legacy canonical rows that were already active/completed
  // before evidence fields existed. These remain lifecycle-consumable until the review backfill is stricter.
  return 2;
}

function lifecycleEffectFromEvent(event = {}) {
  if (!isCanonicalLifecycleEventKey(event.event_key)) return 'none';
  if (['referral', 'recall_pending', 'second_touch'].includes(String(event.event_key || ''))) return 'overlay';
  return 'stage_signal';
}

function buildBackfillForEvent(event = {}) {
  const meta = parseEventMeta(event.meta, {});
  const canonicalEventKey = isCanonicalLifecycleEventKey(event.event_key) ? event.event_key : null;
  const eventState = eventStateFromStatus(event.status);
  const reviewState = reviewStateFromMeta(meta, event.status);
  const sourceKind = sourceKindFromEvent(event, meta);
  const evidenceTier = evidenceTierFromEvent(event, meta, sourceKind);
  const sourceAnchor = meta?.source_anchor || {};
  const verification = meta?.verification || {};
  const lifecycleEffect = lifecycleEffectFromEvent(event);
  const sourceEventAt = toSqlDatetime(sourceAnchor.timestamp) || toSqlDatetime(event.start_at) || toSqlDatetime(event.created_at);
  const detectedAt = toSqlDatetime(event.created_at);
  const verifiedAt = toSqlDatetime(verification.verified_at || verification.reviewed_at || event.verified_at);
  const verifiedBy = verification.verified_by || verification.reviewed_by || null;
  const idempotencyKey = [
    'event',
    event.creator_id,
    event.event_key,
    event.status,
    sourceAnchor.message_id || sourceAnchor.message_hash || toSqlDatetime(event.start_at) || event.id,
  ].join(':').slice(0, 128);

  return {
    canonical_event_key: canonicalEventKey,
    event_state: eventState,
    review_state: reviewState,
    evidence_tier: evidenceTier,
    source_kind: sourceKind,
    source_event_at: sourceEventAt,
    detected_at: detectedAt,
    verified_at: verifiedAt,
    verified_by: verifiedBy,
    idempotency_key: idempotencyKey,
    lifecycle_effect: lifecycleEffect,
    expires_at: eventState === 'candidate' ? null : null,
    evidence: {
      source_kind: sourceKind,
      source_table: sourceAnchor.message_id || sourceAnchor.message_hash ? 'wa_messages' : null,
      source_record_id: sourceAnchor.message_id == null ? null : String(sourceAnchor.message_id),
      source_message_id: sourceAnchor.message_id || null,
      source_message_hash: sourceAnchor.message_hash || null,
      source_quote: String(meta?.evidence_contract?.source_quote || verification.evidence_quote || event.trigger_text || '').slice(0, 500),
      external_system: sourceKind === 'external_system' ? (meta?.evidence_contract?.external_system || event.trigger_source || null) : null,
      raw_payload_hash: hashPayload({
        event_id: event.id,
        meta,
        trigger_text: event.trigger_text || '',
      }),
    },
  };
}

async function columnExists(dbConn, tableName, columnName) {
  const row = await dbConn.prepare(`
    SELECT COUNT(*) AS count
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = ?
      AND COLUMN_NAME = ?
  `).get(tableName, columnName);
  return Number(row?.count || 0) > 0;
}

async function indexExists(dbConn, tableName, indexName) {
  const row = await dbConn.prepare(`
    SELECT COUNT(*) AS count
    FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = ?
      AND INDEX_NAME = ?
  `).get(tableName, indexName);
  return Number(row?.count || 0) > 0;
}

async function addColumnIfMissing(dbConn, tableName, columnName, definition) {
  if (await columnExists(dbConn, tableName, columnName)) return false;
  await dbConn.prepare(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`).run();
  return true;
}

async function addIndexIfMissing(dbConn, tableName, indexName, ddl) {
  if (await indexExists(dbConn, tableName, indexName)) return false;
  await dbConn.prepare(ddl).run();
  return true;
}

async function ensureSchema(dbConn) {
  const changes = [];
  const columns = [
    ['canonical_event_key', 'VARCHAR(64) NULL AFTER event_key'],
    ['event_state', 'VARCHAR(24) NULL AFTER status'],
    ['review_state', 'VARCHAR(24) NULL AFTER event_state'],
    ['evidence_tier', 'TINYINT NULL AFTER review_state'],
    ['source_kind', 'VARCHAR(32) NULL AFTER evidence_tier'],
    ['source_event_at', 'DATETIME NULL AFTER source_kind'],
    ['detected_at', 'DATETIME NULL AFTER source_event_at'],
    ['verified_at', 'DATETIME NULL AFTER detected_at'],
    ['verified_by', 'VARCHAR(64) NULL AFTER verified_at'],
    ['idempotency_key', 'VARCHAR(128) NULL AFTER verified_by'],
    ['lifecycle_effect', 'VARCHAR(32) NULL AFTER idempotency_key'],
    ['expires_at', 'DATETIME NULL AFTER lifecycle_effect'],
  ];
  for (const [column, definition] of columns) {
    if (await addColumnIfMissing(dbConn, 'events', column, definition)) changes.push(`events.${column}`);
  }

  await dbConn.prepare(`
    CREATE TABLE IF NOT EXISTS event_definitions (
      event_key             VARCHAR(64) PRIMARY KEY,
      event_type            VARCHAR(32) NOT NULL,
      label                 VARCHAR(128) NOT NULL,
      lifecycle_effect      VARCHAR(32) NOT NULL DEFAULT 'none',
      is_periodic           TINYINT(1) NOT NULL DEFAULT 0,
      allow_parallel        TINYINT(1) NOT NULL DEFAULT 0,
      requires_verification TINYINT(1) NOT NULL DEFAULT 1,
      owner_scope_json      JSON,
      created_at            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `).run();

  await dbConn.prepare(`
    CREATE TABLE IF NOT EXISTS event_evidence (
      id                  BIGINT AUTO_INCREMENT PRIMARY KEY,
      event_id            INT NOT NULL,
      source_kind         VARCHAR(32) NOT NULL,
      source_table        VARCHAR(64),
      source_record_id    VARCHAR(128),
      source_message_id   BIGINT,
      source_message_hash VARCHAR(128),
      source_quote        TEXT,
      external_system     VARCHAR(64),
      raw_payload_hash    VARCHAR(128),
      created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT fk_event_evidence_event FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `).run();

  await dbConn.prepare(`
    CREATE TABLE IF NOT EXISTS event_state_transitions (
      id            BIGINT AUTO_INCREMENT PRIMARY KEY,
      event_id      INT NOT NULL,
      from_state    VARCHAR(24),
      to_state      VARCHAR(24) NOT NULL,
      reason        TEXT,
      operator      VARCHAR(64),
      created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT fk_event_state_transition_event FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `).run();

  await dbConn.prepare(`
    CREATE TABLE IF NOT EXISTS creator_event_snapshot (
      creator_id             INT PRIMARY KEY,
      active_event_keys_json JSON,
      overlay_flags_json     JSON,
      compat_ev_flags_json   JSON,
      latest_event_at        DATETIME,
      rebuilt_at             DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT fk_creator_event_snapshot_creator FOREIGN KEY (creator_id) REFERENCES creators(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `).run();

  await addIndexIfMissing(dbConn, 'events', 'idx_events_canonical_state', 'CREATE INDEX idx_events_canonical_state ON events(canonical_event_key, event_state)');
  await addIndexIfMissing(dbConn, 'events', 'idx_events_source_event_at', 'CREATE INDEX idx_events_source_event_at ON events(source_event_at)');
  await addIndexIfMissing(dbConn, 'events', 'idx_events_idempotency', 'CREATE UNIQUE INDEX idx_events_idempotency ON events(idempotency_key)');
  await addIndexIfMissing(dbConn, 'event_evidence', 'idx_event_evidence_event', 'CREATE INDEX idx_event_evidence_event ON event_evidence(event_id)');
  await addIndexIfMissing(dbConn, 'event_evidence', 'idx_event_evidence_message', 'CREATE INDEX idx_event_evidence_message ON event_evidence(source_message_id)');
  await addIndexIfMissing(dbConn, 'event_state_transitions', 'idx_event_state_transition_event_time', 'CREATE INDEX idx_event_state_transition_event_time ON event_state_transitions(event_id, created_at DESC)');

  return changes;
}

async function seedDefinitions(dbConn) {
  const definitions = [
    ['trial_7day', 'challenge', '7天试用', 'stage_signal', 1],
    ['monthly_challenge', 'challenge', '月度挑战', 'stage_signal', 1],
    ['agency_bound', 'agency', 'Agency绑定', 'stage_signal', 0],
    ['gmv_milestone', 'gmv', 'GMV里程碑', 'stage_signal', 0],
    ['referral', 'referral', '推荐', 'overlay', 0],
    ['recall_pending', 'followup', '待召回', 'overlay', 0],
    ['second_touch', 'followup', '二次触达', 'overlay', 0],
    ['churned', 'termination', '合作流失', 'stage_signal', 0],
    ['do_not_contact', 'termination', '停止主动联系', 'stage_signal', 0],
    ['opt_out', 'termination', '主动退出', 'stage_signal', 0],
  ];
  for (const row of definitions) {
    await dbConn.prepare(`
      INSERT INTO event_definitions (
        event_key, event_type, label, lifecycle_effect, is_periodic, allow_parallel, requires_verification, owner_scope_json
      ) VALUES (?, ?, ?, ?, ?, 0, 1, ?)
      ON DUPLICATE KEY UPDATE
        event_type = VALUES(event_type),
        label = VALUES(label),
        lifecycle_effect = VALUES(lifecycle_effect),
        is_periodic = VALUES(is_periodic),
        updated_at = CURRENT_TIMESTAMP
    `).run(row[0], row[1], row[2], row[3], row[4], JSON.stringify(['Beau', 'Yiyun']));
  }
  return definitions.length;
}

async function backfillEvents(dbConn, { write }) {
  const rows = await dbConn.prepare(`
    SELECT id, creator_id, event_key, event_type, owner, status, trigger_source, trigger_text, start_at, end_at, created_at, updated_at, meta,
           canonical_event_key, event_state, review_state, evidence_tier, source_kind, source_event_at, detected_at, verified_at, verified_by, idempotency_key, lifecycle_effect, expires_at
    FROM events
    ORDER BY id ASC
  `).all();
  const stats = { scanned: rows.length, updated: 0, evidence_inserted: 0 };

  for (const row of rows) {
    const backfill = buildBackfillForEvent(row);
    const comparableValue = (field, value) => {
      if (['source_event_at', 'detected_at', 'verified_at', 'expires_at'].includes(field)) {
        return toSqlDatetime(value) || '';
      }
      return String(value ?? '');
    };
    const changed = [
      'canonical_event_key',
      'event_state',
      'review_state',
      'evidence_tier',
      'source_kind',
      'source_event_at',
      'detected_at',
      'verified_at',
      'verified_by',
      'idempotency_key',
      'lifecycle_effect',
      'expires_at',
    ].some((field) => comparableValue(field, row[field]) !== comparableValue(field, backfill[field]));

    if (write && changed) {
      await dbConn.prepare(`
        UPDATE events
        SET canonical_event_key = ?,
            event_state = ?,
            review_state = ?,
            evidence_tier = ?,
            source_kind = ?,
            source_event_at = ?,
            detected_at = ?,
            verified_at = ?,
            verified_by = ?,
            idempotency_key = ?,
            lifecycle_effect = ?,
            expires_at = ?,
            updated_at = updated_at
        WHERE id = ?
      `).run(
        backfill.canonical_event_key,
        backfill.event_state,
        backfill.review_state,
        backfill.evidence_tier,
        backfill.source_kind,
        backfill.source_event_at,
        backfill.detected_at,
        backfill.verified_at,
        backfill.verified_by,
        backfill.idempotency_key,
        backfill.lifecycle_effect,
        backfill.expires_at,
        row.id,
      );
    }
    if (changed) stats.updated += 1;

    const existingEvidence = await dbConn.prepare('SELECT id FROM event_evidence WHERE event_id = ? AND raw_payload_hash = ? LIMIT 1')
      .get(row.id, backfill.evidence.raw_payload_hash);
    if (!write || existingEvidence) {
      if (!write && !existingEvidence) stats.evidence_inserted += 1;
      continue;
    }
    await dbConn.prepare(`
      INSERT INTO event_evidence (
        event_id, source_kind, source_table, source_record_id, source_message_id, source_message_hash,
        source_quote, external_system, raw_payload_hash
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      row.id,
      backfill.evidence.source_kind,
      backfill.evidence.source_table,
      backfill.evidence.source_record_id,
      backfill.evidence.source_message_id,
      backfill.evidence.source_message_hash,
      backfill.evidence.source_quote,
      backfill.evidence.external_system,
      backfill.evidence.raw_payload_hash,
    );
    stats.evidence_inserted += 1;
  }

  return stats;
}

function buildCompatFlags(events = []) {
  const flags = {
    ev_trial_7day: false,
    ev_trial_active: false,
    ev_monthly_started: false,
    ev_monthly_joined: false,
    ev_agency_bound: false,
    ev_churned: false,
    ev_gmv_1k: false,
    ev_gmv_2k: false,
    ev_gmv_5k: false,
    ev_gmv_10k: false,
  };
  for (const event of events) {
    const key = event.event_key;
    const status = normalizeEventStatus(event.status || event.event_state);
    const meta = parseEventMeta(event.meta, {});
    if (key === 'trial_7day') {
      flags.ev_trial_7day = true;
      if (status === 'active') flags.ev_trial_active = true;
    }
    if (key === 'monthly_challenge') {
      flags.ev_monthly_started = true;
      if (status === 'completed') flags.ev_monthly_joined = true;
    }
    if (key === 'agency_bound') flags.ev_agency_bound = true;
    if (['churned', 'do_not_contact', 'opt_out'].includes(key)) flags.ev_churned = true;
    if (key === 'gmv_milestone') {
      const threshold = Number(meta?.threshold || meta?.current_gmv || meta?.claimed_gmv || 0);
      flags.ev_gmv_1k = flags.ev_gmv_1k || threshold >= 1000;
      flags.ev_gmv_2k = flags.ev_gmv_2k || threshold >= 2000 || threshold === 0;
      flags.ev_gmv_5k = flags.ev_gmv_5k || threshold >= 5000;
      flags.ev_gmv_10k = flags.ev_gmv_10k || threshold >= 10000;
    }
  }
  return flags;
}

function collectOverlays(events = []) {
  const overlays = new Set();
  for (const event of events) {
    const meta = parseEventMeta(event.meta, {});
    (meta?.lifecycle_overlay?.overlays || []).forEach((overlay) => overlays.add(overlay));
    if (event.event_key === 'referral') overlays.add('referral_active');
  }
  return [...overlays];
}

async function rebuildCreatorEventSnapshots(dbConn, { write }) {
  const creatorRows = await dbConn.prepare('SELECT id FROM creators ORDER BY id ASC').all();
  const stats = { creators: creatorRows.length, upserted: 0 };
  for (const creator of creatorRows) {
    const rows = await dbConn.prepare(`
      SELECT id, creator_id, event_key, event_type, owner, status, event_state, trigger_source, trigger_text, start_at, end_at, created_at, updated_at, meta,
             canonical_event_key, review_state, evidence_tier, source_kind, source_event_at, detected_at, lifecycle_effect
      FROM events
      WHERE creator_id = ?
        AND status IN ('active', 'completed')
      ORDER BY COALESCE(source_event_at, start_at, created_at) DESC, id DESC
    `).all(creator.id);
    const lifecycleEvents = rows
      .map((row) => normalizeLifecycleEventRow(row))
      .filter((row) => canEventDriveLifecycle(row));
    const activeKeys = [...new Set(lifecycleEvents.map((event) => event.event_key))];
    const latestEventAt = lifecycleEvents[0]
      ? toSqlDatetime(lifecycleEvents[0].source_event_at || lifecycleEvents[0].start_at || lifecycleEvents[0].created_at)
      : null;
    const compatFlags = buildCompatFlags(lifecycleEvents);
    const overlays = collectOverlays(lifecycleEvents);
    if (write) {
      await dbConn.prepare(`
        INSERT INTO creator_event_snapshot (
          creator_id, active_event_keys_json, overlay_flags_json, compat_ev_flags_json, latest_event_at, rebuilt_at
        ) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON DUPLICATE KEY UPDATE
          active_event_keys_json = VALUES(active_event_keys_json),
          overlay_flags_json = VALUES(overlay_flags_json),
          compat_ev_flags_json = VALUES(compat_ev_flags_json),
          latest_event_at = VALUES(latest_event_at),
          rebuilt_at = CURRENT_TIMESTAMP
      `).run(
        creator.id,
        JSON.stringify(activeKeys),
        JSON.stringify(overlays),
        JSON.stringify(compatFlags),
        latestEventAt,
      );
    }
    stats.upserted += 1;
  }
  return stats;
}

async function main() {
  const write = hasFlag('--write');
  const dbConn = db.getDb();
  console.log(`mode: ${write ? 'write' : 'dry-run'}`);
  const schemaChanges = write ? await ensureSchema(dbConn) : [];
  if (write) console.log(`schema_changes: ${schemaChanges.join(', ') || 'none'}`);
  const definitions = write ? await seedDefinitions(dbConn) : CANONICAL.size;
  console.log(`definitions_seeded_or_planned: ${definitions}`);
  const eventStats = await backfillEvents(dbConn, { write });
  console.log(`events_scanned: ${eventStats.scanned}`);
  console.log(`${write ? 'events_updated' : 'events_to_update'}: ${eventStats.updated}`);
  console.log(`${write ? 'evidence_inserted' : 'evidence_to_insert'}: ${eventStats.evidence_inserted}`);
  const snapshotStats = await rebuildCreatorEventSnapshots(dbConn, { write });
  console.log(`creator_snapshots_${write ? 'upserted' : 'planned'}: ${snapshotStats.upserted}`);
  await db.closeDb();
}

main().catch(async (err) => {
  console.error(err.message);
  await db.closeDb().catch(() => {});
  process.exitCode = 1;
});
