/**
 * Translation Service — provider 路由层
 *
 * 职责：
 *   - 根据 provider 参数（优先）或 TRANSLATION_PROVIDER env 选择翻译引擎
 *   - 支持 'deepl' | 'openai' | 'minimax'，默认 'deepl'
 *   - DeepL 失败后 fallback 到 OpenAI；MiniMax 只有显式选择 minimax 才调用
 *   - 对外接口形状与 aiService.translateText / translateBatch 保持一致，便于无缝替换
 *
 * 使用方式：
 *   const ts = require('./translationService');
 *   await ts.translateText(text, { role, timestamp, mode, provider });
 *   await ts.translateBatch(texts, { mode, provider });
 */
const aiService = require('./aiService');
const aiProviderCfg = require('./aiProviderConfigService');
const { getGlossaryId } = require('./translationGlossary');
const db = require('../../db');
const { generateResponseFor } = require('../utils/openai');

let deeplModule = null;
try {
    deeplModule = require('deepl-node');
} catch (_) {
    // deepl-node 未安装时静默失败，provider=deepl 时会报错
}

const DEEPL_API_KEY = (process.env.DEEPL_API_KEY || '').trim();
const DEEPL_API_BASE = (process.env.DEEPL_API_BASE || '').trim();

// 每日 DeepL 字符配额：0 或未设置表示关闭限额。只作用于 provider='deepl' 分支。
const DAILY_CHAR_LIMIT = Math.max(0, Number(process.env.TRANSLATION_MAX_CHARS_PER_DAY || 0)) || 0;

class TranslationQuotaExceededError extends Error {
    constructor(used, limit, incoming) {
        super(`Daily DeepL quota exceeded: used=${used} incoming=${incoming} limit=${limit} chars`);
        this.code = 'TRANSLATION_QUOTA_EXCEEDED';
        this.used = used;
        this.incoming = incoming;
        this.limit = limit;
    }
}

async function getTodayTranslationChars() {
    if (DAILY_CHAR_LIMIT <= 0) return 0;
    try {
        // 只统计成功 + DeepL 的用量：失败请求不计配额；MiniMax 不受配额约束
        const rows = await db.prepare(`
            SELECT COALESCE(SUM(tokens_total), 0) AS used
              FROM ai_usage_logs
             WHERE purpose = 'translation'
               AND model = 'deepl'
               AND status = 'ok'
               AND DATE(created_at) = CURDATE()
        `).all();
        return Number(rows?.[0]?.used || 0);
    } catch (err) {
        // 查询失败时 fail-open：避免因 DB 问题误阻塞业务
        console.error('[translationService] quota query failed, fail-open:', err.message);
        return 0;
    }
}

// 进程内配额状态: 解决 TOCTOU 竞态。
// baselineUsed 是当日冷启从 DB 拉的历史成功用量; reserved 是进程内已预留但未落库的量。
// 多进程部署仍可能微量超额 (各自 reserve), 但单进程并发一致。
// reserve() 返回 release 函数: DeepL 调用失败时归还预留, 避免浪费配额。
let _quotaState = { date: null, baselineUsed: 0, reserved: 0, initPromise: null };

function todayLocalDateKey() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function ensureQuotaBaseline() {
    const today = todayLocalDateKey();
    if (_quotaState.date === today) return;
    if (_quotaState.initPromise) return _quotaState.initPromise;
    _quotaState.initPromise = (async () => {
        const baseline = await getTodayTranslationChars();
        _quotaState.date = today;
        _quotaState.baselineUsed = baseline;
        _quotaState.reserved = 0;
    })();
    try {
        await _quotaState.initPromise;
    } finally {
        _quotaState.initPromise = null;
    }
}

async function reserveDeepLQuota(incomingChars) {
    if (DAILY_CHAR_LIMIT <= 0) return () => {};
    await ensureQuotaBaseline();
    const projected = _quotaState.baselineUsed + _quotaState.reserved + incomingChars;
    if (projected > DAILY_CHAR_LIMIT) {
        throw new TranslationQuotaExceededError(
            _quotaState.baselineUsed + _quotaState.reserved,
            DAILY_CHAR_LIMIT,
            incomingChars,
        );
    }
    _quotaState.reserved += incomingChars;
    let released = false;
    return function release() {
        if (released) return;
        released = true;
        _quotaState.reserved = Math.max(0, _quotaState.reserved - incomingChars);
    };
}

async function assertDeepLQuota(incomingChars) {
    // Legacy 名称保留; 新代码用 reserveDeepLQuota + release 模式。
    await reserveDeepLQuota(incomingChars);
}

let _deeplClient = null;

function getDeepLClient() {
    if (!deeplModule || !DEEPL_API_KEY) return null;
    if (_deeplClient) return _deeplClient;
    const opts = {};
    if (DEEPL_API_BASE) opts.serverUrl = DEEPL_API_BASE;
    _deeplClient = new deeplModule.DeepLClient(DEEPL_API_KEY, opts);
    return _deeplClient;
}

