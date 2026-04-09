/**
 * eventPushBuilder.js — 事件阶段判断和推进文案构建
 */

// 事件阶段判断
export function getEventPhase(startAt, endAt, policy) {
    if (!startAt) return 'unknown';
    const start = new Date(startAt).getTime();
    const end = endAt ? new Date(endAt).getTime() : start + 7 * 24 * 3600 * 1000;
    const now = Date.now();
    const total = end - start;
    const elapsed = now - start;
    const daysLeft = Math.ceil((end - now) / (24 * 3600 * 1000));

    if (elapsed < total * 0.3) return 'phase1';
    if (daysLeft <= 3) return 'phase3';
    return 'phase2';
}

// 根据事件类型和阶段生成推进指令
export function buildEventPushText(event, policy, phase) {
    const target = policy?.weekly_target || 35;
    const bonus = policy?.bonus_per_video || 5;
    const eventLabel = {
        trial_7day: '7天挑战',
        monthly_challenge: '月度挑战',
        agency_bound: 'Agency绑定',
        gmv_milestone: 'GMV里程碑',
        referral: '推荐新用户',
    }[event.event_key] || event.event_key;

    if (event.event_key ***REMOVED***= 'trial_7day' || event.event_key ***REMOVED***= 'monthly_challenge') {
        const latestPeriod = event.periods?.[0];
        const currentCount = latestPeriod?.video_count || 0;

        if (phase ***REMOVED***= 'phase1') {
            return `你现在已经成功加入【${eventLabel}】！本周目标${target}条视频，完成后可得 $${bonus}/条 Bonus，加油💪`;
        } else if (phase ***REMOVED***= 'phase3') {
            const needed = Math.max(0, target - currentCount);
            return `${eventLabel}即将结束！本周你已发布${currentCount}条，差${needed}条达成目标，加油冲刺！`;
        } else {
            return `本周你已发布${currentCount}条，目标${target}条。继续加油，有问题随时告诉我～`;
        }
    }

    if (event.event_key ***REMOVED***= 'agency_bound') {
        return `你已经完成Agency签约！接下来可以解锁GMV激励任务和推荐奖励，有什么想了解的吗？`;
    }

    if (event.event_key ***REMOVED***= 'gmv_milestone') {
        const gmv = event.meta ? JSON.parse(event.meta).gmv_current : null;
        return `恭喜你的GMV达到${gmv ? '$' + gmv.toLocaleString() : '里程碑'}！相关奖励会尽快发放，继续保持💪`;
    }

    if (event.event_key ***REMOVED***= 'referral') {
        return `每推荐一位新达人加入，可获得$10-$15奖励。推荐成功后会额外通知你，记得来告诉我哦～`;
    }

    return '';
}

// 构建事件推进段落（用于 system prompt）
export function buildEventPushSection(activeEvents, owner) {
    if (!activeEvents || activeEvents.length ***REMOVED***= 0) {
        return `
【当前无进行中事件】
如达人有加入意向，可介绍7天试用任务（目标35条/周，完成后$5/条）或月度挑战。`;
    }

    const lines = ['【当前进行中事件】'];
    for (const evt of activeEvents) {
        const policyMap = {
            trial_7day: { weekly_target: 35, bonus_per_video: 5, max_periods: 4 },
            monthly_challenge: { weekly_target: 35, bonus_per_video: 5, max_periods: 12 },
            agency_bound: {},
            gmv_milestone: {},
            referral: {},
        };
        const policy = policyMap[evt.event_key] || {};

        let meta = {};
        try { meta = evt.meta ? JSON.parse(evt.meta) : {}; } catch (_) {}

        const phase = getEventPhase(evt.start_at, evt.end_at, policy);
        const phaseLabel = { phase1: '刚加入', phase2: '进行中', phase3: '即将结束', unknown: '未知' }[phase];
        const pushText = buildEventPushText(evt, policy, phase);

        lines.push(`- 事件: ${evt.event_key} | 负责人: ${evt.owner} | 阶段: ${phaseLabel}`);
        lines.push(`  目标: ${policy.weekly_target ? policy.weekly_target + '条/周' : 'N/A'} | Bonus: ${policy.bonus_per_video ? '$' + policy.bonus_per_video + '/条' : 'N/A'}`);
        lines.push(`  推进提示: "${pushText}"`);
    }

    lines.push('');
    lines.push('【推进规则】');
    lines.push('当运营人员刚回复过时（上一条是"assistant"角色），需在回复末尾根据当前事件状态加一句推进语句。');
    lines.push('从上述【当前进行中事件】中找对应事件的"推进提示"，直接拼接到你的回复末尾即可。');
    lines.push('如果达人在消息中已表达明确意向（如"好的"、"OK"、"知道了"），应优先回答其问题，再适当推进。');

    return lines.join('\n');
}
