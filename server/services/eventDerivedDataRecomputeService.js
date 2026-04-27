const {
    tableExists,
    columnExists,
} = require('./schemaReadinessGuard');
const {
    rebuildCreatorEventSnapshot,
} = require('./creatorEventSnapshotService');
const {
    persistLifecycleForCreator,
} = require('./lifecyclePersistenceService');

const REQUIRED_TABLES = [
    'creators',
    'events',
    'keeper_link',
    'wa_crm_data',
    'joinbrands_link',
    'creator_event_snapshot',
    'creator_lifecycle_snapshot',
];

const REQUIRED_COLUMNS = {
    creators: [
        'id',
        'primary_name',
        'wa_phone',
        'wa_owner',
        'source',
        'is_active',
        'created_at',
        'updated_at',
    ],
    keeper_link: [
        'creator_id',
        'keeper_gmv',
        'keeper_gmv30',
        'keeper_orders',
    ],
    wa_crm_data: [
        'creator_id',
        'priority',
        'beta_status',
        'beta_program_type',
        'monthly_fee_status',
        'monthly_fee_deducted',
        'agency_bound',
        'next_action',
        'video_count',
        'video_target',
    ],
    joinbrands_link: [
        'creator_id',
        'ev_joined',
        'ev_ready_sent',
        'ev_trial_7day',
        'ev_trial_active',
        'ev_monthly_invited',
        'ev_monthly_started',
        'ev_monthly_joined',
        'ev_whatsapp_shared',
        'ev_gmv_1k',
        'ev_gmv_2k',
        'ev_gmv_5k',
        'ev_gmv_10k',
        'ev_agency_bound',
        'ev_churned',
    ],
    events: [
        'creator_id',
        'event_key',
        'event_type',
        'owner',
        'status',
        'event_state',
        'canonical_event_key',
        'review_state',
        'evidence_tier',
        'source_kind',
        'source_event_at',
        'detected_at',
        'lifecycle_effect',
        'trigger_source',
        'trigger_text',
        'start_at',
        'end_at',
        'meta',
        'created_at',
        'updated_at',
    ],
    creator_event_snapshot: [
        'creator_id',
        'active_event_keys_json',
        'overlay_flags_json',
        'compat_ev_flags_json',
        'latest_event_at',
        'rebuilt_at',
    ],
    creator_lifecycle_snapshot: [
        'creator_id',
        'stage_key',
        'stage_label',
        'entry_reason',
        'entry_signals_json',
        'flags_json',
        'conflicts_json',
        'option0_key',
        'option0_label',
        'option0_next_action',
        'snapshot_version',
        'trigger_type',
        'trigger_id',
        'evaluated_at',
        'updated_at',
    ],
};

function envFlagEnabled(name, fallback = true) {
    const raw = process.env[name];
    if (raw === undefined || raw === null || raw === '') return fallback;
    return !['0', 'false', 'no', 'off'].includes(String(raw).trim().toLowerCase());
}

function parsePositiveInt(value, fallback, { min = 1, max = 10000 } = {}) {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, Math.trunc(n)));
}

async function inspectEventDerivedSchema(dbConn) {
    const missing = [];
    for (const tableName of REQUIRED_TABLES) {
        if (!(await tableExists(dbConn, tableName))) {
            missing.push(tableName);
        }
    }

    for (const [tableName, columns] of Object.entries(REQUIRED_COLUMNS)) {
        if (missing.includes(tableName)) continue;
        for (const columnName of columns) {
            if (!(await columnExists(dbConn, tableName, columnName))) {
                missing.push(`${tableName}.${columnName}`);
            }
        }
    }

    return {
        ok: missing.length === 0,
        missing,
    };
}

async function listCreatorBatch(dbConn, afterId, limit) {
    return await dbConn.prepare(`
        SELECT id
        FROM creators
        WHERE id > ?
        ORDER BY id ASC
        LIMIT ${limit}
    `).all(afterId);
}

