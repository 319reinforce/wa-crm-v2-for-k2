#!/usr/bin/env node
require('dotenv').config();

const db = require('../db');

async function getCounts(handle) {
    const q1 = async (sql) => (await handle.prepare(sql).get()).c;
    return {
        creators_total: await q1('SELECT COUNT(*) AS c FROM creators'),
        null_phone_creators: await q1("SELECT COUNT(*) AS c FROM creators WHERE wa_phone IS NULL OR TRIM(wa_phone) = ''"),
        manual_match_null_phone_creators: await q1(`
            SELECT COUNT(*) AS c
            FROM manual_match mm
            JOIN creators c ON c.id = mm.creator_id
            WHERE c.wa_phone IS NULL OR TRIM(c.wa_phone) = ''
        `),
        creator_aliases_null_phone_creators: await q1(`
            SELECT COUNT(*) AS c
            FROM creator_aliases a
            JOIN creators c ON c.id = a.creator_id
            WHERE c.wa_phone IS NULL OR TRIM(c.wa_phone) = ''
        `),
        wa_crm_null_phone_creators: await q1(`
            SELECT COUNT(*) AS c
            FROM wa_crm_data w
            JOIN creators c ON c.id = w.creator_id
            WHERE c.wa_phone IS NULL OR TRIM(c.wa_phone) = ''
        `),
        keeper_link_null_phone_creators: await q1(`
            SELECT COUNT(*) AS c
            FROM keeper_link k
            JOIN creators c ON c.id = k.creator_id
            WHERE c.wa_phone IS NULL OR TRIM(c.wa_phone) = ''
        `),
        joinbrands_link_null_phone_creators: await q1(`
            SELECT COUNT(*) AS c
            FROM joinbrands_link j
            JOIN creators c ON c.id = j.creator_id
            WHERE c.wa_phone IS NULL OR TRIM(c.wa_phone) = ''
        `),
    };
}

async function main() {
    const handle = db.getDb();
    const before = await getCounts(handle);

    await handle.transaction(async (tx) => {
        await tx.prepare(`
            DELETE mm
            FROM manual_match mm
            JOIN creators c ON c.id = mm.creator_id
            WHERE c.wa_phone IS NULL OR TRIM(c.wa_phone) = ''
        `).run();

        await tx.prepare(`
            DELETE FROM creators
            WHERE wa_phone IS NULL OR TRIM(wa_phone) = ''
        `).run();
    });

    const after = await getCounts(handle);

    console.log(JSON.stringify({ before, after }, null, 2));
    await db.closeDb();
}

main().catch(async (error) => {
    console.error(error);
    try {
        await db.closeDb();
    } catch (_) {}
    process.exit(1);
});
