import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
    normalizeConversationMessages,
    extractCandidateText,
    extractCandidateOpt2Text,
    REPLY_PIPELINE_VERSION,
} = require('../server/services/replyGenerationService');

// ── normalizeConversationMessages ──────────────────────────────────────────

test('normalizeConversationMessages maps me/assistant to assistant role', () => {
    const result = normalizeConversationMessages([
        { role: 'me', content: 'hello' },
        { role: 'assistant', content: 'hi' },
        { role: 'user', content: 'hey' },
    ]);
    assert.equal(result[0].role, 'assistant');
    assert.equal(result[1].role, 'assistant');
    assert.equal(result[2].role, 'user');
});

test('normalizeConversationMessages filters empty content', () => {
    const result = normalizeConversationMessages([
        { role: 'user', content: '' },
        { role: 'user', text: '' },
        { role: 'user', content: 'valid' },
    ]);
    assert.equal(result.length, 1);
    assert.equal(result[0].content, 'valid');
});

test('normalizeConversationMessages reads text field as fallback', () => {
    const result = normalizeConversationMessages([
        { role: 'user', text: 'from text field' },
    ]);
    assert.equal(result[0].content, 'from text field');
});

test('normalizeConversationMessages handles array content', () => {
    const result = normalizeConversationMessages([
        { role: 'user', content: [{ text: 'part1' }, { text: 'part2' }] },
    ]);
    assert.equal(result[0].content, 'part1\npart2');
});

test('normalizeConversationMessages appends reply prompt when last is assistant', () => {
    const result = normalizeConversationMessages(
        [{ role: 'assistant', content: 'last msg' }],
        { appendReplyPromptIfLastAssistant: true }
    );
    assert.equal(result.length, 2);
    assert.equal(result[1].role, 'user');
    assert.ok(result[1].content.includes('请回复'));
});

test('normalizeConversationMessages does not append when last is user', () => {
    const result = normalizeConversationMessages(
        [{ role: 'user', content: 'last msg' }],
        { appendReplyPromptIfLastAssistant: true }
    );
    assert.equal(result.length, 1);
});

// ── extractCandidateText / extractCandidateOpt2Text ────────────────────────

test('extractCandidateText returns text from content array', () => {
    const payload = { content: [{ type: 'text', text: 'opt1 reply' }] };
    assert.equal(extractCandidateText(payload), 'opt1 reply');
});

test('extractCandidateText returns empty string for missing content', () => {
    assert.equal(extractCandidateText(null), '');
    assert.equal(extractCandidateText({}), '');
    assert.equal(extractCandidateText({ content: [] }), '');
});

test('extractCandidateOpt2Text returns text from content_opt2 array', () => {
    const payload = { content_opt2: [{ type: 'text', text: 'opt2 reply' }] };
    assert.equal(extractCandidateOpt2Text(payload), 'opt2 reply');
});

test('extractCandidateOpt2Text returns empty string for missing content_opt2', () => {
    assert.equal(extractCandidateOpt2Text(null), '');
    assert.equal(extractCandidateOpt2Text({ content: [{ type: 'text', text: 'x' }] }), '');
});

// ── REPLY_PIPELINE_VERSION ─────────────────────────────────────────────────

test('REPLY_PIPELINE_VERSION is reply_generation_v2', () => {
    assert.equal(REPLY_PIPELINE_VERSION, 'reply_generation_v2');
});
