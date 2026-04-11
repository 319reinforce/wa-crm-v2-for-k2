#!/usr/bin/env node
require('dotenv').config();

const db = require('../db');
const { mergeDuplicateCreatorIntoCanonical } = require('../server/services/creatorMergeService');
const { hardDeleteCreator } = require('./lib/hardDeleteCreator');

async function main() {
    const actions = [];

    await hardDeleteCreator(2410);
    actions.push({ type: 'delete', creator_id: 2410 });

    const ashley = await mergeDuplicateCreatorIntoCanonical({
        targetCreatorId: 1083,
        sourceCreatorId: 993,
        operator: 'Beau',
        reason: 'crosscheck_confirmed_duplicate_ashley',
    });
    actions.push({ type: 'merge', ...ashley });

    const kris = await mergeDuplicateCreatorIntoCanonical({
        targetCreatorId: 1096,
        sourceCreatorId: 1000,
        operator: 'Beau',
        reason: 'crosscheck_confirmed_duplicate_kris',
    });
    actions.push({ type: 'merge', ...kris });

    const snapshots = await db.getDb().prepare(`
        SELECT
            c.id,
            c.primary_name,
            c.wa_phone,
            c.wa_owner,
            EXISTS(SELECT 1 FROM operator_creator_roster r WHERE r.creator_id = c.id AND r.is_primary = 1) AS in_roster,
            (SELECT COUNT(*) FROM wa_messages wm WHERE wm.creator_id = c.id) AS msg_count
        FROM creators c
        WHERE c.id IN (1083, 1096, 2410)
        ORDER BY c.id
    `).all();

    console.log(JSON.stringify({
        ok: true,
        actions,
        snapshots,
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
