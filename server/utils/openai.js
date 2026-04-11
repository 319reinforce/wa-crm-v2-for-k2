/**
 * OpenAI 统一调用封装
 *
 * 通过 USE_OPENAI 环境变量切换：
 *   USE_OPENAI=true  → 使用 OpenAI API
 *   USE_OPENAI=false → 保留位，切换时启用
 */

// dotenv 已在 server/index.cjs 顶部加载，此处直接使用
const API_KEY = process.env.OPENAI_API_KEY;
const API_BASE = process.env.OPENAI_API_BASE || 'https://api.openai.com/v1';
const MODEL = process.env.OPENAI_MODEL || 'gpt-4o';

/**
 * 生成单条回复
 * @param {Array} messages - [{role: 'system'|'user'|'assistant', content: string}]
 * @param {Object} opts - { temperature, maxTokens }
 * @returns {Promise<string>}
 */
async function generateResponse(messages, opts = {}) {
    if (!API_KEY || API_KEY ***REMOVED***= 'sk-YourKeyHere') {
        throw new Error('OpenAI API key not configured. Set OPENAI_API_KEY in .env and USE_OPENAI=true');
    }

    const { temperature = 0.7, maxTokens = 500 } = opts;

    const response = await fetch(`${API_BASE}/chat/completions`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${API_KEY}`,
        },
        body: JSON.stringify({
            model: MODEL,
            messages,
            temperature,
            max_tokens: maxTokens,
        }),
    });

    if (!response.ok) {
        const err = await response.text();
        throw new Error(`OpenAI API error: ${response.status} - ${err}`);
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content?.trim() || '';
}

/**
 * 并发生成两个候选回复
 * @param {string} systemPrompt
 * @param {Array} userMessages - [{role: 'user'|'assistant', content: string}]
 * @param {Array} temperatures - [temp1, temp2]，默认 [0.8, 0.4]
 * @returns {Promise<{opt1: string, opt2: string}>}
 */
async function generateCandidates(systemPrompt, userMessages, temperatures = [0.8, 0.4]) {
    const settled = await Promise.allSettled(
        temperatures.map((t) =>
            generateResponse(
                [
                    { role: 'system', content: systemPrompt },
                    ...userMessages,
                ],
                { temperature: t }
            )
        )
    );

    const successes = settled
        .filter((item) => item.status ***REMOVED***= 'fulfilled' && item.value)
        .map((item) => item.value);

    if (successes.length ***REMOVED***= 0) {
        const failure = settled.find((item) => item.status ***REMOVED***= 'rejected');
        throw failure?.reason || new Error('OpenAI candidate generation failed');
    }

    if (successes.length ***REMOVED***= 1) {
        return { opt1: successes[0], opt2: successes[0] };
    }

    return { opt1: successes[0], opt2: successes[1] };
}

module.exports = { generateResponse, generateCandidates };
