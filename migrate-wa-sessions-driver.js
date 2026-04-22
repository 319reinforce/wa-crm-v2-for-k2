/**
 * WA Sessions Driver Migration
 *
 * 给 wa_sessions 表添加 driver / driver_meta 列 + idx_driver 索引。
 * 幂等：存在就跳过。
 *
 * 运行：
 *   node migrate-wa-sessions-driver.js           # CLI
 *   require('./migrate-wa-sessions-driver').run() # server/index.cjs startup
 */
const db = require('./db');

async function runStep(label, fn, { silent }) {
    if (!silent) process.stdout.write(`${label}... `);
    await fn();
    if (!silent) console.log('OK');
}

async function runMigration({ silent = false } = {}) {
    const dbConn = db.getDb();
    if (!silent) console.log('=== WA Sessions Driver Migration ===');

    const step = (label, fn) => runStep(label, fn, { silent });

    await step('[1/3] add driver column', async () => {
        const row = await dbConn.prepare(`
            SELECT COUNT(*) AS c
              FROM information_schema.columns
             WHERE table_schema = DATABASE()
               AND table_name = 'wa_sessions'
               AND column_name = 'driver'
        `).get();
        if (Number(row?.c || 0) === 0) {
            await dbConn.prepare(`
                ALTER TABLE wa_sessions
                ADD COLUMN driver VARCHAR(16) NOT NULL DEFAULT 'wwebjs' AFTER aliases
            `).run();
        }
    });

    await step('[2/3] add driver_meta column', async () => {
        const row = await dbConn.prepare(`
            SELECT COUNT(*) AS c
              FROM information_schema.columns
             WHERE table_schema = DATABASE()
               AND table_name = 'wa_sessions'
               AND column_name = 'driver_meta'
        `).get();
        if (Number(row?.c || 0) === 0) {
            await dbConn.prepare(`
                ALTER TABLE wa_sessions
                ADD COLUMN driver_meta JSON NULL AFTER driver
            `).run();
        }
    });

    await step('[3/3] add idx_driver index', async () => {
        const row = await dbConn.prepare(`
            SELECT COUNT(*) AS c
              FROM information_schema.statistics
             WHERE table_schema = DATABASE()
               AND table_name = 'wa_sessions'
               AND index_name = 'idx_driver'
        `).get();
        if (Number(row?.c || 0) === 0) {
            await dbConn.prepare(`
                ALTER TABLE wa_sessions ADD INDEX idx_driver (driver)
            `).run();
        }
    });

    if (!silent) console.log('\n✅ wa_sessions driver migration complete');
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
