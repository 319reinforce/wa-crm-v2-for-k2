import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  buildTransitionSuggestion,
  buildVerificationPatch,
  loadContextWindow,
  normalizeMiniMaxEventMatchingResult,
  normalizeVerificationResult,
} = require('../server/services/eventVerificationService');

function createDbConn(messages) {
  const rows = [...messages].sort((a, b) => {
    if (a.timestamp !== b.timestamp) return a.timestamp - b.timestamp;
    return a.id - b.id;
  });

  return {
    prepare(sql) {
      const compact = String(sql).replace(/\s+/g, ' ').trim();
      return {
        async get(...params) {
          if (compact.includes('WHERE creator_id = ? AND id = ?')) {
            const [creatorId, messageId] = params;
            return rows.find((item) => item.creator_id === creatorId && item.id === messageId) || null;
          }
          if (compact.includes('WHERE creator_id = ? AND message_hash = ?')) {
            const [creatorId, messageHash] = params;
            return rows.find((item) => item.creator_id === creatorId && item.message_hash === messageHash) || null;
          }
          if (compact.includes('ORDER BY ABS(timestamp - ?), id DESC LIMIT 1')) {
            const [creatorId, timestamp] = params;
            const candidates = rows.filter((item) => item.creator_id === creatorId);
            return candidates.sort((a, b) => {
              const diff = Math.abs(a.timestamp - timestamp) - Math.abs(b.timestamp - timestamp);
              if (diff !== 0) return diff;
              return b.id - a.id;
            })[0] || null;
          }
          throw new Error(`Unhandled GET SQL in test: ${compact}`);
        },
        async all(...params) {
          if (compact.includes('ORDER BY timestamp DESC, id DESC LIMIT 100')) {
            const [creatorId] = params;
            return rows.filter((item) => item.creator_id === creatorId).sort((a, b) => {
              if (a.timestamp !== b.timestamp) return b.timestamp - a.timestamp;
              return b.id - a.id;
            }).slice(0, 100);
          }
          if (compact.includes('AND (timestamp < ? OR (timestamp = ? AND id < ?))')) {
            const [creatorId, anchorTs, , anchorId] = params;
            const limitMatch = compact.match(/LIMIT (\d+)/i);
            const limit = Number(limitMatch?.[1] || 5);
            return rows
              .filter((item) => item.creator_id === creatorId && (item.timestamp < anchorTs || (item.timestamp === anchorTs && item.id < anchorId)))
              .sort((a, b) => (b.timestamp - a.timestamp) || (b.id - a.id))
              .slice(0, limit);
          }
          if (compact.includes('AND (timestamp > ? OR (timestamp = ? AND id > ?))')) {
            const [creatorId, anchorTs, , anchorId] = params;
            const limitMatch = compact.match(/LIMIT (\d+)/i);
            const limit = Number(limitMatch?.[1] || 4);
            return rows
              .filter((item) => item.creator_id === creatorId && (item.timestamp > anchorTs || (item.timestamp === anchorTs && item.id > anchorId)))
              .sort((a, b) => (a.timestamp - b.timestamp) || (a.id - b.id))
              .slice(0, limit);
          }
          throw new Error(`Unhandled ALL SQL in test: ${compact}`);
        },
      };
    },
  };
}

