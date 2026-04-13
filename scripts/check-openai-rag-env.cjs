#!/usr/bin/env node
/**
 * OpenAI 托管 RAG 环境检查器
 * 用法:
 *   node scripts/check-openai-rag-env.cjs
 *   npm run rag:env:check
 */
require('dotenv').config();

function mask(value) {
    if (!value) return 'MISSING';
    if (value.length <= 8) return 'SET';
    return `${value.slice(0, 4)}***${value.slice(-4)}`;
}

function print(name, value) {
    console.log(`${name}: ${value}`);
}

function main() {
    const required = [];
    const warnings = [];

    const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
    const OPENAI_API_BASE = process.env.OPENAI_API_BASE || 'https://api.openai.com/v1';
    const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o';
    const USE_OPENAI = process.env.USE_OPENAI || 'false';
    const AI_PROXY_TOKEN = process.env.AI_PROXY_TOKEN || process.env.WA_ADMIN_TOKEN || '';
    const OPENAI_RAG_ENABLED = process.env.OPENAI_RAG_ENABLED || 'false';
    const OPENAI_VECTOR_STORE_ID = process.env.OPENAI_VECTOR_STORE_ID || '';
    const OPENAI_RAG_TOP_K = process.env.OPENAI_RAG_TOP_K || '8';
    const KNOWLEDGE_MANIFEST_PATH = process.env.KNOWLEDGE_MANIFEST_PATH || 'docs/rag/knowledge-manifest.json';

    print('OPENAI_API_KEY', mask(OPENAI_API_KEY));
    print('OPENAI_API_BASE', OPENAI_API_BASE);
    print('OPENAI_MODEL', OPENAI_MODEL);
    print('USE_OPENAI', USE_OPENAI);
    print('AI_PROXY_TOKEN', mask(AI_PROXY_TOKEN));
    print('OPENAI_RAG_ENABLED', OPENAI_RAG_ENABLED);
    print('OPENAI_VECTOR_STORE_ID', OPENAI_VECTOR_STORE_ID || 'MISSING');
    print('OPENAI_RAG_TOP_K', OPENAI_RAG_TOP_K);
    print('KNOWLEDGE_MANIFEST_PATH', KNOWLEDGE_MANIFEST_PATH);

    if (!OPENAI_API_KEY) required.push('OPENAI_API_KEY');
    if (USE_OPENAI !== 'true') required.push('USE_OPENAI=true');
    if (!AI_PROXY_TOKEN) required.push('AI_PROXY_TOKEN (or WA_ADMIN_TOKEN)');
    if (OPENAI_RAG_ENABLED === 'true' && !OPENAI_VECTOR_STORE_ID) {
        required.push('OPENAI_VECTOR_STORE_ID (when OPENAI_RAG_ENABLED=true)');
    }

    if (OPENAI_MODEL === 'gpt-4o') {
        warnings.push('你当前使用 gpt-4o，可按成本/速度改成 gpt-4.1-mini');
    }
    if (OPENAI_API_BASE !== 'https://api.openai.com/v1') {
        warnings.push('OPENAI_API_BASE 非官方默认地址，请确认是你的网关地址');
    }

    console.log('');
    if (required.length > 0) {
        console.log('[BLOCKERS]');
        required.forEach((item) => console.log(`- ${item}`));
        console.log('');
        console.log('建议先修复 blockers，再进行 RAG 灰度。');
        process.exit(1);
    }

    if (warnings.length > 0) {
        console.log('[WARNINGS]');
        warnings.forEach((item) => console.log(`- ${item}`));
        console.log('');
    }

    console.log('[OK] OpenAI 快速接入必需变量已满足。');
}

main();
