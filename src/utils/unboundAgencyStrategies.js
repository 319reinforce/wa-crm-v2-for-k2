const DEFAULT_UNBOUND_AGENCY_STRATEGIES_RAW = [
  {
    id: 'secondary_reach',
    name: '二次触达',
    name_en: 'Secondary Reach',
    short_desc: '对沉默或意愿不明达人进行低压力再沟通，先拿到明确态度。',
    memory_key: 'agency_strategy_secondary_reach',
    memory_value: '该达人当前处于二次触达阶段：此前对Agency绑定回复较少或意愿不明确。沟通策略应先破冰确认近况与顾虑，再给一个最小行动选项，目标是获得明确态度（愿意了解/暂缓/拒绝）。避免直接施压成交。\nEnglish playbook: This creator is in secondary reach stage. Prior responses about agency binding were limited or unclear. Start with a light check-in, clarify blockers, and offer one low-commitment next step. The goal is to get an explicit stance (interested / postpone / decline), not force a close.',
    next_action_template: '【二次触达】24小时内发起轻提醒，先确认近况与顾虑；给1个最小动作选项（如先确认资料或时间），目标拿到明确意向并记录结果。',
    next_action_template_en: '[Secondary Reach] Send a light follow-up within 24h. Clarify status and blockers, offer one low-commitment step, and capture an explicit stance.',
    prompt_hint: '开场先共情+确认现状，不直接硬推绑定；一次只推进一个小动作，本轮目标是拿到明确态度。',
    prompt_hint_en: 'Lead with empathy and status check, avoid hard selling. Push only one small next step and aim for an explicit stance this round.',
    aliases: ['二次触达', 'secondary reach', 'secondary_reach'],
    priority: 10,
  },
  {
    id: 'recall_pending',
    name: '待召回',
    name_en: 'Pending Recall',
    short_desc: '对已表达可绑定但未落地达人做节点推进，推动尽快完成绑定。',
    memory_key: 'agency_strategy_recall_pending',
    memory_value: '该达人当前处于待召回阶段：此前已明确表示可以绑定Agency，但仍未进入实际落地。沟通策略应复述其既有意愿，给出明确时间点与单一步骤推进，目标是锁定完成时间并促成实际动作。\nEnglish playbook: This creator is pending recall. They already expressed willingness to bind the agency, but no concrete action happened. Re-anchor on prior intent, propose one concrete step with a clear time point, and lock the execution window.',
    next_action_template: '【待召回】今天确认绑定所需信息与时间点，发送单一步骤清单并锁定完成时间；若未回复，次日同时段跟进一次。',
    next_action_template_en: '[Pending Recall] Confirm required info and exact binding time today, send one-step checklist, and lock the completion window. If no reply, follow up same time next day.',
    prompt_hint: '先引用对方既往“可绑定”意向，再给具体时间点和单一步骤；本轮目标是确认落地时间/动作。',
    prompt_hint_en: 'Reference prior willingness first, then provide one concrete step with timing. Goal is to lock execution time/action this round.',
    aliases: ['待召回', 'pending recall', 'recall pending', 'recall_pending'],
    priority: 20,
  },
];

function normalizeText(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeAliases(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item || '').trim()).filter(Boolean);
}

function normalizeStrategy(raw = {}) {
  const priorityRaw = Number(raw.priority);
  return {
    id: String(raw.id || '').trim(),
    name: String(raw.name || '').trim(),
    nameEn: String(raw.nameEn ?? raw.name_en ?? '').trim(),
    shortDesc: String(raw.shortDesc ?? raw.short_desc ?? '').trim(),
    memoryKey: String(raw.memoryKey ?? raw.memory_key ?? '').trim(),
    memoryValue: String(raw.memoryValue ?? raw.memory_value ?? '').trim(),
    nextActionTemplate: String(raw.nextActionTemplate ?? raw.next_action_template ?? '').trim(),
    nextActionTemplateEn: String(raw.nextActionTemplateEn ?? raw.next_action_template_en ?? '').trim(),
    promptHint: String(raw.promptHint ?? raw.prompt_hint ?? '').trim(),
    promptHintEn: String(raw.promptHintEn ?? raw.prompt_hint_en ?? '').trim(),
    aliases: normalizeAliases(raw.aliases || []),
    priority: Number.isFinite(priorityRaw) ? priorityRaw : 0,
  };
}

export function normalizeUnboundAgencyStrategies(input) {
  if (!Array.isArray(input)) return [];
  return input
    .map(normalizeStrategy)
    .filter((item) => item.id && item.name && item.memoryKey);
}

export const DEFAULT_UNBOUND_AGENCY_STRATEGIES = normalizeUnboundAgencyStrategies(DEFAULT_UNBOUND_AGENCY_STRATEGIES_RAW);
export const UNBOUND_AGENCY_STRATEGIES = DEFAULT_UNBOUND_AGENCY_STRATEGIES;

function getStrategies(inputStrategies) {
  const normalized = normalizeUnboundAgencyStrategies(inputStrategies);
  return normalized.length > 0 ? normalized : DEFAULT_UNBOUND_AGENCY_STRATEGIES;
}

function detectByText(text, strategies) {
  const target = normalizeText(text);
  if (!target) return null;
  for (const strategy of strategies) {
    if ((strategy.aliases || []).some((alias) => target.includes(normalizeText(alias)))) {
      return strategy;
    }
  }
  return null;
}

function pickHigherPriority(current, next) {
  if (!next) return current;
  if (!current) return next;
  const currScore = Number(current.priority || 0);
  const nextScore = Number(next.priority || 0);
  return nextScore > currScore ? next : current;
}

export function resolveUnboundAgencyStrategy({ clientMemory = [], nextAction = '', strategies = [] } = {}) {
  const effectiveStrategies = getStrategies(strategies);
  const strategyByMemoryKey = Object.fromEntries(
    effectiveStrategies.map((item) => [item.memoryKey, item])
  );

  let fromMemory = null;
  for (const memory of (clientMemory || [])) {
    const memoryType = memory?.type || memory?.memory_type;
    const memoryKey = memory?.key || memory?.memory_key;
    const memoryValue = memory?.value || memory?.memory_value;
    if (memoryType !== 'strategy') continue;
    const byKey = strategyByMemoryKey[memoryKey] || null;
    const byValue = detectByText(memoryValue || '', effectiveStrategies);
    const detected = byKey || byValue;
    fromMemory = pickHigherPriority(fromMemory, detected);
  }
  if (fromMemory) return fromMemory;

  const fromNextAction = detectByText(nextAction || '', effectiveStrategies);
  if (fromNextAction) return fromNextAction;

  return effectiveStrategies[0] || null;
}

export function isAgencyBoundStatus(wacrm = {}, joinbrands = {}, eventSnapshot = null) {
  const flags = eventSnapshot?.compat_ev_flags || eventSnapshot || {};
  const hasSnapshotAgencyFlag = Object.prototype.hasOwnProperty.call(flags, 'ev_agency_bound');
  if (hasSnapshotAgencyFlag) return !!flags.ev_agency_bound;
  return !!(wacrm?.agency_bound || joinbrands?.ev_agency_bound);
}
