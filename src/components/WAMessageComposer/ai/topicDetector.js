/**
 * topicDetector.js — 话题检测核心逻辑（纯函数，无 React 状态依赖）
 */
import { TOPIC_LABELS } from '../constants/topicLabels';

// 从消息文本推断话题类型
export function inferTopicKey(text) {
    const t = (text || '').toLowerCase();
    if (/\b(trial|7[\s-]?day|7day|free\s*try|试用|加入挑战)\b/.test(t)) return 'trial_intro';
    if (/\b(monthly|month|membership|月费|包月|每月挑战)\b/.test(t)) return 'monthly_inquiry';
    if (/\b(gmv|sales|订单|销售|收入|earnings)\b/.test(t)) return 'gmv_inquiry';
    if (/\b(mcn|agency|经纪|代理|绑定|contract|签约)\b/.test(t)) return 'mcn_binding';
    if (/\b(commission|分成|提成|佣金|revenue)\b/.test(t)) return 'commission_query';
    if (/\b(video|视频|内容|content|创作|post|发帖)\b/.test(t)) return 'content_request';
    if (/\b(payment|paypal|付款|收款|转账|汇款|没收到)\b/.test(t)) return 'payment_issue';
    if (/\b(violation|appeal|申诉|违规|flagged|strike|封号)\b/.test(t)) return 'violation_appeal';
    if (/\b(refer|invite|推荐|介绍|新人)\b/.test(t)) return 'referral';
    return 'general';
}

// 从文本提取关键词集合（用于Jaccard相似度计算）
export function extractKeywords(text) {
    if (!text) return new Set();
    return new Set(
        text.toLowerCase()
            .split(/[\s,.!?;:，。！？；：]+/)
            .filter(w => w.length > 2),
    );
}

// 计算两个关键词集合的Jaccard相似度
export function computeJaccardSimilarity(set1, set2) {
    if (set1.size === 0 && set2.size === 0) return 1;
    if (set1.size === 0 || set2.size === 0) return 0;
    const intersection = new Set([...set1].filter(w => set2.has(w)));
    const union = new Set([...set1, ...set2]);
    return intersection.size / union.size;
}

// 基于 EVENT_SYSTEM.md 关键词 + 最新20条消息 + 活跃事件 → 自动推断话题
export function inferAutoTopic({ messages, activeEvents }) {
    const recentTexts = (messages || []).slice(-20).map(m => m.text || '').join(' ');
    const lowerText = recentTexts.toLowerCase();

    const eventKeywordMap = {
        trial_intro: ['trial', '7day', '7-day', 'free challenge', '7天挑战', '试用挑战', '加入挑战', 'challenge', '七天'],
        monthly_inquiry: ['monthly', 'monthly challenge', 'monthly challenge', '月度挑战', '包月', '每月挑战', 'month'],
        gmv_inquiry: ['gmv', 'earning', 'revenue', '收入', '佣金', 'pay', 'payment', 'paid', 'milestone', 'commission', '佣金分成', 'cashout'],
        mcn_binding: ['agency', 'mcn', 'bound', 'sign', 'contract', '绑定', '签约', 'signed', 'join agency'],
        commission_query: ['commission', 'share', '分成', 'percentage', 'cut', 'reward', '奖励', 'bonus'],
        content_request: ['video', 'content', 'post', 'publish', '视频', '发布', '链接', 'link', 'tiktok', 'share link', '视频链接'],
        payment_issue: ['pay', 'payment', 'paid', '转账', '未付', '没收到', 'when', '多久', '一直没有', 'bank', 'account'],
        violation_appeal: ['violation', 'ban', 'suspend', '违反', '违规', '封号', '被禁', 'account disabled', 'frozen'],
        referral: ['refer', 'invite', 'recommend', '推荐', '介绍', '新人', 'creator join', 'new creator', '其他人'],
        first_contact: ['hi', 'hello', 'hey', '你好', '嗨', 'who are you', 'what is', '怎么', 'who is', 'first time'],
    };

    const scores = {};
    for (const [topic, keywords] of Object.entries(eventKeywordMap)) {
        const matchCount = keywords.filter(kw => lowerText.includes(kw)).length;
        scores[topic] = matchCount;
    }

    // 活跃事件加权（+3分）
    for (const evt of (activeEvents || [])) {
        const key = evt.event_key;
        const keyMap = {
            trial_7day: 'trial_intro',
            monthly_challenge: 'monthly_inquiry',
            agency_bound: 'mcn_binding',
            gmv_milestone: 'gmv_inquiry',
            referral: 'referral',
        };
        const mapped = keyMap[key] || key;
        if (scores[mapped] !== undefined) scores[mapped] += 3;
    }

    const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);
    const [topKey, topScore] = sorted[0] || [null, 0];

    if (!topKey || topScore < 1) return { topic_key: 'general', label: '一般咨询', confidence: 'low' };

    const confidence = topScore >= 4 ? 'high' : topScore >= 2 ? 'medium' : 'low';
    return {
        topic_key: topKey,
        label: TOPIC_LABELS[topKey] || TOPIC_LABELS.general,
        confidence,
        score: topScore,
    };
}

// 判断是否应该切换新话题
export function shouldSwitchTopic({ currentTopic, newText, messages, lastMsgTimestamp }) {
    const newKeywords = extractKeywords(newText);

    // 触发A：48小时无互动
    const HOUR48 = 48 * 3600 * 1000;
    if (lastMsgTimestamp && (Date.now() - lastMsgTimestamp) > HOUR48) {
        return { shouldSwitch: true, trigger: 'time', reason: '超过48小时无互动' };
    }

    // 触发B：关键词Jaccard相似度 < 0.3
    if (currentTopic?.keywords && newKeywords.size > 0) {
        const similarity = computeJaccardSimilarity(currentTopic.keywords, newKeywords);
        if (similarity < 0.3) {
            return { shouldSwitch: true, trigger: 'keyword', reason: `关键词变化（相似度${Math.round(similarity * 100)}%）` };
        }
    }

    // 触发C：话题类型本身发生了变化
    if (currentTopic?.topic_key) {
        const prevKey = currentTopic.topic_key;
        const newKey = inferTopicKey(newText);
        if (prevKey !== newKey && newKey !== 'general') {
            return { shouldSwitch: true, trigger: 'keyword', reason: `话题从${TOPIC_LABELS[prevKey] || prevKey}切换到${TOPIC_LABELS[newKey] || newKey}` };
        }
    }

    return { shouldSwitch: false };
}

// 开启新话题
export function startNewTopic({ trigger = 'new', newText, messages }) {
    const keywords = extractKeywords(newText);
    const topic_key = inferTopicKey(newText);
    return {
        topic_key,
        trigger,
        detected_at: Date.now(),
        keywords,
    };
}