function resolveTranslationMode(mode) {
    const normalized = String(mode || 'auto').toLowerCase();
    if (normalized === 'to_en' || normalized === 'to_zh' || normalized === 'auto') return normalized;
    return 'auto';
}

function detectTranslationDirection(text) {
    const src = String(text || '');
    const hanCount = (src.match(/\p{Script=Han}/gu) || []).length;
    const latinCount = (src.match(/[A-Za-z]/g) || []).length;
    return hanCount >= latinCount ? 'to_en' : 'to_zh';
}

function pickProvider(explicit) {
    const normalized = String(explicit || '').toLowerCase();
    if (normalized === 'deepl' || normalized === 'openai' || normalized === 'minimax') return normalized;
    return (process.env.TRANSLATION_PROVIDER || 'deepl').toLowerCase();
}

function directionToLangs(direction) {
    if (direction === 'to_en') return { source: 'zh', target: 'en-US' };
    return { source: 'en', target: 'zh-HANS' };
}

function normalizeForTranslationCompare(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function isNoopTranslationForDirection(original, translation, direction) {
    const source = normalizeForTranslationCompare(original);
    const output = normalizeForTranslationCompare(translation);
    if (!source || !output || source !== output) return false;
    if (direction === 'to_zh') {
        return source.length >= 12 && /[A-Za-z]{2,}/.test(source) && !/[\u3400-\u9fff]/.test(source);
    }
    if (direction === 'to_en') {
        return /[\u3400-\u9fff]/.test(source);
    }
    return false;
}

function collectNoopBatchInputs(texts, translations, mode) {
    const resolvedMode = resolveTranslationMode(mode);
    const inputs = [];
    translations.forEach((item, i) => {
        const sourceText = String(texts[i]?.text ?? '');
        const direction = resolvedMode === 'auto'
            ? detectTranslationDirection(sourceText)
            : resolvedMode;
        if (isNoopTranslationForDirection(sourceText, item?.translation, direction)) {
            inputs.push({
                originalIdx: i,
                text: sourceText,
                role: texts[i]?.role,
                direction,
            });
        }
    });
    return inputs;
}

function stripJsonFence(value) {
    return String(value || '')
        .trim()
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/i, '')
        .trim();
}

function openAITranslationSystemPrompt(direction) {
    const target = direction === 'to_en' ? 'English' : 'Simplified Chinese';
    return [
        'You are a strict translation engine.',
        `Translate the user text into ${target}.`,
        'Do not answer, advise, summarize, explain, or add labels.',
        'Preserve meaning, names, prices, links, emoji, and line breaks.',
        'Return only the translated text.',
    ].join(' ');
}

async function translateTextViaOpenAI(text, { direction, timestamp }) {
    const content = await generateResponseFor('translation', [
        { role: 'system', content: openAITranslationSystemPrompt(direction) },
        { role: 'user', content: String(text || '') },
    ], {
        temperature: 0,
        maxTokens: 1500,
        source: `translation:${direction}`,
    });
    return {
        translation: String(content || '').trim(),
        timestamp,
        provider: 'openai',
    };
}

async function translateBatchViaOpenAI(texts, mode) {
    const resolvedMode = resolveTranslationMode(mode);
    const entries = texts.map((t, i) => {
        const raw = String(t?.text ?? '');
        const direction = resolvedMode === 'auto' ? detectTranslationDirection(raw) : resolvedMode;
        return { idx: i + 1, direction, text: raw };
    });
    const content = await generateResponseFor('translation', [
        {
            role: 'system',
            content: [
                'You are a strict batch translation engine.',
                'Translate each item independently according to its direction: to_zh means Simplified Chinese, to_en means English.',
                'Do not answer, advise, summarize, merge, omit, or add extra keys.',
                'Return only a JSON array shaped exactly as [{"idx":1,"translation":"..."}].',
            ].join(' '),
        },
        { role: 'user', content: JSON.stringify(entries) },
    ], {
        temperature: 0,
        maxTokens: Math.max(2400, entries.length * 250 + 800),
        source: `translation:batch=${entries.length}`,
    });

    const map = {};
    try {
        const raw = stripJsonFence(content);
        const jsonMatch = raw.match(/\[[\s\S]*\]/);
        const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : raw);
        for (const item of parsed) {
            const idx = Number(item?.idx);
            if (Number.isFinite(idx) && typeof item.translation === 'string') {
                map[idx] = item.translation.trim();
            }
        }
    } catch (err) {
        throw new Error(`OpenAI translation JSON parse failed: ${err.message}`);
    }

    return {
        translations: texts.map((t, i) => {
            const idx = i + 1;
            const translation = map[idx];
            return {
                idx,
                translation: translation && translation.length > 0 ? translation : String(t?.text ?? ''),
            };
        }),
        provider: 'openai',
    };
}

