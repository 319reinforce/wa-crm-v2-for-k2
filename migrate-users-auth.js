/**
 * Users + Sessions Migration
 *
 * 幂等建表 users / user_sessions,为 admin/operator 双角色登录服务。
 * 首次运行会从 env APP_LOGIN_USERNAME/APP_LOGIN_PASSWORD 种子一条 admin 账号,
 * 之后即使删除 env 也不影响(后续用户管理走 UI)。
 *
 * 运行:
 *   node migrate-users-auth.js
 */
const bcrypt = require('bcryptjs');
const db = require('./db');

const BCRYPT_COST = 12;

async function tableExists(dbConn, tableName) {
    const row = await dbConn.prepare(`
        SELECT COUNT(*) AS c
          FROM information_schema.tables
         WHERE table_schema = DATABASE() AND table_name = ?
    `).get(tableName);
    return Number(row?.c || 0) > 0;
}

async function columnExists(dbConn, tableName, columnName) {
    const row = await dbConn.prepare(`
        SELECT COUNT(*) AS c
          FROM information_schema.columns
         WHERE table_schema = DATABASE()
           AND table_name = ?
           AND column_name = ?
    `).get(tableName, columnName);
    return Number(row?.c || 0) > 0;
}

async function runStep(label, fn, { silent = false } = {}) {
    if (!silent) process.stdout.write(`${label}... `);
    await fn();
    if (!silent) console.log('OK');
}

async function runMigration({ silent = false } = {}) {
    const dbConn = db.getDb();
    if (!silent) console.log('=== Users + Sessions Migration ===');

    const step = (label, fn) => runStep(label, fn, { silent });

    await step('[1/4] create users table', async () => {
        await dbConn.prepare(`
            CREATE TABLE IF NOT EXISTS users (
                id                  INT AUTO_INCREMENT PRIMARY KEY,
                username            VARCHAR(64) NOT NULL,
                password_hash       VARCHAR(255) NOT NULL,
                role                ENUM('admin','operator') NOT NULL,
                operator_name       VARCHAR(32) NULL,
                disabled            TINYINT(1) NOT NULL DEFAULT 0,
                failed_login_count  INT NOT NULL DEFAULT 0,
                locked_until        DATETIME NULL,
                password_changed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                last_login_at       DATETIME NULL,
                created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                UNIQUE KEY uniq_users_username (username),
                KEY        idx_users_role_operator (role, operator_name)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `).run();
    });

    await step('[2/4] create user_sessions table', async () => {
        await dbConn.prepare(`
            CREATE TABLE IF NOT EXISTS user_sessions (
                token         CHAR(64) NOT NULL PRIMARY KEY,
                user_id       INT NOT NULL,
                issued_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                expires_at    DATETIME NOT NULL,
                last_seen_at  DATETIME NULL,
                revoked_at    DATETIME NULL,
                ip_address    VARCHAR(45) NULL,
                user_agent    VARCHAR(512) NULL,
                KEY idx_user_sessions_user    (user_id, revoked_at),
                KEY idx_user_sessions_expires (expires_at),
                CONSTRAINT fk_user_sessions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `).run();
    });

    await step('[3/4] seed bootstrap admin (if users table empty)', async () => {
        const countRow = await dbConn.prepare(`SELECT COUNT(*) AS c FROM users`).get();
        const count = Number(countRow?.c || 0);
        if (count > 0) {
            if (!silent) process.stdout.write(`(skip,已有 ${count} 条用户) `);
            return;
        }

        const username = String(process.env.APP_LOGIN_USERNAME || '').trim();
        const password = String(process.env.APP_LOGIN_PASSWORD || '').trim();
        if (!username || !password) {
            if (!silent) process.stdout.write('(skip,未配置 APP_LOGIN_USERNAME/PASSWORD,请稍后手工 INSERT admin) ');
            return;
        }
        const hash = await bcrypt.hash(password, BCRYPT_COST);
        await dbConn.prepare(`
            INSERT INTO users (username, password_hash, role, operator_name)
            VALUES (?, ?, 'admin', NULL)
        `).run(username, hash);
        if (!silent) process.stdout.write(`(seeded admin: ${username}) `);
    });

    await step('[4/4] verify', async () => {
        if (!(await tableExists(dbConn, 'users'))) throw new Error('users table missing');
        if (!(await tableExists(dbConn, 'user_sessions'))) throw new Error('user_sessions table missing');
        if (!(await columnExists(dbConn, 'users', 'operator_name'))) {
            throw new Error('users.operator_name column missing');
        }
    });

    if (!silent) console.log('\n✅ users + sessions migration complete');
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
