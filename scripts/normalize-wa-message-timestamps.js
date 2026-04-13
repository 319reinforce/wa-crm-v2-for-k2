#!/usr/bin/env node
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { getDb, closeDb } = require('../db');

function toTimestampMs(value) {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return 0;
    return n > 1e12 ? Math.floor(n) : Math.floor(n * 1000);
}

function buildMessageHash(role, text, timestampMs) {
    return crypto
        .createHash('sha256')
        .update(`${role || ''}|${text || ''}|${timestampMs || ''}`)
        .digest('hex');
}

function chunk(items, size) {
    const out = [];
    for (let i = 0; i < items.length; i += size) {
        out.push(items.slice(i, i + size));
    }
    return out;
}

async function main() {
    const apply = process.argv.includes('--apply');
    const db = getDb();

    const deleteCandidates = await db.prepare(`
        SELECT a.id
        FROM wa_messages a
        WHERE a.timestamp < 1000000000000
          AND EXISTS (
              SELECT 1
              FROM wa_messages b
              WHERE b.creator_id = a.creator_id
                AND b.role = a.role
                AND b.text = a.text
                AND b.timestamp >= 1000000000000
                AND b.timestamp BETWEEN a.timestamp * 1000 AND a.timestamp * 1000 + 999
          )
        ORDER BY a.id
    `).all();

    const updateCandidates = await db.prepare(`
        SELECT a.id, a.creator_id, a.role, a.text, a.timestamp
        FROM wa_messages a
        WHERE a.timestamp < 1000000000000
          AND NOT EXISTS (
              SELECT 1
              FROM wa_messages b
              WHERE b.creator_id = a.creator_id
                AND b.role = a.role
                AND b.text = a.text
                AND b.timestamp >= 1000000000000
                AND b.timestamp BETWEEN a.timestamp * 1000 AND a.timestamp * 1000 + 999
          )
        ORDER BY a.id
    `).all();

    const summary = {
        generated_at: new Date().toISOString(),
        apply,
        delete_candidates: deleteCandidates.length,
        update_candidates: updateCandidates.length,
        deleted_rows: 0,
        updated_rows: 0,
        collision_deleted_rows: 0,
        remaining_legacy_rows: null,
    };

    if (apply) {
        await db.transaction(async (tx) => {
            for (const ids of chunk(deleteCandidates.map((row) => row.id), 500)) {
                if (ids.length === 0) continue;
                const placeholders = ids.map(() => '?').join(', ');
                await tx.prepare(`DELETE FROM wa_messages WHERE id IN (${placeholders})`).run(...ids);
                summary.deleted_rows += ids.length;
            }

            for (const row of updateCandidates) {
                const timestampMs = toTimestampMs(row.timestamp);
                const messageHash = buildMessageHash(row.role, row.text, timestampMs);
                const existing = await tx.prepare(
                    'SELECT id FROM wa_messages WHERE creator_id = ? AND message_hash = ? AND id <> ? LIMIT 1'
                ).get(row.creator_id, messageHash, row.id);

                if (existing?.id) {
                    await tx.prepare('DELETE FROM wa_messages WHERE id = ?').run(row.id);
                    summary.collision_deleted_rows += 1;
                    continue;
                }

                await tx.prepare('UPDATE wa_messages SET timestamp = ?, message_hash = ? WHERE id = ?')
                    .run(timestampMs, messageHash, row.id);
                summary.updated_rows += 1;
            }
        });
    }

    const remainingLegacy = await db.prepare(
        'SELECT COUNT(*) AS c FROM wa_messages WHERE timestamp < 1000000000000'
    ).get();
    summary.remaining_legacy_rows = remainingLegacy?.c || 0;

    const reportDir = path.join(process.cwd(), 'reports', `wa-message-timestamp-normalization-${Date.now()}`);
    fs.mkdirSync(reportDir, { recursive: true });
    fs.writeFileSync(path.join(reportDir, 'summary.json'), JSON.stringify(summary, null, 2));

    console.log(JSON.stringify({ reportDir, summary }, null, 2));
}

main()
    .catch((error) => {
        console.error('[normalize-wa-message-timestamps] failed:', error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await closeDb().catch(() => {});
    });
