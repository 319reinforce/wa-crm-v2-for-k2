import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { _private } = require('../scripts/backfill-sft-system-prompt-used.cjs');

test('parseArgs defaults to dry-run mode with no filters', () => {
  const parsed = _private.parseArgs([]);

  assert.equal(parsed.apply, false);
  assert.equal(parsed.owner, null);
  assert.equal(parsed.limit, 0);
  assert.equal(parsed.recordId, 0);
});

test('buildPromptInput resolves client, scene and mixed context fragments', () => {
  const row = {
    scene: '',
    system_prompt_version: '',
    client_id: '',
    context_json: JSON.stringify({
      client_id: '15551234567',
      scene: 'trial_intro',
      topic_context: 'topic block',
      richContext: 'rich block',
      conversation_summary: 'summary block',
      system_prompt_version: 'v3',
    }),
    message_history: JSON.stringify([{ role: 'user', text: 'hello' }]),
  };

  const resolved = _private.buildPromptInput(row);

  assert.equal(resolved.clientId, '15551234567');
  assert.equal(resolved.scene, 'trial_intro');
  assert.deepEqual(resolved.history, [{ role: 'user', text: 'hello' }]);
  assert.deepEqual(resolved.options, {
    topicContext: 'topic block',
    richContext: 'rich block',
    conversationSummary: 'summary block',
    systemPromptVersion: 'v3',
  });
});
