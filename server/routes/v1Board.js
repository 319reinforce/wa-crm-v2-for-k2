// v1 看板后端路由（由 wa-ai-crm/v1_adapter_server.js 移植而来）。
// 仅保留 v1 前端使用的 5 个只读端点，mount 到 /v1/api。
// operator 管理、CORS、独立 pool、独立进程监听均已剥离；复用 v2 MySQL pool。
const express = require('express');
const router = express.Router();
const { getPool } = require('../../db');

const DEFAULT_CUTOFF = '2026-01-21T00:00:00Z';
const CUTOFF_TS_MS = Date.parse(process.env.V1_CUTOFF_DATE || DEFAULT_CUTOFF);

const LIFECYCLE_META = {
  acquisition: {
    stage_label: '获取',
    option0: {
      label: 'Option0｜WA获取开场',
      next_action_template: '围绕 WA 首次建联完成价值说明，并只推进一个最小动作进入 7 日挑战。',
    },
  },
  activation: {
    stage_label: '激活',
    option0: {
      label: 'Option0｜7日挑战激活',
      next_action_template: '围绕 7 日挑战完成推进：确认挑战进度、卡点和完成时间；若已明确可绑定 agency，则同步锁定绑定准备动作。',
    },
  },
  retention: {
    stage_label: '留存',
    option0: {
      label: 'Option0｜绑定后留存推进',
      next_action_template: '已完成 agency 绑定，进入留存运营：确认本周执行节奏、视频产出与下个检查点，确保绑定后持续跑起来。',
    },
  },
  revenue: {
    stage_label: '变现',
    option0: {
      label: 'Option0｜GMV变现放大',
      next_action_template: '已达到 GMV 里程碑，进入变现阶段：确认当前 GMV 水位、奖励兑现节点和下一档增长目标。',
    },
  },
  terminated: {
    stage_label: '终止池',
    option0: {
      label: 'Option0｜终止池维护',
      next_action_template: '停止主动触达，仅保留必要记录，后续仅被动响应。',
    },
  },
};

function toMs(value) {
  if (!value) return null;
  if (typeof value === 'number') return value;
  const ts = Date.parse(value);
  return Number.isNaN(ts) ? null : ts;
}

function normalizeTags(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.filter(Boolean);
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.filter(Boolean);
    } catch (_) {}
  }
  return [];
}

function parseJsonSafe(raw, fallback = null) {
  if (raw === null || raw === undefined) return fallback;
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(raw);
  } catch (_) {
    return fallback;
  }
}

function clampConfidence(value, fallback = 2) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.min(3, Math.round(n)));
}

function normalizeEnum(value, allowed = []) {
  const normalized = String(value || '').trim().toLowerCase();
  return allowed.includes(normalized) ? normalized : null;
}

function normalizePortraitField(rawField, allowed = []) {
  if (rawField === null || rawField === undefined) {
    return { value: null, confidence: 2, evidence: '' };
  }

  const rawObj = (typeof rawField === 'object' && rawField !== null) ? rawField : { value: rawField };
  return {
    value: normalizeEnum(rawObj.value, allowed),
    confidence: clampConfidence(rawObj.confidence, 2),
    evidence: String(rawObj.evidence || '').slice(0, 250),
  };
}

function normalizePortraitPayload(payload) {
  if (!payload || typeof payload !== 'object') return null;
  return {
    frequency: normalizePortraitField(payload.frequency, ['high', 'medium', 'low']),
    difficulty: normalizePortraitField(payload.difficulty, ['high', 'medium', 'low']),
    intent: normalizePortraitField(payload.intent, ['strong', 'medium', 'weak']),
    emotion: normalizePortraitField(payload.emotion, ['positive', 'neutral', 'negative']),
  };
}

function mapSnapshotRowToPortrait(row) {
  if (!row) return null;
  return {
    frequency: {
      value: normalizeEnum(row.frequency_level, ['high', 'medium', 'low']),
      confidence: clampConfidence(row.frequency_conf, 2),
      evidence: String(row.frequency_evidence || '').slice(0, 250),
    },
    difficulty: {
      value: normalizeEnum(row.difficulty_level, ['high', 'medium', 'low']),
      confidence: clampConfidence(row.difficulty_conf, 2),
      evidence: String(row.difficulty_evidence || '').slice(0, 250),
    },
    intent: {
      value: normalizeEnum(row.intent_level, ['strong', 'medium', 'weak']),
      confidence: clampConfidence(row.intent_conf, 2),
      evidence: String(row.intent_evidence || '').slice(0, 250),
    },
    emotion: {
      value: normalizeEnum(row.emotion_level, ['positive', 'neutral', 'negative']),
      confidence: clampConfidence(row.emotion_conf, 2),
      evidence: String(row.emotion_evidence || '').slice(0, 250),
    },
  };
}

function hasPortraitValue(portrait) {
  if (!portrait || typeof portrait !== 'object') return false;
  return ['frequency', 'difficulty', 'intent', 'emotion'].some((field) => !!portrait?.[field]?.value);
}

function normalizeLifecycleStageLabel(stageKey, rawLabel) {
  const label = String(rawLabel || '').trim();
  if (label) {
    const match = label.match(/（([^）]+)）/);
    if (match && match[1]) return match[1];
    if (!/[A-Za-z]/.test(label)) return label;
  }
  return LIFECYCLE_META[stageKey]?.stage_label || label || stageKey || '获取';
}

function normalizeOwner(rawOwner) {
  const owner = String(rawOwner || '').trim();
  if (!owner) return null;
  if (owner === 'beau') return 'Jiawen';
  return owner;
}

function buildGmvTier(gmvValue) {
  if (gmvValue >= 10000) return 'gte_10k';
  if (gmvValue >= 5000) return 'gte_5k';
  if (gmvValue >= 2000) return 'gte_2k';
  if (gmvValue > 0) return 'gt_0';
  return 'lt_2k';
}

function normalizeEventStatus(value) {
  const status = String(value || '').trim().toLowerCase();
  if (!status) return 'active';
  if (status === 'pending') return 'draft';
  return status;
}

