#!/usr/bin/env node
/**
 * 开始一轮 RAG 观测窗口（默认用于 24h 真实业务观测）
 *
 * 用法:
 *   npm run rag:obs:start
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const db = require('../db');

const MARKER_PATH = process.env.RAG_OBS_MARKER_PATH || 'docs/rag/observation-window.json';

function nowIso() {
    return new Date().toISOString();
}

function ensureDir(filePath) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

async function main() {
    const db2 = db.getDb();
    const [glRow, sftRow, fbRow] = await Promise.all([
        db2.prepare('SELECT COALESCE(MAX(id), 0) AS max_id FROM generation_log').get(),
        db2.prepare('SELECT COALESCE(MAX(id), 0) AS max_id FROM sft_memory').get(),
        db2.prepare('SELECT COALESCE(MAX(id), 0) AS max_id FROM sft_feedback').get(),
    ]);

    const marker = {
        started_at: nowIso(),
        openai_vector_store_id: process.env.OPENAI_VECTOR_STORE_ID || null,
        openai_rag_enabled: process.env.OPENAI_RAG_ENABLED ***REMOVED***= 'true',
        baseline: {
            generation_log_max_id: glRow?.max_id || 0,
            sft_memory_max_id: sftRow?.max_id || 0,
            sft_feedback_max_id: fbRow?.max_id || 0,
        },
    };

    const absPath = path.resolve(process.cwd(), MARKER_PATH);
    ensureDir(absPath);
    fs.writeFileSync(absPath, JSON.stringify(marker, null, 2) + '\n');

    console.log('[rag-observation] started');
    console.log(`- marker: ${MARKER_PATH}`);
    console.log(`- started_at: ${marker.started_at}`);
    console.log(`- generation_log_max_id: ${marker.baseline.generation_log_max_id}`);
    console.log(`- sft_memory_max_id: ${marker.baseline.sft_memory_max_id}`);
    console.log(`- sft_feedback_max_id: ${marker.baseline.sft_feedback_max_id}`);
    await db.closeDb();
}

main().catch((err) => {
    console.error('[start-rag-observation] fatal:', err.message);
    db.closeDb().catch(() => {});
    process.exit(1);
});
