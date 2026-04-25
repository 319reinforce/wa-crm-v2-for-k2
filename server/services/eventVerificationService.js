const {
  EVENT_DECISION_RULES,
  EVENT_DECISION_RULES_BY_KEY,
  EVENT_RECALL_KEYWORDS,
  CANONICAL_LIFECYCLE_EVENT_KEYS,
  LIFECYCLE_STAGE_KEYS,
  LIFECYCLE_OVERLAY_KEYS,
} = require('../constants/eventDecisionRules');

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_API_BASE = process.env.OPENAI_API_BASE || 'https://api.openai.com/v1';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o';
const DEFAULT_MINIMAX_BASE = 'https://minimax.a7m.com.cn';
const DEFAULT_MINIMAX_MODEL = 'MiniMax-M2.7-highspeed';

const VERDICT_SET = new Set(['confirm', 'reject', 'uncertain']);
const REVIEW_STATUS_MAP = {
  confirm: 'confirmed',
  reject: 'rejected',
  uncertain: 'uncertain',
};
const EVENT_STATUS_SET = new Set(['draft', 'active', 'completed', 'cancelled']);
const CANONICAL_LIFECYCLE_EVENT_KEY_SET = new Set(CANONICAL_LIFECYCLE_EVENT_KEYS);
const LIFECYCLE_STAGE_KEY_SET = new Set(LIFECYCLE_STAGE_KEYS);
const LIFECYCLE_OVERLAY_KEY_SET = new Set(LIFECYCLE_OVERLAY_KEYS);

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

function clampConfidence(value, fallback = 0.5) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  if (numeric > 1) return Math.max(0, Math.min(numeric / 5, 1));
  return Math.max(0, Math.min(numeric, 1));
}

function clampEvidenceTier(value, { sourceAnchor = null, sourceKind = '', evidenceQuote = '' } = {}) {
  const numeric = Number(value);
  let tier = Number.isFinite(numeric) ? Math.max(0, Math.min(Math.trunc(numeric), 3)) : 0;
  const hasAnchor = !!(sourceAnchor?.message_id || sourceAnchor?.message_hash || sourceAnchor?.timestamp);
  const normalizedSourceKind = String(sourceKind || '').trim().toLowerCase();
  const trustedSource = ['operator_confirmed', 'external_system'].includes(normalizedSourceKind);
  if (tier >= 2 && !trustedSource && (!hasAnchor || !String(evidenceQuote || '').trim())) {
    tier = 1;
  }
  return tier;
}

function uniqueAllowed(values, allowedSet) {
  const out = [];
  (Array.isArray(values) ? values : []).forEach((value) => {
    const key = String(value || '').trim();
    if (allowedSet.has(key) && !out.includes(key)) out.push(key);
  });
  return out;
}

function resolveMinimaxMessagesUrl(rawBase) {
  const input = String(rawBase || '').trim() || DEFAULT_MINIMAX_BASE;
  try {
    const url = new URL(input);
    const normalizedPath = url.pathname.replace(/\/+$/, '');
    const basePath = normalizedPath && normalizedPath !== '/' ? normalizedPath : '';
    const messagesPath = /\/v1$/i.test(basePath) ? `${basePath}/messages` : `${basePath}/v1/messages`;
    return `${url.origin}${messagesPath}`;
  } catch (_) {
    const normalized = input.replace(/\/+$/, '');
    return /\/v1$/i.test(normalized) ? `${normalized}/messages` : `${normalized}/v1/messages`;
  }
}

function resolveMinimaxModel(explicitModel) {
  const input = String(explicitModel || '').trim();
  if (input) return input;
  return String(process.env.MINIMAX_EVENT_MODEL || process.env.MINIMAX_MODEL || '').trim() || DEFAULT_MINIMAX_MODEL;
}

