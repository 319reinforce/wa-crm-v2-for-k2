const {
    CANONICAL_LIFECYCLE_EVENT_KEYS,
} = require('../constants/eventDecisionRules');

const CANONICAL_LIFECYCLE_EVENT_KEY_SET = new Set(CANONICAL_LIFECYCLE_EVENT_KEYS);

const STAGE_META = {
    acquisition: {
        stage_label: 'Acquisition（获取）',
        goal: '解释应用价值，并让达人真正进入 WA 渠道与 7 日挑战准备态。',
        exit_signal_hint: '完成 7 日挑战或出现明确价值体验后进入 Activation。',
    },
    activation: {
        stage_label: 'Activation（激活）',
        goal: '完成第一次价值体验，核心是完成 7 日挑战；已绑定 Agency 也视为已激活。',
        exit_signal_hint: '完成 Agency 绑定进入 Retention；GMV 达到门槛进入 Revenue。',
    },
    retention: {
        stage_label: 'Retention（留存）',
        goal: '围绕 Agency 绑定后的稳定执行持续推进，为后续 GMV 放大做准备。',
        exit_signal_hint: 'GMV 达到门槛进入 Revenue；明确停止合作则进入终止池。',
    },
    revenue: {
        stage_label: 'Revenue（变现）',
        goal: '达到 GMV 里程碑并进入奖励兑现、里程碑放大的主线。',
        exit_signal_hint: '继续围绕里程碑和奖励兑现推进；明确终止合作则进入终止池。',
    },
    terminated: {
        stage_label: 'Terminated（终止池）',
        goal: '停止主动触达，保留必要审计记录。',
        exit_signal_hint: '仅在达人重新明确恢复合作意愿时再激活。',
    },
};

const OPTION0_TEMPLATES = {
    acquisition: {
        key: 'option0_acquisition',
        label: 'Option0｜WA获取开场',
        next_action_template: '【Option0-获取】围绕 WA 首次建联完成价值说明：一句话解释 Moras 能带来的结果，并只推进一个最小动作进入 7 日挑战。',
        next_action_template_en: '[Option0-Acquisition] Use the first WA touch to explain the value in one sentence and move the creator into one concrete first step for the 7-day challenge.',
        topic_prompt_hint: '不要一次讲太多，先让达人理解“为什么值得试 + 今天先做哪一步”。',
        topic_prompt_hint_en: 'Do not overload. Explain why it is worth trying and the one action to take today.',
    },
    activation: {
        key: 'option0_activation',
        label: 'Option0｜7日挑战激活',
        next_action_template: '【Option0-激活】围绕 7 日挑战完成推进：确认挑战进度、卡点和完成时间；若已明确可绑定 agency，则同步锁定绑定准备动作。',
        next_action_template_en: '[Option0-Activation] Push the 7-day challenge to completion: confirm progress, blockers, and finish timing. If agency binding intent is already clear, lock the prep step as well.',
        topic_prompt_hint: '核心不是泛泛跟进，而是盯住挑战是否完成。',
        topic_prompt_hint_en: 'Do not give generic follow-up. Keep the conversation anchored on challenge completion.',
    },
    retention: {
        key: 'option0_retention',
        label: 'Option0｜绑定后留存推进',
        next_action_template: '【Option0-留存】已完成 agency 绑定，进入留存运营：确认本周执行节奏、视频产出与下个检查点，确保绑定后持续跑起来。',
        next_action_template_en: '[Option0-Retention] Agency is already bound. Move into retention ops: confirm this week\'s cadence, content output, and the next checkpoint to keep execution running.',
        topic_prompt_hint: '围绕绑定后的稳定执行，不再停留在是否绑定。',
        topic_prompt_hint_en: 'Focus on stable post-binding execution, not on whether to bind.',
    },
    revenue: {
        key: 'option0_revenue',
        label: 'Option0｜GMV变现放大',
        next_action_template: '【Option0-变现】已达到 GMV 里程碑，进入变现阶段：确认当前 GMV 水位、奖励兑现节点和下一档增长目标。',
        next_action_template_en: '[Option0-Revenue] GMV milestone is reached. Enter monetization: confirm current GMV level, reward-settlement checkpoint, and the next growth target.',
        topic_prompt_hint: '从“做不做”切到“怎么放大 GMV 和兑现奖励”。',
        topic_prompt_hint_en: 'Switch from whether to act to how to grow GMV and settle rewards.',
    },
    terminated: {
        key: 'option0_terminated',
        label: 'Option0｜终止池维护',
        next_action_template: '【Option0-终止池】标记为终止池并停止主动触达；仅保留必要记录，后续仅被动响应。',
        next_action_template_en: '[Option0-Terminated] Move to termination pool and stop proactive outreach. Keep minimum records and only respond passively.',
        topic_prompt_hint: '不再主动推进动作，避免重复打扰。',
        topic_prompt_hint_en: 'Do not push further actions or repeated outreach.',
    },
};

