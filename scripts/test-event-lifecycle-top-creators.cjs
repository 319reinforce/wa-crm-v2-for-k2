#!/usr/bin/env node
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const db = require('../db');
const {
  EVENT_RECALL_KEYWORDS,
  EVENT_DECISION_RULES_BY_KEY,
} = require('../server/constants/eventDecisionRules');
const {
  detectEventsWithMiniMax,
} = require('../server/services/eventVerificationService');
const {
  evaluateCreatorLifecycle,
} = require('../server/services/lifecyclePersistenceService');
const {
  canEventDriveLifecycle,
  normalizeLifecycleEventRow,
} = require('../server/services/eventLifecycleFacts');

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

function normalizeOwner(value) {
  const text = String(value || '').trim();
  if (/^yiyun$/i.test(text)) return 'Yiyun';
  if (/^beau$/i.test(text)) return 'Beau';
  return text || 'Beau';
}

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff\s$-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function scoreMessageForEvents(message) {
  const text = normalizeText(message.text);
  if (!text) return { score: 0, matched: [] };
  const matched = [];
  for (const [eventKey, keywords] of Object.entries(EVENT_RECALL_KEYWORDS)) {
    const hits = (keywords || []).filter((keyword) => {
      const kw = normalizeText(keyword);
      return kw && text.includes(kw);
    });
    if (hits.length > 0) {
      matched.push({ event_key: eventKey, hits });
    }
  }
  const score = matched.reduce((sum, item) => sum + item.hits.length * 10, 0)
    + (message.role === 'user' ? 2 : 0)
    + Math.min(String(message.text || '').length / 200, 4);
  return { score, matched };
}

function pickHighSignalMessages(messages, limit) {
  const scored = messages
    .map((message) => ({ ...message, event_score: scoreMessageForEvents(message) }))
    .filter((message) => message.event_score.score > 0)
    .sort((a, b) => {
      const diff = b.event_score.score - a.event_score.score;
      if (diff !== 0) return diff;
      return Number(b.timestamp || 0) - Number(a.timestamp || 0);
    });

  const selected = [];
  const seenKeys = new Map();
  for (const message of scored) {
    const keys = message.event_score.matched.map((item) => item.event_key);
    const hasUnderrepresentedKey = keys.some((key) => (seenKeys.get(key) || 0) < 2);
    if (selected.length < Math.ceil(limit / 2) || hasUnderrepresentedKey) {
      selected.push(message);
      keys.forEach((key) => seenKeys.set(key, (seenKeys.get(key) || 0) + 1));
    }
    if (selected.length >= limit) break;
  }

  return selected.sort((a, b) => Number(a.timestamp || 0) - Number(b.timestamp || 0));
}

function summarizeLocalKeywordMatches(messages = []) {
  const summary = {};
  for (const message of messages) {
    const scored = scoreMessageForEvents(message);
    for (const match of scored.matched) {
      summary[match.event_key] = summary[match.event_key] || {
        message_count: 0,
        hit_count: 0,
        sample_message_ids: [],
      };
      summary[match.event_key].message_count += 1;
      summary[match.event_key].hit_count += match.hits.length;
      if (summary[match.event_key].sample_message_ids.length < 5) {
        summary[match.event_key].sample_message_ids.push(Number(message.id));
      }
    }
  }
  return summary;
}

async function fetchTopCreators(dbConn, limit) {
  return dbConn.prepare(`
    SELECT c.id, c.primary_name, c.wa_owner, COUNT(wm.id) AS message_count
    FROM creators c
    JOIN wa_messages wm ON wm.creator_id = c.id
    WHERE c.is_active = 1
      AND c.wa_phone IS NOT NULL
    GROUP BY c.id, c.primary_name, c.wa_owner
    ORDER BY message_count DESC, c.id ASC
    LIMIT ${limit}
  `).all();
}

async function fetchMessages(dbConn, creatorId) {
  return dbConn.prepare(`
    SELECT id, creator_id, role, text, timestamp, message_hash
    FROM wa_messages
    WHERE creator_id = ?
      AND text IS NOT NULL
      AND TRIM(text) <> ''
    ORDER BY timestamp ASC, id ASC
  `).all(creatorId);
}

async function fetchExistingEvents(dbConn, creatorId) {
  return dbConn.prepare(`
    SELECT id, creator_id, event_key, event_type, owner, status, trigger_source, trigger_text, start_at, end_at, created_at, updated_at, meta
    FROM events
    WHERE creator_id = ?
    ORDER BY created_at DESC, id DESC
  `).all(creatorId);
}

function summarizeCandidates(candidates = []) {
  const byKey = {};
  const driving = [];
  for (const candidate of candidates) {
    const eventKey = candidate.event_key || 'unknown';
    byKey[eventKey] = byKey[eventKey] || {
      count: 0,
      max_tier: 0,
      statuses: {},
      overlays: new Set(),
    };
    byKey[eventKey].count += 1;
    byKey[eventKey].max_tier = Math.max(byKey[eventKey].max_tier, Number(candidate.evidence_tier || 0));
    const status = candidate.suggested_status || candidate.status || 'draft';
    byKey[eventKey].statuses[status] = (byKey[eventKey].statuses[status] || 0) + 1;
    (candidate.overlays || []).forEach((overlay) => byKey[eventKey].overlays.add(overlay));

    const simulated = normalizeLifecycleEventRow({
      event_key: candidate.event_key,
      event_type: candidate.event_type || EVENT_DECISION_RULES_BY_KEY[eventKey]?.event_type,
      status,
      meta: candidate.meta || {},
    });
    if (canEventDriveLifecycle(simulated)) driving.push(candidate);
  }

  return {
    by_key: Object.fromEntries(Object.entries(byKey).map(([key, value]) => [key, {
      ...value,
      overlays: [...value.overlays],
    }])),
    lifecycle_driving_candidate_count: driving.length,
  };
}

