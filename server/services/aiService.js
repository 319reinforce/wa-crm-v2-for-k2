/**
 * AI Service — MiniMax / OpenAI API 封装
 * 提取自 server/routes/ai.js
 */
const db = require('../../db');
const DEFAULT_MINIMAX_BASE = 'https://minimax.a7m.com.cn';
const DEFAULT_MINIMAX_MODEL = 'MiniMax-M2.7-highspeed';

function resolveMinimaxMessagesUrl(rawBase) {
    const input = String(rawBase || '').trim() || DEFAULT_MINIMAX_BASE;
    try {
        const url = new URL(input);
        const normalizedPath = url.pathname.replace(/\/+$/, '');
        const basePath = normalizedPath && normalizedPath !== '/'
            ? normalizedPath
            : '';
        const messagesPath = /\/v1$/i.test(basePath)
            ? `${basePath}/messages`
            : `${basePath}/v1/messages`;
        return `${url.origin}${messagesPath}`;
    } catch (_) {
        const normalized = input.replace(/\/+$/, '');
        return /\/v1$/i.test(normalized)
            ? `${normalized}/messages`
            : `${normalized}/v1/messages`;
    }
}

function resolveMinimaxModel(explicitModel) {
    const input = String(explicitModel || '').trim();
    if (input) return input;
    return String(process.env.MINIMAX_MODEL || '').trim() || DEFAULT_MINIMAX_MODEL;
}

// 翻译使用专用的 API Key 和 Base URL
const TRANSLATION_API_KEY = process.env.MINIMAX_TRANSLATION_API_KEY || process.env.MINIMAX_API_KEY;
const TRANSLATION_API_BASE = process.env.MINIMAX_TRANSLATION_API_BASE || process.env.MINIMAX_API_BASE || DEFAULT_MINIMAX_BASE;

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
    if (!TRANSLATION_API_KEY) {
        throw new Error('MINIMAX_TRANSLATION_API_KEY environment variable not set');
    }

    const temps = Array.isArray(temperatures) ? temperatures : [0.8, 0.4];
    const messagesUrl = resolveMinimaxMessagesUrl(TRANSLATION_API_BASE);
    const resolvedModel = resolveMinimaxModel(model);
    const [raw1, raw2] = await Promise.all([
        fetch(messagesUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${TRANSLATION_API_KEY}`,
                'x-api-key': TRANSLATION_API_KEY,
                'anthropic-version': '2023-06-01',
            },
            body: JSON.stringify({
                model: resolvedModel,
                messages,
                max_tokens: maxTokens || 500,
                temperature: temps[0],
            }),
            signal: AbortSignal.timeout(60000),
        }),
        fetch(messagesUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${TRANSLATION_API_KEY}`,
                'x-api-key': TRANSLATION_API_KEY,
                'anthropic-version': '2023-06-01',
            },
            body: JSON.stringify({
                model: resolvedModel,
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
const EN_TRANSLATION_SYSTEM_PROMPT = [
    'You are an English translation assistant for WhatsApp customer support.',
    'Translate the input into natural, concise English.',
    'Preserve the original meaning and polite tone.',
    'Do not add any promises, pricing, deadlines, or explanations.',
    'Output the translation only.',
].join('\n');

function resolveTranslationMode(mode) {
    const normalized = String(mode || '').trim().toLowerCase();
    return normalized === 'auto' ? 'auto' : 'to_zh';
}

function detectTranslationDirection(text) {
    const input = String(text || '');
    const hanCount = (input.match(/[\u3400-\u9fff]/g) || []).length;
    const latinCount = (input.match(/[A-Za-z]/g) || []).length;
    return hanCount > latinCount ? 'to_en' : 'to_zh';
}

function getSingleTranslationPrompt(mode, text) {
    const resolvedMode = resolveTranslationMode(mode);
    if (resolvedMode === 'auto') {
        return detectTranslationDirection(text) === 'to_en'
            ? EN_TRANSLATION_SYSTEM_PROMPT
            : TRANSLATION_SYSTEM_PROMPT;
    }
    return resolvedMode === 'to_en' ? EN_TRANSLATION_SYSTEM_PROMPT : TRANSLATION_SYSTEM_PROMPT;
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function requestMiniMaxText(messages, {
    model = resolveMinimaxModel(),
    maxTokens = 1000,
    temperature = 0.3,
    timeoutMs = 30000,
    retries = 4,
} = {}) {
    if (!TRANSLATION_API_KEY) {
        throw new Error('MINIMAX_TRANSLATION_API_KEY environment variable not set');
    }

    let lastError = null;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
        try {
            const response = await fetch(resolveMinimaxMessagesUrl(TRANSLATION_API_BASE), {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${TRANSLATION_API_KEY}`,
                    'x-api-key': TRANSLATION_API_KEY,
                    'anthropic-version': '2023-06-01',
                },
                body: JSON.stringify({
                    model,
                    max_tokens: maxTokens,
                    temperature,
                    messages,
                }),
                signal: AbortSignal.timeout(timeoutMs),
            });

            const data = await response.json();
            if (!response.ok || data?.error) {
                const detail = data?.error?.message || data?.error || `HTTP ${response.status}`;
                const isRetryable = response.status === 529 || /overloaded_error|rate limit|timeout/i.test(String(detail));
                if (isRetryable && attempt < retries) {
                    await sleep(1000 * Math.pow(2, attempt));
                    continue;
                }
                throw new Error(`MiniMax translation error: ${detail}`);
            }

            return data;
        } catch (error) {
            const isRetryable = /fetch failed|timeout|overloaded_error|rate limit/i.test(String(error?.message || ''));
            lastError = error;
            if (isRetryable && attempt < retries) {
                await sleep(1000 * Math.pow(2, attempt));
                continue;
            }
            throw error;
        }
    }
    throw lastError || new Error('MiniMax translation error: unknown failure');
}

/**
 * 单条翻译
 */
async function translateText(text, role = 'user', timestamp = null, mode = 'to_zh') {
    const data = await requestMiniMaxText([
        { role: 'system', content: getSingleTranslationPrompt(mode, text) },
        { role: 'user', content: text },
    ], {
        maxTokens: 220,
        temperature: 0,
    });
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
    if (!Array.isArray(texts) || texts.length === 0) {
        return { translations: [] };
    }

    const combined = texts
        .map((t, i) => `[${i + 1}] ${t.role === 'me' ? '我' : '达人'}: ${t.text}`)
        .join('\n');

    const data = await requestMiniMaxText([
        { role: 'system', content: TRANSLATION_SYSTEM_PROMPT },
        {
            role: 'user',
            content: `请将以下每条消息翻译为中文（不区分发送者，全部译为中文）。请严格按以下JSON数组格式返回，不要输出任何其他内容：\n[{"idx":1,"translation":"中文翻译"},{"idx":2,"translation":"中文翻译"}]\n\n消息列表：\n${combined}`,
        },
    ], {
        maxTokens: 1200,
        temperature: 0.1,
    });
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
