/**
 * OpenAI Vector Store helpers — Phase 1 (task-backend-wire)
 *
 * api_key / base_url 从 DB (purpose='rag-vector') 读取，保留 fetch 底层调用
 * (Vector Stores API 不是 chat.completions，可能无 usage 字段，但仍记一行 ok)
 */
const { default: OpenAI } = require('openai');

let _client = null;
let _configId = null;

async function getClient() {
    if (_client) return { client: _client, configId: _configId };
    const svc = require('../services/aiProviderConfigService');
    const cfg = await svc.getActiveConfig('rag-vector');

    let apiKey, baseUrl;
    if (cfg?.api_key) {
        apiKey = cfg.api_key;
        baseUrl = String(cfg.base_url).replace(/\/+$/, '');
        _configId = cfg.id;
    } else {
        console.warn('[openaiVectorStore] no DB config for purpose=rag-vector, falling back to env');
        apiKey = process.env.OPENAI_API_KEY;
        baseUrl = (process.env.OPENAI_API_BASE || 'https://api.openai.com/v1').replace(/\/+$/, '');
        _configId = null;
    }
    if (!apiKey || apiKey === 'sk-YourKeyHere') {
        throw new Error('OpenAI API key not configured (purpose=rag-vector). Set via admin UI or OPENAI_API_KEY.');
    }
    _client = new OpenAI({ apiKey, baseURL: baseUrl, timeout: 60000, maxRetries: 2 });
    return { client: _client, configId: _configId };
}

function extractContentText(item) {
    if (!item) return '';
    if (typeof item.text === 'string') return item.text;
    if (typeof item.content === 'string') return item.content;
    if (Array.isArray(item.content)) {
        return item.content
            .map((part) => {
                if (typeof part === 'string') return part;
                if (typeof part?.text === 'string') return part.text;
                if (typeof part?.content === 'string') return part.content;
                return '';
            })
            .filter(Boolean)
            .join('\n');
    }
    return '';
}

async function searchVectorStore({ vectorStoreId, query, topK = 8 }) {
    if (!vectorStoreId) return [];
    const q = String(query || '').trim();
    if (!q) return [];

    const { client, configId } = await getClient();
    const startedAt = Date.now();

    try {
        const payload = await client.vectorStores.search(vectorStoreId, {
            query: q,
            max_num_results: Number.isFinite(Number(topK)) ? Number(topK) : 8,
        });

        setImmediate(() => {
            const svc = require('../services/aiProviderConfigService');
            svc.recordUsage({
                provider_config_id: configId,
                purpose: 'rag-vector',
                model: 'vector-store-search',
                tokens_prompt: 0,
                tokens_completion: 0,
                tokens_total: 0,
                latency_ms: Date.now() - startedAt,
                status: 'ok',
                source: 'openaiVectorStore.searchVectorStore',
            });
        });

        const items = Array.isArray(payload?.data) ? payload.data : [];
        return items.map((item) => {
            const contentItems = Array.isArray(item?.content) ? item.content : [];
            const contentText = contentItems.map(extractContentText).filter(Boolean).join('\n').trim();
            return {
                file_id: item?.file_id || null,
                filename: item?.filename || null,
                score: typeof item?.score === 'number' ? item.score : null,
                attributes: item?.attributes || {},
                content: contentText,
            };
        });
    } catch (err) {
        setImmediate(() => {
            const svc = require('../services/aiProviderConfigService');
            svc.recordUsage({
                provider_config_id: configId,
                purpose: 'rag-vector',
                model: 'vector-store-search',
                tokens_prompt: 0,
                tokens_completion: 0,
                tokens_total: 0,
                latency_ms: Date.now() - startedAt,
                status: 'error',
                error_message: err.message?.slice(0, 200) || String(err),
                source: 'openaiVectorStore.searchVectorStore',
            });
        });
        throw err;
    }
}

module.exports = {
    searchVectorStore,
};