import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  extractTagsHeuristically,
  buildFallbackProfileSummary,
} = require('../server/services/profileFallbackService');

test('extractTagsHeuristically emits deduped heuristic tags with fallback source', () => {
  const tags = extractTagsHeuristically('Hi, how much is the 7-day trial? I need it today, thanks!');

  assert.equal(tags.length <= 5, true);
  assert.equal(tags.every((item) => item.source === 'heuristic_fallback'), true);
  assert.equal(tags.some((item) => item.tag === 'topic:pricing'), true);
  assert.equal(tags.some((item) => item.tag === 'topic:trial'), true);
  assert.equal(tags.some((item) => item.tag === 'intent:info_seeking'), true);
  assert.equal(tags.some((item) => item.tag === 'urgency:high'), true);
});

test('buildFallbackProfileSummary includes lifecycle, owner, tags and memory hints', () => {
  const summary = buildFallbackProfileSummary({
    creator: {
      name: 'Jessica',
      wa_owner: 'Beau',
      beta_status: 'trial_active',
    },
    lifecycleLabel: 'Activation',
    tags: [{ tag: 'topic:trial' }, { tag: 'intent:purchase_intent' }],
    memory: [{ memory_value: 'prefers brief replies' }],
  });

  assert.match(summary, /Jessica/);
  assert.match(summary, /Beau/);
  assert.match(summary, /Activation/);
  assert.match(summary, /topic:trial/);
  assert.match(summary, /prefers brief replies/);
});
