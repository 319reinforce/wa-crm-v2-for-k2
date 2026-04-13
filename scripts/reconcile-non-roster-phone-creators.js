#!/usr/bin/env node
require('dotenv').config();

const db = require('../db');
const { resolveCanonicalCreator } = require('../server/services/canonicalCreatorResolver');

async function main() {
    const db2 = db.getDb();
    const candidates = await db2.prepare(`
        SELECT
            c.id,
            c.primary_name,
            c.wa_phone,
            c.wa_owner,
            (SELECT COUNT(*) FROM wa_messages wm WHERE wm.creator_id = c.id) AS msg_count
        FROM creators c
        LEFT JOIN operator_creator_roster r ON r.creator_id = c.id AND r.is_primary = 1
        WHERE c.is_active = 1
          AND r.creator_id IS NULL
          AND c.wa_phone IS NOT NULL
          AND c.wa_phone != ''
          AND c.wa_owner IN ('Beau', 'Yiyun', 'Jiawen')
        ORDER BY msg_count DESC, c.id ASC
    `).all();

    const stats = {
        scanned: candidates.length,
        merged: 0,
        attached: 0,
        unchanged: 0,
        errors: 0,
        details: [],
    };

    for (const candidate of candidates) {
        try {
            const resolved = await resolveCanonicalCreator({
                operator: candidate.wa_owner,
                phone: candidate.wa_phone,
                name: candidate.primary_name,
            });

            if (!resolved || Number(resolved.creatorId) === Number(candidate.id)) {
                stats.unchanged += 1;
                continue;
            }

            if (resolved.mergedDuplicate) stats.merged += 1;
            else stats.attached += 1;

            stats.details.push({
                source_id: candidate.id,
                source_name: candidate.primary_name,
                source_phone: candidate.wa_phone,
                owner: candidate.wa_owner,
                msg_count: Number(candidate.msg_count || 0),
                target_id: resolved.creatorId,
                resolution: resolved.resolution,
                reasons: resolved.reasons,
            });
        } catch (error) {
            stats.errors += 1;
            stats.details.push({
                source_id: candidate.id,
                source_name: candidate.primary_name,
                source_phone: candidate.wa_phone,
                owner: candidate.wa_owner,
                error: error.message,
            });
        }
    }

    console.log(JSON.stringify(stats, null, 2));
    await db.closeDb();
}

main().catch(async (error) => {
    console.error('[reconcile-non-roster-phone-creators] failed:', error);
    try { await db.closeDb(); } catch (_) {}
    process.exit(1);
});
