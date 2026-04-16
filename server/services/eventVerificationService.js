const {
  EVENT_DECISION_RULES,
  EVENT_DECISION_RULES_BY_KEY,
  EVENT_RECALL_KEYWORDS,
} = require('../constants/eventDecisionRules');

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_API_BASE = process.env.OPENAI_API_BASE || 'https://api.openai.com/v1';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o';

const VERDICT_SET = new Set(['confirm', 'reject', 'uncertain']);
const REVIEW_STATUS_MAP = {
  confirm: 'confirmed',
  reject: 'rejected',
  uncertain: 'uncertain',
};
const EVENT_STATUS_SET = new Set(['draft', 'active', 'completed', 'cancelled']);

function parseEventMeta(value) {
  if (!value) return {};
  if (typeof value === 'object' && !Array.isArray(value)) return value;
  try {
    return JSON.parse(value);
  } catch (_) {
    return {};
  }
}

function normalizeEventText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[^a-z0-9\u4e00-\u9fff\s$-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenizeText(value) {
  const normalized = normalizeEventText(value);
  if (!normalized) return [];
  return [...new Set(normalized.split(' ').filter((token) => token && token.length >= 2))];
}

function limitText(value, max = 320) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function clampWindow(value, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(0, Math.min(Math.trunc(numeric), 50));
}

function toTimestampMs(value) {
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) return numeric > 1e12 ? Math.floor(numeric) : Math.floor(numeric * 1000);
  const dateTs = new Date(value || 0).getTime();
  return Number.isFinite(dateTs) && dateTs > 0 ? dateTs : 0;
}

function toIsoOrNull(value) {
  const ts = toTimestampMs(value);
  return ts > 0 ? new Date(ts).toISOString() : null;
}

function buildSourceAnchor(input = {}, fallbackMeta = {}) {
  const meta = parseEventMeta(fallbackMeta);
  const existing = meta.source_anchor && typeof meta.source_anchor === 'object' ? meta.source_anchor : {};
  const sourceAnchor = {
    message_id: input.source_message_id ?? input.message_id ?? existing.message_id ?? null,
    timestamp: input.source_message_timestamp ?? input.timestamp ?? existing.timestamp ?? null,
    message_hash: input.source_message_hash ?? input.message_hash ?? existing.message_hash ?? null,
  };
  if (!sourceAnchor.message_id && !sourceAnchor.timestamp && !sourceAnchor.message_hash) return null;
  return sourceAnchor;
}

function scoreMessageAgainstTrigger(message, triggerText = '', fallbackKeywords = []) {
  const messageText = normalizeEventText(message?.text || '');
  if (!messageText) return 0;
  const triggerTokens = tokenizeText(triggerText);
  const hintedTokens = new Set(triggerTokens);
  fallbackKeywords.forEach((keyword) => tokenizeText(keyword).forEach((token) => hintedTokens.add(token)));

  let score = 0;
  const normalizedTrigger = normalizeEventText(triggerText);
  if (normalizedTrigger && (messageText.includes(normalizedTrigger) || normalizedTrigger.includes(messageText))) {
    score += 140;
  }
  hintedTokens.forEach((token) => {
    if (messageText.includes(token)) score += token.length >= 4 ? 10 : 5;
  });
  if (message?.role === 'user') score += 4;
  return score;
}

async function queryMessageById(dbConn, creatorId, messageId) {
  if (!Number(messageId)) return null;
  return dbConn.prepare(`
    SELECT id, creator_id, role, text, timestamp, message_hash
    FROM wa_messages
    WHERE creator_id = ? AND id = ?
    LIMIT 1
  `).get(creatorId, Number(messageId));
}

async function queryMessageByHash(dbConn, creatorId, messageHash) {
  if (!messageHash) return null;
  return dbConn.prepare(`
    SELECT id, creator_id, role, text, timestamp, message_hash
    FROM wa_messages
    WHERE creator_id = ? AND message_hash = ?
    LIMIT 1
  `).get(creatorId, String(messageHash));
}

async function queryMessageByTimestamp(dbConn, creatorId, timestampMs) {
  if (!timestampMs) return null;
  return dbConn.prepare(`
    SELECT id, creator_id, role, text, timestamp, message_hash
    FROM wa_messages
    WHERE creator_id = ?
    ORDER BY ABS(timestamp - ?), id DESC
    LIMIT 1
  `).get(creatorId, Number(timestampMs));
}

