const db = require('../../db');
const { normalizeOperatorName } = require('../utils/operator');

const WACRM_COLUMNS = [
    'priority', 'next_action', 'event_score', 'urgency_level', 'monthly_fee_status',
    'monthly_fee_amount', 'monthly_fee_deducted', 'beta_status', 'beta_cycle_start',
    'beta_program_type', 'agency_bound', 'agency_bound_at', 'agency_deadline',
    'video_count', 'video_target', 'video_last_checked',
];

const KEEPER_COLUMNS = [
    'keeper_username', 'keeper_gmv', 'keeper_gmv30', 'keeper_orders', 'keeper_videos',
    'keeper_videos_posted', 'keeper_videos_sold', 'keeper_card_rate', 'keeper_order_rate',
    'keeper_reg_time', 'keeper_activate_time', 'last_synced',
];

const JOINBRANDS_COLUMNS = [
    'creator_name_jb', 'jb_gmv', 'jb_status', 'jb_priority', 'jb_next_action', 'last_message',
    'days_since_msg', 'invite_code_jb', 'ev_joined', 'ev_ready_sent', 'ev_trial_7day',
    'ev_trial_active', 'ev_monthly_started', 'ev_monthly_invited', 'ev_monthly_joined',
    'ev_whatsapp_shared', 'ev_gmv_1k', 'ev_gmv_2k', 'ev_gmv_5k', 'ev_gmv_10k',
    'ev_agency_bound', 'ev_churned', 'last_synced',
];

const ROSTER_COLUMNS = [
    'operator', 'session_id', 'source_file', 'raw_poc', 'raw_name', 'raw_handle',
    'raw_keeper_name', 'marketing_channel', 'match_strategy', 'score', 'is_primary',
];

function isBlank(value) {
    return value ***REMOVED***= null || value ***REMOVED***= undefined || value ***REMOVED***= '';
}

function shouldCopyValue(sourceValue, targetValue) {
    if (isBlank(sourceValue)) return false;
    if (isBlank(targetValue)) return true;
    if (typeof sourceValue ***REMOVED***= 'number' && typeof targetValue ***REMOVED***= 'number') {
        if (targetValue ***REMOVED***= 0 && sourceValue !***REMOVED*** 0) return true;
        return false;
    }
    if ((sourceValue ***REMOVED***= 1 || sourceValue ***REMOVED***= true) && (targetValue ***REMOVED***= 0 || targetValue ***REMOVED***= false)) {
        return true;
    }
    return false;
}

function choosePrimaryName(target, source) {
    if (!target) return source;
    if (!source) return target;
    const targetText = String(target).trim();
    const sourceText = String(source).trim();
    if (!targetText) return sourceText;
    if (/^unknown$/i.test(targetText) && sourceText) return sourceText;
    if (targetText.length < 4 && sourceText.length > targetText.length) return sourceText;
    return targetText;
}

async function upsertAliases(tx, targetCreatorId, values = [], aliasType = 'wa_name', verified = 1) {
    for (const value of values) {
        if (isBlank(value)) continue;
        await tx.prepare(
            'INSERT IGNORE INTO creator_aliases (creator_id, alias_type, alias_value, is_verified) VALUES (?, ?, ?, ?)'
        ).run(targetCreatorId, aliasType, String(value).trim(), verified ? 1 : 0);
    }
}

async function moveAliases(tx, sourceCreatorId, targetCreatorId) {
    await tx.prepare(`
        INSERT IGNORE INTO creator_aliases (creator_id, alias_type, alias_value, is_verified, matched_at)
        SELECT ?, alias_type, alias_value, is_verified, matched_at
        FROM creator_aliases
        WHERE creator_id = ?
    `).run(targetCreatorId, sourceCreatorId);

    await tx.prepare('DELETE FROM creator_aliases WHERE creator_id = ?').run(sourceCreatorId);
}

