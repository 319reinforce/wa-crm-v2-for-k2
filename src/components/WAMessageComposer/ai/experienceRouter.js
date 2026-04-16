/**
 * experienceRouter.js — AI 回复生成核心路由（异步，需调用 React setState）
 * 接收 React 状态作为参数，返回纯数据
 */
import { buildRichContext } from './extractors';
import { buildConversationSummary, buildRichContextParagraph, buildTopicContext } from './systemPromptBuilder';
import { shouldSwitchTopic, startNewTopic } from './topicDetector';
import { fetchJsonOrThrow } from '../../../utils/api';

const API_BASE = '/api';

/**
 * generateViaExperienceRouter — Experience Router 核心
 * @param {object} params
 * @param {object} params.conversation — { messages: [...] }
 * @param {string} params.scene — 场景 key（可选）
 * @param {string} params.client_id — 客户 phone
 * @param {string} params.forcedInput — 强制输入文本
 * @param {object} params.client — client state
 * @param {object} params.creator — creator state
 * @param {object} params.policyDocs — policy docs
 * @param {object} params.clientMemory — client memory
 * @param {Array} params.agencyStrategies — 未绑定Agency策略配置
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
    client,
    creator,
    policyDocs,
    clientMemory,
    agencyStrategies,
    currentTopic,
    autoDetectedTopic,
    setCurrentTopic,
}) {
    const allMsgs = conversation?.messages || [];
    const lastIncomingText = [...allMsgs].reverse().find(m => m.role === 'user')?.text || '';
    const lastMsgTimestamp = allMsgs.length > 0 ? allMsgs[allMsgs.length - 1].timestamp : null;
    const resolvedClientId = client_id || client?.phone || '';

    // 尝试获取该达人的 active 事件
    let activeEvents = [];
    try {
        const creatorId = client?.id || creator?.id;
        if (creatorId) {
            const data = await fetchJsonOrThrow(`${API_BASE}/events/summary/${creatorId}`, {
                signal: AbortSignal.timeout(15000),
            });
            activeEvents = (data.events || []).filter(e => e.status === 'active');
        }
    } catch (_) {}

    // === 话题检测：判断是否需要开启新话题 ===
    let effectiveTopic = currentTopic;
    if (!effectiveTopic && autoDetectedTopic) {
        effectiveTopic = { ...autoDetectedTopic, trigger: 'auto' };
    }
    const manualTopicPinned = effectiveTopic?.trigger === 'manual';
    if (lastIncomingText && !manualTopicPinned) {
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

    // 构建 system prompt（含话题上下文 + 丰富上下文 + 双模式）
    // 方向三：差异化 Prompt — 同一话题用简短版，新话题用完整版
    const isSameTopic = effectiveTopic?.trigger === 'auto';
    const topicContext = effectiveTopic
        ? buildTopicContext({
            topic: effectiveTopic,
            creator,
            activeEvents,
            clientMemory,
            agencyStrategies,
            mode: isSameTopic ? 'same_topic' : 'new_topic',
        })
        : '';

    // 构建完整的 richCtx（buildRichContextParagraph 依赖多个字段）
    const lastIncoming = allMsgs.length > 0
        ? { text: lastIncomingText, timestamp: lastMsgTimestamp }
        : null;
    const richCtx = buildRichContext({
        incomingMsg: lastIncoming,
        client,
        creator,
        policyDocs,
        clientMemory,
        agencyStrategies,
        messages: allMsgs
    });
    const effectiveScene = scene || richCtx.scene || 'unknown';
    const sceneSource = scene
        ? 'provided'
        : richCtx.scene
            ? 'detected'
            : 'fallback';
    const richContextParagraph = buildRichContextParagraph(richCtx);

    // 方向二：最近优先机制
    // - 同一话题（manual/auto）：最近10条直接传，更早消息摘要注入Prompt
    // - 新话题（keyword/time）：全部消息，不做摘要
    const convSummary = isSameTopic ? buildConversationSummary(allMsgs) : null;
    const latestUserMessage = forcedInput
        || allMsgs.filter((m) => m.role !== 'me').slice(-1)[0]?.text
        || '';

    // 对话消息：按场景截取
    const msgsToUse = convSummary ? allMsgs.slice(-convSummary.recentCount) : allMsgs;
    const conversationMsgs = msgsToUse.map(m => ({
        role: m.role === 'me' ? 'assistant' : 'user',
        content: m.text,
    }));
    if (forcedInput) {
        conversationMsgs.push({ role: 'user', content: forcedInput });
    } else if (conversationMsgs.length > 0 && conversationMsgs[conversationMsgs.length - 1].role === 'assistant') {
        conversationMsgs.push({ role: 'user', content: '[请回复这位达人]' });
    }

    const data = await fetchJsonOrThrow(`${API_BASE}/ai/generate-candidates`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            client_id: resolvedClientId,
            scene: effectiveScene,
            topicContext,
            richContext: richContextParagraph,
            conversationSummary: convSummary ? convSummary.summary : '',
            latest_user_message: latestUserMessage,
            messages: conversationMsgs,
            max_tokens: 500,
            temperature: [0.8, 0.4],
        }),
        signal: AbortSignal.timeout(60000),
    });

    const opt1 = String(data?.opt1 || '').trim();
    const opt2 = String(data?.opt2 || '').trim();
    if (!opt1 && !opt2) {
        throw new Error('AI 返回空候选，请重试');
    }
    return {
        opt1,
        opt2,
        systemPrompt: data.systemPrompt,
        systemPromptVersion: data.systemPromptVersion || data.version,
        operator: data.operator || null,
        operatorDisplayName: data.operatorDisplayName || data.operator || null,
        operatorConfigured: !!data.operatorConfigured,
        scene: effectiveScene,
        sceneSource,
        retrievalSnapshotId: data.retrievalSnapshotId || data.retrieval_snapshot_id || null,
        generationLogId: data.generationLogId || data.generation_log_id || null,
        provider: data.provider || null,
        model: data.model || null,
        pipelineVersion: data.pipelineVersion || data.pipeline_version || 'reply_generation_v2',
    };
}