async function repairNoopBatchWithOpenAI(texts, translations, mode) {
    const noopInputs = collectNoopBatchInputs(texts, translations, mode);
    if (noopInputs.length === 0) return translations;

    const fallback = await translateBatchViaOpenAI(
        noopInputs.map((item) => ({ text: item.text, role: item.role })),
        'auto',
    );
    const repaired = translations.map((item) => ({ ...item }));
    for (const item of fallback?.translations || []) {
        const localIdx = Number(item?.idx || 0) - 1;
        const meta = noopInputs[localIdx];
        if (!meta) continue;
        const replacement = String(item?.translation || '').trim();
        repaired[meta.originalIdx] = replacement && !isNoopTranslationForDirection(meta.text, replacement, meta.direction)
            ? { ...repaired[meta.originalIdx], translation: replacement, provider: 'openai' }
            : { ...repaired[meta.originalIdx], translation: '' };
    }
    return repaired;
}

function logUsage({ provider, status, chars, latencyMs, error, mode, source }) {
    try {
        aiProviderCfg.recordUsage({
            purpose: 'translation',
            model: provider === 'deepl' ? 'deepl' : (provider === 'openai' ? 'openai-translation' : 'minimax-translation'),
            tokens_prompt: chars || 0,
            tokens_total: chars || 0,
            latency_ms: latencyMs,
            status: status || 'ok',
            error_message: error || null,
            source: source || `mode=${mode || 'auto'}`,
        });
    } catch (_) { /* 绝不阻塞主链路 */ }
}

/**
 * 单条翻译（DeepL）
 * 返回 { translation, timestamp, provider: 'deepl' }
 */
async function translateTextViaDeepL(text, { direction, timestamp }) {
    const client = getDeepLClient();
    if (!client) {
        const reason = !deeplModule ? 'deepl-node module not installed' : 'DEEPL_API_KEY not set';
        throw new Error(`DeepL unavailable: ${reason}`);
    }
    const { source, target } = directionToLangs(direction);
    const glossaryLangSource = source.slice(0, 2);
    const glossaryLangTarget = target.slice(0, 2);
    const glossaryId = await getGlossaryId(client, glossaryLangSource, glossaryLangTarget);

    const opts = {};
    if (glossaryId) opts.glossary = glossaryId;

    const res = await client.translateText(text, source, target, opts);
    const translation = String(res?.text || '').trim() || text;
    return { translation, timestamp, provider: 'deepl' };
}

/**
 * 批量翻译（DeepL）
 * 复用单次 translateText 的数组形式：DeepL 支持单请求 50 条文本。
 */
async function translateBatchViaDeepL(texts, mode) {
    const client = getDeepLClient();
    if (!client) {
        const reason = !deeplModule ? 'deepl-node module not installed' : 'DEEPL_API_KEY not set';
        throw new Error(`DeepL unavailable: ${reason}`);
    }
    const resolvedMode = resolveTranslationMode(mode);

    // 按方向分组（auto 模式下逐条判断）
    const toEn = [];
    const toZh = [];
    texts.forEach((t, i) => {
        const raw = String(t?.text ?? '');
        let direction;
        if (resolvedMode === 'auto') direction = detectTranslationDirection(raw);
        else direction = resolvedMode === 'to_en' ? 'to_en' : 'to_zh';
        const entry = { originalIdx: i, text: raw };
        if (direction === 'to_en') toEn.push(entry);
        else toZh.push(entry);
    });

    async function translateGroup(group, direction) {
        if (!group.length) return {};
        const { source, target } = directionToLangs(direction);
        const glossaryId = await getGlossaryId(client, source.slice(0, 2), target.slice(0, 2));
        const opts = {};
        if (glossaryId) opts.glossary = glossaryId;
        const results = await client.translateText(
            group.map(e => e.text),
            source,
            target,
            opts,
        );
        const map = {};
        const arr = Array.isArray(results) ? results : [results];
        group.forEach((e, idx) => {
            map[e.originalIdx + 1] = String(arr[idx]?.text || '').trim() || e.text;
        });
        return map;
    }

    const [zhMap, enMap] = await Promise.all([
        translateGroup(toZh, 'to_zh'),
        translateGroup(toEn, 'to_en'),
    ]);

    const merged = { ...zhMap, ...enMap };
    const translations = texts.map((t, i) => {
        const idx = i + 1;
        const translation = merged[idx];
        return {
            idx,
            translation: translation && translation.length > 0 ? translation : String(t?.text ?? ''),
        };
    });
    return { translations, provider: 'deepl' };
}

/**
 * 单条翻译（路由）
 */