function matchesEvent(item, matcher = {}, allowedStatuses = ['active', 'completed']) {
  const status = normalizeEventStatus(item?.status);
  if (!allowedStatuses.includes(status)) return false;
  const key = String(item?.event_key || item?.eventKey || '').trim();
  const type = String(item?.event_type || item?.eventType || '').trim();
  if (matcher.eventKey && key !== matcher.eventKey) return false;
  if (matcher.eventType && type !== matcher.eventType) return false;
  return !!(matcher.eventKey || matcher.eventType);
}

function findEvent(events, matcher = {}, allowedStatuses = ['active', 'completed']) {
  if (!Array.isArray(events)) return null;
  return events.find((item) => matchesEvent(item, matcher, allowedStatuses)) || null;
}

function getEventText(item = {}) {
  return String(
    item?.trigger_text
    || item?.triggerText
    || item?.meta?.trigger_text
    || item?.meta?.source_text
    || item?.meta?.text
    || item?.meta?.note
    || ''
  ).trim().toLowerCase();
}

function hasMetaBoolean(item = {}, ...keys) {
  for (const key of keys) {
    const value = item?.meta?.[key];
    if (value === true || value === 1 || value === '1') return true;
    if (typeof value === 'string' && ['true', 'yes', 'completed', 'done'].includes(value.trim().toLowerCase())) {
      return true;
    }
  }
  return false;
}

function isTrialCompletionSemanticEvent(item = {}) {
  if (!matchesEvent(item, { eventKey: 'trial_7day' }, ['active', 'completed'])
    && !matchesEvent(item, { eventType: 'challenge' }, ['active', 'completed'])) {
    return false;
  }
  const text = getEventText(item);
  const mentionsTrial = /(7[\s-]?day|beta trial|moras beta trial|trial)/i.test(text);
  const completionHint = /(completed|complete|finish(?:ed)?|done|graduat(?:ed|ion)?|passed|moving to the monthly|moved to the monthly|continue after trial)/i.test(text);
  return hasMetaBoolean(item, 'completed', 'is_completed', 'trial_completed', 'challenge_completed')
    || (mentionsTrial && completionHint);
}

function findSemanticEvent(events, predicate) {
  if (!Array.isArray(events)) return null;
  return events.find((item) => predicate(item)) || null;
}

function getEventTimeMs(evt, preference = 'start') {
  if (!evt) return null;
  const orderedKeys = preference === 'start'
    ? ['start_at', 'end_at', 'created_at']
    : ['end_at', 'start_at', 'created_at'];
  for (const key of orderedKeys) {
    const ts = toMs(evt[key]);
    if (ts) return ts;
  }
  return null;
}

function parseEventMeta(evt) {
  if (!evt) return {};
  return parseJsonSafe(evt.meta, {}) || {};
}

function earliestMs(values = []) {
  const valid = values.filter(Boolean).map((value) => Number(value)).filter((value) => Number.isFinite(value) && value > 0);
  if (!valid.length) return null;
  return Math.min(...valid);
}

function buildLifecycleMilestones(row, allEvents, lifecycle) {
  const events = Array.isArray(allEvents) ? allEvents : [];
  const currentStage = lifecycle?.stage_key || 'acquisition';
  const flags = lifecycle?.flags || {};

  const acquisitionAt = earliestMs([
    toMs(row.created_at),
    ...events
      .filter(evt => String(evt.event_key || '').trim() === 'trial_7day' || String(evt.event_key || '').trim() === 'agency_bound')
      .map(evt => getEventTimeMs(evt, 'start')),
    toMs(lifecycle?.evaluated_at),
  ]);

  const activationEvents = events.filter(evt =>
    String(evt.event_key || '').trim() === 'trial_7day'
    || String(evt.event_type || '').trim() === 'challenge'
  );
  let activationAt = earliestMs([
    toMs(row.beta_cycle_start),
    ...activationEvents
      .filter(evt => isTrialCompletionSemanticEvent(evt) || normalizeEventStatus(evt.status) === 'completed')
      .map(evt => getEventTimeMs(evt, 'end') || getEventTimeMs(evt, 'start')),
  ]);

  const retentionEvents = events.filter(evt =>
    String(evt.event_key || '').trim() === 'agency_bound'
    || String(evt.event_type || '').trim() === 'agency'
  );
  let retentionAt = earliestMs([
    toMs(row.agency_bound_at),
    ...retentionEvents.map(evt => getEventTimeMs(evt, 'start')),
  ]);

  const revenueEvents = events.filter(evt =>
    String(evt.event_key || '').trim() === 'gmv_milestone'
    || String(evt.event_type || '').trim() === 'gmv'
  );
  let revenueAt = earliestMs([
    Number(row.keeper_gmv || row.jb_gmv || 0) >= 2000 ? toMs(lifecycle?.evaluated_at) : null,
    ...revenueEvents.map(evt => getEventTimeMs(evt, 'start')),
  ]);

  const terminatedEvents = events.filter(evt => {
    const key = String(evt.event_key || '').trim();
    const type = String(evt.event_type || '').trim();
    return ['churned', 'do_not_contact', 'opt_out'].includes(key) || type === 'termination';
  });
  let terminatedAt = earliestMs(terminatedEvents.map(evt => getEventTimeMs(evt, 'start')));

  const evaluatedAt = toMs(lifecycle?.evaluated_at);

  if (!activationAt && (['activation', 'retention', 'revenue'].includes(currentStage) || flags.trial_completed || flags.trial_in_progress)) {
    activationAt = earliestMs([retentionAt, revenueAt, evaluatedAt, acquisitionAt]);
  }
  if (!retentionAt && (['retention', 'revenue'].includes(currentStage) || flags.agency_bound)) {
    retentionAt = earliestMs([revenueAt, evaluatedAt, activationAt, acquisitionAt]);
  }
  if (!revenueAt && currentStage === 'revenue') {
    revenueAt = earliestMs([evaluatedAt, retentionAt, activationAt, acquisitionAt]);
  }
  if (!terminatedAt && currentStage === 'terminated') {
    terminatedAt = earliestMs([evaluatedAt, retentionAt, activationAt, acquisitionAt]);
  }

  const milestones = {
    acquisition_at: acquisitionAt,
    activation_at: activationAt,
    retention_at: retentionAt,
    revenue_at: revenueAt,
    terminated_at: terminatedAt,
  };

  if (!milestones.acquisition_at) {
    milestones.acquisition_at = earliestMs([
      milestones.activation_at,
      milestones.retention_at,
      milestones.revenue_at,
      milestones.terminated_at,
      evaluatedAt,
    ]);
  }
  if (!milestones.activation_at && milestones.retention_at) milestones.activation_at = milestones.retention_at;
  if (!milestones.activation_at && milestones.revenue_at) milestones.activation_at = milestones.revenue_at;
  if (!milestones.retention_at && milestones.revenue_at) milestones.retention_at = milestones.revenue_at;

  const stageOrder = ['acquisition', 'activation', 'retention', 'revenue'];
  const currentIndex = stageOrder.indexOf(currentStage);
  if (currentStage !== 'terminated' && currentIndex >= 0) {
    stageOrder.forEach((stageKey, index) => {
      if (index > currentIndex) {
        milestones[stageKey + '_at'] = null;
      }
    });
    milestones.terminated_at = null;
  }

  return milestones;
}

