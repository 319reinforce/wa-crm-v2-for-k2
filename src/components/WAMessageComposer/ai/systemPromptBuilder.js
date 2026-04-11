/**
 * systemPromptBuilder.js — System Prompt 构建（纯函数）
 */
import { buildEventPushSection } from './eventPushBuilder';
import { TOPIC_LABELS } from '../constants/topicLabels';

// 构建 System Prompt（双模式：响应模式 vs 推进模式）
export function buildSystemPrompt({ lastMsgRole, activeEvents, client, creator }) {
    const clientName = client?.name || creator?.primary_name || '未知';
    const owner = client?.wa_owner || creator?.wa_owner || '未知';
    const stage = client?.conversion_stage || creator?._full?.wacrm?.beta_status || '未知';
    const isPushMode = lastMsgRole ***REMOVED***= 'assistant';

    const base = `你是一个专业的达人运营助手，帮助运营人员与 WhatsApp 达人沟通。

【重要】你只能看到当前这一个客户的对话和档案，禁止推测或提及其他客户信息。

当前客户档案：
- 姓名: ${clientName}
- 负责人: ${owner}
- 建联阶段: ${stage}

【输出禁止规则 — 严格遵守】
你的回复中禁止出现以下内容：
1. 具体 GMV 数字、收入数据（如 "$3,000"、"|GMV $5,000"）
2. 其他达人的姓名、状态、优先级等信息
3. 公司内部运营备注、合同条款、机构协议内容
4. 将客户与其他人做对比（如 "比起XX客户..."）`;

    const replyStyle = `【回复风格 — 严格遵守】
- 语气自然亲切，像朋友间发消息，不要生硬刻板
- 句子要短，每条不超过 80 字
- 用换行分隔要点，避免一大段文字
- 主动推进下一步行动，不要只停留在当前问题
- 称呼客户名字（如果有），显得更personal
- 句尾可以有 "~" 或 "!" 体现热情

【各场景 emoji 参考】
- 试用/邀请：🎉 ✨ 🙌
- 月卡/付费：💎 💳 📅
- GMV/业绩：📈 💰 🔥
- 视频/内容：📹 🎬 ✨
- 付款问题：💳 ⚠️ 🔔
- 申诉/违规：🔒 📋 🆘
- 建联/开场：👋 😊 ✨
- 推荐用户：🤝 🎁 🙌`;

    const pushSection = buildEventPushSection(activeEvents, owner);

    if (isPushMode) {
        return `${base}
${replyStyle}
${pushSection}
回复要求：简洁，专业、100字以内，直接回答客户问题，在回复末尾加一句推进下一步的行动。只输出你要发送给客户的回复内容，不要输出任何分析或解释。`;
    } else {
        return `${base}
${replyStyle}
回复要求：简洁，专业、100字以内，直接回答客户问题，必要时在末尾推进下一步。只输出你要发送给客户的回复内容，不要输出任何分析或解释。`;
    }
}

// 构建话题上下文段落（注入 System Prompt）
export function buildTopicContext({ topic, creator, activeEvents, mode = 'new_topic' }) {
    const wacrm = creator?._full?.wacrm || {};
    const owner = creator?.wa_owner || '未知';
    const stage = wacrm.beta_status || '未知';

    const topicLabel = TOPIC_LABELS[topic?.topic_key] || TOPIC_LABELS.general;
    const triggerLabel = { manual: '运营手动标记', time: '48小时无互动', keyword: '关键词变化', auto: '自动检测', new: '新对话' }[topic?.trigger] || '新对话';

    const eventLines = (activeEvents || []).map(evt => {
        let meta = {};
        try { meta = JSON.parse(evt.meta || '{}'); } catch (_) {}
        const daysLeft = evt.end_at
            ? Math.ceil((new Date(evt.end_at) - Date.now()) / 86400000)
            : null;
        const phase = daysLeft ***REMOVED***= null ? '进行中'
            : daysLeft <= 0 ? '已结束'
            : daysLeft <= 3 ? '即将结束'
            : '进行中';
        return `${TOPIC_LABELS[evt.event_key] || evt.event_key}·${phase}${daysLeft !***REMOVED*** null && daysLeft > 0 ? `·剩${daysLeft}天` : ''}`;
    });

    // ***REMOVED***= 同一话题模式（manual/auto）：简短版 ***REMOVED***=
    if (mode ***REMOVED***= 'same_topic') {
        const eventSummary = eventLines.length > 0 ? eventLines.join(' | ') : '暂无进行中事件';
        return `【当前话题】${topicLabel}（${triggerLabel}）| ${eventSummary}`;
    }

    // ***REMOVED***= 新话题模式（keyword/time）：完整版 ***REMOVED***=
    const detectedAt = topic?.detected_at
        ? new Date(topic.detected_at).toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
        : '未知';

    let fullEventSummary = '暂无进行中事件';
    if (activeEvents?.length > 0) {
        const lines = activeEvents.map(evt => {
            let meta = {};
            try { meta = JSON.parse(evt.meta || '{}'); } catch (_) {}
            const daysLeft = evt.end_at
                ? Math.ceil((new Date(evt.end_at) - Date.now()) / 86400000)
                : null;
            const phase = daysLeft ***REMOVED***= null ? '进行中'
                : daysLeft <= 0 ? '已结束'
                : daysLeft <= 3 ? '即将结束'
                : '进行中';
            return `[${TOPIC_LABELS[evt.event_key] || evt.event_key}]`
                + `（${evt.owner}负责）`
                + `目标${meta.weekly_target || 35}条/周`
                + `·${phase}`
                + (daysLeft !***REMOVED*** null && daysLeft > 0 ? `·剩余${daysLeft}天` : '');
        });
        fullEventSummary = lines.join('\n');
    }

    return `【当前话题】
- 话题: ${topicLabel}
- 开始: ${detectedAt}（${triggerLabel}）
- 用户阶段: ${stage}（${owner}负责）

【进行中事件】
${fullEventSummary}

【回复策略提示】
- 有进行中事件 → 优先推进事件进展，末尾加推进语句
- 首次接触新客户 → 友好问候+介绍支持
- 问题咨询 → 直接清晰回答
- 严禁在回复中提及具体GMV数字和其他达人信息`;
}