async function translateText(text, { role, timestamp, mode, provider } = {}) {
    const direction = resolveTranslationMode(mode) === 'auto'
        ? detectTranslationDirection(text)
        : resolveTranslationMode(mode);
    const finalProvider = pickProvider(provider);
    const started = Date.now();
    const chars = String(text || '').length;

    if (finalProvider === 'deepl') {
        let release = () => {};
        try {
            release = await reserveDeepLQuota(chars);
            const out = await translateTextViaDeepL(text, { direction, timestamp });
            if (isNoopTranslationForDirection(text, out.translation, direction)) {
                throw new Error('DeepL returned source text unchanged');
            }
            logUsage({ provider: 'deepl', status: 'ok', chars, latencyMs: Date.now() - started, mode });
            return out;
        } catch (err) {
            release();
            console.error('[translationService] DeepL translateText failed, fallback OpenAI:', err.message);
            logUsage({ provider: 'deepl', status: 'error', chars, latencyMs: Date.now() - started, error: err.message, mode });
            const openaiStarted = Date.now();
            const out = await translateTextViaOpenAI(text, { direction, timestamp });
            logUsage({ provider: 'openai', status: 'ok', chars, latencyMs: Date.now() - openaiStarted, mode });
            return out;
        }
    }

    if (finalProvider === 'openai') {
        const openaiStarted = Date.now();
        const out = await translateTextViaOpenAI(text, { direction, timestamp });
        logUsage({ provider: 'openai', status: 'ok', chars, latencyMs: Date.now() - openaiStarted, mode });
        return out;
    }

    const minimaxStarted = Date.now();
    const out = await aiService.translateText(text, role, timestamp, mode);
    logUsage({ provider: 'minimax', status: 'ok', chars, latencyMs: Date.now() - minimaxStarted, mode });
    return { ...out, provider: 'minimax' };
}

/**
 * 批量翻译（路由）
 */
async function translateBatch(texts, { mode, provider } = {}) {
    if (!Array.isArray(texts) || texts.length === 0) {
        return { translations: [] };
    }
    const finalProvider = pickProvider(provider);
    const started = Date.now();
    const totalChars = texts.reduce((sum, t) => sum + String(t?.text || '').length, 0);

    if (finalProvider === 'deepl') {
        let release = () => {};
        try {
            release = await reserveDeepLQuota(totalChars);
            const out = await translateBatchViaDeepL(texts, mode);
            out.translations = await repairNoopBatchWithOpenAI(texts, out.translations || [], mode);
            logUsage({
                provider: 'deepl',
                status: 'ok',
                chars: totalChars,
                latencyMs: Date.now() - started,
                mode,
                source: `batch=${texts.length}`,
            });
            return out;
        } catch (err) {
            release();
            console.error('[translationService] DeepL translateBatch failed, fallback OpenAI:', err.message);
            logUsage({
                provider: 'deepl',
                status: 'error',
                chars: totalChars,
                latencyMs: Date.now() - started,
                error: err.message,
                mode,
                source: `batch=${texts.length}`,
            });
            const openaiStarted = Date.now();
            const out = await translateBatchViaOpenAI(texts, mode);
            logUsage({
                provider: 'openai',
                status: 'ok',
                chars: totalChars,
                latencyMs: Date.now() - openaiStarted,
                mode,
                source: `batch=${texts.length}`,
            });
            return out;
        }
    }

    if (finalProvider === 'openai') {
        const openaiStarted = Date.now();
        const out = await translateBatchViaOpenAI(texts, mode);
        logUsage({
            provider: 'openai',
            status: 'ok',
            chars: totalChars,
            latencyMs: Date.now() - openaiStarted,
            mode,
            source: `batch=${texts.length}`,
        });
        return out;
    }

    const minimaxStarted = Date.now();
    const out = await aiService.translateBatch(texts, mode);
    logUsage({
        provider: 'minimax',
        status: 'ok',
        chars: totalChars,
        latencyMs: Date.now() - minimaxStarted,
        mode,
        source: `batch=${texts.length}`,
    });
    return { ...out, provider: 'minimax' };
}

module.exports = {
    translateText,
    translateBatch,
    TranslationQuotaExceededError,
    // 暴露给测试/admin
    _internal: {
        pickProvider,
        resolveTranslationMode,
        detectTranslationDirection,
        directionToLangs,
        isNoopTranslationForDirection,
        collectNoopBatchInputs,
        stripJsonFence,
        getDeepLClient,
        getTodayTranslationChars,
        reserveDeepLQuota,
        getQuotaState: () => ({
            date: _quotaState.date,
            baselineUsed: _quotaState.baselineUsed,
            reserved: _quotaState.reserved,
        }),
        resetQuotaState: () => {
            _quotaState = { date: null, baselineUsed: 0, reserved: 0, initPromise: null };
        },
        DAILY_CHAR_LIMIT,
    },
};
