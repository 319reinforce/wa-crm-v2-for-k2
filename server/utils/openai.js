/**
 * OpenAI 统一调用封装 — Phase 1 (task-backend-wire)
 *
 * 用途分层:
 *   generateResponseFor(purpose, messages, opts) — 按 purpose 从 DB 取配置, 每次请求末尾记 usage
 *   createClientFor(purpose)                      — 按 purpose 构建 OpenAI SDK client + configId
 *
 * 老接口保留(向后兼容,内部转调新接口 purpose='generic-ai'):
 *   generateResponse(...)  → generateResponseFor('generic-ai', ...)
 *   generateCandidates(...) → generateCandidatesFor('generic-ai', ...)
 *   getModel()             → getActiveConfig('generic-ai').model, fallback env
 */

const OpenAI = require('openai');

// dotenv 已在 server/index.cjs 顶部加载, 以下仅作为 fallback 兜底
const ENV_API_KEY = process.env.OPENAI_API_KEY;
const ENV_API_BASE = process.env.OPENAI_API_BASE || 'https://api.minimaxi.com/anthropic';
const ENV_MODEL = process.env.OPENAI_MODEL || 'gpt-4o';

// ================== 新接口: purpose 驱动 ==================

/**
 * 按 purpose 从 DB 拿配置, 构建 OpenAI SDK client。
 * 返回 { client, configId, model, extra }
 */
async function createClientFor(purpose) {
    const svc = require('../services/aiProviderConfigService');
    const cfg = await svc.getActiveConfig(purpose);

    let apiKey, baseUrl, configId;
    if (cfg && cfg.api_key) {
        apiKey = cfg.api_key;
        baseUrl = String(cfg.base_url).replace(/\/+$/, '');
        configId = cfg.id;
    } else {
        console.warn(`[openai] no DB config for purpose=${purpose}, falling back to env`);
        apiKey = ENV_API_KEY;
        baseUrl = ENV_API_BASE.replace(/\/+$/, '');
        configId = null;
    }
    if (!apiKey || apiKey === 'sk-YourKeyHere') {
        throw new Error(`OpenAI API key not configured (purpose=${purpose}). Set via admin UI or OPENAI_API_KEY.`);
    }
    const client = new OpenAI({ apiKey, baseURL: baseUrl, timeout: 60000, maxRetries: 2 });
    return { client, configId, model: cfg?.model || ENV_MODEL, extra: cfg?.extra_params || {} };
}

/**
 * 生成单条回复 (purpose 版)
 * @param {string} purpose
 * @param {Array} messages - [{role: 'system'|'user'|'assistant', content: string}]
 * @param {Object} opts - { temperature?, maxTokens?, model?, source?, creator_id? }
 */
async function generateResponseFor(purpose, messages, opts = {}) {
    const { client, configId, model, extra } = await createClientFor(purpose);

    const { temperature = extra.temperature ?? 0.7,
            maxTokens   = extra.max_tokens ?? 500,
            model: modelOverride } = opts;

    const startedAt = Date.now();
    try {
        const completion = await client.chat.completions.create({
            model: modelOverride || model,
            messages,
            temperature,
            max_tokens: maxTokens,
        });

        // fire-and-forget, 绝不 await
        setImmediate(() => {
            const svc = require('../services/aiProviderConfigService');
            svc.recordUsage({
                provider_config_id: configId,
                purpose,
                model: modelOverride || model,
                tokens_prompt:    completion.usage?.prompt_tokens    || 0,
                tokens_completion: completion.usage?.completion_tokens || 0,
                tokens_total:      completion.usage?.total_tokens    || 0,
                latency_ms:        Date.now() - startedAt,
                status:            'ok',
                source:            opts.source     || null,
                creator_id:        opts.creator_id || null,
            });
        });

        return completion.choices?.[0]?.message?.content?.trim() || '';
    } catch (err) {
        setImmediate(() => {
            const svc = require('../services/aiProviderConfigService');
            svc.recordUsage({
                provider_config_id: configId,
                purpose,
                model: modelOverride || model,
                tokens_prompt: 0,
                tokens_completion: 0,
                tokens_total: 0,
                latency_ms: Date.now() - startedAt,
                status: 'error',
                error_message: err.message?.slice(0, 200) || String(err),
                source: opts.source || null,
                creator_id: opts.creator_id || null,
            });
        });
        throw err;
    }
}

