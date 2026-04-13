#!/usr/bin/env node
require('dotenv').config();

const fs = require('fs');
const path = require('path');

const db = require('../db');

const REPORT_ROOT = process.argv.includes('--out-dir')
    ? process.argv[process.argv.indexOf('--out-dir') + 1]
    : path.join(process.cwd(), 'reports');

function ensureDir(dir) {
    fs.mkdirSync(dir, { recursive: true });
}

function csvEscape(value) {
    const text = value == null ? '' : String(value);
    if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
    return text;
}

function toCsv(rows, headers) {
    const lines = [headers.join(',')];
    for (const row of rows) {
        lines.push(headers.map((header) => csvEscape(row[header])).join(','));
    }
    return lines.join('\n');
}

function normalizeText(value) {
    return String(value || '')
        .normalize('NFKC')
        .replace(/[\u200B-\u200D\uFEFF]/g, '')
        .replace(/[_|]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
}

function compactText(value) {
    return normalizeText(value).replace(/[^a-z0-9]+/g, '');
}

function tokenize(value) {
    return normalizeText(value)
        .split(/[^a-z0-9]+/)
        .map((item) => item.trim())
        .filter((item) => item.length >= 2);
}

function parseAliasBlob(blob) {
    return String(blob || '')
        .split(' | ')
        .map((entry) => {
            const idx = entry.indexOf(':');
            if (idx === -1) return null;
            return {
                aliasType: entry.slice(0, idx),
                aliasValue: entry.slice(idx + 1),
            };
        })
        .filter(Boolean);
}

function tokenOverlap(a = [], b = []) {
    if (!a.length || !b.length) return 0;
    const setB = new Set(b);
    let overlap = 0;
    for (const token of a) {
        if (setB.has(token)) overlap += 1;
    }
    return overlap / Math.max(a.length, b.length);
}

function levenshtein(a, b) {
    const left = String(a || '');
    const right = String(b || '');
    if (!left) return right.length;
    if (!right) return left.length;
    const dp = Array.from({ length: left.length + 1 }, (_, i) => [i]);
    for (let j = 1; j <= right.length; j += 1) dp[0][j] = j;
    for (let i = 1; i <= left.length; i += 1) {
        for (let j = 1; j <= right.length; j += 1) {
            const cost = left[i - 1] === right[j - 1] ? 0 : 1;
            dp[i][j] = Math.min(
                dp[i - 1][j] + 1,
                dp[i][j - 1] + 1,
                dp[i - 1][j - 1] + cost
            );
        }
    }
    return dp[left.length][right.length];
}

function similarityRatio(a, b) {
    const left = compactText(a);
    const right = compactText(b);
    if (!left || !right) return 0;
    const dist = levenshtein(left, right);
    return 1 - (dist / Math.max(left.length, right.length));
}

function buildRosterKeys(row) {
    return [
        { source: 'primary_name', raw: row.primary_name },
        { source: 'raw_name', raw: row.raw_name },
        { source: 'raw_handle', raw: row.raw_handle },
        { source: 'raw_keeper_name', raw: row.raw_keeper_name },
        { source: 'keeper_username', raw: row.keeper_username },
        { source: 'creator_name_jb', raw: row.creator_name_jb },
    ].filter((item) => item.raw);
}

function buildCandidateKeys(row) {
    const keys = [
        { source: 'primary_name', raw: row.primary_name },
        { source: 'keeper_username', raw: row.keeper_username },
        { source: 'creator_name_jb', raw: row.creator_name_jb },
    ];
    for (const alias of parseAliasBlob(row.aliases)) {
        keys.push({ source: alias.aliasType, raw: alias.aliasValue });
    }
    return keys.filter((item) => item.raw);
}

function scoreCandidate(roster, candidate) {
    const rosterKeys = buildRosterKeys(roster);
    const candidateKeys = buildCandidateKeys(candidate);
    let score = 0;
    const reasons = [];

    for (const left of rosterKeys) {
        const leftCompact = compactText(left.raw);
        const leftTokens = tokenize(left.raw);
        for (const right of candidateKeys) {
            const rightCompact = compactText(right.raw);
            const rightTokens = tokenize(right.raw);

            if (leftCompact && rightCompact && leftCompact === rightCompact) {
                score = Math.max(score, 1000);
                reasons.push(`exact:${left.source}->${right.source}`);
                continue;
            }

            if (leftCompact && rightCompact && Math.min(leftCompact.length, rightCompact.length) >= 5) {
                if (leftCompact.includes(rightCompact) || rightCompact.includes(leftCompact)) {
                    score = Math.max(score, 780);
                    reasons.push(`contains:${left.source}->${right.source}`);
                    continue;
                }
            }

            const overlap = tokenOverlap(leftTokens, rightTokens);
            if (overlap >= 0.75) {
                score = Math.max(score, 620);
                reasons.push(`tokens:${left.source}->${right.source}`);
                continue;
            }

            const ratio = similarityRatio(left.raw, right.raw);
            if (ratio >= 0.86) {
                score = Math.max(score, 560);
                reasons.push(`edit_similarity:${left.source}->${right.source}:${ratio.toFixed(2)}`);
            }
        }
    }

    if (candidate.wa_owner === roster.operator) {
        score += 60;
        reasons.push('same_operator');
    }

    if (Number(candidate.msg_count || 0) > 0) {
        score += Math.min(Number(candidate.msg_count || 0), 120);
        reasons.push(`msg_count:${candidate.msg_count}`);
    }

    return { score, reasons: Array.from(new Set(reasons)).join('|') };
}

async function main() {
    const db2 = db.getDb();
    const runStamp = new Date().toISOString().replace(/[:.]/g, '-');
    const reportDir = path.join(REPORT_ROOT, `unmapped-roster-aggressive-review-${runStamp}`);
    ensureDir(reportDir);

    const rosterRows = await db2.prepare(`
        SELECT
            c.id AS creator_id,
            c.primary_name,
            c.wa_owner,
            c.wa_phone,
            c.keeper_username,
            r.operator,
            r.session_id,
            r.raw_name,
            r.raw_handle,
            r.raw_keeper_name,
            j.creator_name_jb,
            (SELECT COUNT(*) FROM wa_messages wm WHERE wm.creator_id = c.id) AS msg_count
        FROM operator_creator_roster r
        JOIN creators c ON c.id = r.creator_id
        LEFT JOIN joinbrands_link j ON j.creator_id = c.id
        WHERE r.is_primary = 1
          AND (c.wa_phone IS NULL OR c.wa_phone = '')
        ORDER BY r.operator, c.id
    `).all();

    const candidates = await db2.prepare(`
        SELECT
            c.id,
            c.primary_name,
            c.wa_phone,
            c.wa_owner,
            c.keeper_username,
            j.creator_name_jb,
            GROUP_CONCAT(DISTINCT CONCAT(a.alias_type, ':', a.alias_value) ORDER BY a.alias_type, a.alias_value SEPARATOR ' | ') AS aliases,
            (SELECT COUNT(*) FROM wa_messages wm WHERE wm.creator_id = c.id) AS msg_count,
            EXISTS(SELECT 1 FROM operator_creator_roster r WHERE r.creator_id = c.id AND r.is_primary = 1) AS in_roster
        FROM creators c
        LEFT JOIN joinbrands_link j ON j.creator_id = c.id
        LEFT JOIN creator_aliases a ON a.creator_id = c.id
        WHERE c.is_active = 1
          AND c.wa_phone IS NOT NULL
          AND c.wa_phone <> ''
        GROUP BY c.id, c.primary_name, c.wa_phone, c.wa_owner, c.keeper_username, j.creator_name_jb
        ORDER BY c.id
    `).all();

    const rows = rosterRows.map((roster) => {
        const scored = candidates
            .filter((candidate) => Number(candidate.id) !== Number(roster.creator_id))
            .map((candidate) => {
                const scoredCandidate = scoreCandidate(roster, candidate);
                return { ...candidate, ...scoredCandidate };
            })
            .filter((candidate) => candidate.score >= 560)
            .sort((a, b) =>
                b.score - a.score
                || Number(b.msg_count || 0) - Number(a.msg_count || 0)
                || Number(Boolean(b.in_roster)) - Number(Boolean(a.in_roster))
                || a.id - b.id)
            .slice(0, 5);

        const row = {
            operator: roster.operator,
            session_id: roster.session_id,
            creator_id: roster.creator_id,
            primary_name: roster.primary_name || '',
            raw_name: roster.raw_name || '',
            raw_handle: roster.raw_handle || '',
            raw_keeper_name: roster.raw_keeper_name || '',
            keeper_username: roster.keeper_username || '',
            creator_name_jb: roster.creator_name_jb || '',
            message_count: roster.msg_count || 0,
        };

        for (let i = 0; i < 5; i += 1) {
            const candidate = scored[i];
            const n = i + 1;
            row[`candidate_${n}_id`] = candidate?.id || '';
            row[`candidate_${n}_name`] = candidate?.primary_name || '';
            row[`candidate_${n}_phone`] = candidate?.wa_phone || '';
            row[`candidate_${n}_score`] = candidate?.score || '';
            row[`candidate_${n}_reasons`] = candidate?.reasons || '';
            row[`candidate_${n}_in_roster`] = candidate?.in_roster ? 'yes' : '';
            row[`candidate_${n}_owner`] = candidate?.wa_owner || '';
        }
        return row;
    });

    const headers = rows.length > 0 ? Object.keys(rows[0]) : ['empty'];
    const csvPath = path.join(reportDir, 'unmapped-roster-aggressive-review.csv');
    const summaryPath = path.join(reportDir, 'summary.json');
    fs.writeFileSync(csvPath, toCsv(rows.length ? rows : [{ empty: '' }], headers));
    fs.writeFileSync(summaryPath, JSON.stringify({
        total_unmapped_roster: rows.length,
        by_operator: rows.reduce((acc, row) => {
            acc[row.operator] = (acc[row.operator] || 0) + 1;
            return acc;
        }, {}),
        csv: csvPath,
    }, null, 2));

    console.log(JSON.stringify({
        ok: true,
        total_unmapped_roster: rows.length,
        by_operator: rows.reduce((acc, row) => {
            acc[row.operator] = (acc[row.operator] || 0) + 1;
            return acc;
        }, {}),
        csv: csvPath,
        summary_json: summaryPath,
        sample: rows.slice(0, 10),
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
