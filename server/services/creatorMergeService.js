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
    return value === null || value === undefined || value === '';
}

function shouldCopyValue(sourceValue, targetValue) {
    if (isBlank(sourceValue)) return false;
    if (isBlank(targetValue)) return true;
    if (typeof sourceValue === 'number' && typeof targetValue === 'number') {
        if (targetValue === 0 && sourceValue !== 0) return true;
        return false;
    }
    if ((sourceValue === 1 || sourceValue === true) && (targetValue === 0 || targetValue === false)) {
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

function normalizePhone(value) {
    return String(value || '').replace(/\D/g, '').trim();
}

function unique(values = []) {
    return [...new Set(values.filter(Boolean).map((item) => String(item).trim()).filter(Boolean))];
}

function isMissingTableError(err, tableName) {
    const message = String(err?.message || '').toLowerCase();
    const needle = String(tableName || '').toLowerCase();
    return message.includes("doesn't exist")
        || message.includes('no such table')
        || (needle && message.includes(needle));
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

async function moveLifecycleState(tx, sourceCreatorId, targetCreatorId) {
    try {
        const sourceSnapshot = await tx.prepare('SELECT * FROM creator_lifecycle_snapshot WHERE creator_id = ? LIMIT 1').get(sourceCreatorId);
        const targetSnapshot = await tx.prepare('SELECT * FROM creator_lifecycle_snapshot WHERE creator_id = ? LIMIT 1').get(targetCreatorId);
        if (sourceSnapshot && !targetSnapshot) {
            await tx.prepare('UPDATE creator_lifecycle_snapshot SET creator_id = ? WHERE creator_id = ?').run(targetCreatorId, sourceCreatorId);
        } else if (sourceSnapshot && targetSnapshot) {
            await tx.prepare('DELETE FROM creator_lifecycle_snapshot WHERE creator_id = ?').run(sourceCreatorId);
        }
    } catch (err) {
        if (!isMissingTableError(err, 'creator_lifecycle_snapshot')) throw err;
    }
    try {
        await tx.prepare('UPDATE creator_lifecycle_transition SET creator_id = ? WHERE creator_id = ?').run(targetCreatorId, sourceCreatorId);
    } catch (err) {
        if (!isMissingTableError(err, 'creator_lifecycle_transition')) throw err;
    }
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
        creator?.wa_phone || '',
        ...aliasRows.map((row) => row?.alias_value || ''),
        ...manualMatchRows.map((row) => row?.wa_phone || ''),
    ]);
}

async function mergeClientMemory(tx, sourceClientId, targetClientId) {
    if (!sourceClientId || !targetClientId || sourceClientId === targetClientId) return;
    const sourceRows = await tx.prepare(`
        SELECT memory_type, memory_key, memory_value, source_record_id, confidence
        FROM client_memory
        WHERE client_id = ?
    `).all(sourceClientId);
    for (const row of sourceRows) {
        const existing = await tx.prepare(`
            SELECT id, memory_value, source_record_id, confidence
            FROM client_memory
            WHERE client_id = ? AND memory_type = ? AND memory_key <=> ?
            LIMIT 1
        `).get(targetClientId, row.memory_type, row.memory_key);
        if (!existing) {
            await tx.prepare(`
                INSERT INTO client_memory (client_id, memory_type, memory_key, memory_value, source_record_id, confidence)
                VALUES (?, ?, ?, ?, ?, ?)
            `).run(
                targetClientId,
                row.memory_type,
                row.memory_key,
                row.memory_value,
                row.source_record_id,
                row.confidence,
            );
            continue;
        }
        const nextValue = (!existing.memory_value && row.memory_value) ? row.memory_value : existing.memory_value;
        const nextConfidence = Math.max(Number(existing.confidence || 0), Number(row.confidence || 0));
        const nextSourceRecordId = existing.source_record_id || row.source_record_id || null;
        await tx.prepare(`
            UPDATE client_memory
            SET memory_value = ?, confidence = ?, source_record_id = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        `).run(nextValue, nextConfidence, nextSourceRecordId, existing.id);
    }
    await tx.prepare('DELETE FROM client_memory WHERE client_id = ?').run(sourceClientId);
}

async function mergeClientProfiles(tx, sourceClientId, targetClientId) {
    if (!sourceClientId || !targetClientId || sourceClientId === targetClientId) return;
    const sourceRow = await tx.prepare('SELECT * FROM client_profiles WHERE client_id = ? LIMIT 1').get(sourceClientId);
    if (!sourceRow) return;
    const targetRow = await tx.prepare('SELECT * FROM client_profiles WHERE client_id = ? LIMIT 1').get(targetClientId);
    if (!targetRow) {
        await tx.prepare('UPDATE client_profiles SET client_id = ? WHERE client_id = ?').run(targetClientId, sourceClientId);
        return;
    }

    const updates = [];
    const values = [];
    const candidateColumns = ['summary', 'tags', 'tiktok_data', 'stage', 'last_interaction'];
    for (const column of candidateColumns) {
        if (shouldCopyValue(sourceRow[column], targetRow[column])) {
            updates.push(`${column} = ?`);
            values.push(sourceRow[column]);
        }
    }
    if (updates.length > 0) {
        values.push(targetClientId);
        await tx.prepare(`UPDATE client_profiles SET ${updates.join(', ')}, last_updated = CURRENT_TIMESTAMP WHERE client_id = ?`).run(...values);
    }
    await tx.prepare('DELETE FROM client_profiles WHERE client_id = ?').run(sourceClientId);
}

async function mergeClientTags(tx, sourceClientId, targetClientId) {
    if (!sourceClientId || !targetClientId || sourceClientId === targetClientId) return;
    await tx.prepare(`
        INSERT IGNORE INTO client_tags (client_id, tag, source, confidence, created_at)
        SELECT ?, tag, source, confidence, created_at
        FROM client_tags
        WHERE client_id = ?
    `).run(targetClientId, sourceClientId);
    await tx.prepare('DELETE FROM client_tags WHERE client_id = ?').run(sourceClientId);
}

async function moveClientIdTable(tx, table, sourceClientId, targetClientId) {
    if (!sourceClientId || !targetClientId || sourceClientId === targetClientId) return;
    await tx.prepare(`UPDATE ${table} SET client_id = ? WHERE client_id = ?`).run(targetClientId, sourceClientId);
}

async function mergeClientScopedData(tx, sourceClientIds = [], targetClientId) {
    const sourceList = unique(sourceClientIds).filter((item) => item !== targetClientId);
    for (const sourceClientId of sourceList) {
        await mergeClientMemory(tx, sourceClientId, targetClientId);
        await mergeClientProfiles(tx, sourceClientId, targetClientId);
        await mergeClientTags(tx, sourceClientId, targetClientId);
        await moveClientIdTable(tx, 'generation_log', sourceClientId, targetClientId);
        await moveClientIdTable(tx, 'retrieval_snapshot', sourceClientId, targetClientId);
        await moveClientIdTable(tx, 'sft_feedback', sourceClientId, targetClientId);
    }
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
    allowDistinctPhones = false,
}) {
    if (!targetCreatorId || !sourceCreatorId || Number(targetCreatorId) === Number(sourceCreatorId)) {
        return { merged: false, targetCreatorId, sourceCreatorId, reason: 'noop' };
    }

    const normalizedOperator = normalizeOperatorName(operator, operator || null);

    return db.getDb().transaction(async (tx) => {
        const target = await tx.prepare('SELECT * FROM creators WHERE id = ? LIMIT 1').get(targetCreatorId);
        const source = await tx.prepare('SELECT * FROM creators WHERE id = ? LIMIT 1').get(sourceCreatorId);
        if (!target || !source) {
            return { merged: false, targetCreatorId, sourceCreatorId, reason: 'creator_missing' };
        }

        const targetPhoneNormalized = normalizePhone(target.wa_phone);
        const sourcePhoneNormalized = normalizePhone(source.wa_phone);
        const distinctPhones = targetPhoneNormalized && sourcePhoneNormalized && targetPhoneNormalized !== sourcePhoneNormalized;
        if (distinctPhones && !allowDistinctPhones) {
            throw new Error(`merge blocked: conflicting phones target=${target.wa_phone} source=${source.wa_phone}`);
        }

        const sourceClientIds = await getCreatorClientIds(tx, sourceCreatorId);
        const targetClientIds = await getCreatorClientIds(tx, targetCreatorId);
        const targetClientId = unique([target.wa_phone, ...targetClientIds, source.wa_phone])[0] || '';

        await moveMessages(tx, sourceCreatorId, targetCreatorId, normalizedOperator || target.wa_owner || source.wa_owner || null);
        await moveAliases(tx, sourceCreatorId, targetCreatorId);
        await mergeOneToOneTable(tx, 'wa_crm_data', WACRM_COLUMNS, sourceCreatorId, targetCreatorId);
        await mergeOneToOneTable(tx, 'keeper_link', KEEPER_COLUMNS, sourceCreatorId, targetCreatorId);
        await mergeOneToOneTable(tx, 'joinbrands_link', JOINBRANDS_COLUMNS, sourceCreatorId, targetCreatorId);
        await moveManualMatches(tx, sourceCreatorId, targetCreatorId);
        await moveEvents(tx, sourceCreatorId, targetCreatorId);
        await moveRoster(tx, sourceCreatorId, targetCreatorId);
        await moveLifecycleState(tx, sourceCreatorId, targetCreatorId);
        await mergeClientScopedData(tx, unique([...sourceClientIds, source.wa_phone]), targetClientId);

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
