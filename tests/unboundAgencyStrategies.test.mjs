import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_UNBOUND_AGENCY_STRATEGIES,
  isAgencyBoundStatus,
  normalizeUnboundAgencyStrategies,
  resolveUnboundAgencyStrategy,
} from '../src/utils/unboundAgencyStrategies.js';

test('normalizeUnboundAgencyStrategies supports snake_case backend payload', () => {
  const normalized = normalizeUnboundAgencyStrategies([
    {
      id: 'recall_pending',
      name: '待召回',
      name_en: 'Pending Recall',
      short_desc: 'desc',
      memory_key: 'agency_strategy_recall_pending',
      memory_value: 'value',
      next_action_template: 'next',
      next_action_template_en: 'next en',
      prompt_hint: 'hint',
      prompt_hint_en: 'hint en',
      aliases: ['待召回'],
      priority: 20,
    },
  ]);

  assert.equal(normalized.length, 1);
  assert.equal(normalized[0].nameEn, 'Pending Recall');
  assert.equal(normalized[0].memoryKey, 'agency_strategy_recall_pending');
  assert.equal(normalized[0].promptHintEn, 'hint en');
});

test('resolveUnboundAgencyStrategy handles backend memory_type/memory_key shape', () => {
  const selected = resolveUnboundAgencyStrategy({
    clientMemory: [
      {
        memory_type: 'strategy',
        memory_key: 'agency_strategy_recall_pending',
        memory_value: 'some text',
      },
    ],
    nextAction: '',
    strategies: DEFAULT_UNBOUND_AGENCY_STRATEGIES,
  });

  assert.equal(selected?.id, 'recall_pending');
});

test('resolveUnboundAgencyStrategy chooses higher-priority strategy when multiple found', () => {
  const selected = resolveUnboundAgencyStrategy({
    clientMemory: [
      {
        memory_type: 'strategy',
        memory_key: 'agency_strategy_secondary_reach',
        memory_value: '二次触达',
      },
      {
        memory_type: 'strategy',
        memory_key: 'agency_strategy_recall_pending',
        memory_value: '待召回',
      },
    ],
    nextAction: '',
    strategies: DEFAULT_UNBOUND_AGENCY_STRATEGIES,
  });

  assert.equal(selected?.id, 'recall_pending');
});

test('resolveUnboundAgencyStrategy falls back to next action text when memory missing', () => {
  const selected = resolveUnboundAgencyStrategy({
    clientMemory: [],
    nextAction: '【待召回】今天确认绑定所需信息与时间点',
    strategies: DEFAULT_UNBOUND_AGENCY_STRATEGIES,
  });

  assert.equal(selected?.id, 'recall_pending');
});

test('resolveUnboundAgencyStrategy defaults to first configured strategy', () => {
  const selected = resolveUnboundAgencyStrategy({
    clientMemory: [],
    nextAction: '',
    strategies: DEFAULT_UNBOUND_AGENCY_STRATEGIES,
  });

  assert.equal(selected?.id, 'secondary_reach');
});

test('isAgencyBoundStatus returns true if either wacrm or joinbrands is bound', () => {
  assert.equal(isAgencyBoundStatus({ agency_bound: 1 }, {}), true);
  assert.equal(isAgencyBoundStatus({}, { ev_agency_bound: 1 }), true);
  assert.equal(isAgencyBoundStatus({ agency_bound: 0 }, { ev_agency_bound: 0 }), false);
});
