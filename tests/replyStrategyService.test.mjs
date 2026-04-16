import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { _private } = require('../server/services/replyStrategyService');

const SAMPLE_STRATEGIES = [
  {
    id: 'secondary_reach',
    name: '二次触达',
    memory_key: 'agency_strategy_secondary_reach',
    priority: 10,
  },
  {
    id: 'recall_pending',
    name: '待召回',
    memory_key: 'agency_strategy_recall_pending',
    priority: 20,
  },
];

test('classifyStrategyRole detects secondary and recall from id/name', () => {
  assert.equal(_private.classifyStrategyRole(SAMPLE_STRATEGIES[0]), 'secondary_reach');
  assert.equal(_private.classifyStrategyRole(SAMPLE_STRATEGIES[1]), 'recall_pending');
});

test('chooseStrategy picks recall_pending in revenue stage', () => {
  const result = _private.chooseStrategy({
    strategies: SAMPLE_STRATEGIES,
    lifecycle: { stage_key: 'revenue', stage_label: 'Revenue' },
    profile: null,
    currentMemory: null,
    trigger: 'manual',
    force: false,
    allowSoftAdjust: false,
  });

  assert.equal(result.strategy.id, 'recall_pending');
  assert.equal(result.kept_existing, false);
  assert.equal(result.scores.recall > result.scores.secondary, true);
});

test('chooseStrategy keeps existing strategy on soft adjust when score delta small', () => {
  const result = _private.chooseStrategy({
    strategies: SAMPLE_STRATEGIES,
    lifecycle: { stage_key: 'activation', stage_label: 'Activation' },
    profile: {
      intent: { value: 'medium', confidence: 2, evidence: '' },
      frequency: { value: 'medium', confidence: 2, evidence: '' },
      difficulty: { value: 'medium', confidence: 2, evidence: '' },
      emotion: { value: 'neutral', confidence: 2, evidence: '' },
      pain_points: { value: [], confidence: 1, evidence: '' },
      motivation_positive: { value: [], confidence: 1, evidence: '' },
    },
    currentMemory: { memory_key: 'agency_strategy_recall_pending' },
    trigger: 'profile_change',
    force: false,
    allowSoftAdjust: true,
  });

  assert.equal(result.strategy.id, 'recall_pending');
  assert.equal(result.kept_existing, true);
});

test('chooseStrategy forces secondary_reach for acquisition stage', () => {
  const result = _private.chooseStrategy({
    strategies: SAMPLE_STRATEGIES,
    lifecycle: { stage_key: 'acquisition', stage_label: 'Acquisition' },
    profile: {
      intent: { value: 'strong', confidence: 3, evidence: '' },
      frequency: { value: 'high', confidence: 3, evidence: '' },
      difficulty: { value: 'low', confidence: 2, evidence: '' },
      emotion: { value: 'positive', confidence: 2, evidence: '' },
      pain_points: { value: [], confidence: 1, evidence: '' },
      motivation_positive: { value: ['想赚佣金'], confidence: 2, evidence: '' },
    },
    currentMemory: { memory_key: 'agency_strategy_recall_pending' },
    trigger: 'manual',
    force: false,
    allowSoftAdjust: true,
  });

  assert.equal(result.strategy.id, 'secondary_reach');
  assert.equal(result.scores.secondary > result.scores.recall, true);
});

test('parseAutoStrategyMeta extracts trigger and lifecycle markers', () => {
  const parsed = _private.parseAutoStrategyMeta(`
[AUTO_REPLY_STRATEGY:auto_reply_strategy_v2]
trigger: lifecycle_change
lifecycle: Revenue（变现）
frequency: high (c3)
focus: 推进单一动作
`);
  assert.equal(parsed.is_auto, true);
  assert.equal(parsed.version, 'auto_reply_strategy_v2');
  assert.equal(parsed.trigger, 'lifecycle_change');
  assert.equal(parsed.lifecycle, 'Revenue（变现）');
  assert.equal(parsed.profile_signals.length, 1);
  assert.equal(parsed.focus, '推进单一动作');
});