function normalizeConflictItems(conflicts) {
  const list = Array.isArray(conflicts) ? conflicts : [];
  return list.map((item) => {
    if (typeof item === 'string') {
      return { code: item, severity: 'info', message: item };
    }
    return {
      code: item?.code || 'unknown_conflict',
      severity: item?.severity || 'info',
      message: item?.message || item?.code || 'Unknown conflict',
    };
  });
}

function mergeLifecycleSnapshot(fallbackLifecycle, snapshot, transitions = []) {
  if (!snapshot) {
    return {
      ...fallbackLifecycle,
      conflicts: [],
      has_conflicts: false,
      transition_history: transitions,
      source: 'fallback',
      evaluated_at: null,
    };
  }

  const stageKey = snapshot.stage_key || fallbackLifecycle.stage_key;
  const stageLabel = normalizeLifecycleStageLabel(stageKey, snapshot.stage_label);
  const conflicts = normalizeConflictItems(snapshot.conflicts);
  const option0 = {
    key: snapshot.option0_key || fallbackLifecycle.option0?.key || null,
    label: snapshot.option0_label || fallbackLifecycle.option0?.label || LIFECYCLE_META[stageKey]?.option0?.label || null,
    next_action_template: snapshot.option0_next_action || fallbackLifecycle.option0?.next_action_template || LIFECYCLE_META[stageKey]?.option0?.next_action_template || '',
  };

  return {
    stage_key: stageKey,
    stage_label: stageLabel,
    entry_signals: snapshot.entry_signals || fallbackLifecycle.entry_signals || [],
    entry_reason: snapshot.entry_reason || fallbackLifecycle.entry_reason || '',
    option0,
    flags: {
      ...(fallbackLifecycle.flags || {}),
      ...(snapshot.flags || {}),
    },
    conflicts,
    has_conflicts: conflicts.length > 0,
    is_terminal: stageKey === 'terminated',
    snapshot_version: snapshot.snapshot_version || 'lifecycle_v2',
    trigger_type: snapshot.trigger_type || null,
    trigger_id: snapshot.trigger_id || null,
    evaluated_at: toMs(snapshot.evaluated_at),
    transition_history: transitions,
    source: 'snapshot',
  };
}

function buildLifecycleSummary(row, allEvents) {
  const betaStatus = String(row.beta_status || 'not_introduced').trim().toLowerCase();
  const monthlyFeeStatus = String(row.monthly_fee_status || 'pending').trim().toLowerCase();
  const nextAction = String(row.next_action || '').trim().toLowerCase();
  const events = Array.isArray(allEvents) ? allEvents : [];
  const trialEventActive = findEvent(events, { eventKey: 'trial_7day' }, ['active']);
  const trialEventCompleted = findEvent(events, { eventKey: 'trial_7day' }, ['completed']);
  const trialCompletedSemanticEvent = findSemanticEvent(events, isTrialCompletionSemanticEvent);
  const agencyBoundEvent = findEvent(events, { eventKey: 'agency_bound' }, ['active', 'completed'])
    || findEvent(events, { eventType: 'agency' }, ['active', 'completed']);
  const gmvMilestoneEvent = findEvent(events, { eventKey: 'gmv_milestone' }, ['active', 'completed'])
    || findEvent(events, { eventType: 'gmv' }, ['active', 'completed']);
  const referralEvent = findEvent(events, { eventKey: 'referral' }, ['active', 'completed'])
    || findEvent(events, { eventType: 'referral' }, ['active', 'completed']);

  const agencyBound = !!(row.agency_bound || row.ev_agency_bound) || !!agencyBoundEvent;
  const trialCompleted = !!row.ev_trial_7day
    || betaStatus === 'completed'
    || !!trialEventCompleted
    || !!trialCompletedSemanticEvent;
  const trialInProgress = (!!row.ev_trial_active || !!trialEventActive) && !trialCompleted;
  const gmvValue = Number(row.keeper_gmv || row.jb_gmv || 0);
  const gmvReached = !!row.ev_gmv_2k || gmvValue >= 2000 || !!gmvMilestoneEvent;
  const paid = monthlyFeeStatus === 'paid' || !!row.monthly_fee_deducted;
  const referralActive = !!referralEvent || String(row.source || '').toLowerCase().includes('referral');
  const terminatedByEvent = events.some(evt => {
    const key = String(evt.event_key || '').trim().toLowerCase();
    const type = String(evt.event_type || '').trim().toLowerCase();
    const active = ['active', 'completed'].includes(normalizeEventStatus(evt.status));
    return active && (
      key === 'churned' ||
      key === 'do_not_contact' ||
      key === 'opt_out' ||
      type === 'termination'
    );
  });
  const churned = !!row.ev_churned || betaStatus === 'churned' || terminatedByEvent;
  const waJoined = !!row.ev_joined || !!row.ev_whatsapp_shared || !!row.wa_phone;
  const noContact = /不继续联系|终止|停止联系|do\s*not\s*contact|stop\s*contact|no\s*longer\s*contact/i.test(nextAction);
  const acquisitionSignal = waJoined;
  const activationSignal = trialCompleted || agencyBound || gmvReached;
  const retentionSignal = agencyBound && !gmvReached;
  const revenueSignal = gmvReached;

  let stageKey = 'acquisition';
  let entrySignals = [];
  let entryReason = waJoined
    ? '已进入 WA 渠道，进入获取阶段。'
    : '尚未确认进入 WA 渠道，当前停留在获取准备态。';

  if (churned || (!agencyBound && noContact)) {
    stageKey = 'terminated';
    entrySignals = churned ? ['ev_churned|termination_signal'] : ['next_action:no_contact'];
    entryReason = churned ? '检测到流失信号，已进入终止池。' : '检测到“不继续联系”信号，已进入终止池。';
  } else if (revenueSignal) {
    stageKey = 'revenue';
    entrySignals = [
      gmvReached ? 'gmv>=2000' : null,
      agencyBound ? 'agency_bound' : null,
    ].filter(Boolean);
    entryReason = 'GMV 已达到 2000 门槛，进入变现阶段。';
  } else if (retentionSignal) {
    stageKey = 'retention';
    entrySignals = ['agency_bound'];
    entryReason = '已完成 Agency 绑定，进入留存运营阶段。';
  } else if (activationSignal) {
    stageKey = 'activation';
    entrySignals = [
      trialCompleted ? 'trial_7day_completed' : null,
      trialInProgress ? 'trial_7day_active' : null,
      agencyBound ? 'agency_bound' : null,
      paid ? 'payment_proxy' : null,
      referralActive ? 'referral_active' : null,
    ].filter(Boolean);
    entryReason = trialCompleted
      ? '已完成 7 日挑战，进入激活阶段。'
      : (agencyBound
        ? '已完成 Agency 绑定，因此视为已完成激活。'
        : '已出现明确价值动作，进入激活阶段。');
  } else if (acquisitionSignal) {
    entrySignals = [
      waJoined ? 'wa_first_effective_message' : null,
      referralActive ? 'referral_source' : null,
    ].filter(Boolean);
    entryReason = '已进入 WA 渠道，但仍处于获取与挑战引导阶段。';
  }

  const meta = LIFECYCLE_META[stageKey] || LIFECYCLE_META.acquisition;
  const gmvTier = buildGmvTier(gmvValue);
  const churnRisk = !churned && waJoined && !trialCompleted && !agencyBound && !gmvReached;

  return {
    stage_key: stageKey,
    stage_label: meta.stage_label,
    entry_signals: entrySignals,
    entry_reason: entryReason,
    option0: meta.option0,
    flags: {
      wa_joined: waJoined,
      referral_active: referralActive,
      agency_bound: agencyBound,
      trial_in_progress: trialInProgress,
      trial_completed: trialCompleted,
      trial_completed_semantic: !!trialCompletedSemanticEvent,
      gmv_tier: gmvTier,
      churn_risk: churnRisk,
      beta_status: betaStatus || null,
    },
  };
}

