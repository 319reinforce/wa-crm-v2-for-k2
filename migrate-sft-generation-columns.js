#!/usr/bin/env node
/**
 * migrate-sft-generation-columns.js
 *
 * 给 sft_memory 补齐生成链路追踪字段：
 * - retrieval_snapshot_id
 * - generation_log_id
 * - provider
 * - model
 * - scene_source
 * - pipeline_version
 *
 * 用法：
 *   node migrate-sft-generation-columns.js
 */
require('dotenv').config();
const db = require('./db');

const COLUMN_DEFS = [
    ['retrieval_snapshot_id', "BIGINT NULL COMMENT '关联 retrieval_snapshot.id'"],
    ['generation_log_id', "BIGINT NULL COMMENT '关联 generation_log.id'"],
    ['provider', "VARCHAR(32) NULL COMMENT 'minimax|openai|finetuned'"],
    ['model', "VARCHAR(64) NULL COMMENT '本次生成使用的模型'"],
    ['scene_source', "VARCHAR(32) NULL COMMENT 'provided|detected|fallback'"],
    ['pipeline_version', "VARCHAR(64) NULL COMMENT '回复生成链路版本'"],
];

const INDEX_DEFS = [
    ['idx_sft_retrieval_snapshot', '(retrieval_snapshot_id)'],
    ['idx_sft_generation_log', '(generation_log_id)'],
    ['idx_sft_provider_model', '(provider, model)'],
];

async function getExistingColumns() {
    const rows = await db.getDb().prepare(`
        SELECT COLUMN_NAME
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'sft_memory'
    `).all();
    return new Set(rows.map((row) => row.COLUMN_NAME));
}

async function getExistingIndexes() {
    const rows = await db.getDb().prepare(`
        SELECT DISTINCT INDEX_NAME
        FROM INFORMATION_SCHEMA.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'sft_memory'
    `).all();
    return new Set(rows.map((row) => row.INDEX_NAME));
}

async function main() {
    console.log('[migrate-sft-generation-columns] Starting...');
    const existingColumns = await getExistingColumns();

    for (const [columnName, columnDef] of COLUMN_DEFS) {
        if (existingColumns.has(columnName)) {
            console.log(`[migrate-sft-generation-columns] Column ${columnName} already exists, skip.`);
            continue;
        }
        console.log(`[migrate-sft-generation-columns] Adding column ${columnName}...`);
        await db.getDb().prepare(`
            ALTER TABLE sft_memory
            ADD COLUMN ${columnName} ${columnDef}
        `).run();
    }

    const existingIndexes = await getExistingIndexes();
    for (const [indexName, indexDef] of INDEX_DEFS) {
        if (existingIndexes.has(indexName)) {
            console.log(`[migrate-sft-generation-columns] Index ${indexName} already exists, skip.`);
            continue;
        }
        console.log(`[migrate-sft-generation-columns] Adding index ${indexName}...`);
        await db.getDb().prepare(`
            CREATE INDEX ${indexName}
            ON sft_memory ${indexDef}
        `).run();
    }

    console.log('[migrate-sft-generation-columns] Done!');
    await db.closeDb();
}

main().catch(async (err) => {
    console.error('[migrate-sft-generation-columns] Error:', err.message);
    try { await db.closeDb(); } catch (_) {}
    process.exit(1);
});
