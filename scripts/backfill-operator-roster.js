#!/usr/bin/env node
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const dbmod = require('../db');
const { normalizeOperatorName } = require('../server/utils/operator');
const { getSessionIdForOperator } = require('../server/services/operatorRosterService');

const CSV_FILES = [
    { file: '/Users/depp/Downloads/达人信息核对_Jiawen_表格.csv', defaultOwner: 'Jiawen' },
    { file: '/Users/depp/Downloads/达人信息核对_Alice_表格.csv', defaultOwner: 'Yiyun' },
    { file: '/Users/depp/Downloads/达人信息核对_Beau_表格.csv', defaultOwner: 'Beau' },
];

const CREATE_ROSTER_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS operator_creator_roster (
    id                  INT AUTO_INCREMENT PRIMARY KEY,
    creator_id          INT NOT NULL,
    operator            VARCHAR(32) NOT NULL,
    session_id          VARCHAR(64) NOT NULL,
    source_file         VARCHAR(128) DEFAULT NULL,
    raw_poc             VARCHAR(64) DEFAULT NULL,
    raw_name            VARCHAR(255) DEFAULT NULL,
    raw_handle          VARCHAR(255) DEFAULT NULL,
    raw_keeper_name     VARCHAR(255) DEFAULT NULL,
    marketing_channel   VARCHAR(128) DEFAULT NULL,
    match_strategy      VARCHAR(64) DEFAULT NULL,
    score               INT DEFAULT 0,
    is_primary          TINYINT(1) DEFAULT 1,
    created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at          DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_ocr_creator (creator_id),
    UNIQUE KEY uk_ocr_operator_raw (operator, raw_name(96), raw_handle(96), raw_keeper_name(96)),
    KEY idx_ocr_operator (operator),
    KEY idx_ocr_session (session_id),
    CONSTRAINT fk_ocr_creator FOREIGN KEY (creator_id) REFERENCES creators(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
`;

function splitCsvLine(line) {
    const values = [];
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
            values.push(current);
            current = '';
            continue;
        }
        current += ch;
    }
    values.push(current);
    return values;
}

function parseCsv(file, defaultOwner) {
    const raw = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
    const lines = raw.split(/\r?\n/).filter(Boolean);
    const header = splitCsvLine(lines.shift() || '');
    return lines.map((line) => {
        const values = splitCsvLine(line);
        const row = {};
        header.forEach((key, index) => {
            row[key] = String(values[index] || '').trim();
        });
        row._source_file = path.basename(file);
        row._mapped_owner = normalizePoc(row.poc || defaultOwner);
        return row;
    });
}

function normalizePoc(value) {
    const raw = normalizeText(value);
    if (!raw) return null;
    if (raw ***REMOVED***= 'alice' || raw ***REMOVED***= 'yiyun') return 'Yiyun';
    if (raw ***REMOVED***= 'sybil' || raw ***REMOVED***= 'jiawen') return 'Jiawen';
    if (raw ***REMOVED***= 'beau') return 'Beau';
    return normalizeOperatorName(value, value);
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

function buildKeyVariants(value) {
    const normalized = normalizeText(value);
    const compact = compactText(value);
    return [normalized, compact].filter(Boolean);
}

function buildMappingRows() {
    return CSV_FILES.flatMap(({ file, defaultOwner }) => parseCsv(file, defaultOwner));
}

function loadCreatorsWithContext() {
    return dbmod.getDb().prepare(`
        SELECT
            c.id,
            c.primary_name,
            c.wa_phone,
            c.keeper_username,
            c.wa_owner,
            c.source,
            k.keeper_username AS keeper_link_username,
            j.creator_name_jb,
            COUNT(DISTINCT wm.id) AS msg_count,
            GROUP_CONCAT(DISTINCT a.alias_value ORDER BY a.alias_value SEPARATOR ' | ') AS aliases
        FROM creators c
        LEFT JOIN keeper_link k ON k.creator_id = c.id
        LEFT JOIN joinbrands_link j ON j.creator_id = c.id
        LEFT JOIN wa_messages wm ON wm.creator_id = c.id
        LEFT JOIN creator_aliases a ON a.creator_id = c.id
        GROUP BY
            c.id, c.primary_name, c.wa_phone, c.keeper_username, c.wa_owner, c.source,
            k.keeper_username, j.creator_name_jb
    `).all();
}

function buildCreatorKeys(creator) {
    const rawValues = [
        creator.primary_name,
        creator.keeper_username,
        creator.keeper_link_username,
        creator.creator_name_jb,
        ...(String(creator.aliases || '').split(' | ').filter(Boolean)),
    ];

    const normalized = new Set();
    const compact = new Set();
    for (const value of rawValues) {
        const n = normalizeText(value);
        const c = compactText(value);
        if (n) normalized.add(n);
        if (c) compact.add(c);
    }

    return { normalized, compact };
}

function scoreCandidate(creator, row) {
    const keys = buildCreatorKeys(creator);
    const reasons = [];
    let score = 0;

    const addScoreForMatch = (label, variants, amount) => {
        if (variants.some((value) => keys.normalized.has(value) || keys.compact.has(value))) {
            score += amount;
            reasons.push(label);
            return true;
        }
        return false;
    };

    addScoreForMatch('handle', buildKeyVariants(row.Handle || row.Name), 400);
    addScoreForMatch('keeper', buildKeyVariants(row['Keeper Name']), 350);
    addScoreForMatch('real', buildKeyVariants(row['真名']), 300);

    if (creator.wa_phone) {
        score += 3000;
        reasons.push('has_phone');
    }
    if (creator.keeper_link_username) {
        score += 120;
        reasons.push('has_keeper_link');
    }
    if (creator.creator_name_jb) {
        score += 120;
        reasons.push('has_joinbrands_link');
    }
    if (creator.aliases) {
        score += 80;
        reasons.push('has_aliases');
    }
    if (creator.source ***REMOVED***= 'wa_crm') {
        score += 1600;
        reasons.push('source_wa_crm');
    } else if (creator.source ***REMOVED***= 'joinbrands') {
        score += 1400;
        reasons.push('source_joinbrands');
    } else if (creator.source ***REMOVED***= 'keeper') {
        score += 800;
        reasons.push('source_keeper');
    }

    const channel = normalizeText(row['营销渠道']);
    if (channel.includes('joinbrands') && creator.source ***REMOVED***= 'joinbrands') {
        score += 600;
        reasons.push('channel_joinbrands');
    }
    if ((channel.includes('billo') || channel.includes('$')) && creator.source ***REMOVED***= 'wa_crm') {
        score += 400;
        reasons.push('channel_wa_crm');
    }

    const msgCount = Number(creator.msg_count || 0);
    if (msgCount > 0) {
        score += Math.min(msgCount, 500);
        reasons.push(`msg_${msgCount}`);
    }

    return { score, reasons };
}

function findCandidates(creators, row) {
    const handleKeys = buildKeyVariants(row.Handle || row.Name);
    const keeperKeys = buildKeyVariants(row['Keeper Name']);
    const realKeys = buildKeyVariants(row['真名']);

    return creators
        .map((creator) => {
            const keys = buildCreatorKeys(creator);
            const matchedBy = [];
            if (handleKeys.some((value) => keys.normalized.has(value) || keys.compact.has(value))) matchedBy.push('handle');
            if (keeperKeys.some((value) => keys.normalized.has(value) || keys.compact.has(value))) matchedBy.push('keeper');
            if (realKeys.some((value) => keys.normalized.has(value) || keys.compact.has(value))) matchedBy.push('real');
            if (matchedBy.length ***REMOVED***= 0) return null;
            const scored = scoreCandidate(creator, row);
            return {
                ...creator,
                matchedBy,
                score: scored.score,
                scoreReasons: scored.reasons,
            };
        })
        .filter(Boolean)
        .sort((a, b) =>
            b.score - a.score
            || Number(b.msg_count || 0) - Number(a.msg_count || 0)
            || Number(Boolean(b.wa_phone)) - Number(Boolean(a.wa_phone))
            || Number(Boolean(b.keeper_link_username)) - Number(Boolean(a.keeper_link_username))
            || Number(Boolean(b.creator_name_jb)) - Number(Boolean(a.creator_name_jb))
            || Number(Boolean(b.aliases)) - Number(Boolean(a.aliases))
            || new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime()
            || a.id - b.id
        );
}

function chooseCanonical(candidates, usedCreatorIds, row) {
    if (!candidates.length) {
        throw new Error(`No creator matched CSV row: ${JSON.stringify(row)}`);
    }
    const available = candidates.find((item) => !usedCreatorIds.has(item.id));
    if (!available) {
        throw new Error(`No unused canonical creator left for CSV row: ${JSON.stringify(row)}`);
    }
    return available;
}

async function ensureRosterTable() {
    await dbmod.getDb().prepare(CREATE_ROSTER_TABLE_SQL).run();
}

async function main() {
    const rows = buildMappingRows();
    const creators = await loadCreatorsWithContext();

    const pending = rows.map((row) => {
        const candidates = findCandidates(creators, row);
        return {
            row,
            candidates,
            operator: row._mapped_owner,
            session_id: getSessionIdForOperator(row._mapped_owner),
        };
    });

    pending.sort((a, b) => {
        const aGap = (a.candidates[0]?.score || 0) - (a.candidates[1]?.score || 0);
        const bGap = (b.candidates[0]?.score || 0) - (b.candidates[1]?.score || 0);
        return a.candidates.length - b.candidates.length
            || bGap - aGap
            || (b.candidates[0]?.score || 0) - (a.candidates[0]?.score || 0);
    });

    const usedCreatorIds = new Set();
    const resolved = pending.map((item) => {
        const canonical = chooseCanonical(item.candidates, usedCreatorIds, item.row);
        usedCreatorIds.add(canonical.id);
        return {
            ...item,
            canonical,
        };
    });

    const canonicalIds = new Set(resolved.map((item) => item.canonical.id));
    if (canonicalIds.size !***REMOVED*** rows.length) {
        const repeated = resolved.reduce((acc, item) => {
            acc[item.canonical.id] = (acc[item.canonical.id] || 0) + 1;
            return acc;
        }, {});
        const dupes = Object.entries(repeated).filter(([, count]) => count > 1);
        throw new Error(`Canonical creator ids are not unique: ${JSON.stringify(dupes)}`);
    }

    await ensureRosterTable();

    await dbmod.getDb().transaction(async (tx) => {
        await tx.prepare('DELETE FROM operator_creator_roster').run();

        const rosterInsert = tx.prepare(`
            INSERT INTO operator_creator_roster (
                creator_id, operator, session_id, source_file, raw_poc, raw_name, raw_handle,
                raw_keeper_name, marketing_channel, match_strategy, score, is_primary
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
        `);
        const updateCreatorOwner = tx.prepare('UPDATE creators SET wa_owner = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?');
        const activateCanonical = tx.prepare('UPDATE creators SET is_active = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?');
        const updateMessageOwner = tx.prepare('UPDATE wa_messages SET operator = ? WHERE creator_id = ?');
        const upsertAlias = tx.prepare(`
            INSERT IGNORE INTO creator_aliases (creator_id, alias_type, alias_value, is_verified)
            VALUES (?, ?, ?, 1)
        `);

        for (const item of resolved) {
            const matchStrategy = `${item.canonical.matchedBy.join('+')}|${item.canonical.scoreReasons.join('+')}`.slice(0, 64);

            await rosterInsert.run(
                item.canonical.id,
                item.operator,
                item.session_id,
                item.row._source_file,
                item.row.poc || '',
                item.row['真名'] || '',
                item.row.Handle || item.row.Name || '',
                item.row['Keeper Name'] || '',
                item.row['营销渠道'] || '',
                matchStrategy,
                item.canonical.score
            );
            await activateCanonical.run(item.canonical.id);

            for (const candidate of item.candidates) {
                await updateCreatorOwner.run(item.operator, candidate.id);
                await updateMessageOwner.run(item.operator, candidate.id);
            }

            const aliasPairs = [
                ['csv_real_name', item.row['真名']],
                ['csv_handle', item.row.Handle || item.row.Name],
                ['csv_keeper_name', item.row['Keeper Name']],
            ].filter(([, value]) => String(value || '').trim());

            for (const [type, value] of aliasPairs) {
                await upsertAlias.run(item.canonical.id, type, String(value).trim());
            }
        }
    });

    const counts = resolved.reduce((acc, item) => {
        acc[item.operator] = (acc[item.operator] || 0) + 1;
        return acc;
    }, {});

    const summary = await dbmod.getDb().prepare(`
        SELECT operator, COUNT(*) AS creator_count
        FROM operator_creator_roster
        WHERE is_primary = 1
        GROUP BY operator
        ORDER BY operator
    `).all();

    console.log(JSON.stringify({
        total_csv_rows: rows.length,
        canonical_creator_count: canonicalIds.size,
        by_operator: counts,
        roster_summary: summary,
    }, null, 2));
}

main()
    .catch((err) => {
        console.error('[backfill-operator-roster] failed:', err);
        process.exitCode = 1;
    })
    .finally(async () => {
        await dbmod.closeDb().catch(() => {});
    });