function hasReachedRevenue(flags = {}, stageKey = '') {
  const gmvTier = String(flags?.gmv_tier || '').trim().toLowerCase();
  return stageKey === 'revenue' || ['gte_2k', 'gte_5k', 'gte_10k'].includes(gmvTier);
}

function hasReachedRetention(flags = {}, stageKey = '') {
  return !!flags?.agency_bound || ['retention', 'revenue'].includes(stageKey);
}

function hasReachedActivation(flags = {}, stageKey = '') {
  return !!flags?.trial_completed
    || !!flags?.trial_completed_semantic
    || hasReachedRetention(flags, stageKey)
    || hasReachedRevenue(flags, stageKey)
    || stageKey === 'activation';
}

function hasReachedAcquisition(flags = {}) {
  return !!flags?.wa_joined;
}

function ensureCounterGroup(map, key) {
  map[key] = map[key] || {};
  return map[key];
}

function incrementCounter(map, key, bucket) {
  const group = ensureCounterGroup(map, key);
  group[bucket] = (group[bucket] || 0) + 1;
}

let cache = { ts: 0, creators: [], byCreatorId: {}, byPhone: {}, joinbrands: [], keeper: [], lifecycle_dashboard: null };
const CACHE_TTL = 15 * 1000;

async function getFilteredCreatorIds(conn) {
  const baseFilter = `
    c.wa_phone REGEXP '^1[0-9]{10}$'
    AND (c.primary_name IS NULL OR LOWER(c.primary_name) NOT LIKE '%moras%')
    AND c.wa_owner IN ('Beau','Yiyun')
  `;
  const sql = `
    SELECT c.id
    FROM creators c
    JOIN wa_messages wm ON wm.creator_id = c.id
    JOIN wa_crm_data w ON w.creator_id = c.id
    WHERE ${baseFilter}
    GROUP BY c.id
    HAVING COUNT(wm.id) >= 3 AND MAX(wm.timestamp) >= ?
  `;
  const [rows] = await conn.query(sql, [CUTOFF_TS_MS]);
  return rows.map(r => r.id);
}

