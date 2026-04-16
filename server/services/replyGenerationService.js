const crypto = require('crypto');
const db = require('../../db');
const { buildFullSystemPrompt } = require('../../systemPromptBuilder.cjs');
const { extractAndSaveMemories } = require('./memoryExtractionService');
const { normalizeOperatorName } = require('../utils/operator');
const { resolveClientAndOwnerScope } = require('../utils/ownerScope');
const REPLY_PIPELINE_VERSION = 'reply_generation_v2';

function shouldUseFinetuned() {
    if (process.env.USE_FINETUNED !== 'true') return false;
    const model = String(process.env.FINETUNED_MODEL || '').trim();
    if (!model) return false;
    const ratio = parseFloat(process.env.AB_RATIO || '0.1');
    return Math.random() < ratio;
}

function resolveFinetunedBase(rawBase) {
    const fallback = 'http://localhost:8000/v1/messages';
    const input = String(rawBase || '').trim() || fallback;
    try {
        const url = new URL(input);
        if (url.hostname === 'api.openai.com' && /^\/v1\/?$/.test(url.pathname)) {
            return `${url.origin}/v1/chat/completions`;
        }
        return input;
    } catch (_) {
        return input;
    }
}

function resolveFinetunedModel() {
    const explicit = String(process.env.FINETUNED_MODEL || '').trim();
    if (!explicit) return '';
    return explicit;
}

function normalizeMessagesForMemory(messages = []) {
    return messages
        .filter(m => m && m.role !== 'system')
        .map((m) => {
            const normalizedRole = (m.role === 'assistant' || m.role === 'me') ? 'me' : 'user';
            let text = '';
            if (typeof m.text === 'string') {
                text = m.text;
            } else if (typeof m.content === 'string') {
                text = m.content;
            } else if (Array.isArray(m.content)) {
                text = m.content
                    .map((part) => typeof part === 'string' ? part : (part?.text || ''))
                    .filter(Boolean)
                    .join('\n');
            }
            return { role: normalizedRole, text };
        })
        .filter((m) => m.text);
}

function extractResponseText(payload) {
    if (typeof payload?.choices?.[0]?.message?.content === 'string') {
        return payload.choices[0].message.content.trim();
    }

    if (Array.isArray(payload?.choices?.[0]?.message?.content)) {
        return payload.choices[0].message.content
            .map((part) => typeof part === 'string' ? part : (part?.text || ''))
            .filter(Boolean)
            .join('\n')
            .trim();
    }

    if (Array.isArray(payload?.content)) {
        return payload.content
            .map((part) => typeof part === 'string' ? part : (part?.text || ''))
            .filter(Boolean)
            .join('\n')
            .trim();
    }

    if (payload?.content && typeof payload.content === 'object') {
        return String(payload.content.text || '').trim();
    }

    if (typeof payload?.content === 'string') {
        return payload.content.trim();
    }

    return '';
}

function toRequestError(label, response, payload) {
    const detail = payload?.error?.message
        || payload?.message
        || (response ? `HTTP ${response.status}` : 'request failed');
    return new Error(`${label}: ${detail}`);
}

async function settleCandidateRequests(requests) {
    const settled = await Promise.allSettled(requests);
    const successes = settled
        .filter((item) => item.status === 'fulfilled' && item.value?.text)
        .map((item) => item.value);

    if (successes.length === 0) {
        const failure = settled.find((item) => item.status === 'rejected');
        throw failure?.reason || new Error('All candidate requests failed');
    }

    if (successes.length === 1) {
        return [successes[0], successes[0]];
    }

    return [successes[0], successes[1]];
}

function sha256(text) {
    return crypto.createHash('sha256').update(String(text || '')).digest('hex');
}

function maskClientId(clientId) {
    const value = String(clientId || '');
    const digits = value.replace(/\D/g, '');
    if (digits.length >= 4) return `***${digits.slice(-4)}`;
    if (value.length > 4) return `***${value.slice(-4)}`;
    return '***';
}

