#!/usr/bin/env node
'use strict';

require('dotenv').config();

const db = require('../db');
const creatorCache = require('../server/services/creatorCache');
const { mergeDuplicateCreatorIntoCanonical } = require('../server/services/creatorMergeService');
const { getSessionIdForOperator, TABLE: ROSTER_TABLE } = require('../server/services/operatorRosterService');
const { normalizeOperatorName } = require('../server/utils/operator');
const {
    getWaPhoneLookupVariants,
    normalizeWaPhoneForStorage,
} = require('../server/utils/phoneNormalization');

const DEFAULT_OWNER = 'WangYouKe';
const PHONE_CLEAN_SQL = "REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(wa_phone, '+', ''), ' ', ''), '-', ''), '(', ''), ')', '')";

function parseArgs(argv) {
    const out = {
        owner: process.env.WANGYOUKE_REBUILD_OWNER || DEFAULT_OWNER,
        write: true,
    };
    for (const arg of argv) {
        if (arg === '--dry-run') out.write = false;
        if (arg === '--write') out.write = true;
        const match = arg.match(/^--owner=(.*)$/);
        if (match) out.owner = match[1];
    }
    return out;
}

function chooseCanonical(rows, canonicalPhone) {
    return [...rows].sort((a, b) => {
        const aCanonical = String(a.wa_phone || '').replace(/\D/g, '') === canonicalPhone ? 1 : 0;
        const bCanonical = String(b.wa_phone || '').replace(/\D/g, '') === canonicalPhone ? 1 : 0;
        if (aCanonical !== bCanonical) return bCanonical - aCanonical;
        const aActive = Number(a.is_active || 0) ? 1 : 0;
        const bActive = Number(b.is_active || 0) ? 1 : 0;
        if (aActive !== bActive) return bActive - aActive;
        const aMsgs = Number(a.msg_count || 0);
        const bMsgs = Number(b.msg_count || 0);
        if (aMsgs !== bMsgs) return bMsgs - aMsgs;
        return Number(a.id || 0) - Number(b.id || 0);
    })[0] || null;
}

async function loadScopedCreators(owner) {
    return await db.getDb().prepare(`
        SELECT
            c.id,
            c.primary_name,
            c.wa_phone,
            c.wa_owner,
            c.source,
            c.is_active,
            (SELECT COUNT(*) FROM wa_messages wm WHERE wm.creator_id = c.id) AS msg_count,
            EXISTS(
                SELECT 1 FROM ${ROSTER_TABLE} r
                WHERE r.creator_id = c.id AND r.operator = ? AND r.is_primary = 1
            ) AS has_target_roster
        FROM creators c
        WHERE c.wa_owner = ?
           OR EXISTS(
                SELECT 1 FROM ${ROSTER_TABLE} r
                WHERE r.creator_id = c.id AND r.operator = ? AND r.is_primary = 1
           )
        ORDER BY c.id ASC
    `).all(owner, owner, owner);
}

async function findAllCreatorsByPhoneVariants(tx, phone) {
    const variants = getWaPhoneLookupVariants(phone);
    if (variants.length === 0) return [];
    const placeholders = variants.map(() => '?').join(', ');
    return await tx.prepare(`
        SELECT id, primary_name, wa_phone, wa_owner
        FROM creators
        WHERE ${PHONE_CLEAN_SQL} IN (${placeholders})
        ORDER BY id ASC
    `).all(...variants);
}

async function ensureRuntimeRows(tx, creator, owner, sessionId, canonicalPhone) {
    await tx.prepare(`
        UPDATE creators
        SET wa_phone = ?,
            wa_owner = ?,
            is_active = 1,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
    `).run(canonicalPhone, owner, creator.id);

    await tx.prepare(`
        INSERT INTO ${ROSTER_TABLE}
            (creator_id, operator, session_id, source_file, raw_name, match_strategy, score, is_primary)
        VALUES (?, ?, ?, ?, ?, ?, ?, 1)
        ON DUPLICATE KEY UPDATE
            operator = VALUES(operator),
            session_id = VALUES(session_id),
            source_file = COALESCE(source_file, VALUES(source_file)),
            raw_name = COALESCE(raw_name, VALUES(raw_name)),
            match_strategy = VALUES(match_strategy),
            score = GREATEST(score, VALUES(score)),
            is_primary = 1,
            updated_at = CURRENT_TIMESTAMP
    `).run(
        creator.id,
        owner,
        sessionId,
        'wangyouke-startup-rebuild',
        creator.primary_name || null,
        'phone-normalized-rebuild',
        100,
    );

    await tx.prepare('INSERT IGNORE INTO wa_crm_data (creator_id) VALUES (?)').run(creator.id);
}

