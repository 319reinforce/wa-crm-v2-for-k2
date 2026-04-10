/**
 * AI routes
 * POST /api/minimax, POST /api/translate, POST /api/ai/generate
 */
const express = require('express');
const router = express.Router();
const db = require('../../db');
const { extractAndSaveMemories } = require('../services/memoryExtractionService');
const { normalizeOperatorName } = require('../utils/operator');

// ***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED*** 灰度路由辅助 ***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED***

function shouldUseFinetuned() {
    if (process.env.USE_FINETUNED !***REMOVED*** 'true') return false;
    const ratio = parseFloat(process.env.AB_RATIO || '0.1');
    return Math.random() < ratio;
}

function normalizeMessagesForMemory(messages = []) {
    return messages
        .filter(m => m && m.role !***REMOVED*** 'system')
        .map((m) => {
            const normalizedRole = (m.role ***REMOVED***= 'assistant' || m.role ***REMOVED***= 'me') ? 'me' : 'user';
            let text = '';
            if (typeof m.text ***REMOVED***= 'string') {
                text = m.text;
            } else if (typeof m.content ***REMOVED***= 'string') {
                text = m.content;
            } else if (Array.isArray(m.content)) {
                text = m.content
                    .map((part) => typeof part ***REMOVED***= 'string' ? part : (part?.text || ''))
                    .filter(Boolean)
                    .join('\n');
            }
            return { role: normalizedRole, text };
        })
        .filter((m) => m.text);
}

