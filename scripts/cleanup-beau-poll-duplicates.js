#!/usr/bin/env node
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { getDb, closeDb } = require('../db');

const WINDOW_START = process.env.BEAU_POLL_DUP_START || '2026-04-11 15:00:00';
const WINDOW_END = process.env.BEAU_POLL_DUP_END || null;
const MIN_REPEAT = Number(process.env.BEAU_POLL_DUP_MIN_REPEAT || 3);

async function main() {
    const apply = process.argv.includes('--apply');
    const db = getDb();

    const endClause = WINDOW_END ? ' AND created_at <= ?' : '';
    const groupParams = WINDOW_END ? [WINDOW_START, WINDOW_END, MIN_REPEAT] : [WINDOW_START, MIN_REPEAT];

    const groups = await db.prepare(`
        SELECT creator_id, text, COUNT(*) AS cnt, MIN(id) AS keep_id
        FROM wa_messages
        WHERE operator = 'Beau'
          AND created_at >= ?
          ${endClause}
        GROUP BY creator_id, text
        HAVING COUNT(*) >= ?
        ORDER BY cnt DESC, creator_id ASC
    `).all(...groupParams);

    const summary = {
        generated_at: new Date().toISOString(),
        apply,
        window_start: WINDOW_START,
        window_end: WINDOW_END,
        min_repeat: MIN_REPEAT,
        groups: groups.length,
        duplicate_rows: 0,
        deleted_rows: 0,
        updated_role_rows: 0,
        role_resolved_from_history: 0,
        unresolved_groups: 0,
    };

    const details = [];

    if (apply) {
        await db.transaction(async (tx) => {
            for (const group of groups) {
                const rows = await tx.prepare(`
                    SELECT id, creator_id, role, operator, timestamp, created_at
                    FROM wa_messages
                    WHERE creator_id = ? AND text = ? AND operator = 'Beau' AND created_at >= ? ${WINDOW_END ? 'AND created_at <= ?' : ''}
                    ORDER BY timestamp ASC, id ASC
                `).all(...(WINDOW_END ? [group.creator_id, group.text, WINDOW_START, WINDOW_END] : [group.creator_id, group.text, WINDOW_START]));

                if (rows.length < MIN_REPEAT) continue;
                const keepRow = rows[0];
                const duplicateIds = rows.slice(1).map((row) => row.id);
                summary.duplicate_rows += duplicateIds.length;

                const historicalRoles = await tx.prepare(`
                    SELECT role, COUNT(*) AS cnt
                    FROM wa_messages
                    WHERE creator_id = ?
                      AND text = ?
                      AND id <> ?
                      AND created_at < ?
                    GROUP BY role
                    ORDER BY cnt DESC
                `).all(group.creator_id, group.text, keepRow.id, WINDOW_START);

                let resolvedRole = keepRow.role;
                if (historicalRoles.length === 1) {
                    resolvedRole = historicalRoles[0].role;
                    summary.role_resolved_from_history += 1;
                } else if (historicalRoles.length > 1) {
                    resolvedRole = historicalRoles[0].role;
                    summary.role_resolved_from_history += 1;
                } else {
                    summary.unresolved_groups += 1;
                }

                if (resolvedRole !== keepRow.role) {
                    await tx.prepare('UPDATE wa_messages SET role = ? WHERE id = ?').run(resolvedRole, keepRow.id);
                    summary.updated_role_rows += 1;
                }

                if (duplicateIds.length > 0) {
                    const placeholders = duplicateIds.map(() => '?').join(', ');
                    await tx.prepare(`DELETE FROM wa_messages WHERE id IN (${placeholders})`).run(...duplicateIds);
                    summary.deleted_rows += duplicateIds.length;
                }

                details.push({
                    creator_id: group.creator_id,
                    keep_id: keepRow.id,
                    kept_role: resolvedRole,
                    original_role: keepRow.role,
                    duplicates_deleted: duplicateIds.length,
                    sample_text: group.text.slice(0, 120),
                });
            }
        });
    } else {
        details.push(...groups.slice(0, 100).map((group) => ({
            creator_id: group.creator_id,
            keep_id: group.keep_id,
            duplicates_deleted: group.cnt - 1,
            sample_text: String(group.text || '').slice(0, 120),
        })));
        summary.duplicate_rows = groups.reduce((sum, group) => sum + Math.max(group.cnt - 1, 0), 0);
    }

    const reportDir = path.join(process.cwd(), 'reports', `beau-poll-duplicate-cleanup-${Date.now()}`);
    fs.mkdirSync(reportDir, { recursive: true });
    fs.writeFileSync(path.join(reportDir, 'summary.json'), JSON.stringify(summary, null, 2));
    fs.writeFileSync(path.join(reportDir, 'details.json'), JSON.stringify(details, null, 2));

    console.log(JSON.stringify({ reportDir, summary, sample: details.slice(0, 20) }, null, 2));
}

main()
    .catch((error) => {
        console.error('[cleanup-beau-poll-duplicates] failed:', error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await closeDb().catch(() => {});
    });
