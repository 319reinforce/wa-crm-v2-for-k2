const EVENT_DECISION_RULES = [
  {
    event_key: 'trial_7day',
    event_type: 'challenge',
    label: '7天试用',
    owner_scope: ['Beau', 'Yiyun'],
    recall_keywords: ['trial', '7day', '7-day', '7 day', '试用', '7天挑战', 'trial pack', 'task pack'],
    positive_signals: [
      'creator explicitly says they started the 7-day trial',
      'creator explicitly says they finished/completed the 7-day trial',
      'operator confirms the creator already joined the 7-day trial',
    ],
    negative_signals: [
      'only introducing the trial without creator confirmation',
      'generic discussion about AI generations without trial participation',
    ],
    status_guidance: {
      draft: '只是被提及、邀请、解释规则，或证据不足。',
      active: '达人明确表示已开始试用、正在做任务。',
      completed: '达人明确表示试用已经完成、做完、结束。',
    },
    required_evidence: ['必须引用 10 条上下文里的明确原句', '如果没有明确开始/完成语义则输出 uncertain'],
  },
  {
    event_key: 'monthly_challenge',
    event_type: 'challenge',
    label: '月度挑战',
    owner_scope: ['Beau', 'Yiyun'],
    recall_keywords: ['monthly challenge', 'monthly', '月度挑战', '包月', 'monthly fee', '每月挑战', '$20 monthly'],
    positive_signals: [
      'creator confirms joining the monthly challenge',
      'operator and creator confirm the creator is already in the monthly cycle',
      'creator confirms monthly fee or monthly execution has started',
    ],
    negative_signals: [
      'only介绍月度方案',
      'only pricing explanation without creator commitment',
    ],
    status_guidance: {
      draft: '只是介绍、解释月度挑战或月费规则。',
      active: '达人确认开始参与月度挑战。',
      completed: '明确完成一个月度周期或完成对应结算。',
    },
    required_evidence: ['必须有达人确认参与或完成的语义'],
  },
  {
    event_key: 'agency_bound',
    event_type: 'agency',
    label: 'Agency绑定',
    owner_scope: ['Beau', 'Yiyun'],
    recall_keywords: ['agency', 'mcn', 'contract', 'signed', 'bind', '绑定', '签约', 'agreement', 'drifto'],
    positive_signals: [
      'creator explicitly agrees to bind/sign with the agency',
      'operator confirms the signing/binding is completed',
      'creator asks for signing link after confirming willingness to bind',
    ],
    negative_signals: [
      'only介绍 agency 模式',
      'creator rejects or hesitates without commitment',
    ],
    status_guidance: {
      draft: '仅在介绍签约、讨论 agency，不足以确认意愿。',
      active: '达人明确表示愿意绑定或已进入签约流程。',
      completed: '明确表示已经签约/绑定完成。',
    },
    required_evidence: ['必须有达人意愿或完成签约的直接语义'],
  },
  {
    event_key: 'gmv_milestone',
    event_type: 'gmv',
    label: 'GMV里程碑',
    owner_scope: ['Beau', 'Yiyun'],
    recall_keywords: ['gmv', 'sales', 'revenue', '$2k', '$5k', '$10k', '2000', '5000', '10000', '成交', '销售额'],
    positive_signals: [
      'conversation explicitly mentions reaching a GMV threshold',
      'operator congratulates the creator for hitting a milestone',
      'keeper_gmv cross-check confirms a threshold and chat context matches milestone discussion',
    ],
    negative_signals: [
      'generic revenue discussion without a milestone',
      'future target discussion without achievement',
    ],
    status_guidance: {
      draft: '只是在讨论目标或数据不明确。',
      active: '里程碑刚达成待确认或待结算。',
      completed: '明确达成并完成核对/庆祝。',
    },
    required_evidence: ['尽量提取 threshold 到 meta.threshold'],
  },
  {
    event_key: 'referral',
    event_type: 'referral',
    label: '推荐',
    owner_scope: ['Beau', 'Yiyun'],
    recall_keywords: ['invite', 'refer', 'referral', '推荐', '介绍', 'invite code', 'creator joined'],
    positive_signals: [
      'creator or operator explicitly mentions introducing another creator',
      'referral code or invitation is sent for another creator',
      'creator says someone else will join through them',
    ],
    negative_signals: [
      'generic mention of community without actual recommendation',
    ],
    status_guidance: {
      draft: '只是提到可以推荐，尚无实际动作。',
      active: '已经在推进推荐对象或邀请码发送。',
      completed: '推荐动作已确认完成或被接收。',
    },
    required_evidence: ['必须出现推荐对象、推荐动作或邀请码语义'],
  },
  {
    event_key: 'recall_pending',
    event_type: 'followup',
    label: '待召回',
    owner_scope: ['Beau', 'Yiyun'],
    recall_keywords: ['follow up', 'follow-up', 'recall', '召回', 'come back', 'check back'],
    positive_signals: [
      'creator previously showed binding willingness but has not landed yet',
      'context indicates the creator should be brought back into the agency flow',
    ],
    negative_signals: [
      'creator explicitly rejects agency binding',
      'creator is already agency_bound',
    ],
    status_guidance: {
      draft: '证据不足以确认进入召回池。',
      active: '确认需要召回并继续跟进。',
      completed: '召回已完成或已重新进入主流程。',
    },
    required_evidence: ['结合上下文判断，不可只凭单句 follow up'],
  },
  {
    event_key: 'second_touch',
    event_type: 'followup',
    label: '二次触达',
    owner_scope: ['Beau', 'Yiyun'],
    recall_keywords: ['second touch', 'follow up', 'follow-up', '二次触达', 'check in again', 'reach back'],
    positive_signals: [
      'creator had little or unclear response previously and now needs a second touch',
      'context shows no clear binding intent yet but follow-up is needed',
    ],
    negative_signals: [
      'creator already clearly agrees to bind agency',
      'creator already agency_bound',
    ],
    status_guidance: {
      draft: '只是普通跟进，没有明确二次触达场景。',
      active: '已确认属于二次触达跟进对象。',
      completed: '二次触达已完成并得出明确结果。',
    },
    required_evidence: ['必须体现“此前未明确回复/无明确意愿”这一上下文'],
  },
  {
    event_key: 'churned',
    event_type: 'termination',
    label: '合作流失',
    owner_scope: ['Beau', 'Yiyun'],
    recall_keywords: ['churn', 'churned', 'stopped working', 'no longer working', '结束合作', '不合作了', '流失'],
    positive_signals: [
      'creator explicitly says the collaboration has ended',
      'operator manually confirms the creator is no longer in the program',
      'conversation confirms there is no remaining recovery, settlement, or referral path',
    ],
    negative_signals: [
      'account ban, violation, or posting block while settlement or recovery is still being discussed',
      'old imported churn flag followed by later payment, referral, support, or restart activity',
    ],
    status_guidance: {
      draft: '只是出现风险或停滞，尚不能确认终止。',
      active: '明确进入流失/终止维护状态。',
      completed: '终止状态已由人工或明确上下文确认。',
    },
    required_evidence: ['必须有明确终止合作语义；风险/封号/提现问题不等于 churned'],
  },
  {
    event_key: 'do_not_contact',
    event_type: 'termination',
    label: '停止主动联系',
    owner_scope: ['Beau', 'Yiyun'],
    recall_keywords: ['do not contact', "don't contact", 'stop contacting', '不要再联系', '停止联系', '别联系'],
    positive_signals: [
      'creator explicitly asks not to be contacted again',
      'operator records a manual do-not-contact decision',
    ],
    negative_signals: [
      'creator is only unavailable, busy, delayed, banned, or waiting for payment',
      'operator suggests a softer follow-up cadence without creator opt-out',
    ],
    status_guidance: {
      draft: '只是跟进频率或时机不清楚。',
      active: '明确要求停止主动联系。',
      completed: '停止联系状态已人工确认。',
    },
    required_evidence: ['必须引用明确拒绝联系或人工确认语义'],
  },
  {
    event_key: 'opt_out',
    event_type: 'termination',
    label: '主动退出',
    owner_scope: ['Beau', 'Yiyun'],
    recall_keywords: ['opt out', 'quit', 'withdraw', 'leave the program', '退出', '不参加了', '放弃'],
    positive_signals: [
      'creator explicitly opts out of the program or challenge',
      'creator clearly says they will not continue after understanding the program',
    ],
    negative_signals: [
      'temporary issue, risk hold, account ban, or settlement question',
      'creator asks questions about payment, recovery, referral, or restart',
    ],
    status_guidance: {
      draft: '只是犹豫或遇到问题。',
      active: '明确选择退出。',
      completed: '退出状态已人工确认。',
    },
    required_evidence: ['必须有明确退出/不继续参与语义'],
  },
];