function extractMessageText(message) {
    if (!message) return '';
    if (typeof message.content === 'string') return message.content.trim();
    if (typeof message.text === 'string') return message.text.trim();
    if (Array.isArray(message.content)) {
        return message.content
            .map((part) => typeof part === 'string' ? part : (part?.text || ''))
            .filter(Boolean)
            .join('\n')
            .trim();
    }
    return '';
}

function normalizeConversationMessages(messages = [], { appendReplyPromptIfLastAssistant = false } = {}) {
    const normalized = (Array.isArray(messages) ? messages : [])
        .map((message) => {
            const role = String(message?.role || '').trim().toLowerCase();
            const content = extractMessageText(message);
            if (!content) return null;
            return {
                role: role === 'assistant' || role === 'me'
                    ? 'assistant'
                    : role === 'system'
                        ? 'system'
                        : 'user',
                content,
            };
        })
        .filter(Boolean);

    if (appendReplyPromptIfLastAssistant && normalized.length > 0) {
        const lastMessage = normalized[normalized.length - 1];
        if (lastMessage.role === 'assistant') {
            normalized.push({ role: 'user', content: '[请回复这位达人]' });
        }
    }

    return normalized;
}

function extractCandidateText(payload) {
    if (!payload || !Array.isArray(payload.content)) return '';
    return payload.content.find((item) => item?.type === 'text')?.text || '';
}

function extractCandidateOpt2Text(payload) {
    if (!payload || !Array.isArray(payload.content_opt2)) return '';
    return payload.content_opt2.find((item) => item?.type === 'text')?.text || '';
}

async function writeRetrievalSnapshot(snapshot) {
    try {
        const db2 = db.getDb();
        const result = await db2.prepare(`
            INSERT INTO retrieval_snapshot
            (client_id, operator, scene, system_prompt_version, snapshot_hash, grounding_json, topic_context, rich_context, conversation_summary)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            snapshot.client_id || null,
            snapshot.operator || null,
            snapshot.scene || 'unknown',
            snapshot.system_prompt_version || 'v2',
            snapshot.snapshot_hash,
            JSON.stringify(snapshot.grounding_json || {}),
            snapshot.topic_context || null,
            snapshot.rich_context || null,
            snapshot.conversation_summary || null,
        );
        return result.lastInsertRowid || null;
    } catch (err) {
        console.warn('[retrievalSnapshot] write failed:', err.message);
        return null;
    }
}

async function writeGenerationLog(log) {
    try {
        const db2 = db.getDb();
        const result = await db2.prepare(`
            INSERT INTO generation_log
            (client_id, retrieval_snapshot_id, provider, model, route, ab_bucket, scene, operator, temperature_json, message_count, prompt_version, latency_ms, status, error_message)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            log.client_id || null,
            log.retrieval_snapshot_id || null,
            log.provider || null,
            log.model || null,
            log.route || null,
            log.ab_bucket || null,
            log.scene || 'unknown',
            log.operator || null,
            JSON.stringify(log.temperature || null),
            log.message_count || 0,
            log.prompt_version || null,
            log.latency_ms || null,
            log.status || 'success',
            log.error_message || null,
        );
        return result.lastInsertRowid || null;
    } catch (err) {
        console.warn('[generationLog] write failed:', err.message);
        return null;
    }
}

async function resolveReplyRequestScope(req, res, dbConn, { clientId, operator } = {}) {
    return await resolveClientAndOwnerScope(req, res, dbConn, {
        clientId,
        requestedOwner: operator,
        ownerFieldName: 'operator',
        notFoundMessage: '无效的 client_id',
    });
}

