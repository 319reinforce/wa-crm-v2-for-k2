/**
 * audit_log 扩列迁移
 *
 * 给 audit_log 表补 user_id / user_role / auth_source / token_principal 四列,
 * 供 writeAudit 写入"谁"做的操作(DB 用户 or env token 名)。
 * 全部走 information_schema 探测,幂等可重入。
 *
 * 运行:
 *   node migrate-audit-log-user-fields.js
 */
const db = require('./db');

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

async function indexExists(dbConn, tableName, indexName) {
    const row = await dbConn.prepare(`
        SELECT COUNT(*) AS c
          FROM information_schema.statistics
         WHERE table_schema = DATABASE()
           AND table_name = ?
           AND index_name = ?
    `).get(tableName, indexName);
    return Number(row?.c || 0) > 0;
}

async function runStep(label, fn, { silent = false } = {}) {
    if (!silent) process.stdout.write(`${label}... `);
    await fn();
    if (!silent) console.log('OK');
}

async function runMigration({ silent = false } = {}) {
    const dbConn = db.getDb();
    if (!silent) console.log('=== audit_log user-fields Migration ===');

    const step = (label, fn) => runStep(label, fn, { silent });

    await step('[1/5] add user_id column', async () => {
        if (await columnExists(dbConn, 'audit_log', 'user_id')) return;
        await dbConn.prepare(`ALTER TABLE audit_log ADD COLUMN user_id INT NULL`).run();
    });

    await step('[2/5] add user_role column', async () => {
        if (await columnExists(dbConn, 'audit_log', 'user_role')) return;
        await dbConn.prepare(`ALTER TABLE audit_log ADD COLUMN user_role VARCHAR(16) NULL`).run();
    });

    await step('[3/5] add auth_source column', async () => {
        if (await columnExists(dbConn, 'audit_log', 'auth_source')) return;
        await dbConn.prepare(`ALTER TABLE audit_log ADD COLUMN auth_source VARCHAR(8) NULL`).run();
    });

    await step('[4/5] add token_principal column', async () => {
        if (await columnExists(dbConn, 'audit_log', 'token_principal')) return;
        await dbConn.prepare(`ALTER TABLE audit_log ADD COLUMN token_principal VARCHAR(64) NULL`).run();
    });

    await step('[5/5] add idx_audit_user index', async () => {
        if (await indexExists(dbConn, 'audit_log', 'idx_audit_user')) return;
        await dbConn.prepare(`CREATE INDEX idx_audit_user ON audit_log(user_id)`).run();
    });

    if (!silent) console.log('\n✅ audit_log user-fields migration complete');
}

module.exports = { run: runMigration };

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
