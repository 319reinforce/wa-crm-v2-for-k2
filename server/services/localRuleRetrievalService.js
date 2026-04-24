/**
 * Local Rule Retrieval Service
 *
 * 根据 scene/operator/user_message 从 docs/rag/sources/ 检索相关知识源
 * 并注入到 grounding_json.local_rules
 *
 * Design: docs/rag/LOCAL_RULE_RETRIEVAL_DESIGN.md
 */

const fs = require('fs');
const path = require('path');

// Load knowledge manifest
const MANIFEST_PATH = path.join(__dirname, '../../docs/rag/knowledge-manifest.json');
let manifest = null;

function loadManifest() {
    if (!manifest) {
        try {
            const content = fs.readFileSync(MANIFEST_PATH, 'utf8');
            manifest = JSON.parse(content);
        } catch (e) {
            manifest = { sources: [] };
        }
    }
    return manifest;
}

/**
 * 检索相关知识源
 * @param {Object} context - 检索上下文
 * @param {string} context.scene - 场景标识 (e.g., "trial_intro", "monthly_inquiry")
 * @param {string} context.operator - 运营人员 (e.g., "Beau", "Yiyun")
 * @param {string} context.userMessage - 用户最新消息（可选，用于关键词匹配）
 * @param {number} context.maxSources - 最多返回几个源（默认 3）
 * @returns {Array} 匹配的知识源列表
 */
function retrieveLocalRules(context) {
    const {
        scene = null,
        operator = null,
        userMessage = '',
        recentMessages = [],
        currentTopic = null,
        autoDetectedTopic = null,
        activeEvents = [],
        lifecycle = null,
        forceTemplateSources = false,
        maxSources = 3
    } = context;

    const manifest = loadManifest();
    const candidates = [];
    const resolvedTopic = currentTopic?.topic_key || autoDetectedTopic?.topic_key || null;
    const resolvedStage = lifecycle?.stage_key || null;
    const recentText = (Array.isArray(recentMessages) ? recentMessages : [])
        .map((message) => String(message?.text || '').trim())
        .filter(Boolean)
        .join(' \n ');
    const combinedText = [userMessage, recentText].filter(Boolean).join(' \n ');
    const keywords = extractKeywords(combinedText);
    const normalizedEventKeys = (Array.isArray(activeEvents) ? activeEvents : [])
        .filter((event) => event?.status === 'active')
        .map((event) => String(event?.event_key || '').toLowerCase())
        .filter(Boolean);

    for (const source of manifest.sources) {
        let score = 0;
        const matchedBy = [];
        const sourceTitle = String(source.title || '').toLowerCase();
        const sourceId = String(source.id || '').toLowerCase();
        const sourceScenes = Array.isArray(source.scene) ? source.scene : [];
        const sourceTopics = normalizeManifestField(source.topic);
        const sourceLifecycleStages = normalizeManifestField(source.lifecycle_stage);
        const sourceEventStages = normalizeManifestField(source.event_stage);
        const sourceKeywords = normalizeManifestField(source.keywords);
        const sourceText = [
            sourceTitle,
            sourceId,
            sourceScenes.join(' '),
            sourceTopics.join(' '),
            sourceLifecycleStages.join(' '),
            sourceEventStages.join(' '),
            sourceKeywords.join(' '),
        ].join(' ').toLowerCase();

        if (scene && sourceScenes.includes(scene)) {
            score += 10;
            matchedBy.push('scene');
        }

        if (operator && source.type === 'playbook' && sourceTitle.includes(String(operator).toLowerCase())) {
            score += 8;
            matchedBy.push('operator');
        }

        if (forceTemplateSources && (source.type === 'playbook' || source.type === 'sop')) {
            score += 6;
            matchedBy.push('template_source');
        } else if (source.type === 'policy') {
            score += 5;
        } else if (source.type === 'sop') {
            score += 3;
        } else if (source.type === 'faq') {
            score += 2;
        }

        if (resolvedTopic) {
            const normalizedTopic = String(resolvedTopic).toLowerCase();
            if (sourceTopics.includes(normalizedTopic) || sourceId.includes(normalizedTopic) || sourceTitle.includes(normalizedTopic)) {
                score += 9;
                matchedBy.push('topic');
            }
        }

        if (resolvedStage) {
            const normalizedStage = String(resolvedStage).toLowerCase();
            if (sourceLifecycleStages.includes(normalizedStage) || sourceEventStages.includes(normalizedStage) || sourceText.includes(normalizedStage)) {
                score += 5;
                matchedBy.push('stage');
            }
        }

        if (normalizedEventKeys.length > 0) {
            const eventMatch = normalizedEventKeys.some((eventKey) => sourceEventStages.includes(eventKey) || sourceText.includes(eventKey));
            if (eventMatch) {
                score += 4;
                matchedBy.push('active_event');
            }
        }

        for (const keyword of keywords) {
            if (sourceText.includes(keyword)) {
                score += sourceKeywords.includes(keyword) ? 2 : 1;
                matchedBy.push(`keyword:${keyword}`);
            }
        }

        if (combinedText) {
            const lowerMsg = combinedText.toLowerCase();

            if ((lowerMsg.includes('safe') || lowerMsg.includes('risk') || lowerMsg.includes('violation'))
                && source.id.includes('violation')) {
                score += 3;
                matchedBy.push('keyword:violation');
            }

            if ((lowerMsg.includes('product') || lowerMsg.includes('recommend'))
                && (source.id.includes('product') || source.type === 'faq')) {
                score += 3;
                matchedBy.push('keyword:product');
            }

            if ((lowerMsg.includes('post') || lowerMsg.includes('cadence') || lowerMsg.includes('spammy'))
                && source.id.includes('posting')) {
                score += 3;
                matchedBy.push('keyword:posting');
            }
        }

        if (score > 0) {
            candidates.push({
                ...source,
                score,
                matchedBy: Array.from(new Set(matchedBy)),
                resolvedTopic,
                resolvedStage,
            });
        }
    }

    candidates.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        const priorityA = Number.isFinite(a.priority) ? a.priority : Number.MAX_SAFE_INTEGER;
        const priorityB = Number.isFinite(b.priority) ? b.priority : Number.MAX_SAFE_INTEGER;
        if (priorityA !== priorityB) return priorityA - priorityB;
        return String(a.id || '').localeCompare(String(b.id || ''));
    });

    return candidates.slice(0, maxSources);
}

