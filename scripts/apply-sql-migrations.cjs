#!/usr/bin/env node
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const args = process.argv.slice(2);
const allowRemote = args.includes('--allow-remote') || /^(1|true|yes)$/i.test(String(process.env.CONFIRM_REMOTE_MIGRATION || '').trim());
const files = args.filter((arg) => arg !== '--allow-remote');

if (files.length === 0) {
    console.error('Usage: node scripts/apply-sql-migrations.cjs [--allow-remote] server/migrations/NNN_name.sql [...]');
    process.exit(1);
}

const config = {
    host: process.env.DB_HOST || '127.0.0.1',
    port: parseInt(process.env.DB_PORT || '3306', 10),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'wa_crm_v2',
    charset: 'utf8mb4',
    timezone: '+08:00',
    multipleStatements: true,
};

const localHosts = new Set(['127.0.0.1', 'localhost', '::1', 'mysql']);
if (!localHosts.has(String(config.host).trim().toLowerCase()) && !allowRemote) {
    console.error(`[apply-sql-migrations] Refusing non-local DB_HOST=${config.host}. Set CONFIRM_REMOTE_MIGRATION=1 or pass --allow-remote intentionally.`);
    process.exit(1);
}

function resolveMigrationPath(file) {
    const resolved = path.resolve(process.cwd(), file);
    const relative = path.relative(process.cwd(), resolved);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
        throw new Error(`Migration must be inside repository: ${file}`);
    }
    if (!fs.existsSync(resolved)) {
        throw new Error(`Migration not found: ${file}`);
    }
    return resolved;
}

async function main() {
    console.log(`[apply-sql-migrations] target=${config.user}@${config.host}:${config.port}/${config.database}`);
    const conn = await mysql.createConnection(config);
    try {
        for (const file of files) {
            const resolved = resolveMigrationPath(file);
            const sql = fs.readFileSync(resolved, 'utf8');
            console.log(`[apply-sql-migrations] applying ${path.relative(process.cwd(), resolved)}`);
            await conn.query(sql);
        }
        console.log('[apply-sql-migrations] done');
    } finally {
        await conn.end();
    }
}

main().catch((err) => {
    console.error('[apply-sql-migrations] failed:', err.message);
    process.exit(1);
});