async function queryRecentMessages(dbConn, creatorId, limit = 100) {
  const safeLimit = Math.max(1, Math.min(Math.trunc(Number(limit) || 100), 400));
  return dbConn.prepare(`
    SELECT id, creator_id, role, text, timestamp, message_hash
    FROM wa_messages
    WHERE creator_id = ?
    ORDER BY timestamp DESC, id DESC
    LIMIT ${safeLimit}
  `).all(creatorId);
}

async function resolveSourceAnchor(dbConn, { creatorId, sourceAnchor = null, triggerText = '', eventKey = '' }) {
  const anchor = sourceAnchor || {};
  const fallbackKeywords = EVENT_RECALL_KEYWORDS[eventKey] || [];

  const byId = await queryMessageById(dbConn, creatorId, anchor.message_id);
  if (byId) {
    return { anchorMessage: byId, resolution: 'exact_id' };
  }

  const byHash = await queryMessageByHash(dbConn, creatorId, anchor.message_hash);
  if (byHash) {
    return { anchorMessage: byHash, resolution: 'exact_hash' };
  }

  const timestampMs = toTimestampMs(anchor.timestamp);
  if (timestampMs > 0) {
    const byTimestamp = await queryMessageByTimestamp(dbConn, creatorId, timestampMs);
    if (byTimestamp) {
      const diff = Math.abs(toTimestampMs(byTimestamp.timestamp) - timestampMs);
      if (diff <= 60 * 1000) {
        return { anchorMessage: byTimestamp, resolution: 'nearest_timestamp' };
      }
    }
  }

  const recentMessages = await queryRecentMessages(dbConn, creatorId, 100);
  if (recentMessages.length > 0) {
    let best = null;
    let bestScore = 0;
    recentMessages.forEach((message) => {
      const score = scoreMessageAgainstTrigger(message, triggerText, fallbackKeywords);
      if (score > bestScore) {
        bestScore = score;
        best = message;
      }
    });
    if (best && bestScore >= 18) {
      return { anchorMessage: best, resolution: 'trigger_text_match' };
    }

    const latest = [...recentMessages].sort((a, b) => {
      const tsDiff = toTimestampMs(b.timestamp) - toTimestampMs(a.timestamp);
      if (tsDiff !== 0) return tsDiff;
      return Number(b.id || 0) - Number(a.id || 0);
    })[0];
    if (latest) {
      return { anchorMessage: latest, resolution: 'recent_10_fallback' };
    }
  }

  return { anchorMessage: null, resolution: 'not_found' };
}

async function loadContextWindow(dbConn, { creatorId, sourceAnchor = null, triggerText = '', eventKey = '', before = 5, after = 4 }) {
  const safeBefore = clampWindow(before, 5);
  const safeAfter = clampWindow(after, 4);
  const { anchorMessage, resolution } = await resolveSourceAnchor(dbConn, {
    creatorId,
    sourceAnchor,
    triggerText,
    eventKey,
  });

  if (!anchorMessage) {
    return {
      anchor: {
        message_id: null,
        timestamp: null,
        message_hash: null,
        resolution,
      },
      messages: [],
      stats: {
        before_count: 0,
        after_count: 0,
        used_count: 0,
      },
    };
  }

  const anchorTs = Number(anchorMessage.timestamp || 0);
  const anchorId = Number(anchorMessage.id || 0);
  const beforeRows = safeBefore > 0
    ? await dbConn.prepare(`
        SELECT id, creator_id, role, text, timestamp, message_hash
        FROM wa_messages
        WHERE creator_id = ?
          AND (timestamp < ? OR (timestamp = ? AND id < ?))
        ORDER BY timestamp DESC, id DESC
        LIMIT ${safeBefore}
      `).all(creatorId, anchorTs, anchorTs, anchorId)
    : [];
  const afterRows = safeAfter > 0
    ? await dbConn.prepare(`
        SELECT id, creator_id, role, text, timestamp, message_hash
        FROM wa_messages
        WHERE creator_id = ?
          AND (timestamp > ? OR (timestamp = ? AND id > ?))
        ORDER BY timestamp ASC, id ASC
        LIMIT ${safeAfter}
      `).all(creatorId, anchorTs, anchorTs, anchorId)
    : [];

  const messages = [...beforeRows.reverse(), anchorMessage, ...afterRows].map((message) => ({
    id: Number(message.id || 0),
    creator_id: Number(message.creator_id || creatorId || 0),
    role: message.role || '',
    text: String(message.text || ''),
    timestamp: Number(message.timestamp || 0),
    message_hash: message.message_hash || null,
  }));

  return {
    anchor: {
      message_id: anchorMessage.id || null,
      timestamp: anchorMessage.timestamp || null,
      message_hash: anchorMessage.message_hash || null,
      resolution,
    },
    messages,
    stats: {
      before_count: beforeRows.length,
      after_count: afterRows.length,
      used_count: messages.length,
    },
  };
}

