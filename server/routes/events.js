/**
 * Events routes
 * GET /api/events, GET /api/events/:id, POST /api/events, PATCH /api/events/:id,
 * DELETE /api/events/:id, POST /api/events/detect, GET /api/events/:id/periods,
 * POST /api/events/:id/judge, POST /api/events/gmv-check,
 * GET /api/events/summary/:creatorId, GET /api/events/policy/:owner/:eventKey
 */
const express = require('express');
const router = express.Router();
const db = require('../../db');
const { getLockedOwner, matchesOwnerScope, resolveScopedOwner, sendOwnerScopeForbidden } = require('../middleware/appAuth');
const { EVENT_KEYWORDS } = require('../constants/eventKeywords');
const {
  EVENT_DECISION_RULES_BY_KEY,
  EVENT_RECALL_KEYWORDS,
} = require('../constants/eventDecisionRules');
const { writeAudit } = require('../middleware/audit');
const {
    getLifecycleSnapshotByCreatorId,
    rebuildReplyStrategyForCreator,
} = require('../services/replyStrategyService');
const {
    evaluateCreatorLifecycle,
    persistLifecycleForCreator,
} = require('../services/lifecyclePersistenceService');
const {
  buildSourceAnchor,
  buildVerificationPatch,
  detectEventsWithMiniMax,
  loadContextWindow,
  parseEventMeta,
  verifyEventCandidate,
} = require('../services/eventVerificationService');
const { normalizeOperatorName } = require('../utils/operator');

function normalizeOwner(o) {
    return normalizeOperatorName(o, 'Beau');
}

const { getPolicy } = require('../utils/policyMatcher');
const { extractAndSaveMemories } = require('../services/memoryExtractionService');

const EVENT_STATUS_SET = new Set(['draft', 'active', 'completed', 'cancelled']);
const EVENT_STATUS_TRANSITIONS = {
  draft: new Set(['active', 'cancelled']),
  active: new Set(['completed', 'cancelled']),
  completed: new Set([]),
  cancelled: new Set([]),
  pending: new Set(['active', 'cancelled']),
};

function resolveRequestedOwner(req, res, owner, fallback = null) {
  const lockedOwner = getLockedOwner(req);
  const requestedOwner = typeof owner === 'string' ? owner.trim() : owner;
  if (lockedOwner && requestedOwner && !matchesOwnerScope(req, requestedOwner)) {
    sendOwnerScopeForbidden(res, lockedOwner);
    return null;
  }
  return resolveScopedOwner(req, requestedOwner, fallback);
}

async function ensureCreatorAccess(req, res, creatorId) {
  const row = await db.getDb().prepare(`
    SELECT id, primary_name, wa_phone, wa_owner, keeper_username
    FROM creators
    WHERE id = ?
    LIMIT 1
  `).get(creatorId);
  if (!row) {
    res.status(404).json({ ok: false, error: 'Creator not found' });
    return null;
  }
  const lockedOwner = getLockedOwner(req);
  if (lockedOwner && !matchesOwnerScope(req, row.wa_owner)) {
    sendOwnerScopeForbidden(res, lockedOwner);
    return null;
  }
  return row;
}

async function ensureEventAccess(req, res, eventId) {
  const row = await db.getDb().prepare(`
    SELECT e.*, c.primary_name as creator_name, c.wa_phone as creator_phone, c.wa_owner as creator_owner
    FROM events e
    LEFT JOIN creators c ON c.id = e.creator_id
    WHERE e.id = ?
    LIMIT 1
  `).get(eventId);
  if (!row) {
    res.status(404).json({ ok: false, error: 'Event not found' });
    return null;
  }
  const lockedOwner = getLockedOwner(req);
  if (lockedOwner && !matchesOwnerScope(req, row.creator_owner || row.owner)) {
    sendOwnerScopeForbidden(res, lockedOwner);
    return null;
  }
  return row;
}

function normalizeEventStatus(value, fallback = null) {
  const text = String(value || '').trim().toLowerCase();
  if (!text) return fallback;
  if (text === 'pending') return 'draft';
  return EVENT_STATUS_SET.has(text) ? text : fallback;
}

function toSqlDatetimeValue(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value.trim())) {
    return value.trim();
  }
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

function shouldUseMiniMaxEventDetect(body = {}) {
  const mode = String(body.mode || body.provider || body.detect_provider || '').trim().toLowerCase();
  if (['minimax', 'llm', 'semantic_llm'].includes(mode)) return true;
  if (body.use_minimax === true || body.use_llm === true) return true;
  const envMode = String(process.env.EVENT_DETECT_PROVIDER || '').trim().toLowerCase();
  return ['minimax', 'llm', 'semantic_llm'].includes(envMode);
}

function upsertDetectedCandidate(detected, candidate) {
  if (!candidate?.event_key) return;
  const existing = detected.find((item) => item.event_key === candidate.event_key);
  if (!existing) {
    detected.push(candidate);
    return;
  }
  Object.assign(existing, {
    ...candidate,
    trigger_source: [existing.trigger_source, candidate.trigger_source].filter(Boolean).join('+'),
    confidence: Math.max(Number(existing.confidence || 0), Number(candidate.confidence || 0)),
  });
}

function normalizeEvidenceText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[^a-z0-9\u4e00-\u9fff\s$]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenizeEvidence(value) {
  const normalized = normalizeEvidenceText(value);
  if (!normalized) return [];
  return [...new Set(normalized.split(' ').filter((token) => token && token.length >= 2))];
}

function buildEventEvidencePhrases(event) {
  const meta = parseEventMeta(event?.meta);
  return [...new Set([
    event?.trigger_text,
    meta?.source_text,
    meta?.source,
    meta?.summary,
    meta?.note,
    meta?.reason,
  ].map((item) => String(item || '').trim()).filter(Boolean))];
}

