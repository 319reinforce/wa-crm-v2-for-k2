#!/usr/bin/env node
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { getDb, closeDb } = require('../db');

const APPLY = process.argv.includes('--apply');

// 保守修正：只处理已人工确认的异常模式
const DELETE_RULES = [
    {
        label: 'alissa_duplicate_wrong_role_reinserts',
        creatorId: 983,
        ids: [63598, 70347],
        reason: 'pollution reinserts of historical outbound message; canonical me row is 43387',
    },
    {
        label: 'amanda_google_doc_wrong_role_reinsert',
        creatorId: 932,
        ids: [71971],
        reason: 'historical outbound Google Doc link reinserted as user during polluted poll window; canonical me row is 72618',
    },
    {
        label: 'amanda_payout_explanation_wrong_role_reinsert',
        creatorId: 932,
        ids: [71816],
        reason: 'historical outbound payout explanation reinserted as user during polluted poll window; canonical me row is 72608',
    },
    {
        label: 'amanda_monthly_fee_wrong_role_reinsert',
        creatorId: 932,
        ids: [71818],
        reason: 'historical outbound monthly fee explanation reinserted as user during polluted poll window; canonical me row is 72610',
    },
    {
        label: 'angela_payout_schedule_wrong_role_reinsert',
        creatorId: 1131,
        ids: [71844],
        reason: 'historical outbound payout schedule explanation reinserted as user during polluted poll window; canonical me row is 72532',
    },
];

const UPDATE_RULES = [
    {
        label: 'noelia_followup_should_be_me',
        id: 65273,
        creatorId: 1072,
        expectedRole: 'me',
        reason: 'outbound follow-up addressed to contact; misclassified during polluted poll window',
    },
];

async function main() {
    const db = getDb();
    const summary = {
        generated_at: new Date().toISOString(),
        apply: APPLY,
        delete_rules: [],
        update_rules: [],
        deleted_rows: 0,
        updated_rows: 0,
    };

    const reportDir = path.join(process.cwd(), 'reports', `role-anomaly-backfill-${Date.now()}`);
    fs.mkdirSync(reportDir, { recursive: true });

    await db.transaction(async (tx) => {
        for (const rule of DELETE_RULES) {
            const rows = await tx.prepare(`
                SELECT id, creator_id, role, operator, text, timestamp, created_at
                FROM wa_messages
                WHERE creator_id = ?
                  AND id IN (${rule.ids.map(() => '?').join(', ')})
                ORDER BY timestamp ASC, id ASC
            `).all(rule.creatorId, ...rule.ids);

            summary.delete_rules.push({
                ...rule,
                matched_rows: rows.length,
                rows,
            });

            if (APPLY && rows.length > 0) {
                await tx.prepare(`DELETE FROM wa_messages WHERE id IN (${rule.ids.map(() => '?').join(', ')})`).run(...rule.ids);
                summary.deleted_rows += rows.length;
            }
        }

        for (const rule of UPDATE_RULES) {
            const row = await tx.prepare(`
                SELECT id, creator_id, role, operator, text, timestamp, created_at
                FROM wa_messages
                WHERE id = ? AND creator_id = ?
                LIMIT 1
            `).get(rule.id, rule.creatorId);

            summary.update_rules.push({
                ...rule,
                matched: !!row,
                before: row || null,
            });

            if (APPLY && row && row.role !== rule.expectedRole) {
                await tx.prepare('UPDATE wa_messages SET role = ? WHERE id = ?').run(rule.expectedRole, rule.id);
                summary.updated_rows += 1;
            }
        }
    });

    fs.writeFileSync(path.join(reportDir, 'summary.json'), JSON.stringify(summary, null, 2));
    console.log(JSON.stringify({ reportDir, summary }, null, 2));
}

main()
    .catch((error) => {
        console.error('[backfill-role-anomalies] failed:', error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await closeDb().catch(() => {});
    });