async function loadBaseData() {
  const now = Date.now();
  if (cache.creators.length && (now - cache.ts) < CACHE_TTL) return cache;

  const conn = await getPool().getConnection();
  try {
    const ids = await getFilteredCreatorIds(conn);
    if (ids.length === 0) {
      cache = { ts: now, creators: [], byCreatorId: {}, byPhone: {}, joinbrands: [], keeper: [] };
      return cache;
    }

    const placeholders = ids.map(() => '?').join(', ');
    const [creatorRows] = await conn.query(
      `
      SELECT
        c.id, c.wa_phone, c.primary_name, c.source, c.wa_owner, c.created_at,
        w.priority, w.next_action, w.event_score, w.urgency_level, w.updated_at,
        w.beta_status, w.beta_cycle_start, w.beta_program_type,
        w.monthly_fee_status, w.monthly_fee_amount, w.monthly_fee_deducted,
        w.agency_bound, w.agency_bound_at, w.agency_deadline,
        w.video_count, w.video_target, w.video_last_checked,
        j.creator_name_jb, j.jb_gmv, j.jb_status, j.jb_priority, j.jb_next_action,
        j.last_message, j.days_since_msg, j.invite_code_jb,
        j.ev_joined, j.ev_ready_sent, j.ev_trial_7day, j.ev_trial_active,
        j.ev_monthly_invited, j.ev_monthly_started, j.ev_monthly_joined,
        j.ev_whatsapp_shared, j.ev_gmv_1k, j.ev_gmv_2k, j.ev_gmv_5k, j.ev_gmv_10k,
        j.ev_agency_bound, j.ev_churned,
        k.keeper_username, k.keeper_gmv, k.keeper_gmv30, k.keeper_orders,
        k.keeper_videos, k.keeper_videos_posted, k.keeper_videos_sold
      FROM creators c
      JOIN wa_crm_data w ON w.creator_id = c.id
      LEFT JOIN joinbrands_link j ON j.creator_id = c.id
      LEFT JOIN keeper_link k ON k.creator_id = c.id
      WHERE c.id IN (${placeholders})
      `,
      ids
    );

    const [msgStats] = await conn.query(
      `SELECT creator_id, COUNT(*) AS msg_count, MAX(timestamp) AS last_active
       FROM wa_messages WHERE creator_id IN (${placeholders}) GROUP BY creator_id`,
      ids
    );
    const msgStatMap = new Map(msgStats.map(r => [r.creator_id, r]));

    const [messages] = await conn.query(
      `SELECT creator_id, role, text, timestamp
       FROM wa_messages WHERE creator_id IN (${placeholders})
       ORDER BY timestamp ASC`,
      ids
    );
    const messagesByCreatorId = new Map();
    for (const m of messages) {
      if (!messagesByCreatorId.has(m.creator_id)) messagesByCreatorId.set(m.creator_id, []);
      messagesByCreatorId.get(m.creator_id).push({
        role: m.role,
        text: m.text || '',
        timestamp: m.timestamp,
      });
    }

    const phones = creatorRows.map(r => r.wa_phone).filter(Boolean);
    const phonePlaceholders = phones.map(() => '?').join(', ');

    const [profileTagRows] = phones.length
      ? await conn.query(`SELECT client_id, tags FROM client_profiles WHERE client_id IN (${phonePlaceholders})`, phones)
      : [[]];
    const profileTags = new Map(profileTagRows.map(r => [r.client_id, normalizeTags(r.tags)]));

    const [tagRows] = phones.length
      ? await conn.query(
          `SELECT client_id, tag FROM client_tags WHERE client_id IN (${phonePlaceholders}) ORDER BY created_at ASC`,
          phones
        )
      : [[]];
    const tagMap = new Map();
    for (const row of tagRows) {
      if (!tagMap.has(row.client_id)) tagMap.set(row.client_id, []);
      tagMap.get(row.client_id).push(row.tag);
    }

    const [profileRows] = phones.length
      ? await conn.query(
        `SELECT client_id, summary, tiktok_data, stage, last_interaction, last_updated
         FROM client_profiles
         WHERE client_id IN (${phonePlaceholders})`,
        phones
      )
      : [[]];
    const profileRowMap = new Map(profileRows.map((row) => [row.client_id, row]));

    const [profileSnapshotRows] = phones.length
      ? await conn.query(
        `SELECT client_id,
                frequency_level, frequency_conf, frequency_evidence,
                difficulty_level, difficulty_conf, difficulty_evidence,
                intent_level, intent_conf, intent_evidence,
                emotion_level, emotion_conf, emotion_evidence,
                id
         FROM client_profile_snapshots
         WHERE client_id IN (${phonePlaceholders})
         ORDER BY client_id ASC, id DESC`,
        phones
      )
      : [[]];
    const profileSnapshotMap = new Map();
    for (const row of profileSnapshotRows) {
      if (!profileSnapshotMap.has(row.client_id)) {
        profileSnapshotMap.set(row.client_id, row);
      }
    }

    const [eventRows] = await conn.query(
      `SELECT creator_id, event_type, event_key, status, trigger_text, start_at, end_at, meta, created_at
       FROM events WHERE creator_id IN (${placeholders})`,
      ids
    );
    const eventsByCreatorId = new Map();
    for (const e of eventRows) {
      if (!eventsByCreatorId.has(e.creator_id)) eventsByCreatorId.set(e.creator_id, []);
      eventsByCreatorId.get(e.creator_id).push(e);
    }

    let snapshotRows = [];
    try {
      const [rows] = await conn.query(
        `SELECT
          creator_id,
          stage_key,
          stage_label,
          entry_reason,
          entry_signals_json,
          flags_json,
          conflicts_json,
          option0_key,
          option0_label,
          option0_next_action,
          snapshot_version,
          trigger_type,
          trigger_id,
          evaluated_at,
          updated_at
        FROM creator_lifecycle_snapshot
        WHERE creator_id IN (${placeholders})`,
        ids
      );
      snapshotRows = rows;
    } catch (err) {
      if (!String(err?.message || '').includes('creator_lifecycle_snapshot')) throw err;
    }
    const snapshotsByCreatorId = new Map(snapshotRows.map((row) => [
      row.creator_id,
      {
        ...row,
        entry_signals: parseJsonSafe(row.entry_signals_json, []),
        flags: parseJsonSafe(row.flags_json, {}),
        conflicts: parseJsonSafe(row.conflicts_json, []),
      },
    ]));

    let transitionRows = [];
    try {
      const [rows] = await conn.query(
        `SELECT
          id,
          creator_id,
          from_stage,
          to_stage,
          trigger_type,
          trigger_id,
          trigger_source,
          reason,
          signals_json,
          flags_json,
          operator,
          created_at
        FROM creator_lifecycle_transition
        WHERE creator_id IN (${placeholders})
        ORDER BY created_at ASC, id ASC`,
        ids
      );
      transitionRows = rows;
    } catch (err) {
      if (!String(err?.message || '').includes('creator_lifecycle_transition')) throw err;
    }
    const transitionsByCreatorId = new Map();
    for (const row of transitionRows) {
      if (!transitionsByCreatorId.has(row.creator_id)) transitionsByCreatorId.set(row.creator_id, []);
      transitionsByCreatorId.get(row.creator_id).push({
        id: row.id,
        from_stage: row.from_stage || null,
        to_stage: row.to_stage || null,
        trigger_type: row.trigger_type || null,
        trigger_id: row.trigger_id || null,
        trigger_source: row.trigger_source || null,
        reason: row.reason || null,
        signals: parseJsonSafe(row.signals_json, []),
        flags: parseJsonSafe(row.flags_json, {}),
        operator: row.operator || null,
        created_at: toMs(row.created_at),
      });
    }

    const creators = creatorRows.map(row => {
      const stats = msgStatMap.get(row.id) || { msg_count: 0, last_active: null };
      const messages = messagesByCreatorId.get(row.id) || [];

      const tags = profileTags.get(row.wa_phone) || tagMap.get(row.wa_phone) || [];
      const profileRow = profileRowMap.get(row.wa_phone) || null;
      const tiktokData = parseJsonSafe(profileRow?.tiktok_data, {}) || {};
      const manualPortrait = normalizePortraitPayload(tiktokData?.portrait_manual || tiktokData?.portrait || null);
      const snapshotPortrait = mapSnapshotRowToPortrait(profileSnapshotMap.get(row.wa_phone) || null);
      const portrait = hasPortraitValue(manualPortrait)
        ? manualPortrait
        : (hasPortraitValue(snapshotPortrait) ? snapshotPortrait : null);
      const portraitSource = hasPortraitValue(manualPortrait)
        ? 'manual'
        : (hasPortraitValue(snapshotPortrait) ? 'system' : null);

      const monthlyFee = {
        amount: row.monthly_fee_amount ?? 20,
        status: row.monthly_fee_status || 'pending',
        deducted: !!row.monthly_fee_deducted,
        deducted_at: null,
        due_date: null,
      };

      const agencyBound = (row.agency_bound ?? row.ev_agency_bound ?? 0) ? true : false;

      const allEvents = eventsByCreatorId.get(row.id) || [];
      const eventStream = allEvents.map((evt) => {
        const meta = parseEventMeta(evt);
        const status = normalizeEventStatus(evt.status);
        const ts = getEventTimeMs(evt, 'end') || getEventTimeMs(evt, 'start') || toMs(evt.created_at);
        return {
          event_type: evt.event_type || '',
          event_key: evt.event_key || '',
          status,
          trigger_text: evt.trigger_text || '',
          start_at: toMs(evt.start_at),
          end_at: toMs(evt.end_at),
          created_at: toMs(evt.created_at),
          timestamp: ts || null,
          meta,
        };
      }).sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

      const fallbackLifecycle = buildLifecycleSummary(row, allEvents);
      const lifecycle = mergeLifecycleSnapshot(
        fallbackLifecycle,
        snapshotsByCreatorId.get(row.id) || null,
        transitionsByCreatorId.get(row.id) || []
      );
      lifecycle.milestones = buildLifecycleMilestones(row, allEvents, lifecycle);

      const challengeEvents = eventStream.filter((evt) =>
        evt.event_type === 'challenge'
        || ['trial_7day', 'monthly_challenge'].includes(evt.event_key)
      );
      const trialEvents = eventStream.filter((evt) => evt.event_key === 'trial_7day');
      const monthlyChallengeEvents = eventStream.filter((evt) => evt.event_key === 'monthly_challenge');
      const agencyEvents = eventStream.filter((evt) =>
        evt.event_key === 'agency_bound' || evt.event_type === 'agency'
      );
      const referralEvents = eventStream.filter((evt) =>
        evt.event_key === 'referral' || evt.event_type === 'referral'
      );
      const gmvEvents = eventStream.filter((evt) =>
        evt.event_type === 'gmv' || String(evt.event_key || '').startsWith('gmv_milestone')
      );
      const trialDoneByText = trialEvents.some((evt) =>
        /(completed|finish(?:ed)?|done|graduat(?:ed|ion)?)/i.test(String(evt.trigger_text || ''))
      );
      const trialCompleted = trialEvents.some((evt) => evt.status === 'completed') || trialDoneByText;
      const challengeActive = challengeEvents.some((evt) => ['active', 'completed'].includes(evt.status));
      const betaStatus = (() => {
        if (String(row.beta_status || '').toLowerCase() === 'churned') return 'churned';
        if (trialCompleted || monthlyChallengeEvents.some((evt) => evt.status === 'completed')) return 'completed';
        if (challengeActive) return 'active';
        if (challengeEvents.some((evt) => evt.status === 'draft')) return 'introduced';
        return row.beta_status || 'not_introduced';
      })();
      const joinedAt = earliestMs([
        toMs(row.beta_cycle_start),
        ...challengeEvents.map((evt) => evt.start_at || evt.created_at),
      ]);
      const agencyBoundAtByEvent = earliestMs(
        agencyEvents
          .filter((evt) => ['active', 'completed'].includes(evt.status))
          .map((evt) => evt.start_at || evt.created_at)
      );

      const events = {
        violations: [],
        monthly_beta: {
          joined: ['active', 'completed', 'joined'].includes(String(betaStatus || '').toLowerCase()),
          joined_at: joinedAt,
          cycle_start_date: toMs(row.beta_cycle_start),
          program_type: row.beta_program_type || '20_day_beta',
          status: betaStatus,
        },
        agency_binding: {
          bound: agencyBound || !!agencyBoundAtByEvent,
          bound_at: toMs(row.agency_bound_at) || agencyBoundAtByEvent || null,
          deadline: row.agency_deadline || null,
          '强化程度': 0,
        },
        monthly_fee: monthlyFee,
        weekly_videos: {
          current_week: 0,
          target_daily: 5,
          target_weekly: row.video_target ?? 35,
          target_bonus: 40,
          current_count: row.video_count ?? 0,
          last_checked: row.video_last_checked || null,
          history: [],
        },
        referrals: [],
        gmv_milestones: [],
        event_stream: eventStream,
      };

      // violations
      eventStream.forEach(evt => {
        if (evt.event_type !== 'challenge') return;
        if (!(evt.event_key || '').includes('violation')) return;
        events.violations.push({
          description: evt.trigger_text || evt.meta?.note || '',
          reported_at: evt.created_at,
          response: null,
          status: evt.status === 'completed' ? 'resolved' : 'pending',
        });
      });

      // referrals
      referralEvents.forEach(evt => {
        const meta = evt.meta || {};
        events.referrals.push({
          name: meta.name || meta.referred_name || '',
          phone: meta.phone || meta.referred_phone || '',
          invited_at: evt.created_at,
          status: evt.status === 'completed' ? 'joined' : 'pending',
        });
      });

      gmvEvents.forEach((evt) => {
        const meta = evt.meta || {};
        const value = Number(meta.value || meta.gmv || meta.amount || 0);
        events.gmv_milestones.push({
          key: evt.event_key || 'gmv_milestone',
          status: evt.status,
          timestamp: evt.timestamp || evt.created_at || null,
          value: Number.isFinite(value) ? value : 0,
        });
      });

      return {
        id: row.id,
        phone: row.wa_phone,
        name: row.primary_name,
        source: row.source || 'unknown',
        created_at: toMs(row.created_at),
        messages,
        tags,
        analysis: { last_analyzed_index: 0, history: [] },
        priority: row.priority || 'low',
        next_action: row.next_action || '',
        score: {
          urgency_level: row.urgency_level ?? 5,
          event_score: row.event_score ?? 0,
          last_updated: toMs(row.updated_at) || Date.now(),
        },
        msg_count: stats.msg_count || 0,
        last_active: stats.last_active ? new Date(stats.last_active).toISOString() : null,
        wa_owner: normalizeOwner(row.wa_owner),
        wa_owner_raw: row.wa_owner || null,
        keeper_gmv: row.keeper_gmv || null,
        conversion_stage: lifecycle.stage_label,
        lifecycle,
        profile: {
          summary: profileRow?.summary || null,
          portrait,
          portrait_source: portraitSource,
          stage: profileRow?.stage || lifecycle.stage_key || null,
          last_interaction: profileRow?.last_interaction ? toMs(profileRow.last_interaction) : null,
          last_updated: profileRow?.last_updated ? toMs(profileRow.last_updated) : null,
          tags,
        },
        lifecycle_snapshot: snapshotsByCreatorId.get(row.id) || null,
        lifecycle_transition: transitionsByCreatorId.get(row.id) || [],
        events,
      };
    });

    const creatorByPhone = new Map(creators.map(c => [c.phone, c]));
    const creatorById = new Map(creators.map(c => [c.id, c]));

    const joinbrands = creatorRows.map(row => {
      if (!row.creator_name_jb) return null;
      const creator = creatorById.get(row.id) || creatorByPhone.get(row.wa_phone);
      const waMessages = creator?.messages || [];
      const ev = (key) => (row[key] ? { completed: true } : { completed: false });

      const whatsappShared = row.ev_whatsapp_shared
        ? { completed: true, phone: row.wa_phone }
        : { completed: false, phone: row.wa_phone };

      const activityStatus = row.ev_churned
        ? 'churned'
        : (row.days_since_msg && row.days_since_msg > 5)
          ? 'churn_risk'
          : (row.ev_agency_bound ? 'bound' : 'active');

      return {
        creatorId: row.id || creator?.id || null,
        creatorName: row.creator_name_jb,
        waName: creator?.name || row.primary_name || row.creator_name_jb || null,
        gmv: row.jb_gmv || 0,
        priority: row.jb_priority || 'low',
        jbStatus: row.jb_status || 'unknown',
        nextAction: row.jb_next_action || '',
        daysSinceLastMessage: row.days_since_msg ?? 999,
        lastMessageDate: row.last_message ? new Date(Number(row.last_message)).toLocaleDateString('zh-CN') : '',
        activityStatus,
        events: {
          ready_sent: ev('ev_ready_sent'),
          trial_7day_completed: ev('ev_trial_7day'),
          monthly_invited: ev('ev_monthly_invited'),
          monthly_joined: ev('ev_monthly_joined'),
          whatsapp_shared: whatsappShared,
          gmv_1k: ev('ev_gmv_1k'),
          gmv_2k: ev('ev_gmv_2k'),
          gmv_5k: ev('ev_gmv_5k'),
          gmv_10k: ev('ev_gmv_10k'),
          agency_bound: ev('ev_agency_bound'),
        },
        rawMessages: waMessages,
        waPhone: row.wa_phone || null,
        waOwner: creator?.wa_owner || null,
        lifecycle: creator?.lifecycle || null,
        profile: creator?.profile || null,
        identity: {
          creatorId: row.id || creator?.id || null,
          waPhone: row.wa_phone || null,
          jbName: row.creator_name_jb || null,
          owner: creator?.wa_owner || null,
        },
      };
    }).filter(Boolean);

    const keeper = creatorRows.map(row => {
      if (!row.keeper_username) return null;
      const creator = creatorById.get(row.id);
      if (!creator) return null;
      return {
        creatorId: row.id || creator?.id || null,
        username: row.keeper_username,
        waName: row.primary_name || '-',
        waPhone: row.wa_phone || '-',
        videoTotal: row.keeper_videos || 0,
        videoPosted: row.keeper_videos_posted || 0,
        videoSold: row.keeper_videos_sold || 0,
        totalGMV: row.keeper_gmv || 0,
        gmv30Days: row.keeper_gmv30 || 0,
        orders: row.keeper_orders || 0,
        waOwner: creator?.wa_owner || null,
        lifecycle: creator?.lifecycle || null,
        profile: creator?.profile || null,
        identity: {
          creatorId: row.id || creator?.id || null,
          waPhone: row.wa_phone || null,
          keeperUsername: row.keeper_username || null,
          owner: creator?.wa_owner || null,
        },
      };
    }).filter(Boolean);

    cache = {
      ts: now,
      creators,
      byCreatorId: creatorById,
      byPhone: creatorByPhone,
      joinbrands,
      keeper,
      lifecycle_dashboard: {
        snapshot_ready: snapshotRows.length > 0,
        snapshot_count: snapshotRows.length,
        transition_count: transitionRows.length,
      },
    };
    return cache;
  } finally {
    conn.release();
  }
}

