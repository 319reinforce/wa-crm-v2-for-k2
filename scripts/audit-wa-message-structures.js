#!/usr/bin/env node
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { getDb, closeDb } = require('../db');

const SINCE = process.env.WA_AUDIT_SINCE || '2026-04-11 00:00:00';
const MIN_REPEAT = Number(process.env.WA_AUDIT_MIN_REPEAT || 3);

async function main() {
    const db = getDb();

    const reportDir = path.join(process.cwd(), 'reports', `wa-message-structure-audit-${Date.now()}`);
    fs.mkdirSync(reportDir, { recursive: true });

    const summary = {};

    summary.generated_at = new Date().toISOString();
    summary.since = SINCE;
    summary.min_repeat = MIN_REPEAT;

    summary.legacy_timestamp_rows = (await db.prepare(
        'SELECT COUNT(*) AS c FROM wa_messages WHERE timestamp < 1000000000000'
    ).get())?.c || 0;

    summary.same_creator_exact_duplicate_groups = (await db.prepare(`
        SELECT COUNT(*) AS c
        FROM (
            SELECT creator_id, role, text, timestamp, COUNT(*) AS cnt
            FROM wa_messages
            GROUP BY creator_id, role, text, timestamp
            HAVING COUNT(*) > 1
        ) t
    `).get())?.c || 0;

    const operatorRoleSkew = await db.prepare(`
        SELECT operator, role, COUNT(*) AS cnt
        FROM wa_messages
        WHERE created_at >= ?
        GROUP BY operator, role
        ORDER BY operator ASC, role ASC
    `).all(SINCE);
    summary.operator_role_skew = operatorRoleSkew;

    const repeatGroups = await db.prepare(`
        SELECT
            operator,
            creator_id,
            role,
            COUNT(*) AS cnt,
            MIN(timestamp) AS first_ts,
            MAX(timestamp) AS last_ts,
            LEFT(text, 160) AS sample_text
        FROM wa_messages
        WHERE created_at >= ?
        GROUP BY operator, creator_id, role, text
        HAVING COUNT(*) >= ?
        ORDER BY cnt DESC, operator ASC, creator_id ASC
        LIMIT 200
    `).all(SINCE, MIN_REPEAT);
    summary.repeat_group_count = repeatGroups.length;

    const recentPerCreator = await db.prepare(`
        SELECT
            operator,
            creator_id,
            COUNT(*) AS cnt
        FROM wa_messages
        WHERE created_at >= ?
        GROUP BY operator, creator_id
        ORDER BY cnt DESC, operator ASC, creator_id ASC
        LIMIT 100
    `).all(SINCE);
    summary.recent_per_creator = recentPerCreator;

    const textOnlyRepeatGroups = await db.prepare(`
        SELECT
            operator,
            creator_id,
            COUNT(*) AS cnt,
            MIN(timestamp) AS first_ts,
            MAX(timestamp) AS last_ts,
            ROUND((MAX(timestamp) - MIN(timestamp)) / 1000 / GREATEST(COUNT(*) - 1, 1), 1) AS avg_gap_sec,
            LEFT(text, 160) AS sample_text
        FROM wa_messages
        WHERE created_at >= ?
        GROUP BY operator, creator_id, text
        HAVING COUNT(*) >= ?
        ORDER BY cnt DESC, operator ASC, creator_id ASC
        LIMIT 200
    `).all(SINCE, MIN_REPEAT);
    summary.text_repeat_group_count = textOnlyRepeatGroups.length;

    fs.writeFileSync(path.join(reportDir, 'summary.json'), JSON.stringify(summary, null, 2));
    fs.writeFileSync(path.join(reportDir, 'repeat-groups.json'), JSON.stringify(repeatGroups, null, 2));
    fs.writeFileSync(path.join(reportDir, 'text-repeat-groups.json'), JSON.stringify(textOnlyRepeatGroups, null, 2));

    console.log(JSON.stringify({
        reportDir,
        summary,
        top_repeat_groups: repeatGroups.slice(0, 20),
    }, null, 2));
}

main()
    .catch((error) => {
        console.error('[audit-wa-message-structures] failed:', error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await closeDb().catch(() => {});
    });
