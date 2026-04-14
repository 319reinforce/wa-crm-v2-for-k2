/**
 * AI routes
 * POST /api/minimax, POST /api/translate, POST /api/ai/generate
 */
const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const db = require('../../db');
const aiService = require('../services/aiService');
const { extractAndSaveMemories } = require('../services/memoryExtractionService');
const { normalizeOperatorName } = require('../utils/operator');

// ========== 灰度路由辅助 ==========

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
        // OpenAI root API URL compatibility: /v1 -> /v1/chat/completions
        if (url.hostname === 'api.openai.com' && /^\/v1\/?$/.test(url.pathname)) {
            return `${url.origin}/v1/chat/completions`;
        }
        return input;
    } catch (_) {
        return input;
    }
}

function resolveFinetunedModel(baseUrl) {
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
        await db2.prepare(`
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
    } catch (err) {
        console.warn('[generationLog] write failed:', err.message);
    }
}

// POST /api/minimax — AI 生成路由（含 USE_FINETUNED 灰度）
router.post('/minimax', async (req, res) => {
    try {
        const { messages, model, max_tokens, temperature, client_id, retrieval_snapshot_id, scene, operator, prompt_version } = req.body;
        let finetunedHookFired = false;
        const startTs = Date.now();
        const logBase = {
            client_id,
            retrieval_snapshot_id: retrieval_snapshot_id || null,
            scene: scene || 'unknown',
            operator: normalizeOperatorName(operator, operator),
            temperature,
            message_count: Array.isArray(messages) ? messages.length : 0,
            prompt_version: prompt_version || null,
            latency_ms: null,
        };

        // 隔离校验：client_id 必须在 creators 表中存在
        if (client_id) {
            const db2 = db.getDb();
            const valid = await db2.prepare('SELECT id FROM creators WHERE wa_phone = ?').get(client_id);
            if (!valid) {
                return res.status(403).json({ error: '无效的 client_id' });
            }
        }

        // === 灰度路由：AB_RATIO 流量走微调模型 ===
        if (shouldUseFinetuned()) {
            const FINETUNED_BASE = resolveFinetunedBase(process.env.FINETUNED_BASE);
            const FINETUNED_KEY = process.env.FINETUNED_API_KEY || 'EMPTY';
            const FINETUNED_MODEL = resolveFinetunedModel(FINETUNED_BASE);
            if (!FINETUNED_MODEL) {
                throw new Error('FINETUNED_MODEL is required when USE_FINETUNED=true');
            }
            const temps = Array.isArray(temperature) ? temperature : [0.8, 0.4];

            let finetunedFailed = false;
            try {
                const candidateRequests = temps.map((temp, index) => (async () => {
                    const response = await fetch(FINETUNED_BASE, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${FINETUNED_KEY}`,
                        },
                        body: JSON.stringify({
                            model: FINETUNED_MODEL,
                            messages,
                            max_tokens: max_tokens || 500,
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
                    const okResponse = {
                        id: 'finetuned-' + Date.now(),
                        type: 'message',
                        role: 'assistant',
                        model: FINETUNED_MODEL,
                        content: [{ type: 'text', text: opt1Candidate.text }],
                        content_opt1: [{ type: 'text', text: opt1Candidate.text }],
                        content_opt2: [{ type: 'text', text: opt2Candidate.text }],
                    };
                    // === client_memory 自动积累：Finetuned 路由 AI 生成成功后 ===
                    if (client_id) {
                        const msgs = normalizeMessagesForMemory(messages);
                        const ownerRow = await db.getDb().prepare('SELECT wa_owner FROM creators WHERE wa_phone = ?').get(client_id);
                        if (ownerRow) {
                            finetunedHookFired = true;
                            setImmediate(() => {
                                extractAndSaveMemories({
                                    client_id,
                                    owner: normalizeOperatorName(ownerRow.wa_owner, ownerRow.wa_owner),
                                    messages: msgs,
                                    trigger_type: 'ai_generate',
                                }).catch(e => console.error('[memoryExtraction] minimax hook error:', e.message));
                            });
                        }
                    }
                    await writeGenerationLog({
                        ...logBase,
                        provider: 'finetuned',
                        model: FINETUNED_MODEL,
                        route: 'minimax',
                        ab_bucket: 'finetuned',
                        latency_ms: latency,
                        status: 'success',
                    });
                    return res.json(okResponse);
                }
            } catch (_) {
                finetunedFailed = true;
            }

            // 监控：记录 finetuned fallback 事件（用于 AB 测分析）
            if (finetunedFailed) {
                console.warn(`[minimax路由] FINETUNED FALLBACK client_id=${maskClientId(client_id)} USE_OPENAI=${process.env.USE_OPENAI} 时间=${new Date().toISOString()}`);
            }

            // Finetuned 失败后继续走下方 OpenAI / MiniMax 默认链路
        }

        if (process.env.USE_OPENAI === 'true') {
            // OpenAI 路由
            const { generateCandidates } = require('../utils/openai');
            const systemPrompt = messages.find(m => m.role === 'system')?.content || '';
            const userMsgs = messages.filter(m => m.role !== 'system');
            const temps = Array.isArray(temperature) ? temperature : [0.8, 0.4];
            const { opt1, opt2 } = await generateCandidates(systemPrompt, userMsgs, temps);
            const latency = Date.now() - startTs;
            // === client_memory 自动积累：仅在 Finetuned 未触发时执行 ===
            if (client_id && !finetunedHookFired) {
                const msgs = normalizeMessagesForMemory(messages);
                const ownerRow = await db.getDb().prepare('SELECT wa_owner FROM creators WHERE wa_phone = ?').get(client_id);
                if (ownerRow) {
                    setImmediate(() => {
                        extractAndSaveMemories({
                            client_id,
                            owner: normalizeOperatorName(ownerRow.wa_owner, ownerRow.wa_owner),
                            messages: msgs,
                            trigger_type: 'ai_generate',
                        }).catch(e => console.error('[memoryExtraction] minimax hook error:', e.message));
                    });
                }
            }
            await writeGenerationLog({
                ...logBase,
                provider: 'openai',
                model: process.env.OPENAI_MODEL || 'gpt-4o',
                route: 'minimax',
                ab_bucket: 'openai',
                latency_ms: latency,
                status: 'success',
            });
            return res.json({
                id: 'openai-' + Date.now(),
                type: 'message',
                role: 'assistant',
                model: process.env.OPENAI_MODEL || 'gpt-4o',
                content: [{ type: 'text', text: opt1 }],
                content_opt1: [{ type: 'text', text: opt1 }],
                content_opt2: [{ type: 'text', text: opt2 }],
            });
        }

        // MiniMax 路由（默认）：内部并发两个温度
        const API_KEY = process.env.MINIMAX_API_KEY;
        if (!API_KEY) {
            return res.status(500).json({ error: 'MINIMAX_API_KEY environment variable not set' });
        }

        const tempsMM = Array.isArray(temperature) ? temperature : [0.8, 0.4];
        const candidateRequests = tempsMM.map((temp, index) => (async () => {
            const response = await fetch('https://api.minimaxi.com/anthropic/v1/messages', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${API_KEY}`,
                    'x-api-key': API_KEY,
                    'anthropic-version': '2023-06-01',
                },
                body: JSON.stringify({
                    model: model || 'mini-max-typing',
                    messages,
                    max_tokens: max_tokens || 500,
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
            await writeGenerationLog({
                ...logBase,
                provider: 'minimax',
                model: model || 'mini-max-typing',
                route: 'minimax',
                ab_bucket: 'minimax',
                latency_ms: Date.now() - startTs,
                status: 'failed',
                error_message: error.message,
            });
            return res.status(502).json({
                error: 'MiniMax API error',
                detail: error.message,
            });
        }
        const latency = Date.now() - startTs;
        // === client_memory 自动积累：MiniMax 路由 AI 生成成功后 ===
        if (client_id) {
            const msgs = normalizeMessagesForMemory(messages);
            const ownerRow = await db.getDb().prepare('SELECT wa_owner FROM creators WHERE wa_phone = ?').get(client_id);
            if (ownerRow) {
                setImmediate(() => {
                    extractAndSaveMemories({
                        client_id,
                        owner: normalizeOperatorName(ownerRow.wa_owner, ownerRow.wa_owner),
                        messages: msgs,
                        trigger_type: 'ai_generate',
                    }).catch(e => console.error('[memoryExtraction] minimax hook error:', e.message));
                });
            }
        }
        await writeGenerationLog({
            ...logBase,
            provider: 'minimax',
            model: opt1Candidate?.payload?.model || model || 'mini-max-typing',
            route: 'minimax',
            ab_bucket: 'minimax',
            latency_ms: latency,
            status: 'success',
        });
        return res.json({
            id: opt1Candidate?.payload?.id || 'minimax-' + Date.now(),
            type: 'message',
            role: 'assistant',
            model: opt1Candidate?.payload?.model || 'mini-max',
            content: [{ type: 'text', text: opt1Candidate.text }],
            content_opt1: [{ type: 'text', text: opt1Candidate.text }],
            content_opt2: [{ type: 'text', text: opt2Candidate.text }],
        });
    } catch (err) {
        console.error('MiniMax proxy error:', err);
        await writeGenerationLog({
            client_id: req.body?.client_id || null,
            retrieval_snapshot_id: req.body?.retrieval_snapshot_id || null,
            provider: process.env.USE_OPENAI === 'true' ? 'openai' : 'minimax',
            model: req.body?.model || null,
            route: 'minimax',
            ab_bucket: null,
            scene: req.body?.scene || 'unknown',
            operator: normalizeOperatorName(req.body?.operator, req.body?.operator),
            temperature: req.body?.temperature || null,
            message_count: Array.isArray(req.body?.messages) ? req.body.messages.length : 0,
            prompt_version: req.body?.prompt_version || null,
            latency_ms: null,
            status: 'failed',
            error_message: err.message,
        });
        res.status(500).json({ error: err.message });
    }
});

// POST /api/ai/system-prompt — 构建完整 system prompt（与 sft-export 对齐）
// 前端 generateViaExperienceRouter 调用此端点获取统一 prompt，再调 /api/minimax
router.post('/ai/system-prompt', async (req, res) => {
    try {
        const {
            client_id,
            scene,
            operator,
            topicContext,
            richContext,
            conversationSummary,
            query_text,
            latest_user_message,
        } = req.body;

        if (!scene) {
            return res.status(400).json({ error: 'scene is required' });
        }

        const { buildFullSystemPrompt } = require('../../systemPromptBuilder.cjs');
        const retrievalQueryText = [query_text, latest_user_message, topicContext, richContext, conversationSummary]
            .filter((item) => typeof item === 'string' && item.trim())
            .join('\n\n');

        // Determine operator (from client_id lookup or explicit override)
        let resolvedOperator = normalizeOperatorName(operator, null);
        if (!resolvedOperator && client_id) {
            const row = await db.getDb().prepare('SELECT wa_owner FROM creators WHERE wa_phone = ?').get(client_id);
            if (row) resolvedOperator = normalizeOperatorName(row.wa_owner, null);
        }

        const { prompt, version: _ignored, grounding } = await buildFullSystemPrompt(client_id, scene, [], {
            operator: resolvedOperator,
            topicContext: topicContext || '',
            richContext: richContext || '',
            conversationSummary: conversationSummary || '',
            retrievalQueryText,
            systemPromptVersion: 'v2',
        });
        let version = 'v2_base';
        if (resolvedOperator) {
            const memFlag = (grounding?.memory?.length || 0) > 0 ? '_mem' : '';
            const polFlag = (grounding?.policies?.length || 0) > 0 ? '_pol' : '';
            version = `v2_${resolvedOperator}${memFlag}${polFlag}`;
        }

        const snapshotHash = sha256(JSON.stringify({
            client_id: client_id || null,
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
            client_id,
            operator: resolvedOperator,
            scene,
            system_prompt_version: version,
            snapshot_hash: snapshotHash,
            grounding_json: grounding || {},
            topic_context: topicContext || '',
            rich_context: richContext || '',
            conversation_summary: conversationSummary || '',
        });

        let operatorDisplayName = resolvedOperator || null;
        let operatorConfigured = false;
        if (resolvedOperator) {
            const exp = await db.getDb().prepare(
                'SELECT display_name FROM operator_experiences WHERE operator = ? AND is_active = 1'
            ).get(resolvedOperator);
            operatorDisplayName = exp?.display_name || resolvedOperator;
            operatorConfigured = !!exp;
        }

        res.json({
            systemPrompt: prompt,
            version,
            operator: resolvedOperator,
            operatorDisplayName,
            operatorConfigured,
            retrieval_snapshot_id: retrievalSnapshotId,
        });
    } catch (err) {
        console.error('POST /api/ai/system-prompt error:', err);
        res.status(500).json({ error: err.message });
    }
});

// POST /api/translate — 翻译接口（固定 MiniMax + 系统提示）
router.post('/translate', async (req, res) => {
    try {
        const { text, role, timestamp, texts } = req.body;
        if (text !== undefined) {
            const result = await aiService.translateText(text, role, timestamp);
            return res.json(result);
        }

        if (!Array.isArray(texts) || texts.length === 0) {
            return res.json([]);
        }

        const result = await aiService.translateBatch(texts);
        return res.json(result);
    } catch (err) {
        console.error('POST /api/translate error:', err);
        res.status(500).json({ error: err.message });
    }
});

// POST /api/ai/generate — 独立 OpenAI 生成接口
router.post('/ai/generate', async (req, res) => {
    try {
        const { messages, systemPrompt, temperatures = [0.8, 0.4] } = req.body;

        if (!messages || !Array.isArray(messages)) {
            return res.status(400).json({ success: false, error: 'messages is required and must be an array' });
        }

        if (process.env.USE_OPENAI !== 'true') {
            return res.status(503).json({
                success: false,
                error: 'OpenAI not enabled. Set USE_OPENAI=true in .env to enable.',
                provider: 'minimax',
            });
        }

        const { generateCandidates } = require('../utils/openai');
        const candidates = await generateCandidates(systemPrompt || '', messages, temperatures);
        res.json({ success: true, candidates });
    } catch (err) {
        console.error('AI generate error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;
