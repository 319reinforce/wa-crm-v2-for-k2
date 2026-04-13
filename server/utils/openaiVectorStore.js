/**
 * OpenAI Vector Store helpers
 */
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const OPENAI_API_BASE = process.env.OPENAI_API_BASE || 'https://api.openai.com/v1';

function assertOpenAIConfig() {
    if (!OPENAI_API_KEY) {
        throw new Error('OPENAI_API_KEY missing');
    }
}

async function openaiRequest(path, init = {}) {
    assertOpenAIConfig();
    const response = await fetch(`${OPENAI_API_BASE}${path}`, {
        ...init,
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${OPENAI_API_KEY}`,
            ...(init.headers || {}),
        },
    });

    let payload = null;
    try {
        payload = await response.json();
    } catch (_) {
        payload = null;
    }

    if (!response.ok) {
        const detail = payload?.error?.message || `HTTP ${response.status}`;
        throw new Error(`OpenAI request failed: ${detail}`);
    }
    return payload;
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

    const payload = await openaiRequest(`/vector_stores/${encodeURIComponent(vectorStoreId)}/search`, {
        method: 'POST',
        body: JSON.stringify({
            query: q,
            max_num_results: Number.isFinite(Number(topK)) ? Number(topK) : 8,
        }),
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
}

module.exports = {
    searchVectorStore,
};