async function moveMessages(tx, sourceCreatorId, targetCreatorId, fallbackOperator = null) {
    await tx.prepare(`
        INSERT IGNORE INTO wa_messages (creator_id, role, operator, text, timestamp, message_hash, created_at)
        SELECT ?, role, COALESCE(operator, ?), text, timestamp, message_hash, created_at
        FROM wa_messages
        WHERE creator_id = ?
    `).run(targetCreatorId, fallbackOperator, sourceCreatorId);

    await tx.prepare('DELETE FROM wa_messages WHERE creator_id = ?').run(sourceCreatorId);
}

async function mergeOneToOneTable(tx, table, columns, sourceCreatorId, targetCreatorId) {
    const sourceRow = await tx.prepare(`SELECT * FROM ${table} WHERE creator_id = ? LIMIT 1`).get(sourceCreatorId);
    if (!sourceRow) return;

    const targetRow = await tx.prepare(`SELECT * FROM ${table} WHERE creator_id = ? LIMIT 1`).get(targetCreatorId);
    if (!targetRow) {
        await tx.prepare(`UPDATE ${table} SET creator_id = ? WHERE creator_id = ?`).run(targetCreatorId, sourceCreatorId);
        return;
    }

    const updates = [];
    const values = [];
    for (const column of columns) {
        if (shouldCopyValue(sourceRow[column], targetRow[column])) {
            updates.push(`${column} = ?`);
            values.push(sourceRow[column]);
        }
    }

    if (updates.length > 0) {
        values.push(targetCreatorId);
        await tx.prepare(`UPDATE ${table} SET ${updates.join(', ')} WHERE creator_id = ?`).run(...values);
    }

    await tx.prepare(`DELETE FROM ${table} WHERE creator_id = ?`).run(sourceCreatorId);
}

async function moveManualMatches(tx, sourceCreatorId, targetCreatorId) {
    await tx.prepare(`
        INSERT IGNORE INTO manual_match (creator_id, keeper_username, joinbrands_name, wa_phone, matched_by, matched_at)
        SELECT ?, keeper_username, joinbrands_name, wa_phone, matched_by, matched_at
        FROM manual_match
        WHERE creator_id = ?
    `).run(targetCreatorId, sourceCreatorId);
    await tx.prepare('DELETE FROM manual_match WHERE creator_id = ?').run(sourceCreatorId);
}

async function moveRoster(tx, sourceCreatorId, targetCreatorId) {
    const sourceRow = await tx.prepare('SELECT * FROM operator_creator_roster WHERE creator_id = ? LIMIT 1').get(sourceCreatorId);
    if (!sourceRow) return;

    const targetRow = await tx.prepare('SELECT * FROM operator_creator_roster WHERE creator_id = ? LIMIT 1').get(targetCreatorId);
    if (!targetRow) {
        await tx.prepare('UPDATE operator_creator_roster SET creator_id = ? WHERE creator_id = ?').run(targetCreatorId, sourceCreatorId);
        return;
    }

    const updates = [];
    const values = [];
    for (const column of ROSTER_COLUMNS) {
        if (shouldCopyValue(sourceRow[column], targetRow[column])) {
            updates.push(`${column} = ?`);
            values.push(sourceRow[column]);
        }
    }
    if (updates.length > 0) {
        values.push(targetCreatorId);
        await tx.prepare(`UPDATE operator_creator_roster SET ${updates.join(', ')} WHERE creator_id = ?`).run(...values);
    }

    await tx.prepare('DELETE FROM operator_creator_roster WHERE creator_id = ?').run(sourceCreatorId);
}

async function moveEvents(tx, sourceCreatorId, targetCreatorId) {
    const sourceEvents = await tx.prepare('SELECT * FROM events WHERE creator_id = ? ORDER BY id ASC').all(sourceCreatorId);
    for (const event of sourceEvents) {
        const conflict = await tx.prepare(
            'SELECT id FROM events WHERE creator_id = ? AND event_key = ? AND status = ? LIMIT 1'
        ).get(targetCreatorId, event.event_key, event.status);

        if (conflict?.id) {
            await tx.prepare('UPDATE event_periods SET event_id = ? WHERE event_id = ?').run(conflict.id, event.id);
            await tx.prepare('DELETE FROM events WHERE id = ?').run(event.id);
            continue;
        }

        await tx.prepare('UPDATE events SET creator_id = ? WHERE id = ?').run(targetCreatorId, event.id);
    }
}

