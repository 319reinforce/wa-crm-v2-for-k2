/**
 * WA Sessions Migration
 *
 * 幂等建表 wa_sessions,用于 SessionRegistry 的 desired/runtime 状态持久化。
 * k8s controller 风格:desired_state = 用户意图,runtime_state = Registry 观察值。
 *
 * 运行:
 *   node migrate-wa-sessions.js           # CLI 模式
 *   require('./migrate-wa-sessions').run() # API 启动时内嵌模式
 */
const db = require('./db');

async function runStep(label, fn, { silent = false } = {}) {
    if (!silent) process.stdout.write(`${label}... `);
    await fn();
    if (!silent) console.log('OK');
}

async function runMigration({ silent = false } = {}) {
    const dbConn = db.getDb();
    if (!silent) console.log('=== WA Sessions Migration ===');

    const step = (label, fn) => runStep(label, fn, { silent });

    await step('[1/3] create wa_sessions table', async () => {
        await dbConn.prepare(`
            CREATE TABLE IF NOT EXISTS wa_sessions (
                id                         BIGINT PRIMARY KEY AUTO_INCREMENT,
                session_id                 VARCHAR(64)  NOT NULL,
                owner                      VARCHAR(64)  NOT NULL,
                aliases                    JSON         DEFAULT NULL,

                desired_state              ENUM('running','stopped') NOT NULL DEFAULT 'running',
                desired_state_changed_at   DATETIME     DEFAULT CURRENT_TIMESTAMP,
                desired_state_changed_by   VARCHAR(64)  DEFAULT NULL,

                runtime_state              ENUM('pending','starting','ready','stale','crashed','stopped') NOT NULL DEFAULT 'pending',
                runtime_phase              VARCHAR(32)  DEFAULT NULL,
                runtime_pid                INT          DEFAULT NULL,
                last_heartbeat_at          DATETIME     DEFAULT NULL,
                last_ready_at              DATETIME     DEFAULT NULL,
                last_exit_code             INT          DEFAULT NULL,
                last_exit_signal           VARCHAR(16)  DEFAULT NULL,
                restart_count              INT          NOT NULL DEFAULT 0,
                last_restart_at            DATETIME     DEFAULT NULL,
                last_error                 TEXT         DEFAULT NULL,

                account_phone              VARCHAR(32)  DEFAULT NULL,
                account_pushname           VARCHAR(128) DEFAULT NULL,
                account_bound_at           DATETIME     DEFAULT NULL,

                created_at                 DATETIME     DEFAULT CURRENT_TIMESTAMP,
                created_by                 VARCHAR(64)  DEFAULT NULL,
                updated_at                 DATETIME     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

                UNIQUE KEY uniq_session_id (session_id),
                KEY idx_desired (desired_state),
                KEY idx_runtime (runtime_state),
                KEY idx_owner   (owner)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `).run();
    });

    // MySQL 8 不支持直接 WHERE partial unique index,用函数索引 + virtual column 实现
    // "一个 owner 只允许一个 desired=running 的 session" 约束
    await step('[2/3] add owner-active uniqueness guard', async () => {
        // virtual column 只在 desired=running 时返回 owner,其它状态返回 NULL
        // NULL 不参与 UNIQUE 约束,从而只限制 running session 的 owner 唯一
        const [colRow] = await dbConn.prepare(`
            SELECT COUNT(*) AS c
              FROM information_schema.columns
             WHERE table_schema = DATABASE()
               AND table_name = 'wa_sessions'
               AND column_name = 'owner_if_running'
        `).all();
        if (Number(colRow?.c || 0) === 0) {
            await dbConn.prepare(`
                ALTER TABLE wa_sessions
                ADD COLUMN owner_if_running VARCHAR(64) AS (
                    CASE WHEN desired_state = 'running' THEN owner ELSE NULL END
                ) STORED,
                ADD UNIQUE KEY uniq_owner_running (owner_if_running)
            `).run();
        }
    });

    await step('[3/3] verify schema', async () => {
        const row = await dbConn.prepare(`
            SELECT COUNT(*) AS c
              FROM information_schema.tables
             WHERE table_schema = DATABASE() AND table_name = 'wa_sessions'
        `).get();
        if (Number(row?.c || 0) !== 1) {
            throw new Error('wa_sessions table not created');
        }
    });

    if (!silent) console.log('\n✅ wa_sessions migration complete');
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