function buildEventEvidenceTokens(event, phrases) {
  const hinted = EVENT_RECALL_KEYWORDS[event?.event_key] || [];
  const tokens = new Set(hinted.flatMap((item) => tokenizeEvidence(item)));
  phrases.forEach((phrase) => {
    tokenizeEvidence(phrase).forEach((token) => tokens.add(token));
  });
  return [...tokens];
}

function buildVerificationSummary(meta = {}) {
  const verification = meta?.verification || meta?.llm_verification || null;
  if (!verification || typeof verification !== 'object') {
    return {
      verification_status: 'pending',
      verification_confidence: null,
      verification_reason: '',
      verification_quote: '',
      verification_event_key: null,
      verification_suggested_status: null,
      transition_suggestion: null,
      human_review_required: false,
    };
  }
  return {
    verification_status: verification.review_status || 'pending',
    verification_confidence: Number(verification.confidence || 0) || null,
    verification_reason: String(verification.reason || verification.reasoning || '').slice(0, 260),
    verification_quote: String(verification.evidence_quote || '').slice(0, 260),
    verification_event_key: verification.suggested_event_key || verification.event_key || null,
    verification_suggested_status: verification.suggested_status || verification.status || null,
    transition_suggestion: verification.transition_suggestion || null,
    human_review_required: !!verification?.transition_suggestion?.pending_human_review,
  };
}

function findAnchoredMessage(messages = [], sourceAnchor = null) {
  if (!Array.isArray(messages) || messages.length === 0 || !sourceAnchor) return null;
  const sourceId = Number(sourceAnchor.message_id || 0);
  if (sourceId > 0) {
    const exact = messages.find((message) => Number(message.id || 0) === sourceId);
    if (exact) return exact;
  }
  const messageHash = String(sourceAnchor.message_hash || '').trim();
  if (messageHash) {
    const exactHash = messages.find((message) => String(message.message_hash || '').trim() === messageHash);
    if (exactHash) return exactHash;
  }
  const anchorTs = Number(sourceAnchor.timestamp || 0);
  if (anchorTs > 0) {
    let best = null;
    let bestDiff = Number.POSITIVE_INFINITY;
    messages.forEach((message) => {
      const diff = Math.abs(Number(message.timestamp || 0) - anchorTs);
      if (diff < bestDiff) {
        best = message;
        bestDiff = diff;
      }
    });
    if (best && bestDiff <= 60 * 1000) return best;
  }
  return null;
}

function buildEventMetaPayload(inputMeta, {
  triggerSource = '',
  sourceAnchor = null,
  verification = null,
} = {}) {
  const safeMeta = parseEventMeta(inputMeta);
  const nextMeta = { ...safeMeta };
  if (sourceAnchor) {
    nextMeta.source_anchor = {
      ...(safeMeta.source_anchor || {}),
      ...sourceAnchor,
    };
  }
  if (verification) {
    nextMeta.verification = verification;
  } else if (!safeMeta.verification && String(triggerSource || '').toLowerCase().includes('semantic')) {
    nextMeta.verification = {
      review_status: 'pending',
      verdict: 'uncertain',
      confidence: null,
      reason: '',
      evidence_message_ids: [],
      evidence_quote: '',
      used_message_count: 0,
      anchor_resolution: sourceAnchor ? 'request_anchor' : 'not_set',
      model: null,
      verified_at: null,
      verified_by: null,
      suggested_event_key: null,
      suggested_status: null,
    };
  }
  return nextMeta;
}

function scoreEventEvidenceMessage(message, event, phrases, tokens) {
  const text = String(message?.text || '').trim();
  const normalized = normalizeEvidenceText(text);
  if (!normalized) return 0;

  let score = 0;

  for (const phrase of phrases) {
    const normalizedPhrase = normalizeEvidenceText(phrase);
    if (!normalizedPhrase) continue;
    if (normalized.includes(normalizedPhrase)) {
      score += 120 + Math.min(normalizedPhrase.length, 40);
      continue;
    }

    const phraseTokens = tokenizeEvidence(phrase);
    let overlap = 0;
    phraseTokens.forEach((token) => {
      if (normalized.includes(token)) overlap += token.length >= 4 ? 2 : 1;
    });
    score += overlap * 8;
  }

  tokens.forEach((token) => {
    if (normalized.includes(token)) {
      score += token.length >= 4 ? 6 : 3;
    }
  });

  if (message?.role === 'user') score += 6;
  if (String(event?.trigger_source || '').toLowerCase().includes('llm')) score += 4;

  return score;
}

async function getCreatorMessageWindow(dbConn, cache, creatorId) {
  const key = String(creatorId || '');
  if (!key) return [];
  if (!cache.has(key)) {
    const rows = await dbConn.prepare(`
      SELECT id, creator_id, role, text, timestamp, message_hash
      FROM wa_messages
      WHERE creator_id = ?
      ORDER BY timestamp DESC, id DESC
      LIMIT 400
    `).all(creatorId);
    cache.set(key, rows || []);
  }
  return cache.get(key) || [];
}

function buildEventDisplayStart(event, evidence) {
  if (evidence?.source_message_timestamp) {
    return {
      display_start_at: evidence.source_message_timestamp,
      display_start_label: '原始消息时间',
      display_start_source: 'source_message',
    };
  }
  if (event?.created_at) {
    return {
      display_start_at: event.created_at,
      display_start_label: '识别时间',
      display_start_source: 'created_at',
    };
  }
  return {
    display_start_at: event?.start_at || null,
    display_start_label: '开始时间',
    display_start_source: 'start_at',
  };
}

