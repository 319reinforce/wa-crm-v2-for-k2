const crypto = require('crypto');
const {
  EVENT_DECISION_RULES_BY_KEY,
  EVENT_RECALL_KEYWORDS,
} = require('../constants/eventDecisionRules');
const {
  detectEventsWithMiniMax,
  parseEventMeta,
} = require('./eventVerificationService');
const {
  rebuildCreatorEventSnapshot,
} = require('./creatorEventSnapshotService');

const REQUIRED_EVENT_DETECTION_TABLES = ['event_detection_cursor', 'event_detection_runs'];

function toTimestampMs(value = null) {
  if (value === null || value === undefined || value === '') return 0;
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) {
    return numeric > 1e12 ? Math.floor(numeric) : Math.floor(numeric * 1000);
  }
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function toSqlDatetime(value = null) {
  const timestamp = toTimestampMs(value);
  if (!timestamp) return null;
  return new Date(timestamp).toISOString().slice(0, 19).replace('T', ' ');
}

function hashPayload(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value || {})).digest('hex');
}

function normalizeOwner(value) {
  const text = String(value || '').trim();
  if (/^yiyun$/i.test(text)) return 'Yiyun';
  if (/^beau$/i.test(text)) return 'Beau';
  return text || 'Beau';
}

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[^a-z0-9\u4e00-\u9fff\s$-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function textIncludesKeyword(text, keyword) {
  const source = normalizeText(text);
  const needle = normalizeText(keyword);
  return !!needle && source.includes(needle);
}

async function tableExists(dbConn, tableName) {
  const row = await dbConn.prepare(`
    SELECT COUNT(*) AS count
    FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = ?
  `).get(tableName);
  return Number(row?.count || 0) > 0;
}

async function ensureActiveEventDetectionSchema(dbConn) {
  const rows = await dbConn.prepare(`
    SELECT TABLE_NAME AS table_name
    FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME IN (${REQUIRED_EVENT_DETECTION_TABLES.map(() => '?').join(', ')})
  `).all(...REQUIRED_EVENT_DETECTION_TABLES);
  const existing = new Set(rows.map((row) => row.table_name));
  const missing = REQUIRED_EVENT_DETECTION_TABLES.filter((table) => !existing.has(table));
  if (missing.length > 0) {
    throw new Error(`Active event detection schema is missing ${missing.join(', ')}; run server/migrations/005_active_event_detection_queue.sql`);
  }

  return {
    cursor: await tableExists(dbConn, 'event_detection_cursor'),
    runs: await tableExists(dbConn, 'event_detection_runs'),
  };
}

async function enqueueCreatorEventDetection(dbConn, {
  creatorId,
  reason = 'message_ingest',
  fromMessageId = null,
  fromTimestamp = null,
} = {}) {
  const numericCreatorId = Number(creatorId);
  if (!Number.isFinite(numericCreatorId) || numericCreatorId <= 0) {
    return { enqueued: false, reason: 'invalid_creator_id' };
  }
  await ensureActiveEventDetectionSchema(dbConn);
  const timestamp = toTimestampMs(fromTimestamp) || null;
  const messageId = Number.isFinite(Number(fromMessageId)) && Number(fromMessageId) > 0
    ? Number(fromMessageId)
    : null;

  await dbConn.prepare(`
    INSERT INTO event_detection_cursor (
      creator_id, status, pending_reason, pending_from_message_id, pending_from_timestamp, updated_at
    ) VALUES (?, 'pending', ?, ?, ?, CURRENT_TIMESTAMP)
    ON DUPLICATE KEY UPDATE
      status = 'pending',
      pending_reason = VALUES(pending_reason),
      pending_from_message_id = CASE
        WHEN pending_from_message_id IS NULL THEN VALUES(pending_from_message_id)
        WHEN VALUES(pending_from_message_id) IS NULL THEN pending_from_message_id
        ELSE LEAST(pending_from_message_id, VALUES(pending_from_message_id))
      END,
      pending_from_timestamp = CASE
        WHEN pending_from_timestamp IS NULL THEN VALUES(pending_from_timestamp)
        WHEN VALUES(pending_from_timestamp) IS NULL THEN pending_from_timestamp
        ELSE LEAST(pending_from_timestamp, VALUES(pending_from_timestamp))
      END,
      updated_at = CURRENT_TIMESTAMP
  `).run(numericCreatorId, String(reason || 'message_ingest').slice(0, 64), messageId, timestamp);

  return { enqueued: true, creator_id: numericCreatorId, from_message_id: messageId, from_timestamp: timestamp };
}

async function enqueueMessageForEventDetection(dbConn, {
  creatorId,
  messageId = null,
  timestamp = null,
  reason = 'message_ingest',
} = {}) {
  if (String(process.env.EVENT_DETECTION_AUTO_ENQUEUE || 'true').toLowerCase() === 'false') {
    return { enqueued: false, reason: 'disabled' };
  }
  return enqueueCreatorEventDetection(dbConn, {
    creatorId,
    reason,
    fromMessageId: messageId,
    fromTimestamp: timestamp,
  });
}

function keywordCandidatesForMessage(message, owner = 'Beau') {
  const candidates = [];
  for (const [eventKey, keywords] of Object.entries(EVENT_RECALL_KEYWORDS)) {
    const hits = (keywords || []).filter((keyword) => textIncludesKeyword(message.text, keyword));
    if (hits.length === 0) continue;
    const rule = EVENT_DECISION_RULES_BY_KEY[eventKey] || {};
    const sourceAnchor = {
      message_id: Number(message.id),
      timestamp: Number(message.timestamp || 0),
      message_hash: message.message_hash || null,
    };
    candidates.push({
      event_key: eventKey,
      event_type: rule.event_type || 'incentive_task',
      owner: normalizeOwner(owner),
      status: 'draft',
      suggested_status: 'draft',
      trigger_text: String(message.text || '').slice(0, 500),
      trigger_source: 'active_keyword',
      evidence_tier: 0,
      source_kind: 'keyword',
      source_quote: '',
      confidence: Math.min(0.75, 0.45 + hits.length * 0.08),
      reason: `keyword hits: ${hits.slice(0, 5).join(', ')}`,
      source_anchor: sourceAnchor,
      overlays: ['weak_event_evidence'],
      meta: {
        evidence_contract: {
          evidence_tier: 0,
          source_kind: 'keyword',
          source_message_id: sourceAnchor.message_id,
          source_quote: '',
          external_system: null,
          verified_by: null,
          verified_at: null,
        },
        lifecycle_overlay: {
          overlays: ['weak_event_evidence'],
          lifecycle_stage_suggestion: null,
          drives_main_stage: false,
        },
      },
    });
  }
  return candidates;
}

function normalizeCandidateForInsert(candidate, message, owner, runId) {
  const rule = EVENT_DECISION_RULES_BY_KEY[candidate.event_key] || {};
  const sourceAnchor = candidate.source_anchor || {
    message_id: Number(message.id),
    timestamp: Number(message.timestamp || 0),
    message_hash: message.message_hash || null,
  };
  const evidenceTier = Math.max(0, Math.min(Math.trunc(Number(candidate.evidence_tier || 0)), 3));
  const candidateSourceKind = candidate.source_kind
    || (String(candidate.trigger_source || '').includes('minimax') ? 'llm' : 'keyword');
  const meta = {
    ...parseEventMeta(candidate.meta),
    source_anchor: sourceAnchor,
    active_detection: {
      run_id: runId,
      source: 'active-event-detection',
      source_message_id: Number(message.id),
      provider: candidate.source_kind || candidate.trigger_source || 'unknown',
    },
    evidence_contract: {
      ...(parseEventMeta(candidate.meta)?.evidence_contract || {}),
      evidence_tier: evidenceTier,
      source_kind: candidateSourceKind,
      source_message_id: sourceAnchor.message_id || Number(message.id),
      source_quote: String(candidate.source_quote || candidate.verification?.evidence_quote || '').slice(0, 500),
      external_system: null,
      verified_by: null,
      verified_at: null,
    },
  };
  const sourceEventAt = toSqlDatetime(sourceAnchor.timestamp || message.timestamp);
  const startAt = toSqlDatetime(candidate.start_at) || sourceEventAt;
  const idempotencyKey = [
    'active_detect',
    message.creator_id,
    candidate.event_key,
    sourceAnchor.message_id || sourceAnchor.message_hash || message.id,
    candidate.meta?.threshold || candidate.threshold || '',
  ].join(':').slice(0, 128);

  return {
    creator_id: Number(message.creator_id),
    event_key: candidate.event_key,
    canonical_event_key: candidate.event_key,
    event_type: candidate.event_type || rule.event_type || 'incentive_task',
    owner: normalizeOwner(candidate.owner || owner),
    status: 'draft',
    event_state: 'candidate',
    review_state: 'unreviewed',
    evidence_tier: evidenceTier,
    source_kind: meta.evidence_contract.source_kind,
    source_event_at: sourceEventAt,
    detected_at: toSqlDatetime(Date.now()),
    idempotency_key: idempotencyKey,
    lifecycle_effect: 'none',
    trigger_source: candidate.trigger_source || 'active_event_detection',
    trigger_text: String(candidate.reason || candidate.trigger_text || message.text || '').slice(0, 500),
    start_at: startAt,
    meta,
    evidence: {
      source_kind: meta.evidence_contract.source_kind,
      source_table: 'wa_messages',
      source_record_id: String(sourceAnchor.message_id || message.id),
      source_message_id: sourceAnchor.message_id || Number(message.id),
      source_message_hash: sourceAnchor.message_hash || message.message_hash || null,
      source_quote: String(meta.evidence_contract.source_quote || '').slice(0, 500),
      external_system: null,
      raw_payload_hash: hashPayload({ candidate, message_id: message.id }),
    },
  };
}

async function insertDetectedEventCandidate(dbConn, candidate) {
  const existing = await dbConn.prepare('SELECT id FROM events WHERE idempotency_key = ? LIMIT 1')
    .get(candidate.idempotency_key);
  if (existing) return { inserted: false, skipped: true, reason: 'duplicate', id: existing.id };

  const result = await dbConn.prepare(`
    INSERT INTO events (
      creator_id, event_key, canonical_event_key, event_type, owner, status, event_state,
      review_state, evidence_tier, source_kind, source_event_at, detected_at,
      idempotency_key, lifecycle_effect, trigger_source, trigger_text, start_at, meta
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    candidate.creator_id,
    candidate.event_key,
    candidate.canonical_event_key,
    candidate.event_type,
    candidate.owner,
    candidate.status,
    candidate.event_state,
    candidate.review_state,
    candidate.evidence_tier,
    candidate.source_kind,
    candidate.source_event_at,
    candidate.detected_at,
    candidate.idempotency_key,
    candidate.lifecycle_effect,
    candidate.trigger_source,
    candidate.trigger_text,
    candidate.start_at,
    JSON.stringify(candidate.meta),
  );
  const eventId = result.lastInsertRowid;
  await dbConn.prepare(`
    INSERT INTO event_evidence (
      event_id, source_kind, source_table, source_record_id, source_message_id,
      source_message_hash, source_quote, external_system, raw_payload_hash
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    eventId,
    candidate.evidence.source_kind,
    candidate.evidence.source_table,
    candidate.evidence.source_record_id,
    candidate.evidence.source_message_id,
    candidate.evidence.source_message_hash,
    candidate.evidence.source_quote,
    candidate.evidence.external_system,
    candidate.evidence.raw_payload_hash,
  );
  return { inserted: true, id: eventId };
}

async function fetchCreator(dbConn, creatorId) {
  return dbConn.prepare(`
    SELECT id, primary_name, wa_owner
    FROM creators
    WHERE id = ?
    LIMIT 1
  `).get(creatorId);
}

async function fetchPendingMessages(dbConn, creatorId, {
  sinceTimestamp = null,
  sinceMessageId = null,
  limit = 80,
} = {}) {
  const params = [creatorId];
  let where = `
    WHERE creator_id = ?
      AND text IS NOT NULL
      AND TRIM(text) <> ''
  `;
  const timestamp = toTimestampMs(sinceTimestamp);
  if (timestamp > 0) {
    where += ' AND timestamp >= ?';
    params.push(timestamp);
  } else if (Number(sinceMessageId || 0) > 0) {
    where += ' AND id >= ?';
    params.push(Number(sinceMessageId));
  }
  const boundedLimit = Math.max(1, Math.min(Number(limit || 80), 500));
  return dbConn.prepare(`
    SELECT id, creator_id, role, text, timestamp, message_hash
    FROM wa_messages
    ${where}
    ORDER BY timestamp ASC, id ASC
    LIMIT ${boundedLimit}
  `).all(...params);
}

async function detectMessageCandidates(dbConn, creator, message, options) {
  const provider = String(options.provider || 'keyword').toLowerCase();
  if (provider === 'minimax' || provider === 'llm') {
    const ret = await detectEventsWithMiniMax({
      dbConn,
      creatorId: Number(creator.id),
      owner: normalizeOwner(creator.wa_owner),
      text: message.text,
      sourceAnchor: {
        message_id: Number(message.id),
        timestamp: Number(message.timestamp || 0),
        message_hash: message.message_hash || null,
      },
      contextWindow: options.contextWindow || { before: 5, after: 4 },
      model: options.model || null,
    });
    return (ret.normalized?.detected || []).map((candidate) => ({
      ...candidate,
      trigger_source: candidate.trigger_source || 'active_minimax',
      source_kind: candidate.source_kind || 'llm',
    }));
  }
  return keywordCandidatesForMessage(message, creator.wa_owner);
}

async function createDetectionRun(dbConn, creatorId, options, cursor) {
  const result = await dbConn.prepare(`
    INSERT INTO event_detection_runs (
      creator_id, mode, provider, status, dry_run, from_message_id, from_timestamp, config_json
    ) VALUES (?, ?, ?, 'running', ?, ?, ?, ?)
  `).run(
    creatorId,
    options.mode || 'incremental',
    options.provider || 'keyword',
    options.write ? 0 : 1,
    cursor?.pending_from_message_id || options.sinceMessageId || null,
    cursor?.pending_from_timestamp || options.sinceTimestamp || null,
    JSON.stringify({
      limit: options.limit || null,
      message_limit: options.messageLimit || null,
      reason: cursor?.pending_reason || options.reason || null,
    }),
  );
  return result.lastInsertRowid;
}

async function finishDetectionRun(dbConn, runId, patch = {}) {
  await dbConn.prepare(`
    UPDATE event_detection_runs
    SET status = ?,
        to_message_id = ?,
        to_timestamp = ?,
        scanned_messages = ?,
        candidate_count = ?,
        written_count = ?,
        skipped_count = ?,
        error_count = ?,
        error_message = ?,
        completed_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(
    patch.status || 'completed',
    patch.to_message_id || null,
    patch.to_timestamp || null,
    patch.scanned_messages || 0,
    patch.candidate_count || 0,
    patch.written_count || 0,
    patch.skipped_count || 0,
    patch.error_count || 0,
    patch.error_message || null,
    runId,
  );
}

async function processCreatorEventDetection(dbConn, creatorId, options = {}) {
  await ensureActiveEventDetectionSchema(dbConn);
  const creator = await fetchCreator(dbConn, creatorId);
  if (!creator) return { ok: false, reason: 'creator_not_found', creator_id: Number(creatorId) };

  const cursor = await dbConn.prepare('SELECT * FROM event_detection_cursor WHERE creator_id = ? LIMIT 1')
    .get(creator.id);
  const runId = await createDetectionRun(dbConn, creator.id, options, cursor);
  const advanceCursor = options.advanceCursor === true || options.write === true;
  const stats = {
    ok: true,
    run_id: runId,
    creator_id: Number(creator.id),
    creator_name: creator.primary_name || null,
    provider: options.provider || 'keyword',
    dry_run: !options.write,
    scanned_messages: 0,
    candidate_count: 0,
    written_count: 0,
    skipped_count: 0,
    error_count: 0,
    candidates: [],
    errors: [],
  };

  try {
    if (advanceCursor) {
      await dbConn.prepare(`
        INSERT INTO event_detection_cursor (creator_id, status, updated_at)
        VALUES (?, 'running', CURRENT_TIMESTAMP)
        ON DUPLICATE KEY UPDATE status = 'running', attempt_count = attempt_count + 1, updated_at = CURRENT_TIMESTAMP
      `).run(creator.id);
    }

    const messages = await fetchPendingMessages(dbConn, creator.id, {
      sinceTimestamp: options.sinceTimestamp || cursor?.pending_from_timestamp || cursor?.last_message_timestamp || null,
      sinceMessageId: options.sinceMessageId || cursor?.pending_from_message_id || null,
      limit: options.messageLimit || 80,
    });

    let toMessageId = null;
    let toTimestamp = null;
    for (const message of messages) {
      stats.scanned_messages += 1;
      toMessageId = Number(message.id);
      toTimestamp = Number(message.timestamp || 0);
      try {
        const detected = await detectMessageCandidates(dbConn, creator, message, options);
        stats.candidate_count += detected.length;
        for (const rawCandidate of detected) {
          const candidate = normalizeCandidateForInsert(rawCandidate, message, creator.wa_owner, runId);
          stats.candidates.push({
            message_id: Number(message.id),
            event_key: candidate.event_key,
            event_type: candidate.event_type,
            evidence_tier: candidate.evidence_tier,
            source_event_at: candidate.source_event_at,
            start_at: candidate.start_at,
            trigger_text: candidate.trigger_text,
            idempotency_key: candidate.idempotency_key,
          });
          if (!options.write) continue;
          const insertResult = await insertDetectedEventCandidate(dbConn, candidate);
          if (insertResult.inserted) stats.written_count += 1;
          else stats.skipped_count += 1;
        }
      } catch (err) {
        stats.error_count += 1;
        stats.errors.push({ message_id: Number(message.id), error: err.message });
      }
    }

    if (options.write) {
      await rebuildCreatorEventSnapshot(dbConn, creator.id).catch(() => null);
    }
    if (advanceCursor) {
      await dbConn.prepare(`
        UPDATE event_detection_cursor
        SET status = ?,
            pending_reason = NULL,
            pending_from_message_id = NULL,
            pending_from_timestamp = NULL,
            last_message_id = COALESCE(?, last_message_id),
            last_message_timestamp = COALESCE(?, last_message_timestamp),
            last_detected_at = CURRENT_TIMESTAMP,
            last_run_id = ?,
            last_error = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE creator_id = ?
      `).run(
        stats.error_count > 0 ? 'error' : 'idle',
        toMessageId,
        toTimestamp,
        runId,
        stats.error_count > 0 ? JSON.stringify(stats.errors.slice(0, 5)) : null,
        creator.id,
      );
    }
    await finishDetectionRun(dbConn, runId, {
      status: stats.error_count > 0 ? 'completed_with_errors' : 'completed',
      to_message_id: toMessageId,
      to_timestamp: toTimestamp,
      scanned_messages: stats.scanned_messages,
      candidate_count: stats.candidate_count,
      written_count: stats.written_count,
      skipped_count: stats.skipped_count,
      error_count: stats.error_count,
      error_message: stats.error_count > 0 ? JSON.stringify(stats.errors.slice(0, 5)) : null,
    });
    return stats;
  } catch (err) {
    if (advanceCursor) {
      await dbConn.prepare(`
        UPDATE event_detection_cursor
        SET status = 'error', last_error = ?, last_run_id = ?, updated_at = CURRENT_TIMESTAMP
        WHERE creator_id = ?
      `).run(err.message, runId, creator.id).catch(() => {});
    }
    await finishDetectionRun(dbConn, runId, {
      status: 'failed',
      scanned_messages: stats.scanned_messages,
      candidate_count: stats.candidate_count,
      written_count: stats.written_count,
      skipped_count: stats.skipped_count,
      error_count: stats.error_count + 1,
      error_message: err.message,
    }).catch(() => {});
    throw err;
  }
}

async function enqueueCreatorsWithNewMessages(dbConn, options = {}) {
  await ensureActiveEventDetectionSchema(dbConn);
  const params = [];
  let where = 'WHERE c.is_active = 1';
  const fallbackSinceTimestamp = toTimestampMs(options.sinceTimestamp) || null;
  if (options.creatorId) {
    where += ' AND c.id = ?';
    params.push(Number(options.creatorId));
  }
  if (options.owner) {
    where += ' AND c.wa_owner = ?';
    params.push(normalizeOwner(options.owner));
  }
  const limitSql = options.limit ? ` LIMIT ${Math.max(1, Math.min(Number(options.limit), 1000))}` : '';
  const rows = await dbConn.prepare(`
    SELECT c.id AS creator_id,
           MAX(wm.id) AS last_message_id,
           MAX(wm.timestamp) AS last_message_timestamp,
           cur.last_message_timestamp AS cursor_last_timestamp
    FROM creators c
    JOIN wa_messages wm ON wm.creator_id = c.id
    LEFT JOIN event_detection_cursor cur ON cur.creator_id = c.id
    ${where}
    GROUP BY c.id, cur.last_message_timestamp
    HAVING cur.last_message_timestamp IS NULL
       OR MAX(wm.timestamp) > cur.last_message_timestamp
    ORDER BY MAX(wm.timestamp) DESC
    ${limitSql}
  `).all(...params);

  for (const row of rows) {
    const fromTimestamp = row.cursor_last_timestamp
      ? row.cursor_last_timestamp
      : (fallbackSinceTimestamp || row.last_message_timestamp);
    await enqueueCreatorEventDetection(dbConn, {
      creatorId: row.creator_id,
      reason: options.reason || 'message_supplement_scan',
      fromMessageId: row.cursor_last_timestamp || fallbackSinceTimestamp ? null : row.last_message_id,
      fromTimestamp,
    });
  }
  return { enqueued: rows.length, creators: rows };
}

async function processPendingEventDetections(dbConn, options = {}) {
  await ensureActiveEventDetectionSchema(dbConn);
  const limit = Math.max(1, Math.min(Number(options.limit || 10), 100));
  const rows = await dbConn.prepare(`
    SELECT creator_id
    FROM event_detection_cursor
    WHERE status IN ('pending', 'error')
    ORDER BY updated_at ASC
    LIMIT ${limit}
  `).all();
  const results = [];
  for (const row of rows) {
    results.push(await processCreatorEventDetection(dbConn, row.creator_id, options));
  }
  return results;
}

module.exports = {
  ensureActiveEventDetectionSchema,
  enqueueCreatorEventDetection,
  enqueueMessageForEventDetection,
  enqueueCreatorsWithNewMessages,
  processCreatorEventDetection,
  processPendingEventDetections,
  keywordCandidatesForMessage,
  normalizeCandidateForInsert,
};
