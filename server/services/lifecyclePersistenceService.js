const db = require('../../db');
const { buildLifecycle } = require('./lifecycleService');
const { fetchCreatorMessageFacts } = require('./creatorMessageFactsService');
const {
    DEFAULT_POLICY_KEY: LIFECYCLE_POLICY_KEY,
    buildDefaultPayload: buildDefaultLifecyclePayload,
    extractPayloadFromRow: extractLifecyclePayloadFromRow,
    toRuntimeOptions,
} = require('./lifecycleConfigService');

function parseJsonSafe(value, fallback = null) {
    if (value === null || value === undefined) return fallback;
    if (typeof value === 'object') return value;
    try {
        return JSON.parse(value);
    } catch (_) {
        return fallback;
    }
}

function toSqlDatetime(value = null) {
    const date = value ? new Date(value) : new Date();
    if (Number.isNaN(date.getTime())) {
        const fallback = new Date();
        return fallback.toISOString().slice(0, 19).replace('T', ' ');
    }
    return date.toISOString().slice(0, 19).replace('T', ' ');
}

function isMissingTableError(err, tableName) {
    const message = String(err?.message || '').toLowerCase();
    const needle = String(tableName || '').toLowerCase();
    return message.includes("doesn't exist")
        || message.includes('no such table')
        || (needle && message.includes(needle));
}

async function getLifecycleRuntimeOptions(dbConn) {
    const fallback = buildDefaultLifecyclePayload();
    try {
        const row = await dbConn.prepare(
            'SELECT policy_key, policy_version, policy_content, applicable_scenarios, is_active, updated_at FROM policy_documents WHERE policy_key = ? LIMIT 1'
        ).get(LIFECYCLE_POLICY_KEY);
        const payload = extractLifecyclePayloadFromRow(row);
        const config = payload?.is_active === 0 ? fallback.config : (payload?.config || fallback.config);
        return toRuntimeOptions(config);
    } catch (err) {
        console.warn('[lifecycle] load config failed, fallback to defaults:', err.message);
        return toRuntimeOptions(fallback.config);
    }
}

async function fetchCreatorFacts(dbConn, creatorId) {
    return await dbConn.prepare(`
        SELECT
            c.id,
            c.primary_name,
            c.wa_phone,
            c.wa_owner,
            c.source,
            c.is_active,
            c.created_at,
            c.updated_at,
            k.keeper_gmv,
            k.keeper_gmv30,
            k.keeper_orders,
            wc.priority,
            wc.beta_status,
            wc.beta_program_type,
            wc.monthly_fee_status,
            wc.monthly_fee_deducted,
            wc.agency_bound,
            wc.next_action,
            wc.video_count,
            wc.video_target,
            j.ev_joined,
            j.ev_ready_sent,
            j.ev_trial_7day,
            j.ev_trial_active,
            j.ev_monthly_invited,
            j.ev_monthly_started,
            j.ev_monthly_joined,
            j.ev_whatsapp_shared,
            j.ev_gmv_1k,
            j.ev_gmv_2k,
            j.ev_gmv_5k,
            j.ev_gmv_10k,
            j.ev_agency_bound,
            j.ev_churned
        FROM creators c
        LEFT JOIN keeper_link k ON k.creator_id = c.id
        LEFT JOIN wa_crm_data wc ON wc.creator_id = c.id
        LEFT JOIN joinbrands_link j ON j.creator_id = c.id
        WHERE c.id = ?
        LIMIT 1
    `).get(creatorId);
}

async function fetchLifecycleEvents(dbConn, creatorId, statuses = ['active', 'completed']) {
    const safeStatuses = Array.isArray(statuses) && statuses.length > 0 ? statuses : ['active', 'completed'];
    const placeholders = safeStatuses.map(() => '?').join(', ');
    const rows = await dbConn.prepare(`
        SELECT id, creator_id, event_key, event_type, owner, status, trigger_source, trigger_text, start_at, end_at, created_at, updated_at, meta
        FROM events
        WHERE creator_id = ?
          AND status IN (${placeholders})
        ORDER BY created_at DESC, id DESC
    `).all(creatorId, ...safeStatuses);

    return rows.map((row) => ({
        ...row,
        meta: parseJsonSafe(row.meta, null),
    }));
}