async function enrichEventWithEvidence(dbConn, event, messageCache = new Map()) {
  const meta = parseEventMeta(event?.meta);
  const phrases = buildEventEvidencePhrases(event);
  const tokens = buildEventEvidenceTokens(event, phrases);
  let bestMatch = null;

  if (Number(event?.creator_id) > 0 && (phrases.length > 0 || tokens.length > 0)) {
    const messages = await getCreatorMessageWindow(dbConn, messageCache, Number(event.creator_id));
    bestMatch = findAnchoredMessage(messages, meta?.source_anchor || null);
    if (!bestMatch) {
      let bestScore = 0;
      for (const message of messages) {
        const score = scoreEventEvidenceMessage(message, event, phrases, tokens);
        if (score > bestScore) {
          bestScore = score;
          bestMatch = message;
        }
      }
      if (bestScore < 20) {
        bestMatch = null;
      }
    }
  }

  const evidence = bestMatch
    ? {
        source_message_id: bestMatch.id || null,
        source_message_text: bestMatch.text || '',
        source_message_timestamp: bestMatch.timestamp || null,
        source_message_role: bestMatch.role || null,
        source_message_hash: bestMatch.message_hash || null,
      }
    : {
        source_message_id: meta?.source_anchor?.message_id || null,
        source_message_text: String(meta?.source_text || meta?.verification?.evidence_quote || '').slice(0, 500),
        source_message_timestamp: meta?.source_anchor?.timestamp || null,
        source_message_role: null,
        source_message_hash: meta?.source_anchor?.message_hash || null,
      };

  return {
    ...event,
    ...evidence,
    ...buildEventDisplayStart(event, evidence),
    ...buildVerificationSummary(meta),
    source_anchor: meta?.source_anchor || null,
    verification: meta?.verification || meta?.llm_verification || null,
  };
}

