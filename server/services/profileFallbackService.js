const TAG_RULES = [
    { tag: 'topic:pricing', pattern: /(\bprice\b|\bcost\b|how much|pricing|多少钱|价格|收费|月费|\$ ?20\b)/i, confidence: 3 },
    { tag: 'topic:trial', pattern: /(trial|7[\s-]?day|试用|体验)/i, confidence: 3 },
    { tag: 'topic:payment', pattern: /(pay|payment|billing|bill|charge|deduct|付款|支付|扣费)/i, confidence: 3 },
    { tag: 'topic:violation', pattern: /(violation|appeal|risk control|风控|违规|申诉|封禁|限制)/i, confidence: 3 },
    { tag: 'topic:mcn', pattern: /(mcn|agency|contract|签约|绑定机构|代理)/i, confidence: 2 },
    { tag: 'topic:gmv', pattern: /(\bgmv\b|sales|revenue|commission|变现|佣金|销量)/i, confidence: 2 },
    { tag: 'intent:purchase_intent', pattern: /(join|start|buy|subscribe|sign up|开通|加入|报名|想试|想要|想开通)/i, confidence: 3 },
    { tag: 'intent:info_seeking', pattern: /(\bhow\b|\bwhat\b|\bwhen\b|\bwhere\b|\bwhy\b|can i|could i|怎么|如何|什么|为什么|可以吗|能不能)/i, confidence: 2 },
    { tag: 'intent:complaint', pattern: /(problem|issue|error|refund|too expensive|can't|cannot|贵|有问题|不能|出错|退款)/i, confidence: 3 },
    { tag: 'intent:churn_risk', pattern: /(stop|cancel|not interested|leave|quit|先不|不想|算了|取消)/i, confidence: 3 },
    { tag: 'intent:referral', pattern: /(refer|invite|推荐|介绍朋友|拉人)/i, confidence: 2 },
    { tag: 'urgency:high', pattern: /(asap|urgent|today|now|马上|尽快|今天)/i, confidence: 2 },
    { tag: 'tone:friendly', pattern: /(thanks|thank you|great|love|nice|谢谢|太好了)/i, confidence: 2 },
    { tag: 'preference:brief_response', pattern: /(brief|short answer|简单说|简短|一句话)/i, confidence: 2 },
    { tag: 'stage:first_contact', pattern: /(^|\s)(hello|hi|hey)(\s|$)|你好|哈喽|在吗/i, confidence: 2 },
    { tag: 'stage:trial_active', pattern: /(day\s*\d+|第.?天|trial active|正在试用|试用中)/i, confidence: 2 },
    { tag: 'stage:churned', pattern: /(stop|cancel|bye|不合作|取消吧|先不做了)/i, confidence: 3 },
];

function clipText(value, maxLength = 48) {
    return String(value || '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function extractTagsHeuristically(text, { limit = 5 } = {}) {
    const normalized = String(text || '').trim();
    if (!normalized) return [];

    const tags = [];
    for (const rule of TAG_RULES) {
        const match = normalized.match(rule.pattern);
        if (!match) continue;
        if (tags.some((item) => item.tag === rule.tag)) continue;
        tags.push({
            tag: rule.tag,
            source: 'heuristic_fallback',
            reason: `matched "${clipText(match[0])}"`,
            confidence: rule.confidence || 2,
        });
        if (tags.length >= limit) break;
    }

    return tags;
}

function buildFallbackProfileSummary({ creator = {}, lifecycleLabel = '未知阶段', tags = [], memory = [] } = {}) {
    const subject = clipText(creator.name || creator.primary_name || '该达人', 24) || '该达人';
    const owner = clipText(creator.wa_owner || '未知负责人', 24) || '未知负责人';
    const betaStatus = clipText(creator.beta_status || '未知', 24) || '未知';
    const tagSummary = tags
        .map((item) => clipText(item?.tag, 24))
        .filter(Boolean)
        .slice(0, 3)
        .join('、');
    const memorySummary = memory
        .map((item) => clipText(item?.memory_value || item?.value, 28))
        .filter(Boolean)
        .slice(0, 2)
        .join('；');

    const tagText = tagSummary ? `近期标签聚焦${tagSummary}` : '近期标签暂不明显';
    const memoryText = memorySummary ? `已记录偏好${memorySummary}` : '暂未沉淀稳定偏好';

    return `${subject}由${owner}跟进，当前处于${lifecycleLabel || '未知阶段'}，Beta状态${betaStatus}。${tagText}。${memoryText}。建议围绕当前阶段推进单一步下一步。`;
}

module.exports = {
    extractTagsHeuristically,
    buildFallbackProfileSummary,
};
module.exports._private = {
    clipText,
};
