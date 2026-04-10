#!/usr/bin/env node
require('dotenv').config();

const db = require('../db');
const { analyzeCreatorEligibility, normalizeCreatorOwner } = require('../server/services/creatorEligibilityService');

const SHOULD_APPLY = process.argv.includes('--apply');
const INCLUDE_ACTIVE = process.argv.includes('--include-active');

async function main() {
    const db2 = db.getDb();
    const creators = await db2.prepare(`
        SELECT id, primary_name, wa_phone, wa_owner, is_active
        FROM creators
        ${INCLUDE_ACTIVE ? '' : 'WHERE is_active = 1'}
        ORDER BY id ASC
    `).all();

    const invalid = [];
    const ownerFixes = [];
    const reasonCounts = {};

    for (const creator of creators) {
        const messages = await db2.prepare(`
            SELECT role, text, timestamp
            FROM wa_messages
            WHERE creator_id = ?
            ORDER BY timestamp DESC
            LIMIT 20
        `).all(creator.id);

        const result = analyzeCreatorEligibility(
            creator.wa_phone,
            creator.primary_name,
            [...messages].reverse(),
            { mode: 'cleanup' }
        );
        const normalizedOwner = normalizeCreatorOwner(creator.wa_owner);

        if (normalizedOwner !***REMOVED*** creator.wa_owner) {
            ownerFixes.push({ id: creator.id, from: creator.wa_owner, to: normalizedOwner });
        }

        if (!result.eligible) {
            invalid.push({
                id: creator.id,
                name: creator.primary_name,
                phone: creator.wa_phone,
                reasons: result.reasons,
                metrics: result.metrics,
            });
            for (const reason of result.reasons) {
                reasonCounts[reason] = (reasonCounts[reason] || 0) + 1;
            }
        }
    }

    if (SHOULD_APPLY) {
        for (const item of invalid) {
            await db2.prepare('UPDATE creators SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(item.id);
        }
        for (const item of ownerFixes) {
            await db2.prepare('UPDATE creators SET wa_owner = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(item.to, item.id);
        }
    }

    console.log(JSON.stringify({
        ok: true,
        apply: SHOULD_APPLY,
        scanned: creators.length,
        invalid_count: invalid.length,
        owner_fix_count: ownerFixes.length,
        reason_counts: reasonCounts,
        sample_invalid: invalid.slice(0, 20),
        sample_owner_fixes: ownerFixes.slice(0, 20),
    }, null, 2));
}

main()
    .catch((err) => {
        console.error(JSON.stringify({ ok: false, error: err.message }, null, 2));
        process.exitCode = 1;
    })
    .finally(async () => {
        await db.closeDb();
    });