async function getOperatorMeta(operator) {
    if (!operator) {
        return {
            displayName: null,
            configured: false,
        };
    }

    const exp = await db.getDb().prepare(
        'SELECT display_name FROM operator_experiences WHERE operator = ? AND is_active = 1'
    ).get(operator);

    return {
        displayName: exp?.display_name || operator,
        configured: !!exp,
    };
}

async function buildReplySystemPrompt({
    req,
    res,
    clientId,
    operator,
    scene,
    topicContext = '',
    richContext = '',
    conversationSummary = '',
    queryText = '',
    latestUserMessage = '',
    systemPromptVersion = 'v2',
    scope = null,
}) {
    if (!scene) {
        const error = new Error('scene is required');
        error.statusCode = 400;
        throw error;
    }

    const db2 = db.getDb();
    const resolvedScope = scope || await resolveReplyRequestScope(req, res, db2, { clientId, operator });
    if (!resolvedScope?.ok) return null;

    const scopedClientId = resolvedScope.clientScope.clientId || null;
    const resolvedOperator = resolvedScope.owner || null;
    const retrievalQueryText = [
        queryText,
        latestUserMessage,
        topicContext,
        richContext,
        conversationSummary,
    ]
        .filter((item) => typeof item === 'string' && item.trim())
        .join('\n\n');

    const { prompt, grounding } = await buildFullSystemPrompt(scopedClientId, scene, [], {
        operator: resolvedOperator,
        topicContext: topicContext || '',
        richContext: richContext || '',
        conversationSummary: conversationSummary || '',
        retrievalQueryText,
        systemPromptVersion,
    });

    let version = 'v2_base';
    if (resolvedOperator) {
        const memFlag = (grounding?.memory?.length || 0) > 0 ? '_mem' : '';
        const polFlag = (grounding?.policies?.length || 0) > 0 ? '_pol' : '';
        version = `v2_${resolvedOperator}${memFlag}${polFlag}`;
    }

    const snapshotHash = sha256(JSON.stringify({
        client_id: scopedClientId || null,
        operator: resolvedOperator || null,
        scene,
        version,
        grounding: grounding || {},
        topicContext: topicContext || '',
        richContext: richContext || '',
        conversationSummary: conversationSummary || '',
        retrievalQueryText,
    }));
    const retrievalSnapshotId = await writeRetrievalSnapshot({
        client_id: scopedClientId,
        operator: resolvedOperator,
        scene,
        system_prompt_version: version,
        snapshot_hash: snapshotHash,
        grounding_json: grounding || {},
        topic_context: topicContext || '',
        rich_context: richContext || '',
        conversation_summary: conversationSummary || '',
    });

    const operatorMeta = await getOperatorMeta(resolvedOperator);

    return {
        scope: resolvedScope,
        clientId: scopedClientId,
        systemPrompt: prompt,
        systemPromptVersion: version,
        operator: resolvedOperator,
        operatorDisplayName: operatorMeta.displayName,
        operatorConfigured: operatorMeta.configured,
        retrievalSnapshotId,
        grounding,
    };
}

