const db = require('../../db');
const { sha256 } = require('../../server/utils/crypto');

function unique(values = []) {
    return [...new Set(values.filter(Boolean))];
}

async function getCreatorClientIds(tx, creatorId) {
    const creator = await tx.prepare('SELECT wa_phone FROM creators WHERE id = ? LIMIT 1').get(creatorId);
    const aliasRows = await tx.prepare(`
        SELECT alias_value
        FROM creator_aliases
        WHERE creator_id = ? AND alias_type = 'wa_phone'
    `).all(creatorId);
    const manualMatchRows = await tx.prepare(`
        SELECT wa_phone
        FROM manual_match
        WHERE creator_id = ? AND wa_phone IS NOT NULL AND wa_phone <> ''
    `).all(creatorId);

    return unique([
        String(creator?.wa_phone || '').trim(),
        ...aliasRows.map((row) => String(row?.alias_value || '').trim()),
        ...manualMatchRows.map((row) => String(row?.wa_phone || '').trim()),
    ]);
}

async function hardDeleteCreator(creatorId) {
    const db2 = db.getDb();
    await db2.transaction(async (tx) => {
        const clientIds = await getCreatorClientIds(tx, creatorId);
        const clientIdHashes = clientIds.map((clientId) => sha256(clientId));

        const eventRows = await tx.prepare('SELECT id FROM events WHERE creator_id = ?').all(creatorId);
        for (const event of eventRows) {
            await tx.prepare('DELETE FROM event_periods WHERE event_id = ?').run(event.id);
        }
        if (eventRows.length > 0) {
            await tx.prepare('DELETE FROM events WHERE creator_id = ?').run(creatorId);
        }

        const creatorDeletes = [
            ['DELETE FROM operator_creator_roster WHERE creator_id = ?', creatorId],
            ['DELETE FROM creator_aliases WHERE creator_id = ?', creatorId],
            ['DELETE FROM manual_match WHERE creator_id = ?', creatorId],
            ['DELETE FROM wa_crm_data WHERE creator_id = ?', creatorId],
            ['DELETE FROM keeper_link WHERE creator_id = ?', creatorId],
            ['DELETE FROM joinbrands_link WHERE creator_id = ?', creatorId],
            ['DELETE FROM wa_messages WHERE creator_id = ?', creatorId],
        ];

        for (const [sql, param] of creatorDeletes) {
            await tx.prepare(sql).run(param);
        }

        for (const clientId of clientIds) {
            const clientDeletes = [
                'DELETE FROM client_memory WHERE client_id = ?',
                'DELETE FROM client_profiles WHERE client_id = ?',
                'DELETE FROM client_tags WHERE client_id = ?',
                'DELETE FROM generation_log WHERE client_id = ?',
                'DELETE FROM retrieval_snapshot WHERE client_id = ?',
                'DELETE FROM sft_feedback WHERE client_id = ?',
            ];
            for (const sql of clientDeletes) {
                await tx.prepare(sql).run(clientId);
            }
        }

        for (const clientIdHash of clientIdHashes) {
            await tx.prepare('DELETE FROM sft_memory WHERE client_id_hash = ?').run(clientIdHash);
        }

        await tx.prepare('DELETE FROM creators WHERE id = ?').run(creatorId);
    });
}

module.exports = { hardDeleteCreator };