function extractResponseText(payload) {
    if (typeof payload?.choices?.[0]?.message?.content ***REMOVED***= 'string') {
        return payload.choices[0].message.content.trim();
    }

    if (Array.isArray(payload?.choices?.[0]?.message?.content)) {
        return payload.choices[0].message.content
            .map((part) => typeof part ***REMOVED***= 'string' ? part : (part?.text || ''))
            .filter(Boolean)
            .join('\n')
            .trim();
    }

    if (Array.isArray(payload?.content)) {
        return payload.content
            .map((part) => typeof part ***REMOVED***= 'string' ? part : (part?.text || ''))
            .filter(Boolean)
            .join('\n')
            .trim();
    }

    if (payload?.content && typeof payload.content ***REMOVED***= 'object') {
        return String(payload.content.text || '').trim();
    }

    if (typeof payload?.content ***REMOVED***= 'string') {
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
        .filter((item) => item.status ***REMOVED***= 'fulfilled' && item.value?.text)
        .map((item) => item.value);

    if (successes.length ***REMOVED***= 0) {
        const failure = settled.find((item) => item.status ***REMOVED***= 'rejected');
        throw failure?.reason || new Error('All candidate requests failed');
    }

    if (successes.length ***REMOVED***= 1) {
        return [successes[0], successes[0]];
    }

    return [successes[0], successes[1]];
}

// POST /api/minimax — AI 生成路由（含 USE_FINETUNED 灰度）
router.post('/minimax', async (req, res) => {
    try {
        const { messages, model, max_tokens, temperature, client_id } = req.body;
        let finetunedHookFired = false;

        // 隔离校验：client_id 必须在 creators 表中存在
        if (client_id) {
            const db2 = db.getDb();
            const valid = await db2.prepare('SELECT id FROM creators WHERE wa_phone = ?').get(client_id);
            if (!valid) {
                return res.status(403).json({ error: '无效的 client_id' });
            }
        }

        // ***REMOVED***= 灰度路由：AB_RATIO 流量走微调模型 ***REMOVED***=
        if (shouldUseFinetuned()) {
            const FINETUNED_BASE = process.env.FINETUNED_BASE || 'http://localhost:8000/v1/messages';
            const FINETUNED_KEY = process.env.FINETUNED_API_KEY || 'EMPTY';
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
                            model: 'wa-crm-finetuned',
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
                    const okResponse = {
                        id: 'finetuned-' + Date.now(),
                        type: 'message',
                        role: 'assistant',
                        model: 'wa-crm-finetuned',
                        content: [{ type: 'text', text: opt1Candidate.text }],
                        content_opt2: [{ type: 'text', text: opt2Candidate.text }],
                    };
                    // ***REMOVED***= client_memory 自动积累：Finetuned 路由 AI 生成成功后 ***REMOVED***=
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
                    return res.json(okResponse);
                }
            } catch (_) {
                finetunedFailed = true;
            }

            // 监控：记录 finetuned fallback 事件（用于 AB 测分析）
            if (finetunedFailed) {
                console.warn(`[minimax路由] FINETUNED FALLBACK client_id=${client_id || 'unknown'} USE_OPENAI=${process.env.USE_OPENAI} 时间=${new Date().toISOString()}`);
            }

            // Finetuned 失败后继续走下方 OpenAI / MiniMax 默认链路
        }

        if (process.env.USE_OPENAI ***REMOVED***= 'true') {
            // OpenAI 路由
            const { generateCandidates } = require('../../src/utils/openai');
            const systemPrompt = messages.find(m => m.role ***REMOVED***= 'system')?.content || '';
            const userMsgs = messages.filter(m => m.role !***REMOVED*** 'system');
            const temps = Array.isArray(temperature) ? temperature : [0.8, 0.4];
            const { opt1, opt2 } = await generateCandidates(systemPrompt, userMsgs, temps);
            // ***REMOVED***= client_memory 自动积累：仅在 Finetuned 未触发时执行 ***REMOVED***=
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
            return res.json({
                id: 'openai-' + Date.now(),
                type: 'message',
                role: 'assistant',
                model: process.env.OPENAI_MODEL || 'gpt-4o',
                content: [{ type: 'text', text: opt1 }],
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
            return res.status(502).json({
                error: 'MiniMax API error',
                detail: error.message,
            });
        }
        // ***REMOVED***= client_memory 自动积累：MiniMax 路由 AI 生成成功后 ***REMOVED***=
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
        return res.json({
            id: opt1Candidate?.payload?.id || 'minimax-' + Date.now(),
            type: 'message',
            role: 'assistant',
            model: opt1Candidate?.payload?.model || 'mini-max',
            content: [{ type: 'text', text: opt1Candidate.text }],
            content_opt2: [{ type: 'text', text: opt2Candidate.text }],
        });
    } catch (err) {
        console.error('MiniMax proxy error:', err);
        res.status(500).json({ error: err.message });
    }
});

// POST /api/ai/system-prompt — 构建完整 system prompt（与 sft-export 对齐）
// 前端 generateViaExperienceRouter 调用此端点获取统一 prompt，再调 /api/minimax
router.post('/ai/system-prompt', async (req, res) => {
    try {
        const { client_id, scene, operator, topicContext, richContext, conversationSummary } = req.body;

        if (!scene) {
            return res.status(400).json({ error: 'scene is required' });
        }

        const { buildFullSystemPrompt } = require('../../systemPromptBuilder.cjs');

        // Determine operator (from client_id lookup or explicit override)
        let resolvedOperator = normalizeOperatorName(operator, null);
        if (!resolvedOperator && client_id) {
            const row = await db.getDb().prepare('SELECT wa_owner FROM creators WHERE wa_phone = ?').get(client_id);
            if (row) resolvedOperator = normalizeOperatorName(row.wa_owner, null);
        }

        // Derive dynamic version from generation context (not hardcoded)
        // Version = operator + flags for memory/policy presence
        let version = 'v2_base';
        if (resolvedOperator) {
            let memFlag = '', polFlag = '';
            // Check if client memory exists (these will be injected into prompt if present)
            if (client_id) {
                const memRows = await db.getDb().prepare('SELECT COUNT(*) as c FROM client_memory WHERE client_id = ?').get(client_id);
                memFlag = memRows?.c > 0 ? '_mem' : '';
                const polRows = await db.getDb().prepare("SELECT COUNT(*) as c FROM policy_documents WHERE is_active = 1 AND JSON_LENGTH(applicable_scenarios) > 0").get();
                polFlag = polRows?.c > 0 ? '_pol' : '';
            }
            version = `v2_${resolvedOperator}${memFlag}${polFlag}`;
        }

        const { prompt, version: _ignored } = await buildFullSystemPrompt(client_id, scene, [], {
            operator: resolvedOperator,
            topicContext: topicContext || '',
            richContext: richContext || '',
            conversationSummary: conversationSummary || '',
            systemPromptVersion: version,
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
        });
    } catch (err) {
        console.error('POST /api/ai/system-prompt error:', err);
        res.status(500).json({ error: err.message });
    }
});

// POST /api/translate — 翻译接口（USE_OPENAI=true 走 OpenAI，否则走 MiniMax）
router.post('/translate', async (req, res) => {
    try {
        const { text, role, timestamp } = req.body;
        const { texts } = req.body;

        // 单条翻译
        if (text !***REMOVED*** undefined) {
            if (process.env.USE_OPENAI ***REMOVED***= 'true') {
                const OPENAI_KEY = process.env.OPENAI_API_KEY;
                const OPENAI_BASE = process.env.OPENAI_API_BASE || 'https://api.openai.com/v1';
                const openaiRes = await fetch(`${OPENAI_BASE}/chat/completions`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${OPENAI_KEY}`,
                    },
                    body: JSON.stringify({
                        model: process.env.OPENAI_MODEL || 'gpt-4o',
                        max_tokens: 1000,
                        temperature: 0.3,
                        messages: [{
                            role: 'user',
                            content: `你是一个翻译助手。请将以下消息翻译为中文（全部译为中文，不区分发送者，直接给出中文翻译即可，不需要解释）：\n"${text}"`,
                        }],
                    }),
                    signal: AbortSignal.timeout(30000),
                });
                const openaiData = await openaiRes.json();
                const raw = openaiData.choices?.[0]?.message?.content || '';
                const translation = raw.trim() || text;
                return res.json({ translation, timestamp });
            } else {
                const API_KEY = process.env.MINIMAX_API_KEY;
                if (!API_KEY) return res.status(500).json({ error: 'MINIMAX_API_KEY not set' });
                const response = await fetch('https://api.minimaxi.com/anthropic/v1/messages', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'x-api-key': API_KEY,
                        'anthropic-version': '2023-06-01',
                    },
                    body: JSON.stringify({
                        model: 'mini-max-typing',
                        max_tokens: 1000,
                        temperature: 0.3,
                        messages: [{
                            role: 'user',
                            content: `你是一个翻译助手。请将以下消息翻译为中文（所有消息都译为中文，不区分发送者，直接给出中文翻译即可，不需要解释）：\n"${text}"`,
                        }],
                    }),
                });
                const data = await response.json();
                let raw = '';
                if (data.content && Array.isArray(data.content)) {
                    raw = data.content.find(item => item.type ***REMOVED***= 'text')?.text || '';
                } else {
                    raw = data.content?.text || data.content || '';
                }
                const translation = (typeof raw ***REMOVED***= 'string' ? raw.trim() : '') || text;
                return res.json({ translation, timestamp });
            }
        }

        // 批量翻译
        if (!Array.isArray(texts) || texts.length ***REMOVED***= 0) {
            return res.json([]);
        }

        const combined = texts
            .map((t, i) => `[${i + 1}] ${t.role ***REMOVED***= 'me' ? '我' : '达人'}: ${t.text}`)
            .join('\n');

        let raw;
        if (process.env.USE_OPENAI ***REMOVED***= 'true') {
            const OPENAI_KEY = process.env.OPENAI_API_KEY;
            const OPENAI_BASE = process.env.OPENAI_API_BASE || 'https://api.openai.com/v1';
            const openaiRes = await fetch(`${OPENAI_BASE}/chat/completions`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${OPENAI_KEY}`,
                },
                body: JSON.stringify({
                    model: process.env.OPENAI_MODEL || 'gpt-4o',
                    max_tokens: 2000,
                    temperature: 0.3,
                    messages: [{
                        role: 'user',
                        content: `你是一个翻译助手。请将以下每条消息翻译为中文（不区分发送者，全部译为中文）。请严格按以下JSON数组格式返回，不要输出任何其他内容，不要添加任何解释：\n[{"idx":1,"translation":"中文翻译"},{"idx":2,"translation":"中文翻译"}]\n\n消息列表：\n${combined}`,
                    }],
                }),
                signal: AbortSignal.timeout(30000),
            });
            const openaiData = await openaiRes.json();
            raw = openaiData.choices?.[0]?.message?.content || '';
        } else {
            const API_KEY = process.env.MINIMAX_API_KEY;
            if (!API_KEY) return res.status(500).json({ error: 'MINIMAX_API_KEY not set' });
            const response = await fetch('https://api.minimaxi.com/anthropic/v1/messages', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': API_KEY,
                    'anthropic-version': '2023-06-01',
                },
                body: JSON.stringify({
                    model: 'mini-max-typing',
                    max_tokens: 1000,
                    temperature: 0.3,
                    messages: [{
                        role: 'user',
                        content: `你是一个翻译助手。请将以下每条消息翻译为中文（不区分发送者，全部译为中文）。请严格按以下JSON数组格式返回，不要输出任何其他内容，不要添加任何解释：\n[{"idx":1,"translation":"中文翻译"},{"idx":2,"translation":"中文翻译"}]\n\n消息列表：\n${combined}`,
                    }],
                }),
            });
            const data = await response.json();
            if (data.content && Array.isArray(data.content)) {
                raw = data.content.find(item => item.type ***REMOVED***= 'text')?.text || '';
            } else {
                raw = data.content?.text || data.content || '';
            }
        }

        let translations = [];
        try {
            const jsonMatch = raw.match(/\[[\s\S]*\]/);
            if (jsonMatch) translations = JSON.parse(jsonMatch[0]);
        } catch (_) {
            translations = texts.map((t, i) => ({ idx: i + 1, translation: t.text }));
        }

        res.json({ translations });
    } catch (err) {
        console.error('Translate error:', err);
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

        if (process.env.USE_OPENAI !***REMOVED*** 'true') {
            return res.status(503).json({
                success: false,
                error: 'OpenAI not enabled. Set USE_OPENAI=true in .env to enable.',
                provider: 'minimax',
            });
        }

        const { generateCandidates } = require('../../src/utils/openai');
        const candidates = await generateCandidates(systemPrompt || '', messages, temperatures);
        res.json({ success: true, candidates });
    } catch (err) {
        console.error('AI generate error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;
