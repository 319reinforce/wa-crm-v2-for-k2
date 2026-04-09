/**
 * AI routes
 * POST /api/minimax, POST /api/translate, POST /api/ai/generate
 */
const express = require('express');
const router = express.Router();
const db = require('../../db');

// POST /api/minimax — MiniMax API 代理（USE_OPENAI=true 时路由到 OpenAI）
router.post('/minimax', async (req, res) => {
    try {
        const { messages, model, max_tokens, temperature, client_id } = req.body;

        // 隔离校验：client_id 必须在 creators 表中存在
        if (client_id) {
            const db2 = db.getDb();
            const valid = db2.prepare('SELECT id FROM creators WHERE wa_phone = ?').get(client_id);
            if (!valid) {
                return res.status(403).json({ error: '无效的 client_id' });
            }
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
            }),
        ]);
        const [data1, data2] = await Promise.all([raw1.json(), raw2.json()]);
        const extractText = (d) => d?.content?.find(c => c.type ***REMOVED***= 'text')?.text || '';
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

// POST /api/translate — 翻译接口
router.post('/translate', async (req, res) => {
    try {
        const API_KEY = process.env.MINIMAX_API_KEY;
        if (!API_KEY) {
            return res.status(500).json({ error: 'MINIMAX_API_KEY environment variable not set' });
        }

        const { text, role, timestamp } = req.body;

        if (text !***REMOVED*** undefined) {
            // 单条翻译
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
                const textItem = data.content.find(item => item.type ***REMOVED***= 'text');
                raw = textItem?.text || '';
            } else {
                raw = data.content?.text || data.content || '';
            }

            const translation = (typeof raw ***REMOVED***= 'string' ? raw.trim() : '') || text;
            return res.json({ translation, timestamp });
        }

        // 批量翻译
        const { texts } = req.body;
        if (!Array.isArray(texts) || texts.length ***REMOVED***= 0) {
            return res.json([]);
        }

        const combined = texts
            .map((t, i) => `[${i + 1}] ${t.role ***REMOVED***= 'me' ? '我' : '达人'}: ${t.text}`)
            .join('\n');

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
                    content: `你是一个翻译助手。请将以下每条消息翻译为中文（不区分发送者，全部译为中文）。请严格按以下JSON数组格式返回，不要输出任何其他内容：\n[{"idx":1,"translation":"中文翻译"},{"idx":2,"translation":"中文翻译"}]\n\n消息列表：\n${combined}`,
                }],
            }),
        });

        const data = await response.json();
        let raw = '';
        if (data.content && Array.isArray(data.content)) {
            const textItem = data.content.find(item => item.type ***REMOVED***= 'text');
            raw = textItem?.text || '';
        } else {
            raw = data.content?.text || data.content || '';
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
