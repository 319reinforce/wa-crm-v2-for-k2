/**
 * WA Sessions Driver Migration
 *
 * Adds `driver` and `driver_meta` columns to wa_sessions.
 * Idempotent: safe to run multiple times.
 *
 * 运行:
 *   node migrate-wa-sessions-driver.js           # CLI
 *   require('./migrate-wa-sessions-driver').run() # 内嵌
 */
const db = require('./db');
const path = require('path');
const fs = require('fs');

async function runMigration({ silent = false } = {}) {
    const dbConn = db.getDb();
    if (!silent) console.log('=== WA Sessions Driver Migration ===');

    const step = (label, fn) => {
        if (!silent) process.stdout.write(`${label}... `);
        return fn().then(() => {
            if (!silent) console.log('OK');
        });
    };

    // Check if column exists
    await step('[1/2] check if driver column exists', async () => {
        try {
            const [rows] = await dbConn.query(`
                SELECT column_name
                FROM information_schema.columns
                WHERE table_schema = DATABASE()
                  AND table_name = 'wa_sessions'
                  AND column_name = 'driver'
            `);
            if (rows.length > 0) {
                if (!silent) console.log('(already exists, skipping)');
                return;
            }
        } catch (err) {
            // information_schema may not be accessible; proceed with ALTER
        }

        // Run the migration SQL (read from file)
        const sqlPath = path.join(__dirname, 'server/migrations/003_add_wa_sessions_driver.sql');
        let sql = fs.readFileSync(sqlPath, 'utf8');
        // Remove -- comments and clean up for mysql2 query()
        sql = sql.replace(/--.*$/gm, '').trim();
        // Split on semicolons, filter empty
        const statements = sql.split(';').map(s => s.trim()).filter(Boolean);
        for (const stmt of statements) {
            if (!stmt) continue;
            try {
                await dbConn.query(stmt);
            } catch (err) {
                // Ignore "Duplicate key name" for index creation
                if (!err.message.includes('Duplicate key name') && !err.message.includes('already exists')) {
                    console.error(`SQL error: ${err.message}`);
                    throw err;
                }
            }
        }
    });

    // Verify
    await step('[2/2] verify columns', async () => {
        const [rows] = await dbConn.query(`
            SELECT column_name, data_type, column_default, is_nullable
            FROM information_schema.columns
            WHERE table_schema = DATABASE()
              AND table_name = 'wa_sessions'
              AND column_name IN ('driver', 'driver_meta')
            ORDER BY ordinal_position
        `);
        if (!silent) {
            console.log('Columns:');
            for (const r of rows) {
                console.log(`  - ${r.column_name}: ${r.data_type} default=${r.column_default} nullable=${r.is_nullable}`);
            }
        }
    });

    if (!silent) console.log('=== Done ===');
}

// CLI mode
if (require.main === module) {
    runMigration().catch((err) => {
        console.error('Migration failed:', err.message);
        process.exit(1);
    });
}

module.exports = { runMigration };