function summarizeExistingEvents(events = []) {
  const summary = {};
  for (const rawEvent of events) {
    const event = normalizeLifecycleEventRow(rawEvent);
    const key = event.event_key || 'unknown';
    summary[key] = summary[key] || {
      count: 0,
      lifecycle_driving_count: 0,
      statuses: {},
      trigger_sources: {},
    };
    summary[key].count += 1;
    summary[key].statuses[event.status || 'unknown'] = (summary[key].statuses[event.status || 'unknown'] || 0) + 1;
    summary[key].trigger_sources[event.trigger_source || 'unknown'] = (summary[key].trigger_sources[event.trigger_source || 'unknown'] || 0) + 1;
    if (canEventDriveLifecycle(event)) summary[key].lifecycle_driving_count += 1;
  }
  return summary;
}

async function runCreator(dbConn, creator, options) {
  const owner = normalizeOwner(creator.wa_owner);
  const [messages, existingEvents, beforeEval] = await Promise.all([
    fetchMessages(dbConn, creator.id),
    fetchExistingEvents(dbConn, creator.id),
    evaluateCreatorLifecycle(dbConn, creator.id).catch((err) => ({ error: err.message })),
  ]);
  const selectedMessages = pickHighSignalMessages(messages, options.maxLlmMessages);
  const candidates = [];
  const errors = [];

  for (const message of selectedMessages) {
    if (options.noLlm) {
      for (const match of message.event_score.matched) {
        candidates.push({
          event_key: match.event_key,
          event_type: EVENT_DECISION_RULES_BY_KEY[match.event_key]?.event_type || 'incentive_task',
          suggested_status: 'draft',
          evidence_tier: 0,
          source_kind: 'keyword',
          reason: `local keyword hits: ${match.hits.join(', ')}`,
          overlays: ['weak_event_evidence'],
          meta: {
            evidence_contract: {
              evidence_tier: 0,
              source_kind: 'keyword',
              source_message_id: message.id,
              source_quote: '',
            },
            lifecycle_overlay: {
              overlays: ['weak_event_evidence'],
              drives_main_stage: false,
            },
          },
        });
      }
      continue;
    }

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
      (ret.normalized?.detected || []).forEach((candidate) => {
        candidates.push({
          ...candidate,
          source_message_id: message.id,
        });
      });
    } catch (err) {
      errors.push({ message_id: message.id, error: err.message });
    }
  }

  const existingLifecycleEvents = existingEvents
    .map((event) => normalizeLifecycleEventRow(event))
    .filter((event) => canEventDriveLifecycle(event));

  return {
    creator_id: Number(creator.id),
    creator_name: creator.primary_name || null,
    owner,
    message_count: Number(creator.message_count || messages.length || 0),
    scanned_message_count: messages.length,
    high_signal_message_count: selectedMessages.length,
    existing_event_count: existingEvents.length,
    existing_lifecycle_driving_event_count: existingLifecycleEvents.length,
    existing_event_summary: summarizeExistingEvents(existingEvents),
    local_keyword_summary_all_messages: summarizeLocalKeywordMatches(messages),
    current_lifecycle_stage: beforeEval?.lifecycle?.stage_key || beforeEval?.error || null,
    current_lifecycle_flags: beforeEval?.lifecycle?.flags || null,
    candidate_count: candidates.length,
    candidate_summary: summarizeCandidates(candidates),
    selected_messages: selectedMessages.map((message) => ({
      id: Number(message.id),
      role: message.role,
      timestamp: Number(message.timestamp || 0),
      matched_event_keys: message.event_score.matched.map((item) => item.event_key),
      preview: String(message.text || '').replace(/\s+/g, ' ').slice(0, 180),
    })),
    errors,
  };
}

async function main() {
  const options = {
    creatorLimit: toPositiveInt(getArg('--creator-limit'), 3),
    maxLlmMessages: toPositiveInt(getArg('--max-llm-messages-per-creator'), 12),
    noLlm: hasFlag('--no-llm'),
    output: getArg('--output', path.join('reports', 'event-lifecycle-top-creators-20260425.json')),
  };
  if (!options.noLlm && !process.env.MINIMAX_API_KEY) {
    throw new Error('MINIMAX_API_KEY is required unless --no-llm is set');
  }

  const dbConn = db.getDb();
  const creators = await fetchTopCreators(dbConn, options.creatorLimit);
  const results = [];
  for (const creator of creators) {
    console.log(`[test] creator=${creator.id} ${creator.primary_name || '-'} messages=${creator.message_count}`);
    results.push(await runCreator(dbConn, creator, options));
  }

  const output = {
    generated_at: new Date().toISOString(),
    mode: options.noLlm ? 'local-keyword-only' : 'minimax-dry-run',
    options,
    creators: results,
  };
  fs.mkdirSync(path.dirname(options.output), { recursive: true });
  fs.writeFileSync(options.output, `${JSON.stringify(output, null, 2)}\n`);
  console.log(`[test] wrote ${options.output}`);
  console.log(JSON.stringify(results.map((result) => ({
    creator_id: result.creator_id,
    name: result.creator_name,
    messages: result.message_count,
    selected: result.high_signal_message_count,
    candidates: result.candidate_count,
    current_lifecycle_stage: result.current_lifecycle_stage,
    errors: result.errors.length,
    by_key: result.candidate_summary.by_key,
  })), null, 2));
  await db.closeDb();
}

main().catch(async (err) => {
  console.error(err.message);
  await db.closeDb().catch(() => {});
  process.exitCode = 1;
});