function normalizeManifestField(value) {
    if (Array.isArray(value)) {
        return value
            .map((item) => String(item || '').toLowerCase().trim())
            .filter(Boolean);
    }

    if (typeof value === 'string' && value.trim()) {
        return [value.toLowerCase().trim()];
    }

    return [];
}

/**
 * 提取用户消息中的关键词
 * @param {string} message - 用户消息
 * @returns {Array<string>} 关键词列表
 */
function extractKeywords(message) {
    const lowerMessage = message.toLowerCase();
    const keywords = [];

    // 关键词映射表
    const keywordMap = {
        'trial': ['trial', '试用', '7-day', '7天'],
        'monthly': ['monthly', 'month', '月费', '$20', '20美元'],
        'payment': ['payment', 'pay', 'payout', '付款', '结算'],
        'mcn': ['mcn', 'agency', 'bind', '绑定', '机构'],
        'video': ['video', 'post', 'posting', '视频', '发布'],
        'violation': ['violation', 'ban', 'risk', '违规', '封号'],
        'product': ['product', 'recommend', '产品', '推荐'],
        'safety': ['safety', 'safe', 'risk', '安全', '风险']
    };

    for (const [key, patterns] of Object.entries(keywordMap)) {
        for (const pattern of patterns) {
            if (lowerMessage.includes(pattern)) {
                keywords.push(key);
                break;
            }
        }
    }

    return keywords;
}

const TOPIC_GROUP_DEFAULT_SCENE = {
    outreach_contact: 'first_contact',
    agency_second_touch: 'mcn_binding',
    agency_recall_pending: 'mcn_binding',
    custom_topic: 'follow_up',
    followup_progress: 'follow_up',
    signup_onboarding: 'trial_intro',
    product_mechanics: 'content_request',
    mcn_partnership: 'mcn_binding',
    settlement_pricing: 'payment_issue',
    content_strategy: 'content_request',
    violation_risk_control: 'violation_appeal',
};

const TOPIC_GROUP_DEFAULT_INTENT = {
    outreach_contact: 'first_outreach_fixed',
    agency_second_touch: 'agency_second_touch_binding',
    agency_recall_pending: 'agency_recall_pending',
    custom_topic: 'custom_template',
    followup_progress: 'followup_soft_reminder',
    signup_onboarding: 'invite_code_reply',
    product_mechanics: 'how_moras_works',
    mcn_partnership: 'mcn_explain',
    settlement_pricing: 'monthly_fee_explain',
    content_strategy: 'posting_cadence',
    violation_risk_control: 'violation_reassurance',
};

const FIXED_TOPIC_TEMPLATES = {
    first_outreach_fixed: {
        topic_group: 'outreach_contact',
        intent_key: 'first_outreach_fixed',
        scene_keys: ['first_contact'],
        title: '初次建联固定方案',
        source: 'fixed-initial-outreach',
        text: `Hi [Creator Name]! I'm Alice, the marketing manager of the Moras team. Welcome to joining Moras - excited to have you with us!

Nice to meet you! You can call me Alice. Next, I'll help you better use Moras, and you can contact me if you have any questions or product feedback.

May I ask if you encountered any issues while registering for Moras? You can reach out to me here anytime.`,
    },
    agency_second_touch_binding: {
        topic_group: 'agency_second_touch',
        intent_key: 'agency_second_touch_binding',
        scene_keys: ['mcn_binding', 'follow_up'],
        title: '二次触达agency绑定',
        source: 'fixed-agency-second-touch',
        text: `Hi [Creator Name], just checking in quickly. I know the agency binding step can feel like one more thing to figure out, so no pressure.

Are you still open to learning how it works? If yes, I can send the exact next step and you can decide from there.`,
    },
    agency_recall_pending: {
        topic_group: 'agency_recall_pending',
        intent_key: 'agency_recall_pending',
        scene_keys: ['mcn_binding', 'follow_up'],
        title: '待召回绑定落地',
        source: 'fixed-agency-recall-pending',
        text: `Hi [Creator Name], following up on the agency binding we discussed earlier.

If you're still ready to move forward, I can help you complete just the next step today. What time works best for you to finish the binding?`,
    },
};

