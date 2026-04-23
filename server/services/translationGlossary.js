/**
 * DeepL Glossary 管理
 *
 * 策略：
 *   1. 优先读 env DEEPL_GLOSSARY_EN_ZH / DEEPL_GLOSSARY_ZH_EN
 *      （生产环境首次启动后把日志里打印的 id 写回 env，避免每次重启都新建）
 *   2. 其次读 runtime 缓存（同一进程生命周期内只创建一次）
 *   3. 否则从 server/config/deeplGlossary.json 读术语表，调 DeepL createGlossary，缓存并打印
 *
 * 没有术语表条目或 DeepL 调用失败时，返回 null（不传 glossary，降级走普通翻译）。
 */
const fs = require('fs');
const path = require('path');

let deeplModule = null;
try {
    deeplModule = require('deepl-node');
} catch (_) { /* handled by caller */ }

const CONFIG_PATH = path.join(__dirname, '..', 'config', 'deeplGlossary.json');

let cachedConfig = null;
const runtimeCache = new Map(); // key: `${src}->${tgt}` -> glossaryId | null

function loadConfig() {
    if (cachedConfig !== null) return cachedConfig;
    try {
        cachedConfig = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    } catch (err) {
        console.warn('[deeplGlossary] config load failed:', err.message);
        cachedConfig = {};
    }
    return cachedConfig;
}

function envKeyFor(srcLang, tgtLang) {
    const norm = s => String(s || '').toUpperCase().replace(/[^A-Z]/g, '');
    return `DEEPL_GLOSSARY_${norm(srcLang)}_${norm(tgtLang)}`;
}

function configKeyFor(srcLang, tgtLang) {
    const norm = s => String(s || '').toLowerCase().slice(0, 2);
    return `${norm(srcLang)}_to_${norm(tgtLang)}`;
}

/**
 * 获取 glossary id。未配置或失败时返回 null。
 *
 * @param {object} client - DeepL client (deepl-node)
 * @param {string} sourceLang - 'en' | 'zh'
 * @param {string} targetLang - 'en' | 'zh'
 * @returns {Promise<string|null>}
 */
async function getGlossaryId(client, sourceLang, targetLang) {
    if (!client) return null;
    const src = String(sourceLang || '').toLowerCase().slice(0, 2);
    const tgt = String(targetLang || '').toLowerCase().slice(0, 2);
    if (!src || !tgt) return null;

    const envKey = envKeyFor(src, tgt);
    const envVal = process.env[envKey];
    if (envVal) return envVal;

    const cacheKey = `${src}->${tgt}`;
    if (runtimeCache.has(cacheKey)) return runtimeCache.get(cacheKey);

    const config = loadConfig();
    const entries = config[configKeyFor(src, tgt)];
    if (!Array.isArray(entries) || entries.length === 0) {
        runtimeCache.set(cacheKey, null);
        return null;
    }

    const entriesMap = {};
    for (const e of entries) {
        if (e && typeof e.source === 'string' && typeof e.target === 'string' && e.source.trim() && e.target.trim()) {
            entriesMap[e.source] = e.target;
        }
    }
    if (Object.keys(entriesMap).length === 0) {
        runtimeCache.set(cacheKey, null);
        return null;
    }

    try {
        if (!deeplModule || typeof deeplModule.GlossaryEntries !== 'function') {
            console.warn('[deeplGlossary] deepl-node GlossaryEntries unavailable; skip glossary');
            runtimeCache.set(cacheKey, null);
            return null;
        }
        const glossaryEntries = new deeplModule.GlossaryEntries({ entries: entriesMap });
        const glossary = await client.createGlossary(
            `wa-crm-${cacheKey}-${Date.now()}`,
            src,
            tgt,
            glossaryEntries,
        );
        const id = glossary?.glossaryId || null;
        if (id) {
            console.log(`[deeplGlossary] created glossary ${src}->${tgt} id=${id}. Pin via env: ${envKey}=${id}`);
        }
        runtimeCache.set(cacheKey, id);
        return id;
    } catch (err) {
        console.error(`[deeplGlossary] create ${cacheKey} failed:`, err.message);
        runtimeCache.set(cacheKey, null);
        return null;
    }
}

/** 清缓存（测试或 admin 重建时用） */
function resetCache() {
    runtimeCache.clear();
    cachedConfig = null;
}

module.exports = { getGlossaryId, resetCache };
