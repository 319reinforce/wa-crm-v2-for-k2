#!/usr/bin/env node
require('dotenv').config();

const fs = require('fs');
const path = require('path');

const db = require('../db');
const { mergeDuplicateCreatorIntoCanonical } = require('../server/services/creatorMergeService');
const { hardDeleteCreator } = require('./lib/hardDeleteCreator');

const INPUT = process.argv[2] || '/Users/depp/Downloads/CRM交叉核对表v2_数据表_表格.csv';
const SHARED_PHONE_SKIP_CREATOR_IDS = new Set([1902]);

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

function normalizePhone(value) {
    return String(value || '').replace(/\D/g, '');
}

async function getCreatorSnapshot(creatorId) {
    if (!creatorId) return null;
    return await db.getDb().prepare(`
        SELECT
            c.*,
            EXISTS(SELECT 1 FROM operator_creator_roster r WHERE r.creator_id = c.id AND r.is_primary = 1) AS in_roster,
            (SELECT COUNT(*) FROM wa_messages wm WHERE wm.creator_id = c.id) AS msg_count
        FROM creators c
        WHERE c.id = ?
        LIMIT 1
    `).get(creatorId);
}

async function getCreatorByPhone(phone) {
    if (!phone) return null;
    return await db.getDb().prepare(`
        SELECT
            c.*,
            EXISTS(SELECT 1 FROM operator_creator_roster r WHERE r.creator_id = c.id AND r.is_primary = 1) AS in_roster,
            (SELECT COUNT(*) FROM wa_messages wm WHERE wm.creator_id = c.id) AS msg_count
        FROM creators c
        WHERE c.wa_phone = ?
        LIMIT 1
    `).get(phone);
}

async function attachPhoneToCreator(creatorId, phone, owner) {
    await db.getDb().prepare(`
        UPDATE creators
        SET wa_phone = ?, wa_owner = COALESCE(?, wa_owner), updated_at = NOW()
        WHERE id = ?
    `).run(phone, owner || null, creatorId);

    await db.getDb().prepare(
        'INSERT IGNORE INTO creator_aliases (creator_id, alias_type, alias_value, is_verified) VALUES (?, ?, ?, ?)'
    ).run(creatorId, 'wa_phone', phone, 1);
}

async function main() {
    const rows = parseCsv(INPUT)
        .map((row) => ({
            phone: normalizePhone(row['手机号']),
            status: String(row['是否匹配'] || '').trim(),
            creatorId: Number(row['creator_id'] || 0),
            name: String(row['primary_name'] || '').trim(),
            operator: String(row['operator'] || '').trim(),
            candidateId: Number(row['candidate_1_id'] || 0),
        }))
        .filter((row) => row.creatorId);

    const report = {
        input: INPUT,
        total_rows: rows.length,
        deleted_blank_phone: [],
        attached_phone: [],
        merged_into_existing_phone_creator: [],
        merged_existing_phone_creator_into_current: [],
        skipped_shared_phone: [],
        missing_creator_rows: [],
    };

    for (const row of rows) {
        const creator = await getCreatorSnapshot(row.creatorId);
        if (!creator) {
            report.missing_creator_rows.push(row);
            continue;
        }

        if (!row.phone) {
            await hardDeleteCreator(row.creatorId);
            report.deleted_blank_phone.push({
                creator_id: row.creatorId,
                primary_name: row.name || creator.primary_name,
                operator: row.operator || creator.wa_owner,
            });
            continue;
        }

        if (SHARED_PHONE_SKIP_CREATOR_IDS.has(row.creatorId)) {
            report.skipped_shared_phone.push({
                creator_id: row.creatorId,
                primary_name: row.name || creator.primary_name,
                phone: row.phone,
                reason: 'shared_phone_special_case_skip_one',
            });
            continue;
        }

        const existingPhoneCreator = await getCreatorByPhone(row.phone);

        if (!existingPhoneCreator || Number(existingPhoneCreator.id) ***REMOVED***= Number(row.creatorId)) {
            await attachPhoneToCreator(row.creatorId, row.phone, row.operator || creator.wa_owner || null);
            report.attached_phone.push({
                creator_id: row.creatorId,
                primary_name: row.name || creator.primary_name,
                phone: row.phone,
            });
            continue;
        }

        const existingHasWeight = Number(existingPhoneCreator.msg_count || 0) > 0 || Number(existingPhoneCreator.in_roster || 0) ***REMOVED***= 1;
        const currentHasWeight = Number(creator.msg_count || 0) > 0 || Number(creator.in_roster || 0) ***REMOVED***= 1;

        if (existingHasWeight && (!currentHasWeight || Number(existingPhoneCreator.msg_count || 0) >= Number(creator.msg_count || 0))) {
            const merged = await mergeDuplicateCreatorIntoCanonical({
                targetCreatorId: existingPhoneCreator.id,
                sourceCreatorId: creator.id,
                operator: row.operator || creator.wa_owner || existingPhoneCreator.wa_owner || null,
                reason: 'final_crosscheck_v2_phone_to_existing',
            });
            report.merged_into_existing_phone_creator.push({
                source_creator_id: creator.id,
                target_creator_id: existingPhoneCreator.id,
                phone: row.phone,
                merged,
            });
        } else {
            const merged = await mergeDuplicateCreatorIntoCanonical({
                targetCreatorId: creator.id,
                sourceCreatorId: existingPhoneCreator.id,
                operator: row.operator || creator.wa_owner || existingPhoneCreator.wa_owner || null,
                reason: 'final_crosscheck_v2_existing_into_current',
            });
            await attachPhoneToCreator(creator.id, row.phone, row.operator || creator.wa_owner || null);
            report.merged_existing_phone_creator_into_current.push({
                source_creator_id: existingPhoneCreator.id,
                target_creator_id: creator.id,
                phone: row.phone,
                merged,
            });
        }
    }

    console.log(JSON.stringify({ ok: true, ...report }, null, 2));
}

main()
    .catch(async (error) => {
        console.error(JSON.stringify({ ok: false, error: error.message }, null, 2));
        process.exitCode = 1;
    })
    .finally(async () => {
        await db.closeDb();
    });
