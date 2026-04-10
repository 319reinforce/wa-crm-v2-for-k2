/**
 * migrate-sft-dedup-index.js
 * 将 system_prompt_version 添加到 sft_memory 去重唯一索引
 *
 * 使用方法：
 *   node migrate-sft-dedup-index.js
 */
require('dotenv').config();
const mysql = require('mysql2/promise');

const MYSQL_CONFIG = {
    host: process.env.DB_HOST || '127.0.0.1',
    port: parseInt(process.env.DB_PORT || '3306'),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'wa_crm_v2',
    timezone: '+08:00',
};

async function main() {
    console.log('[migrate-sft-dedup] Starting...');
    const conn = await mysql.createConnection(MYSQL_CONFIG);

    try {
        // 1. 列出当前索引
        const [indexes] = await conn.query(`
            SELECT INDEX_NAME, COLUMN_NAME, SEQ_IN_INDEX
            FROM INFORMATION_SCHEMA.STATISTICS
            WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'sft_memory'
            ORDER BY INDEX_NAME, SEQ_IN_INDEX
        `, [MYSQL_CONFIG.database]);

        const idxMap = {};
        for (const row of indexes) {
            if (!idxMap[row.INDEX_NAME]) idxMap[row.INDEX_NAME] = [];
            idxMap[row.INDEX_NAME].push(row.COLUMN_NAME);
        }
        console.log('[migrate-sft-dedup] Current indexes on sft_memory:');
        for (const [name, cols] of Object.entries(idxMap)) {
            console.log(`  ${name}: [${cols.join(', ')}]`);
        }

        // 2. 检查当前 dedup index
        const currentDedup = idxMap['idx_sft_dedup'] || [];
        console.log(`[migrate-sft-dedup] Current idx_sft_dedup: [${currentDedup.join(', ')}]`);

        if (currentDedup.includes('system_prompt_version')) {
            console.log('[migrate-sft-dedup] system_prompt_version already in index, nothing to do.');
            return;
        }

        // 3. 删除旧索引
        console.log('[migrate-sft-dedup] Dropping old idx_sft_dedup...');
        await conn.query('DROP INDEX idx_sft_dedup ON sft_memory');

        // 4. 创建新索引（包含 system_prompt_version）
        console.log('[migrate-sft-dedup] Creating new idx_sft_dedup with system_prompt_version...');
        await conn.query(`
            CREATE UNIQUE INDEX idx_sft_dedup ON sft_memory
            (client_id_hash, input_text_hash, human_output_hash, created_date, system_prompt_version)
        `);

        console.log('[migrate-sft-dedup] Done! Verifying...');
        const [newIndexes] = await conn.query(`
            SELECT INDEX_NAME, COLUMN_NAME, SEQ_IN_INDEX
            FROM INFORMATION_SCHEMA.STATISTICS
            WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'sft_memory' AND INDEX_NAME = 'idx_sft_dedup'
            ORDER BY SEQ_IN_INDEX
        `, [MYSQL_CONFIG.database]);
        console.log(`[migrate-sft-dedup] New idx_sft_dedup: [${newIndexes.map(r => r.COLUMN_NAME).join(', ')}]`);

    } finally {
        await conn.end();
    }
}

main().catch(err => {
    console.error('[migrate-sft-dedup] Error:', err.message);
    process.exit(1);
});
