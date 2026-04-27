#!/usr/bin/env node
require('dotenv').config();

const fs = require('fs');
const path = require('path');

const db = require('../db');

function parseSchemaSql(sql) {
    const matches = [...sql.matchAll(/CREATE TABLE IF NOT EXISTS\s+([a-zA-Z0-9_]+)\s*\(([\s\S]*?)\)\s*ENGINE=/g)];
    const tables = {};
    const indexes = {};
    const addIndex = (tableName, indexName, expression = '') => {
        if (!indexes[tableName]) indexes[tableName] = [];
        indexes[tableName].push({
            name: indexName,
            signature: normalizeIndexExpression(expression),
        });
    };
    for (const match of matches) {
        const tableName = match[1];
        const body = match[2];
        const columns = [];
        let generatedExpressionDepth = 0;
        for (const rawLine of body.split('\n')) {
            const line = rawLine.trim();
            if (!line || line.startsWith('--')) continue;
            const inlineIndexMatch = line.match(/^(?:UNIQUE\s+)?KEY\s+([a-zA-Z0-9_]+)\s*\((.*)\),?$/i);
            if (inlineIndexMatch) {
                addIndex(tableName, inlineIndexMatch[1], inlineIndexMatch[2]);
                continue;
            }
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

    for (const rawLine of sql.split('\n')) {
        const line = rawLine.trim();
        const standaloneMatch = line.match(/^CREATE\s+(?:UNIQUE\s+)?INDEX\s+([a-zA-Z0-9_]+)\s+ON\s+([a-zA-Z0-9_]+)\s*\((.*)\);?$/i);
        if (standaloneMatch) {
            addIndex(standaloneMatch[2], standaloneMatch[1], standaloneMatch[3]);
        }
    }

    return { tables, indexes };
}

function splitIndexExpression(expression) {
    const result = [];
    let depth = 0;
    let current = '';
    for (const ch of String(expression || '')) {
        if (ch === '(') depth += 1;
        if (ch === ')') depth -= 1;
        if (ch === ',' && depth === 0) {
            result.push(current);
            current = '';
            continue;
        }
        current += ch;
    }
    if (current.trim()) result.push(current);
    return result;
}

function normalizeIndexExpression(expression) {
    return splitIndexExpression(expression)
        .map((part) => part
            .replace(/`/g, '')
            .replace(/\(\s*\d+\s*\)/g, '')
            .replace(/\s+DESC$/i, '')
            .replace(/\s+ASC$/i, '')
            .replace(/\s+/g, ' ')
            .trim()
            .toLowerCase())
        .filter(Boolean)
        .join('|');
}

async function main() {
    const schemaSql = fs.readFileSync(path.join(process.cwd(), 'schema.sql'), 'utf8');
    const { tables: expected, indexes: expectedIndexes } = parseSchemaSql(schemaSql);

    const tableRows = await db.getDb().prepare('SHOW TABLES').all();
    const actualTables = tableRows.map((row) => Object.values(row)[0]).sort();
    const expectedTables = Object.keys(expected).sort();

    const missingTables = expectedTables.filter((table) => !actualTables.includes(table));
    const extraTables = actualTables.filter((table) => !expectedTables.includes(table));

    const columnDiffs = [];
    const indexDiffs = [];
    for (const table of expectedTables.filter((name) => actualTables.includes(name))) {
        const actualCols = (await db.getDb().prepare(`SHOW COLUMNS FROM ${table}`).all()).map((row) => row.Field);
        const expectedCols = expected[table] || [];
        const missingColumns = expectedCols.filter((col) => !actualCols.includes(col));
        const extraColumns = actualCols.filter((col) => !expectedCols.includes(col));
        if (missingColumns.length || extraColumns.length) {
            columnDiffs.push({ table, missingColumns, extraColumns });
        }

        const expectedTableIndexes = [...(expectedIndexes[table] || new Set())].sort();
        if (expectedTableIndexes.length > 0) {
            const actualIndexRows = await db.getDb().prepare(`SHOW INDEX FROM ${table}`).all();
            const actualByName = new Map();
            for (const row of actualIndexRows) {
                if (!row.Key_name || row.Key_name === 'PRIMARY') continue;
                if (!actualByName.has(row.Key_name)) actualByName.set(row.Key_name, []);
                actualByName.get(row.Key_name).push(row);
            }
            const actualIndexNames = new Set(actualByName.keys());
            const actualSignatures = new Set([...actualByName.values()].map((rows) => {
                const sorted = rows.sort((a, b) => Number(a.Seq_in_index || 0) - Number(b.Seq_in_index || 0));
                return sorted.map((row) => String(row.Expression || row.Column_name || '').trim().toLowerCase()).join('|');
            }));
            const missingIndexes = expectedTableIndexes
                .filter((index) => index.signature && !actualSignatures.has(index.signature) && !actualIndexNames.has(index.name))
                .map((index) => index.name);
            if (missingIndexes.length) {
                indexDiffs.push({ table, missingIndexes });
            }
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
        index_diffs: indexDiffs,
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