function buildRuleSummary() {
  return EVENT_DECISION_RULES.map((rule) => {
    const positive = (rule.positive_signals || []).map((item) => `- ${item}`).join('\n');
    const negative = (rule.negative_signals || []).map((item) => `- ${item}`).join('\n');
    const statuses = Object.entries(rule.status_guidance || {}).map(([status, desc]) => `  - ${status}: ${desc}`).join('\n');
    return [
      `${rule.event_key} (${rule.event_type}, ${rule.label})`,
      `Allowed owners: ${(rule.owner_scope || []).join(', ') || 'all'}`,
      `Recall keywords: ${(rule.recall_keywords || []).join(', ')}`,
      `Positive signals:\n${positive || '- none'}`,
      `Negative signals:\n${negative || '- none'}`,
      `Status guidance:\n${statuses || '  - draft: keep as draft if unclear'}`,
    ].join('\n');
  }).join('\n\n');
}

function buildEventVerificationPrompt({ owner = 'Beau', candidate = {}, messages = [] }) {
  const transcript = (messages || []).map((message) => {
    const role = message.role === 'me' ? owner : 'Creator';
    const when = toIsoOrNull(message.timestamp) || '-';
    return `[${message.id}][${role}][${when}] ${limitText(message.text, 280)}`;
  }).join('\n');

  const ruleSummary = buildRuleSummary();
  const candidateKey = String(candidate.event_key || '').trim();
  const candidateStatus = String(candidate.status || candidate.suggested_status || 'draft').trim();
  const candidateTriggerText = limitText(candidate.trigger_text || candidate.source_text || '', 240);
  const candidateRule = EVENT_DECISION_RULES_BY_KEY[candidateKey];

  const systemPrompt = [
    'You are a WhatsApp CRM event verifier.',
    'Your job is to judge whether a candidate event is supported by the provided 10-message conversation window.',
    'Only use the messages provided. Never infer facts that do not appear in the conversation.',
    'If evidence is insufficient or ambiguous, return verdict=uncertain.',
    'If the candidate event key is wrong but another listed event is clearly supported, return that event_key.',
    'You must return strict JSON only.',
    '',
    'Available event rules:',
    ruleSummary,
  ].join('\n');

  const userPrompt = [
    `Owner: ${owner}`,
    `Candidate event_key: ${candidateKey || '-'}`,
    `Candidate event_type: ${candidate.event_type || '-'}`,
    `Candidate status: ${candidateStatus || '-'}`,
    `Candidate trigger_text: ${candidateTriggerText || '-'}`,
    candidateRule ? `Candidate label: ${candidateRule.label}` : '',
    '',
    'Conversation window (chronological):',
    transcript || '(no messages found)',
    '',
    'Return JSON with this exact shape:',
    '{',
    '  "verdict": "confirm|reject|uncertain",',
    '  "event_key": "one of the listed event_key values",',
    '  "status": "draft|active|completed|cancelled",',
    '  "confidence": 1,',
    '  "reason": "short explanation",',
    '  "evidence_message_ids": [123],',
    '  "evidence_quote": "direct quote from one message or empty string",',
    '  "start_at": "YYYY-MM-DD or null",',
    '  "meta": {}',
    '}',
  ].filter(Boolean).join('\n');

  return { systemPrompt, userPrompt };
}

