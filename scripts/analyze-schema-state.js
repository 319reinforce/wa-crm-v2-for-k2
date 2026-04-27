#!/usr/bin/env node
require('dotenv').config();

const fs = require('fs');
const path = require('path');

const db = require('../db');

function parseCreateTableBlocks(sql) {
    const matches = [...sql.matchAll(/CREATE TABLE IF NOT EXISTS\s+([a-zA-Z0-9_]+)\s*\(([\s\S]*?)\)\s*ENGINE=/g)];
    const tables = {};
    for (const match of matches) {
        const tableName = match[1];
        const body = match[2];
        const columns = [];
        let generatedExpressionDepth = 0;
        for (const rawLine of body.split('\n')) {
            const line = rawLine.trim();
            if (!line || line.startsWith('--')) continue;
            if (generatedExpressionDepth > 0) {
                if (line.includes('(')) generatedExpressionDepth += (line.match(/\(/g) || []).length;
                if (line.includes(')')) generatedExpressionDepth -= (line.match(/\)/g) || []).length;
                continue;
            }
            if (/^(PRIMARY KEY|UNIQUE KEY|KEY|CONSTRAINT|FOREIGN KEY|ON DELETE|ON UPDATE)/i.test(line)) continue;
            if (/^(CASE|WHEN|ELSE|END|ON)\b/i.test(line)) continue;
            const columnMatch = line.match(/^([a-zA-Z0-9_]+)\s+/);
            if (columnMatch) {
                columns.push(columnMatch[1]);
                if (/\bAS\s*\($/i.test(line) || /\bGENERATED\b/i.test(line)) {
                    generatedExpressionDepth = 1;
                }
            }
        }
        tables[tableName] = columns;
    }
    return tables;
}

async function main() {
    const schemaSql = fs.readFileSync(path.join(process.cwd(), 'schema.sql'), 'utf8');
    const expected = parseCreateTableBlocks(schemaSql);

    const tableRows = await db.getDb().prepare('SHOW TABLES').all();
    const actualTables = tableRows.map((row) => Object.values(row)[0]).sort();
    const expectedTables = Object.keys(expected).sort();

    const missingTables = expectedTables.filter((table) => !actualTables.includes(table));
    const extraTables = actualTables.filter((table) => !expectedTables.includes(table));

    const columnDiffs = [];
    for (const table of expectedTables.filter((name) => actualTables.includes(name))) {
        const actualCols = (await db.getDb().prepare(`SHOW COLUMNS FROM ${table}`).all()).map((row) => row.Field);
        const expectedCols = expected[table] || [];
        const missingColumns = expectedCols.filter((col) => !actualCols.includes(col));
        const extraColumns = actualCols.filter((col) => !expectedCols.includes(col));
        if (missingColumns.length || extraColumns.length) {
            columnDiffs.push({ table, missingColumns, extraColumns });
        }
    }

    const keyFindings = [];
    const creatorsCols = (await db.getDb().prepare('SHOW COLUMNS FROM creators').all());
    const creatorsWaPhone = creatorsCols.find((row) => row.Field === 'wa_phone');
    if (creatorsWaPhone && creatorsWaPhone.Null === 'YES') {
        keyFindings.push('creators.wa_phone currently allows NULL, but latest schema.sql expects NOT NULL UNIQUE.');
    }

    const profilesCols = (await db.getDb().prepare('SHOW COLUMNS FROM client_profiles').all());
    const tiktokData = profilesCols.find((row) => row.Field === 'tiktok_data');
    if (tiktokData && !String(tiktokData.Type || '').toLowerCase().includes('json')) {
        keyFindings.push('client_profiles.tiktok_data is not a native JSON column yet; latest schema expects JSON.');
    }

    const lastInteraction = profilesCols.find((row) => row.Field === 'last_interaction');
    if (lastInteraction && !String(lastInteraction.Type || '').toLowerCase().includes('datetime')) {
        keyFindings.push('client_profiles.last_interaction type differs from latest schema expectation.');
    }

    console.log(JSON.stringify({
        ok: true,
        actual_table_count: actualTables.length,
        expected_table_count: expectedTables.length,
        missing_tables: missingTables,
        extra_tables: extraTables,
        column_diffs: columnDiffs,
        key_findings: keyFindings,
    }, null, 2));
}

main()
    .catch(async (error) => {
        console.error(JSON.stringify({ ok: false, error: error.message }, null, 2));
        process.exitCode = 1;
    })
    .finally(async () => {
        await db.closeDb();
    });
