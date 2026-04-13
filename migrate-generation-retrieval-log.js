/**
 * migrate-generation-retrieval-log.js
 * 新增 retrieval_snapshot / generation_log 表
 *
 * 使用方法：
 *   node migrate-generation-retrieval-log.js
 */
require('dotenv').config();
const mysql = require('mysql2/promise');

const MYSQL_CONFIG = {
    host: process.env.DB_HOST || '127.0.0.1',
    port: parseInt(process.env.DB_PORT || '3306', 10),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'wa_crm_v2',
    timezone: '+08:00',
};

async function main() {
    console.log('[migrate-generation-retrieval-log] Starting...');
    const conn = await mysql.createConnection(MYSQL_CONFIG);
    try {
        await conn.query(`
            CREATE TABLE IF NOT EXISTS retrieval_snapshot (
                id BIGINT AUTO_INCREMENT PRIMARY KEY,
                client_id VARCHAR(64),
                operator VARCHAR(32),
                scene VARCHAR(64) DEFAULT 'unknown',
                system_prompt_version VARCHAR(32) DEFAULT 'v2',
                snapshot_hash VARCHAR(64) NOT NULL,
                grounding_json JSON NOT NULL,
                topic_context TEXT,
                rich_context TEXT,
                conversation_summary TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        await conn.query('CREATE INDEX idx_rs_client_scene ON retrieval_snapshot(client_id, scene, created_at)');
        await conn.query('CREATE INDEX idx_rs_hash ON retrieval_snapshot(snapshot_hash)');
        console.log('[migrate-generation-retrieval-log] retrieval_snapshot ready');
    } catch (err) {
        if (err.code !== 'ER_DUP_KEYNAME') throw err;
        console.log('[migrate-generation-retrieval-log] retrieval_snapshot indexes already exist');
    }

    try {
        await conn.query(`
            CREATE TABLE IF NOT EXISTS generation_log (
                id BIGINT AUTO_INCREMENT PRIMARY KEY,
                client_id VARCHAR(64),
                retrieval_snapshot_id BIGINT,
                provider VARCHAR(32),
                model VARCHAR(64),
                route VARCHAR(32) DEFAULT 'minimax',
                ab_bucket VARCHAR(32),
                scene VARCHAR(64) DEFAULT 'unknown',
                operator VARCHAR(32),
                temperature_json JSON,
                message_count INT DEFAULT 0,
                prompt_version VARCHAR(32),
                latency_ms INT,
                status VARCHAR(16) DEFAULT 'success',
                error_message TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        await conn.query('CREATE INDEX idx_gl_client_created ON generation_log(client_id, created_at)');
        await conn.query('CREATE INDEX idx_gl_status_created ON generation_log(status, created_at)');
        await conn.query('CREATE INDEX idx_gl_snapshot ON generation_log(retrieval_snapshot_id)');
        console.log('[migrate-generation-retrieval-log] generation_log ready');
    } catch (err) {
        if (err.code !== 'ER_DUP_KEYNAME') throw err;
        console.log('[migrate-generation-retrieval-log] generation_log indexes already exist');
    }

    await conn.end();
    console.log('[migrate-generation-retrieval-log] Done.');
}

main().catch((err) => {
    console.error('[migrate-generation-retrieval-log] Error:', err.message);
    process.exit(1);
});