router.get('/health', (_req, res) => {
  res.json({ ok: true, timestamp: new Date().toISOString() });
});

router.get('/users', async (_req, res) => {
  try {
    const data = await loadBaseData();
    res.json(data.creators);
  } catch (e) {
    res.status(500).json({ error: 'Failed to load users', detail: e.message });
  }
});

router.get('/lifecycle/dashboard', async (_req, res) => {
  try {
    const conn = await getPool().getConnection();
    try {
      const ids = await getFilteredCreatorIds(conn);
      if (ids.length === 0) {
        return res.json({
          ok: true,
          total: 0,
          stage_counts: {},
          funnel_counts: { acquisition: 0, activation: 0, retention: 0, revenue: 0 },
          wa_joined_count: 0,
          terminated_count: 0,
          referral_active_count: 0,
          conflict_count: 0,
          conflicts: [],
          snapshot_ready: false,
          snapshot_count: 0,
          transition_count: 0,
        });
      }

      const placeholders = ids.map(() => '?').join(', ');
      const [rows] = await conn.query(
        `
          SELECT
            c.id,
            c.primary_name,
            c.wa_owner,
            cls.stage_key,
            cls.stage_label,
            cls.flags_json,
            cls.conflicts_json,
            cls.entry_reason,
            cls.evaluated_at
          FROM creator_lifecycle_snapshot cls
          INNER JOIN creators c ON c.id = cls.creator_id
          WHERE cls.creator_id IN (${placeholders})
          ORDER BY cls.evaluated_at DESC, c.id DESC
        `,
        ids
      );

      const stage_counts = {};
      const funnel_counts = { acquisition: 0, activation: 0, retention: 0, revenue: 0 };
      let referral_active_count = 0;
      let wa_joined_count = 0;
      let terminated_count = 0;
      const conflicts = [];

      for (const row of rows) {
        const flags = parseJsonSafe(row.flags_json, {}) || {};
        const rowConflicts = parseJsonSafe(row.conflicts_json, []) || [];
        const stageKey = String(row.stage_key || 'unknown');
        const inWaChannel = !!flags.wa_joined;

        if (inWaChannel) wa_joined_count += 1;
        if (inWaChannel || stageKey === 'terminated') {
          stage_counts[stageKey] = (stage_counts[stageKey] || 0) + 1;
        }
        if (stageKey === 'terminated') terminated_count += 1;
        if (flags.referral_active && inWaChannel) referral_active_count += 1;

        if (hasReachedAcquisition(flags, stageKey)) funnel_counts.acquisition += 1;
        if (hasReachedActivation(flags, stageKey) && hasReachedAcquisition(flags, stageKey)) funnel_counts.activation += 1;
        if (hasReachedRetention(flags, stageKey) && hasReachedAcquisition(flags, stageKey)) funnel_counts.retention += 1;
        if (hasReachedRevenue(flags, stageKey) && hasReachedAcquisition(flags, stageKey)) funnel_counts.revenue += 1;

        if (Array.isArray(rowConflicts) && rowConflicts.length > 0) {
          conflicts.push({
            creator_id: row.id || null,
            creator_name: row.primary_name || null,
            wa_owner: row.wa_owner || null,
            stage_key: stageKey || null,
            stage_label: row.stage_label || null,
            conflicts: rowConflicts,
            entry_reason: row.entry_reason || null,
            evaluated_at: toMs(row.evaluated_at),
          });
        }
      }

      const data = await loadBaseData();
      res.json({
        ok: true,
        total: rows.length,
        stage_counts,
        funnel_counts,
        wa_joined_count,
        terminated_count,
        referral_active_count,
        conflict_count: conflicts.length,
        conflicts,
        snapshot_ready: rows.length > 0,
        snapshot_count: rows.length,
        transition_count: data.lifecycle_dashboard?.transition_count || 0,
      });
    } finally {
      conn.release();
    }
  } catch (e) {
    res.status(500).json({ error: 'Failed to load lifecycle dashboard', detail: e.message });
  }
});

