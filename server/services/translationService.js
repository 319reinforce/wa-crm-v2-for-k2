/**
 * Translation Service — provider 路由层
 *
 * 职责：
 *   - 根据 provider 参数（优先）或 TRANSLATION_PROVIDER env 选择翻译引擎
 *   - 支持 'deepl' | 'minimax'，默认 'minimax'（保持向后兼容）
 *   - DeepL 失败自动 fallback 到 MiniMax，保证用户请求最终有结果
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

async function assertDeepLQuota(incomingChars) {
    if (DAILY_CHAR_LIMIT <= 0) return;
    const used = await getTodayTranslationChars();
    if (used + incomingChars > DAILY_CHAR_LIMIT) {
        throw new TranslationQuotaExceededError(used, DAILY_CHAR_LIMIT, incomingChars);
    }
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
    if (normalized === 'deepl' || normalized === 'minimax') return normalized;
    return (process.env.TRANSLATION_PROVIDER || 'minimax').toLowerCase();
}

function directionToLangs(direction) {
    if (direction === 'to_en') return { source: 'zh', target: 'en-US' };
    return { source: 'en', target: 'zh' };
}

function logUsage({ provider, status, chars, latencyMs, error, mode, source }) {
    try {
        aiProviderCfg.recordUsage({
            purpose: 'translation',
            model: provider === 'deepl' ? 'deepl' : 'minimax-translation',
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
        // 配额校验放在 try 外面，让 429 穿透到 route 层，不被 fallback 捕获
        await assertDeepLQuota(chars);
        try {
            const out = await translateTextViaDeepL(text, { direction, timestamp });
            logUsage({ provider: 'deepl', status: 'ok', chars, latencyMs: Date.now() - started, mode });
            return out;
        } catch (err) {
            console.error('[translationService] DeepL translateText failed, fallback MiniMax:', err.message);
            logUsage({ provider: 'deepl', status: 'error', chars, latencyMs: Date.now() - started, error: err.message, mode });
            // fall-through to MiniMax
        }
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
        await assertDeepLQuota(totalChars);
        try {
            const out = await translateBatchViaDeepL(texts, mode);
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
            console.error('[translationService] DeepL translateBatch failed, fallback MiniMax:', err.message);
            logUsage({
                provider: 'deepl',
                status: 'error',
                chars: totalChars,
                latencyMs: Date.now() - started,
                error: err.message,
                mode,
                source: `batch=${texts.length}`,
            });
            // fall-through
        }
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
        getDeepLClient,
        getTodayTranslationChars,
        DAILY_CHAR_LIMIT,
    },
};