async function generateCandidatesFromMessages({
    req,
    res,
    messages,
    model,
    maxTokens = 500,
    temperature = [0.8, 0.4],
    clientId,
    retrievalSnapshotId = null,
    scene = 'unknown',
    operator,
    promptVersion = 'v2',
    routeName = 'minimax',
    scope = null,
}) {
    const db2 = db.getDb();
    const resolvedScope = scope || await resolveReplyRequestScope(req, res, db2, { clientId, operator });
    if (!resolvedScope?.ok) return null;

    const normalizedMessages = normalizeConversationMessages(messages);
    if (normalizedMessages.length === 0) {
        const error = new Error('messages is required and must contain at least one message');
        error.statusCode = 400;
        throw error;
    }

    const scopedClientId = resolvedScope.clientScope.clientId || null;
    const scopedOperator = resolvedScope.owner || null;
    let finetunedHookFired = false;
    const startTs = Date.now();
    const logBase = {
        client_id: scopedClientId,
        retrieval_snapshot_id: retrievalSnapshotId || null,
        scene: scene || 'unknown',
        operator: scopedOperator,
        temperature,
        message_count: normalizedMessages.length,
        prompt_version: promptVersion || null,
        latency_ms: null,
    };

    const providerHint = shouldUseFinetuned()
        ? 'finetuned'
        : (process.env.USE_OPENAI === 'true' ? 'openai' : 'minimax');

    try {
        if (providerHint === 'finetuned') {
            const finetunedBase = resolveFinetunedBase(process.env.FINETUNED_BASE);
            const finetunedKey = process.env.FINETUNED_API_KEY || 'EMPTY';
            const finetunedModel = resolveFinetunedModel();
            if (!finetunedModel) {
                const error = new Error('FINETUNED_MODEL is required when USE_FINETUNED=true');
                error.statusCode = 500;
                throw error;
            }

            const temps = Array.isArray(temperature) ? temperature : [0.8, 0.4];
            let finetunedFailed = false;
            try {
                const candidateRequests = temps.map((temp, index) => (async () => {
                    const response = await fetch(finetunedBase, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${finetunedKey}`,
                        },
                        body: JSON.stringify({
                            model: finetunedModel,
                            messages: normalizedMessages,
                            max_tokens: maxTokens || 500,
                            temperature: temp,
                        }),
                        signal: AbortSignal.timeout(15000),
                    });
                    const payload = await response.json();
                    if (!response.ok) {
                        throw toRequestError(`finetuned opt${index + 1}`, response, payload);
                    }
                    const text = extractResponseText(payload);
                    if (!text) {
                        throw new Error(`finetuned opt${index + 1}: empty response`);
                    }
                    return { payload, text };
                })());

                const [opt1Candidate, opt2Candidate] = await settleCandidateRequests(candidateRequests);
                if (opt1Candidate?.text) {
                    const latency = Date.now() - startTs;
                    if (scopedClientId && resolvedScope.clientScope.owner) {
                        const msgs = normalizeMessagesForMemory(normalizedMessages);
                        finetunedHookFired = true;
                        setImmediate(() => {
                            extractAndSaveMemories({
                                client_id: scopedClientId,
                                owner: resolvedScope.clientScope.owner,
                                messages: msgs,
                                trigger_type: 'ai_generate',
                            }).catch(e => console.error('[memoryExtraction] replyGeneration finetuned hook error:', e.message));
                        });
                    }
                    const generationLogId = await writeGenerationLog({
                        ...logBase,
                        provider: 'finetuned',
                        model: finetunedModel,
                        route: routeName,
                        ab_bucket: 'finetuned',
                        latency_ms: latency,
                        status: 'success',
                    });
                    return {
                        id: `finetuned-${Date.now()}`,
                        type: 'message',
                        role: 'assistant',
                        model: finetunedModel,
                        provider: 'finetuned',
                        route: routeName,
                        ab_bucket: 'finetuned',
                        generationLogId,
                        content: [{ type: 'text', text: opt1Candidate.text }],
                        content_opt1: [{ type: 'text', text: opt1Candidate.text }],
                        content_opt2: [{ type: 'text', text: opt2Candidate.text }],
                    };
                }
            } catch (_) {
                finetunedFailed = true;
            }

            if (finetunedFailed) {
                console.warn(`[${routeName}] FINETUNED FALLBACK client_id=${maskClientId(scopedClientId)} USE_OPENAI=${process.env.USE_OPENAI} 时间=${new Date().toISOString()}`);
            }
        }

        if (process.env.USE_OPENAI === 'true') {
            const { generateCandidates } = require('../utils/openai');
            const systemPrompt = normalizedMessages.find((message) => message.role === 'system')?.content || '';
            const userMessages = normalizedMessages.filter((message) => message.role !== 'system');
            const temps = Array.isArray(temperature) ? temperature : [0.8, 0.4];
            const { opt1, opt2 } = await generateCandidates(systemPrompt, userMessages, temps);
            const latency = Date.now() - startTs;
            if (scopedClientId && !finetunedHookFired && resolvedScope.clientScope.owner) {
                const msgs = normalizeMessagesForMemory(normalizedMessages);
                setImmediate(() => {
                    extractAndSaveMemories({
                        client_id: scopedClientId,
                        owner: resolvedScope.clientScope.owner,
                        messages: msgs,
                        trigger_type: 'ai_generate',
                    }).catch(e => console.error('[memoryExtraction] replyGeneration openai hook error:', e.message));
                });
            }
            const openAiModel = process.env.OPENAI_MODEL || 'gpt-4o';
            const generationLogId = await writeGenerationLog({
                ...logBase,
                provider: 'openai',
                model: openAiModel,
                route: routeName,
                ab_bucket: 'openai',
                latency_ms: latency,
                status: 'success',
            });
            return {
                id: `openai-${Date.now()}`,
                type: 'message',
                role: 'assistant',
                model: openAiModel,
                provider: 'openai',
                route: routeName,
                ab_bucket: 'openai',
                generationLogId,
                content: [{ type: 'text', text: opt1 }],
                content_opt1: [{ type: 'text', text: opt1 }],
                content_opt2: [{ type: 'text', text: opt2 }],
            };
        }

        const apiKey = process.env.MINIMAX_API_KEY;
        if (!apiKey) {
            const error = new Error('MINIMAX_API_KEY environment variable not set');
            error.statusCode = 500;
            throw error;
        }

        const temps = Array.isArray(temperature) ? temperature : [0.8, 0.4];
        const candidateRequests = temps.map((temp, index) => (async () => {
            const response = await fetch('https://api.minimaxi.com/anthropic/v1/messages', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`,
                    'x-api-key': apiKey,
                    'anthropic-version': '2023-06-01',
                },
                body: JSON.stringify({
                    model: model || 'mini-max-typing',
                    messages: normalizedMessages,
                    max_tokens: maxTokens || 500,
                    temperature: temp,
                }),
                signal: AbortSignal.timeout(60000),
            });
            const payload = await response.json();
            if (!response.ok || payload?.error) {
                throw toRequestError(`MiniMax opt${index + 1}`, response, payload);
            }
            const text = extractResponseText(payload);
            if (!text) {
                throw new Error(`MiniMax opt${index + 1}: empty response`);
            }
            return { payload, text };
        })());

        let opt1Candidate;
        let opt2Candidate;
        try {
            [opt1Candidate, opt2Candidate] = await settleCandidateRequests(candidateRequests);
        } catch (error) {
            const generationLogId = await writeGenerationLog({
                ...logBase,
                provider: 'minimax',
                model: model || 'mini-max-typing',
                route: routeName,
                ab_bucket: 'minimax',
                latency_ms: Date.now() - startTs,
                status: 'failed',
                error_message: error.message,
            });
            error.generationLogWritten = true;
            error.generationLogId = generationLogId;
            error.statusCode = 502;
            error.clientPayload = {
                error: 'MiniMax API error',
                detail: error.message,
            };
            throw error;
        }

        const latency = Date.now() - startTs;
        if (scopedClientId && resolvedScope.clientScope.owner) {
            const msgs = normalizeMessagesForMemory(normalizedMessages);
            setImmediate(() => {
                extractAndSaveMemories({
                    client_id: scopedClientId,
                    owner: resolvedScope.clientScope.owner,
                    messages: msgs,
                    trigger_type: 'ai_generate',
                }).catch(e => console.error('[memoryExtraction] replyGeneration minimax hook error:', e.message));
            });
        }
        const resolvedModel = opt1Candidate?.payload?.model || model || 'mini-max-typing';
        const generationLogId = await writeGenerationLog({
            ...logBase,
            provider: 'minimax',
            model: resolvedModel,
            route: routeName,
            ab_bucket: 'minimax',
            latency_ms: latency,
            status: 'success',
        });
        return {
            id: opt1Candidate?.payload?.id || `minimax-${Date.now()}`,
            type: 'message',
            role: 'assistant',
            model: resolvedModel,
            provider: 'minimax',
            route: routeName,
            ab_bucket: 'minimax',
            generationLogId,
            content: [{ type: 'text', text: opt1Candidate.text }],
            content_opt1: [{ type: 'text', text: opt1Candidate.text }],
            content_opt2: [{ type: 'text', text: opt2Candidate.text }],
        };
    } catch (err) {
        if (!err.generationLogWritten) {
            await writeGenerationLog({
                ...logBase,
                provider: providerHint,
                model: model || null,
                route: routeName,
                ab_bucket: providerHint,
                status: 'failed',
                error_message: err.message,
            });
        }
        throw err;
    }
}

