import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
    validateHumanOutput,
    buildSftGenerationMetadata,
    buildSftContextWithGenerationMetadata,
    buildSftStructuredMetadataFragments,
    parseJsonSafe,
} = require('../server/services/sftService');

// ── validateHumanOutput ────────────────────────────────────────────────────

test('validateHumanOutput rejects empty string', () => {
    assert.equal(validateHumanOutput('').valid, false);
    assert.equal(validateHumanOutput('  ').valid, false);
});

test('validateHumanOutput rejects strings shorter than 3 chars', () => {
    assert.equal(validateHumanOutput('hi').valid, false);
});

test('validateHumanOutput rejects pure emoji', () => {
    assert.equal(validateHumanOutput('🎉✅👍').valid, false);
});

test('validateHumanOutput rejects pure punctuation', () => {
    assert.equal(validateHumanOutput('...!!!').valid, false);
});

test('validateHumanOutput accepts normal text', () => {
    assert.equal(validateHumanOutput('Hi there!').valid, true);
    assert.equal(validateHumanOutput('好的，没问题').valid, true);
});

// ── buildSftGenerationMetadata ─────────────────────────────────────────────

test('buildSftGenerationMetadata picks primary over fallback', () => {
    const meta = buildSftGenerationMetadata(
        { provider: 'openai', model: 'gpt-4o', pipeline_version: 'v2' },
        { provider: 'minimax', model: 'mini-max-typing', pipeline_version: 'v1' }
    );
    assert.equal(meta.provider, 'openai');
    assert.equal(meta.model, 'gpt-4o');
    assert.equal(meta.pipeline_version, 'v2');
});

test('buildSftGenerationMetadata falls back to secondary when primary missing', () => {
    const meta = buildSftGenerationMetadata(
        {},
        { provider: 'minimax', model: 'mini-max-typing' }
    );
    assert.equal(meta.provider, 'minimax');
    assert.equal(meta.model, 'mini-max-typing');
});

test('buildSftGenerationMetadata normalizes camelCase IDs', () => {
    const meta = buildSftGenerationMetadata({
        retrievalSnapshotId: 42,
        generationLogId: 99,
    });
    assert.equal(meta.retrieval_snapshot_id, 42);
    assert.equal(meta.generation_log_id, 99);
});

test('buildSftGenerationMetadata returns null for invalid IDs', () => {
    const meta = buildSftGenerationMetadata({ retrieval_snapshot_id: -1 });
    assert.equal(meta.retrieval_snapshot_id, null);
});

test('buildSftGenerationMetadata truncates long strings', () => {
    const meta = buildSftGenerationMetadata({ provider: 'x'.repeat(100) });
    assert.ok(meta.provider.length <= 32);
});

// ── buildSftContextWithGenerationMetadata ──────────────────────────────────

test('buildSftContextWithGenerationMetadata merges metadata into context', () => {
    const ctx = buildSftContextWithGenerationMetadata(
        { client_id: '123', scene: 'trial_intro' },
        { provider: 'minimax', model: 'mini-max-typing', pipeline_version: 'reply_generation_v2',
          retrieval_snapshot_id: 1, generation_log_id: 2, scene_source: 'auto' }
    );
    assert.equal(ctx.client_id, '123');
    assert.equal(ctx.provider, 'minimax');
    assert.equal(ctx.pipeline_version, 'reply_generation_v2');
    assert.equal(ctx.retrieval_snapshot_id, 1);
});

test('buildSftContextWithGenerationMetadata skips null metadata values', () => {
    const ctx = buildSftContextWithGenerationMetadata(
        { client_id: '123' },
        { provider: null, model: null }
    );
    assert.equal(Object.prototype.hasOwnProperty.call(ctx, 'provider'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(ctx, 'model'), false);
});

test('buildSftContextWithGenerationMetadata handles null context', () => {
    const ctx = buildSftContextWithGenerationMetadata(null, { provider: 'openai' });
    assert.equal(ctx.provider, 'openai');
});

// ── buildSftStructuredMetadataFragments ────────────────────────────────────

test('buildSftStructuredMetadataFragments only includes available columns', () => {
    const available = new Set(['provider', 'model']);
    const frags = buildSftStructuredMetadataFragments(
        { provider: 'minimax', model: 'mini-max-typing', pipeline_version: 'v2' },
        available
    );
    assert.ok(frags.columns.includes('provider'));
    assert.ok(frags.columns.includes('model'));
    assert.equal(frags.columns.includes('pipeline_version'), false);
});

test('buildSftStructuredMetadataFragments returns empty arrays for empty column set', () => {
    const frags = buildSftStructuredMetadataFragments(
        { provider: 'minimax' },
        new Set()
    );
    assert.equal(frags.columns.length, 0);
    assert.equal(frags.values.length, 0);
});

// ── parseJsonSafe ──────────────────────────────────────────────────────────

test('parseJsonSafe parses valid JSON', () => {
    const result = parseJsonSafe('{"a":1}');
    assert.deepEqual(result, { a: 1 });
});

test('parseJsonSafe returns fallback on invalid JSON', () => {
    assert.equal(parseJsonSafe('not json', null), null);
    assert.deepEqual(parseJsonSafe('{bad}', {}), {});
});

test('parseJsonSafe returns fallback for null/undefined input', () => {
    assert.equal(parseJsonSafe(null, 'default'), 'default');
    assert.equal(parseJsonSafe(undefined, 42), 42);
});