async function callOpenAIForVerification({ systemPrompt, userPrompt }) {
  if (!OPENAI_API_KEY || OPENAI_API_KEY === 'sk-YourKeyHere') {
    throw new Error('OpenAI API key not configured for event verification');
  }

  const response = await fetch(`${OPENAI_API_BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      temperature: 0.1,
      max_tokens: 700,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    }),
    signal: AbortSignal.timeout(45000),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`OpenAI error ${response.status}: ${detail}`);
  }

  const data = await response.json();
  return data?.choices?.[0]?.message?.content || '';
}

function normalizeVerificationResult(raw, candidate = {}) {
  const cleaned = String(raw || '').replace(/```json/gi, '').replace(/```/g, '').trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('Event verification model returned non-JSON payload');
  const parsed = JSON.parse(match[0]);

  const verdict = VERDICT_SET.has(parsed?.verdict) ? parsed.verdict : 'uncertain';
  const confidence = Math.max(1, Math.min(5, Number(parsed?.confidence || 3)));
  const eventKey = EVENT_DECISION_RULES_BY_KEY[parsed?.event_key] ? parsed.event_key : (candidate.event_key || 'trial_7day');
  const status = EVENT_STATUS_SET.has(parsed?.status) ? parsed.status : (candidate.status || candidate.suggested_status || 'draft');
  const evidenceMessageIds = Array.isArray(parsed?.evidence_message_ids)
    ? parsed.evidence_message_ids.map((value) => Number(value)).filter((value) => Number.isFinite(value) && value > 0)
    : [];
  const reviewStatus = REVIEW_STATUS_MAP[verdict] || 'uncertain';

  return {
    verdict,
    review_status: reviewStatus,
    confidence,
    event_key: eventKey,
    status,
    reason: limitText(parsed?.reason || '', 260),
    evidence_message_ids: evidenceMessageIds,
    evidence_quote: limitText(parsed?.evidence_quote || '', 260),
    start_at: parsed?.start_at ? String(parsed.start_at).slice(0, 10) : null,
    meta: parsed?.meta && typeof parsed.meta === 'object' && !Array.isArray(parsed.meta) ? parsed.meta : {},
  };
}

function buildTransitionSuggestion(currentStatus = '', verificationResult = {}) {
  const normalizedCurrent = String(currentStatus || '').trim().toLowerCase();
  if (normalizedCurrent !== 'draft') return null;
  if (verificationResult?.verdict !== 'confirm') return null;

  return {
    suggested: true,
    from_status: 'draft',
    to_status: 'active',
    pending_human_review: true,
    review_state: 'pending',
    reason: verificationResult.reason || '模型二次核对通过，建议进入 active 但仍需人工复核。',
    suggested_at: new Date().toISOString(),
    suggested_by: 'openai_event_verifier',
  };
}

function buildVerificationPatch(existingMeta = {}, verificationResult = {}, context = {}, options = {}) {
  const safeMeta = parseEventMeta(existingMeta);
  const transitionSuggestion = buildTransitionSuggestion(options.currentStatus, verificationResult);
  return {
    ...safeMeta,
    source_anchor: {
      ...(safeMeta.source_anchor || {}),
      ...(context.anchor || {}),
    },
    verification: {
      review_status: verificationResult.review_status || 'uncertain',
      verdict: verificationResult.verdict || 'uncertain',
      confidence: verificationResult.confidence || 3,
      reason: verificationResult.reason || '',
      evidence_message_ids: verificationResult.evidence_message_ids || [],
      evidence_quote: verificationResult.evidence_quote || '',
      used_message_count: context?.stats?.used_count || 0,
      anchor_resolution: context?.anchor?.resolution || 'not_found',
      model: OPENAI_MODEL,
      verified_at: new Date().toISOString(),
      verified_by: 'system',
      start_at: verificationResult.start_at || null,
      suggested_event_key: verificationResult.event_key || null,
      suggested_status: verificationResult.status || null,
      transition_suggestion: transitionSuggestion,
      meta: verificationResult.meta || {},
    },
  };
}

async function verifyEventCandidate({ dbConn, creatorId, owner = 'Beau', candidate = {}, contextWindow = {} }) {
  const context = await loadContextWindow(dbConn, {
    creatorId,
    sourceAnchor: candidate.source_anchor || null,
    triggerText: candidate.trigger_text || '',
    eventKey: candidate.event_key || '',
    before: contextWindow.before,
    after: contextWindow.after,
  });
  const { systemPrompt, userPrompt } = buildEventVerificationPrompt({
    owner,
    candidate,
    messages: context.messages,
  });
  const raw = await callOpenAIForVerification({ systemPrompt, userPrompt });
  const normalized = normalizeVerificationResult(raw, candidate);
  return {
    raw,
    normalized,
    context,
  };
}

module.exports = {
  EVENT_DECISION_RULES,
  EVENT_DECISION_RULES_BY_KEY,
  EVENT_RECALL_KEYWORDS,
  VERDICT_SET,
  parseEventMeta,
  normalizeEventText,
  tokenizeText,
  buildSourceAnchor,
  resolveSourceAnchor,
  loadContextWindow,
  buildEventVerificationPrompt,
  callOpenAIForVerification,
  normalizeVerificationResult,
  buildTransitionSuggestion,
  buildVerificationPatch,
  verifyEventCandidate,
  toIsoOrNull,
};
