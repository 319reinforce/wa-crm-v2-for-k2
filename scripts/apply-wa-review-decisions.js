#!/usr/bin/env node
require('dotenv').config();

const fs = require('fs');
const path = require('path');

const db = require('../db');
const { getSessionIdForOperator } = require('../server/services/operatorRosterService');
const { normalizeOperatorName } = require('../server/utils/operator');
const { hardDeleteCreator } = require('./lib/hardDeleteCreator');

const INPUT = process.argv[2] || '/Users/depp/Downloads/WA未对应消息审核表_消息审核_表格.csv';
const REPORT_ROOT = process.argv.includes('--out-dir')
    ? process.argv[process.argv.indexOf('--out-dir') + 1]
    : path.join(process.cwd(), 'reports');

const STATUS_KEEP = '录入';
const STATUS_DROP = '不录入';
const STATUS_DUPLICATE = '和上一轮可能重复';

function splitCsvLine(line) {
    const values = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i += 1) {
        const ch = line[i];
        if (ch === '"') {
            if (inQuotes && line[i + 1] === '"') {
                current += '"';
                i += 1;
            } else {
                inQuotes = !inQuotes;
            }
            continue;
        }
        if (ch === ',' && !inQuotes) {
            values.push(current);
            current = '';
            continue;
        }
        current += ch;
    }
    values.push(current);
    return values;
}

function parseCsv(file) {
    const raw = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
    const lines = raw.split(/\r?\n/).filter(Boolean);
    const header = splitCsvLine(lines.shift() || '');
    return lines.map((line) => {
        const values = splitCsvLine(line);
        const row = {};
        header.forEach((key, index) => {
            row[key] = String(values[index] || '').trim();
        });
        return row;
    });
}

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

function normalizePhone(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    if (/^[0-9]+$/.test(raw)) return raw;
    if (/^[0-9.]+E\+[0-9]+$/i.test(raw)) {
        const num = Number(raw);
        if (Number.isFinite(num)) return num.toFixed(0);
    }
    return raw.replace(/\D/g, '');
}

function normalizeStatus(value) {
    return String(value || '').trim();
}

