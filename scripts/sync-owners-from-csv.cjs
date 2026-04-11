#!/usr/bin/env node
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const db = require('../db');
const { normalizeOperatorName } = require('../server/utils/operator');

function normalizeText(value) {
    return String(value || '')
        .trim()
        .toLowerCase()
        .split('')
        .filter(ch => /[a-z0-9]/.test(ch))
        .join('');
}

function parseCsv(content) {
    const lines = content
        .replace(/^\uFEFF/, '')
        .split(/\r?\n/)
        .filter(Boolean);
    if (lines.length ***REMOVED***= 0) return [];
    const headers = splitCsvLine(lines[0]);
    return lines.slice(1).map((line) => {
        const values = splitCsvLine(line);
        const row = {};
        headers.forEach((header, index) => {
            row[header] = values[index] || '';
        });
        return row;
    });
}

function splitCsvLine(line) {
    const result = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i += 1) {
        const ch = line[i];
        if (ch ***REMOVED***= '"') {
            if (inQuotes && line[i + 1] ***REMOVED***= '"') {
                current += '"';
                i += 1;
            } else {
                inQuotes = !inQuotes;
            }
            continue;
        }
        if (ch ***REMOVED***= ',' && !inQuotes) {
            result.push(current);
            current = '';
            continue;
        }
        current += ch;
    }
    result.push(current);
    return result.map(v => v.trim());
}

function getRowCandidates(row) {
    return [
        { label: 'keeper', raw: row['Keeper Name'] || '' },
        { label: 'handle', raw: row.Handle || row.Name || '' },
        { label: 'real_name', raw: row['真名'] || row.Name || '' },
    ].filter(item => normalizeText(item.raw));
}

async function main() {
    const args = process.argv.slice(2);
    const apply = args.includes('--apply');
    const fileArgs = args.filter(arg => !arg.startsWith('--'));
    if (fileArgs.length ***REMOVED***= 0) {
        console.error('Usage: node scripts/sync-owners-from-csv.cjs [--apply] Owner=/abs/path.csv ...');
        process.exit(1);
    }

    const inputFiles = fileArgs.map((arg) => {
        const [ownerRaw, ...rest] = arg.split('=');
        const filePath = rest.join('=');
        if (!ownerRaw || !filePath) {
            throw new Error(`Invalid file argument: ${arg}`);
        }
        return {
            owner: normalizeOperatorName(ownerRaw, ownerRaw),
            filePath,
        };
    });

    const db2 = db.getDb();
    const creators = await db2.prepare('SELECT id, primary_name, keeper_username, wa_owner FROM creators').all();
    const aliases = await db2.prepare('SELECT creator_id, alias_value FROM creator_aliases').all();

    const creatorById = new Map(creators.map(c => [String(c.id), c]));
    const index = new Map();
    function addIndex(key, creatorId) {
        if (!key) return;
        const bucket = index.get(key) || new Set();
        bucket.add(String(creatorId));
        index.set(key, bucket);
    }

    for (const creator of creators) {
        addIndex(normalizeText(creator.primary_name), creator.id);
        addIndex(normalizeText(creator.keeper_username), creator.id);
    }
    for (const alias of aliases) {
        addIndex(normalizeText(alias.alias_value), alias.creator_id);
    }

    const updates = [];
    const report = [];

    for (const { owner, filePath } of inputFiles) {
        const content = fs.readFileSync(filePath, 'utf8');
        const rows = parseCsv(content);
        let matched = 0;
        const skipped = [];

        for (const row of rows) {
            let resolved = null;
            for (const candidate of getRowCandidates(row)) {
                const ids = [...(index.get(normalizeText(candidate.raw)) || [])];
                if (ids.length ***REMOVED***= 1) {
                    resolved = { creatorId: ids[0], reason: `exact:${candidate.label}`, raw: candidate.raw };
                    break;
                }
            }
            if (!resolved) {
                skipped.push(row);
                continue;
            }
            matched += 1;
            const creator = creatorById.get(String(resolved.creatorId));
            if (creator && creator.wa_owner !***REMOVED*** owner) {
                updates.push({
                    id: Number(resolved.creatorId),
                    from: creator.wa_owner,
                    to: owner,
                    name: creator.primary_name,
                    reason: resolved.reason,
                    raw: resolved.raw,
                });
            }
        }

        report.push({
            owner,
            file: path.basename(filePath),
            rows: rows.length,
            matched,
            skipped: skipped.length,
            skippedPreview: skipped.slice(0, 8),
        });
    }

    if (apply && updates.length > 0) {
        for (const update of updates) {
            await db2.prepare('UPDATE creators SET wa_owner = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(update.to, update.id);
        }
    }

    console.log(JSON.stringify({
        mode: apply ? 'apply' : 'dry-run',
        files: report,
        updates,
        updateCount: updates.length,
    }, null, 2));

    await db.closeDb();
}

main().catch(async (error) => {
    console.error('[sync-owners-from-csv] failed:', error);
    try { await db.closeDb(); } catch (_) {}
    process.exit(1);
});
