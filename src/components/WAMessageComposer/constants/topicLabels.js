/**
 * Topic constants for reply generation.
 * Separate operator-facing topic groups from legacy scene keys used by the backend.
 */

export const TOPIC_GROUP_LABELS = {
    outreach_contact: '建联触达',
    followup_progress: '跟进推进',
    signup_onboarding: '注册与邀请码',
    product_mechanics: '产品机制说明',
    mcn_partnership: 'MCN / 合作模式',
    settlement_pricing: '结算 / 月费 / 补贴',
    content_strategy: '内容发布 / 选品优化',
    violation_risk_control: '违规申诉 / 风控',
};

export const TOPIC_GROUP_ORDER = [
    'outreach_contact',
    'followup_progress',
    'signup_onboarding',
    'product_mechanics',
    'mcn_partnership',
    'settlement_pricing',
    'content_strategy',
    'violation_risk_control',
];

export const LEGACY_SCENE_LABELS = {
    trial_intro: '7天挑战咨询',
    monthly_inquiry: '月度挑战咨询',
    gmv_inquiry: 'GMV/收入咨询',
    mcn_binding: 'Agency签约咨询',
    commission_query: '佣金分成咨询',
    content_request: '内容/视频咨询',
    payment_issue: '付款问题',
    violation_appeal: '违规申诉',
    referral: '推荐新用户',
    general: '一般咨询',
    follow_up: '跟进中',
    first_contact: '首次接触',
    video_not_loading: '视频加载问题',
};

export const EVENT_LABELS = {
    trial_7day: '7天挑战',
    monthly_challenge: '月度挑战',
    agency_bound: 'Agency签约',
    gmv_milestone: 'GMV里程碑',
    referral: '推荐奖励',
};

export const INTENT_LABELS = {
    first_outreach_soft_mcn: '首次建联-MCN版',
    first_outreach_self_run: '首次建联-自营/全托版',
    first_outreach_value_pitch: '首次建联-价值介绍',
    followup_soft_reminder: '二次跟进-轻提醒',
    followup_final_call: '二次跟进-最终召回',
    followup_interested_reply: '二次跟进-感兴趣回复',
    invite_code_reply: '邀请码回复',
    username_followup: '用户名跟进',
    registered_not_posted: '已注册未发布',
    how_moras_works: 'Moras机制说明',
    product_logic: '产品逻辑说明',
    manual_editing_request: '脚本编辑说明',
    qualified_video_rule: '合格视频规则',
    mcn_explain: 'MCN机制说明',
    mcn_hesitation: 'MCN顾虑澄清',
    self_run_vs_full_service: '自营/全托说明',
    monthly_fee_explain: '月费说明',
    subsidy_explain: '补贴说明',
    payment_method: '支付方式说明',
    weekly_settlement: '周结说明',
    posting_cadence: '发布频率建议',
    product_selection: '选品建议',
    audience_fit: '受众匹配说明',
    version_update_notice: '版本更新通知',
    appeal_template: '申诉模板',
    violation_reassurance: '违规安抚说明',
    post_compensation_warning: '赔付后提醒',
    risk_precheck: '风控预检查',
};

export const ALL_TOPIC_LABELS = {
    ...TOPIC_GROUP_LABELS,
    ...LEGACY_SCENE_LABELS,
    ...EVENT_LABELS,
    ...INTENT_LABELS,
};

export const TOPIC_GROUP_DEFAULT_SCENE = {
    outreach_contact: 'first_contact',
    followup_progress: 'follow_up',
    signup_onboarding: 'trial_intro',
    product_mechanics: 'content_request',
    mcn_partnership: 'mcn_binding',
    settlement_pricing: 'payment_issue',
    content_strategy: 'content_request',
    violation_risk_control: 'violation_appeal',
};

export const TOPIC_GROUP_DEFAULT_INTENT = {
    outreach_contact: 'first_outreach_value_pitch',
    followup_progress: 'followup_soft_reminder',
    signup_onboarding: 'invite_code_reply',
    product_mechanics: 'how_moras_works',
    mcn_partnership: 'mcn_explain',
    settlement_pricing: 'monthly_fee_explain',
    content_strategy: 'posting_cadence',
    violation_risk_control: 'violation_reassurance',
};

export function getTopicLabel(key, fallback = '新话题') {
    return ALL_TOPIC_LABELS[key] || fallback;
}

export function isTopicGroupKey(key) {
    return !!TOPIC_GROUP_LABELS[key];
}

export function getIntentLabel(key, fallback = '细分意图') {
    return INTENT_LABELS[key] || fallback;
}
