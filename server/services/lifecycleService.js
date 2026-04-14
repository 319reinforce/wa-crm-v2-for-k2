const STAGE_META = {
    acquisition: {
        stage_label: 'Acquisition（获取）',
        goal: '解释应用价值，推动达人进入正式7日体验并完成首次有效触达。',
        exit_signal_hint: '出现试用执行动作或绑定意向后进入 Activation。',
    },
    activation: {
        stage_label: 'Activation（激活）',
        goal: '完成第一次价值体验（试用执行、绑定意向明确或首次付费）。',
        exit_signal_hint: '持续执行进入 Retention；已绑定时进入 Revenue 主线。',
    },
    retention: {
        stage_label: 'Retention（留存）',
        goal: '形成周/月稳定执行，持续产出内容与动作。',
        exit_signal_hint: '达成变现主线进入 Revenue；长期无动作回退 Activation。',
    },
    revenue: {
        stage_label: 'Revenue（收入）',
        goal: '围绕绑定主线推进里程碑达成与奖励兑现。',
        exit_signal_hint: '若明确拒绝绑定且不继续联系，转入终止池。',
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
        label: 'Option0｜7日体验引导',
        next_action_template: '【Option0-获取】发送7日体验说明（目标+收益+1个最小动作），当日确认是否进入体验并记录意向。',
        next_action_template_en: '[Option0-Acquisition] Send a 7-day trial brief (value + reward + one small first step), confirm opt-in today, and log intent.',
        topic_prompt_hint: '开场聚焦“为什么值得试 + 今天先做哪一步”，避免一次性给过多信息。',
        topic_prompt_hint_en: 'Focus on why it is worth trying and one concrete first step today. Avoid overload.',
    },
    activation: {
        key: 'option0_activation',
        label: 'Option0｜首个价值动作锁定',
        next_action_template: '【Option0-激活】锁定首次价值动作（试用启动/绑定意向确认/首付节点），明确完成时间并次日回查。',
        next_action_template_en: '[Option0-Activation] Lock the first value action (trial start / binding intent / first payment checkpoint), set exact timing, and follow up next day.',
        topic_prompt_hint: '一次只推进一个动作，要求明确时间点与反馈结果。',
        topic_prompt_hint_en: 'Push one action only and ask for an explicit time commitment and outcome.',
    },
    retention: {
        key: 'option0_retention',
        label: 'Option0｜周节奏留存',
        next_action_template: '【Option0-留存】按周复盘执行：确认本周产出目标、阻塞点与下个检查点，保持固定节奏推进。',
        next_action_template_en: '[Option0-Retention] Run weekly cadence: align output target, blockers, and next checkpoint to keep consistent execution.',
        topic_prompt_hint: '先确认上周结果，再给本周单一优先目标与检查点。',
        topic_prompt_hint_en: 'Confirm last-week outcome first, then set one top priority and checkpoint for this week.',
    },
    revenue: {
        key: 'option0_revenue',
        label: 'Option0｜绑定后变现推进',
        next_action_template: '【Option0-收入】已绑定Agency，进入变现主线：确认本周里程碑、奖励兑现节点与负责人，按节点推进。',
        next_action_template_en: '[Option0-Revenue] Agency is bound. Enter monetization mainline: confirm this week\'s milestone, reward-settlement checkpoint, and owner.',
        topic_prompt_hint: '围绕绑定后的执行与兑现节奏沟通，不再停留在是否绑定的讨论。',
        topic_prompt_hint_en: 'Focus on post-binding execution and settlement cadence, not on whether to bind.',
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

function findEventSignal(events, eventKey) {
    if (!Array.isArray(events)) return false;
    return events.some((item) => {
        const key = String(item?.event_key || item?.eventKey || '').trim();
        const status = String(item?.status || '').trim().toLowerCase();
        return key === eventKey && (status === '' || status === 'active' || status === 'completed');
    });
}

function findEventSignalByType(events, eventType) {
    if (!Array.isArray(events)) return false;
    return events.some((item) => {
        const type = String(item?.event_type || item?.eventType || '').trim();
        const status = String(item?.status || '').trim().toLowerCase();
        return type === eventType && (status === '' || status === 'active' || status === 'completed');
    });
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

    const betaStatus = toText(pick({ input, wacrm }, 'wacrm.beta_status', 'input.beta_status')).toLowerCase();
    const betaProgramType = toText(pick({ input, wacrm }, 'wacrm.beta_program_type', 'input.beta_program_type')).toLowerCase();
    const monthlyFeeStatus = toText(pick({ input, wacrm }, 'wacrm.monthly_fee_status', 'input.monthly_fee_status')).toLowerCase();
    const nextAction = toText(pick({ input, wacrm }, 'wacrm.next_action', 'input.next_action')).toLowerCase();
    const source = toText(input.source).toLowerCase();

    const hasAgencyBoundEvent = findEventSignal(events, 'agency_bound') || findEventSignalByType(events, 'agency');
    const hasTrialEvent = findEventSignal(events, 'trial_7day');
    const hasMonthlyChallengeEvent = findEventSignal(events, 'monthly_challenge') || findEventSignalByType(events, 'challenge');
    const hasGmvMilestoneEvent = findEventSignal(events, 'gmv_milestone') || findEventSignalByType(events, 'gmv');

    const agencyBound = toBool(pick({ input, wacrm, joinbrands }, 'wacrm.agency_bound', 'input.agency_bound', 'joinbrands.ev_agency_bound', 'input.ev_agency_bound')) || hasAgencyBoundEvent;
    const trialActive = toBool(pick({ input, joinbrands }, 'joinbrands.ev_trial_active', 'joinbrands.ev_trial_7day', 'input.ev_trial_active', 'input.ev_trial_7day')) || hasTrialEvent;
    const monthlyStarted = toBool(pick({ input, joinbrands }, 'joinbrands.ev_monthly_started', 'input.ev_monthly_started')) || hasMonthlyChallengeEvent;
    const monthlyJoined = toBool(pick({ input, joinbrands }, 'joinbrands.ev_monthly_joined', 'input.ev_monthly_joined')) || hasMonthlyChallengeEvent;
    const monthlyInvited = toBool(pick({ input, joinbrands }, 'joinbrands.ev_monthly_invited', 'input.ev_monthly_invited'));
    const gmvValue = toNumber(pick({ input, keeper, joinbrands }, 'keeper.keeper_gmv', 'input.keeper_gmv', 'joinbrands.jb_gmv', 'input.jb_gmv'), 0);
    const gmv2kEvent = toBool(pick({ input, joinbrands }, 'joinbrands.ev_gmv_2k', 'input.ev_gmv_2k'));
    const gmv2kValue = gmvValue >= 2000;
    const gmv2k = gmv2kEvent || gmv2kValue || hasGmvMilestoneEvent;
    const referralEventField = toBool(pick({ input }, 'input.ev_referral_event'));
    const terminatedEventField = toBool(pick({ input }, 'input.ev_terminated_event'));
    const hasTerminatedEvent = terminatedEventField
        || findEventSignal(events, 'churned')
        || findEventSignal(events, 'do_not_contact')
        || findEventSignal(events, 'opt_out')
        || findEventSignalByType(events, 'termination');
    const churned = toBool(pick({ input, joinbrands }, 'joinbrands.ev_churned', 'input.ev_churned')) || betaStatus === 'churned' || hasTerminatedEvent;
    const paid = monthlyFeeStatus === 'paid' || toBool(pick({ input, wacrm }, 'wacrm.monthly_fee_deducted', 'input.monthly_fee_deducted'));
    const referralFromEvent = referralEventField || findEventSignal(events, 'referral') || findEventSignalByType(events, 'referral');
    const referralFromSource = source.includes('referral');
    const referral = referralFromEvent || referralFromSource;

    const noContact = /不继续联系|终止|停止联系|do\s*not\s*contact|stop\s*contact|no\s*longer\s*contact/i.test(nextAction);

    const acquisitionSignal =
        betaStatus === 'not_introduced' ||
        betaStatus === 'introduced' ||
        betaStatus === 'pending' ||
        betaProgramType.includes('beta') ||
        trialActive ||
        monthlyInvited ||
        hasTrialEvent ||
        findEventSignal(events, 'beta_program');

    const activationSignal =
        trialActive ||
        monthlyStarted ||
        paid ||
        betaStatus === 'started' ||
        betaStatus === 'completed';

    const retentionSignal = monthlyStarted || monthlyJoined || gmv2k;
    const monthlyActive = monthlyStarted || monthlyJoined;
    const churnRisk = !churned && (
        (!!monthlyInvited && !monthlyActive)
        || (betaStatus === 'introduced' && !trialActive && !paid && !agencyBound)
    );

    return {
        agencyBound,
        trialActive,
        monthlyStarted,
        monthlyJoined,
        monthlyActive,
        monthlyInvited,
        gmvValue,
        gmv2k,
        gmvTier: buildGmvTier(gmvValue),
        paid,
        referral,
        referralFromEvent,
        referralFromSource,
        hasTerminatedEvent,
        churned,
        churnRisk,
        noContact,
        acquisitionSignal,
        activationSignal,
        retentionSignal,
        betaStatus,
    };
}

function buildOption0(stageKey) {
    return OPTION0_TEMPLATES[stageKey] || OPTION0_TEMPLATES.activation;
}

function buildLifecycleFlags(signals = {}) {
    return {
        referral_active: !!signals.referral,
        agency_bound: !!signals.agencyBound,
        trial_active: !!signals.trialActive,
        monthly_active: !!signals.monthlyActive,
        gmv_tier: signals.gmvTier || 'lt_2k',
        churn_risk: !!signals.churnRisk,
        beta_status: signals.betaStatus || null,
    };
}

function buildLifecycleConflicts(signals = {}, stageKey, options = {}) {
    const conflicts = [];
    const thresholdRaw = Number(options?.revenueGmvThreshold);
    const threshold = Number.isFinite(thresholdRaw) ? thresholdRaw : 2000;

    if (signals.agencyBound && stageKey !== 'revenue') {
        conflicts.push({
            code: 'agency_bound_not_revenue',
            severity: 'high',
            message: '已绑定 Agency，但当前主阶段不是 Revenue。',
        });
    }
    if (signals.gmv2k && (stageKey === 'acquisition' || stageKey === 'activation')) {
        conflicts.push({
            code: 'gmv_outpaces_stage',
            severity: 'medium',
            message: `GMV 已达到 ${threshold} 门槛，但当前主阶段仍偏前置。`,
        });
    }
    if (signals.churned && stageKey !== 'terminated') {
        conflicts.push({
            code: 'churn_not_terminated',
            severity: 'high',
            message: '已检测到流失信号，但当前主阶段不是 Terminated。',
        });
    }
    if (signals.referral && stageKey === 'acquisition') {
        conflicts.push({
            code: 'referral_without_activation',
            severity: 'low',
            message: '存在推荐信号，但主线仍停留在 Acquisition。',
        });
    }

    return conflicts;
}

function buildLifecycle(input = {}, options = {}) {
    const signals = extractSignals(input);
    const agencyBoundMainline = options?.agencyBoundMainline !== false;
    const strictRevenueGmv = options?.strictRevenueGmv === true;
    const gmvThresholdRaw = Number(options?.revenueGmvThreshold);
    const gmvThreshold = Number.isFinite(gmvThresholdRaw) ? gmvThresholdRaw : 2000;

    let stageKey = 'acquisition';
    let entrySignals = [];
    let entryReason = '默认进入获取阶段，待收集更多执行信号。';

    if (signals.churned || (!signals.agencyBound && signals.noContact)) {
        stageKey = 'terminated';
        entrySignals = signals.churned ? ['ev_churned|beta_status=churned'] : ['next_action:no_contact'];
        entryReason = signals.churned
            ? '检测到流失信号，已进入终止池。'
            : '检测到“不继续联系”信号，已进入终止池。';
    } else if (agencyBoundMainline && signals.agencyBound && (!strictRevenueGmv || signals.gmv2k)) {
        stageKey = 'revenue';
        entrySignals = strictRevenueGmv ? ['agency_bound', `gmv>${gmvThreshold}`] : ['agency_bound'];
        entryReason = strictRevenueGmv
            ? `已绑定Agency且GMV超过${gmvThreshold}，进入收入阶段。`
            : '已绑定Agency，按当前临时规则进入收入阶段（暂不校验GMV）。';
    } else if (signals.retentionSignal) {
        stageKey = 'retention';
        entrySignals = [
            signals.monthlyStarted ? 'monthly_challenge_active' : null,
            signals.monthlyJoined ? 'monthly_challenge_completed' : null,
            signals.gmv2k ? 'gmv>2k' : null,
        ].filter(Boolean);
        entryReason = '已出现持续执行信号，进入留存阶段。';
    } else if (signals.activationSignal || signals.acquisitionSignal) {
        stageKey = signals.activationSignal ? 'activation' : 'acquisition';
        entrySignals = signals.activationSignal
            ? [
                signals.trialActive ? 'trial_7day_active' : null,
                signals.monthlyStarted ? 'monthly_challenge_started' : null,
                signals.paid ? 'first_payment' : null,
                signals.referral ? 'referral_source' : null,
                (signals.betaStatus === 'started' || signals.betaStatus === 'joined') ? `beta_status:${signals.betaStatus}` : null,
            ].filter(Boolean)
            : [
                'beta_program_pending',
                signals.referral ? 'referral_source' : null,
            ].filter(Boolean);
        entryReason = signals.activationSignal
            ? '已出现首次价值动作信号，进入激活阶段。'
            : (signals.referral
                ? '检测到推荐引入信号，但尚处体验引导期，先进入获取阶段。'
                : '处于体验引导期，进入获取阶段。');
    }

    if (stageKey === 'acquisition' && signals.referral && !entrySignals.includes('referral_source')) {
        entrySignals = [...entrySignals, 'referral_source'];
        if (!entryReason || entryReason.includes('默认进入获取阶段')) {
            entryReason = '检测到推荐引入信号，但尚处体验引导期，先进入获取阶段。';
        }
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
        snapshot_version: 'lifecycle_v2',
        rule_flags: {
            revenue_relaxed_to_agency_bound: !strictRevenueGmv,
            agency_bound_mainline: agencyBoundMainline,
            revenue_gmv_threshold: gmvThreshold,
        },
        primary_facts: {
            agency_bound: !!signals.agencyBound,
            referral_active: !!signals.referral,
            monthly_active: !!signals.monthlyActive,
            trial_active: !!signals.trialActive,
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