const CANONICAL_LIFECYCLE_EVENT_KEYS = [
  'trial_7day',
  'monthly_challenge',
  'agency_bound',
  'gmv_milestone',
  'referral',
  'recall_pending',
  'second_touch',
  'churned',
  'do_not_contact',
  'opt_out',
];

const LIFECYCLE_STAGE_KEYS = [
  'acquisition',
  'activation',
  'retention',
  'revenue',
  'terminated',
];

const LIFECYCLE_OVERLAY_KEYS = [
  'referral_active',
  'risk_control_active',
  'settlement_blocked',
  'revenue_claim_pending_verification',
  'migration_imported_fact',
  'weak_event_evidence',
  'challenge_period_missing',
];

const EVENT_DECISION_RULES_BY_KEY = Object.fromEntries(
  EVENT_DECISION_RULES.map((rule) => [rule.event_key, rule])
);

const EVENT_RECALL_KEYWORDS = Object.fromEntries(
  EVENT_DECISION_RULES.map((rule) => [rule.event_key, rule.recall_keywords || []])
);

function getEventDecisionRule(eventKey) {
  return EVENT_DECISION_RULES_BY_KEY[eventKey] || null;
}

function buildEventDecisionTableMarkdown() {
  const header = [
    '| event_key | 类型 | 标签 | 召回关键词 | 正向信号 | 负向信号 |',
    '| --- | --- | --- | --- | --- | --- |',
  ];
  const rows = EVENT_DECISION_RULES.map((rule) => `| ${rule.event_key} | ${rule.event_type} | ${rule.label} | ${(rule.recall_keywords || []).slice(0, 5).join('<br>')} | ${(rule.positive_signals || []).slice(0, 2).join('<br>')} | ${(rule.negative_signals || []).slice(0, 2).join('<br>')} |`);
  return [...header, ...rows].join('\n');
}

module.exports = {
  EVENT_DECISION_RULES,
  EVENT_DECISION_RULES_BY_KEY,
  EVENT_RECALL_KEYWORDS,
  CANONICAL_LIFECYCLE_EVENT_KEYS,
  LIFECYCLE_STAGE_KEYS,
  LIFECYCLE_OVERLAY_KEYS,
  getEventDecisionRule,
  buildEventDecisionTableMarkdown,
};