async function moveMessagesPreservingNative(sourceCreatorId, targetCreatorId, owner) {
    await db.getDb().transaction(async (tx) => {
        await tx.prepare(`
            DELETE sm
            FROM wa_messages sm
            JOIN wa_messages tm
              ON tm.creator_id = ?
             AND sm.creator_id = ?
             AND sm.message_hash IS NOT NULL
             AND tm.message_hash = sm.message_hash
        `).run(targetCreatorId, sourceCreatorId);

        await tx.prepare(`
            DELETE sm
            FROM wa_messages sm
            JOIN wa_messages tm
              ON tm.creator_id = ?
             AND sm.creator_id = ?
             AND sm.wa_message_id IS NOT NULL
             AND tm.wa_message_id = sm.wa_message_id
        `).run(targetCreatorId, sourceCreatorId);

        await tx.prepare(`
            UPDATE wa_messages
            SET creator_id = ?,
                operator = COALESCE(operator, ?),
                updated_at = CURRENT_TIMESTAMP
            WHERE creator_id = ?
        `).run(targetCreatorId, owner, sourceCreatorId);
    });
}

async function rebuild({ owner, write }) {
    const normalizedOwner = normalizeOperatorName(owner, owner || DEFAULT_OWNER);
    const sessionId = getSessionIdForOperator(normalizedOwner) || String(normalizedOwner || '').toLowerCase();
    const scopedRows = await loadScopedCreators(normalizedOwner);
    const byCanonicalPhone = new Map();
    const report = {
        owner: normalizedOwner,
        session_id: sessionId,
        write,
        scanned: scopedRows.length,
        normalized: 0,
        merged: 0,
        conflicts: [],
        skipped: [],
    };

    for (const row of scopedRows) {
        const canonicalPhone = normalizeWaPhoneForStorage(row.wa_phone);
        if (!canonicalPhone) {
            report.skipped.push({ id: row.id, reason: 'empty_phone' });
            continue;
        }
        const list = byCanonicalPhone.get(canonicalPhone) || [];
        list.push(row);
        byCanonicalPhone.set(canonicalPhone, list);
    }

    for (const [canonicalPhone, rows] of byCanonicalPhone.entries()) {
        const canonical = chooseCanonical(rows, canonicalPhone);
        if (!canonical) continue;

        const allSamePhoneRows = await db.getDb().transaction(async (tx) => (
            await findAllCreatorsByPhoneVariants(tx, canonicalPhone)
        ));
        const outsideOwner = allSamePhoneRows.filter((row) => (
            Number(row.id) !== Number(canonical.id)
            && normalizeOperatorName(row.wa_owner, row.wa_owner) !== normalizedOwner
            && !rows.some((scoped) => Number(scoped.id) === Number(row.id))
        ));
        if (outsideOwner.length > 0) {
            report.conflicts.push({
                phone: canonicalPhone,
                canonical_id: canonical.id,
                conflicting_creator_ids: outsideOwner.map((row) => row.id),
            });
            continue;
        }

        if (write) {
            await db.getDb().transaction(async (tx) => {
                await ensureRuntimeRows(tx, canonical, normalizedOwner, sessionId, canonicalPhone);
            });
            await creatorCache.invalidateCreator(canonical.id, canonical.wa_phone).catch(() => {});
            await creatorCache.invalidateByPhone(canonicalPhone).catch(() => {});
        }
        report.normalized += 1;

        for (const source of rows) {
            if (Number(source.id) === Number(canonical.id)) continue;
            if (write) {
                await moveMessagesPreservingNative(source.id, canonical.id, normalizedOwner);
                const result = await mergeDuplicateCreatorIntoCanonical({
                    targetCreatorId: canonical.id,
                    sourceCreatorId: source.id,
                    operator: normalizedOwner,
                    reason: 'wangyouke_startup_phone_rebuild',
                    allowDistinctPhones: true,
                });
                if (result?.merged) report.merged += 1;
                await db.getDb().transaction(async (tx) => {
                    await ensureRuntimeRows(tx, canonical, normalizedOwner, sessionId, canonicalPhone);
                });
                await creatorCache.invalidateCreator(source.id, source.wa_phone).catch(() => {});
            } else {
                report.merged += 1;
            }
        }
    }

    return report;
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    const report = await rebuild(args);
    console.log(`[wangyouke-rebuild] ${JSON.stringify(report)}`);
}

if (require.main === module) {
    main()
        .catch((err) => {
            console.error('[wangyouke-rebuild] failed:', err.message);
            process.exitCode = 1;
        })
        .finally(async () => {
            await db.closeDb().catch(() => {});
        });
}

module.exports = { rebuild };
