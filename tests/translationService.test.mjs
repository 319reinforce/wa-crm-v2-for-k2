import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const translationService = require('../server/services/translationService');

test('translationService maps Chinese target to DeepL Simplified Chinese', () => {
  assert.deepEqual(
    translationService._internal.directionToLangs('to_zh'),
    { source: 'en', target: 'zh-HANS' },
  );
});

test('translationService detects unchanged English as a failed Chinese translation', () => {
  const text = 'If someone signs up and later decides they want to withdraw';
  assert.equal(
    translationService._internal.isNoopTranslationForDirection(text, text, 'to_zh'),
    true,
  );
  assert.equal(
    translationService._internal.isNoopTranslationForDirection('TikTok Shop', 'TikTok Shop', 'to_zh'),
    false,
  );
  assert.equal(
    translationService._internal.isNoopTranslationForDirection('你好，可以帮我吗？', '你好，可以帮我吗？', 'to_en'),
    true,
  );
});
