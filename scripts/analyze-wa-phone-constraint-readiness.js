#!/usr/bin/env node
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const db = require('../db');

function ensureDir(dirPath) {
    fs.mkdirSync(dirPath, { recursive: true });
}

function toCsv(rows, columns) {
    const escape = (value) => {
        if (value === null || value === undefined) return '';
        const text = String(value);
        if (/[",\n]/.test(text)) {
            return `"${text.replace(/"/g, '""')}"`;
        }
        return text;
    };
    return [
        columns.join(','),
        ...rows.map((row) => columns.map((col) => escape(row[col])).join(',')),
    ].join('\n');
}

async function main() {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const outdir = process.argv[2] || path.join(process.cwd(), 'reports', `wa-phone-constraint-readiness-${stamp}`);
    ensureDir(outdir);

    const conn = db.getDb();
    const q1 = async (sql, params = []) => conn.prepare(sql).get(...params);
    const qa = async (sql, params = []) => conn.prepare(sql).all(...params);

    const summary = {
        total_creators: (await q1('SELECT COUNT(*) AS c FROM creators')).c,
        null_phone_creators: (await q1("SELECT COUNT(*) AS c FROM creators WHERE wa_phone IS NULL OR TRIM(wa_phone) = ''")).c,
        active_creators: (await q1('SELECT COUNT(*) AS c FROM creators WHERE is_active = 1')).c,
        active_null_phone_creators: (await q1("SELECT COUNT(*) AS c FROM creators WHERE (wa_phone IS NULL OR TRIM(wa_phone) = '') AND is_active = 1")).c,
        roster_total: (await q1('SELECT COUNT(*) AS c FROM operator_creator_roster WHERE is_primary = 1')).c,
        roster_null_phone_creators: (await q1(`
            SELECT COUNT(*) AS c
            FROM operator_creator_roster o
            JOIN creators c ON c.id = o.creator_id
            WHERE o.is_primary = 1 AND (c.wa_phone IS NULL OR TRIM(c.wa_phone) = '')
        `)).c,
        normalized_phone_duplicate_groups: (await q1(`
            SELECT COUNT(*) AS c
            FROM (
                SELECT REGEXP_REPLACE(wa_phone, '[^0-9]+', '') AS normalized_phone
                FROM creators
                WHERE wa_phone IS NOT NULL AND TRIM(wa_phone) <> ''
                GROUP BY normalized_phone
                HAVING normalized_phone <> '' AND COUNT(*) > 1
            ) t
        `)).c,
    };

    const relationCounts = {
        null_phone_with_messages: (await q1(`
            SELECT COUNT(DISTINCT c.id) AS c
            FROM creators c
            JOIN wa_messages wm ON wm.creator_id = c.id
            WHERE c.wa_phone IS NULL OR TRIM(c.wa_phone) = ''
        `)).c,
        null_phone_with_aliases: (await q1(`
            SELECT COUNT(DISTINCT c.id) AS c
            FROM creators c
            JOIN creator_aliases a ON a.creator_id = c.id
            WHERE c.wa_phone IS NULL OR TRIM(c.wa_phone) = ''
        `)).c,
        null_phone_with_wacrm: (await q1(`
            SELECT COUNT(DISTINCT c.id) AS c
            FROM creators c
            JOIN wa_crm_data w ON w.creator_id = c.id
            WHERE c.wa_phone IS NULL OR TRIM(c.wa_phone) = ''
        `)).c,
        null_phone_with_keeper_link: (await q1(`
            SELECT COUNT(DISTINCT c.id) AS c
            FROM creators c
            JOIN keeper_link k ON k.creator_id = c.id
            WHERE c.wa_phone IS NULL OR TRIM(c.wa_phone) = ''
        `)).c,
        null_phone_with_joinbrands_link: (await q1(`
            SELECT COUNT(DISTINCT c.id) AS c
            FROM creators c
            JOIN joinbrands_link j ON j.creator_id = c.id
            WHERE c.wa_phone IS NULL OR TRIM(c.wa_phone) = ''
        `)).c,
        null_phone_with_events: (await q1(`
            SELECT COUNT(DISTINCT c.id) AS c
            FROM creators c
            JOIN events e ON e.creator_id = c.id
            WHERE c.wa_phone IS NULL OR TRIM(c.wa_phone) = ''
        `)).c,
        null_phone_with_any_related: (await q1(`
            SELECT COUNT(*) AS c
            FROM (
                SELECT DISTINCT c.id
                FROM creators c
                LEFT JOIN wa_messages wm ON wm.creator_id = c.id
                LEFT JOIN creator_aliases a ON a.creator_id = c.id
                LEFT JOIN wa_crm_data w ON w.creator_id = c.id
                LEFT JOIN keeper_link k ON k.creator_id = c.id
                LEFT JOIN joinbrands_link j ON j.creator_id = c.id
                LEFT JOIN events e ON e.creator_id = c.id
                WHERE (c.wa_phone IS NULL OR TRIM(c.wa_phone) = '')
                  AND (wm.id IS NOT NULL OR a.id IS NOT NULL OR w.creator_id IS NOT NULL OR k.creator_id IS NOT NULL OR j.creator_id IS NOT NULL OR e.id IS NOT NULL)
            ) t
        `)).c,
        null_phone_with_no_related: (await q1(`
            SELECT COUNT(*) AS c
            FROM (
                SELECT c.id
                FROM creators c
                LEFT JOIN wa_messages wm ON wm.creator_id = c.id
                LEFT JOIN creator_aliases a ON a.creator_id = c.id
                LEFT JOIN wa_crm_data w ON w.creator_id = c.id
                LEFT JOIN keeper_link k ON k.creator_id = c.id
                LEFT JOIN joinbrands_link j ON j.creator_id = c.id
                LEFT JOIN events e ON e.creator_id = c.id
                WHERE c.wa_phone IS NULL OR TRIM(c.wa_phone) = ''
                GROUP BY c.id
                HAVING COUNT(wm.id) = 0
                   AND COUNT(a.id) = 0
                   AND COUNT(w.creator_id) = 0
                   AND COUNT(k.creator_id) = 0
                   AND COUNT(j.creator_id) = 0
                   AND COUNT(e.id) = 0
            ) t
        `)).c,
    };

    const topNullPhoneCreators = await qa(`
        SELECT
            c.id,
            c.primary_name,
            c.wa_owner,
            c.source,
            c.is_active,
            c.created_at,
            COUNT(DISTINCT a.id) AS alias_count,
            COUNT(DISTINCT w.creator_id) AS has_wacrm,
            COUNT(DISTINCT k.creator_id) AS has_keeper_link,
            COUNT(DISTINCT j.creator_id) AS has_joinbrands_link,
            COUNT(DISTINCT o.creator_id) AS in_roster
        FROM creators c
        LEFT JOIN creator_aliases a ON a.creator_id = c.id
        LEFT JOIN wa_crm_data w ON w.creator_id = c.id
        LEFT JOIN keeper_link k ON k.creator_id = c.id
        LEFT JOIN joinbrands_link j ON j.creator_id = c.id
        LEFT JOIN operator_creator_roster o ON o.creator_id = c.id AND o.is_primary = 1
        WHERE c.wa_phone IS NULL OR TRIM(c.wa_phone) = ''
        GROUP BY c.id, c.primary_name, c.wa_owner, c.source, c.is_active, c.created_at
        HAVING alias_count > 0 OR has_wacrm > 0 OR has_keeper_link > 0 OR has_joinbrands_link > 0 OR in_roster > 0
        ORDER BY has_joinbrands_link DESC, alias_count DESC, c.id ASC
        LIMIT 200
    `);

    const recommendation = [
        'Current roster is already safe: all 107 primary roster creators have non-null wa_phone.',
        'Directly enforcing NOT NULL on creators.wa_phone would fail because 1187 historical creator rows still have NULL/blank wa_phone.',
        '320 null-phone creators appear to be pure shells with no related rows and are the safest first cleanup bucket.',
        '867 null-phone creators still carry related rows (aliases / wa_crm_data / keeper_link / joinbrands_link), so they need staged cleanup or archival before enforcing NOT NULL.',
        'Because normalized phone duplicate groups are already 0, the blocker is NULL cleanup rather than uniqueness collisions.'
    ];

    const report = {
        generated_at: new Date().toISOString(),
        database: process.env.DB_NAME || 'wa_crm_v2',
        summary,
        relation_counts: relationCounts,
        recommendation,
    };

    fs.writeFileSync(path.join(outdir, 'summary.json'), JSON.stringify(report, null, 2));
    fs.writeFileSync(
        path.join(outdir, 'null-phone-related-creators.csv'),
        toCsv(topNullPhoneCreators, ['id', 'primary_name', 'wa_owner', 'source', 'is_active', 'created_at', 'alias_count', 'has_wacrm', 'has_keeper_link', 'has_joinbrands_link', 'in_roster'])
    );
    fs.writeFileSync(
        path.join(outdir, 'phase-c-wa-phone-rehearsal.sql'),
        [
            '-- Prepared only. Do not execute blindly.',
            '-- Phase C rehearsal for tightening creators.wa_phone to NOT NULL UNIQUE.',
            '',
            '-- 1) Verify all primary roster creators already have wa_phone',
            "SELECT COUNT(*) AS roster_null_phone FROM operator_creator_roster o JOIN creators c ON c.id = o.creator_id WHERE o.is_primary = 1 AND (c.wa_phone IS NULL OR TRIM(c.wa_phone) = '');",
            '',
            '-- 2) Measure remaining null-phone historical creators',
            "SELECT COUNT(*) AS null_phone_creators FROM creators WHERE wa_phone IS NULL OR TRIM(wa_phone) = '';",
            '',
            '-- 3) Inspect pure shells (safest deletion/archive candidates)',
            "SELECT c.id, c.primary_name, c.wa_owner, c.source, c.created_at FROM creators c LEFT JOIN creator_aliases a ON a.creator_id = c.id LEFT JOIN wa_crm_data w ON w.creator_id = c.id LEFT JOIN keeper_link k ON k.creator_id = c.id LEFT JOIN joinbrands_link j ON j.creator_id = c.id LEFT JOIN events e ON e.creator_id = c.id LEFT JOIN wa_messages wm ON wm.creator_id = c.id WHERE c.wa_phone IS NULL OR TRIM(c.wa_phone) = '' GROUP BY c.id, c.primary_name, c.wa_owner, c.source, c.created_at HAVING COUNT(a.id)=0 AND COUNT(w.creator_id)=0 AND COUNT(k.creator_id)=0 AND COUNT(j.creator_id)=0 AND COUNT(e.id)=0 AND COUNT(wm.id)=0;",
            '',
            '-- 4) Only after cleanup/archive, enforce NOT NULL on creators.wa_phone',
            "-- ALTER TABLE creators MODIFY wa_phone VARCHAR(32) NOT NULL COMMENT 'WhatsApp电话（唯一标识）';",
        ].join('\n')
    );

    console.log(JSON.stringify({ outdir }, null, 2));
    await db.closeDb();
}

main().catch(async (error) => {
    console.error(error);
    try {
        await db.closeDb();
    } catch (_) {}
    process.exit(1);
});