function toLifecycleInput(source = {}, events = []) {
    return {
        ...source,
        message_facts: source.message_facts || null,
        wacrm: {
            priority: source.priority,
            beta_status: source.beta_status,
            beta_program_type: source.beta_program_type,
            monthly_fee_status: source.monthly_fee_status,
            monthly_fee_deducted: source.monthly_fee_deducted,
            agency_bound: source.agency_bound,
            next_action: source.next_action,
            video_count: source.video_count,
            video_target: source.video_target,
        },
        joinbrands: {
            ev_joined: source.ev_joined,
            ev_ready_sent: source.ev_ready_sent,
            ev_trial_7day: source.ev_trial_7day,
            ev_trial_active: source.ev_trial_active,
            ev_monthly_invited: source.ev_monthly_invited,
            ev_monthly_started: source.ev_monthly_started,
            ev_monthly_joined: source.ev_monthly_joined,
            ev_whatsapp_shared: source.ev_whatsapp_shared,
            ev_gmv_1k: source.ev_gmv_1k,
            ev_gmv_2k: source.ev_gmv_2k,
            ev_gmv_5k: source.ev_gmv_5k,
            ev_gmv_10k: source.ev_gmv_10k,
            ev_agency_bound: source.ev_agency_bound,
            ev_churned: source.ev_churned,
        },
        keeper: {
            keeper_gmv: source.keeper_gmv,
            keeper_gmv30: source.keeper_gmv30,
            keeper_orders: source.keeper_orders,
        },
        events,
    };
}

async function evaluateCreatorLifecycle(dbConn, creatorId) {
    const [creator, events, lifecycleOptions] = await Promise.all([
        fetchCreatorFacts(dbConn, creatorId),
        fetchLifecycleEvents(dbConn, creatorId),
        getLifecycleRuntimeOptions(dbConn),
    ]);
    if (!creator) return null;

    const messageFacts = await fetchCreatorMessageFacts(dbConn, creator);
    const creatorWithFacts = {
        ...creator,
        message_facts: messageFacts,
    };

    const lifecycle = buildLifecycle(toLifecycleInput(creatorWithFacts, events), lifecycleOptions);
    return {
        creator: creatorWithFacts,
        events,
        lifecycle,
        lifecycleOptions,
    };
}

async function getLifecycleSnapshotRecord(dbConn, creatorId) {
    let row = null;
    try {
        row = await dbConn.prepare(`
            SELECT
                creator_id,
                stage_key,
                stage_label,
                entry_reason,
                entry_signals_json,
                flags_json,
                conflicts_json,
                option0_key,
                option0_label,
                option0_next_action,
                snapshot_version,
                trigger_type,
                trigger_id,
                evaluated_at,
                created_at,
                updated_at
            FROM creator_lifecycle_snapshot
            WHERE creator_id = ?
            LIMIT 1
        `).get(creatorId);
    } catch (err) {
        if (isMissingTableError(err, 'creator_lifecycle_snapshot')) return null;
        throw err;
    }
    if (!row) return null;

    return {
        ...row,
        entry_signals: parseJsonSafe(row.entry_signals_json, []),
        flags: parseJsonSafe(row.flags_json, {}),
        conflicts: parseJsonSafe(row.conflicts_json, []),
    };
}

