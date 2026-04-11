#!/usr/bin/env node
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const db = require('../db');

function ensureDir(dirPath) {
    fs.mkdirSync(dirPath, { recursive: true });
}

async function main() {
    const outdir = process.argv[2];
    if (!outdir) {
        throw new Error('Usage: node scripts/generate-migration-readiness-snapshot.js <output-dir>');
    }

    ensureDir(outdir);

    const conn = db.getDb();
    const q1 = async (sql, params = []) => conn.prepare(sql).get(...params);
    const qa = async (sql, params = []) => conn.prepare(sql).all(...params);

    const tables = [
        'creators', 'creator_aliases', 'wa_messages', 'wa_crm_data', 'keeper_link', 'joinbrands_link', 'manual_match',
        'sft_memory', 'retrieval_snapshot', 'generation_log', 'sft_feedback', 'client_memory', 'policy_documents',
        'sync_log', 'audit_log', 'client_profiles', 'client_tags', 'operator_experiences', 'events', 'event_periods',
        'events_policy', 'operator_creator_roster', 'training_log'
    ];

    const rowCounts = {};
    for (const table of tables) {
        rowCounts[table] = (await q1(`SELECT COUNT(*) AS c FROM ${table}`)).c;
    }

    const normalizedPhoneDupRows = await qa(`
        SELECT normalized_phone, COUNT(*) AS row_count, GROUP_CONCAT(id ORDER BY id) AS creator_ids
        FROM (
            SELECT id, REGEXP_REPLACE(wa_phone, '[^0-9]+', '') AS normalized_phone
            FROM creators
            WHERE wa_phone IS NOT NULL AND TRIM(wa_phone) <> ''
        ) x
        WHERE normalized_phone <> ''
        GROUP BY normalized_phone
        HAVING COUNT(*) > 1
        ORDER BY COUNT(*) DESC, normalized_phone ASC
    `);

    const keeperDupRows = await qa(`
        SELECT keeper_username, COUNT(*) AS row_count, GROUP_CONCAT(id ORDER BY id) AS creator_ids
        FROM creators
        WHERE keeper_username IS NOT NULL AND TRIM(keeper_username) <> ''
        GROUP BY keeper_username
        HAVING COUNT(*) > 1
        ORDER BY COUNT(*) DESC, keeper_username ASC
    `);

    const rosterDupRows = await qa(`
        SELECT operator,
               COALESCE(raw_name, '') AS raw_name,
               COALESCE(raw_handle, '') AS raw_handle,
               COALESCE(raw_keeper_name, '') AS raw_keeper_name,
               COUNT(*) AS row_count,
               GROUP_CONCAT(creator_id ORDER BY creator_id) AS creator_ids
        FROM operator_creator_roster
        GROUP BY operator, COALESCE(raw_name, ''), COALESCE(raw_handle, ''), COALESCE(raw_keeper_name, '')
        HAVING COUNT(*) > 1
        ORDER BY COUNT(*) DESC, operator ASC
    `);

    const aliasDupRows = await qa(`
        SELECT alias_type, alias_value, COUNT(*) AS row_count, GROUP_CONCAT(creator_id ORDER BY creator_id) AS creator_ids
        FROM creator_aliases
        GROUP BY alias_type, alias_value
        HAVING COUNT(*) > 1
        ORDER BY COUNT(*) DESC, alias_type ASC, alias_value ASC
    `);

    const msgHashDupRows = await qa(`
        SELECT creator_id, message_hash, COUNT(*) AS row_count
        FROM wa_messages
        WHERE message_hash IS NOT NULL AND message_hash <> ''
        GROUP BY creator_id, message_hash
        HAVING COUNT(*) > 1
        ORDER BY COUNT(*) DESC, creator_id ASC
        LIMIT 200
    `);

    const uniqueIndexes = await qa(`
        SELECT TABLE_NAME AS table_name,
               INDEX_NAME AS index_name,
               GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS columns
        FROM information_schema.statistics
        WHERE TABLE_SCHEMA = DATABASE() AND NON_UNIQUE = 0
        GROUP BY TABLE_NAME, INDEX_NAME
        ORDER BY TABLE_NAME, INDEX_NAME
    `);

    const jsonColumns = await qa(`
        SELECT TABLE_NAME AS table_name, COLUMN_NAME AS column_name
        FROM information_schema.columns
        WHERE TABLE_SCHEMA = DATABASE() AND DATA_TYPE = 'json'
        ORDER BY TABLE_NAME, COLUMN_NAME
    `);

    const jsonHealth = [];
    for (const column of jsonColumns) {
        const sql = `
            SELECT COUNT(*) AS total_rows,
                   SUM(\`${column.column_name}\` IS NULL) AS null_rows,
                   SUM(JSON_VALID(\`${column.column_name}\`) = 0) AS invalid_rows
            FROM \`${column.table_name}\`
        `;
        const res = await q1(sql);
        jsonHealth.push({
            table_name: column.table_name,
            column_name: column.column_name,
            total_rows: Number(res.total_rows || 0),
            null_rows: Number(res.null_rows || 0),
            invalid_rows: Number(res.invalid_rows || 0),
        });
    }

    const tableCollations = await qa(`
        SELECT TABLE_NAME AS table_name, TABLE_COLLATION AS table_collation
        FROM information_schema.tables
        WHERE TABLE_SCHEMA = DATABASE()
        ORDER BY TABLE_NAME
    `);

    const columnCollations = await qa(`
        SELECT TABLE_NAME AS table_name,
               COLUMN_NAME AS column_name,
               DATA_TYPE AS data_type,
               COLLATION_NAME AS collation_name
        FROM information_schema.columns
        WHERE TABLE_SCHEMA = DATABASE() AND COLLATION_NAME IS NOT NULL
        ORDER BY TABLE_NAME, COLUMN_NAME
    `);

    const rosterSummary = await qa(`
        SELECT operator,
               COUNT(*) AS roster_count,
               SUM(CASE WHEN c.wa_phone IS NOT NULL AND TRIM(c.wa_phone) <> '' THEN 1 ELSE 0 END) AS mapped_count,
               SUM(CASE WHEN c.wa_phone IS NULL OR TRIM(c.wa_phone) = '' THEN 1 ELSE 0 END) AS unmapped_count
        FROM operator_creator_roster ocr
        JOIN creators c ON c.id = ocr.creator_id
        WHERE ocr.is_primary = 1
        GROUP BY operator
        ORDER BY operator
    `);

    const healthSummary = {
        creators_null_phone: (await q1("SELECT COUNT(*) AS c FROM creators WHERE wa_phone IS NULL OR TRIM(wa_phone) = ''")).c,
        creators_null_keeper: (await q1("SELECT COUNT(*) AS c FROM creators WHERE keeper_username IS NULL OR TRIM(keeper_username) = ''")).c,
        active_creators: (await q1('SELECT COUNT(*) AS c FROM creators WHERE is_active = 1')).c,
        roster_total: (await q1('SELECT COUNT(*) AS c FROM operator_creator_roster WHERE is_primary = 1')).c,
        message_null_hash: (await q1("SELECT COUNT(*) AS c FROM wa_messages WHERE message_hash IS NULL OR message_hash = ''")).c,
        normalized_phone_duplicate_groups: normalizedPhoneDupRows.length,
        keeper_username_duplicate_groups: keeperDupRows.length,
        alias_duplicate_groups: aliasDupRows.length,
        roster_duplicate_groups: rosterDupRows.length,
        message_hash_duplicate_groups: msgHashDupRows.length,
    };

    const trainingLogDependency = {
        table_exists: tables.includes('training_log'),
        code_references: [
            '/Users/depp/wa-bot/wa-crm-v2/server/routes/training.js',
            '/Users/depp/wa-bot/wa-crm-v2/server/workers/trainingWorker.js',
            '/Users/depp/wa-bot/wa-crm-v2/docs/SFT_RLHF_PIPELINE.md'
        ]
    };

    const report = {
        generated_at: new Date().toISOString(),
        database: process.env.DB_NAME || 'wa_crm_v2',
        health_summary: healthSummary,
        roster_summary: rosterSummary,
        row_counts: rowCounts,
        unique_indexes: uniqueIndexes,
        duplicate_candidates: {
            normalized_phone_duplicates: normalizedPhoneDupRows,
            keeper_username_duplicates: keeperDupRows,
            creator_alias_duplicates: aliasDupRows,
            operator_roster_duplicates: rosterDupRows,
            message_hash_duplicates_sample: msgHashDupRows,
        },
        json_health: jsonHealth,
        table_collations: tableCollations,
        column_collations: columnCollations,
        training_log_dependency: trainingLogDependency,
        notes: [
            'training_log is an extra table versus latest schema.sql and is referenced by training routes and worker.',
            'sft_memory currently lacks system_prompt_used according to prior schema diff analysis.',
            'creators.wa_phone still allows NULL in current DB, while latest schema.sql expects NOT NULL UNIQUE.'
        ]
    };

    fs.writeFileSync(path.join(outdir, 'health-check.json'), JSON.stringify(report, null, 2));
    fs.writeFileSync(path.join(outdir, 'row-count-snapshot.json'), JSON.stringify({
        generated_at: report.generated_at,
        row_counts: rowCounts,
        roster_summary: rosterSummary,
        key_health: healthSummary,
    }, null, 2));

    await db.closeDb();
}

main().catch(async (error) => {
    console.error(error);
    try {
        await db.closeDb();
    } catch (_) {}
    process.exit(1);
});
