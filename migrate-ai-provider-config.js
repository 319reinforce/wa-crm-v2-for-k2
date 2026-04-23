/**
 * AI Provider Config Migration (Phase 0 — LLM Admin Config)
 *
 * 幂等建三张表:
 *   - ai_provider_configs  配置主表 (purpose + name 唯一, is_active 由 service 层保障唯一)
 *   - ai_usage_logs        使用流水 (fire-and-forget 写入, 无 FK)
 *   - ai_usage_daily       日聚合 (由 rollupDaily upsert)
 *
 * 现有 LLM 调用路径零影响:本迁移只准备数据层,不改写 openai.js / 下游 service。
 *
 * 运行:
 *   node migrate-ai-provider-config.js
 */
const db = require('./db');

async function tableExists(dbConn, tableName) {
    const row = await dbConn.prepare(`
        SELECT COUNT(*) AS c
          FROM information_schema.tables
         WHERE table_schema = DATABASE() AND table_name = ?
    `).get(tableName);
    return Number(row?.c || 0) > 0;
}

async function runStep(label, fn, { silent = false } = {}) {
    if (!silent) process.stdout.write(`${label}... `);
    await fn();
    if (!silent) console.log('OK');
}

async function runMigration({ silent = false } = {}) {
    const dbConn = db.getDb();
    if (!silent) console.log('=== AI Provider Config Migration ===');

    const step = (label, fn) => runStep(label, fn, { silent });

    await step('[1/4] create ai_provider_configs', async () => {
        await dbConn.prepare(`
            CREATE TABLE IF NOT EXISTS ai_provider_configs (
                id               INT AUTO_INCREMENT PRIMARY KEY,
                purpose          VARCHAR(64)  NOT NULL,
                name             VARCHAR(128) NOT NULL,
                model            VARCHAR(128) NOT NULL,
                base_url         VARCHAR(512) NOT NULL,
                api_key          TEXT         NOT NULL,
                extra_params     JSON         NULL,
                is_active        TINYINT(1)   NOT NULL DEFAULT 0,
                notes            TEXT         NULL,
                created_by       VARCHAR(128) NULL,
                created_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                UNIQUE KEY uniq_purpose_name (purpose, name),
                KEY idx_purpose_active (purpose, is_active)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `).run();
    });

    await step('[2/4] create ai_usage_logs', async () => {
        await dbConn.prepare(`
            CREATE TABLE IF NOT EXISTS ai_usage_logs (
                id                  BIGINT AUTO_INCREMENT PRIMARY KEY,
                provider_config_id  INT          NULL,
                purpose             VARCHAR(64)  NOT NULL,
                model               VARCHAR(128) NOT NULL,
                tokens_prompt       INT          NOT NULL DEFAULT 0,
                tokens_completion   INT          NOT NULL DEFAULT 0,
                tokens_total        INT          NOT NULL DEFAULT 0,
                latency_ms          INT          NULL,
                status              VARCHAR(32)  NOT NULL DEFAULT 'ok',
                error_message       TEXT         NULL,
                source              VARCHAR(128) NULL,
                creator_id          INT          NULL,
                created_at          DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
                KEY idx_purpose_time (purpose, created_at),
                KEY idx_config_time (provider_config_id, created_at)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `).run();
    });

    await step('[3/4] create ai_usage_daily', async () => {
        await dbConn.prepare(`
            CREATE TABLE IF NOT EXISTS ai_usage_daily (
                date                DATE         NOT NULL,
                purpose             VARCHAR(64)  NOT NULL,
                provider_config_id  INT          NOT NULL DEFAULT 0,
                model               VARCHAR(128) NOT NULL DEFAULT '',
                request_count       INT          NOT NULL DEFAULT 0,
                tokens_prompt       BIGINT       NOT NULL DEFAULT 0,
                tokens_completion   BIGINT       NOT NULL DEFAULT 0,
                tokens_total        BIGINT       NOT NULL DEFAULT 0,
                error_count         INT          NOT NULL DEFAULT 0,
                total_latency_ms    BIGINT       NOT NULL DEFAULT 0,
                PRIMARY KEY (date, purpose, provider_config_id),
                KEY idx_date (date)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `).run();
    });

    await step('[4/4] verify', async () => {
        for (const t of ['ai_provider_configs', 'ai_usage_logs', 'ai_usage_daily']) {
            if (!(await tableExists(dbConn, t))) throw new Error(`${t} table missing`);
        }
    });

    if (!silent) console.log('\n✅ ai-provider-config migration complete');
}

module.exports = { run: runMigration };

// CLI 入口
if (require.main === module) {
    require('dotenv').config();
    runMigration()
        .then(async () => { try { await db.closeDb(); } catch (_) {} process.exit(0); })
        .catch(async (err) => {
            console.error('\n❌ migration failed:', err);
            try { await db.closeDb(); } catch (_) {}
            process.exit(1);
        });
}