async function upsertLifecycleSnapshot(dbConn, creatorId, lifecycle, trigger = {}) {
    try {
        await dbConn.prepare(`
            INSERT INTO creator_lifecycle_snapshot (
                creator_id,
                stage_key,
                stage_label,
                entry_reason,
                entry_signals_json,
                flags_json,
                conflicts_json,
                option0_key,
                option0_label,
                option0_next_action,
                snapshot_version,
                trigger_type,
                trigger_id,
                evaluated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
                stage_key = VALUES(stage_key),
                stage_label = VALUES(stage_label),
                entry_reason = VALUES(entry_reason),
                entry_signals_json = VALUES(entry_signals_json),
                flags_json = VALUES(flags_json),
                conflicts_json = VALUES(conflicts_json),
                option0_key = VALUES(option0_key),
                option0_label = VALUES(option0_label),
                option0_next_action = VALUES(option0_next_action),
                snapshot_version = VALUES(snapshot_version),
                trigger_type = VALUES(trigger_type),
                trigger_id = VALUES(trigger_id),
                evaluated_at = VALUES(evaluated_at),
                updated_at = CURRENT_TIMESTAMP
        `).run(
            creatorId,
            lifecycle.stage_key,
            lifecycle.stage_label,
            lifecycle.entry_reason || null,
            JSON.stringify(lifecycle.entry_signals || []),
            JSON.stringify(lifecycle.flags || {}),
            JSON.stringify(lifecycle.conflicts || []),
            lifecycle.option0?.key || null,
            lifecycle.option0?.label || null,
            lifecycle.option0?.next_action_template || null,
            lifecycle.snapshot_version || 'lifecycle_v2',
            trigger.triggerType || null,
            trigger.triggerId == null ? null : String(trigger.triggerId),
            toSqlDatetime(lifecycle.evaluated_at),
        );

        return getLifecycleSnapshotRecord(dbConn, creatorId);
    } catch (err) {
        if (!isMissingTableError(err, 'creator_lifecycle_snapshot')) throw err;
        return {
            creator_id: creatorId,
            stage_key: lifecycle.stage_key,
            stage_label: lifecycle.stage_label,
            entry_reason: lifecycle.entry_reason || null,
            entry_signals: lifecycle.entry_signals || [],
            flags: lifecycle.flags || {},
            conflicts: lifecycle.conflicts || [],
            option0_key: lifecycle.option0?.key || null,
            option0_label: lifecycle.option0?.label || null,
            option0_next_action: lifecycle.option0?.next_action_template || null,
            snapshot_version: lifecycle.snapshot_version || 'lifecycle_v2',
            trigger_type: trigger.triggerType || null,
            trigger_id: trigger.triggerId == null ? null : String(trigger.triggerId),
            evaluated_at: toSqlDatetime(lifecycle.evaluated_at),
            created_at: null,
            updated_at: null,
        };
    }
}

