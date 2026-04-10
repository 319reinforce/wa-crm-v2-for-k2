/**
 * migrate-sft-feedback-uniq.js
 * 为 sft_feedback 表添加唯一索引，防止重复 feedback
 *
 * 使用方法：
 *   node migrate-sft-feedback-uniq.js
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
    console.log('[migrate-sft-feedback-uniq] Starting...');
    const conn = await mysql.createConnection(MYSQL_CONFIG);

    try {
        // 1. 查看当前索引
        const [indexes] = await conn.query(`
            SELECT INDEX_NAME, COLUMN_NAME, SEQ_IN_INDEX
            FROM INFORMATION_SCHEMA.STATISTICS
            WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'sft_feedback'
            ORDER BY INDEX_NAME, SEQ_IN_INDEX
        `, [MYSQL_CONFIG.database]);

        console.log('[migrate-sft-feedback-uniq] Current indexes on sft_feedback:');
        for (const row of indexes) {
            console.log(`  ${row.INDEX_NAME}: ${row.COLUMN_NAME}`);
        }

        // 检查是否已有 idx_feedback_dedup
        const hasDedup = indexes.some(r => r.INDEX_NAME ***REMOVED***= 'idx_feedback_dedup');
        if (hasDedup) {
            console.log('[migrate-sft-feedback-uniq] idx_feedback_dedup already exists, nothing to do.');
            return;
        }

        // 2. 添加唯一索引：(client_id, feedback_type, created_at)
        // 同秒级允许不同内容重复，但快速重复提交会被去重
        // 应用层仍需做去重检查（INSERT 时捕获 DuplicateKeyError）
        console.log('[migrate-sft-feedback-uniq] Adding idx_feedback_dedup...');
        await conn.query(`
            CREATE UNIQUE INDEX idx_feedback_dedup ON sft_feedback
            (client_id, feedback_type, created_at)
        `);

        console.log('[migrate-sft-feedback-uniq] Done!');

    } finally {
        await conn.end();
    }
}

main().catch(err => {
    console.error('[migrate-sft-feedback-uniq] Error:', err.message);
    process.exit(1);
});
