/**
 * Seed ai_provider_configs (Phase 0)
 *
 * 读取当前 .env 的 OPENAI_API_KEY / OPENAI_API_BASE / OPENAI_MODEL,
 * 为 6 个 purpose 各插入 1 条 (name='env-default', is_active=1) 的默认配置。
 *
 * 幂等:已存在 (purpose, name) 的行 -> 跳过,不覆盖用户已手改的配置。
 *
 * 运行:
 *   npm run db:seed:ai-providers
 */
require('dotenv').config();
const db = require('../db');
const { PURPOSES } = require('../server/services/aiProviderConfigService');

async function main() {
    const baseKey = process.env.OPENAI_API_KEY || 'PLACEHOLDER';
    const baseUrl = process.env.OPENAI_API_BASE || 'https://api.minimaxi.com/anthropic';
    const baseModel = process.env.OPENAI_MODEL || process.env.MINIMAX_MODEL || 'MiniMax-M2.7-highspeed';

    // 每个 purpose 一条 env-default, extra_params 留给阶段 1 前端细化
    const defaults = PURPOSES.map((purpose) => ({
        purpose,
        name: 'env-default',
        model: baseModel,
        base_url: baseUrl,
        api_key: baseKey,
        extra_params: purpose === 'reply-generation'
            ? { temperature: 0.7, max_tokens: 500 }
            : {},
    }));

    const dbConn = db.getDb();
    let inserted = 0;
    let skipped = 0;

    for (const d of defaults) {
        const exist = await dbConn.prepare(
            'SELECT id, is_active FROM ai_provider_configs WHERE purpose = ? AND name = ? LIMIT 1'
        ).get(d.purpose, d.name);

        if (exist) {
            console.log(`[seed] skip ${d.purpose}/${d.name} (exists id=${exist.id}, is_active=${exist.is_active})`);
            skipped += 1;
            continue;
        }

        const res = await dbConn.prepare(`
            INSERT INTO ai_provider_configs
                (purpose, name, model, base_url, api_key, extra_params, is_active, created_by)
            VALUES (?, ?, ?, ?, ?, ?, 1, 'seed-script')
        `).run(
            d.purpose,
            d.name,
            d.model,
            d.base_url,
            d.api_key,
            JSON.stringify(d.extra_params),
        );
        console.log(`[seed] inserted ${d.purpose}/${d.name} id=${res.lastInsertRowid || 0}`);
        inserted += 1;
    }

    console.log(`\n[seed] done. inserted=${inserted} skipped=${skipped} total=${defaults.length}`);
}

main()
    .then(async () => { try { await db.closeDb(); } catch (_) {} process.exit(0); })
    .catch(async (err) => {
        console.error('[seed] failed:', err);
        try { await db.closeDb(); } catch (_) {}
        process.exit(1);
    });
