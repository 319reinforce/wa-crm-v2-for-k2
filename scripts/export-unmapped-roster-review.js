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

function tokenOverlap(a = [], b = []) {
    if (!a.length || !b.length) return 0;
    const setB = new Set(b);
    let overlap = 0;
    for (const token of a) {
        if (setB.has(token)) overlap += 1;
    }
    return overlap / Math.max(a.length, b.length);
}

function scoreCandidate(roster, candidate) {
    const rosterStrings = [
        roster.primary_name,
        roster.raw_name,
        roster.raw_handle,
        roster.raw_keeper_name,
        roster.keeper_username,
        roster.creator_name_jb,
    ].filter(Boolean);
    const candidateStrings = [
        candidate.primary_name,
        candidate.keeper_username,
        candidate.creator_name_jb,
    ].filter(Boolean);

    let score = 0;
    for (const left of rosterStrings) {
        const leftCompact = compactText(left);
        const leftTokens = tokenize(left);
        for (const right of candidateStrings) {
            const rightCompact = compactText(right);
            const rightTokens = tokenize(right);
            if (leftCompact && rightCompact && leftCompact === rightCompact) {
                score = Math.max(score, 1000);
                continue;
            }
            if (leftCompact && rightCompact && leftCompact.length >= 5 && (leftCompact.includes(rightCompact) || rightCompact.includes(leftCompact))) {
                score = Math.max(score, 700);
                continue;
            }
            const overlap = tokenOverlap(leftTokens, rightTokens);
            if (overlap >= 0.8) {
                score = Math.max(score, 500);
            }
        }
    }
    score += Math.min(Number(candidate.msg_count || 0), 120);
    return score;
}

async function main() {
    const db2 = db.getDb();
    const runStamp = new Date().toISOString().replace(/[:.]/g, '-');
    const reportDir = path.join(REPORT_ROOT, `unmapped-roster-review-${runStamp}`);
    ensureDir(reportDir);

    const rosterRows = await db2.prepare(`
        SELECT
            c.id AS creator_id,
            c.primary_name,
            c.wa_owner,
            c.wa_phone,
            r.operator,
            r.session_id,
            r.raw_name,
            r.raw_handle,
            r.raw_keeper_name,
            c.keeper_username,
            j.creator_name_jb,
            (SELECT COUNT(*) FROM wa_messages wm WHERE wm.creator_id = c.id) AS msg_count
        FROM operator_creator_roster r
        JOIN creators c ON c.id = r.creator_id
        LEFT JOIN joinbrands_link j ON j.creator_id = c.id
        WHERE r.is_primary = 1
          AND (c.wa_phone IS NULL OR c.wa_phone = '')
        ORDER BY r.operator, c.id
    `).all();

    const nonRosterCandidates = await db2.prepare(`
        SELECT
            c.id,
            c.primary_name,
            c.wa_phone,
            c.wa_owner,
            c.keeper_username,
            j.creator_name_jb,
            (SELECT COUNT(*) FROM wa_messages wm WHERE wm.creator_id = c.id) AS msg_count
        FROM creators c
        LEFT JOIN operator_creator_roster r ON r.creator_id = c.id AND r.is_primary = 1
        LEFT JOIN joinbrands_link j ON j.creator_id = c.id
        WHERE c.is_active = 1
          AND r.creator_id IS NULL
          AND c.wa_phone IS NOT NULL
          AND c.wa_phone <> ''
        ORDER BY c.wa_owner, c.id
    `).all();

    const rows = rosterRows.map((roster) => {
        const candidates = nonRosterCandidates
            .filter((candidate) => candidate.wa_owner === roster.operator)
            .map((candidate) => ({ ...candidate, score: scoreCandidate(roster, candidate) }))
            .filter((candidate) => candidate.score >= 500)
            .sort((a, b) => b.score - a.score || Number(b.msg_count || 0) - Number(a.msg_count || 0) || a.id - b.id)
            .slice(0, 3);

        return {
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
            candidate_1_id: candidates[0]?.id || '',
            candidate_1_name: candidates[0]?.primary_name || '',
            candidate_1_phone: candidates[0]?.wa_phone || '',
            candidate_1_score: candidates[0]?.score || '',
            candidate_2_id: candidates[1]?.id || '',
            candidate_2_name: candidates[1]?.primary_name || '',
            candidate_2_phone: candidates[1]?.wa_phone || '',
            candidate_2_score: candidates[1]?.score || '',
            candidate_3_id: candidates[2]?.id || '',
            candidate_3_name: candidates[2]?.primary_name || '',
            candidate_3_phone: candidates[2]?.wa_phone || '',
            candidate_3_score: candidates[2]?.score || '',
        };
    });

    const headers = rows.length > 0 ? Object.keys(rows[0]) : ['empty'];
    const csvPath = path.join(reportDir, 'unmapped-roster-review.csv');
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