function resolveTopicGroupFromText(text = '', currentTopic = null, autoDetectedTopic = null) {
    const explicit = currentTopic?.topic_group || currentTopic?.topic_key || autoDetectedTopic?.topic_group || autoDetectedTopic?.topic_key;
    if (explicit) return explicit;

    const lower = String(text || '').toLowerCase();
    if (/\b(pending recall|recall pending|bring back|re-anchor|lock the execution)\b/.test(lower) || /(待召回|召回|已同意绑定|可以绑定|锁定完成时间|绑定落地)/.test(lower)) return 'agency_recall_pending';
    if (/\b(second touch|secondary reach|reach back|check in again|agency follow)\b/.test(lower) || /(二次触达|二次建联|再次触达|再次跟进|agency绑定跟进|绑定意愿不明)/.test(lower)) return 'agency_second_touch';
    if (/\b(violation|appeal|flagged|strike|banned|risk|safe)\b/.test(lower) || /(违规|申诉|封号|风控|风险|安全)/.test(lower)) return 'violation_risk_control';
    if (/\b(monthly|membership|fee|pricing|\$20|payment|paypal|payout|settlement|commission|subsidy)\b/.test(lower) || /(月费|包月|会员|收费|价格|支付|付款|结算|佣金|补贴|paypal)/.test(lower)) return 'settlement_pricing';
    if (/\b(mcn|agency|contract|binding|bind|self run|full service)\b/.test(lower) || /(mcn|agency|机构|签约|绑定|自营|全托)/.test(lower)) return 'mcn_partnership';
    if (/\b(invite code|register|registration|signup|username|log in|login|email only|communicate by email|right here on email|not posted|haven't posted|have not posted|first video|generated my first video|generated your first video)\b/.test(lower) || /(邀请码|注册码|注册|登录|用户名|username|只用邮箱沟通|邮件沟通|只想用邮件|还没发|未发布|首条视频|第一条视频|生成了第一条视频)/.test(lower)) return 'signup_onboarding';
    if (/\b(posting|cadence|how many videos|selection|audience fit|content strategy|product link)\b/.test(lower) || /(发帖|发布频率|发几个视频|选品|受众|转化建议|product link|商品链接)/.test(lower)) return 'content_strategy';
    if (/\b(how does moras work|what is moras|product logic|manual script|edit scripts|qualified video)\b/.test(lower) || /(怎么工作|产品机制|推荐逻辑|手动改脚本|编辑脚本|qualified video)/.test(lower)) return 'product_mechanics';
    if (/\b(follow up|follow-up|reminder|checking in|still interested)\b/.test(lower) || /(跟进|提醒|有兴趣吗|还在考虑吗)/.test(lower)) return 'followup_progress';
    return 'outreach_contact';
}

function resolveSceneKey(topicGroup, text = '', explicitScene = null) {
    if (explicitScene) return explicitScene;
    const lower = String(text || '').toLowerCase();
    if (topicGroup === 'agency_second_touch' || topicGroup === 'agency_recall_pending') {
        return 'mcn_binding';
    }
    if (topicGroup === 'settlement_pricing') {
        if (/\b(monthly|membership|fee|pricing|\$20)\b/.test(lower) || /(月费|包月|会员|收费|价格)/.test(lower)) return 'monthly_inquiry';
        if (/\b(commission|earnings|revenue|subsidy)\b/.test(lower) || /(佣金|分成|收入|补贴)/.test(lower)) return 'commission_query';
        return 'payment_issue';
    }
    if (topicGroup === 'content_strategy' && (/\b(gmv|sales|performance)\b/.test(lower) || /(gmv|销量|表现|收入)/.test(lower))) {
        return 'gmv_inquiry';
    }
    return TOPIC_GROUP_DEFAULT_SCENE[topicGroup] || 'follow_up';
}

function resolveIntentKey(topicGroup, text = '') {
    const lower = String(text || '').toLowerCase();
    if (topicGroup === 'outreach_contact') return 'first_outreach_fixed';
    if (topicGroup === 'agency_second_touch') return 'agency_second_touch_binding';
    if (topicGroup === 'agency_recall_pending') return 'agency_recall_pending';
    if (topicGroup === 'signup_onboarding') {
        if (/\b(email only|communicate by email|right here on email)\b/.test(lower) || /(只用邮箱沟通|邮件沟通|只想用邮件)/.test(lower)) return 'username_followup';
        if (/\b(not posted|haven't posted|have not posted|first video|generated my first video|generated your first video)\b/.test(lower) || /(还没发|未发布|首条视频|第一条视频|生成了第一条视频)/.test(lower)) return 'registered_not_posted';
        if (/\b(username)\b/.test(lower) || /(用户名|username)/.test(lower)) return 'username_followup';
        if (/\b(not posted|first sale|first post)\b/.test(lower) || /(还没发|未发布|首条视频)/.test(lower)) return 'registered_not_posted';
        return 'invite_code_reply';
    }
    if (topicGroup === 'settlement_pricing') {
        if (/\b(monthly|membership|fee|pricing|\$20)\b/.test(lower) || /(月费|包月|会员|收费|价格)/.test(lower)) return 'monthly_fee_explain';
        if (/\b(payment method|paypal|bank|payout)\b/.test(lower) || /(支付方式|paypal|银行卡|收款)/.test(lower)) return 'payment_method';
        if (/\b(subsidy|qualified video|weekly settlement|settlement)\b/.test(lower) || /(补贴|qualified video|周结|结算)/.test(lower)) return 'weekly_settlement';
        return 'subsidy_explain';
    }
    if (topicGroup === 'mcn_partnership') {
        if (/\b(hesitat|concern|not sure|required)\b/.test(lower) || /(犹豫|顾虑|必须绑定|一定要绑定)/.test(lower)) return 'mcn_hesitation';
        if (/\b(self run|full service)\b/.test(lower) || /(自营|全托)/.test(lower)) return 'self_run_vs_full_service';
        return 'mcn_explain';
    }
    if (topicGroup === 'product_mechanics') {
        if (/\b(product logic|recommend|why this product)\b/.test(lower) || /(推荐逻辑|为什么推荐|产品逻辑)/.test(lower)) return 'product_logic';
        if (/\b(manual script|edit scripts|edit)\b/.test(lower) || /(手动改脚本|编辑脚本)/.test(lower)) return 'manual_editing_request';
        if (/\b(qualified video)\b/.test(lower) || /(qualified video|合格视频)/.test(lower)) return 'qualified_video_rule';
        return 'how_moras_works';
    }
    if (topicGroup === 'content_strategy') {
        if (/\b(product selection|selection|audience)\b/.test(lower) || /(选品|受众|类目)/.test(lower)) return 'product_selection';
        if (/\b(version|update|new version)\b/.test(lower) || /(版本|更新|新版本)/.test(lower)) return 'version_update_notice';
        if (/\b(audience fit|fit)\b/.test(lower) || /(受众匹配|契合)/.test(lower)) return 'audience_fit';
        if (/\b(product link|missing link)\b/.test(lower) || /(商品链接|链接消失|链接不见)/.test(lower)) return 'product_selection';
        return 'posting_cadence';
    }
    if (topicGroup === 'violation_risk_control') {
        if (/\b(appeal template|review team)\b/.test(lower) || /(申诉模板|review team)/.test(lower)) return 'appeal_template';
        if (/\b(compensat)\b/.test(lower) || /(赔偿)/.test(lower)) return 'post_compensation_warning';
        if (/\b(pre-check|risk checklist|safe)\b/.test(lower) || /(风控检查|风险清单|安全)/.test(lower)) return 'risk_precheck';
        return 'violation_reassurance';
    }
    if (topicGroup === 'followup_progress') {
        if (/\b(final call|last follow)\b/.test(lower) || /(最后一次跟进|最终提醒)/.test(lower)) return 'followup_final_call';
        if (/\b(thank you for your interest|interested)\b/.test(lower) || /(感谢你的兴趣|感兴趣)/.test(lower)) return 'followup_interested_reply';
        return 'followup_soft_reminder';
    }
    return TOPIC_GROUP_DEFAULT_INTENT[topicGroup] || 'followup_soft_reminder';
}

/**
 * 加载知识源内容
 * @param {Object} source - 知识源元数据
 * @returns {string|null} 知识源内容
 */
function loadSourceContent(source) {
    try {
        const fullPath = path.join(__dirname, '../../', source.path);
        return fs.readFileSync(fullPath, 'utf8');
    } catch (e) {
        return null;
    }
}

function slugifySectionId(value) {
    return String(value || '')
        .toLowerCase()
        .replace(/[`*_]/g, '')
        .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 80);
}

function normalizeSectionTitle(title) {
    return String(title || '')
        .replace(/\s+/g, ' ')
        .replace(/^[#\-\d.\s]+/, '')
        .trim();
}

function pickSectionText(section) {
    const codeBlocks = Array.from(section.raw.matchAll(/```(?:text)?\s*([\s\S]*?)```/gi))
        .map((match) => sanitizeTemplateText(match[1]))
        .filter(isUsableTemplate);
    if (codeBlocks.length > 0) {
        return codeBlocks[0];
    }

    const paragraphLines = section.raw
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith('#') && !line.startsWith('- ') && !line.startsWith('|'));

    const paragraph = paragraphLines.join('\n').trim();
    return isUsableTemplate(paragraph) ? paragraph : null;
}

function inferSectionMetadata(source, section) {
    const sourceId = String(source?.id || '').toLowerCase();
    const pathText = section.path.join(' | ').toLowerCase();
    const titleText = String(section.title || '').toLowerCase();

    const meta = {
        topic_group: null,
        intent_key: null,
        scene_keys: [],
        operator_scope: sourceId.includes('yiyun') ? ['Yiyun'] : ['all'],
        template_kind: 'reference',
        sendable: true,
        priority: Number.isFinite(source?.priority) ? source.priority : 99,
        is_reference: false,
    };

    if (sourceId.includes('creator-outreach')) {
        if (titleText.includes('script a')) {
            Object.assign(meta, { topic_group: 'outreach_contact', intent_key: 'first_outreach_soft_mcn', scene_keys: ['first_contact'], template_kind: 'outreach', priority: 1 });
        } else if (titleText.includes('script b')) {
            Object.assign(meta, { topic_group: 'outreach_contact', intent_key: 'first_outreach_self_run', scene_keys: ['first_contact'], template_kind: 'outreach', priority: 2 });
        } else if (titleText.includes('referred creator')) {
            Object.assign(meta, { topic_group: 'outreach_contact', intent_key: 'first_outreach_value_pitch', scene_keys: ['first_contact'], template_kind: 'outreach', priority: 3 });
        } else if (titleText.includes('version a')) {
            Object.assign(meta, { topic_group: 'mcn_partnership', intent_key: 'mcn_explain', scene_keys: ['mcn_binding', 'general'], template_kind: 'faq', priority: 2, is_reference: true });
        } else if (titleText.includes('version b')) {
            Object.assign(meta, { topic_group: 'settlement_pricing', intent_key: 'subsidy_explain', scene_keys: ['payment_issue', 'monthly_inquiry'], template_kind: 'faq', priority: 2, is_reference: true });
        } else if (titleText.includes('interested reply')) {
            Object.assign(meta, { topic_group: 'followup_progress', intent_key: 'followup_interested_reply', scene_keys: ['follow_up'], template_kind: 'follow_up', priority: 1 });
        } else if (titleText.includes('soft follow-up')) {
            Object.assign(meta, { topic_group: 'followup_progress', intent_key: 'followup_soft_reminder', scene_keys: ['follow_up'], template_kind: 'follow_up', priority: 2 });
        } else if (titleText.includes('final call')) {
            Object.assign(meta, { topic_group: 'followup_progress', intent_key: 'followup_final_call', scene_keys: ['follow_up'], template_kind: 'follow_up', priority: 3 });
        } else if (titleText.includes('invite code reply')) {
            Object.assign(meta, { topic_group: 'signup_onboarding', intent_key: 'invite_code_reply', scene_keys: ['trial_intro'], template_kind: 'onboarding', priority: 1 });
        } else if (titleText.includes('invite code sent but not registered')) {
            Object.assign(meta, { topic_group: 'signup_onboarding', intent_key: 'invite_code_reply', scene_keys: ['trial_intro', 'follow_up'], template_kind: 'onboarding', priority: 2 });
        } else if (titleText.includes('username received')) {
            Object.assign(meta, { topic_group: 'signup_onboarding', intent_key: 'username_followup', scene_keys: ['trial_intro'], template_kind: 'onboarding', priority: 2 });
        } else if (titleText.includes('registered but not posted')) {
            Object.assign(meta, { topic_group: 'signup_onboarding', intent_key: 'registered_not_posted', scene_keys: ['trial_intro'], template_kind: 'onboarding', priority: 3 });
        } else if (titleText.includes('email-only communication')) {
            Object.assign(meta, { topic_group: 'signup_onboarding', intent_key: 'username_followup', scene_keys: ['trial_intro', 'follow_up'], template_kind: 'onboarding', priority: 3, is_reference: true });
        } else if (titleText.includes('ios-only support')) {
            Object.assign(meta, { topic_group: 'signup_onboarding', intent_key: 'username_followup', scene_keys: ['trial_intro'], template_kind: 'onboarding', priority: 3 });
        } else if (titleText.includes('how does moras generate')) {
            Object.assign(meta, { topic_group: 'product_mechanics', intent_key: 'how_moras_works', scene_keys: ['content_request'], template_kind: 'faq', priority: 2 });
        } else if (titleText.includes('moras detailed introduction')) {
            Object.assign(meta, { topic_group: 'product_mechanics', intent_key: 'how_moras_works', scene_keys: ['content_request', 'general'], template_kind: 'faq', priority: 2, is_reference: true });
        } else if (titleText.includes('product recommendation logic')) {
            Object.assign(meta, { topic_group: 'product_mechanics', intent_key: 'product_logic', scene_keys: ['content_request'], template_kind: 'faq', priority: 2 });
        } else if (titleText.includes('posting limits')) {
            Object.assign(meta, { topic_group: 'content_strategy', intent_key: 'posting_cadence', scene_keys: ['content_request'], template_kind: 'faq', priority: 2 });
        } else if (titleText.includes('missing product link')) {
            Object.assign(meta, { topic_group: 'content_strategy', intent_key: 'product_selection', scene_keys: ['content_request'], template_kind: 'faq', priority: 3 });
        } else if (titleText.includes('edit scripts manually')) {
            Object.assign(meta, { topic_group: 'product_mechanics', intent_key: 'manual_editing_request', scene_keys: ['content_request'], template_kind: 'faq', priority: 2 });
        } else if (titleText.includes('qualified')) {
            Object.assign(meta, { topic_group: 'product_mechanics', intent_key: 'qualified_video_rule', scene_keys: ['payment_issue', 'content_request'], template_kind: 'faq', priority: 2 });
        } else if (titleText.includes('binding cost') || titleText.includes('commitment concern')) {
            Object.assign(meta, { topic_group: 'mcn_partnership', intent_key: 'mcn_hesitation', scene_keys: ['mcn_binding'], template_kind: 'faq', priority: 1 });
        } else if (titleText.includes('company info') || titleText.includes('legitimacy') || titleText.includes('privacy') || titleText.includes('terms')) {
            Object.assign(meta, { topic_group: 'mcn_partnership', intent_key: 'mcn_explain', scene_keys: ['mcn_binding', 'general'], template_kind: 'faq', priority: 2, is_reference: true });
        } else if (titleText.includes('delay / hesitation')) {
            Object.assign(meta, { topic_group: 'mcn_partnership', intent_key: 'mcn_hesitation', scene_keys: ['mcn_binding', 'follow_up'], template_kind: 'faq', priority: 2 });
        } else if (titleText.includes('whatsapp greeting')) {
            Object.assign(meta, { topic_group: 'signup_onboarding', intent_key: 'username_followup', scene_keys: ['trial_intro', 'follow_up'], template_kind: 'onboarding', priority: 2 });
        } else if (titleText.includes('whatsapp first check-in')) {
            Object.assign(meta, { topic_group: 'signup_onboarding', intent_key: 'invite_code_reply', scene_keys: ['trial_intro', 'follow_up'], template_kind: 'onboarding', priority: 1 });
        } else if (titleText.includes('whatsapp time difference')) {
            Object.assign(meta, { topic_group: 'followup_progress', intent_key: 'followup_soft_reminder', scene_keys: ['follow_up'], template_kind: 'follow_up', priority: 3, is_reference: true });
        } else if (titleText.includes('whatsapp product intro')) {
            Object.assign(meta, { topic_group: 'product_mechanics', intent_key: 'how_moras_works', scene_keys: ['content_request', 'general'], template_kind: 'faq', priority: 2 });
        } else if (titleText.includes('whatsapp new creator guide')) {
            Object.assign(meta, { topic_group: 'signup_onboarding', intent_key: 'registered_not_posted', scene_keys: ['trial_intro'], template_kind: 'onboarding', priority: 1 });
        } else if (titleText.includes('whatsapp posting time')) {
            Object.assign(meta, { topic_group: 'content_strategy', intent_key: 'posting_cadence', scene_keys: ['content_request', 'follow_up'], template_kind: 'strategy', priority: 2 });
        } else if (titleText.includes('whatsapp registration trouble')) {
            Object.assign(meta, { topic_group: 'signup_onboarding', intent_key: 'username_followup', scene_keys: ['trial_intro'], template_kind: 'onboarding', priority: 2 });
        } else if (titleText.includes('whatsapp first video generated')) {
            Object.assign(meta, { topic_group: 'signup_onboarding', intent_key: 'registered_not_posted', scene_keys: ['trial_intro', 'follow_up'], template_kind: 'onboarding', priority: 2 });
        } else if (titleText.includes('whatsapp community invite')) {
            Object.assign(meta, { topic_group: 'followup_progress', intent_key: 'followup_interested_reply', scene_keys: ['follow_up'], template_kind: 'follow_up', priority: 3, is_reference: true });
        } else if (titleText.includes('whatsapp community welcome')) {
            Object.assign(meta, { topic_group: 'followup_progress', intent_key: 'followup_interested_reply', scene_keys: ['follow_up'], template_kind: 'follow_up', priority: 3, is_reference: true });
        } else if (titleText.includes('whatsapp referral expansion')) {
            Object.assign(meta, { topic_group: 'outreach_contact', intent_key: 'first_outreach_value_pitch', scene_keys: ['follow_up', 'first_contact'], template_kind: 'reference', priority: 4, is_reference: true });
        } else if (titleText.includes('whatsapp safety concern') || titleText.includes('ai safety concern')) {
            Object.assign(meta, { topic_group: 'violation_risk_control', intent_key: 'violation_reassurance', scene_keys: ['violation_appeal', 'general'], template_kind: 'appeal', priority: 1 });
        } else if (titleText.includes('violation response')) {
            Object.assign(meta, { topic_group: 'violation_risk_control', intent_key: 'violation_reassurance', scene_keys: ['violation_appeal'], template_kind: 'appeal', priority: 1 });
        } else if (titleText.includes('appeal template')) {
            Object.assign(meta, { topic_group: 'violation_risk_control', intent_key: 'appeal_template', scene_keys: ['violation_appeal'], template_kind: 'appeal', priority: 1, is_reference: true });
        }
    } else if (sourceId.includes('playbook-yiyun')) {
        meta.operator_scope = ['Yiyun'];
        if (titleText.includes('suggested reply template')) {
            Object.assign(meta, { topic_group: 'settlement_pricing', intent_key: 'monthly_fee_explain', scene_keys: ['monthly_inquiry'], template_kind: 'payment', priority: 1 });
        } else if (titleText.includes('monthly fee')) {
            Object.assign(meta, { topic_group: 'settlement_pricing', intent_key: 'monthly_fee_explain', scene_keys: ['monthly_inquiry'], template_kind: 'payment', priority: 2, is_reference: true });
        } else if (titleText.includes('payment support')) {
            Object.assign(meta, { topic_group: 'settlement_pricing', intent_key: 'payment_method', scene_keys: ['payment_issue'], template_kind: 'payment', priority: 2 });
        } else if (titleText.includes('mcn binding')) {
            Object.assign(meta, { topic_group: 'mcn_partnership', intent_key: 'mcn_explain', scene_keys: ['mcn_binding'], template_kind: 'mcn', priority: 2 });
        } else if (titleText.includes('setup trouble')) {
            Object.assign(meta, { topic_group: 'signup_onboarding', intent_key: 'username_followup', scene_keys: ['video_not_loading', 'trial_intro'], template_kind: 'onboarding', priority: 2 });
        }
    } else if (sourceId.includes('faq-moras')) {
        if (titleText.includes('short explanation')) {
            Object.assign(meta, { topic_group: 'product_mechanics', intent_key: 'how_moras_works', scene_keys: ['content_request'], template_kind: 'faq', priority: 1 });
        } else if (titleText.includes('suggested reply template')) {
            Object.assign(meta, { topic_group: 'product_mechanics', intent_key: 'product_logic', scene_keys: ['content_request'], template_kind: 'faq', priority: 2 });
        } else if (titleText.includes('product recommendation logic')) {
            Object.assign(meta, { topic_group: 'product_mechanics', intent_key: 'product_logic', scene_keys: ['content_request'], template_kind: 'faq', priority: 2, is_reference: true });
        } else if (titleText.includes('creator control')) {
            Object.assign(meta, { topic_group: 'product_mechanics', intent_key: 'how_moras_works', scene_keys: ['content_request'], template_kind: 'faq', priority: 3, is_reference: true });
        }
    } else if (sourceId.includes('product-selection')) {
        if (titleText.includes('product selection logic')) {
            Object.assign(meta, { topic_group: 'content_strategy', intent_key: 'product_selection', scene_keys: ['content_request', 'gmv_inquiry'], template_kind: 'strategy', priority: 1 });
        } else if (titleText.includes('posting cadence')) {
            Object.assign(meta, { topic_group: 'content_strategy', intent_key: 'posting_cadence', scene_keys: ['content_request'], template_kind: 'strategy', priority: 1 });
        } else if (titleText.includes('standard response')) {
            Object.assign(meta, { topic_group: 'content_strategy', intent_key: 'posting_cadence', scene_keys: ['content_request'], template_kind: 'strategy', priority: 1 });
        }
    } else if (sourceId.includes('violation-appeal')) {
        if (titleText.includes('creator asks')) {
            Object.assign(meta, { topic_group: 'violation_risk_control', intent_key: 'violation_reassurance', scene_keys: ['violation_appeal'], template_kind: 'appeal', priority: 1 });
        } else if (titleText.includes('creator reports a violation')) {
            Object.assign(meta, { topic_group: 'violation_risk_control', intent_key: 'violation_reassurance', scene_keys: ['violation_appeal'], template_kind: 'appeal', priority: 1 });
        } else if (titleText.includes('appeal template')) {
            Object.assign(meta, { topic_group: 'violation_risk_control', intent_key: 'appeal_template', scene_keys: ['violation_appeal'], template_kind: 'appeal', priority: 2, is_reference: true });
        } else if (titleText.includes('compensation reminder')) {
            Object.assign(meta, { topic_group: 'violation_risk_control', intent_key: 'post_compensation_warning', scene_keys: ['violation_appeal'], template_kind: 'risk_reminder', priority: 2 });
        }
    }

    if (!meta.topic_group) {
        if (pathText.includes('appeal') || pathText.includes('violation')) {
            Object.assign(meta, { topic_group: 'violation_risk_control', intent_key: 'violation_reassurance', scene_keys: ['violation_appeal'] });
        } else if (pathText.includes('payment') || pathText.includes('monthly')) {
            Object.assign(meta, { topic_group: 'settlement_pricing', intent_key: 'monthly_fee_explain', scene_keys: ['payment_issue'] });
        } else if (pathText.includes('mcn') || pathText.includes('agency')) {
            Object.assign(meta, { topic_group: 'mcn_partnership', intent_key: 'mcn_explain', scene_keys: ['mcn_binding'] });
        } else if (pathText.includes('signup') || pathText.includes('invite') || pathText.includes('username')) {
            Object.assign(meta, { topic_group: 'signup_onboarding', intent_key: 'invite_code_reply', scene_keys: ['trial_intro'] });
        } else if (pathText.includes('post') || pathText.includes('selection') || pathText.includes('cadence')) {
            Object.assign(meta, { topic_group: 'content_strategy', intent_key: 'posting_cadence', scene_keys: ['content_request'] });
        } else if (pathText.includes('moras') || pathText.includes('product')) {
            Object.assign(meta, { topic_group: 'product_mechanics', intent_key: 'how_moras_works', scene_keys: ['content_request'] });
        } else {
            Object.assign(meta, { topic_group: 'outreach_contact', intent_key: 'first_outreach_value_pitch', scene_keys: ['first_contact'] });
        }
    }

    return meta;
}

function parseTemplateSections(content, source) {
    if (!content) return [];

    const lines = String(content).split('\n');
    const sections = [];
    const headingStack = [];
    let current = null;

    function flushCurrent() {
        if (!current) return;
        const text = pickSectionText(current);
        if (!text) {
            current = null;
            return;
        }
        const metadata = inferSectionMetadata(source, current);
        sections.push({
            source_id: source.id,
            source_type: source.type,
            title: current.title,
            path: current.path,
            text,
            section_id: `${source.id}::${slugifySectionId(current.path.join('-') || current.title)}`,
            ...metadata,
        });
        current = null;
    }

    for (const line of lines) {
        const headingMatch = line.match(/^(#{2,4})\s+(.+?)\s*$/);
        if (headingMatch) {
            flushCurrent();
            const level = headingMatch[1].length;
            const title = normalizeSectionTitle(headingMatch[2]);
            headingStack[level - 2] = title;
            headingStack.length = level - 1;
            current = {
                title,
                raw: '',
                path: headingStack.filter(Boolean),
            };
            continue;
        }
        if (current) {
            current.raw += `${line}\n`;
        }
    }
    flushCurrent();

    return sections;
}

function buildTemplateSectionsForSource(source) {
    const content = loadSourceContent(source);
    if (!content) return [];
    return parseTemplateSections(content, source);
}

function scoreTemplateSection(section, context) {
    const {
        topic_group,
        intent_key,
        scene_key,
        operator,
        lifecycleStage,
        combinedText,
        activeEventKeys,
    } = context;
    let score = 0;
    const matched_by = [];
    const haystack = [section.title, section.text, section.path.join(' '), section.source_id].join(' ').toLowerCase();

    if (section.topic_group === topic_group) {
        score += 30;
        matched_by.push('topic_group');
    }
    if (section.intent_key === intent_key) {
        score += 24;
        matched_by.push('intent');
    }
    if (scene_key && section.scene_keys.includes(scene_key)) {
        score += 14;
        matched_by.push('scene');
    }
    if (operator && (section.operator_scope.includes('all') || section.operator_scope.some((item) => item.toLowerCase() === String(operator).toLowerCase()))) {
        score += section.operator_scope.includes('all') ? 3 : 10;
        matched_by.push('operator');
    }
    if (lifecycleStage && haystack.includes(String(lifecycleStage).toLowerCase())) {
        score += 4;
        matched_by.push('lifecycle');
    }
    if (activeEventKeys.some((eventKey) => haystack.includes(eventKey))) {
        score += 4;
        matched_by.push('active_event');
    }

    for (const keyword of extractKeywords(combinedText)) {
        if (haystack.includes(keyword)) {
            score += 2;
            matched_by.push(`keyword:${keyword}`);
        }
    }

    if (section.source_type === 'playbook') score += 2;
    if (section.source_type === 'faq') score += 1;
    if (section.is_reference) score += 1;

    return { score, matched_by: Array.from(new Set(matched_by)) };
}

function retrieveTemplateSlots(context) {
    const {
        scene = null,
        operator = null,
        userMessage = '',
        recentMessages = [],
        currentTopic = null,
        autoDetectedTopic = null,
        activeEvents = [],
        lifecycle = null,
        maxSources = 5,
    } = context;
    const manifestData = loadManifest();
    const recentText = (Array.isArray(recentMessages) ? recentMessages : [])
        .map((message) => String(message?.text || '').trim())
        .filter(Boolean)
        .join(' \n ');
    const combinedText = [userMessage, recentText].filter(Boolean).join(' \n ');
    const topic_group = resolveTopicGroupFromText(combinedText, currentTopic, autoDetectedTopic);
    const intent_key = currentTopic?.intent_key || autoDetectedTopic?.intent_key || resolveIntentKey(topic_group, combinedText);
    const scene_key = currentTopic?.scene_key || autoDetectedTopic?.scene_key || resolveSceneKey(topic_group, combinedText, scene);
    const lifecycleStage = lifecycle?.stage_key || null;
    const activeEventKeys = (Array.isArray(activeEvents) ? activeEvents : [])
        .filter((event) => event?.status === 'active')
        .map((event) => String(event?.event_key || '').toLowerCase())
        .filter(Boolean);
    const customTemplateText = String(currentTopic?.custom_template_text || '').trim();

    if (customTemplateText) {
        const customTemplateId = currentTopic?.custom_template_id || null;
        const customMediaItems = Array.isArray(currentTopic?.custom_template_media_items)
            ? currentTopic.custom_template_media_items
            : [];
        const customSection = {
            source_id: 'operator-custom-topic',
            title: currentTopic?.custom_topic_label || '自定义话题模板',
            text: customTemplateText,
            section_id: `operator-custom-topic::${customTemplateId || slugifySectionId(currentTopic?.custom_topic_label || 'draft')}`,
            custom_template_id: customTemplateId,
            custom_template_label: currentTopic?.custom_topic_label || '',
            media_items: customMediaItems,
            topic_group,
            intent_key,
            scene_keys: [scene_key].filter(Boolean),
            matched_by: ['custom_template'],
            sendable: true,
            score: 100,
        };
        return {
            context: {
                topic_group,
                intent_key,
                scene_key,
                resolved_operator: operator || null,
            },
            slots: {
                op1: formatTemplateSlot(customSection, 'recommended'),
                op2: null,
            },
            alternatives: [],
            template: { text: customTemplateText, source: customSection.source_id },
        };
    }

    const fixedTemplate = FIXED_TOPIC_TEMPLATES[intent_key] || null;
    if (fixedTemplate) {
        const fixedSection = {
            source_id: fixedTemplate.source,
            title: fixedTemplate.title,
            text: fixedTemplate.text,
            section_id: `${fixedTemplate.source}::${fixedTemplate.intent_key}`,
            topic_group: fixedTemplate.topic_group,
            intent_key: fixedTemplate.intent_key,
            scene_keys: fixedTemplate.scene_keys,
            matched_by: ['fixed_topic_template'],
            sendable: true,
            score: 100,
        };
        return {
            context: {
                topic_group,
                intent_key,
                scene_key,
                resolved_operator: operator || null,
            },
            slots: {
                op1: formatTemplateSlot(fixedSection, 'recommended'),
                op2: null,
            },
            alternatives: [],
            template: { text: fixedTemplate.text, source: fixedTemplate.source },
        };
    }

    const sections = [];
    for (const source of manifestData.sources || []) {
        if (source.status !== 'approved') continue;
        sections.push(...buildTemplateSectionsForSource(source));
    }

    const ranked = sections
        .map((section) => {
            const { score, matched_by } = scoreTemplateSection(section, {
                topic_group,
                intent_key,
                scene_key,
                operator,
                lifecycleStage,
                combinedText,
                activeEventKeys,
            });
            return {
                ...section,
                score,
                matched_by,
            };
        })
        .filter((section) => section.score > 0)
        .sort((a, b) => {
            if (b.score !== a.score) return b.score - a.score;
            if (a.priority !== b.priority) return a.priority - b.priority;
            return String(a.section_id).localeCompare(String(b.section_id));
        });

    const relevantRanked = ranked.filter((item) => {
        if (item.topic_group === topic_group) return true;
        if (item.intent_key === intent_key) return true;
        if (scene_key && item.scene_keys.includes(scene_key)) return true;
        return item.score >= 8;
    });
    const rankedPool = relevantRanked.length > 0 ? relevantRanked : ranked;
    const sendable = rankedPool.filter((item) => item.sendable);
    const op1 = sendable[0] || rankedPool[0] || null;
    const op2 = sendable.find((item) => item.section_id !== op1?.section_id && item.topic_group === topic_group && item.intent_key === intent_key)
        || sendable.find((item) => item.section_id !== op1?.section_id && item.topic_group === topic_group && item.is_reference)
        || sendable.find((item) => item.section_id !== op1?.section_id && item.topic_group === topic_group && (!scene_key || item.scene_keys.includes(scene_key)))
        || sendable.find((item) => item.section_id !== op1?.section_id && item.topic_group === topic_group)
        || sendable.find((item) => item.section_id !== op1?.section_id && item.intent_key === intent_key)
        || rankedPool.find((item) => item.section_id !== op1?.section_id)
        || null;

    const alternatives = rankedPool
        .filter((item) => item.section_id !== op1?.section_id && item.section_id !== op2?.section_id)
        .slice(0, Math.max(0, maxSources - 2))
        .map((item) => formatTemplateSlot(item, 'alternative'));

    return {
        context: {
            topic_group,
            intent_key,
            scene_key,
            resolved_operator: operator || null,
        },
        slots: {
            op1: formatTemplateSlot(op1, 'recommended'),
            op2: formatTemplateSlot(op2, 'reference'),
        },
        alternatives,
        template: op1 ? { text: op1.text, source: op1.source_id } : null,
    };
}

function formatTemplateSlot(section, slotRole = 'recommended') {
    if (!section) return null;
    return {
        kind: 'template',
        slot_role: slotRole,
        text: section.text,
        section_id: section.section_id,
        title: section.title,
        source: section.source_id,
        custom_template_id: section.custom_template_id || null,
        custom_template_label: section.custom_template_label || null,
        media_items: section.media_items || [],
        matched_by: section.matched_by || [],
        sendable: !!section.sendable,
        topic_group: section.topic_group,
        intent_key: section.intent_key,
        scene_keys: section.scene_keys,
        matchScore: section.score || 0,
    };
}

/**
 * 构建 local_rules 注入文本
 * @param {Array} sources - 检索到的知识源列表
 * @returns {string} 格式化的 local_rules 文本
 */
function buildLocalRulesText(sources) {
    if (!sources || sources.length === 0) {
        return '';
    }

    let text = '\n\n【本地知识库规则 — Local Rules】\n';
    text += '以下规则来自已审核的知识源，优先级高于通用知识。\n\n';

    for (const source of sources) {
        const content = loadSourceContent(source);
        if (!content) continue;

        text += `\n--- [${source.id}] ${source.title} ---\n`;
        text += `类型: ${source.type} | 优先级: ${source.priority} | 生效日期: ${source.effective_from}\n\n`;
        text += content;
        text += '\n\n';
    }

    return text;
}

/**
 * 主入口：检索并构建 local_rules
 * @param {Object} context - 检索上下文
 * @returns {Object} { sources: Array, text: string }
 */
function retrieveAndBuildLocalRules(context) {
    const sources = retrieveLocalRules(context);
    const text = buildLocalRulesText(sources);

    return {
        sources: sources.map(s => ({
            id: s.id,
            title: s.title,
            type: s.type,
            score: s.score
        })),
        text
    };
}

/**
 * 从知识源内容中提取纯话术文本
 * @param {string} content - Markdown 内容
 * @param {string} sourceId - 知识源 ID
 * @returns {string|null} 提取的话术文本
 */
function extractTemplateFromSource(content, sourceId, sourceType = '') {
    if (!content) return null;
    const source = {
        id: sourceId,
        type: sourceType,
        priority: 99,
    };
    const sections = parseTemplateSections(content, source);
    return sections[0]?.text || null;
}

function sanitizeTemplateText(text) {
    return String(text || '')
        .replace(/```(?:text)?/g, '')
        .trim();
}

function isUsableTemplate(text) {
    if (!text) return false;
    const trimmed = text.trim();
    if (trimmed.length < 20 || trimmed.length > 2400) return false;
    if (trimmed.startsWith('#') || trimmed.startsWith('|')) return false;
    return /[.!?。！？]/.test(trimmed) || trimmed.split('\n').length >= 2;
}

function extractPlaybookParagraph(content) {
    const lines = content.split('\n');
    let inContent = false;
    const paragraph = [];

    for (const line of lines) {
        if (line.startsWith('## Scope') || line.startsWith('## Core Style') || line.startsWith('## Do Not') || line.startsWith('## Version')) {
            inContent = false;
            continue;
        }

        if (line.startsWith('## ') && !line.includes('Scope') && !line.includes('Version')) {
            inContent = true;
            paragraph.length = 0;
            continue;
        }

        if (inContent && line.trim() && !line.startsWith('#') && !line.startsWith('-')) {
            paragraph.push(line.trim());
            if (paragraph.join(' ').length > 120) {
                break;
            }
        }
    }

    return paragraph.join('\n').trim();
}

module.exports = {
    loadManifest,
    retrieveLocalRules,
    retrieveTemplateSlots,
    loadSourceContent,
    buildLocalRulesText,
    retrieveAndBuildLocalRules,
    extractTemplateFromSource,
    parseTemplateSections,
};