function extractTextFromMiniMaxResponse(data) {
  if (typeof data?.content === 'string') return data.content;
  if (Array.isArray(data?.content)) {
    return data.content.find((item) => item?.type === 'text')?.text || '';
  }
  if (Array.isArray(data?.choices)) {
    return data.choices[0]?.message?.content || data.choices[0]?.text || '';
  }
  return data?.content?.text || '';
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

function buildMiniMaxEventMatchingPrompt({ owner = 'Beau', text = '', messages = [], sourceAnchor = null }) {
  const transcript = (messages || []).map((message) => {
    const role = message.role === 'me' ? owner : 'Creator';
    const when = toIsoOrNull(message.timestamp) || '-';
    return `[${message.id}][${role}][${when}] ${limitText(message.text, 320)}`;
  }).join('\n');

  const ruleSummary = buildRuleSummary();
  const sourceHint = sourceAnchor
    ? `source_anchor: ${JSON.stringify(sourceAnchor)}`
    : 'source_anchor: none; current_text is the only evidence';

  const systemPrompt = [
    'You are a strict WhatsApp CRM event and lifecycle evidence matcher.',
    'Your job is to extract candidate canonical events and overlay flags from the provided text/context.',
    'Never create dynamic event keys. Use only listed event_key values.',
    'Lifecycle main stage is advisory only. Do not let weak or dynamic evidence drive a main stage.',
    'Risk, settlement, referral, weak evidence, missing challenge periods, and unverified GMV claims are overlays, not main stages.',
    'Account bans, violations, freezes, payout issues, and posting blocks are risk/settlement overlays unless the creator explicitly opts out or asks not to be contacted.',
    'Return strict JSON only.',
    '',
    'Evidence tiers:',
    '0 = raw keyword/draft/dynamic touchpoint; never drives lifecycle.',
    '1 = imported/manual/current-text evidence without source quote or verification; badge/overlay only.',
    '2 = canonical event with source message anchor and direct quote, or operator-confirmed import; may drive lifecycle after backend rules.',
    '3 = external-system verified fact such as Keeper GMV or confirmed agency binding.',
    '',
    `Allowed lifecycle stages: ${LIFECYCLE_STAGE_KEYS.join(', ')}`,
    `Allowed overlays: ${LIFECYCLE_OVERLAY_KEYS.join(', ')}`,
    '',
    'Available event rules:',
    ruleSummary,
  ].join('\n');

  const userPrompt = [
    `Owner: ${owner}`,
    sourceHint,
    '',
    'Current text to classify:',
    limitText(text, 1400) || '(empty)',
    '',
    'Conversation window, chronological when available:',
    transcript || '(no message window available)',
    '',
    'Return JSON with this exact shape:',
    '{',
    '  "events": [',
    '    {',
    '      "event_key": "one listed event_key",',
    '      "status": "draft|active|completed|cancelled",',
    '      "confidence": 0.0,',
    '      "evidence_tier": 0,',
    '      "source_kind": "current_text|source_message|operator_confirmed|external_system|imported|keyword",',
    '      "source_quote": "direct quote or empty string",',
    '      "reason": "short explanation",',
    '      "overlays": ["optional allowed overlay keys"],',
    '      "lifecycle_stage_suggestion": "acquisition|activation|retention|revenue|terminated|null",',
    '      "meta": {}',
    '    }',
    '  ],',
    '  "overlays": ["optional allowed overlay keys"],',
    '  "lifecycle_stage_suggestion": "acquisition|activation|retention|revenue|terminated|null",',
    '  "reason": "short overall explanation"',
    '}',
  ].join('\n');

  return { systemPrompt, userPrompt };
}

async function callMiniMaxForEventMatching({ systemPrompt, userPrompt, model, maxTokens = 1200 }) {
  const apiKey = process.env.MINIMAX_API_KEY;
  if (!apiKey) {
    const error = new Error('MINIMAX_API_KEY environment variable not set');
    error.statusCode = 500;
    throw error;
  }

  const messagesUrl = resolveMinimaxMessagesUrl(process.env.MINIMAX_EVENT_API_BASE || process.env.MINIMAX_API_BASE);
  const resolvedModel = resolveMinimaxModel(model);
  const response = await fetch(messagesUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: resolvedModel,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      max_tokens: maxTokens,
      temperature: 0,
    }),
    signal: AbortSignal.timeout(Number(process.env.MINIMAX_EVENT_TIMEOUT_MS || 45000)),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.error) {
    const detail = payload?.error?.message || payload?.message || response.statusText || 'unknown error';
    const error = new Error(`MiniMax event matching error: ${detail}`);
    error.statusCode = 502;
    throw error;
  }

  return {
    raw: extractTextFromMiniMaxResponse(payload),
    model: payload?.model || resolvedModel,
    id: payload?.id || null,
  };
}