async function mergeDuplicateCreatorIntoCanonical({
    targetCreatorId,
    sourceCreatorId,
    reason = 'duplicate_merge',
    operator = null,
}) {
    if (!targetCreatorId || !sourceCreatorId || Number(targetCreatorId) ***REMOVED***= Number(sourceCreatorId)) {
        return { merged: false, targetCreatorId, sourceCreatorId, reason: 'noop' };
    }

    const normalizedOperator = normalizeOperatorName(operator, operator || null);

    return db.getDb().transaction(async (tx) => {
        const target = await tx.prepare('SELECT * FROM creators WHERE id = ? LIMIT 1').get(targetCreatorId);
        const source = await tx.prepare('SELECT * FROM creators WHERE id = ? LIMIT 1').get(sourceCreatorId);
        if (!target || !source) {
            return { merged: false, targetCreatorId, sourceCreatorId, reason: 'creator_missing' };
        }

        if (!isBlank(target.wa_phone) && !isBlank(source.wa_phone) && String(target.wa_phone) !***REMOVED*** String(source.wa_phone)) {
            throw new Error(`merge blocked: conflicting phones target=${target.wa_phone} source=${source.wa_phone}`);
        }

        await moveMessages(tx, sourceCreatorId, targetCreatorId, normalizedOperator || target.wa_owner || source.wa_owner || null);
        await moveAliases(tx, sourceCreatorId, targetCreatorId);
        await mergeOneToOneTable(tx, 'wa_crm_data', WACRM_COLUMNS, sourceCreatorId, targetCreatorId);
        await mergeOneToOneTable(tx, 'keeper_link', KEEPER_COLUMNS, sourceCreatorId, targetCreatorId);
        await mergeOneToOneTable(tx, 'joinbrands_link', JOINBRANDS_COLUMNS, sourceCreatorId, targetCreatorId);
        await moveManualMatches(tx, sourceCreatorId, targetCreatorId);
        await moveEvents(tx, sourceCreatorId, targetCreatorId);
        await moveRoster(tx, sourceCreatorId, targetCreatorId);

        await upsertAliases(tx, targetCreatorId, [source.primary_name], 'legacy_primary_name', 1);
        await upsertAliases(tx, targetCreatorId, [source.wa_phone], 'wa_phone', 1);
        await upsertAliases(tx, targetCreatorId, [source.keeper_username], 'keeper_username', 1);

        const updates = [];
        const values = [];
        const finalPhone = !isBlank(target.wa_phone) ? target.wa_phone : source.wa_phone;
        const finalKeeper = !isBlank(target.keeper_username) ? target.keeper_username : source.keeper_username;
        const finalOwner = normalizeOperatorName(target.wa_owner, target.wa_owner)
            || normalizeOperatorName(source.wa_owner, source.wa_owner)
            || normalizedOperator;

        updates.push('primary_name = ?');
        values.push(choosePrimaryName(target.primary_name, source.primary_name));

        if (!isBlank(finalPhone)) {
            updates.push('wa_phone = ?');
            values.push(finalPhone);
        }
        if (!isBlank(finalKeeper)) {
            updates.push('keeper_username = ?');
            values.push(finalKeeper);
        }
        if (!isBlank(finalOwner)) {
            updates.push('wa_owner = ?');
            values.push(finalOwner);
        }

        updates.push('is_active = 1');
        await tx.prepare('DELETE FROM creators WHERE id = ?').run(sourceCreatorId);
        values.push(targetCreatorId);
        await tx.prepare(`UPDATE creators SET ${updates.join(', ')}, updated_at = NOW() WHERE id = ?`).run(...values);

        return {
            merged: true,
            targetCreatorId,
            sourceCreatorId,
            reason,
            phone: finalPhone || null,
            owner: finalOwner || null,
        };
    });
}

module.exports = {
    mergeDuplicateCreatorIntoCanonical,
};