async function appendLifecycleTransition(dbConn, creatorId, beforeSnapshot, afterSnapshot, trigger = {}) {
    try {
        await dbConn.prepare(`
            INSERT INTO creator_lifecycle_transition (
                creator_id,
                from_stage,
                to_stage,
                trigger_type,
                trigger_id,
                trigger_source,
                reason,
                signals_json,
                flags_json,
                operator
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            creatorId,
            beforeSnapshot?.stage_key || null,
            afterSnapshot?.stage_key || null,
            trigger.triggerType || null,
            trigger.triggerId == null ? null : String(trigger.triggerId),
            trigger.triggerSource || null,
            afterSnapshot?.entry_reason || null,
            JSON.stringify(afterSnapshot?.entry_signals || []),
            JSON.stringify(afterSnapshot?.flags || {}),
            trigger.operator || null,
        );
    } catch (err) {
        if (!isMissingTableError(err, 'creator_lifecycle_transition')) throw err;
    }
}

async function persistLifecycleForCreator(dbConn, creatorId, trigger = {}) {
    const beforeSnapshot = await getLifecycleSnapshotRecord(dbConn, creatorId);
    const evaluated = await evaluateCreatorLifecycle(dbConn, creatorId);
    if (!evaluated) return null;

    const afterSnapshot = trigger.writeSnapshot === false
        ? {
            creator_id: creatorId,
            stage_key: evaluated.lifecycle.stage_key,
            stage_label: evaluated.lifecycle.stage_label,
            entry_reason: evaluated.lifecycle.entry_reason,
            entry_signals: evaluated.lifecycle.entry_signals || [],
            flags: evaluated.lifecycle.flags || {},
            conflicts: evaluated.lifecycle.conflicts || [],
            option0_key: evaluated.lifecycle.option0?.key || null,
            option0_label: evaluated.lifecycle.option0?.label || null,
            option0_next_action: evaluated.lifecycle.option0?.next_action_template || null,
            snapshot_version: evaluated.lifecycle.snapshot_version || 'lifecycle_v2',
            evaluated_at: toSqlDatetime(evaluated.lifecycle.evaluated_at),
        }
        : await upsertLifecycleSnapshot(dbConn, creatorId, evaluated.lifecycle, trigger);

    const lifecycleChanged = (beforeSnapshot?.stage_key || null) !== (afterSnapshot?.stage_key || null);
    if (lifecycleChanged && trigger.writeTransition !== false) {
        await appendLifecycleTransition(dbConn, creatorId, beforeSnapshot, afterSnapshot, trigger);
    }

    return {
        creator: evaluated.creator,
        events: evaluated.events,
        lifecycle: evaluated.lifecycle,
        beforeSnapshot,
        afterSnapshot,
        lifecycleChanged,
    };
}

async function listLifecycleTransitions(dbConn, creatorId, limit = 30) {
    const safeLimit = Math.max(1, Math.min(Number(limit) || 30, 120));
    try {
        return await dbConn.prepare(`
            SELECT
                id,
                creator_id,
                from_stage,
                to_stage,
                trigger_type,
                trigger_id,
                trigger_source,
                reason,
                signals_json,
                flags_json,
                operator,
                created_at
            FROM creator_lifecycle_transition
            WHERE creator_id = ?
            ORDER BY created_at DESC, id DESC
            LIMIT ${safeLimit}
        `).all(creatorId);
    } catch (err) {
        if (isMissingTableError(err, 'creator_lifecycle_transition')) return [];
        throw err;
    }
}

async function rebuildLifecycleBatch(dbConn, options = {}) {
    const creatorIds = Array.isArray(options.creatorIds) && options.creatorIds.length > 0
        ? options.creatorIds.map((item) => Number(item)).filter((item) => Number.isFinite(item) && item > 0)
        : [];
    const rows = creatorIds.length > 0
        ? await dbConn.prepare(
            `SELECT id FROM creators WHERE id IN (${creatorIds.map(() => '?').join(', ')}) ORDER BY id ASC`
        ).all(...creatorIds)
        : await dbConn.prepare('SELECT id FROM creators ORDER BY id ASC').all();

    const results = [];
    for (const row of rows) {
        const ret = await persistLifecycleForCreator(dbConn, Number(row.id), {
            triggerType: options.reason || 'manual_rebuild',
            triggerId: options.reason || null,
            triggerSource: 'lifecycle_rebuild',
            operator: options.operator || null,
            writeSnapshot: options.writeSnapshot !== false,
            writeTransition: options.writeTransition !== false,
        });
        if (ret) {
            results.push({
                creator_id: Number(row.id),
                stage_key: ret.lifecycle.stage_key,
                lifecycle_changed: ret.lifecycleChanged,
            });
        }
    }

    return results;
}

module.exports = {
    parseJsonSafe,
    toSqlDatetime,
    getLifecycleRuntimeOptions,
    fetchCreatorFacts,
    fetchLifecycleEvents,
    evaluateCreatorLifecycle,
    getLifecycleSnapshotRecord,
    persistLifecycleForCreator,
    listLifecycleTransitions,
    rebuildLifecycleBatch,
};