function normalizeMiniMaxEventMatchingResult(raw, {
  owner = 'Beau',
  text = '',
  sourceAnchor = null,
  model = null,
} = {}) {
  const cleaned = String(raw || '').replace(/```json/gi, '').replace(/```/g, '').trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('MiniMax event matcher returned non-JSON payload');
  const parsed = JSON.parse(match[0]);

  const globalOverlays = uniqueAllowed(parsed?.overlays, LIFECYCLE_OVERLAY_KEY_SET);
  const globalStage = LIFECYCLE_STAGE_KEY_SET.has(parsed?.lifecycle_stage_suggestion)
    ? parsed.lifecycle_stage_suggestion
    : null;
  const events = Array.isArray(parsed?.events) ? parsed.events : [];
  const detected = [];

  events.forEach((item) => {
    const eventKey = String(item?.event_key || '').trim();
    if (!EVENT_DECISION_RULES_BY_KEY[eventKey]) return;
    if (!CANONICAL_LIFECYCLE_EVENT_KEY_SET.has(eventKey)) return;

    const itemOverlays = uniqueAllowed([...(item?.overlays || []), ...globalOverlays], LIFECYCLE_OVERLAY_KEY_SET);
    const sourceKind = String(item?.source_kind || (sourceAnchor ? 'source_message' : 'current_text')).trim() || 'current_text';
    const evidenceQuote = limitText(item?.source_quote || '', 260);
    const evidenceTier = clampEvidenceTier(item?.evidence_tier, {
      sourceAnchor,
      sourceKind,
      evidenceQuote,
    });
    const lifecycleStageSuggestion = LIFECYCLE_STAGE_KEY_SET.has(item?.lifecycle_stage_suggestion)
      ? item.lifecycle_stage_suggestion
      : globalStage;
    const status = EVENT_STATUS_SET.has(item?.status) ? item.status : 'draft';
    const confidence = clampConfidence(item?.confidence, evidenceTier >= 2 ? 0.72 : 0.58);

    detected.push({
      event_key: eventKey,
      event_type: EVENT_DECISION_RULES_BY_KEY[eventKey]?.event_type || 'incentive_task',
      owner,
      trigger_text: text,
      trigger_source: 'minimax_semantic',
      suggested_status: status,
      confidence,
      reason: limitText(item?.reason || parsed?.reason || '', 260),
      source_anchor: sourceAnchor,
      evidence_tier: evidenceTier,
      source_kind: sourceKind,
      source_quote: evidenceQuote,
      overlays: itemOverlays,
      lifecycle_stage_suggestion: lifecycleStageSuggestion,
      lifecycle_drives_main_stage: false,
      verification: {
        review_status: evidenceTier >= 2 ? 'uncertain' : 'pending',
        verdict: evidenceTier >= 2 ? 'uncertain' : 'uncertain',
        confidence: null,
      },
      meta: {
        ...(item?.meta && typeof item.meta === 'object' && !Array.isArray(item.meta) ? item.meta : {}),
        evidence_contract: {
          evidence_tier: evidenceTier,
          source_kind: sourceKind,
          source_message_id: sourceAnchor?.message_id || null,
          source_quote: evidenceQuote,
          external_system: sourceKind === 'external_system' ? (item?.meta?.external_system || null) : null,
          verified_by: null,
          verified_at: null,
        },
        lifecycle_overlay: {
          overlays: itemOverlays,
          lifecycle_stage_suggestion: lifecycleStageSuggestion,
          drives_main_stage: false,
        },
        llm_event_matcher: {
          provider: 'minimax',
          model,
          matched_at: new Date().toISOString(),
        },
      },
    });
  });

  return {
    detected,
    overlays: globalOverlays,
    lifecycle_stage_suggestion: globalStage,
    reason: limitText(parsed?.reason || '', 260),
  };
}

async function detectEventsWithMiniMax({ dbConn, creatorId, owner = 'Beau', text = '', sourceAnchor = null, contextWindow = {}, model = null }) {
  const context = sourceAnchor
    ? await loadContextWindow(dbConn, {
        creatorId,
        sourceAnchor,
        triggerText: text,
        eventKey: '',
        before: contextWindow.before,
        after: contextWindow.after,
      })
    : {
        anchor: sourceAnchor,
        messages: [],
        stats: { before_count: 0, after_count: 0, used_count: 0 },
      };
  const { systemPrompt, userPrompt } = buildMiniMaxEventMatchingPrompt({
    owner,
    text,
    messages: context.messages,
    sourceAnchor,
  });
  const result = await callMiniMaxForEventMatching({
    systemPrompt,
    userPrompt,
    model,
    maxTokens: Number(process.env.MINIMAX_EVENT_MAX_TOKENS || 1200),
  });
  const normalized = normalizeMiniMaxEventMatchingResult(result.raw, {
    owner,
    text,
    sourceAnchor: context.anchor || sourceAnchor,
    model: result.model,
  });
  return {
    raw: result.raw,
    model: result.model,
    id: result.id,
    normalized,
    context,
  };
}

async function callOpenAIForVerification({ systemPrompt, userPrompt }) {
  const { generateResponseFor } = require('../utils/openai');
  return generateResponseFor(
    'event-verification',
    [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    {
      temperature: 0.1,
      maxTokens: 700,
      source: 'eventVerificationService.callOpenAIForVerification',
    }
  );
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
  buildMiniMaxEventMatchingPrompt,
  callMiniMaxForEventMatching,
  normalizeMiniMaxEventMatchingResult,
  detectEventsWithMiniMax,
  callOpenAIForVerification,
  normalizeVerificationResult,
  buildTransitionSuggestion,
  buildVerificationPatch,
  verifyEventCandidate,
  toIsoOrNull,
};