// GET /api/events
router.get('/', async (req, res) => {
  try {
    const db2 = db.getDb();
    const { status, creator_id, event_key } = req.query;
    const effectiveOwner = resolveRequestedOwner(req, res, req.query.owner, null);
    if (effectiveOwner === null && getLockedOwner(req) && req.query.owner) return;
    if (creator_id) {
      const creator = await ensureCreatorAccess(req, res, creator_id);
      if (!creator) return;
    }
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 50, 1), 1000);
    const offset = Math.max(parseInt(req.query.offset) || 0, 0);

    let sql = `SELECT e.*, c.primary_name as creator_name, c.wa_phone as creator_phone
               FROM events e
               LEFT JOIN creators c ON c.id = e.creator_id
               WHERE 1=1`;
    const params = [];

    const countParams = [];
    if (status) { sql += ` AND e.status = ?`; params.push(status); countParams.push(status); }
    if (effectiveOwner) { sql += ` AND e.owner = ?`; params.push(effectiveOwner); countParams.push(effectiveOwner); }
    if (creator_id) { sql += ` AND e.creator_id = ?`; params.push(creator_id); countParams.push(creator_id); }
    if (event_key) { sql += ` AND e.event_key = ?`; params.push(event_key); countParams.push(event_key); }

    sql += ` ORDER BY e.created_at DESC LIMIT ? OFFSET ?`;
    params.push(limit, offset);

    const countSql = `SELECT COUNT(*) as count FROM events e WHERE 1=1${status ? ' AND e.status = ?' : ''}${effectiveOwner ? ' AND e.owner = ?' : ''}${creator_id ? ' AND e.creator_id = ?' : ''}${event_key ? ' AND e.event_key = ?' : ''}`;

    const [events, total] = await Promise.all([
      db2.prepare(sql).all(...params),
      db2.prepare(countSql).get(...countParams),
    ]);

    const messageCache = new Map();
    const enrichedEvents = await Promise.all(
      (events || []).map((event) => enrichEventWithEvidence(db2, event, messageCache))
    );

    res.json({ events: enrichedEvents, total: total.count, limit: parseInt(limit), offset: parseInt(offset) });
  } catch (err) {
    console.error('GET /api/events error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/events/:id
router.get('/:id', async (req, res) => {
  try {
    const db2 = db.getDb();
    const event = await ensureEventAccess(req, res, req.params.id);
    if (!event) return;

    const enrichedEvent = await enrichEventWithEvidence(db2, event);
    enrichedEvent.policy = await getPolicy(event.owner, event.event_key);
    enrichedEvent.periods = await db2.prepare(`
      SELECT * FROM event_periods WHERE event_id = ? ORDER BY period_start DESC
    `).all(req.params.id);

    res.json(enrichedEvent);
  } catch (err) {
    console.error('GET /api/events/:id error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/events
router.post('/', async (req, res) => {
  try {
    const db2 = db.getDb();
    const { creator_id, event_key, event_type, owner, trigger_source = 'manual', trigger_text = '', start_at, end_at, meta = {} } = req.body;
    const creator = await ensureCreatorAccess(req, res, creator_id);
    if (!creator) return;
    const creatorOwner = normalizeOwner(creator.wa_owner);
    const requestedOwner = owner ? normalizeOwner(owner) : null;
    if (requestedOwner && creatorOwner && requestedOwner !== creatorOwner) {
      return res.status(400).json({ error: `owner mismatch: creator belongs to ${creatorOwner}` });
    }
    const normOwner = resolveRequestedOwner(req, res, creatorOwner || requestedOwner, creatorOwner || null);
    if (!normOwner) return;
    const requestedStatus = normalizeEventStatus(req.body?.status, null);
    const nextStatus = requestedStatus || (String(trigger_source || '').toLowerCase().includes('detect') || String(trigger_source || '').toLowerCase().includes('semantic')
      ? 'draft'
      : 'active');

    if (!creator_id || !event_key || !event_type || !normOwner) {
      return res.status(400).json({ error: 'creator_id, event_key, event_type, owner required' });
    }
    const beforeLifecycle = await evaluateCreatorLifecycle(db2, Number(creator_id))
      .then((ret) => ret?.lifecycle || null)
      .catch(() => null);

    const existing = await db2.prepare(`SELECT id FROM events WHERE creator_id = ? AND event_key = ? AND status = 'active'`).get(creator_id, event_key);
    if (nextStatus === 'active' && existing) {
      return res.status(409).json({ error: '同一达人已有相同事件处于 active 状态', existing_id: existing.id });
    }

    const sourceAnchor = buildSourceAnchor(req.body, meta);
    const nextMeta = buildEventMetaPayload(meta, {
      triggerSource: trigger_source,
      sourceAnchor,
    });
    const safeStartAt = toSqlDatetimeValue(start_at) || toSqlDatetimeValue(Date.now());
    const safeEndAt = toSqlDatetimeValue(end_at);
    const result = await db2.prepare(`
      INSERT INTO events (creator_id, event_key, event_type, owner, status, trigger_source, trigger_text, start_at, end_at, meta)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(creator_id, event_key, event_type, normOwner, nextStatus, trigger_source, trigger_text, safeStartAt, safeEndAt, JSON.stringify(nextMeta));

    // === client_memory 自动积累：事件创建后异步提取记忆 ===
    const eventId = result.lastInsertRowid;
    if (creator?.wa_phone) {
        const msgsRes = await db2.prepare(`
            SELECT role, text FROM wa_messages WHERE creator_id = ? ORDER BY timestamp DESC LIMIT 10
        `).all(creator_id);
        const messages = msgsRes ? msgsRes.reverse() : [];
        if (messages.length > 0) {
            setImmediate(() => {
                extractAndSaveMemories({
                    client_id: creator.wa_phone,
                    owner: normOwner,
                    messages,
                    trigger_type: 'event_create',
                    source_record_id: eventId,
                }).catch(e => console.error('[memoryExtraction] events.js hook error:', e.message));
            });
        }
    }

    await writeAudit('event_create', 'events', eventId, null, {
      creator_id,
      event_key,
      event_type,
      owner: normOwner,
      status: nextStatus,
      trigger_source,
      start_at: start_at || null,
      end_at: end_at || null,
    }, req);
    const persistedLifecycle = await persistLifecycleForCreator(db2, Number(creator_id), {
      triggerType: 'event_create',
      triggerId: eventId,
      triggerSource: 'events',
    }).catch(() => null);
    const afterLifecycle = persistedLifecycle?.lifecycle || await getLifecycleSnapshotByCreatorId(Number(creator_id)).catch(() => null);
    const lifecycleChanged = !!(
      beforeLifecycle?.stage_key &&
      afterLifecycle?.stage_key &&
      beforeLifecycle.stage_key !== afterLifecycle.stage_key
    );
    let strategyRebuild = null;
    if (lifecycleChanged) {
      try {
        strategyRebuild = await rebuildReplyStrategyForCreator({
          creatorId: Number(creator_id),
          trigger: 'lifecycle_change_event_create',
          allowSoftAdjust: false,
        });
      } catch (e) {
        strategyRebuild = { ok: false, reason: e.message };
      }
      await writeAudit('lifecycle_stage_transition', 'creators', Number(creator_id), {
        stage: beforeLifecycle?.stage_key || null,
      }, {
        stage: afterLifecycle?.stage_key || null,
        lifecycle_before: beforeLifecycle?.stage_key || null,
        lifecycle_after: afterLifecycle?.stage_key || null,
        lifecycle_changed: true,
        trigger: 'event_create',
        event_id: eventId,
        event_key: event_key || null,
      }, req);
    }

    res.json({
      id: eventId,
      status: nextStatus,
      lifecycle_before: beforeLifecycle?.stage_key || null,
      lifecycle_after: afterLifecycle?.stage_key || null,
      lifecycle_changed: lifecycleChanged,
      reply_strategy: strategyRebuild,
    });
  } catch (err) {
    console.error('POST /api/events error:', err);
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/events/:id
router.patch('/:id', async (req, res) => {
  try {
    const db2 = db.getDb();
    const { status, end_at, meta } = req.body;

    const existing = await ensureEventAccess(req, res, req.params.id);
    if (!existing) return;
    const creatorId = Number(existing.creator_id);
    const beforeLifecycle = await evaluateCreatorLifecycle(db2, creatorId)
      .then((ret) => ret?.lifecycle || null)
      .catch(() => null);
    const nextStatus = normalizeEventStatus(status, null);
    const currentStatus = normalizeEventStatus(existing.status, 'draft');

    if (nextStatus) {
      const allowed = EVENT_STATUS_TRANSITIONS[currentStatus] || new Set();
      if (!allowed.has(nextStatus)) {
        return res.status(400).json({ error: `非法状态流转: ${currentStatus} -> ${nextStatus}` });
      }
      if (nextStatus === 'active') {
        const activeConflict = await db2.prepare(`
          SELECT id FROM events
          WHERE creator_id = ? AND event_key = ? AND status = 'active' AND id <> ?
          LIMIT 1
        `).get(existing.creator_id, existing.event_key, req.params.id);
        if (activeConflict) {
          return res.status(409).json({ error: '同一达人已有相同事件处于 active 状态', existing_id: activeConflict.id });
        }
      }
    }

    const existingMeta = parseEventMeta(existing.meta);
    let nextMetaPayload = null;
    if (meta) {
      nextMetaPayload = {
        ...existingMeta,
        ...parseEventMeta(meta),
      };
    }
    const suggestion = existingMeta?.verification?.transition_suggestion || null;
    if (nextStatus && suggestion?.pending_human_review) {
      nextMetaPayload = nextMetaPayload || { ...existingMeta };
      nextMetaPayload.verification = {
        ...(nextMetaPayload.verification || existingMeta.verification || {}),
        transition_suggestion: {
          ...suggestion,
          pending_human_review: false,
          review_state: nextStatus === 'active' ? 'approved' : 'dismissed',
          reviewed_at: new Date().toISOString(),
          reviewed_by: 'manual',
          applied_status: nextStatus,
        },
      };
    }

    const updates = [];
    const params = [];
    if (nextStatus) { updates.push('status = ?'); params.push(nextStatus); }
    if (end_at !== undefined) { updates.push('end_at = ?'); params.push(toSqlDatetimeValue(end_at)); }
    if (nextMetaPayload) { updates.push('meta = ?'); params.push(JSON.stringify(nextMetaPayload)); }

    if (updates.length === 0) return res.status(400).json({ error: 'No fields to update' });

    updates.push('updated_at = CURRENT_TIMESTAMP');
    params.push(req.params.id);

    await db2.prepare(`UPDATE events SET ${updates.join(', ')} WHERE id = ?`).run(...params);
    const updated = await db2.prepare('SELECT * FROM events WHERE id = ?').get(req.params.id);
    await writeAudit('event_update', 'events', req.params.id, existing, updated, req);
    const persistedLifecycle = await persistLifecycleForCreator(db2, creatorId, {
      triggerType: 'event_update',
      triggerId: Number(req.params.id),
      triggerSource: 'events',
    }).catch(() => null);
    const afterLifecycle = persistedLifecycle?.lifecycle || await getLifecycleSnapshotByCreatorId(creatorId).catch(() => null);
    const lifecycleChanged = !!(
      beforeLifecycle?.stage_key &&
      afterLifecycle?.stage_key &&
      beforeLifecycle.stage_key !== afterLifecycle.stage_key
    );
    let strategyRebuild = null;
    if (lifecycleChanged) {
      try {
        strategyRebuild = await rebuildReplyStrategyForCreator({
          creatorId,
          trigger: 'lifecycle_change_event_update',
          allowSoftAdjust: false,
        });
      } catch (e) {
        strategyRebuild = { ok: false, reason: e.message };
      }
      await writeAudit('lifecycle_stage_transition', 'creators', creatorId, {
        stage: beforeLifecycle?.stage_key || null,
      }, {
        stage: afterLifecycle?.stage_key || null,
        lifecycle_before: beforeLifecycle?.stage_key || null,
        lifecycle_after: afterLifecycle?.stage_key || null,
        lifecycle_changed: true,
        trigger: 'event_update',
        event_id: Number(req.params.id),
        event_key: existing?.event_key || null,
      }, req);
    }
    res.json({
      ok: true,
      event_status: updated?.status || nextStatus || currentStatus,
      lifecycle_before: beforeLifecycle?.stage_key || null,
      lifecycle_after: afterLifecycle?.stage_key || null,
      lifecycle_changed: lifecycleChanged,
      reply_strategy: strategyRebuild,
    });
  } catch (err) {
    console.error('PATCH /api/events/:id error:', err);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/events/:id
router.delete('/:id', async (req, res) => {
  try {
    const db2 = db.getDb();
    const event = await ensureEventAccess(req, res, req.params.id);
    if (!event) return;
    if (!['pending', 'draft'].includes(String(event.status || '').toLowerCase())) {
      return res.status(400).json({ error: '只能删除 draft 状态的事件' });
    }
    const creatorId = Number(event.creator_id);
    const beforeLifecycle = await evaluateCreatorLifecycle(db2, creatorId)
      .then((ret) => ret?.lifecycle || null)
      .catch(() => null);

    await db2.transaction(async (txDb) => {
      await txDb.prepare('DELETE FROM event_periods WHERE event_id = ?').run(req.params.id);
      await txDb.prepare('DELETE FROM events WHERE id = ?').run(req.params.id);
    });
    await writeAudit('event_delete', 'events', req.params.id, event, null, req);
    const persistedLifecycle = await persistLifecycleForCreator(db2, creatorId, {
      triggerType: 'event_delete',
      triggerId: Number(req.params.id),
      triggerSource: 'events',
    }).catch(() => null);
    const afterLifecycle = persistedLifecycle?.lifecycle || await getLifecycleSnapshotByCreatorId(creatorId).catch(() => null);
    const lifecycleChanged = !!(
      beforeLifecycle?.stage_key &&
      afterLifecycle?.stage_key &&
      beforeLifecycle.stage_key !== afterLifecycle.stage_key
    );
    let strategyRebuild = null;
    if (lifecycleChanged) {
      try {
        strategyRebuild = await rebuildReplyStrategyForCreator({
          creatorId,
          trigger: 'lifecycle_change_event_delete',
          allowSoftAdjust: false,
        });
      } catch (e) {
        strategyRebuild = { ok: false, reason: e.message };
      }
      await writeAudit('lifecycle_stage_transition', 'creators', creatorId, {
        stage: beforeLifecycle?.stage_key || null,
      }, {
        stage: afterLifecycle?.stage_key || null,
        lifecycle_before: beforeLifecycle?.stage_key || null,
        lifecycle_after: afterLifecycle?.stage_key || null,
        lifecycle_changed: true,
        trigger: 'event_delete',
        event_id: Number(req.params.id),
        event_key: event?.event_key || null,
      }, req);
    }
    res.json({
      ok: true,
      lifecycle_before: beforeLifecycle?.stage_key || null,
      lifecycle_after: afterLifecycle?.stage_key || null,
      lifecycle_changed: lifecycleChanged,
      reply_strategy: strategyRebuild,
    });
  } catch (err) {
    console.error('DELETE /api/events/:id error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/events/detect
router.post('/detect', async (req, res) => {
  try {
    const { text, creator_id } = req.body;
    if (!text || !creator_id) return res.status(400).json({ error: 'text and creator_id required' });

    const db2 = db.getDb();
    const creator = await ensureCreatorAccess(req, res, creator_id);
    if (!creator) return;

    const lowerText = text.toLowerCase();
    const detected = [];
    const owner = normalizeOwner(creator.wa_owner) || 'Beau';
    const sourceAnchor = buildSourceAnchor(req.body, req.body?.meta);

    for (const [event_key, keywords] of Object.entries(EVENT_KEYWORDS)) {
      for (const kw of keywords) {
        if (lowerText.includes(kw.toLowerCase())) {
          if (!detected.find(d => d.event_key === event_key)) {
            const rule = EVENT_DECISION_RULES_BY_KEY[event_key];
            const event_type = rule?.event_type || (
              event_key === 'trial_7day' || event_key === 'monthly_challenge' ? 'challenge'
                : event_key === 'agency_bound' ? 'agency'
                : event_key === 'referral' ? 'referral' : 'incentive_task'
            );

            detected.push({
              event_key,
              event_type,
              owner,
              trigger_text: text,
              trigger_source: 'semantic_auto',
              suggested_status: 'draft',
              confidence: 0.62,
              reason: `matched keyword: ${kw}`,
              source_anchor: sourceAnchor,
              evidence_tier: 0,
              source_kind: 'keyword',
              source_quote: '',
              overlays: ['weak_event_evidence'],
              lifecycle_stage_suggestion: null,
              lifecycle_drives_main_stage: false,
              verification: {
                review_status: 'pending',
                verdict: 'uncertain',
                confidence: null,
              },
              meta: {
                evidence_contract: {
                  evidence_tier: 0,
                  source_kind: 'keyword',
                  source_message_id: sourceAnchor?.message_id || null,
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
          break;
        }
      }
    }

    const gmvKeywords = ['gmv', '$', 'revenue', '销售额', '成交'];
    for (const kw of gmvKeywords) {
      if (lowerText.includes(kw) && creator.keeper_username) {
        const keeper = await db2.prepare('SELECT * FROM keeper_link WHERE creator_id = ?').get(creator_id);
        if (keeper && keeper.keeper_gmv > 0) {
          detected.push({
            event_key: 'gmv_milestone',
            event_type: 'gmv',
            owner,
            trigger_text: text,
            trigger_source: 'gmv_crosscheck',
            gmv_current: keeper.keeper_gmv,
            suggested_status: 'draft',
            confidence: 0.8,
            reason: 'detected GMV-related keyword and keeper_gmv > 0',
            source_anchor: sourceAnchor,
            evidence_tier: 3,
            source_kind: 'external_system',
            source_quote: '',
            overlays: [],
            lifecycle_stage_suggestion: 'revenue',
            lifecycle_drives_main_stage: true,
            verification: {
              review_status: 'pending',
              verdict: 'uncertain',
              confidence: null,
            },
            meta: {
              threshold: keeper.keeper_gmv >= 10000 ? 10000 : (keeper.keeper_gmv >= 5000 ? 5000 : 2000),
              current_gmv: keeper.keeper_gmv,
              evidence_contract: {
                evidence_tier: 3,
                source_kind: 'external_system',
                source_message_id: sourceAnchor?.message_id || null,
                source_quote: '',
                external_system: 'keeper_link',
                verified_by: 'system_crosscheck',
                verified_at: new Date().toISOString(),
              },
              lifecycle_overlay: {
                overlays: [],
                lifecycle_stage_suggestion: 'revenue',
                drives_main_stage: true,
              },
            },
          });
        }
        break;
      }
    }

    let minimax = null;
    if (shouldUseMiniMaxEventDetect(req.body)) {
      try {
        const result = await detectEventsWithMiniMax({
          dbConn: db2,
          creatorId: Number(creator_id),
          owner,
          text,
          sourceAnchor,
          contextWindow: req.body?.context_window || {},
          model: req.body?.model || null,
        });
        (result.normalized?.detected || []).forEach((candidate) => upsertDetectedCandidate(detected, candidate));
        minimax = {
          ok: true,
          provider: 'minimax',
          model: result.model || null,
          detected_count: result.normalized?.detected?.length || 0,
          overlays: result.normalized?.overlays || [],
          lifecycle_stage_suggestion: result.normalized?.lifecycle_stage_suggestion || null,
          reason: result.normalized?.reason || '',
          context_stats: result.context?.stats || null,
        };
      } catch (err) {
        minimax = {
          ok: false,
          provider: 'minimax',
          error: err.message,
        };
      }
    }

    res.json({
      detected,
      creator_id,
      creator_name: creator.primary_name,
      minimax,
    });
  } catch (err) {
    console.error('POST /api/events/detect error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/events/verify
router.post('/verify', async (req, res) => {
  try {
    const db2 = db.getDb();
    const creatorId = Number(req.body?.creator_id || 0);
    if (!creatorId) return res.status(400).json({ error: 'creator_id required' });
    const creator = await ensureCreatorAccess(req, res, creatorId);
    if (!creator) return;
    if (req.body?.owner && normalizeOwner(req.body.owner) !== normalizeOwner(creator.wa_owner)) {
      return res.status(400).json({ error: `owner mismatch: creator belongs to ${normalizeOwner(creator.wa_owner)}` });
    }

    const owner = resolveRequestedOwner(req, res, creator.wa_owner || req.body?.owner || 'Beau', creator.wa_owner || 'Beau');
    if (!owner) return;
    const candidate = {
      event_key: req.body?.candidate?.event_key || req.body?.event_key || null,
      event_type: req.body?.candidate?.event_type || req.body?.event_type || null,
      trigger_text: req.body?.candidate?.trigger_text || req.body?.trigger_text || '',
      status: normalizeEventStatus(req.body?.candidate?.status || req.body?.status, 'draft'),
      suggested_status: normalizeEventStatus(req.body?.candidate?.suggested_status, 'draft'),
      source_anchor: buildSourceAnchor(req.body?.candidate || req.body, req.body?.candidate?.meta || req.body?.meta),
    };
    if (!candidate.event_key) return res.status(400).json({ error: 'candidate.event_key required' });

    const result = await verifyEventCandidate({
      dbConn: db2,
      creatorId,
      owner,
      candidate,
      contextWindow: req.body?.context_window || {},
    });

    res.json({
      ok: true,
      verdict: result.normalized.verdict,
      normalized_event: {
        event_key: result.normalized.event_key,
        event_type: EVENT_DECISION_RULES_BY_KEY[result.normalized.event_key]?.event_type || candidate.event_type,
        status: result.normalized.status,
        owner,
        trigger_text: candidate.trigger_text,
        start_at: result.normalized.start_at,
        meta: result.normalized.meta,
      },
      verification: {
        ...result.normalized,
        used_message_count: result.context?.stats?.used_count || 0,
        anchor_resolution: result.context?.anchor?.resolution || 'not_found',
        source_anchor: result.context?.anchor || null,
      },
      context: result.context,
    });
  } catch (err) {
    console.error('POST /api/events/verify error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/events/:id/verify
router.post('/:id/verify', async (req, res) => {
  try {
    const db2 = db.getDb();
    const existing = await ensureEventAccess(req, res, req.params.id);
    if (!existing) return;

    const baseMeta = parseEventMeta(existing.meta);
    const candidate = {
      event_key: existing.event_key,
      event_type: existing.event_type,
      trigger_text: existing.trigger_text || '',
      status: normalizeEventStatus(existing.status, 'draft'),
      source_anchor: buildSourceAnchor({}, baseMeta),
    };
    const result = await verifyEventCandidate({
      dbConn: db2,
      creatorId: Number(existing.creator_id),
      owner: normalizeOwner(existing.owner),
      candidate,
      contextWindow: req.body?.context_window || {},
    });
    const nextMeta = buildVerificationPatch(baseMeta, result.normalized, result.context, {
      currentStatus: existing.status,
    });
    nextMeta.context_window = (result.context?.messages || []).map((message) => ({
      id: message.id,
      role: message.role,
      timestamp: message.timestamp,
      text: String(message.text || '').slice(0, 220),
    }));

    await db2.prepare(`
      UPDATE events
      SET meta = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(JSON.stringify(nextMeta), req.params.id);

    const updated = await db2.prepare(`
      SELECT e.*, c.primary_name as creator_name, c.wa_phone as creator_phone
      FROM events e
      LEFT JOIN creators c ON c.id = e.creator_id
      WHERE e.id = ?
    `).get(req.params.id);
    const hydratedEvent = await enrichEventWithEvidence(db2, updated);
    hydratedEvent.policy = await getPolicy(updated.owner, updated.event_key);
    hydratedEvent.periods = await db2.prepare(`
      SELECT * FROM event_periods WHERE event_id = ? ORDER BY period_start DESC
    `).all(req.params.id);

    await writeAudit('event_verify', 'events', req.params.id, existing, {
      ...updated,
      meta: nextMeta,
    }, req);

    res.json({
      ok: true,
      verification: nextMeta.verification,
      transition_suggestion: nextMeta.verification?.transition_suggestion || null,
      event: hydratedEvent,
    });
  } catch (err) {
    console.error('POST /api/events/:id/verify error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/events/:id/verification-context
router.get('/:id/verification-context', async (req, res) => {
  try {
    const db2 = db.getDb();
    const existing = await ensureEventAccess(req, res, req.params.id);
    if (!existing) return;

    const meta = parseEventMeta(existing.meta);
    const context = await loadContextWindow(db2, {
      creatorId: Number(existing.creator_id),
      sourceAnchor: buildSourceAnchor({}, meta),
      triggerText: existing.trigger_text || '',
      eventKey: existing.event_key,
      before: req.query?.before,
      after: req.query?.after,
    });

    res.json({
      ok: true,
      event_id: Number(existing.id),
      source_anchor: context.anchor,
      stats: context.stats,
      messages: context.messages,
    });
  } catch (err) {
    console.error('GET /api/events/:id/verification-context error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/events/:id/periods
router.get('/:id/periods', async (req, res) => {
  try {
    const db2 = db.getDb();
    const event = await ensureEventAccess(req, res, req.params.id);
    if (!event) return;
    const periods = await db2.prepare(`
      SELECT * FROM event_periods WHERE event_id = ? ORDER BY period_start DESC
    `).all(req.params.id);
    res.json({ periods });
  } catch (err) {
    console.error('GET /api/events/:id/periods error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/events/:id/judge
router.post('/:id/judge', async (req, res) => {
  try {
    const db2 = db.getDb();
    const { period_start, period_end, video_count } = req.body;

    const event = await ensureEventAccess(req, res, req.params.id);
    if (!event) return;

    const policy = await getPolicy(event.owner, event.event_key);
    if (!policy) return res.status(400).json({ error: `No policy found for ${event.owner}/${event.event_key}` });

    let bonus_earned = 0;
    const weekly_target = policy.weekly_target || 35;
    const bonus_per_video = policy.bonus_per_video || 5;

    if (video_count >= weekly_target) {
      bonus_earned = video_count * bonus_per_video;
    }

    const existingPeriod = await db2.prepare(`SELECT id FROM event_periods WHERE event_id = ? AND period_start = ?`).get(req.params.id, period_start);
    let periodId;
    if (existingPeriod) {
      await db2.prepare(`
        UPDATE event_periods SET video_count = ?, bonus_earned = ?, status = 'settled', updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(video_count, bonus_earned, existingPeriod.id);
      periodId = existingPeriod.id;
    } else {
      const result = await db2.prepare(`
        INSERT INTO event_periods (event_id, period_start, period_end, video_count, bonus_earned, status)
        VALUES (?, ?, ?, ?, ?, 'settled')
      `).run(req.params.id, period_start, period_end || period_start, video_count, bonus_earned);
      periodId = result.lastInsertRowid;
    }

    res.json({
      period_id: periodId,
      event_id: event.id,
      event_key: event.event_key,
      video_count,
      weekly_target,
      bonus_earned,
      policy,
    });
  } catch (err) {
    console.error('POST /api/events/:id/judge error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/events/gmv-check
router.post('/gmv-check', async (req, res) => {
  try {
    const db2 = db.getDb();
    const effectiveOwner = resolveRequestedOwner(req, res, req.body?.owner || req.query?.owner, null);
    if (effectiveOwner === null && getLockedOwner(req) && (req.body?.owner || req.query?.owner)) return;
    const activeGmvEvents = await db2.prepare(`
      SELECT e.*, c.primary_name as creator_name, c.keeper_username
      FROM events e
      JOIN creators c ON c.id = e.creator_id
      WHERE e.event_type = 'gmv' AND e.status = 'active'
      ${effectiveOwner ? 'AND e.owner = ?' : ''}
    `).all(...(effectiveOwner ? [effectiveOwner] : []));

    if (activeGmvEvents.length === 0) {
      return res.json({ events: [] });
    }

    // Batch fetch all keeper_links upfront (fixes N+1)
    const creatorIds = activeGmvEvents.map(e => e.creator_id);
    const keepers = await db2.prepare(`SELECT * FROM keeper_link WHERE creator_id IN (${creatorIds.map(() => '?').join(',')})`).all(...creatorIds);
    const keeperMap = {};
    keepers.forEach(k => { keeperMap[k.creator_id] = k; });

    // Batch fetch all event_periods upfront (fixes N+1)
    const eventIds = activeGmvEvents.map(e => e.id);
    const periods = await db2.prepare(`SELECT * FROM event_periods WHERE event_id IN (${eventIds.map(() => '?').join(',')}) AND status = 'pending'`).all(...eventIds);
    const periodMap = {};
    periods.forEach(p => {
      if (!periodMap[p.event_id] || new Date(p.period_end) > new Date(periodMap[p.event_id].period_end)) {
        periodMap[p.event_id] = p;
      }
    });

    const results = [];
    for (const evt of activeGmvEvents) {
      const keeper = keeperMap[evt.creator_id];
      if (!keeper) continue;

      const gmv = keeper.keeper_gmv || 0;
      const policy = await getPolicy(evt.owner, 'gmv_milestone');

      let totalReward = 0;
      if (policy && policy.gmv_milestones) {
        for (const milestone of policy.gmv_milestones) {
          if (gmv >= milestone.threshold) {
            if (milestone.reward_type === 'cash') totalReward += milestone.value;
            else if (milestone.reward_type === 'commission_boost') {
              const recentPeriod = periodMap[evt.id];
              if (recentPeriod && recentPeriod.video_count >= 35) {
                totalReward += milestone.value;
              }
            }
          }
        }
      }

      results.push({
        event_id: evt.id,
        creator_id: evt.creator_id,
        creator_name: evt.creator_name,
        keeper_username: evt.keeper_username,
        gmv_current: gmv,
        estimated_reward: totalReward,
        status: evt.status,
      });
    }

    res.json({ events: results });
  } catch (err) {
    console.error('POST /api/events/gmv-check error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/events/summary/:creatorId
router.get('/summary/:creatorId', async (req, res) => {
  try {
    const db2 = db.getDb();
    const creatorId = req.params.creatorId;

    const creator = await ensureCreatorAccess(req, res, creatorId);
    if (!creator) return;

    const rawEvents = await db2.prepare(`SELECT * FROM events WHERE creator_id = ? ORDER BY created_at DESC`).all(creatorId);
    const messageCache = new Map();
    const events = await Promise.all(
      (rawEvents || []).map((event) => enrichEventWithEvidence(db2, event, messageCache))
    );
    const activeEvents = events.filter(e => e.status === 'active');
    const completedEvents = events.filter(e => e.status === 'completed');

    const summary = {
      creator_id: creatorId,
      creator_name: creator.primary_name,
      wa_owner: creator.wa_owner,
      total_events: events.length,
      active_count: activeEvents.length,
      completed_count: completedEvents.length,
      by_type: {},
      by_status: {},
    };

    for (const evt of events) {
      summary.by_type[evt.event_key] = (summary.by_type[evt.event_key] || 0) + 1;
      summary.by_status[evt.status] = (summary.by_status[evt.status] || 0) + 1;
    }

    res.json({ summary, events });
  } catch (err) {
    console.error('GET /api/events/summary/:creatorId error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/events/policy/:owner/:eventKey
router.get('/policy/:owner/:eventKey', async (req, res) => {
  try {
    const effectiveOwner = resolveRequestedOwner(req, res, req.params.owner, null);
    if (!effectiveOwner) return;
    const { eventKey } = req.params;
    const policy = await getPolicy(effectiveOwner, eventKey);
    if (!policy) return res.status(404).json({ error: 'Policy not found' });
    res.json({ owner: effectiveOwner, event_key: eventKey, policy });
  } catch (err) {
    console.error('GET /api/events/policy error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
