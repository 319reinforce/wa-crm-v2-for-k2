/**
 * AI routes
 * POST /api/minimax, POST /api/translate, POST /api/ai/generate
 */
const express = require('express');
const router = express.Router();
const db = require('../../db');

// ***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED*** 灰度路由辅助 ***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED***

function shouldUseFinetuned() {
    if (process.env.USE_FINETUNED !***REMOVED*** 'true') return false;
    const ratio = parseFloat(process.env.AB_RATIO || '0.1');
    return Math.random() < ratio;
}

// POST /api/minimax — AI 生成路由（含 USE_FINETUNED 灰度）
router.post('/minimax', async (req, res) => {
    try {
        const { messages, model, max_tokens, temperature, client_id } = req.body;

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
                const [raw1, raw2] = await Promise.all([
                    fetch(FINETUNED_BASE, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${FINETUNED_KEY}`,
                        },
                        body: JSON.stringify({
                            model: 'wa-crm-finetuned',
                            messages,
                            max_tokens: max_tokens || 500,
                            temperature: temps[0],
                        }),
                        signal: AbortSignal.timeout(15000),
                    }),
                    fetch(FINETUNED_BASE, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${FINETUNED_KEY}`,
                        },
                        body: JSON.stringify({
                            model: 'wa-crm-finetuned',
                            messages,
                            max_tokens: max_tokens || 500,
                            temperature: temps[1],
                        }),
                        signal: AbortSignal.timeout(15000),
                    }),
                ]);

                const [data1, data2] = await Promise.all([raw1.json(), raw2.json()]);
                if (!raw1.ok || !raw2.ok) {
                    finetunedFailed = true;
                } else {
                    const extractText = (d) => d?.choices?.[0]?.message?.content || '';
                    return res.json({
                        id: 'finetuned-' + Date.now(),
                        type: 'message',
                        role: 'assistant',
                        model: 'wa-crm-finetuned',
                        content: [{ type: 'text', text: extractText(data1) }],
                        content_opt2: [{ type: 'text', text: extractText(data2) }],
                    });
                }
            } catch (_) {
                finetunedFailed = true;
            }

            // Finetuned 失败时静默 fallback 到 OpenAI（不在错误路径停留）
            if (finetunedFailed && process.env.USE_OPENAI !***REMOVED*** 'true') {
                // USE_OPENAI 也不可用时再报 502
                return res.status(502).json({ error: 'Finetuned model unavailable, OpenAI not enabled', detail: 'both finetuned and OpenAI unavailable' });
            }
            // finetuned 失败但 USE_OPENAI=true → 继续走到下方 OpenAI 路由
        }

        if (process.env.USE_OPENAI ***REMOVED***= 'true') {
            // OpenAI 路由
            const { generateCandidates } = require('../../src/utils/openai');
            const systemPrompt = messages.find(m => m.role ***REMOVED***= 'system')?.content || '';
            const userMsgs = messages.filter(m => m.role !***REMOVED*** 'system');
            const temps = Array.isArray(temperature) ? temperature : [0.8, 0.4];
            const { opt1, opt2 } = await generateCandidates(systemPrompt, userMsgs, temps);
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
        const [raw1, raw2] = await Promise.all([
            fetch('https://api.minimaxi.com/anthropic/v1/messages', {
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
                    temperature: tempsMM[0],
                }),
                signal: AbortSignal.timeout(60000),
            }),
            fetch('https://api.minimaxi.com/anthropic/v1/messages', {
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
                    temperature: tempsMM[1],
                }),
                signal: AbortSignal.timeout(60000),
            }),
        ]);
        const [data1, data2] = await Promise.all([raw1.json(), raw2.json()]);

        // 检查 API 错误
        if (!raw1.ok || !raw2.ok || data1?.error || data2?.error) {
            const err1 = data1?.error?.message || (raw1.ok ? '' : `HTTP ${raw1.status}`);
            const err2 = data2?.error?.message || (raw2.ok ? '' : `HTTP ${raw2.status}`);
            return res.status(502).json({
                error: 'MiniMax API error',
                detail: raw1.ok && raw2.ok ? (data1?.error?.message || data2?.error?.message) : `${err1} / ${err2}`,
            });
        }

        const extractText = (d) => {
            // OpenAI format: { choices: [{ message: { content: "..." } }] }
            if (d?.choices?.[0]?.message?.content) {
                return d.choices[0].message.content;
            }
            // MiniMax format: { content: { type: 'text', text: '...' } } 或 [{ type: 'text', text: '...' }]
            if (d?.content) {
                if (Array.isArray(d.content)) {
                    return d.content.find(c => c.type ***REMOVED***= 'text')?.text || '';
                }
                if (typeof d.content ***REMOVED***= 'object' && d.content.type ***REMOVED***= 'text') {
                    return d.content.text || '';
                }
            }
            return '';
        };
        return res.json({
            id: data1?.id || 'minimax-' + Date.now(),
            type: 'message',
            role: 'assistant',
            model: data1?.model || 'mini-max',
            content: [{ type: 'text', text: extractText(data1) }],
            content_opt2: [{ type: 'text', text: extractText(data2) }],
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
        const { prompt, version } = buildFullSystemPrompt(client_id, scene, [], {
            operator: operator || null,
            topicContext: topicContext || '',
            richContext: richContext || '',
            conversationSummary: conversationSummary || '',
            systemPromptVersion: 'v2',
        });

        res.json({ systemPrompt: prompt, version });
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
