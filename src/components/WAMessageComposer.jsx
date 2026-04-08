import React, { useState, useEffect, useRef, useCallback } from 'react';
import { generateCandidateResponses } from '../utils/minimax';
import EmojiPicker from 'emoji-picker-react';

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
  if (wacrm?.beta_status === 'introduced' && messageCount > 3) return 'follow_up';
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
  if (s1 === s2) return 100;
  // 分词：按空格/标点拆分为单词集合
  const words1 = new Set(s1.toLowerCase().split(/[\s,.!?;:，。！？；：]+/).filter(w => w.length > 0));
  const words2 = new Set(s2.toLowerCase().split(/[\s,.!?;:，。！？；：]+/).filter(w => w.length > 0));
  if (words1.size === 0 && words2.size === 0) return 100;
  if (words1.size === 0 || words2.size === 0) return 0;
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

    // 待审核队列
    const [pendingCandidates, setPendingCandidates] = useState([]);

    // 移动端标签 bar 显示状态
    const [tagsVisible, setTagsVisible] = useState(true);

    // 键盘弹出时 visualViewport 偏移量
    const [viewportOffset, setViewportOffset] = useState(0);

    // 移动端左划手势
    const touchStartX = useRef(null);
    const handleTouchStart = (e) => {
        touchStartX.current = e.touches[0].clientX;
    };
    const handleTouchEnd = (e) => {
        if (touchStartX.current === null) return;
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

    const pollingRef = useRef(null);
    const chatScrollRef = useRef(null);
    const inputRef = useRef(null);

    // 滚动到底部
    const scrollToBottom = useCallback(() => {
        if (chatScrollRef.current) {
            chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
        }
    }, []);

    // 构建对话历史
    const buildConversation = (messages) => ({
        messages: (messages || []).slice(-10).map(m => ({
            role: m.role === 'me' ? 'me' : 'user',
            text: m.text
        }))
    });

    // 通过 Experience Router 生成候选回复
    const generateViaExperienceRouter = async ({ conversation, scene, client_id, forcedInput }) => {
        const msgs = conversation.messages.map(m => ({
            role: m.role === 'me' ? 'assistant' : 'user',
            content: m.text,
        }));
        if (forcedInput) {
            msgs.push({ role: 'user', content: forcedInput });
        } else if (msgs.length > 0 && msgs[msgs.length - 1].role === 'assistant') {
            msgs.push({ role: 'user', content: '[请回复这位达人]' });
        }
        const [r1, r2] = await Promise.all([
            fetch(`${API_BASE}/minimax`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ client_id, model: 'mini-max-typing', messages: msgs, max_tokens: 500, temperature: 0.8 }),
            }).then(r => r.json()),
            fetch(`${API_BASE}/minimax`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ client_id, model: 'mini-max-typing', messages: msgs, max_tokens: 500, temperature: 0.4 }),
            }).then(r => r.json()),
        ]);
        const extract = (d) => d.content?.find(i => i.type === 'text')?.text || '';
        return { opt1: extract(r1), opt2: extract(r2) };
    };

    const fetchPolicyDocs = async () => {
        try {
            const r = await fetch(`${API_BASE}/policy-documents?active_only=true`);
            if (r.ok) return await r.json();
        } catch (_) {}
        return [];
    };

    // 预加载政策文档和客户记忆
    useEffect(() => {
        const load = async () => {
            const [docs, mem] = await Promise.all([
                fetchPolicyDocs(),
                client?.phone
                    ? fetch(`${API_BASE}/client-memory/${client.phone}`).then(r => r.ok ? r.json() : []).catch(() => [])
                    : []
            ]);
            setPolicyDocs(docs);
            setClientMemory(mem || []);
        };
        load();
    }, [client?.phone]);

    // 为一条 incoming 消息生成候选
    const generateForIncoming = async (incomingMsg) => {
        setPickerLoading(true);
        try {
            const conversation = buildConversation(messages);
            conversation.messages.push({ role: 'user', text: incomingMsg.text });

            const richCtx = buildRichContext({ incomingMsg, client, creator, policyDocs, clientMemory, messages });

            const result = await generateViaExperienceRouter({
                conversation,
                scene: richCtx.scene,
                client_id: client.phone,
            });

            return {
                incomingMsg,
                candidates: result,
                generated_at: Date.now(),
                policyDocs,
            };
        } catch (e) {
            console.error('[generateForIncoming] error:', e);
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
            const msgs = await res.json();
            console.log('[checkNewMessages] msgs count:', msgs?.length);
            if (!msgs || msgs.length === 0) return;

            // 更新消息历史（用于渲染）
            setMessages(msgs);

            // 找最新一条 incoming 消息（role === 'user'）
            const incomingMsgs = msgs.filter(m => m.role === 'user');
            const latestMsg = incomingMsgs[incomingMsgs.length - 1];
            console.log('[checkNewMessages] latestMsg role:', latestMsg?.role, 'text:', latestMsg?.text?.slice(0, 50));
            if (!latestMsg) return;

            // 检查这条消息是否已经在队列中
            const alreadyQueued = (activePicker?.incomingMsg?.timestamp === latestMsg.timestamp) ||
                pendingCandidates.some(p => p.incomingMsg.timestamp === latestMsg.timestamp);
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
    }, [client?.id, activePicker, pendingCandidates, pushPicker]);

    useEffect(() => {
        pollingRef.current = setInterval(checkNewMessages, 5000);
        // 启动时立即检查一次
        checkNewMessages();
        return () => clearInterval(pollingRef.current);
    }, [checkNewMessages]);

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
        const incomingMsgs = messages.filter(m => m.role === 'user');
        const latestMsg = incomingMsgs[incomingMsgs.length - 1];
        if (!latestMsg) return;

        setActivePicker(null);
        setPendingCandidates([]);
        setPickerCustom('');
        setPickerLoading(true);

        try {
            const conversation = buildConversation(messages);
            conversation.messages.push({ role: 'user', text: latestMsg.text });
            const richCtx = buildRichContext({ incomingMsg: latestMsg, client, creator, policyDocs, clientMemory, messages });
            const result = await generateViaExperienceRouter({
                conversation,
                scene: richCtx.scene,
                client_id: client.phone,
            });
            setActivePicker({ incomingMsg: latestMsg, candidates: result, generated_at: Date.now(), policyDocs });
        } catch (e) {
            console.error('[Regenerate] error:', e);
        } finally {
            setPickerLoading(false);
        }
    };

    // 翻译最近20条消息（逐条进行），翻译结果显示在对应气泡下方
    const handleTranslate = async () => {
        const last20 = messages.slice(-20);
        if (last20.length === 0) return;
        // 如果已有翻译，先清除（切换时重新翻译）
        if (Object.keys(translationMap).length > 0) {
            setTranslationMap({});
            setTranslateProgress(null);
            return;
        }
        setTranslating(true);
        const newMap = {};
        const total = last20.length;
        for (let i = total - 1; i >= 0; i--) {
            const msg = last20[i];
            setTranslateProgress(`${total - i}/${total}`);
            try {
                const response = await fetch(`${API_BASE}/translate`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ text: msg.text, role: msg.role, timestamp: msg.timestamp }),
                });
                const data = await response.json();
                if (data.translation) {
                    newMap[msg.timestamp] = data.translation;
                    setTranslationMap({ ...newMap });
                }
            } catch (e) {
                console.error('[Translate] error for msg:', msg.timestamp, e);
                // 失败时用原文
                newMap[msg.timestamp] = msg.text;
                setTranslationMap({ ...newMap });
            }
            // 避免请求过快，稍作延迟
            if (i > 0) await new Promise(r => setTimeout(r, 300));
        }
        setTranslating(false);
        setTranslateProgress(true);
    };

    // 重新生成（picker 内部的刷新按钮）
    const handleRegenerate = async () => {
        const incomingMsg = activePicker?.incomingMsg || (() => {
            const incomingMsgs = messages.filter(m => m.role === 'user');
            return incomingMsgs[incomingMsgs.length - 1];
        })();
        if (!incomingMsg) return;

        setPickerLoading(true);
        try {
            const conversation = buildConversation(messages);
            conversation.messages.push({ role: 'user', text: incomingMsg.text });
            const richCtx = buildRichContext({ incomingMsg, client, creator, policyDocs, clientMemory, messages });
            const result = await generateViaExperienceRouter({
                conversation,
                scene: richCtx.scene,
                client_id: client.phone,
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
        } finally {
            setPickerLoading(false);
        }
    };

    // 选择了候选 → 发送
    const handleSelectCandidate = async (selectedOpt) => {
        if (!activePicker) return;

        const sentText = selectedOpt === 'opt1'
            ? activePicker.candidates.opt1
            : selectedOpt === 'opt2'
                ? activePicker.candidates.opt2
                : pickerCustom.trim();

        if (!sentText) return;

        const sim1 = computeSimilarity(activePicker.candidates.opt1, sentText);
        const sim2 = computeSimilarity(activePicker.candidates.opt2, sentText);
        const bestSim = Math.max(sim1, sim2);
        const bestOpt = sim1 >= sim2 ? 'opt1' : 'opt2';

        const diffAnalysis = {
            model_predicted: bestSim >= 85 ? activePicker.candidates[bestOpt] : null,
            model_rejected: bestSim >= 85 ? activePicker.candidates[bestOpt === 'opt1' ? 'opt2' : 'opt1'] : null,
            is_custom: selectedOpt === 'custom' || bestSim < 85,
            human_reason: bestSim >= 85
                ? `直接采用方案${bestOpt === 'opt1' ? 'A' : 'B'}（相似度${bestSim}%）`
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
                    human_selected: selectedOpt === 'custom' ? 'custom' : bestOpt,
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
                    })
                });
            } catch (_) {}
        }
        setPickerCustom('');
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

        // 发送 WhatsApp 消息
        try {
            await fetch('http://127.0.0.1:3001/wa-send', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ phone: client.phone, text: sentText })
            });
        } catch (e) {
            console.error('[WA Send] 发送失败:', e);
        }

        // 保存到 CRM SQLite
        try {
            await fetch(`${API_BASE}/creators/${client.id}/messages`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ role: 'me', text: sentText, timestamp: Date.now() })
            });
        } catch (e) {
            console.error('[CRM DB] 保存失败:', e);
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
        if (date !== lastDate) {
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
        if (typeof window === 'undefined' || !window.visualViewport) return;
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
                        <div className="text-xs text-white/50">
                            {client.conversion_stage || '未知阶段'} · {messages.length} 条消息
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
                                <div className="text-xs text-white/50">{messages.length} 条消息</div>
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
                {translating && translateProgress && typeof translateProgress === 'string' && (
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
                        if (item.type === 'date') {
                            return (
                                <div key={item.id} className="flex justify-center my-4">
                                    <div className="text-xs px-4 py-1.5 rounded-lg" style={{ background: 'rgba(0,0,0,0.06)', color: WA.textMuted }}>
                                        {item.date}
                                    </div>
                                </div>
                            );
                        }

                        const isMe = item.role === 'me';
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
                                if (e.key === 'Enter' && !e.shiftKey) {
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

// ====== AI Reply Picker（内联 3 选 1）======
function AIReplyPicker({ incomingMsg, candidates, customText, onCustomChange, onSelect, onSkip, onEditCandidate, onRegenerate, loading }) {
    const PICKER_BG = '#EFF6FF';
    const PICKER_BORDER = '#BFDBFE';
    const PICKER_ACCENT = '#3b82f6';

    return (
        <div style={{ background: PICKER_BG, borderTop: '2px solid ' + PICKER_BORDER }}>
            {/* 标题栏 */}
            <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: '1px solid ' + PICKER_BORDER }}>
                <div className="flex items-center gap-2">
                    <span className="text-base">🤖</span>
                    <span className="text-sm font-bold" style={{ color: PICKER_ACCENT }}>AI 推荐回复</span>
                </div>
                <div className="flex items-center gap-3">
                    {incomingMsg && (
                        <span className="text-xs px-3 py-1 rounded-full hidden sm:inline" style={{ background: 'rgba(0,0,0,0.06)', color: WA.textMuted }}>
                            来: {incomingMsg.text.slice(0, 40)}{incomingMsg.text.length > 40 ? '...' : ''}
                        </span>
                    )}
                    <button
                        onClick={onRegenerate}
                        disabled={loading}
                        className="text-sm px-3 py-1.5 rounded-xl font-medium flex items-center gap-1.5 disabled:opacity-50"
                        style={{ background: 'rgba(59,130,246,0.12)', color: '#3b82f6' }}
                        title="重新生成"
                    >
                        <span className={loading ? 'animate-spin' : ''}>{loading ? '⏳' : '🔄'}</span>
                        <span className="hidden sm:inline">重新生成</span>
                    </button>
                    <button onClick={onSkip} className="text-sm px-3 py-1.5 rounded-xl hover:bg-black/10 font-medium" style={{ color: WA.textMuted }}>
                        跳过
                    </button>
                </div>
            </div>

            {loading ? (
                <div className="flex items-center justify-center gap-3 py-8">
                    <span className="animate-spin text-2xl">⏳</span>
                    <span className="text-sm" style={{ color: WA.textMuted }}>AI 正在生成候选回复...</span>
                </div>
            ) : (
                <div className="p-3 md:p-4 space-y-2 md:space-y-3">
                    {/* opt1 */}
                    <div className="flex flex-col sm:flex-row gap-2">
                        <div className="flex-1 rounded-2xl px-4 py-3 text-sm leading-relaxed" style={{ background: WA.bubbleOut, color: WA.textDark, boxShadow: '0 1px 2px rgba(0,0,0,0.1)' }}>
                            <div className="flex items-center gap-2 mb-2">
                                <span className="text-xs font-bold px-2 py-0.5 rounded-full" style={{ background: '#3b82f620', color: '#3b82f6' }}>A</span>
                                <span className="text-xs" style={{ color: WA.textMuted }}>方案一</span>
                            </div>
                            <div className="whitespace-pre-wrap">{candidates?.opt1 || '(空)'}</div>
                        </div>
                        <div className="flex sm:flex-col gap-2 shrink-0">
                            <button
                                onClick={() => onEditCandidate(candidates?.opt1)}
                                className="flex-1 sm:flex-none px-4 py-2.5 rounded-xl text-sm font-medium text-white"
                                style={{ background: '#3b82f6' }}
                            >
                                编辑
                            </button>
                            <button
                                onClick={() => onSelect('opt1')}
                                className="flex-1 sm:flex-none px-4 py-2.5 rounded-xl text-sm font-bold text-white"
                                style={{ background: '#3b82f688' }}
                            >
                                发送
                            </button>
                        </div>
                    </div>

                    {/* opt2 */}
                    <div className="flex flex-col sm:flex-row gap-2">
                        <div className="flex-1 rounded-2xl px-4 py-3 text-sm leading-relaxed" style={{ background: WA.bubbleOut, color: WA.textDark, boxShadow: '0 1px 2px rgba(0,0,0,0.1)' }}>
                            <div className="flex items-center gap-2 mb-2">
                                <span className="text-xs font-bold px-2 py-0.5 rounded-full" style={{ background: '#10b98120', color: '#10b981' }}>B</span>
                                <span className="text-xs" style={{ color: WA.textMuted }}>方案二</span>
                            </div>
                            <div className="whitespace-pre-wrap">{candidates?.opt2 || '(空)'}</div>
                        </div>
                        <div className="flex sm:flex-col gap-2 shrink-0">
                            <button
                                onClick={() => onEditCandidate(candidates?.opt2)}
                                className="flex-1 sm:flex-none px-4 py-2.5 rounded-xl text-sm font-medium text-white"
                                style={{ background: '#10b981' }}
                            >
                                编辑
                            </button>
                            <button
                                onClick={() => onSelect('opt2')}
                                className="flex-1 sm:flex-none px-4 py-2.5 rounded-xl text-sm font-bold text-white"
                                style={{ background: '#10b98188' }}
                            >
                                发送
                            </button>
                        </div>
                    </div>

                </div>
            )}
        </div>
    );
}

// ====== EventPill（悬浮事件标签）======
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
