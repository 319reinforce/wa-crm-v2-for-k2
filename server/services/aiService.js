/**
 * AI Service — MiniMax / OpenAI API 封装
 * 提取自 server/routes/ai.js
 */
const db = require('../../db');

const API_KEY = process.env.MINIMAX_API_KEY;
const API_BASE = process.env.MINIMAX_API_BASE || 'https://api.minimaxi.com/anthropic';

/**
 * 验证 client_id 是否在 creators 表中
 */
async function validateClientId(clientId) {
    if (!clientId) return true; // optional
    const db2 = db.getDb();
    const valid = await db2.prepare('SELECT id FROM creators WHERE wa_phone = ?').get(clientId);
    return !!valid;
}

/**
 * 提取 MiniMax API 响应中的文本
 */
function extractTextFromResponse(data) {
    return data?.content?.find(c => c.type === 'text')?.text || '';
}

/**
 * MiniMax 对话生成（并发双温度）
 * @returns {{ content, content_opt2 }}
 */
async function generateWithDualTemperature(messages, model, maxTokens, temperatures) {
    if (!API_KEY) {
        throw new Error('MINIMAX_API_KEY environment variable not set');
    }

    const temps = Array.isArray(temperatures) ? temperatures : [0.8, 0.4];
    const [raw1, raw2] = await Promise.all([
        fetch(`${API_BASE}/v1/messages`, {
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
                max_tokens: maxTokens || 500,
                temperature: temps[0],
            }),
            signal: AbortSignal.timeout(60000),
        }),
        fetch(`${API_BASE}/v1/messages`, {
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
                max_tokens: maxTokens || 500,
                temperature: temps[1],
            }),
            signal: AbortSignal.timeout(60000),
        }),
    ]);

    const [data1, data2] = await Promise.all([raw1.json(), raw2.json()]);
    return {
        content: [{ type: 'text', text: extractTextFromResponse(data1) }],
        content_opt2: [{ type: 'text', text: extractTextFromResponse(data2) }],
        model: data1?.model || 'mini-max',
        id: data1?.id || 'minimax-' + Date.now(),
    };
}

const TRANSLATION_SYSTEM_PROMPT = '你是中文翻译助手，专注把收到的文本翻译成中文。不要解释其他内容，直接输出纯中文翻译。';

/**
 * 单条翻译
 */
async function translateText(text, role = 'user', timestamp = null) {
    if (!API_KEY) {
        throw new Error('MINIMAX_API_KEY environment variable not set');
    }

    const response = await fetch(`${API_BASE}/v1/messages`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${API_KEY}`,
            'x-api-key': API_KEY,
            'anthropic-version': '2023-06-01',
        },
            body: JSON.stringify({
                model: 'mini-max-typing',
                max_tokens: 1000,
                temperature: 0.3,
                messages: [
                    { role: 'system', content: TRANSLATION_SYSTEM_PROMPT },
                    { role: 'user', content: text },
                ],
            }),
            signal: AbortSignal.timeout(30000),
        });

    const data = await response.json();
    let raw = '';
    if (data.content && Array.isArray(data.content)) {
        const textItem = data.content.find(item => item.type === 'text');
        raw = textItem?.text || '';
    } else {
        raw = data.content?.text || data.content || '';
    }

    const translation = (typeof raw === 'string' ? raw.trim() : '') || text;
    return { translation, timestamp };
}

/**
 * 批量翻译
 */
async function translateBatch(texts) {
    if (!API_KEY) {
        throw new Error('MINIMAX_API_KEY environment variable not set');
    }
    if (!Array.isArray(texts) || texts.length === 0) {
        return { translations: [] };
    }

    const combined = texts
        .map((t, i) => `[${i + 1}] ${t.role === 'me' ? '我' : '达人'}: ${t.text}`)
        .join('\n');

    const response = await fetch(`${API_BASE}/v1/messages`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${API_KEY}`,
            'x-api-key': API_KEY,
            'anthropic-version': '2023-06-01',
        },
            body: JSON.stringify({
                model: 'mini-max-typing',
                max_tokens: 1000,
                temperature: 0.3,
                messages: [
                    { role: 'system', content: TRANSLATION_SYSTEM_PROMPT },
                    {
                        role: 'user',
                        content: `请将以下每条消息翻译为中文（不区分发送者，全部译为中文）。请严格按以下JSON数组格式返回，不要输出任何其他内容：\n[{"idx":1,"translation":"中文翻译"},{"idx":2,"translation":"中文翻译"}]\n\n消息列表：\n${combined}`,
                    },
                ],
            }),
        signal: AbortSignal.timeout(30000),
    });

    const data = await response.json();
    let raw = '';
    if (data.content && Array.isArray(data.content)) {
        const textItem = data.content.find(item => item.type === 'text');
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

    return { translations };
}

module.exports = {
    validateClientId,
    extractTextFromResponse,
    generateWithDualTemperature,
    translateText,
    translateBatch,
};
