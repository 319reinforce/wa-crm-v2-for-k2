#!/usr/bin/env node
/**
 * 手动查询 OpenAI Vector Store 检索效果
 *
 * 用法：
 *   npm run rag:query -- "trial package rules"
 *   npm run rag:query -- --top-k=5 "payment deduction policy"
 */
require('dotenv').config();

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const OPENAI_API_BASE = process.env.OPENAI_API_BASE || 'https://api.openai.com/v1';
const VECTOR_STORE_ID = process.env.OPENAI_VECTOR_STORE_ID || '';
const DEFAULT_TOP_K = parseInt(process.env.OPENAI_RAG_TOP_K || '8', 10);

function parseArgs() {
    const args = process.argv.slice(2);
    let topK = DEFAULT_TOP_K;
    const queryParts = [];
    for (const arg of args) {
        if (arg.startsWith('--top-k=')) {
            topK = parseInt(arg.slice('--top-k='.length), 10);
            continue;
        }
        queryParts.push(arg);
    }
    return {
        topK: Number.isFinite(topK) ? topK : 8,
        query: queryParts.join(' ').trim(),
    };
}

async function main() {
    if (!OPENAI_API_KEY) throw new Error('OPENAI_API_KEY missing');
    if (!VECTOR_STORE_ID) throw new Error('OPENAI_VECTOR_STORE_ID missing');

    const { topK, query } = parseArgs();
    if (!query) {
        throw new Error('query missing. Example: npm run rag:query -- \"trial package rules\"');
    }

    const response = await fetch(`${OPENAI_API_BASE}/vector_stores/${encodeURIComponent(VECTOR_STORE_ID)}/search`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
            query,
            max_num_results: topK,
        }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
        const detail = payload?.error?.message || `HTTP ${response.status}`;
        throw new Error(detail);
    }

    const items = Array.isArray(payload?.data) ? payload.data : [];
    console.log(`[query] "${query}"`);
    console.log(`[vector_store_id] ${VECTOR_STORE_ID}`);
    console.log(`[hit_count] ${items.length}`);
    console.log('');

    items.forEach((item, idx) => {
        const content = (Array.isArray(item.content) ? item.content : [])
            .map((part) => {
                if (typeof part?.text ***REMOVED***= 'string') return part.text;
                if (typeof part?.content ***REMOVED***= 'string') return part.content;
                if (typeof part ***REMOVED***= 'string') return part;
                return '';
            })
            .filter(Boolean)
            .join('\n')
            .slice(0, 300);
        const score = typeof item.score ***REMOVED***= 'number' ? item.score.toFixed(3) : 'n/a';
        console.log(`${idx + 1}. file=${item.filename || 'unknown'} score=${score}`);
        if (item.attributes && Object.keys(item.attributes).length > 0) {
            console.log(`   attrs=${JSON.stringify(item.attributes)}`);
        }
        if (content) {
            console.log(`   snippet=${content.replace(/\s+/g, ' ').trim()}`);
        }
    });
}

main().catch((err) => {
    console.error('[query-openai-vector-store] error:', err.message);
    process.exit(1);
});
