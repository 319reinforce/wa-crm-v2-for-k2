(function () {
    const LIFECYCLE_STAGE_META = [
        { key: 'acquisition', label: '获取', color: '#6d8fe5' },
        { key: 'activation', label: '激活', color: '#e2a55f' },
        { key: 'retention', label: '留存', color: '#58a68b' },
        { key: 'revenue', label: '变现', color: '#2f7d65' },
        { key: 'terminated', label: '终止池', color: '#c36b4b' }
    ];

    const LIFECYCLE_AARRR_META = [
        { key: 'acquisition', label: '获取', color: '#6d8fe5' },
        { key: 'activation', label: '激活', color: '#e2a55f' },
        { key: 'retention', label: '留存', color: '#58a68b' },
        { key: 'revenue', label: '变现', color: '#2f7d65' },
        { key: 'referral', label: '传播', color: '#b8734c' }
    ];

    function getLifecycleStageMeta(stageKey) {
        return LIFECYCLE_STAGE_META.find((stage) => stage.key === stageKey) || LIFECYCLE_STAGE_META[0];
    }

    function getLifecycleTransitionHistory(user) {
        const raw = user?.lifecycle?.transition_history || user?.lifecycle_transition || [];
        return Array.isArray(raw) ? raw : [];
    }

    function hasOfficialLifecycleSnapshot(user) {
        return user?.lifecycle?.source === 'snapshot' || !!user?.lifecycle_snapshot;
    }

    function getLifecycleLatestEventMs(user) {
        const transitions = getLifecycleTransitionHistory(user).filter((item) => item && item.created_at);
        if (transitions.length > 0) {
            return Math.max(...transitions.map((item) => Number(item.created_at) || 0));
        }
        const evaluatedAt = user?.lifecycle?.evaluated_at;
        if (evaluatedAt) return Number(evaluatedAt) || Date.parse(evaluatedAt) || null;
        return null;
    }

    function getLifecycleMilestones(user) {
        const raw = user?.lifecycle?.milestones || {};
        return {
            acquisition_at: Number(raw.acquisition_at) || null,
            activation_at: Number(raw.activation_at) || null,
            retention_at: Number(raw.retention_at) || null,
            revenue_at: Number(raw.revenue_at) || null,
            terminated_at: Number(raw.terminated_at) || null
        };
    }

    function getReferralActivatedAt(user) {
        const referrals = user?.events?.referrals || [];
        const referredTimes = referrals
            .map((item) => Number(item?.invited_at || 0))
            .filter((ts) => Number.isFinite(ts) && ts > 0);
        if (referredTimes.length > 0) return Math.min(...referredTimes);
        if (user?.lifecycle?.flags?.referral_active) {
            const evaluated = user?.lifecycle?.evaluated_at;
            const ts = typeof evaluated === 'number' ? evaluated : Date.parse(evaluated || '');
            if (!Number.isNaN(ts) && ts > 0) return ts;
        }
        return null;
    }

    function getLifecycleEventMilestones(user) {
        const milestones = getLifecycleMilestones(user);
        const flags = user?.lifecycle?.flags || {};
        const eventMilestones = {
            acquisition_at: milestones.acquisition_at || (user?.created_at ? Date.parse(user.created_at) : null),
            activation_at: milestones.activation_at,
            retention_at: milestones.retention_at,
            revenue_at: milestones.revenue_at,
            referral_at: getReferralActivatedAt(user)
        };

        const beta = user?.events?.monthly_beta || {};
        const fee = user?.events?.monthly_fee || {};
        const agency = user?.events?.agency_binding || {};
        const gmv = Number(user?.keeper_gmv || 0);
        const referrals = user?.events?.referrals || [];

        if (!eventMilestones.activation_at) {
            const trialTs = beta.challenge_completed_at || beta.joined_at || beta.cycle_start_date;
            const feeTs = fee.deducted_at || fee.last_attempt_at;
            if (trialTs && feeTs) {
                const t1 = Date.parse(trialTs);
                const t2 = Date.parse(feeTs);
                if (!Number.isNaN(t1) && !Number.isNaN(t2)) eventMilestones.activation_at = Math.max(t1, t2);
            } else if (flags.trial_completed && feeTs) {
                const t = Date.parse(feeTs);
                if (!Number.isNaN(t)) eventMilestones.activation_at = t;
            }
        }
        if (!eventMilestones.retention_at && (agency.bound || flags.agency_bound)) {
            const t = Date.parse(agency.bound_at || agency.updated_at || user?.last_active || '');
            if (!Number.isNaN(t)) eventMilestones.retention_at = t;
        }
        if (!eventMilestones.revenue_at && (gmv >= 2000 || ['gte_2k', 'gte_5k', 'gte_10k', '2k', '5k', '10k'].includes(flags.gmv_tier))) {
            const t = Date.parse(user?.last_active || user?.updated_at || '');
            if (!Number.isNaN(t)) eventMilestones.revenue_at = t;
        }
        if (!eventMilestones.referral_at && referrals.length > 0) {
            const inviteTs = referrals
                .map((item) => Number(item?.invited_at || 0))
                .filter((ts) => Number.isFinite(ts) && ts > 0);
            if (inviteTs.length > 0) eventMilestones.referral_at = Math.min(...inviteTs);
        }

        return eventMilestones;
    }

    function getLifecycleBoardEvents(user) {
        const flags = user?.lifecycle?.flags || {};
        const beta = user?.events?.monthly_beta || {};
        const fee = user?.events?.monthly_fee || {};
        const agency = user?.events?.agency_binding || {};
        const gmv = Number(user?.keeper_gmv || 0);
        const rows = [];

        if (flags.wa_joined) rows.push('已入 WA');
        if (flags.trial_completed || beta.status === 'joined') rows.push('7日挑战完成');
        if (fee.deducted || fee.status === 'deducted') rows.push('首笔佣金结算');
        if (agency.bound || flags.agency_bound) rows.push('Agency 已绑定');
        if (gmv >= 2000 || ['gte_2k', 'gte_5k', 'gte_10k', '2k', '5k', '10k'].includes(flags.gmv_tier)) rows.push('GMV 达到 2000');
        if (flags.referral_active) rows.push('传播活跃');
        if ((user?.lifecycle?.conflicts || []).length > 0) rows.push('存在冲突');
        if (flags.churn_risk) rows.push('流失风险');

        return rows.slice(0, 6);
    }

    function renderPersonalLifecycleMiniChart(user) {
        const stages = LIFECYCLE_AARRR_META;
        const milestones = getLifecycleEventMilestones(user);
        const seq = ['acquisition', 'activation', 'retention', 'revenue'];
        let progressIndex = -1;
        seq.forEach((key, idx) => {
            if (milestones[key + '_at']) progressIndex = idx;
        });
        const hasReferral = !!milestones.referral_at;
        const width = 320;
        const left = 16;
        const right = 16;
        const top = 14;
        const bottom = 64;
        const innerWidth = width - left - right;
        const xs = stages.map((_, i) => left + (innerWidth / (stages.length - 1)) * i);
        const ys = stages.map((stage, i) => {
            const reached = stage.key === 'referral' ? hasReferral : i <= progressIndex;
            return reached ? top + 8 : bottom;
        });
        const points = xs.map((x, i) => x + ',' + ys[i]).join(' ');

        const circles = stages.map((stage, i) => {
            const reached = stage.key === 'referral' ? hasReferral : i <= progressIndex;
            return '<circle cx="' + xs[i] + '" cy="' + ys[i] + '" r="' + (reached ? 4 : 3) + '" fill="' + (reached ? stage.color : '#d1c4b3') + '" stroke="#fffdfa" stroke-width="1.5"></circle>';
        }).join('');

        const guides = xs.map((x) => '<line x1="' + x + '" y1="' + (top + 2) + '" x2="' + x + '" y2="' + (bottom + 4) + '" stroke="rgba(153,133,107,0.12)" stroke-width="1"></line>').join('');

        const reachedCount = seq.filter((key) => milestones[key + '_at']).length + (hasReferral ? 1 : 0);
        const chartTitle = '生命周期轨迹';
        const subTitle = '关键事件命中 ' + reachedCount + '/5';

        return {
            header: '<div class="life-mini-chart-header"><span>' + chartTitle + '</span><span>' + subTitle + '</span></div>',
            svg: '<svg class="life-mini-chart-svg" viewBox="0 0 320 88" preserveAspectRatio="none">' +
                '<line x1="' + left + '" y1="' + bottom + '" x2="' + (width - right) + '" y2="' + bottom + '" stroke="rgba(153,133,107,0.2)" stroke-width="1"></line>' +
                guides +
                '<polyline fill="none" stroke="#9f8e7a" stroke-width="2" points="' + points + '"></polyline>' +
                circles +
                '</svg>',
            axis: '<div class="life-mini-chart-axis">' + stages.map((stage) => '<span>' + stage.label + '</span>').join('') + '</div>'
        };
    }

    function formatLifecycleEventTs(ts) {
        if (!ts || !Number.isFinite(ts) || ts <= 0) return '未命中';
        const d = new Date(ts);
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        const hh = String(d.getHours()).padStart(2, '0');
        const mi = String(d.getMinutes()).padStart(2, '0');
        return mm + '/' + dd + ' ' + hh + ':' + mi;
    }

    function renderLifecycleProcessTrack(user) {
        const milestones = getLifecycleEventMilestones(user);
        const steps = [
            { key: 'acquisition', label: '获取', color: '#6d8fe5', ts: milestones.acquisition_at },
            { key: 'activation', label: '激活', color: '#e2a55f', ts: milestones.activation_at },
            { key: 'retention', label: '留存', color: '#58a68b', ts: milestones.retention_at },
            { key: 'revenue', label: '变现', color: '#2f7d65', ts: milestones.revenue_at },
            { key: 'referral', label: '传播', color: '#b8734c', ts: milestones.referral_at }
        ];

        return '<div class="life-process-track"><div class="life-process-line">' + steps.map((step) => {
            const hit = !!step.ts;
            const dotColor = hit ? step.color : '#d5c8b7';
            return '<div class="life-process-item">' +
                '<div class="life-process-dot" style="background:' + dotColor + ';"></div>' +
                '<div class="life-process-label">' + step.label + '</div>' +
                '<div class="life-process-time">' + formatLifecycleEventTs(step.ts) + '</div>' +
                '</div>';
        }).join('') + '</div></div>';
    }

    function getLifecycleCounts(data) {
        const counts = { acquisition: 0, activation: 0, retention: 0, revenue: 0, referral: 0, terminated: 0 };
        (data || []).forEach((u) => {
            const stage = u.lifecycle_stage || 'acquisition';
            counts[stage] = (counts[stage] || 0) + 1;
            if (u?.lifecycle?.flags?.referral_active) counts.referral += 1;
        });
        return counts;
    }

    function getLifecycleFunnelCounts(data, lifecycleDashboard) {
        const fallback = { acquisition: 0, activation: 0, retention: 0, revenue: 0, referral: 0 };
        if (!lifecycleDashboard) {
            const current = getLifecycleCounts(data);
            return {
                acquisition: current.acquisition || 0,
                activation: current.activation || 0,
                retention: current.retention || 0,
                revenue: current.revenue || 0,
                referral: (data || []).filter((u) => u?.lifecycle?.flags?.referral_active).length
            };
        }
        const funnel = lifecycleDashboard.funnel_counts || fallback;
        return {
            acquisition: Number(funnel.acquisition || 0),
            activation: Number(funnel.activation || 0),
            retention: Number(funnel.retention || 0),
            revenue: Number(funnel.revenue || 0),
            referral: Number(lifecycleDashboard.referral_active_count || 0)
        };
    }

    function getLifecycleDisplayCounts(data, lifecycleDashboard) {
        return {
            ...getLifecycleFunnelCounts(data, lifecycleDashboard),
            terminated: Number((lifecycleDashboard?.stage_counts || {}).terminated || getLifecycleCounts(data).terminated || 0)
        };
    }

    function getLifecycleAnchorMs(user) {
        const officialTs = getLifecycleLatestEventMs(user);
        if (officialTs) return officialTs;
        const stage = user?.lifecycle_stage || 'acquisition';
        const monthlyBeta = user?.events?.monthly_beta || {};
        const monthlyFee = user?.events?.monthly_fee || {};
        const agency = user?.events?.agency_binding || {};
        const scoreUpdated = user?.score?.last_updated || user?.updated_at;

        const candidates = {
            acquisition: [user?.created_at, user?.last_active, scoreUpdated],
            activation: [monthlyFee.deducted_at, monthlyBeta.cycle_start_date, scoreUpdated, user?.last_active, user?.created_at],
            retention: [monthlyBeta.joined_at, monthlyBeta.cycle_start_date, user?.last_active, scoreUpdated, user?.created_at],
            revenue: [agency.bound_at, scoreUpdated, user?.last_active, user?.created_at],
            terminated: [scoreUpdated, user?.last_active, user?.created_at]
        };

        const values = candidates[stage] || candidates.acquisition;
        for (const value of values) {
            if (!value) continue;
            const ts = typeof value === 'number' ? value : Date.parse(value);
            if (!Number.isNaN(ts) && ts > 0) return ts;
        }
        return Date.now();
    }

    function buildLifecycleTrend(data) {
        const weeks = 6;
        const now = new Date();
        const start = new Date(now);
        start.setDate(now.getDate() - (weeks - 1) * 7);
        start.setHours(0, 0, 0, 0);

        const buckets = Array.from({ length: weeks }, (_, index) => {
            const date = new Date(start);
            date.setDate(start.getDate() + index * 7);
            return {
                label: (date.getMonth() + 1) + '/' + date.getDate(),
                start: date.getTime(),
                values: { acquisition: 0, activation: 0, retention: 0, revenue: 0, referral: 0 }
            };
        });

        const lastBucketEnd = buckets[buckets.length - 1].start + (7 * 24 * 60 * 60 * 1000) - 1;
        const milestoneKeys = ['acquisition', 'activation', 'retention', 'revenue'];
        const transitionCount = (data || []).reduce((sum, user) => {
            return sum + getLifecycleTransitionHistory(user).filter((item) => item && item.trigger_type !== 'migration_backfill').length;
        }, 0);

        buckets.forEach((bucket) => {
            const bucketEnd = bucket.start + (7 * 24 * 60 * 60 * 1000) - 1;
            (data || []).forEach((user) => {
                const milestones = getLifecycleMilestones(user);
                milestoneKeys.forEach((stageKey) => {
                    const milestoneAt = milestones[stageKey + '_at'];
                    if (milestoneAt && milestoneAt <= bucketEnd) {
                        bucket.values[stageKey] += 1;
                    }
                });
                const referralAt = getReferralActivatedAt(user);
                if (referralAt && referralAt <= bucketEnd) {
                    bucket.values.referral += 1;
                }
            });
        });

        (data || []).forEach((user) => {
            const milestones = getLifecycleMilestones(user);
            const hasAnyMilestone = milestoneKeys.some((stageKey) => milestones[stageKey + '_at']);
            if (hasAnyMilestone) return;
            const ts = getLifecycleAnchorMs(user);
            if (!ts) return;
            milestoneKeys.forEach((stageKey) => {
                if (stageKey === user.lifecycle_stage && ts <= lastBucketEnd) {
                    buckets.forEach((bucket) => {
                        const bucketEnd = bucket.start + (7 * 24 * 60 * 60 * 1000) - 1;
                        if (ts <= bucketEnd) {
                            bucket.values[stageKey] += 1;
                        }
                    });
                }
            });
            const referralAt = getReferralActivatedAt(user);
            if (referralAt && referralAt <= lastBucketEnd) {
                buckets.forEach((bucket) => {
                    const bucketEnd = bucket.start + (7 * 24 * 60 * 60 * 1000) - 1;
                    if (referralAt <= bucketEnd) {
                        bucket.values.referral += 1;
                    }
                });
            }
        });

        buckets.mode = transitionCount > 0 ? 'cumulative_transition' : 'cumulative_milestone';
        buckets.transition_count = transitionCount;
        return buckets;
    }

    window.LifecycleDomain = {
        LIFECYCLE_STAGE_META,
        LIFECYCLE_AARRR_META,
        getLifecycleStageMeta,
        getLifecycleTransitionHistory,
        hasOfficialLifecycleSnapshot,
        getLifecycleLatestEventMs,
        getLifecycleMilestones,
        getReferralActivatedAt,
        getLifecycleEventMilestones,
        getLifecycleBoardEvents,
        renderPersonalLifecycleMiniChart,
        renderLifecycleProcessTrack,
        getLifecycleCounts,
        getLifecycleFunnelCounts,
        getLifecycleDisplayCounts,
        getLifecycleAnchorMs,
        buildLifecycleTrend
    };
})();
