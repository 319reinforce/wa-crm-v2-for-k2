#!/usr/bin/env node
require('dotenv').config();

const db = require('../db');
const { normalizeMessageText, toTimestampMs } = require('../server/services/messageDedupService');

async function main() {
    const db2 = db.getDb();
    const rows = await db2.prepare(`
        SELECT id, creator_id, operator, role, text, timestamp
        FROM wa_messages
        WHERE timestamp IS NOT NULL
          AND text IS NOT NULL
          AND TRIM(text) <> ''
    `).all();

    let overlapCount = 0;
    const samples = [];

    for (const row of rows) {
        const normalizedText = normalizeMessageText(row.text);
        const timestampMs = toTimestampMs(row.timestamp);
        const normalizedRole = row.role === 'me' ? 'me' : 'user';
        if (!normalizedText || timestampMs <= 0) continue;
        const match = await db2.prepare(`
            SELECT gm.group_chat_id, gc.group_name
            FROM wa_group_messages gm
            JOIN wa_group_chats gc ON gc.id = gm.group_chat_id
            WHERE gm.text = ?
              AND gm.timestamp = ?
              AND gm.role = ?
              AND (gm.operator = ? OR gc.operator = ?)
            LIMIT 1
        `).get(normalizedText, timestampMs, normalizedRole, row.operator || null, row.operator || null);

        if (!match) continue;

        overlapCount += 1;
        if (samples.length < 5) {
            samples.push({
                wa_message_id: row.id,
                creator_id: row.creator_id,
                operator: row.operator || null,
                timestamp: row.timestamp,
                text: String(row.text || '').slice(0, 120),
                group_chat_id: match.group_chat_id,
                group_name: match.group_name,
            });
        }
    }

    const summary = {
        wa_messages_checked: rows.length,
        group_overlap_matches: overlapCount,
        samples,
    };

    console.log(JSON.stringify(summary, null, 2));

    await db.closeDb();

    if (overlapCount > 0) {
        process.exit(1);
    }
}

main().catch(async (error) => {
    console.error('[check-group-pollution-regression] failed:', error.message);
    try {
        await db.closeDb();
    } catch (_) {}
    process.exit(1);
});