async function generateReplyCandidates({
    req,
    res,
    clientId,
    operator,
    scene,
    topicContext = '',
    richContext = '',
    conversationSummary = '',
    queryText = '',
    latestUserMessage = '',
    messages = [],
    model,
    maxTokens = 500,
    temperature = [0.8, 0.4],
    routeName = 'generate-candidates',
    appendReplyPromptIfLastAssistant = false,
}) {
    const normalizedConversationMessages = normalizeConversationMessages(messages, {
        appendReplyPromptIfLastAssistant,
    });
    const derivedLatestUserMessage = latestUserMessage
        || [...normalizedConversationMessages].reverse().find((message) => message.role === 'user')?.content
        || '';

    const promptPayload = await buildReplySystemPrompt({
        req,
        res,
        clientId,
        operator,
        scene,
        topicContext,
        richContext,
        conversationSummary,
        queryText,
        latestUserMessage: derivedLatestUserMessage,
    });
    if (!promptPayload) return null;

    const generationPayload = await generateCandidatesFromMessages({
        req,
        res,
        scope: promptPayload.scope,
        messages: [
            { role: 'system', content: promptPayload.systemPrompt },
            ...normalizedConversationMessages,
        ],
        model,
        maxTokens,
        temperature,
        clientId: promptPayload.clientId,
        retrievalSnapshotId: promptPayload.retrievalSnapshotId || null,
        scene,
        operator: promptPayload.operator,
        promptVersion: promptPayload.systemPromptVersion,
        routeName,
    });
    if (!generationPayload) return null;

    const opt1 = extractCandidateText(generationPayload);
    const opt2 = extractCandidateOpt2Text(generationPayload);

    return {
        opt1,
        opt2,
        systemPrompt: promptPayload.systemPrompt,
        systemPromptVersion: promptPayload.systemPromptVersion,
        version: promptPayload.systemPromptVersion,
        pipelineVersion: REPLY_PIPELINE_VERSION,
        pipeline_version: REPLY_PIPELINE_VERSION,
        operator: promptPayload.operator,
        operatorDisplayName: promptPayload.operatorDisplayName,
        operatorConfigured: promptPayload.operatorConfigured,
        scene,
        retrievalSnapshotId: promptPayload.retrievalSnapshotId || null,
        retrieval_snapshot_id: promptPayload.retrievalSnapshotId || null,
        generationLogId: generationPayload.generationLogId || null,
        generation_log_id: generationPayload.generationLogId || null,
        provider: generationPayload.provider || null,
        model: generationPayload.model || null,
    };
}

module.exports = {
    buildReplySystemPrompt,
    extractCandidateOpt2Text,
    extractCandidateText,
    generateCandidatesFromMessages,
    generateReplyCandidates,
    normalizeConversationMessages,
    resolveReplyRequestScope,
    resolveAiRequestScope: resolveReplyRequestScope,
    REPLY_PIPELINE_VERSION,
};