router.get('/users/:phone/messages', async (req, res) => {
  const phone = String(req.params.phone || '').trim();
  if (!phone) return res.status(400).json({ error: 'invalid phone' });
  try {
    const data = await loadBaseData();
    const user = data.byPhone.get(phone);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const messages = user.messages || [];
    const events = user.events || {};
    const allEvents = [];

    const hasPendingViolation = (events.violations || []).some(v => v.status === 'pending');
    (events.violations || []).forEach(v => {
      if (v.status === 'pending' || (!hasPendingViolation && v.status === 'resolved')) {
        allEvents.push({
          timestamp: v.reported_at,
          type: v.status === 'pending' ? 'violation_pending' : 'violation_resolved',
          label: v.status === 'pending' ? '🚨 违规待处理' : '✅ 违规已解决',
          detail: (v.description || '').slice(0, 50),
        });
      }
    });

    if (events.monthly_beta?.joined_at) {
      allEvents.push({
        timestamp: events.monthly_beta.joined_at,
        type: 'beta_joined',
        label: '📋 加入20天Beta计划',
        detail: '',
      });
    }

    if (events.monthly_fee?.deducted && events.monthly_fee.deducted_at) {
      allEvents.push({
        timestamp: events.monthly_fee.deducted_at,
        type: 'payment_completed',
        label: '💰 付款完成',
        detail: events.monthly_fee.amount ? '$' + events.monthly_fee.amount : '',
      });
    }

    const DAY_MS = 24 * 60 * 60 * 1000;
    const enriched = messages.map(msg => {
      const msgEvents = [];
      allEvents.forEach(evt => {
        const isViolation = evt.type === 'violation_pending' || evt.type === 'violation_resolved';
        if (isViolation || (evt.timestamp && Math.abs(evt.timestamp - msg.timestamp) < DAY_MS)) {
          msgEvents.push({ type: evt.type, label: evt.label, detail: evt.detail });
        }
      });
      return { ...msg, events: msgEvents };
    });

    res.json(enriched);
  } catch (e) {
    res.status(500).json({ error: 'Failed to load messages', detail: e.message });
  }
});

router.get('/joinbrands', async (_req, res) => {
  try {
    const data = await loadBaseData();
    res.json(data.joinbrands);
  } catch (e) {
    res.status(500).json({ error: 'Failed to load joinbrands', detail: e.message });
  }
});

router.get('/keeper', async (_req, res) => {
  try {
    const data = await loadBaseData();
    res.json(data.keeper);
  } catch (e) {
    res.status(500).json({ error: 'Failed to load keeper', detail: e.message });
  }
});

module.exports = router;
