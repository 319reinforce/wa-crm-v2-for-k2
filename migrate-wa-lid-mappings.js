/**
 * migrate-wa-lid-mappings.js
 * Creates persistent Baileys LID -> phone-number JID mappings.
 *
 * Usage:
 *   node migrate-wa-lid-mappings.js
 *   // or server/index.cjs startup via run({ silent: true })
 */
const mysql = require('mysql2/promise');

function getMysqlConfig() {
    return {
        host: process.env.DB_HOST || '127.0.0.1',
        port: parseInt(process.env.DB_PORT || '3306', 10),
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || '',
        database: process.env.DB_NAME || 'wa_crm_v2',
        timezone: '+08:00',
        multipleStatements: true,
    };
}

async function runMigration({ silent = false } = {}) {
    const log = silent ? () => {} : (...args) => console.log(...args);
    log('[migrate-wa-lid-mappings] Starting...');
    const conn = await mysql.createConnection(getMysqlConfig());
    try {
        await conn.query(`
            CREATE TABLE IF NOT EXISTS wa_lid_mappings (
                id BIGINT AUTO_INCREMENT PRIMARY KEY,
                session_id VARCHAR(64) NOT NULL,
                operator VARCHAR(32) NULL,
                lid_jid VARCHAR(128) NOT NULL,
                pn_jid VARCHAR(128) NOT NULL,
                phone VARCHAR(32) NULL,
                source VARCHAR(64) NULL,
                confidence TINYINT NOT NULL DEFAULT 2,
                meta_json TEXT NULL,
                first_seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                last_seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                hit_count INT NOT NULL DEFAULT 1,
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                UNIQUE KEY uk_wa_lid_session_lid (session_id, lid_jid),
                KEY idx_wa_lid_phone (phone),
                KEY idx_wa_lid_pn (pn_jid),
                KEY idx_wa_lid_last_seen (last_seen_at)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
        `);
        log('[migrate-wa-lid-mappings] Done.');
    } finally {
        await conn.end();
    }
}

module.exports = { run: runMigration };

if (require.main === module) {
    require('dotenv').config();
    runMigration().then(() => process.exit(0)).catch((err) => {
        console.error('[migrate-wa-lid-mappings] Error:', err.message);
        process.exit(1);
    });
}
