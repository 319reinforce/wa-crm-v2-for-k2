/**
 * EVENT_KEYWORDS — 语义触发关键词映射
 * Used by POST /api/events/detect
 */
const EVENT_KEYWORDS = {
  trial_7day: ['trial', '7day', '7-day', 'free challenge', '7天挑战', '试用挑战', '加入挑战'],
  monthly_challenge: ['monthly challenge', 'monthly', '月度挑战', '包月任务', '每月挑战'],
  agency_bound: ['agency', 'bound', 'signed', 'contract', '签约', '绑定机构', 'mcn', '代理'],
  referral: ['invite', 'refer', '推荐', '介绍', '新人', 'creator joined'],
};

module.exports = { EVENT_KEYWORDS };
