/**
 * extractors.js — 文本/上下文提取工具函数（纯函数，无 React 依赖）
 */

// 推断消息语言（简单关键词检测）
export function detectLanguage(text) {
    if (!text) return 'en';
    const zhRegex = /[\u4e00-\u9fff]/;
    if (zhRegex.test(text)) return 'zh';
    return 'en';
}

// 推断客户语气（基于消息特征）
export function detectClientTone(messages) {
    const recent = (messages || []).slice(-5);
    const text = recent.map(m => m.text || '').join(' ');
    if (!text) return 'neutral';
    const formalCount = (text.match(/\b(please|would|could|kindly|appreciate)\b/gi) || []).length;
    const casualCount = (text.match(/\b(hey|thanks?|great|awesome|cool|yeah)\b/gi) || []).length;
    if (formalCount > casualCount) return 'formal';
    if (casualCount > formalCount) return 'casual';
    return 'friendly';
}

// 推断当前场景
export function inferScene(text, wacrm, messageCount = 0) {
    const t = (text || '').toLowerCase();
    if (/\b(trial|7[\s-]?day|7day|free\s*try|试用)\b/.test(t)) return 'trial_intro';
    if (/\b(monthly|month|membership|月费|包月)\b/.test(t)) return 'monthly_inquiry';
    if (/\b(commission|分成|提成|revenue|佣金|收入)\b/.test(t)) return 'commission_query';
    if (/\b(mcn|agency|经纪|代理|绑定|contract|签约)\b/.test(t)) return 'mcn_binding';
    if (/\b(video\s*(not|doesn)?t?\s*(load|generat|creat|show|appear)|视频\s*(生成|加载|显示|出现)?(不了|失败|慢|卡)|内容\s*(不符|不对|错误))\b/.test(t)) return 'video_not_loading';
    if (/\b(video|内容|content|创作|post|发帖|发布)\b/.test(t) && !/\bnot\s*(load|generat|creat)\b/.test(t)) return 'content_request';
    if (/\b(gmv|sales|订单|销售|收入|earnings)\b/.test(t)) return 'gmv_inquiry';
    if (/\b(payment|paypal|付款|收款|转账|汇款|转账|没收到|没到账)\b/.test(t)) return 'payment_issue';
    if (/\b(violation|appeal|申诉|违规|flagged|strike|封号|banned|suspended)\b/.test(t)) return 'violation_appeal';
    if (wacrm?.beta_status ***REMOVED***= 'introduced' && messageCount > 3) return 'follow_up';
    return messageCount <= 1 ? 'first_contact' : 'follow_up';
}

// 相似度计算（Word-level Jaccard similarity）
export function computeSimilarity(text1, text2) {
    if (!text1 || !text2) return 0;
    const s1 = text1.trim(), s2 = text2.trim();
    if (s1 ***REMOVED***= s2) return 100;
    const words1 = new Set(s1.toLowerCase().split(/[\s,.!?;:，。！？；：]+/).filter(w => w.length > 0));
    const words2 = new Set(s2.toLowerCase().split(/[\s,.!?;:，。！？；：]+/).filter(w => w.length > 0));
    if (words1.size ***REMOVED***= 0 && words2.size ***REMOVED***= 0) return 100;
    if (words1.size ***REMOVED***= 0 || words2.size ***REMOVED***= 0) return 0;
    const intersection = new Set([...words1].filter(w => words2.has(w)));
    const union = new Set([...words1, ...words2]);
    return Math.round((intersection.size / union.size) * 100);
}

// 构建丰富的 context 对象
export function buildRichContext({ incomingMsg, client, creator, policyDocs, clientMemory, messages }) {
    const msgs = messages || [];
    const lastMsg = msgs.length > 0 ? msgs[msgs.length - 1] : null;
    const lastTimestampMs = lastMsg?.timestamp
        ? (lastMsg.timestamp > 1e12 ? lastMsg.timestamp : lastMsg.timestamp * 1000)
        : null;
    const daysSinceLast = lastMsg
        ? Math.floor((Date.now() - lastTimestampMs) / 86400000)
        : null;
    const now = new Date();
    const tone = detectClientTone(msgs);
    const lang = detectLanguage(incomingMsg?.text || '');
    const wacrm = creator?.wacrm || client?.wacrm || {};
    const scene = inferScene(incomingMsg?.text || '', wacrm, msgs.length);

    const policyTags = (policyDocs || [])
        .filter(p => (p.applicable_scenarios || []).includes(scene))
        .map(p => p.policy_key);

    const memorySummary = {};
    for (const m of (clientMemory || [])) {
        if (!memorySummary[m.memory_type]) memorySummary[m.memory_type] = {};
        memorySummary[m.memory_type][m.memory_key] = m.memory_value;
    }

    return {
        client_id: client.phone,
        client_name: client.name,
        wa_owner: client.wa_owner,
        keeper_username: wacrm?.keeper_username || creator?.keeper_username || null,
        beta_status: wacrm?.beta_status || 'unknown',
        priority: wacrm?.priority || 'normal',
        agency_bound: !!wacrm?.agency_bound,
        next_action: wacrm?.next_action || null,
        conversion_stage: client.conversion_stage || 'unknown',
        days_since_last_msg: daysSinceLast,
        total_messages: msgs.length,
        input_text: incomingMsg?.text || '',
        scene,
        hour_of_day: now.getHours(),
        day_of_week: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][now.getDay()],
        language: lang,
        client_tone: tone,
        memory_summary: Object.keys(memorySummary).length > 0 ? memorySummary : null,
        policy_tags: policyTags.length > 0 ? policyTags : null,
    };
}

// 构建 conversation 格式（用于 API 调用）
export function buildConversation(messages) {
    return {
        messages: (messages || []).slice(-20).map(m => ({
            role: m.role ***REMOVED***= 'me' ? 'me' : 'user',
            text: m.text,
            timestamp: m.timestamp ?? null,
        })),
    };
}