test('loadContextWindow prefers exact message_id anchor and returns chronological 10-message window', async () => {
  const messages = Array.from({ length: 12 }, (_, index) => ({
    id: index + 1,
    creator_id: 7,
    role: index % 2 === 0 ? 'user' : 'me',
    text: `message ${index + 1}`,
    timestamp: 1_710_000_000_000 + index * 1000,
    message_hash: `hash_${index + 1}`,
  }));
  const dbConn = createDbConn(messages);

  const result = await loadContextWindow(dbConn, {
    creatorId: 7,
    sourceAnchor: { message_id: 8 },
    before: 5,
    after: 4,
  });

  assert.equal(result.anchor.message_id, 8);
  assert.equal(result.anchor.resolution, 'exact_id');
  assert.equal(result.messages.length, 10);
  assert.deepEqual(result.messages.map((item) => item.id), [3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
});

test('loadContextWindow falls back to trigger_text match when anchor is missing', async () => {
  const messages = [
    { id: 1, creator_id: 9, role: 'me', text: 'How is the trial going?', timestamp: 1000, message_hash: 'a1' },
    { id: 2, creator_id: 9, role: 'user', text: 'I finished the 7-day trial yesterday.', timestamp: 2000, message_hash: 'a2' },
    { id: 3, creator_id: 9, role: 'me', text: 'Nice work.', timestamp: 3000, message_hash: 'a3' },
  ];
  const dbConn = createDbConn(messages);

  const result = await loadContextWindow(dbConn, {
    creatorId: 9,
    sourceAnchor: null,
    triggerText: 'creator finished the 7-day trial',
    eventKey: 'trial_7day',
    before: 1,
    after: 1,
  });

  assert.equal(result.anchor.message_id, 2);
  assert.equal(result.anchor.resolution, 'trigger_text_match');
  assert.deepEqual(result.messages.map((item) => item.id), [1, 2, 3]);
});

test('normalizeVerificationResult constrains verdict, status and evidence ids', () => {
  const payload = normalizeVerificationResult(JSON.stringify({
    verdict: 'confirm',
    event_key: 'agency_bound',
    status: 'completed',
    confidence: 9,
    reason: 'creator explicitly agreed to sign',
    evidence_message_ids: ['12', 18, 'oops'],
    evidence_quote: 'Yes, I can sign it.',
    start_at: '2026-04-15',
    meta: { threshold: 2000 },
  }), {
    event_key: 'trial_7day',
    status: 'draft',
  });

  assert.equal(payload.verdict, 'confirm');
  assert.equal(payload.review_status, 'confirmed');
  assert.equal(payload.event_key, 'agency_bound');
  assert.equal(payload.status, 'completed');
  assert.equal(payload.confidence, 5);
  assert.deepEqual(payload.evidence_message_ids, [12, 18]);
  assert.equal(payload.start_at, '2026-04-15');
  assert.deepEqual(payload.meta, { threshold: 2000 });
});

test('buildVerificationPatch writes source_anchor and verification summary into meta', () => {
  const patch = buildVerificationPatch({ source_text: 'old' }, {
    review_status: 'confirmed',
    verdict: 'confirm',
    confidence: 4,
    reason: 'explicit statement',
    evidence_message_ids: [22],
    evidence_quote: 'I finished the trial.',
    event_key: 'trial_7day',
    status: 'completed',
    start_at: '2026-04-15',
    meta: { from_model: true },
  }, {
    anchor: { message_id: 22, timestamp: 123456, message_hash: 'hash_22', resolution: 'exact_id' },
    stats: { used_count: 10 },
  });

  assert.equal(patch.source_anchor.message_id, 22);
  assert.equal(patch.verification.review_status, 'confirmed');
  assert.equal(patch.verification.anchor_resolution, 'exact_id');
  assert.equal(patch.verification.suggested_status, 'completed');
  assert.equal(patch.verification.suggested_event_key, 'trial_7day');
});

test('buildTransitionSuggestion only recommends draft to active after confirmed verification', () => {
  const suggestion = buildTransitionSuggestion('draft', {
    verdict: 'confirm',
    reason: 'explicit confirmation in context',
  });

  assert.equal(suggestion.from_status, 'draft');
  assert.equal(suggestion.to_status, 'active');
  assert.equal(suggestion.pending_human_review, true);

  assert.equal(buildTransitionSuggestion('active', { verdict: 'confirm' }), null);
  assert.equal(buildTransitionSuggestion('draft', { verdict: 'uncertain' }), null);
});

test('normalizeMiniMaxEventMatchingResult keeps weak current-text evidence from driving lifecycle', () => {
  const payload = normalizeMiniMaxEventMatchingResult(JSON.stringify({
    events: [{
      event_key: 'agency_bound',
      status: 'active',
      confidence: 0.92,
      evidence_tier: 2,
      source_kind: 'current_text',
      source_quote: '',
      reason: 'creator asks about agency signing',
      overlays: [],
      lifecycle_stage_suggestion: 'retention',
      meta: {},
    }],
    overlays: [],
    lifecycle_stage_suggestion: 'retention',
  }), {
    owner: 'Beau',
    text: 'Can you send the agency link?',
    sourceAnchor: null,
    model: 'MiniMax-M2.7-highspeed',
  });

  assert.equal(payload.detected.length, 1);
  assert.equal(payload.detected[0].event_key, 'agency_bound');
  assert.equal(payload.detected[0].evidence_tier, 1);
  assert.equal(payload.detected[0].lifecycle_drives_main_stage, false);
  assert.equal(payload.detected[0].meta.evidence_contract.evidence_tier, 1);
});

test('normalizeMiniMaxEventMatchingResult preserves overlays without turning risk into termination', () => {
  const payload = normalizeMiniMaxEventMatchingResult(JSON.stringify({
    events: [{
      event_key: 'gmv_milestone',
      status: 'draft',
      confidence: 0.81,
      evidence_tier: 1,
      source_kind: 'current_text',
      source_quote: 'I had around 9400 GMV but my account is banned.',
      reason: 'GMV is claimed in chat but needs external verification; ban is risk overlay.',
      overlays: ['revenue_claim_pending_verification', 'risk_control_active', 'not_allowed_overlay'],
      lifecycle_stage_suggestion: 'retention',
      meta: { claimed_gmv: 9400 },
    }],
    overlays: ['settlement_blocked'],
    lifecycle_stage_suggestion: 'terminated',
  }), {
    owner: 'Yiyun',
    text: 'I had around 9400 GMV but my account is banned. How do I get paid?',
    sourceAnchor: { message_id: 44, timestamp: 1710000000000 },
    model: 'MiniMax-M2.7-highspeed',
  });

  assert.equal(payload.detected[0].event_key, 'gmv_milestone');
  assert.equal(payload.detected[0].suggested_status, 'draft');
  assert.deepEqual(payload.detected[0].overlays, [
    'revenue_claim_pending_verification',
    'risk_control_active',
    'settlement_blocked',
  ]);
  assert.equal(payload.detected[0].lifecycle_stage_suggestion, 'retention');
  assert.equal(payload.detected[0].lifecycle_drives_main_stage, false);
});
