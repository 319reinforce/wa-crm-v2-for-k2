import React, { useState, useEffect, useRef, useCallback } from 'react';
import { generateCandidateResponses } from '../utils/minimax';
import EmojiPicker from 'emoji-picker-react';
import AIReplyPicker from './AIReplyPicker';

const API_BASE = '/api';

// 推断消息语言（简单关键词检测）
function detectLanguage(text) {
  if (!text) return 'en';
  const zhRegex = /[\u4e00-\u9fff]/;
  if (zhRegex.test(text)) return 'zh';
  return 'en';
}

// 推断客户语气（基于消息特征）
function detectClientTone(messages) {
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
// 优先级：更具体的场景优先匹配（排序即优先级）
function inferScene(text, wacrm, messageCount = 0) {
  const t = (text || '').toLowerCase();
  // 中英双语触发词
  if (/\b(trial|7[\s-]?day|7day|free\s*try|试用)\b/.test(t)) return 'trial_intro';
  if (/\b(monthly|month|membership|月费|包月)\b/.test(t)) return 'monthly_inquiry';
  if (/\b(commission|分成|提成|revenue|佣金|收入)\b/.test(t)) return 'commission_query';
  // mcn_binding 同时匹配 agency/经纪/绑定等词
  if (/\b(mcn|agency|经纪|代理|绑定|contract|签约)\b/.test(t)) return 'mcn_binding';
  // video 问题（生成失败/加载慢/质量差）
  if (/\b(video\s*(not|doesn'?t|can'?t|didn)?t?\s*(load|generat|creat|show|appear)|视频\s*(生成|加载|显示|出现)?(不了|失败|慢|卡)|内容\s*(不符|不对|错误))\b/.test(t)) return 'video_not_loading';
  // content_request（请求内容/创作相关）
  if (/\b(video|内容|content|创作|post|发帖|发布)\b/.test(t) && !/\bnot\s*(load|generat|creat)\b/.test(t)) return 'content_request';
  // gmv 询问
  if (/\b(gmv|sales|订单|销售|收入|earnings)\b/.test(t)) return 'gmv_inquiry';
  // 付款/收款问题
  if (/\b(payment|paypal|付款|收款|转账|汇款|转账|没收到|没到账)\b/.test(t)) return 'payment_issue';
  // 违规/申诉
  if (/\b(violation|appeal|申诉|违规|flagged|strike|封号|banned|suspended)\b/.test(t)) return 'violation_appeal';
  // follow_up: beta已引入 且 有过对话
  if (wacrm?.beta_status ***REMOVED***= 'introduced' && messageCount > 3) return 'follow_up';
  // first_contact: 新客户或对话很少
  return messageCount <= 1 ? 'first_contact' : 'follow_up';
}

// 构建丰富的 context 对象
function buildRichContext({ incomingMsg, client, creator, policyDocs, clientMemory, messages }) {
  const msgs = messages || [];
  const lastMsg = msgs.length > 0 ? msgs[msgs.length - 1] : null;
  const daysSinceLast = lastMsg
    ? Math.floor((Date.now() - lastMsg.timestamp) / 86400000)
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

const WA = {
  darkHeader: '#111b21',
  teal: '#00a884',
  tealDark: '#008069',
  lightBg: '#f0f2f5',
  chatBg: '#efeae2',
  white: '#ffffff',
  searchBg: '#f0f2f5',
  borderLight: '#e9edef',
  bubbleOut: '#d9fdd3',
  bubbleIn: '#ffffff',
  textDark: '#111b21',
  textMuted: '#667781',
  hover: '#f5f6f6',
  darkHover: '#202c33',
  darkBg: '#111b21',
  darkCard: '#1f2c33',
  inputBg: '#f0f2f5',
}

// 相似度计算（Word-level Jaccard similarity）
function computeSimilarity(text1, text2) {
  if (!text1 || !text2) return 0;
  const s1 = text1.trim(), s2 = text2.trim();
  if (s1 ***REMOVED***= s2) return 100;
  // 分词：按空格/标点拆分为单词集合
  const words1 = new Set(s1.toLowerCase().split(/[\s,.!?;:，。！？；：]+/).filter(w => w.length > 0));
  const words2 = new Set(s2.toLowerCase().split(/[\s,.!?;:，。！？；：]+/).filter(w => w.length > 0));
  if (words1.size ***REMOVED***= 0 && words2.size ***REMOVED***= 0) return 100;
  if (words1.size ***REMOVED***= 0 || words2.size ***REMOVED***= 0) return 0;
  // Jaccard: |intersection| / |union|
  const intersection = new Set([...words1].filter(w => words2.has(w)));
  const union = new Set([...words1, ...words2]);
  return Math.round((intersection.size / union.size) * 100);
}

export function WAMessageComposer({ client, creator, onClose, onSwipeLeft, asPanel }) {
    const [inputText, setInputText] = useState('');
    const [generating, setGenerating] = useState(false);
    const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);
    const [translating, setTranslating] = useState(false);
    // 翻译进度：null = 未翻译, 'n/t' = 翻译中, true = 完成
    const [translateProgress, setTranslateProgress] = useState(null);
    // 翻译 map：key = timestamp，value = 中文翻译
    const [translationMap, setTranslationMap] = useState({});

    // 当前活跃的 AI 候选
    const [activePicker, setActivePicker] = useState(null);
    const [pickerCustom, setPickerCustom] = useState('');
    const [pickerLoading, setPickerLoading] = useState(false);
    const [pickerError, setPickerError] = useState(null);

    // 待审核队列
    const [pendingCandidates, setPendingCandidates] = useState([]);

    // 移动端标签 bar 显示状态
    const [tagsVisible, setTagsVisible] = useState(true);

    // 话题下拉菜单
    const [topicDropdownOpen, setTopicDropdownOpen] = useState(false);

    // 当前话题状态
    const [currentTopic, setCurrentTopic] = useState(null); // { topic_key, trigger, detected_at, keywords }

    // 自动检测到的话题（每次 messages 变化时刷新）
    const [autoDetectedTopic, setAutoDetectedTopic] = useState(null); // { topic_key, label, confidence }

    // 键盘弹出时 visualViewport 偏移量
    const [viewportOffset, setViewportOffset] = useState(0);

    // 移动端左划手势
    const touchStartX = useRef(null);
    const handleTouchStart = (e) => {
        touchStartX.current = e.touches[0].clientX;
    };
    const handleTouchEnd = (e) => {
        if (touchStartX.current ***REMOVED***= null) return;
        const deltaX = e.changedTouches[0].clientX - touchStartX.current;
        if (deltaX < -50) {
            onSwipeLeft?.();
        }
        touchStartX.current = null;
    };

    // 消息历史（从 API 轮询更新）
    const [messages, setMessages] = useState(client?.messages || []);

    // 政策文档和客户记忆（预加载）
    const [policyDocs, setPolicyDocs] = useState([]);
    const [clientMemory, setClientMemory] = useState([]);
    // 活跃事件数据（用于 inferAutoTopic 置信度加权 + Prompt 注入）
    const [activeEvents, setActiveEvents] = useState([]);

    const pollingRef = useRef(null);
    const chatScrollRef = useRef(null);
    const inputRef = useRef(null);

    // 滚动到底部
    const scrollToBottom = useCallback(() => {
        if (chatScrollRef.current) {
            chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
        }
    }, []);

    // ***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED***
    // 事件推进 Prompt 生成
    // ***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED***

    // 事件阶段判断
    function getEventPhase(startAt, endAt, policy) {
        if (!startAt) return 'unknown';
        const start = new Date(startAt).getTime();
        const end = endAt ? new Date(endAt).getTime() : start + 7 * 24 * 3600 * 1000;
        const now = Date.now();
        const total = end - start;
        const elapsed = now - start;
        const daysLeft = Math.ceil((end - now) / (24 * 3600 * 1000));

        if (elapsed < total * 0.3) return 'phase1';   // 前30%: 刚加入
        if (daysLeft <= 3) return 'phase3';              // 剩余≤3天: 即将结束
        return 'phase2';                                // 进行中
    }

    // 根据事件类型和阶段生成推进指令
    function buildEventPushText(event, policy, phase) {
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

    // 构建事件推进段落（用于 system prompt 的末尾）
    function buildEventPushSection(activeEvents, owner) {
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

            // 解析 meta
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

    // 构建 System Prompt（双模式：同一话题 vs 新话题）
    // mode: 'same_topic'（manual/auto）| 'new_topic'（keyword/time）
    const buildSystemPrompt = ({ mode = 'new_topic', activeEvents }) => {
        const clientName = client?.name || creator?.primary_name || '未知';
        const owner = client?.wa_owner || creator?.wa_owner || '未知';
        const stage = client?.conversion_stage || creator?._full?.wacrm?.beta_status || '未知';

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

        // ***REMOVED***= 同一话题模式（manual/auto）：推进为主 ***REMOVED***=
        // 客户已在对话中，表达明确意图 → 回答问题 + 推进事件进展
        if (mode ***REMOVED***= 'same_topic') {
            return `${base}
${replyStyle}
${pushSection}
【同一话题回复要求】
- 客户已在当前话题中，先直接回答其问题
- 在回复末尾加一句推进语句（从上方【当前进行中事件】中找对应的"推进提示"）
- 若达人有明确意向（好的/OK/知道了），优先回答后再适当推进
- 回复不超过 100 字，只输出发送给客户的文字，不要分析或解释`;
        }

        // ***REMOVED***= 新话题模式（keyword/time）：理解 + 回答为主 ***REMOVED***=
        // 客户刚开启新话题 → 先友好理解 + 针对性回答 + 必要时介绍支持
        return `${base}
${replyStyle}
【新话题回复要求】
- 先友好回应客户的疑问或需求
- 针对性回答问题，不要泛泛而谈
- 若涉及试用/月卡/推荐等，可适当介绍支持和激励政策
- 不要主动延伸话题，问什么答什么
- 回复不超过 100 字，只输出发送给客户的文字，不要分析或解释`;
    };

    // ***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED***
    // 话题检测与上下文构建
    // ***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED***

    // 从消息文本推断话题类型
    function inferTopicKey(text) {
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
    function extractKeywords(text) {
        if (!text) return new Set();
        return new Set(
            text.toLowerCase()
                .split(/[\s,.!?;:，。！？；：]+/)
                .filter(w => w.length > 2)
        );
    }

    // 计算两个关键词集合的Jaccard相似度
    function computeJaccardSimilarity(set1, set2) {
        if (set1.size ***REMOVED***= 0 && set2.size ***REMOVED***= 0) return 1;
        if (set1.size ***REMOVED***= 0 || set2.size ***REMOVED***= 0) return 0;
        const intersection = new Set([...set1].filter(w => set2.has(w)));
        const union = new Set([...set1, ...set2]);
        return intersection.size / union.size;
    }

    // 话题标签中文映射
    const TOPIC_LABELS = {
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
    };

    // 基于 EVENT_SYSTEM.md 关键词 + 最新20条消息 + 活跃事件 → 自动推断话题
    function inferAutoTopic({ messages, activeEvents }) {
        const recentTexts = (messages || []).slice(-20).map(m => m.text || '').join(' ');
        const lowerText = recentTexts.toLowerCase();

        // 事件语义关键词（来自 EVENT_SYSTEM.md）
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

        // 活跃事件加权（事件存在说明这个话题正在进行中，加3分）
        for (const evt of (activeEvents || [])) {
            const key = evt.event_key; // e.g. 'trial_7day', 'monthly_challenge', 'referral'
            // 映射 event_key → topic_key
            const keyMap = {
                trial_7day: 'trial_intro',
                monthly_challenge: 'monthly_inquiry',
                agency_bound: 'mcn_binding',
                gmv_milestone: 'gmv_inquiry',
                referral: 'referral',
            };
            const mapped = keyMap[key] || key;
            if (scores[mapped] !***REMOVED*** undefined) scores[mapped] += 3;
        }

        // 找最高分
        const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);
        const [topKey, topScore] = sorted[0] || [null, 0];

        // 低于1分的默认为 general
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
    function shouldSwitchTopic({ currentTopic, newText, messages, lastMsgTimestamp }) {
        const newKeywords = extractKeywords(newText);

        // 触发A：48小时无互动
        const HOUR48 = 48 * 3600 * 1000;
        if (lastMsgTimestamp && (Date.now() - lastMsgTimestamp) > HOUR48) {
            return { shouldSwitch: true, trigger: 'time', reason: '超过48小时无互动' };
        }

        // 触发B：关键词Jaccard相似度 < 0.3（话题明显变化）
        if (currentTopic?.keywords && newKeywords.size > 0) {
            const similarity = computeJaccardSimilarity(currentTopic.keywords, newKeywords);
            if (similarity < 0.3) {
                return { shouldSwitch: true, trigger: 'keyword', reason: `关键词变化（相似度${Math.round(similarity*100)}%）` };
            }
        }

        // 触发C：话题类型本身发生了变化
        if (currentTopic?.topic_key) {
            const prevKey = currentTopic.topic_key;
            const newKey = inferTopicKey(newText);
            if (prevKey !***REMOVED*** newKey && newKey !***REMOVED*** 'general') {
                return { shouldSwitch: true, trigger: 'keyword', reason: `话题从${TOPIC_LABELS[prevKey]||prevKey}切换到${TOPIC_LABELS[newKey]||newKey}` };
            }
        }

        return { shouldSwitch: false };
    }

    // 构建话题上下文段落（注入System Prompt）
    function buildTopicContext({ topic, creator, activeEvents, mode = 'new_topic' }) {
        const wacrm = creator?._full?.wacrm || {};
        const owner = creator?.wa_owner || '未知';
        const stage = wacrm.beta_status || '未知';

        const topicLabel = TOPIC_LABELS[topic?.topic_key] || TOPIC_LABELS.general;
        const triggerLabel = { manual: '运营手动标记', time: '48小时无互动', keyword: '关键词变化', auto: '自动检测', new: '新对话' }[topic?.trigger] || '新对话';

        // 事件阶段压缩
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

    // 把废弃的 richCtx 注入为结构化段落
    function buildConversationSummary(messages) {
        if (!messages || messages.length <= 10) return null;
        const older = messages.slice(0, -10); // 最早的部分
        const recentCount = messages.length - older.length;
        const lines = older.map(m => {
            // allMsgs 的 role: 'me'（运营发出）| 'user'（达人发出）
            const role = m.role ***REMOVED***= 'me' ? '运营' : '达人';
            const text = (m.text || '').slice(0, 80);
            return `[${role}]: ${text}`;
        });
        return {
            summary: `【更早对话摘要（共${older.length}条）】\n${lines.join('\n')}`,
            recentCount,
        };
    }

    function buildRichContextParagraph(richCtx) {
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

        return `【当前对话上下文】
- 场景: ${sceneLabel}
- 客户语气: ${toneLabel} | 语言: ${langLabel} | 总消息: ${total_messages}条 | 上次互动: ${timeHint}
- 时间: 周${day_of_week}${hour_of_day >= 9 && hour_of_day <= 21 ? '（工作时间）' : '（非工作时间）'}${memoryBlock}${policyBlock}`;
    }

    // 开启新话题
    function startNewTopic({ trigger = 'new', newText, messages }) {
        const keywords = extractKeywords(newText);
        const topic_key = inferTopicKey(newText);
        return {
            topic_key,
            trigger,
            detected_at: Date.now(),
            keywords,
        };
    }

    const buildConversation = (messages) => ({
        messages: (messages || []).slice(-20).map(m => ({
            role: m.role ***REMOVED***= 'me' ? 'me' : 'user',
            text: m.text
        }))
    });

    // 通过 Experience Router 生成候选回复
    const generateViaExperienceRouter = async ({ conversation, scene, client_id, forcedInput, richCtx }) => {
        const allMsgs = conversation.messages;
        const lastIncomingText = [...allMsgs].reverse().find(m => m.role ***REMOVED***= 'user')?.text || '';
        const lastMsgTimestamp = allMsgs.length > 0 ? allMsgs[allMsgs.length - 1].timestamp : null;

        // 尝试获取该达人的 active 事件
        let activeEvents = [];
        try {
            const creatorId = client?.id || creator?.id;
            if (creatorId) {
                const res = await fetch(`/api/events/summary/${creatorId}`);
                if (res.ok) {
                    const data = await res.json();
                    activeEvents = (data.events || []).filter(e => e.status ***REMOVED***= 'active');
                }
            }
        } catch (_) {}

        // ***REMOVED***= 话题检测：判断是否需要开启新话题 ***REMOVED***=
        let effectiveTopic = currentTopic;
        // 方案B（保守）：无手动话题时，用自动检测结果作为 fallback
        if (!effectiveTopic && autoDetectedTopic) {
            effectiveTopic = { ...autoDetectedTopic, trigger: 'auto' };
        }
        if (lastIncomingText) {
            const switchDecision = shouldSwitchTopic({
                currentTopic: effectiveTopic,
                newText: lastIncomingText,
                messages: allMsgs,
                lastMsgTimestamp,
            });
            if (switchDecision.shouldSwitch) {
                effectiveTopic = startNewTopic({
                    trigger: switchDecision.trigger,
                    newText: lastIncomingText,
                    messages: allMsgs,
                });
                // 异步更新话题状态（不阻塞生成）
                setCurrentTopic(effectiveTopic);
            }
        }

        // 构建 system prompt（含话题上下文 + 丰富上下文 + 双模式）
        // 方向三：差异化 Prompt — 同一话题用简短版，新话题用完整版
        const isSameTopic = effectiveTopic && ['manual', 'auto'].includes(effectiveTopic.trigger);
        const topicContext = effectiveTopic
            ? buildTopicContext({ topic: effectiveTopic, creator, activeEvents, mode: isSameTopic ? 'same_topic' : 'new_topic' })
            : '';
        const richContextParagraph = buildRichContextParagraph(richCtx);

        // 方向二：最近优先机制
        // - 同一话题（manual/auto）：最近10条直接传，更早消息摘要注入Prompt
        // - 新话题（keyword/time）：全部消息，不做摘要
        const convSummary = isSameTopic ? buildConversationSummary(allMsgs) : null;

        // 对话消息：按场景截取
        const msgsToUse = convSummary ? allMsgs.slice(-convSummary.recentCount) : allMsgs;
        const conversationMsgs = msgsToUse.map(m => ({
            role: m.role ***REMOVED***= 'me' ? 'assistant' : 'user',
            content: m.text,
        }));
        if (forcedInput) {
            conversationMsgs.push({ role: 'user', content: forcedInput });
        } else if (conversationMsgs.length > 0 && conversationMsgs[conversationMsgs.length - 1].role ***REMOVED***= 'assistant') {
            conversationMsgs.push({ role: 'user', content: '[请回复这位达人]' });
        }

        // 通过后端 /api/ai/system-prompt 构建完整 system prompt（与 sft-export 对齐）
        // 前端提供：topicContext + richContext + conversationSummary + operator + scene
        // 后端补充：operator experience、client_memory、policy_documents、REPLY_STYLE
        const { prompt: systemPrompt } = await fetch(`${API_BASE}/ai/system-prompt`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                client_id,
                scene: richCtx?.scene || 'unknown',
                topicContext,
                richContext: richContextParagraph,
                conversationSummary: convSummary ? convSummary.summary : '',
            }),
            signal: AbortSignal.timeout(30000),
        }).then(r => r.json());

        // 将 system prompt 注入消息列表
        const allMessages = [
            { role: 'system', content: systemPrompt },
            ...conversationMsgs,
        ];

        // 调用 /api/minimax 生成候选
        const res = await fetch(`${API_BASE}/minimax`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                messages: allMessages,
                client_id,
                max_tokens: 500,
                temperature: [0.8, 0.4],
            }),
            signal: AbortSignal.timeout(60000),
        });
        const data = await res.json();
        console.log('[generateViaExperienceRouter] raw data:', JSON.stringify(data).slice(0, 200));

        // 检查 API 错误
        if (!res.ok || data.error) {
            const msg = data.error || `HTTP ${res.status}`;
            console.error('[generateViaExperienceRouter] API error:', msg);
            throw new Error(msg);
        }

        // 提取 opt1 / opt2（统一从 content / content_opt2 拿）
        // MiniMax/OpenAI 均返回: { content: [{type:"text", text:opt1}], content_opt2: [{type:"text", text:opt2}] }
        const extractText = (d) => {
            if (!d || !Array.isArray(d.content)) return '';
            return d.content.find(c => c.type ***REMOVED***= 'text')?.text || '';
        };
        const extractOpt2 = (d) => {
            if (!d || !Array.isArray(d.content_opt2)) return '';
            return d.content_opt2.find(c => c.type ***REMOVED***= 'text')?.text || '';
        };
        const opt1 = extractText(data);
        const opt2 = extractOpt2(data);
        if (!opt1 && !opt2) {
            throw new Error('AI 返回空候选，请重试');
        }
        return { opt1, opt2 };
    };

    const fetchPolicyDocs = async () => {
        try {
            const r = await fetch(`${API_BASE}/policy-documents?active_only=true`);
            if (r.ok) return await r.json();
        } catch (_) {}
        return [];
    };

    // 追踪最近一次互动时间（用于48小时话题切换）
    const lastActivityRef = useRef(null);

    // pendingCandidates ref：避免 cleanup 时的 stale closure 问题
    const pendingCandidatesRef = useRef(pendingCandidates);
    // 同步更新 ref（setState 之后）
    pendingCandidatesRef.current = pendingCandidates;

    // generationRaceRef：防止切换达人后旧的生成结果覆盖新的
    const generationRaceRef = useRef(0);

    // 预加载政策文档和客户记忆，LOAD 完成后触发 AI 生成
    useEffect(() => {
        if (!client?.id || !client?.phone) return;

        // 清除旧状态
        setActivePicker(null);
        setPendingCandidates([]);
        setMessages([]);
        setCurrentTopic(null);
        setAutoDetectedTopic(null);
        pendingCandidatesRef.current = [];
        lastActivityRef.current = null;

        // 每个新达人都+1，这样旧达人的异步生成结果会被忽略
        const currentRace = ++generationRaceRef.current;
        let cancelled = false;

        const load = async () => {
            const creatorId = client?.id;
            const [docs, mem, evtData] = await Promise.all([
                fetchPolicyDocs(),
                fetch(`${API_BASE}/client-memory/${client.phone}`)
                    .then(r => r.ok ? r.json() : [])
                    .catch(() => []),
                creatorId
                    ? fetch(`${API_BASE}/events/summary/${creatorId}`)
                        .then(r => r.ok ? r.json() : { events: [] })
                        .catch(() => ({ events: [] }))
                    : Promise.resolve({ events: [] }),
            ]);
            // 检查：期间是否切换过达人？
            if (cancelled || currentRace !***REMOVED*** generationRaceRef.current) return;
            setPolicyDocs(docs);
            setClientMemory(mem || []);
            setActiveEvents((evtData.events || []).filter(e => e.status ***REMOVED***= 'active'));

            // 等 policyDocs 加载后再生成
            try {
                const res = await fetch(`${API_BASE}/creators/${client.id}/messages`);
                if (cancelled || currentRace !***REMOVED*** generationRaceRef.current || !res.ok) return;
                const data = await res.json();
                const msgs = Array.isArray(data) ? data : (data.messages || []);
                if (cancelled || currentRace !***REMOVED*** generationRaceRef.current || msgs.length ***REMOVED***= 0) return;
                const lastMsg = msgs[msgs.length - 1];
                const result = await generateForIncoming(lastMsg);
                if (result && currentRace ***REMOVED***= generationRaceRef.current) {
                    pushPicker(result);
                }
            } catch (e) {
                console.error('[generateOnSwitch] error:', e);
            }
        };
        load();

        return () => {
            cancelled = true;
        };
    }, [client?.phone]);

    // 为一条 incoming 消息生成候选
    const generateForIncoming = async (incomingMsg) => {
        if (!client?.id || !client?.phone) return null;
        setPickerLoading(true);
        setPickerError(null);
        try {
            // 重新 fetch 最新消息，避免闭包 stale 问题
            const msgsRes = await fetch(`${API_BASE}/creators/${client.id}/messages`);
            if (!msgsRes.ok) return null;
            const msgsData = await msgsRes.json();
            const msgs = Array.isArray(msgsData) ? msgsData : (msgsData.messages || []);
            const conversation = buildConversation(msgs);
            // 只有真实的 user 消息才追加；me 消息已在 buildConversation 中作为 assistant 包含
            if (incomingMsg.role ***REMOVED***= 'user') {
                conversation.messages.push({ role: 'user', text: incomingMsg.text });
            }

            const richCtx = buildRichContext({ incomingMsg, client, creator, policyDocs, clientMemory, messages: msgs });

            const result = await generateViaExperienceRouter({
                conversation,
                scene: richCtx.scene,
                client_id: client.phone,
                richCtx,
            });
            console.log('[generateForIncoming] result candidates:', result ? JSON.stringify({opt1: result.opt1?.slice(0,50), opt2: result.opt2?.slice(0,50)}) : 'NULL');

            return {
                incomingMsg,
                candidates: result,
                generated_at: Date.now(),
                policyDocs,
            };
        } catch (e) {
            console.error('[generateForIncoming] error:', e);
            setPickerError(e.message || '生成失败，请重试');
            return null;
        } finally {
            setPickerLoading(false);
        }
    };

    // 弹出候选 picker（处理新候选）
    const pushPicker = useCallback((result) => {
        console.log('[pushPicker] called with result:', result ? 'OK' : 'NULL');
        if (!result) return;
        setActivePicker(prev => {
            console.log('[pushPicker] setActivePicker callback, prev:', prev ? 'exists' : 'null');
            if (prev) {
                setPendingCandidates(p => [...p, result]);
                return prev;
            }
            return result;
        });
    }, []);

    // 每5分钟检查一次48小时无互动（即使没有新消息）
    useEffect(() => {
        const check48h = () => {
            if (!client?.id || !lastActivityRef.current) return;
            const gap = Date.now() - lastActivityRef.current;
            const HOUR48 = 48 * 3600 * 1000;
            if (gap > HOUR48) {
                console.log('[48h check] 无互动超过48小时，开启新话题');
                const newTopic = startNewTopic({ trigger: 'time', newText: '', messages: [] });
                setCurrentTopic(newTopic);
                lastActivityRef.current = Date.now();
            }
        };
        const interval = setInterval(check48h, 5 * 60 * 1000);
        return () => clearInterval(interval);
    }, [client?.id]);

    // 轮询新消息
    const checkNewMessages = useCallback(async () => {
        if (!client?.id) {
            console.log('[checkNewMessages] early return: no client.id');
            return;
        }

        try {
            const url = `${API_BASE}/creators/${client.id}/messages`;
            console.log('[checkNewMessages] fetching:', url);
            const res = await fetch(url);
            console.log('[checkNewMessages] status:', res.status);
            if (!res.ok) return;
            const data = await res.json();
            const msgs = Array.isArray(data) ? data : (data.messages || []);
            console.log('[checkNewMessages] msgs count:', msgs?.length);
            if (!msgs || msgs.length ***REMOVED***= 0) return;

            // 更新消息历史（用于渲染）
            setMessages(msgs);

            // 重置48小时计时器（有新消息到达）
            if (msgs.length > 0) {
                lastActivityRef.current = Date.now();
            }

            // 找最新一条 incoming 消息（role ***REMOVED***= 'user'）
            const incomingMsgs = msgs.filter(m => m.role ***REMOVED***= 'user');
            const latestMsg = incomingMsgs[incomingMsgs.length - 1];
            console.log('[checkNewMessages] latestMsg role:', latestMsg?.role, 'text:', latestMsg?.text?.slice(0, 50));
            if (!latestMsg) return;

            // 使用 ref 避免 stale closure（pendingCandidates 在 cleanup 时可能还未 flush）
            const currentPending = pendingCandidatesRef.current;
            const alreadyQueued = (activePicker?.incomingMsg?.timestamp ***REMOVED***= latestMsg.timestamp) ||
                currentPending.some(p => p.incomingMsg.timestamp ***REMOVED***= latestMsg.timestamp);
            console.log('[checkNewMessages] alreadyQueued:', alreadyQueued);
            if (alreadyQueued) return;

            // 如果已有待回复的 picker，不再自动生成新候选（等用户处理完当前候选再说）
            if (activePicker) {
                console.log('[checkNewMessages] activePicker exists, skipping auto-generate');
                return;
            }

            const result = await generateForIncoming(latestMsg);
            console.log('[checkNewMessages] generateForIncoming result:', result ? 'OK' : 'NULL');
            if (result) {
                console.log('[checkNewMessages] calling pushPicker, candidates:', result.candidates);
                pushPicker(result);
            }
        } catch (e) {
            console.error('[checkNewMessages] error:', e);
        }
    }, [client?.id, activePicker, pushPicker]);

    useEffect(() => {
        // 启动轮询前，初始化 lastActivityRef（用当前消息的最新时间戳）
        if (!lastActivityRef.current && messages.length > 0) {
            const latestTs = Math.max(...messages.map(m => m.timestamp || 0));
            if (latestTs > 0) lastActivityRef.current = latestTs;
        }
        pollingRef.current = setInterval(checkNewMessages, 5000);
        // 启动时立即检查一次
        checkNewMessages();
        return () => clearInterval(pollingRef.current);
    }, [client?.id, checkNewMessages]);

    // 自动话题检测：messages 变化时重新推断（仅在无手动话题时更新显示）
    useEffect(() => {
        if (messages.length ***REMOVED***= 0) return;
        const detected = inferAutoTopic({ messages, activeEvents });
        setAutoDetectedTopic(detected);
    }, [messages, activeEvents]);

    // 从对话中提取并保存客户偏好
    const extractAndSaveMemory = async (incomingMsg, sentText) => {
        if (!client?.phone) return;
        const texts = [incomingMsg?.text || '', sentText || ''].join(' ').toLowerCase();

        const extractions = [];

        // preference 类型
        if (/\b(prefer|更喜欢|比较喜欢|like\s+(?:video|text|voice|audio))\b/.test(texts)) {
            if (/\bvideo\b/.test(texts)) extractions.push({ memory_type: 'preference', memory_key: 'format', memory_value: 'video' });
            if (/\btext\b/.test(texts)) extractions.push({ memory_type: 'preference', memory_key: 'format', memory_value: 'text' });
            if (/\b(voice|audio|call)\b/.test(texts)) extractions.push({ memory_type: 'preference', memory_key: 'format', memory_value: 'voice' });
        }
        if (/\b(don't like|不喜欢|prefer not|不想)\b/.test(texts)) {
            extractions.push({ memory_type: 'preference', memory_key: 'dislike', memory_value: 'inquiry' });
        }

        // style 类型
        if (/\b(please|would|could|kindly)\b/.test(texts)) {
            extractions.push({ memory_type: 'style', memory_key: 'tone', memory_value: 'formal' });
        }
        if (/\b(hey|great|awesome|cool|yeah|thanks?)\b/.test(texts)) {
            extractions.push({ memory_type: 'style', memory_key: 'tone', memory_value: 'casual' });
        }

        // decision 类型
        if (/\b(decide[sd]?|chose|going with|选择了|决定)\b/.test(texts)) {
            extractions.push({ memory_type: 'decision', memory_key: 'latest', memory_value: 'pending_review' });
        }

        // policy 类型
        if (/\b(policy|规则|不能|must not|cannot)\b/.test(texts)) {
            extractions.push({ memory_type: 'policy', memory_key: 'constraint', memory_value: 'mentioned' });
        }

        // 保存到 client_memory
        for (const mem of extractions) {
            try {
                await fetch(`${API_BASE}/client-memory`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ client_id: client.phone, ...mem })
                });
            } catch (_) {}
        }
    };

    // 插入 emoji 到 textarea 光标位置
    const handleEmojiClick = (emojiData) => {
        const emoji = emojiData.emoji;
        const textarea = inputRef.current;
        if (!textarea) {
            setInputText(prev => prev + emoji);
            return;
        }
        const { selectionStart, selectionEnd } = textarea;
        const before = inputText.slice(0, selectionStart);
        const after = inputText.slice(selectionEnd);
        const newText = before + emoji + after;
        setInputText(newText);
        // 光标移到 emoji 后
        setTimeout(() => {
            textarea.focus();
            const newPos = selectionStart + emoji.length;
            textarea.setSelectionRange(newPos, newPos);
        }, 0);
        setEmojiPickerOpen(false);
    };

    // 点了 bot 图标 → 强制为最新 incoming 消息重新生成候选
    const handleBotIconClick = async () => {
        // 重新 fetch 最新消息，避免切换达人后闭包 stale 问题
        const msgsRes = await fetch(`${API_BASE}/creators/${client.id}/messages`);
        const msgsData = msgsRes.ok ? (await msgsRes.json()) : [];
        const freshMsgs = Array.isArray(msgsData) ? msgsData : (msgsData.messages || []);

        const incomingMsgs = freshMsgs.filter(m => m.role ***REMOVED***= 'user');
        const latestMsg = incomingMsgs[incomingMsgs.length - 1];
        if (!latestMsg) return;

        setActivePicker(null);
        setPendingCandidates([]);
        setPickerCustom('');
        setPickerLoading(true);

        try {
            const conversation = buildConversation(freshMsgs);
            conversation.messages.push({ role: 'user', text: latestMsg.text });
            const richCtx = buildRichContext({ incomingMsg: latestMsg, client, creator, policyDocs, clientMemory, messages: freshMsgs });
            const result = await generateViaExperienceRouter({
                conversation,
                scene: richCtx.scene,
                client_id: client.phone,
                richCtx,
            });
            setActivePicker({ incomingMsg: latestMsg, candidates: result, generated_at: Date.now(), policyDocs });
        } catch (e) {
            console.error('[Regenerate] error:', e);
        } finally {
            setPickerLoading(false);
        }
    };

    // 翻译最近20条消息（一次批量请求），翻译结果显示在对应气泡下方
    const handleTranslate = async () => {
        const last20 = messages.slice(-20);
        if (last20.length ***REMOVED***= 0) return;
        // 如果已有翻译，先清除（切换时重新翻译）
        if (Object.keys(translationMap).length > 0) {
            setTranslationMap({});
            setTranslateProgress(null);
            return;
        }
        setTranslating(true);
        setTranslateProgress('0/' + last20.length);
        try {
            const response = await fetch(`${API_BASE}/translate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    texts: last20.map(m => ({ text: m.text, role: m.role }))
                }),
                signal: AbortSignal.timeout(30000),
            });
            const data = await response.json();
            const newMap = {};
            if (data.translations && Array.isArray(data.translations)) {
                for (const t of data.translations) {
                    const idx = t.idx - 1; // idx 是 1-based
                    if (idx >= 0 && idx < last20.length) {
                        newMap[last20[idx].timestamp] = t.translation || last20[idx].text;
                    }
                }
            }
            // 兜底：未翻译到的用原文
            for (const msg of last20) {
                if (!newMap[msg.timestamp]) {
                    newMap[msg.timestamp] = msg.text;
                }
            }
            setTranslationMap(newMap);
            setTranslateProgress(true);
        } catch (e) {
            console.error('[Translate] batch error:', e);
            setTranslationMap({});
            setTranslateProgress(null);
        } finally {
            setTranslating(false);
        }
    };

    // 重新生成（picker 内部的刷新按钮）
    const handleRegenerate = async () => {
        const incomingMsg = activePicker?.incomingMsg || (() => {
            const incomingMsgs = messages.filter(m => m.role ***REMOVED***= 'user');
            return incomingMsgs[incomingMsgs.length - 1];
        })();
        if (!incomingMsg) return;

        setPickerLoading(true);
        setPickerError(null);
        try {
            const conversation = buildConversation(messages);
            conversation.messages.push({ role: 'user', text: incomingMsg.text });
            const richCtx = buildRichContext({ incomingMsg, client, creator, policyDocs, clientMemory, messages });
            const result = await generateViaExperienceRouter({
                conversation,
                scene: richCtx.scene,
                client_id: client.phone,
                richCtx,
            });
            setActivePicker(prev => ({
                ...prev,
                incomingMsg,
                candidates: result,
                generated_at: Date.now(),
                policyDocs,
            }));
        } catch (e) {
            console.error('[Regenerate] error:', e);
            setPickerError(e.message || '生成失败，请重试');
        } finally {
            setPickerLoading(false);
        }
    };

    // 选择了候选 → 发送
    const handleSelectCandidate = async (selectedOpt) => {
        if (!activePicker) return;

        const sentText = selectedOpt ***REMOVED***= 'opt1'
            ? activePicker.candidates.opt1
            : selectedOpt ***REMOVED***= 'opt2'
                ? activePicker.candidates.opt2
                : pickerCustom.trim();

        if (!sentText) return;

        const sim1 = computeSimilarity(activePicker.candidates.opt1, sentText);
        const sim2 = computeSimilarity(activePicker.candidates.opt2, sentText);
        const bestSim = Math.max(sim1, sim2);
        const bestOpt = sim1 >= sim2 ? 'opt1' : 'opt2';

        const diffAnalysis = {
            model_predicted: bestSim >= 85 ? activePicker.candidates[bestOpt] : null,
            model_rejected: bestSim >= 85 ? activePicker.candidates[bestOpt ***REMOVED***= 'opt1' ? 'opt2' : 'opt1'] : null,
            is_custom: selectedOpt ***REMOVED***= 'custom' || bestSim < 85,
            human_reason: bestSim >= 85
                ? `直接采用方案${bestOpt ***REMOVED***= 'opt1' ? 'A' : 'B'}（相似度${bestSim}%）`
                : `人工编辑发送（与AI候选最高相似度${bestSim}%）`,
            similarity: bestSim
        };

        try {
            const richContext = buildRichContext({
                incomingMsg: activePicker.incomingMsg,
                client,
                creator,
                policyDocs: activePicker.policyDocs || policyDocs,
                clientMemory,
                messages,
            });

            await fetch(`${API_BASE}/sft-memory`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model_candidates: { opt1: activePicker.candidates.opt1, opt2: activePicker.candidates.opt2 },
                    human_selected: selectedOpt ***REMOVED***= 'custom' ? 'custom' : bestOpt,
                    human_output: sentText,
                    diff_analysis,
                    context: richContext,
                    messages,
                })
            });

            // 提取并保存客户偏好
            await extractAndSaveMemory(activePicker.incomingMsg, sentText);
        } catch (e) {
            console.error('SFT record failed:', e);
        }

        // 1. 通过 wabot API 发送真实 WhatsApp 消息（暂时禁用）
        // try {
        //     await fetch('http://127.0.0.1:3001/wa-send', {
        //         method: 'POST',
        //         headers: { 'Content-Type': 'application/json' },
        //         body: JSON.stringify({ phone: client.phone, text: sentText })
        //     });
        // } catch (e) {
        //     console.error('[WA Send] 发送失败:', e);
        // }

        // 2. 保存到 CRM SQLite（role=me 表示我发送）
        try {
            await fetch(`${API_BASE}/creators/${client.id}/messages`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    role: 'me',
                    text: sentText,
                    timestamp: Date.now()
                })
            });
        } catch (e) {
            console.error('[CRM DB] 保存失败:', e);
        }

        setPickerCustom('');
        const [next, ...rest] = pendingCandidates;
        setPendingCandidates(rest);
        setActivePicker(next || null);
        setInputText('');
    };

    // 跳过 — 记录 feedback
    const handleSkip = async () => {
        // 记录 skip feedback
        if (activePicker?.incomingMsg) {
            try {
                await fetch(`${API_BASE}/sft-feedback`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        client_id: client.phone,
                        feedback_type: 'skip',
                        input_text: activePicker.incomingMsg.text,
                        opt1: activePicker.candidates?.opt1,
                        opt2: activePicker.candidates?.opt2,
                        scene: activePicker.scene || 'unknown',
                        reject_reason: '运营跳过 AI 候选，未提供原因',
                    })
                });
            } catch (_) {}
        }
        setPickerCustom('');
        setPickerError(null);
        const [next, ...rest] = pendingCandidates;
        setPendingCandidates(rest);
        setActivePicker(next || null);
    };

    // 编辑候选 — 填充到输入框，关闭 picker
    const handleEditCandidate = (text) => {
        if (!text) return;
        setInputText(text);
        setActivePicker(null);
        setPendingCandidates([]);
        setPickerCustom('');
        setPickerError(null);
    };

    // 手动 AI 生成（输入框有文字时按 Enter 触发）
    const handleManualGenerate = async () => {
        if (!inputText.trim()) return;
        setGenerating(true);
        try {
            const conversation = buildConversation(messages);
            conversation.messages.push({ role: 'user', text: inputText });

            const richCtx = buildRichContext({ incomingMsg: { text: inputText }, client, creator, policyDocs, clientMemory, messages });

            const result = await generateViaExperienceRouter({
                conversation,
                scene: richCtx.scene,
                client_id: client.phone,
                richCtx,
            });

            setActivePicker({
                incomingMsg: { text: inputText, timestamp: Date.now() },
                candidates: result,
                generated_at: Date.now(),
                policyDocs,
            });
            setPickerCustom('');
        } catch (e) {
            console.error('生成失败:', e);
            alert(`生成失败: ${e.message}`);
        } finally {
            setGenerating(false);
        }
    };

    // 直接发送人工输入（不经过 AI 候选）
    const handleDirectSend = async (text) => {
        if (!text?.trim() || !client?.id) return;
        const sentText = text.trim();

        try {
            // 写入 SFT 记录（人工输入 custom）
            const richContext = buildRichContext({
                incomingMsg: null,
                client,
                creator,
                policyDocs,
                clientMemory,
                messages,
            });
            await fetch(`${API_BASE}/sft-memory`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model_candidates: { opt1: sentText, opt2: '' },
                    human_selected: 'custom',
                    human_output: sentText,
                    diff_analysis: { is_custom: true, human_reason: '人工直接发送', similarity: 100 },
                    context: richContext,
                    messages,
                })
            });
        } catch (e) {
            console.error('[SFT] record failed:', e);
        }

        // 提取客户偏好
        await extractAndSaveMemory(null, sentText);

        // 发送 WhatsApp 消息（根据达人负责人选择 operator 账号）
        let sendOk = false;
        try {
            const res = await fetch(`${API_BASE}/wa/send`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ phone: client.phone, text: sentText })
            });
            const data = await res.json();
            if (!data.ok) {
                console.error('[WA Send] 发送失败:', data.error);
                alert(`发送失败: ${data.error}`);
            } else {
                sendOk = true;
            }
        } catch (e) {
            console.error('[WA Send] 发送失败:', e);
            alert(`发送失败: ${e.message}`);
        }

        // 仅在发送成功时才写入 CRM（避免虚假"已发送"记录）
        if (sendOk) {
            try {
                await fetch(`${API_BASE}/creators/${client.id}/messages`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ role: 'me', text: sentText, timestamp: Date.now() })
                });
            } catch (e) {
                console.error('[CRM DB] 保存失败:', e);
            }
        }

        setInputText('');
    };

    // messages from state (updated by checkNewMessages polling)

    const formatTime = (ts) => {
        if (!ts) return '';
        const d = new Date(ts);
        return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
    };

    const formatDate = (ts) => {
        if (!ts) return '';
        const d = new Date(ts);
        return d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric', weekday: 'short' });
    };

    // 消息按日期分组 — 最新消息在底部（自然顺序）
    const groupedMessages = [];
    let lastDate = null;
    const msgsToShow = messages.slice(-50);
    for (const msg of msgsToShow) {
        const date = formatDate(msg.timestamp);
        if (date !***REMOVED*** lastDate) {
            groupedMessages.push({ type: 'date', date, id: 'date_' + date });
            lastDate = date;
        }
        groupedMessages.push({ ...msg, id: msg.timestamp });
    }

    // 初始滚动到底部
    useEffect(() => {
        scrollToBottom();
    }, [messages.length]);

    // 同步 textarea 高度（inputText 可能在 handleEditCandidate 中被程序化设置）
    useEffect(() => {
        if (inputRef.current) {
            inputRef.current.style.height = 'auto';
            inputRef.current.style.height = Math.min(inputRef.current.scrollHeight, 240) + 'px';
        }
    }, [inputText]);

    // 点击外部关闭 emoji picker（跳过打开按钮的那次点击）
    const emojiSkipCloseRef = useRef(false);
    useEffect(() => {
        if (!emojiPickerOpen) return;
        const handler = (e) => {
            if (emojiSkipCloseRef.current) {
                emojiSkipCloseRef.current = false;
                return;
            }
            if (!e.target.closest('.emoji-picker-wrapper')) {
                setEmojiPickerOpen(false);
            }
        };
        document.addEventListener('click', handler);
        return () => document.removeEventListener('click', handler);
    }, [emojiPickerOpen]);

    // 键盘弹出时通过 visualViewport 动态调整输入框位置
    useEffect(() => {
        if (typeof window ***REMOVED***= 'undefined' || !window.visualViewport) return;
        const handler = () => {
            const vp = window.visualViewport;
            // 当键盘弹出时，visualViewport.height < window.innerHeight，offset 为正
            const offset = Math.max(0, window.innerHeight - vp.height - vp.offsetTop);
            setViewportOffset(offset);
        };
        window.visualViewport.addEventListener('resize', handler);
        window.visualViewport.addEventListener('scroll', handler);
        return () => {
            window.visualViewport?.removeEventListener('resize', handler);
            window.visualViewport?.removeEventListener('scroll', handler);
        };
    }, []);

    return (
        <>
            <div className="flex flex-col h-full">

                {/* Desktop Header — hidden on mobile (mobile has its own top bar in App.jsx) */}
                <div className="hidden md:flex items-center gap-4 px-5 py-4" style={{ background: WA.darkHeader }}>
                    <button onClick={onClose} className="text-white/70 hover:text-white text-xl shrink-0">←</button>
                    <div className="w-11 h-11 rounded-full flex items-center justify-center text-white font-bold text-base shrink-0" style={{ background: WA.teal }}>
                        {(client.name || '?')[0]?.toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                        <div className="font-semibold text-base text-white">{client.name || client.phone}</div>
                        <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-xs text-white/50">
                                {client.conversion_stage || '未知阶段'} · {messages.length} 条消息
                            </span>
                            {/* 自动检测话题 — 右侧联系人信息区，显示在二级信息行 */}
                            {autoDetectedTopic && !currentTopic && (
                                <span
                                    className="text-xs px-2 py-0.5 rounded-full shrink-0"
                                    style={{
                                        background: autoDetectedTopic.confidence ***REMOVED***= 'high'
                                            ? 'rgba(16,185,129,0.2)'
                                            : autoDetectedTopic.confidence ***REMOVED***= 'medium'
                                                ? 'rgba(245,158,11,0.2)'
                                                : 'rgba(255,255,255,0.08)',
                                        color: autoDetectedTopic.confidence ***REMOVED***= 'high'
                                            ? '#6ee7b7'
                                            : autoDetectedTopic.confidence ***REMOVED***= 'medium'
                                                ? '#fcd34d'
                                                : 'rgba(255,255,255,0.45)',
                                    }}
                                    title={`自动检测 · 置信度: ${autoDetectedTopic.confidence} · 根据最新 ${Math.min(messages.length, 20)} 条消息`}
                                >
                                    🔍 {autoDetectedTopic.label}
                                </span>
                            )}
                            {/* 手动设置的话题（优先于自动检测显示） */}
                            {currentTopic && (
                                <span
                                    className="text-xs px-2 py-0.5 rounded-full shrink-0"
                                    style={{
                                        background: 'rgba(59,130,246,0.25)',
                                        color: '#93c5fd',
                                    }}
                                    title={`手动标记 · ${currentTopic.detected_at ? new Date(currentTopic.detected_at).toLocaleString('zh-CN') : ''}`}
                                >
                                    📌 {TOPIC_LABELS[currentTopic.topic_key] || '新话题'}
                                </span>
                            )}
                        </div>
                    </div>
                    {pendingCandidates.length > 0 && (
                        <span className="text-xs px-3 py-1 rounded-full font-bold shrink-0" style={{ background: 'rgba(245,158,11,0.2)', color: '#f59e0b' }}>
                            📋 {pendingCandidates.length} 条待处理
                        </span>
                    )}
                    <button
                        onClick={handleTranslate}
                        disabled={translating}
                        className="text-xs px-3 py-1 rounded-full font-medium shrink-0 transition-all disabled:opacity-50"
                        style={{
                            background: Object.keys(translationMap).length > 0 ? 'rgba(0,168,132,0.2)' : 'rgba(255,255,255,0.1)',
                            color: Object.keys(translationMap).length > 0 ? WA.teal : 'rgba(255,255,255,0.55)',
                        }}
                        title={Object.keys(translationMap).length > 0 ? '关闭翻译' : '翻译最近20条消息'}
                    >
                        {translating ? '⏳' : '🌐'} 翻译
                    </button>
                </div>

                {/* Mobile Header with Tags toggle — only shown when NOT used as panel in App.jsx */}
                {!asPanel && (
                    <>
                        <div className="flex md:hidden items-center gap-3 px-4 py-3" style={{ background: WA.darkHeader }}>
                            <button onClick={onClose} className="text-white/70 hover:text-white text-xl shrink-0">←</button>
                            <div className="w-9 h-9 rounded-full flex items-center justify-center text-white font-bold text-sm shrink-0" style={{ background: WA.teal }}>
                                {(client.name || '?')[0]?.toUpperCase()}
                            </div>
                            <div className="flex-1 min-w-0">
                                <div className="text-sm font-semibold text-white truncate">{client.name || client.phone}</div>
                                {/* 自动检测话题（移动端） */}
                                {autoDetectedTopic && !currentTopic && (
                                    <div className="flex items-center gap-1 mt-0.5">
                                        <span
                                            className="text-xs px-1.5 py-0.5 rounded-full"
                                            style={{
                                                background: autoDetectedTopic.confidence ***REMOVED***= 'high'
                                                    ? 'rgba(16,185,129,0.2)'
                                                    : autoDetectedTopic.confidence ***REMOVED***= 'medium'
                                                        ? 'rgba(245,158,11,0.2)'
                                                        : 'rgba(255,255,255,0.08)',
                                                color: autoDetectedTopic.confidence ***REMOVED***= 'high'
                                                    ? '#6ee7b7'
                                                    : autoDetectedTopic.confidence ***REMOVED***= 'medium'
                                                        ? '#fcd34d'
                                                        : 'rgba(255,255,255,0.45)',
                                            }}
                                        >
                                            🔍 {autoDetectedTopic.label}
                                        </span>
                                    </div>
                                )}
                                {/* 手动话题（移动端） */}
                                {currentTopic && (
                                    <div className="flex items-center gap-1 mt-0.5">
                                        <span className="text-xs px-1.5 py-0.5 rounded-full" style={{ background: 'rgba(59,130,246,0.25)', color: '#93c5fd' }}>
                                            📌 {TOPIC_LABELS[currentTopic.topic_key] || '新话题'}
                                        </span>
                                    </div>
                                )}
                            </div>
                            <button
                                onClick={() => setTagsVisible(v => !v)}
                                className="text-white/70 hover:text-white text-base shrink-0 px-2 py-1 rounded-lg"
                                title={tagsVisible ? '隐藏标签' : '显示标签'}
                            >
                                🏷
                            </button>
                        </div>

                        {/* Floating event bar — mobile only, toggleable */}
                        <div
                            className="flex md:hidden overflow-x-auto px-4 py-2 gap-2 transition-all duration-200"
                            style={{
                                background: WA.white,
                                borderBottom: `1px solid ${WA.borderLight}`,
                                maxHeight: tagsVisible ? '60px' : '0',
                                overflow: 'hidden',
                                opacity: tagsVisible ? 1 : 0,
                            }}
                        >
                            {creator && creator.joinbrands && (
                                <>
                                    {creator.joinbrands.ev_trial_7day && <EventPill label="7天试用" color="#3b82f6" />}
                                    {creator.joinbrands.ev_monthly_invited && <EventPill label="月卡邀请" color="#8b5cf6" />}
                                    {creator.joinbrands.ev_monthly_joined && <EventPill label="月卡加入" color="#10b981" />}
                                    {creator.joinbrands.ev_whatsapp_shared && <EventPill label="WA已发" color="#00a884" />}
                                    {creator.joinbrands.ev_gmv_1k && <EventPill label="GMV>1K" color="#f59e0b" />}
                                    {creator.joinbrands.ev_gmv_3k && <EventPill label="GMV>3K" color="#f97316" />}
                                    {creator.joinbrands.ev_gmv_10k && <EventPill label="GMV>10K" color="#ef4444" />}
                                    {creator.joinbrands.ev_churned && <EventPill label="已流失" color="#ef4444" />}
                                </>
                            )}
                        </div>
                    </>
                )}

                {/* Translation Progress Bar */}
                {translating && translateProgress && typeof translateProgress ***REMOVED***= 'string' && (
                    <div className="px-4 py-2 flex items-center gap-3" style={{ background: 'rgba(0,168,132,0.15)', borderBottom: `1px solid rgba(0,168,132,0.3)` }}>
                        <span className="text-xs" style={{ color: WA.teal }}>🌐 翻译中</span>
                        <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(0,168,132,0.2)' }}>
                            <div
                                className="h-full rounded-full transition-all duration-300"
                                style={{
                                    background: WA.teal,
                                    width: `${(parseInt(translateProgress.split('/')[0]) / parseInt(translateProgress.split('/')[1])) * 100}%`,
                                }}
                            />
                        </div>
                        <span className="text-xs font-mono" style={{ color: WA.teal }}>{translateProgress}</span>
                    </div>
                )}

                {/* Chat area — 最新消息在底部 */}
                <div
                    ref={chatScrollRef}
                    className="flex-1 overflow-y-auto p-3 md:p-5 space-y-3"
                    style={{ background: WA.chatBg }}
                    onTouchStart={handleTouchStart}
                    onTouchEnd={handleTouchEnd}
                >
                    {/* Watermark */}
                    <div className="flex justify-center mb-5">
                        <div className="text-xs px-4 py-1.5 rounded-lg" style={{ background: 'rgba(0,0,0,0.03)', color: WA.textMuted }}>
                            消息已端对端加密
                        </div>
                    </div>

                    {groupedMessages.map((item) => {
                        if (item.type ***REMOVED***= 'date') {
                            return (
                                <div key={item.id} className="flex justify-center my-4">
                                    <div className="text-xs px-4 py-1.5 rounded-lg" style={{ background: 'rgba(0,0,0,0.06)', color: WA.textMuted }}>
                                        {item.date}
                                    </div>
                                </div>
                            );
                        }

                        const isMe = item.role ***REMOVED***= 'me';
                        return (
                            <div key={item.id} className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}>
                                <div
                                    className="max-w-[75%] rounded-2xl px-4 py-3 text-sm leading-relaxed"
                                    style={{
                                        background: isMe ? WA.bubbleOut : WA.bubbleIn,
                                        color: WA.textDark,
                                        borderRadius: isMe ? '16px 16px 6px 16px' : '16px 16px 16px 6px',
                                        boxShadow: '0 1px 0.5px rgba(0,0,0,0.13)',
                                    }}
                                >
                                    <div className="whitespace-pre-wrap">{item.text}</div>
                                    {translationMap[item.timestamp] && (
                                        <div className="text-xs mt-1.5 pt-1.5 border-t" style={{ color: '#00a884', borderColor: 'rgba(0,0,0,0.08)' }}>
                                            🌐 {translationMap[item.timestamp]}
                                        </div>
                                    )}
                                    <div className="text-xs mt-1.5 flex justify-end" style={{ color: isMe ? '#667781' : WA.textMuted }}>
                                        {formatTime(item.timestamp)}
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>

                {/* 3 选 1 Picker — 位于输入框上方 */}
                {activePicker && (
                    <AIReplyPicker
                        incomingMsg={activePicker.incomingMsg}
                        candidates={activePicker.candidates}
                        customText={pickerCustom}
                        onCustomChange={setPickerCustom}
                        onSelect={handleSelectCandidate}
                        onSkip={handleSkip}
                        onEditCandidate={handleEditCandidate}
                        onRegenerate={handleRegenerate}
                        loading={pickerLoading}
                        error={pickerError}
                    />
                )}

                {/* Input area */}
                <div className="px-4 md:px-5 py-3 md:py-4 flex items-end gap-2 md:gap-3" style={{ background: WA.darkHeader, position: 'relative', paddingBottom: viewportOffset ? `${viewportOffset + 8}px` : undefined }}>
                    {/* Emoji picker button */}
                    <button
                        onClick={() => {
                            emojiSkipCloseRef.current = true;
                            setEmojiPickerOpen(v => !v);
                        }}
                        className="w-9 h-9 md:w-11 md:h-11 rounded-full flex items-center justify-center text-lg md:text-xl shrink-0 transition-all"
                        style={{ color: emojiPickerOpen ? WA.teal : 'rgba(255,255,255,0.55)' }}
                    >
                        😊
                    </button>

                    {/* 📌 手动开启新话题按钮 + 下拉菜单 */}
                    <div style={{ position: 'relative' }}>
                        <button
                            onClick={() => setTopicDropdownOpen(v => !v)}
                            className="h-9 md:h-11 px-3 rounded-full flex items-center gap-1.5 text-xs font-medium shrink-0 transition-all"
                            style={{
                                background: topicDropdownOpen
                                    ? 'rgba(59,130,246,0.4)'
                                    : currentTopic
                                        ? 'rgba(59,130,246,0.25)'
                                        : 'rgba(255,255,255,0.08)',
                                color: topicDropdownOpen || currentTopic ? '#93c5fd' : 'rgba(255,255,255,0.5)',
                                border: '1px solid rgba(255,255,255,0.15)',
                            }}
                            title="选择话题类型，开启新话题上下文"
                        >
                            📌
                            <span className="hidden sm:inline">新话题</span>
                            <span className="text-xs opacity-60">▼</span>
                        </button>

                        {/* 话题下拉菜单 */}
                        {topicDropdownOpen && (
                            <div
                                className="rounded-xl py-2 shadow-2xl overflow-y-auto"
                                style={{
                                    position: 'absolute',
                                    bottom: '52px',
                                    left: '0',
                                    width: '200px',
                                    maxHeight: '320px',
                                    background: '#1e293b',
                                    border: '1px solid rgba(255,255,255,0.12)',
                                    zIndex: 1001,
                                }}
                            >
                                <div className="px-3 py-1.5 text-xs font-semibold text-white/40 border-b border-white/10 mb-1">
                                    选择话题类型
                                </div>
                                {Object.entries(TOPIC_LABELS).map(([key, label]) => (
                                    <button
                                        key={key}
                                        onClick={() => {
                                            const newTopic = startNewTopic({
                                                trigger: 'manual',
                                                newText: inputText || label,
                                                messages,
                                            });
                                            newTopic.topic_key = key;
                                            setCurrentTopic(newTopic);
                                            setTopicDropdownOpen(false);
                                        }}
                                        className="w-full text-left px-3 py-2 text-xs transition-colors flex items-center gap-2"
                                        style={{
                                            color: currentTopic?.topic_key ***REMOVED***= key ? '#93c5fd' : 'rgba(255,255,255,0.75)',
                                            background: currentTopic?.topic_key ***REMOVED***= key ? 'rgba(59,130,246,0.2)' : 'transparent',
                                        }}
                                        onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.08)'}
                                        onMouseLeave={e => e.currentTarget.style.background = currentTopic?.topic_key ***REMOVED***= key ? 'rgba(59,130,246,0.2)' : 'transparent'}
                                    >
                                        <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: currentTopic?.topic_key ***REMOVED***= key ? '#60a5fa' : 'rgba(255,255,255,0.3)' }} />
                                        {label}
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* 点击空白关闭下拉菜单 */}
                    {topicDropdownOpen && (
                        <div
                            style={{ position: 'fixed', inset: 0, zIndex: 1000 }}
                            onClick={() => setTopicDropdownOpen(false)}
                        />
                    )}

                    {/* Emoji picker — always mounted, controlled via open prop */}
                    <div
                        className="emoji-picker-wrapper"
                        style={{
                            position: 'absolute',
                            bottom: '60px',
                            left: '16px',
                            zIndex: 1000,
                        }}
                    >
                        <EmojiPicker
                            open={emojiPickerOpen}
                            onEmojiClick={handleEmojiClick}
                            width={320}
                            height={380}
                            theme="dark"
                            previewReaction={false}
                            skinTonesDisabled
                        />
                    </div>

                    <div className="flex-1 flex items-center rounded-3xl px-4 md:px-5 py-3 md:py-3.5" style={{ background: WA.darkBg }}>
                        <textarea
                            ref={inputRef}
                            value={inputText}
                            onChange={e => setInputText(e.target.value)}
                            placeholder="输入消息，或直接点击右下角 🤖 为最新消息生成回复..."
                            rows={2}
                            className="flex-1 bg-transparent text-sm text-white placeholder-slate-400 focus:outline-none resize-none"
                            style={{ maxHeight: '240px' }}
                            onKeyDown={e => {
                                if (e.key ***REMOVED***= 'Enter' && !e.shiftKey) {
                                    e.preventDefault();
                                    if (inputText.trim()) handleManualGenerate();
                                }
                            }}
                            onInput={e => {
                                e.target.style.height = 'auto';
                                e.target.style.height = Math.min(e.target.scrollHeight, 240) + 'px';
                            }}
                        />
                    </div>

                    {inputText.trim() ? (
                        <div className="flex gap-2 shrink-0">
                            {/* 🤖 AI 生成候选 */}
                            <button
                                onClick={handleManualGenerate}
                                disabled={generating}
                                className="w-11 h-11 rounded-full flex items-center justify-center disabled:opacity-50"
                                style={{ background: WA.teal }}
                                title="AI 生成候选回复"
                            >
                                {generating ? <span className="text-white text-sm">⏳</span> : <span className="text-white text-xl">🤖</span>}
                            </button>
                            {/* ➤ 直接发送 */}
                            <button
                                onClick={() => handleDirectSend(inputText)}
                                className="w-11 h-11 rounded-full flex items-center justify-center"
                                style={{ background: '#3b82f6' }}
                                title="直接发送"
                            >
                                <span className="text-white text-xl">➤</span>
                            </button>
                        </div>
                    ) : (
                        <button
                            onClick={handleBotIconClick}
                            disabled={pickerLoading}
                            className="w-11 h-11 rounded-full flex items-center justify-center shrink-0 transition-all"
                            style={{
                                background: activePicker
                                    ? '#3b82f6'
                                    : pickerLoading
                                        ? 'rgba(255,255,255,0.1)'
                                        : 'rgba(255,255,255,0.1)',
                                opacity: pickerLoading ? 0.7 : 1,
                            }}
                            title={
                                activePicker
                                    ? '🔄 重新生成回复'
                                    : pickerLoading
                                        ? '生成中...'
                                        : '🤖 为最新消息生成回复'
                            }
                        >
                            {pickerLoading ? (
                                <span className="text-white text-sm animate-spin">⏳</span>
                            ) : activePicker ? (
                                <span className="text-white text-lg">🔄</span>
                            ) : (
                                <span className="text-white/70 text-lg">🤖</span>
                            )}
                        </button>
                    )}
                </div>
            </div>
        </>
    );
}

// ***REMOVED******REMOVED******REMOVED*** EventPill（悬浮事件标签）***REMOVED******REMOVED******REMOVED***
function EventPill({ label, color }) {
    return (
        <span
            className="text-xs px-3 py-1.5 rounded-full font-semibold shrink-0"
            style={{ background: color + '20', color }}
        >
            {label}
        </span>
    );
}

export default WAMessageComposer;
