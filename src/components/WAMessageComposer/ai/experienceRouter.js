/**
 * experienceRouter.js — AI 回复生成核心路由（异步，需调用 React setState）
 * 接收 React 状态作为参数，返回纯数据
 */
import { buildSystemPrompt, buildTopicContext, buildConversationSummary, buildRichContextParagraph } from './systemPromptBuilder';
import { shouldSwitchTopic, startNewTopic } from './topicDetector';

const API_BASE = '/api';

/**
 * generateViaExperienceRouter — Experience Router 核心
 * @param {object} params
 * @param {object} params.conversation — { messages: [...] }
 * @param {string} params.scene — 场景 key
 * @param {string} params.client_id — 客户 phone
 * @param {string} params.forcedInput — 强制输入文本
 * @param {object} params.richCtx — buildRichContext() 返回的上下文对象
 * @param {object} params.client — client state
 * @param {object} params.creator — creator state
 * @param {object} params.currentTopic — 当前话题 state
 * @param {object} params.autoDetectedTopic — 自动检测话题 state
 * @param {function} params.setCurrentTopic — React setState for topic
 * @returns {{ opt1: string, opt2: string }}
 */
export async function generateViaExperienceRouter({
    conversation,
    scene,
    client_id,
    forcedInput,
    richCtx,
    client,
    creator,
    currentTopic,
    autoDetectedTopic,
    setCurrentTopic,
}) {
    const allMsgs = conversation.messages;
    const lastMsgRole = allMsgs.length > 0 ? allMsgs[allMsgs.length - 1].role : null;
    const lastIncomingText = [...allMsgs].reverse().find(m => m.role ***REMOVED***= 'user')?.text || '';
    const lastMsgTimestamp = allMsgs.length > 0 ? allMsgs[allMsgs.length - 1].timestamp : null;

    // 尝试获取该达人的 active 事件
    let activeEvents = [];
    try {
        const creatorId = client?.id || creator?.id;
        if (creatorId) {
            const res = await fetch(`${API_BASE}/events/summary/${creatorId}`);
            if (res.ok) {
                const data = await res.json();
                activeEvents = (data.events || []).filter(e => e.status ***REMOVED***= 'active');
            }
        }
    } catch (_) {}

    // ***REMOVED***= 话题检测 ***REMOVED***=
    let effectiveTopic = currentTopic;
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
            setCurrentTopic?.(effectiveTopic);
        }
    }

    // ***REMOVED***= 构建 system prompt ***REMOVED***=
    const isSameTopic = effectiveTopic && ['manual', 'auto'].includes(effectiveTopic.trigger);
    const topicContext = effectiveTopic
        ? buildTopicContext({ topic: effectiveTopic, creator, activeEvents, mode: isSameTopic ? 'same_topic' : 'new_topic' })
        : '';
    const richContextParagraph = buildRichContextParagraph(richCtx);
    const basePrompt = buildSystemPrompt({ lastMsgRole, activeEvents, client, creator });

    // ***REMOVED***= 最近优先机制 ***REMOVED***=
    const convSummary = isSameTopic ? buildConversationSummary(allMsgs) : null;
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

    const systemPromptParts = [
        topicContext,
        richContextParagraph,
        convSummary ? convSummary.summary : null,
        basePrompt,
    ].filter(Boolean);
    const systemPrompt = systemPromptParts.join('\n\n');

    const allMessages = [
        { role: 'system', content: systemPrompt },
        ...conversationMsgs,
    ];

    // ***REMOVED***= 调用 AI ***REMOVED***=
    const res = await fetch(`${API_BASE}/minimax`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            client_id,
            model: 'MiniMax/Abab6.5s-Chat',
            messages: allMessages,
            max_tokens: 500,
            temperature: [0.8, 0.4],
        }),
    });
    const data = await res.json();

    // 提取 opt1 / opt2
    const opt1 = data?.content?.[0]?.type ***REMOVED***= 'text' ? data.content[0].text
        : data?.content?.text || '';
    const opt2 = data?.content_opt2?.[0]?.type ***REMOVED***= 'text' ? data.content_opt2[0].text
        : data?.content_opt2?.text || '';

    return { opt1, opt2 };
}