function toBool(value) {
    return value === true || value === 1 || value === '1';
}

function toNumber(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

function toText(value) {
    return String(value || '').trim();
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

function parseEventMeta(value) {
    if (!value) return {};
    if (typeof value === 'object' && !Array.isArray(value)) return value;
    try {
        return JSON.parse(value);
    } catch (_) {
        return {};
    }
}

function getEventEvidenceTier(item = {}) {
    const meta = parseEventMeta(item?.meta);
    const contractTier = meta?.evidence_contract?.evidence_tier;
    if (contractTier !== undefined && contractTier !== null && contractTier !== '') {
        const numeric = Number(contractTier);
        return Number.isFinite(numeric) ? Math.max(0, Math.min(Math.trunc(numeric), 3)) : 0;
    }
    const verificationStatus = String(meta?.verification?.review_status || '').trim().toLowerCase();
    if (verificationStatus === 'confirmed') return 2;
    return null;
}

function isGeneratedLifecycleEventKey(eventKey = '') {
    const key = String(eventKey || '').trim();
    return /^jb_touchpoint_/i.test(key)
        || /^violation_/i.test(key)
        || /_unknown$/i.test(key)
        || /^gmv_milestone_\d+/i.test(key);
}

function canEventDriveLifecycle(item = {}) {
    const key = String(item?.event_key || item?.eventKey || '').trim();
    if (!CANONICAL_LIFECYCLE_EVENT_KEY_SET.has(key)) return false;
    if (isGeneratedLifecycleEventKey(key)) return false;
    const evidenceTier = getEventEvidenceTier(item);
    if (evidenceTier !== null && evidenceTier < 2) return false;
    return true;
}

function matchesEvent(item, matcher = {}, allowedStatuses = ['active', 'completed']) {
    const status = normalizeEventStatus(item?.status);
    if (!allowedStatuses.includes(status)) return false;
    if (!canEventDriveLifecycle(item)) return false;
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

function findEventSignal(events, eventKey, allowedStatuses = ['active', 'completed']) {
    return !!findEvent(events, { eventKey }, allowedStatuses);
}

function findEventSignalByType(events, eventType, allowedStatuses = ['active', 'completed']) {
    return !!findEvent(events, { eventType }, allowedStatuses);
}

function getEventText(item = {}) {
    return toText(
        item?.trigger_text
        || item?.triggerText
        || item?.meta?.trigger_text
        || item?.meta?.source_text
        || item?.meta?.text
        || item?.meta?.note
    ).toLowerCase();
}

function hasMetaBoolean(item = {}, ...keys) {
    for (const key of keys) {
        const value = item?.meta?.[key];
        if (toBool(value)) return true;
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

function pick(data = {}, ...paths) {
    for (const path of paths) {
        const value = path.split('.').reduce((acc, key) => (acc == null ? undefined : acc[key]), data);
        if (value !== undefined && value !== null && value !== '') return value;
    }
    return undefined;
}

function extractSignals(input = {}) {
    const wacrm = input.wacrm || input._full?.wacrm || {};
    const joinbrands = input.joinbrands || input._full?.joinbrands || {};
    const keeper = input.keeper || input._full?.keeper || {};
    const events = input.events || input.active_events || input.activeEvents || [];
    const messageFacts = input.message_facts || input.messageFacts || input._full?.message_facts || {};

    const betaStatus = toText(pick({ input, wacrm }, 'wacrm.beta_status', 'input.beta_status')).toLowerCase();
    const monthlyFeeStatus = toText(pick({ input, wacrm }, 'wacrm.monthly_fee_status', 'input.monthly_fee_status')).toLowerCase();
    const nextAction = toText(pick({ input, wacrm }, 'wacrm.next_action', 'input.next_action')).toLowerCase();
    const source = toText(input.source).toLowerCase();

    const trialEventActive = findEvent(events, { eventKey: 'trial_7day' }, ['active']);
    const trialEventCompleted = findEvent(events, { eventKey: 'trial_7day' }, ['completed']);
    const trialCompletedSemanticEvent = findSemanticEvent(events, isTrialCompletionSemanticEvent);
    const agencyBoundEvent = findEvent(events, { eventKey: 'agency_bound' }, ['active', 'completed'])
        || findEvent(events, { eventType: 'agency' }, ['active', 'completed']);
    const gmvMilestoneEvent = findEvent(events, { eventKey: 'gmv_milestone' }, ['active', 'completed'])
        || findEvent(events, { eventType: 'gmv' }, ['active', 'completed']);
    const referralEvent = findEvent(events, { eventKey: 'referral' }, ['active', 'completed'])
        || findEvent(events, { eventType: 'referral' }, ['active', 'completed']);

    const agencyBound = toBool(pick({ input, wacrm, joinbrands }, 'wacrm.agency_bound', 'input.agency_bound', 'joinbrands.ev_agency_bound', 'input.ev_agency_bound'))
        || !!agencyBoundEvent;
    const trialInProgress = (
        toBool(pick({ input, joinbrands }, 'joinbrands.ev_trial_active', 'input.ev_trial_active'))
        || !!trialEventActive
    ) && !trialCompletedSemanticEvent;
    const trialCompleted = toBool(pick({ input, joinbrands }, 'joinbrands.ev_trial_7day', 'input.ev_trial_7day'))
        || betaStatus === 'completed'
        || !!trialEventCompleted
        || !!trialCompletedSemanticEvent;
    const gmvValue = toNumber(pick({ input, keeper, joinbrands }, 'keeper.keeper_gmv', 'input.keeper_gmv', 'joinbrands.jb_gmv', 'input.jb_gmv'), 0);
    const gmv2kEvent = toBool(pick({ input, joinbrands }, 'joinbrands.ev_gmv_2k', 'input.ev_gmv_2k'));
    const thresholdRaw = Number(input?.revenueGmvThreshold || input?.options?.revenueGmvThreshold);
    const revenueGmvThreshold = Number.isFinite(thresholdRaw) ? thresholdRaw : 2000;
    const gmvReached = gmv2kEvent || gmvValue >= revenueGmvThreshold || !!gmvMilestoneEvent;
    const paid = monthlyFeeStatus === 'paid' || toBool(pick({ input, wacrm }, 'wacrm.monthly_fee_deducted', 'input.monthly_fee_deducted'));
    const hasTerminatedEvent =
        findEventSignal(events, 'churned')
        || findEventSignal(events, 'do_not_contact')
        || findEventSignal(events, 'opt_out')
        || findEventSignalByType(events, 'termination');
    const churned = toBool(pick({ input, joinbrands }, 'joinbrands.ev_churned', 'input.ev_churned')) || betaStatus === 'churned' || hasTerminatedEvent;
    const referralFromSource = source.includes('referral');
    const referral = !!referralEvent || referralFromSource;
    const waJoined = toBool(pick({ input, joinbrands }, 'joinbrands.ev_joined', 'joinbrands.ev_whatsapp_shared', 'input.ev_joined', 'input.ev_whatsapp_shared'))
        || toBool(messageFacts.wa_joined);
    const noContact = /不继续联系|终止|停止联系|do\s*not\s*contact|stop\s*contact|no\s*longer\s*contact/i.test(nextAction);

    const acquisitionSignal = waJoined;
    const activationSignal = trialCompleted || agencyBound || gmvReached;
    const retentionSignal = agencyBound && !gmvReached;
    const revenueSignal = gmvReached;
    const churnRisk = !churned && waJoined && !trialCompleted && !agencyBound && !gmvReached;

    return {
        waJoined,
        agencyBound,
        trialInProgress,
        trialCompleted,
        trialCompletedSemantic: !!trialCompletedSemanticEvent,
        gmvValue,
        gmvReached,
        gmvTier: buildGmvTier(gmvValue),
        paid,
        referral,
        referralFromSource,
        hasTerminatedEvent,
        churned,
        churnRisk,
        noContact,
        acquisitionSignal,
        activationSignal,
        retentionSignal,
        revenueSignal,
        betaStatus,
        revenueGmvThreshold,
        messageFacts,
    };
}

function buildOption0(stageKey) {
    return OPTION0_TEMPLATES[stageKey] || OPTION0_TEMPLATES.activation;
}

function buildLifecycleFlags(signals = {}) {
    return {
        wa_joined: !!signals.waJoined,
        referral_active: !!signals.referral,
        agency_bound: !!signals.agencyBound,
        trial_in_progress: !!signals.trialInProgress,
        trial_completed: !!signals.trialCompleted,
        trial_completed_semantic: !!signals.trialCompletedSemantic,
        gmv_tier: signals.gmvTier || 'lt_2k',
        churn_risk: !!signals.churnRisk,
        beta_status: signals.betaStatus || null,
    };
}

function buildLifecycleConflicts(signals = {}, stageKey, options = {}) {
    const conflicts = [];
    const thresholdRaw = Number(options?.revenueGmvThreshold);
    const threshold = Number.isFinite(thresholdRaw) ? thresholdRaw : 2000;

    if (!signals.waJoined && ['activation', 'retention', 'revenue'].includes(stageKey)) {
        conflicts.push({
            code: 'mainline_without_wa_channel',
            severity: 'medium',
            message: '尚未确认进入 WA 渠道，但已经被放入生命周期主线。',
        });
    }
    if (signals.trialCompleted && stageKey === 'acquisition') {
        conflicts.push({
            code: 'completed_trial_not_activated',
            severity: 'high',
            message: '7 日挑战已完成，但当前主阶段仍停留在 Acquisition。',
        });
    }
    if (signals.agencyBound && !['retention', 'revenue', 'terminated'].includes(stageKey)) {
        conflicts.push({
            code: 'agency_bound_not_retention',
            severity: 'high',
            message: '已绑定 Agency，但当前主阶段还未进入 Retention/Revenue。',
        });
    }
    if (signals.gmvReached && stageKey !== 'revenue') {
        conflicts.push({
            code: 'gmv_not_revenue',
            severity: 'high',
            message: `GMV 已达到 ${threshold} 门槛，但当前主阶段还未进入 Revenue。`,
        });
    }
    if (signals.churned && stageKey !== 'terminated') {
        conflicts.push({
            code: 'churn_not_terminated',
            severity: 'high',
            message: '已检测到流失信号，但当前主阶段不是 Terminated。',
        });
    }
    if (signals.referral && !signals.waJoined && ['activation', 'retention', 'revenue'].includes(stageKey)) {
        conflicts.push({
            code: 'referral_without_wa_join',
            severity: 'low',
            message: '存在推荐信号，但当前仍未确认进入 WA 渠道。',
        });
    }

    return conflicts;
}

function buildLifecycle(input = {}, options = {}) {
    const thresholdRaw = Number(options?.revenueGmvThreshold);
    const gmvThreshold = Number.isFinite(thresholdRaw) ? thresholdRaw : 2000;
    const signals = extractSignals({
        ...input,
        revenueGmvThreshold: gmvThreshold,
    });

    let stageKey = 'acquisition';
    let entrySignals = [];
    let entryReason = signals.waJoined
        ? '已进入 WA 渠道，进入获取阶段。'
        : '尚未确认进入 WA 渠道，当前停留在获取准备态。';

    if (signals.churned || (!signals.agencyBound && signals.noContact)) {
        stageKey = 'terminated';
        entrySignals = signals.churned ? ['ev_churned|termination_signal'] : ['next_action:no_contact'];
        entryReason = signals.churned
            ? '检测到流失信号，已进入终止池。'
            : '检测到“不继续联系”信号，已进入终止池。';
    } else if (signals.revenueSignal) {
        stageKey = 'revenue';
        entrySignals = [
            signals.gmvReached ? `gmv>=${gmvThreshold}` : null,
            signals.agencyBound ? 'agency_bound' : null,
        ].filter(Boolean);
        entryReason = `GMV 已达到 ${gmvThreshold} 门槛，进入变现阶段。`;
    } else if (signals.retentionSignal) {
        stageKey = 'retention';
        entrySignals = ['agency_bound'];
        entryReason = '已完成 Agency 绑定，进入留存运营阶段。';
    } else if (signals.activationSignal) {
        stageKey = 'activation';
        entrySignals = [
            signals.trialCompleted ? 'trial_7day_completed' : null,
            signals.trialInProgress ? 'trial_7day_active' : null,
            signals.agencyBound ? 'agency_bound' : null,
            signals.paid ? 'payment_proxy' : null,
            signals.referral ? 'referral_active' : null,
        ].filter(Boolean);
        entryReason = signals.trialCompleted
            ? '已完成 7 日挑战，进入激活阶段。'
            : (signals.agencyBound
                ? '已完成 Agency 绑定，因此视为已完成激活。'
                : '已出现明确价值动作，进入激活阶段。');
    } else if (signals.acquisitionSignal) {
        stageKey = 'acquisition';
        entrySignals = [
            signals.waJoined ? 'wa_first_effective_message' : null,
            signals.referral ? 'referral_source' : null,
        ].filter(Boolean);
        entryReason = '已进入 WA 渠道，但仍处于获取与挑战引导阶段。';
    }

    const meta = STAGE_META[stageKey] || STAGE_META.activation;
    const option0 = buildOption0(stageKey);
    const flags = buildLifecycleFlags(signals);
    const conflicts = buildLifecycleConflicts(signals, stageKey, {
        ...options,
        revenueGmvThreshold: gmvThreshold,
    });

    return {
        model: 'AARRR',
        stage_key: stageKey,
        stage_label: meta.stage_label,
        goal: meta.goal,
        entry_signals: entrySignals,
        entry_reason: entryReason,
        exit_signal_hint: meta.exit_signal_hint,
        is_terminal: stageKey === 'terminated',
        option0,
        flags,
        conflicts,
        has_conflicts: conflicts.length > 0,
        snapshot_version: 'lifecycle_v4',
        rule_flags: {
            acquisition_requires_wa_join: true,
            activation_requires_trial_completion: true,
            retention_requires_agency_bound: true,
            revenue_requires_gmv: true,
            revenue_gmv_threshold: gmvThreshold,
        },
        primary_facts: {
            wa_joined: !!signals.waJoined,
            trial_completed: !!signals.trialCompleted,
            trial_completed_semantic: !!signals.trialCompletedSemantic,
            agency_bound: !!signals.agencyBound,
            referral_active: !!signals.referral,
            gmv_tier: signals.gmvTier || 'lt_2k',
            beta_status: signals.betaStatus || null,
        },
        evaluated_at: new Date().toISOString(),
    };
}

module.exports = {
    STAGE_META,
    OPTION0_TEMPLATES,
    extractSignals,
    buildLifecycleFlags,
    buildLifecycleConflicts,
    buildLifecycle,
};