/**
 * 并发生成两个候选回复 (purpose 版)
 * @param {string} purpose
 * @param {string} systemPrompt
 * @param {Array} userMessages
 * @param {Array} temperatures - [temp1, temp2], 默认 [0.8, 0.4]
 * @param {Object} opts - { source?, creator_id? }
 */
async function generateCandidatesFor(purpose, systemPrompt, userMessages, temperatures = [0.8, 0.4], opts = {}) {
    // 两次调用共用同一个 configId + source, 先拿 client
    const { client, configId, model, extra } = await createClientFor(purpose);

    const makeMessages = (t) => [
        { role: 'system', content: systemPrompt },
        ...userMessages,
    ];
    const defaultTemp = extra.temperature ?? 0.7;
    const defaultMax  = extra.max_tokens ?? 500;

    const startedAt = Date.now();
    const runs = temperatures.map(async (t) => {
        return client.chat.completions.create({
            model,
            messages: makeMessages(t),
            temperature: t,
            max_tokens: defaultMax,
        });
    });

    let completions;
    try {
        completions = await Promise.all(runs);
    } catch (err) {
        setImmediate(() => {
            const svc = require('../services/aiProviderConfigService');
            svc.recordUsage({
                provider_config_id: configId,
                purpose,
                model,
                tokens_prompt: 0, tokens_completion: 0, tokens_total: 0,
                latency_ms: Date.now() - startedAt,
                status: 'error',
                error_message: err.message?.slice(0, 200) || String(err),
                source: opts.source || null,
                creator_id: opts.creator_id || null,
            });
        });
        throw err;
    }

    const opt1 = completions[0]?.choices?.[0]?.message?.content?.trim() || '';
    const opt2 = completions[1]?.choices?.[0]?.message?.content?.trim() || '';

    setImmediate(() => {
        const svc = require('../services/aiProviderConfigService');
        const u1 = completions[0]?.usage || {};
        const u2 = completions[1]?.usage || {};
        svc.recordUsage({
            provider_config_id: configId,
            purpose,
            model,
            tokens_prompt:    (u1.prompt_tokens    || 0) + (u2.prompt_tokens    || 0),
            tokens_completion: (u1.completion_tokens || 0) + (u2.completion_tokens || 0),
            tokens_total:      (u1.total_tokens      || 0) + (u2.total_tokens      || 0),
            latency_ms: Date.now() - startedAt,
            status: 'ok',
            source: opts.source || null,
            creator_id: opts.creator_id || null,
        });
    });

    return { opt1, opt2 };
}

// ================== 老接口: generic-ai 兼容垫片 ==================

/**
 * 生成单条回复 (legacy)
 * @param {Array} messages
 * @param {Object} opts - { temperature, maxTokens, model }
 */
async function generateResponse(messages, opts = {}) {
    return generateResponseFor('generic-ai', messages, opts);
}

/**
 * 并发生成两个候选回复 (legacy)
 * @param {string} systemPrompt
 * @param {Array} userMessages
 * @param {Array} temperatures
 */
async function generateCandidates(systemPrompt, userMessages, temperatures = [0.8, 0.4]) {
    return generateCandidatesFor('generic-ai', systemPrompt, userMessages, temperatures, {});
}

/**
 * 获取当前默认模型名 (向后兼容)
 * 优先从 DB 的 generic-ai 配置读, fallback 到 env
 */
async function getModel() {
    try {
        const svc = require('../services/aiProviderConfigService');
        const cfg = await svc.getActiveConfig('generic-ai');
        return cfg?.model || ENV_MODEL;
    } catch (_) {
        return ENV_MODEL;
    }
}

module.exports = {
    createClientFor,
    generateResponseFor,
    generateCandidatesFor,
    generateResponse,
    generateCandidates,
    getModel,
};