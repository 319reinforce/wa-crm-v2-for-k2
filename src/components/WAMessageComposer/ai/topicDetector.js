/**
 * topicDetector.js — 话题检测核心逻辑（纯函数，无 React 状态依赖）
 */
import {
    TOPIC_GROUP_DEFAULT_INTENT,
    TOPIC_GROUP_DEFAULT_SCENE,
    getTopicLabel,
} from '../constants/topicLabels';

const TOPIC_GROUP_RULES = [
    {
        topic_group: 'violation_risk_control',
        intent_key: 'violation_reassurance',
        scene_key: 'violation_appeal',
        patterns: [
            /\b(violation|appeal|flagged|strike|banned|suspended|risk|safe)\b/i,
            /(违规|申诉|封号|风控|风险|安全)/,
        ],
    },
    {
        topic_group: 'settlement_pricing',
        intent_key: 'monthly_fee_explain',
        scene_key: 'monthly_inquiry',
        patterns: [
            /\b(monthly|month|membership|fee|pricing|subscription|\$20)\b/i,
            /(月费|包月|会员|收费|价格|订阅)/,
        ],
    },
    {
        topic_group: 'settlement_pricing',
        intent_key: 'payment_method',
        scene_key: 'payment_issue',
        patterns: [
            /\b(payment|paypal|payout|settlement|bank|paid|earnings|subsidy)\b/i,
            /(付款|收款|支付|结算|补贴|到账|paypal|佣金)/,
        ],
    },
    {
        topic_group: 'mcn_partnership',
        intent_key: 'mcn_explain',
        scene_key: 'mcn_binding',
        patterns: [
            /\b(mcn|agency|contract|binding|bind)\b/i,
            /(签约|绑定|机构|合作模式|agency|mcn)/,
        ],
    },
    {
        topic_group: 'signup_onboarding',
        intent_key: 'invite_code_reply',
        scene_key: 'trial_intro',
        patterns: [
            /\b(invite code|code|register|registration|signup|username|log in|login)\b/i,
            /(邀请码|注册码|注册|登录|用户名|username)/,
        ],
    },
    {
        topic_group: 'signup_onboarding',
        intent_key: 'registered_not_posted',
        scene_key: 'trial_intro',
        patterns: [
            /\b(not posted|haven't posted|have not posted|first video|generated my first video|generated your first video)\b/i,
            /(还没发|未发布|首条视频|第一条视频|生成了第一条视频)/,
        ],
    },
    {
        topic_group: 'signup_onboarding',
        intent_key: 'username_followup',
        scene_key: 'trial_intro',
        patterns: [
            /\b(email only|communicate by email|right here on email)\b/i,
            /(只用邮箱沟通|邮件沟通|只想用邮件)/,
        ],
    },
    {
        topic_group: 'content_strategy',
        intent_key: 'posting_cadence',
        scene_key: 'content_request',
        patterns: [
            /\b(posting|post|cadence|how many videos|selection|audience fit|content strategy)\b/i,
            /(发帖|发布频率|发几个视频|选品|内容策略|转化建议|达人使用tips)/,
        ],
    },
    {
        topic_group: 'product_mechanics',
        intent_key: 'manual_editing_request',
        scene_key: 'content_request',
        patterns: [
            /\b(manual script|edit scripts|script edit|editable|edit)\b/i,
            /(手动改脚本|改脚本|编辑脚本|能编辑脚本吗)/,
        ],
    },
    {
        topic_group: 'product_mechanics',
        intent_key: 'how_moras_works',
        scene_key: 'content_request',
        patterns: [
            /\b(how does moras work|how it works|what is moras|product logic|recommend)\b/i,
            /(moras怎么用|怎么工作|产品机制|推荐逻辑|产品逻辑)/,
        ],
    },
    {
        topic_group: 'followup_progress',
        intent_key: 'followup_soft_reminder',
        scene_key: 'follow_up',
        patterns: [
            /\b(follow up|follow-up|reminder|checking in|still interested)\b/i,
            /(跟进|提醒|有兴趣吗|还在考虑吗)/,
        ],
    },
    {
        topic_group: 'outreach_contact',
        intent_key: 'first_outreach_value_pitch',
        scene_key: 'first_contact',
        patterns: [
            /\b(hello|hi|hey|first time|reach out|earning more|underrated)\b/i,
            /(首次建联|初次联系|你好|嗨)/,
        ],
    },
];

function normalizeText(text) {
    return String(text || '').toLowerCase();
}

export function inferSceneKeyFromTopicGroup(topic_group, text = '') {
    const lowerText = normalizeText(text);
    const defaultScene = TOPIC_GROUP_DEFAULT_SCENE[topic_group] || 'follow_up';

    if (topic_group === 'settlement_pricing') {
        if (/\b(monthly|month|membership|fee|pricing|\$20)\b/i.test(lowerText) || /(月费|包月|会员|收费|价格)/.test(lowerText)) {
            return 'monthly_inquiry';
        }
        if (/\b(commission|earnings|revenue|subsidy)\b/i.test(lowerText) || /(佣金|分成|收入|补贴)/.test(lowerText)) {
            return 'commission_query';
        }
        return 'payment_issue';
    }

    if (topic_group === 'content_strategy' && (/\b(gmv|sales|performance)\b/i.test(lowerText) || /(gmv|销量|表现|收入)/.test(lowerText))) {
        return 'gmv_inquiry';
    }

    return defaultScene;
}

export function inferIntentKey({ topic_group, text = '' }) {
    const lowerText = normalizeText(text);

    if (topic_group === 'signup_onboarding') {
        if (/\b(email only|communicate by email|right here on email)\b/i.test(lowerText) || /(只用邮箱沟通|邮件沟通|只想用邮件)/.test(lowerText)) return 'username_followup';
        if (/\b(not posted|haven't posted|have not posted|first video|generated my first video|generated your first video)\b/i.test(lowerText) || /(还没发|未发布|首条视频|第一条视频|生成了第一条视频)/.test(lowerText)) return 'registered_not_posted';
        if (/\b(username)\b/i.test(lowerText) || /(用户名|username)/.test(lowerText)) return 'username_followup';
        if (/\b(not posted|first sale|first post)\b/i.test(lowerText) || /(还没发|未发布|首条视频)/.test(lowerText)) return 'registered_not_posted';
        return 'invite_code_reply';
    }

    if (topic_group === 'settlement_pricing') {
        if (/\b(monthly|month|membership|fee|pricing|\$20)\b/i.test(lowerText) || /(月费|包月|会员|收费|价格)/.test(lowerText)) return 'monthly_fee_explain';
        if (/\b(payment method|paypal|bank|payout)\b/i.test(lowerText) || /(支付方式|paypal|银行卡|收款)/.test(lowerText)) return 'payment_method';
        if (/\b(subsidy|qualified video|weekly settlement|settlement)\b/i.test(lowerText) || /(补贴|qualified video|周结|结算)/.test(lowerText)) return 'weekly_settlement';
        return 'subsidy_explain';
    }

    if (topic_group === 'mcn_partnership') {
        if (/\b(hesitat|concern|not sure|required)\b/i.test(lowerText) || /(犹豫|顾虑|必须绑定|一定要绑定)/.test(lowerText)) return 'mcn_hesitation';
        if (/\b(self run|full service|self-run)\b/i.test(lowerText) || /(自营|全托)/.test(lowerText)) return 'self_run_vs_full_service';
        return 'mcn_explain';
    }

    if (topic_group === 'product_mechanics') {
        if (/\b(product logic|recommend|why this product)\b/i.test(lowerText) || /(推荐逻辑|为什么推荐|产品逻辑)/.test(lowerText)) return 'product_logic';
        if (/\b(manual script|edit scripts|edit)\b/i.test(lowerText) || /(手动改脚本|编辑脚本)/.test(lowerText)) return 'manual_editing_request';
        if (/\b(qualified video)\b/i.test(lowerText) || /(qualified video|合格视频)/.test(lowerText)) return 'qualified_video_rule';
        return 'how_moras_works';
    }

    if (topic_group === 'content_strategy') {
        if (/\b(product selection|selection|audience)\b/i.test(lowerText) || /(选品|受众|类目)/.test(lowerText)) return 'product_selection';
        if (/\b(version|update|new version)\b/i.test(lowerText) || /(版本|更新|新版本)/.test(lowerText)) return 'version_update_notice';
        if (/\b(audience fit|fit)\b/i.test(lowerText) || /(受众匹配|契合)/.test(lowerText)) return 'audience_fit';
        return 'posting_cadence';
    }

    if (topic_group === 'violation_risk_control') {
        if (/\b(appeal template|review team)\b/i.test(lowerText) || /(申诉模板|review team)/.test(lowerText)) return 'appeal_template';
        if (/\b(compensat)\b/i.test(lowerText) || /(赔偿)/.test(lowerText)) return 'post_compensation_warning';
        if (/\b(pre-check|risk checklist|safe)\b/i.test(lowerText) || /(风控检查|风险清单|安全)/.test(lowerText)) return 'risk_precheck';
        return 'violation_reassurance';
    }

    if (topic_group === 'followup_progress') {
        if (/\b(final call|last follow)\b/i.test(lowerText) || /(最后一次跟进|最终提醒)/.test(lowerText)) return 'followup_final_call';
        if (/\b(thank you for your interest|interested)\b/i.test(lowerText) || /(感谢你的兴趣|感兴趣)/.test(lowerText)) return 'followup_interested_reply';
        return 'followup_soft_reminder';
    }

    if (topic_group === 'outreach_contact') {
        if (/\b(mcn)\b/i.test(lowerText) || /(mcn|机构)/.test(lowerText)) return 'first_outreach_soft_mcn';
        if (/\b(self run|full service)\b/i.test(lowerText) || /(自营|全托)/.test(lowerText)) return 'first_outreach_self_run';
        return 'first_outreach_value_pitch';
    }

    return TOPIC_GROUP_DEFAULT_INTENT[topic_group] || 'followup_soft_reminder';
}

export function resolveTopicContext({
    topic_group = null,
    text = '',
    trigger = 'auto',
    detected_at = Date.now(),
    keywords = null,
    confidence = 'medium',
    score = 0,
}) {
    const resolvedGroup = topic_group || inferTopicGroupFromText(text);
    const scene_key = inferSceneKeyFromTopicGroup(resolvedGroup, text);
    const intent_key = inferIntentKey({ topic_group: resolvedGroup, text });
    const normalizedKeywords = keywords || extractKeywords(text);
    return {
        topic_key: resolvedGroup,
        topic_group: resolvedGroup,
        scene_key,
        intent_key,
        trigger,
        detected_at,
        keywords: normalizedKeywords,
        confidence,
        score,
        label: getTopicLabel(resolvedGroup, getTopicLabel(scene_key)),
    };
}

export function inferTopicGroupFromText(text = '', { messageCount = 0 } = {}) {
    const lowerText = normalizeText(text);
    for (const rule of TOPIC_GROUP_RULES) {
        if (rule.patterns.some((pattern) => pattern.test(lowerText))) {
            return rule.topic_group;
        }
    }
    if (messageCount <= 1) return 'outreach_contact';
    return 'followup_progress';
}

// 从消息文本推断话题类型
export function inferTopicKey(text, opts = {}) {
    return inferTopicGroupFromText(text, opts);
}

// 从文本提取关键词集合（用于Jaccard相似度计算）
export function extractKeywords(text) {
    if (!text) return new Set();
    return new Set(
        text.toLowerCase()
            .split(/[\s,.!?;:，。！？；：]+/)
            .filter((w) => w.length > 2),
    );
}

// 计算两个关键词集合的Jaccard相似度
export function computeJaccardSimilarity(set1, set2) {
    if (set1.size === 0 && set2.size === 0) return 1;
    if (set1.size === 0 || set2.size === 0) return 0;
    const intersection = new Set([...set1].filter((w) => set2.has(w)));
    const union = new Set([...set1, ...set2]);
    return intersection.size / union.size;
}

// 基于最新20条消息 + 活跃事件 → 自动推断话题
export function inferAutoTopic({ messages, activeEvents }) {
    const recentTexts = (messages || []).slice(-20).map((m) => m.text || '').join(' ');
    const lowerText = recentTexts.toLowerCase();
    const candidates = new Map();

    for (const rule of TOPIC_GROUP_RULES) {
        const matchCount = rule.patterns.filter((pattern) => pattern.test(lowerText)).length;
        if (matchCount > 0) {
            const prev = candidates.get(rule.topic_group) || 0;
            candidates.set(rule.topic_group, Math.max(prev, matchCount));
        }
    }

    for (const evt of activeEvents || []) {
        const eventKey = String(evt?.event_key || '').toLowerCase();
        const mappedGroup = eventKey === 'agency_bound'
            ? 'mcn_partnership'
            : eventKey === 'gmv_milestone'
                ? 'content_strategy'
                : eventKey === 'trial_7day' || eventKey === 'monthly_challenge'
                    ? 'signup_onboarding'
                    : eventKey === 'referral'
                        ? 'outreach_contact'
                        : null;
        if (mappedGroup) {
            candidates.set(mappedGroup, (candidates.get(mappedGroup) || 0) + 3);
        }
    }

    const sorted = [...candidates.entries()].sort((a, b) => b[1] - a[1]);
    const [topGroup, topScore] = sorted[0] || [null, 0];

    if (!topGroup || topScore < 1) {
        return resolveTopicContext({
            topic_group: inferTopicGroupFromText(recentTexts, { messageCount: (messages || []).length }),
            text: recentTexts,
            confidence: 'low',
            score: 0,
        });
    }

    const confidence = topScore >= 4 ? 'high' : topScore >= 2 ? 'medium' : 'low';
    return resolveTopicContext({
        topic_group: topGroup,
        text: recentTexts,
        confidence,
        score: topScore,
    });
}

// 判断是否应该切换新话题
export function shouldSwitchTopic({ currentTopic, newText, messages, lastMsgTimestamp }) {
    const newKeywords = extractKeywords(newText);

    const HOUR48 = 48 * 3600 * 1000;
    if (lastMsgTimestamp && (Date.now() - lastMsgTimestamp) > HOUR48) {
        return { shouldSwitch: true, trigger: 'time', reason: '超过48小时无互动' };
    }

    if (currentTopic?.keywords && newKeywords.size > 0) {
        const similarity = computeJaccardSimilarity(currentTopic.keywords, newKeywords);
        if (similarity < 0.3) {
            return { shouldSwitch: true, trigger: 'keyword', reason: `关键词变化（相似度${Math.round(similarity * 100)}%）` };
        }
    }

    if (currentTopic?.topic_key) {
        const prevKey = currentTopic.topic_key;
        const nextKey = inferTopicKey(newText, { messageCount: (messages || []).length });
        if (prevKey !== nextKey) {
            return { shouldSwitch: true, trigger: 'keyword', reason: `话题从${getTopicLabel(prevKey, prevKey)}切换到${getTopicLabel(nextKey, nextKey)}` };
        }
    }

    return { shouldSwitch: false };
}

// 开启新话题
export function startNewTopic({ trigger = 'new', newText, messages }) {
    return resolveTopicContext({
        topic_group: inferTopicGroupFromText(newText, { messageCount: (messages || []).length }),
        text: newText,
        trigger,
        detected_at: Date.now(),
    });
}