async function recomputeEventDerivedData(dbConn, options = {}) {
    const logger = options.logger || console;
    const batchSize = parsePositiveInt(
        options.batchSize ?? process.env.STARTUP_EVENT_RECOMPUTE_BATCH_SIZE,
        50,
        { min: 1, max: 500 },
    );
    const maxCreatorsRaw = options.maxCreators ?? process.env.STARTUP_EVENT_RECOMPUTE_MAX_CREATORS;
    const maxCreators = maxCreatorsRaw === undefined || maxCreatorsRaw === null || maxCreatorsRaw === ''
        ? 0
        : parsePositiveInt(maxCreatorsRaw, 0, { min: 0, max: 1000000 });
    const reason = options.reason || 'startup_event_derived_data_recompute';
    const schema = await inspectEventDerivedSchema(dbConn);
    if (!schema.ok) {
        logger.warn?.(
            `[Startup][EventDerivedData] skip recompute: schema missing ${schema.missing.join(', ')}; run lifecycle migration plus SQL migrations 004-010 first`,
        );
        return {
            ok: true,
            skipped: true,
            reason: 'schema_not_ready',
            missing: schema.missing,
        };
    }

    const startedAt = Date.now();
    let afterId = 0;
    let processed = 0;
    let snapshotRebuilt = 0;
    let lifecycleRebuilt = 0;
    const errors = [];

    while (true) {
        if (maxCreators > 0 && processed >= maxCreators) break;
        const remaining = maxCreators > 0 ? Math.max(0, maxCreators - processed) : batchSize;
        const rows = await listCreatorBatch(dbConn, afterId, Math.min(batchSize, remaining || batchSize));
        if (rows.length === 0) break;

        for (const row of rows) {
            const creatorId = Number(row.id);
            afterId = Math.max(afterId, creatorId);
            if (!Number.isFinite(creatorId) || creatorId <= 0) continue;
            try {
                const snapshot = await rebuildCreatorEventSnapshot(dbConn, creatorId);
                if (snapshot) snapshotRebuilt += 1;
                const lifecycle = await persistLifecycleForCreator(dbConn, creatorId, {
                    triggerType: reason,
                    triggerId: reason,
                    triggerSource: 'startup',
                    operator: 'system',
                    writeSnapshot: true,
                    writeTransition: false,
                });
                if (lifecycle) lifecycleRebuilt += 1;
            } catch (err) {
                errors.push({
                    creator_id: creatorId,
                    error: err.message,
                });
                logger.warn?.(`[Startup][EventDerivedData] creator ${creatorId} recompute failed: ${err.message}`);
            }
            processed += 1;
            if (maxCreators > 0 && processed >= maxCreators) break;
        }
    }

    const result = {
        ok: errors.length === 0,
        skipped: false,
        processed,
        snapshot_rebuilt: snapshotRebuilt,
        lifecycle_rebuilt: lifecycleRebuilt,
        errors,
        duration_ms: Date.now() - startedAt,
    };
    if (errors.length > 0) {
        logger.warn?.(`[Startup][EventDerivedData] recompute finished with ${errors.length} error(s): processed=${processed}`);
    } else {
        logger.log?.(`[Startup][EventDerivedData] recompute done: processed=${processed}, snapshots=${snapshotRebuilt}, lifecycles=${lifecycleRebuilt}, duration_ms=${result.duration_ms}`);
    }
    return result;
}

function startStartupEventDerivedDataRecompute(dbConn, options = {}) {
    if (!envFlagEnabled('STARTUP_EVENT_RECOMPUTE_ENABLED', true)) {
        console.log('[Startup][EventDerivedData] disabled by STARTUP_EVENT_RECOMPUTE_ENABLED');
        return false;
    }
    setImmediate(() => {
        recomputeEventDerivedData(dbConn, {
            reason: 'startup_event_derived_data_recompute',
            ...options,
        }).catch((err) => {
            console.warn('[Startup][EventDerivedData] recompute failed:', err.message);
        });
    });
    return true;
}

module.exports = {
    inspectEventDerivedSchema,
    recomputeEventDerivedData,
    startStartupEventDerivedDataRecompute,
    _private: {
        envFlagEnabled,
        parsePositiveInt,
    },
};