// 早期消息摘要（用于同一话题 > 10 条时）
export function buildConversationSummary(messages) {
    if (!messages || messages.length <= 10) return null;
    const older = messages.slice(0, -10);
    const recentCount = messages.length - older.length;
    const lines = older.map(m => {
        const role = m.role ***REMOVED***= 'me' ? '运营' : '达人';
        const text = (m.text || '').slice(0, 80);
        return `[${role}]: ${text}`;
    });
    return {
        summary: `【更早对话摘要（共${older.length}条）】\n${lines.join('\n')}`,
        recentCount,
    };
}

// 把废弃的 richCtx 注入为结构化段落
export function buildRichContextParagraph(richCtx) {
    if (!richCtx) return '';

    const { scene, client_tone, language, days_since_last_msg, memory_summary, policy_tags, total_messages, hour_of_day, day_of_week } = richCtx;

    const toneLabel = { friendly: '友好', formal: '正式', casual: '随意', neutral: '中性' }[client_tone] || '未知';
    const langLabel = language ***REMOVED***= 'zh' ? '中文' : '英文';
    const timeHint = days_since_last_msg !***REMOVED*** null
        ? days_since_last_msg ***REMOVED***= 0 ? '今天'
            : days_since_last_msg ***REMOVED***= 1 ? '昨天'
                : `${days_since_last_msg}天前`
        : '未知';

    const sceneLabel = {
        trial_intro: '7天挑战咨询', monthly_inquiry: '月度挑战咨询', commission_query: '佣金分成咨询',
        mcn_binding: 'Agency/MCN绑定', video_not_loading: '视频加载异常', content_request: '内容/视频请求',
        gmv_inquiry: 'GMV收入咨询', payment_issue: '付款问题', violation_appeal: '违规申诉',
        follow_up: '跟进中', first_contact: '首次接触', general: '一般咨询'
    }[scene] || scene || '未知';

    let memoryBlock = '';
    if (memory_summary && Object.keys(memory_summary).length > 0) {
        const prefs = [];
        if (memory_summary.preference) {
            for (const [k, v] of Object.entries(memory_summary.preference)) {
                prefs.push(`${k}: ${v}`);
            }
        }
        if (prefs.length > 0) memoryBlock = `\n- 客户偏好: ${prefs.join(' | ')}`;
    }

    let policyBlock = '';
    if (policy_tags && policy_tags.length > 0) {
        policyBlock = `\n- 匹配策略: ${policy_tags.join(', ')}`;
    }
    const nextActionBlock = richCtx.next_action
        ? `\n- 运营计划: ${richCtx.next_action}`
        : '';

    return `【当前对话上下文】
- 场景: ${sceneLabel}
- 客户语气: ${toneLabel} | 语言: ${langLabel} | 总消息: ${total_messages}条 | 上次互动: ${timeHint}
- 时间: 周${day_of_week}${hour_of_day >= 9 && hour_of_day <= 21 ? '（工作时间）' : '（非工作时间）'}${memoryBlock}${policyBlock}${nextActionBlock}`;
}