function normalizeReviewRow(row) {
    return {
        status: normalizeStatus(row['审核状态 / Review Status']),
        creatorId: Number(row['达人ID / Creator ID'] || 0),
        name: String(row['达人昵称 / Primary Name'] || '').trim(),
        phone: normalizePhone(row['WhatsApp号 / WA Phone']),
        owner: normalizeOperatorName(row['负责客服 / WA Owner'], row['负责客服 / WA Owner'] || null),
        reviewBucket: String(row['审核批次 / Review Bucket'] || '').trim(),
        reviewScore: Number(row['审核评分 / Review Score'] || 0),
        reviewReasons: String(row['审核原因 / Review Reasons'] || '').trim(),
        source: String(row['来源 / Source'] || '').trim(),
        recentSnippets: String(row['最近消息摘要 / Recent Message Snippets'] || '').trim(),
        raw: row,
    };
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

async function getCreatorById(id) {
    if (!id) return null;
    return await db.getDb().prepare(`
        SELECT
            c.*,
            EXISTS(SELECT 1 FROM operator_creator_roster r WHERE r.creator_id = c.id AND r.is_primary = 1) AS in_roster,
            (SELECT COUNT(*) FROM wa_messages wm WHERE wm.creator_id = c.id) AS msg_count
        FROM creators c
        WHERE c.id = ?
        LIMIT 1
    `).get(id);
}

async function upsertRosterAssignment(row, creator) {
    const owner = normalizeOperatorName(row.owner, creator?.wa_owner || row.owner || null);
    const sessionId = getSessionIdForOperator(owner);
    const sourceFile = path.basename(INPUT);
    const rawName = row.name || creator.primary_name || '';
    const rawHandle = row.phone || creator.wa_phone || `manual-${creator.id}`;
    await db.getDb().prepare(`
        INSERT INTO operator_creator_roster
            (creator_id, operator, session_id, source_file, raw_poc, raw_name, raw_handle, raw_keeper_name,
             marketing_channel, match_strategy, score, is_primary)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
        ON DUPLICATE KEY UPDATE
            operator = VALUES(operator),
            session_id = VALUES(session_id),
            source_file = VALUES(source_file),
            raw_poc = VALUES(raw_poc),
            raw_name = VALUES(raw_name),
            match_strategy = VALUES(match_strategy),
            score = VALUES(score),
            is_primary = 1,
            updated_at = NOW()
    `).run(
        creator.id,
        owner,
        sessionId,
        sourceFile,
        owner,
        rawName,
        rawHandle,
        '',
        'manual_review',
        'manual_review_import',
        Number(row.reviewScore || 0)
    );

    const updates = [];
    const values = [];
    if (owner) {
        updates.push('wa_owner = ?');
        values.push(owner);
    }
    if (!creator.wa_phone && row.phone) {
        updates.push('wa_phone = ?');
        values.push(row.phone);
    }
    if (row.name && (!creator.primary_name || /^unknown$/i.test(creator.primary_name))) {
        updates.push('primary_name = ?');
        values.push(row.name);
    }
    updates.push('is_active = 1');
    values.push(creator.id);
    await db.getDb().prepare(`UPDATE creators SET ${updates.join(', ')}, updated_at = NOW() WHERE id = ?`).run(...values);

    if (row.phone) {
        await db.getDb().prepare(
            'INSERT IGNORE INTO creator_aliases (creator_id, alias_type, alias_value, is_verified) VALUES (?, ?, ?, ?)'
        ).run(creator.id, 'wa_phone', row.phone, 1);
    }
    if (row.name) {
        await db.getDb().prepare(
            'INSERT IGNORE INTO creator_aliases (creator_id, alias_type, alias_value, is_verified) VALUES (?, ?, ?, ?)'
        ).run(creator.id, 'wa_name', row.name, 1);
    }

    return { owner, sessionId };
}

async function snapshotCreator(creatorId) {
    const db2 = db.getDb();
    const creator = await db2.prepare('SELECT * FROM creators WHERE id = ? LIMIT 1').get(creatorId);
    if (!creator) return null;
    const [msgCountRow, rosterRow] = await Promise.all([
        db2.prepare('SELECT COUNT(*) AS c FROM wa_messages WHERE creator_id = ?').get(creatorId),
        db2.prepare('SELECT operator, session_id, source_file FROM operator_creator_roster WHERE creator_id = ? LIMIT 1').get(creatorId),
    ]);
    return {
        ...creator,
        msg_count: Number(msgCountRow?.c || 0),
        roster_operator: rosterRow?.operator || '',
        roster_session_id: rosterRow?.session_id || '',
        roster_source_file: rosterRow?.source_file || '',
    };
}

async function findSafeDuplicateTarget(row) {
    const creator = await getCreatorById(row.creatorId);
    if (!creator) return null;

    const nameCompact = compactText(row.name || creator.primary_name);
    const nameTokens = tokenize(row.name || creator.primary_name);
    const candidates = await db.getDb().prepare(`
        SELECT
            c.id,
            c.primary_name,
            c.wa_phone,
            c.wa_owner,
            r.operator,
            r.session_id,
            r.raw_name,
            r.raw_handle,
            r.raw_keeper_name,
            (SELECT COUNT(*) FROM wa_messages wm WHERE wm.creator_id = c.id) AS msg_count
        FROM creators c
        JOIN operator_creator_roster r ON r.creator_id = c.id AND r.is_primary = 1
        WHERE r.operator = ?
        ORDER BY msg_count DESC, c.id ASC
    `).all(row.owner);

    const scored = candidates.map((candidate) => {
        const strings = [
            candidate.primary_name,
            candidate.raw_name,
            candidate.raw_handle,
            candidate.raw_keeper_name,
        ].filter(Boolean);
        let score = 0;
        let reason = '';
        for (const value of strings) {
            const compact = compactText(value);
            if (nameCompact && compact && nameCompact === compact) {
                score = Math.max(score, 1000);
                reason = 'exact_compact_name';
            } else if (nameCompact && compact && nameCompact.length >= 5 && (nameCompact.includes(compact) || compact.includes(nameCompact))) {
                score = Math.max(score, 700);
                reason = 'contains_compact_name';
            } else {
                const overlap = tokenOverlap(nameTokens, tokenize(value));
                if (overlap >= 0.8) {
                    score = Math.max(score, 500);
                    reason = 'token_overlap';
                }
            }
        }
        return { ...candidate, score, reason };
    }).filter((candidate) => candidate.score >= 700);

    if (scored.length !== 1) return null;
    return scored[0];
}

async function main() {
    const rows = parseCsv(INPUT).map(normalizeReviewRow);
    const runStamp = new Date().toISOString().replace(/[:.]/g, '-');
    const reportDir = path.join(REPORT_ROOT, `review-apply-${runStamp}`);
    ensureDir(reportDir);

    const report = {
        input: INPUT,
        total_rows: rows.length,
        status_counts: {},
        kept: [],
        deleted: [],
        duplicate_merged: [],
        duplicate_unresolved: [],
        missing_creator_rows: [],
    };

    for (const row of rows) {
        report.status_counts[row.status] = (report.status_counts[row.status] || 0) + 1;
        const creator = await getCreatorById(row.creatorId);
        if (!creator) {
            report.missing_creator_rows.push({
                creator_id: row.creatorId,
                status: row.status,
                primary_name: row.name,
                wa_phone: row.phone,
                wa_owner: row.owner,
            });
            continue;
        }

        if (row.status === STATUS_KEEP) {
            const assignment = await upsertRosterAssignment(row, creator);
            report.kept.push({
                creator_id: creator.id,
                primary_name: creator.primary_name,
                wa_phone: creator.wa_phone || row.phone || '',
                wa_owner: assignment.owner || creator.wa_owner || '',
                session_id: assignment.sessionId || '',
                msg_count: creator.msg_count,
            });
            continue;
        }

        if (row.status === STATUS_DROP) {
            const snapshot = await snapshotCreator(creator.id);
            await hardDeleteCreator(creator.id);
            report.deleted.push({
                creator_id: creator.id,
                primary_name: creator.primary_name,
                wa_phone: creator.wa_phone || row.phone || '',
                wa_owner: creator.wa_owner || row.owner || '',
                msg_count: snapshot?.msg_count || creator.msg_count || 0,
                source: creator.source || row.source || '',
                review_reasons: row.reviewReasons,
            });
            continue;
        }

        if (row.status === STATUS_DUPLICATE) {
            const target = await findSafeDuplicateTarget(row);
            if (target) {
                report.duplicate_merged.push({
                    source_creator_id: creator.id,
                    source_name: creator.primary_name,
                    source_phone: creator.wa_phone || row.phone || '',
                    target_creator_id: target.id,
                    target_name: target.primary_name,
                    target_phone: target.wa_phone || '',
                    reason: target.reason,
                    score: target.score,
                });
            } else {
                report.duplicate_unresolved.push({
                    creator_id: creator.id,
                    primary_name: creator.primary_name,
                    wa_phone: creator.wa_phone || row.phone || '',
                    wa_owner: creator.wa_owner || row.owner || '',
                    msg_count: creator.msg_count,
                    review_reasons: row.reviewReasons,
                });
            }
        }
    }

    const writeSection = (name, rowsToWrite) => {
        const file = path.join(reportDir, name);
        const headers = rowsToWrite.length > 0 ? Object.keys(rowsToWrite[0]) : ['empty'];
        fs.writeFileSync(file, toCsv(rowsToWrite.length ? rowsToWrite : [{ empty: '' }], headers));
        return file;
    };

    const files = {
        kept_csv: writeSection('kept.csv', report.kept),
        deleted_csv: writeSection('deleted.csv', report.deleted),
        duplicate_merged_csv: writeSection('duplicate-merged.csv', report.duplicate_merged),
        duplicate_unresolved_csv: writeSection('duplicate-unresolved.csv', report.duplicate_unresolved),
        missing_creator_csv: writeSection('missing-creators.csv', report.missing_creator_rows),
    };

    const summary = { ...report, files };
    const summaryPath = path.join(reportDir, 'summary.json');
    fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));

    console.log(JSON.stringify({
        ok: true,
        ...summary,
        summary_json: summaryPath,
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
