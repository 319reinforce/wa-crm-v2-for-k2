/**
 * OpenAI 官方 SDK 调用封装
 */
const OpenAI = require('openai');

function getApiKey() {
    return process.env.OPENAI_API_KEY;
}

function getBaseUrl() {
    const base = process.env.OPENAI_API_BASE || 'https://api.minimaxi.com/anthropic';
    return String(base).replace(/\/+$/, '');
}

function getModel() {
    return process.env.OPENAI_MODEL || process.env.MINIMAX_MODEL || 'MiniMax-M2.7-highspeed';
}

function createClient() {
    const apiKey = getApiKey();
    if (!apiKey || apiKey === 'sk-YourKeyHere') {
        throw new Error('OpenAI API key not configured. Set OPENAI_API_KEY in .env');
    }

    return new OpenAI({
        apiKey,
        baseURL: getBaseUrl(),
        timeout: 60000,
        maxRetries: 2,
    });
}

function extractMessageContent(content) {
    if (typeof content === 'string') return content.trim();
    if (Array.isArray(content)) {
        return content
            .map((part) => {
                if (typeof part === 'string') return part;
                if (part?.type === 'text') return part.text || '';
                return part?.text || '';
            })
            .filter(Boolean)
            .join('\n')
            .trim();
    }
    return '';
}

/**
 * 生成单条回复
 * @param {Array} messages - [{role: 'system'|'user'|'assistant', content: string}]
 * @param {Object} opts - { temperature, maxTokens, model }
 * @returns {Promise<string>}
 */
async function generateResponse(messages, opts = {}) {
    const client = createClient();
    const {
        temperature = 0.7,
        maxTokens = 500,
        model = getModel(),
    } = opts;

    const completion = await client.chat.completions.create({
        model,
        messages,
        temperature,
        max_tokens: maxTokens,
    });

    return extractMessageContent(completion.choices?.[0]?.message?.content);
}

/**
 * 并发生成两个候选回复
 * @param {string} systemPrompt
 * @param {Array} userMessages - [{role: 'user'|'assistant', content: string}]
 * @param {Array} temperatures - [temp1, temp2]，默认 [0.8, 0.4]
 * @returns {Promise<{opt1: string, opt2: string, model: string}>}
 */
async function generateCandidates(systemPrompt, userMessages, temperatures = [0.8, 0.4]) {
    const resolvedModel = getModel();
    const settled = await Promise.allSettled(
        temperatures.map((t) =>
            generateResponse(
                [
                    { role: 'system', content: systemPrompt },
                    ...userMessages,
                ],
                { temperature: t, model: resolvedModel }
            )
        )
    );

    const successes = settled
        .filter((item) => item.status === 'fulfilled' && item.value)
        .map((item) => item.value);

    if (successes.length === 0) {
        const failure = settled.find((item) => item.status === 'rejected');
        throw failure?.reason || new Error('OpenAI candidate generation failed');
    }

    if (successes.length === 1) {
        return { opt1: successes[0], opt2: successes[0], model: resolvedModel };
    }

    return { opt1: successes[0], opt2: successes[1], model: resolvedModel };
}

module.exports = { generateResponse, generateCandidates, getModel };
