const {
    canEventDriveLifecycle,
    normalizeLifecycleEventRow,
    parseEventMeta,
} = require('./eventLifecycleFacts');

function parseJsonSafe(value, fallback = null) {
    if (value === null || value === undefined || value === '') return fallback;
    if (typeof value === 'object') return value;
    try {
        const parsed = JSON.parse(value);
        return parsed === undefined || parsed === null ? fallback : parsed;
    } catch (_) {
        return fallback;
    }
}

function isMissingSnapshotTableError(err) {
    const message = String(err?.message || '').toLowerCase();
    return message.includes('creator_event_snapshot')
        || message.includes("doesn't exist")
        || message.includes('no such table');
}

function buildCompatFlags(events = []) {
    const flags = {
        ev_trial_7day: false,
        ev_trial_active: false,
        ev_monthly_invited: false,
        ev_monthly_started: false,
        ev_monthly_joined: false,
        ev_whatsapp_shared: false,
        ev_gmv_1k: false,
        ev_gmv_2k: false,
        ev_gmv_5k: false,
        ev_gmv_10k: false,
        ev_agency_bound: false,
        ev_churned: false,
    };

    for (const rawEvent of events || []) {
        const event = normalizeLifecycleEventRow(rawEvent);
        const key = event.event_key || event.canonical_event_key;
        const status = event.status;
        const meta = parseEventMeta(event.meta, {});

        if (key === 'trial_7day') {
            flags.ev_trial_7day = true;
            if (status === 'active') flags.ev_trial_active = true;
        }
        if (key === 'monthly_challenge') {
            flags.ev_monthly_started = true;
            if (status === 'completed') flags.ev_monthly_joined = true;
        }
        if (key === 'agency_bound') flags.ev_agency_bound = true;
        if (['churned', 'do_not_contact', 'opt_out'].includes(key)) flags.ev_churned = true;
        if (key === 'gmv_milestone') {
            const threshold = Number(meta?.threshold || meta?.current_gmv || meta?.claimed_gmv || 0);
            flags.ev_gmv_1k = flags.ev_gmv_1k || threshold >= 1000;
            flags.ev_gmv_2k = flags.ev_gmv_2k || threshold >= 2000 || threshold === 0;
            flags.ev_gmv_5k = flags.ev_gmv_5k || threshold >= 5000;
            flags.ev_gmv_10k = flags.ev_gmv_10k || threshold >= 10000;
        }
    }

    return flags;
}

function collectOverlayFlags(events = []) {
    const overlays = new Set();
    for (const rawEvent of events || []) {
        const event = normalizeLifecycleEventRow(rawEvent);
        const meta = parseEventMeta(event.meta, {});
        (meta?.lifecycle_overlay?.overlays || []).forEach((overlay) => overlays.add(overlay));
        if ((event.event_key || event.canonical_event_key) === 'referral') overlays.add('referral_active');
    }
    return [...overlays];
}

function toSqlDatetime(value = null) {
    if (!value) return null;
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value.trim())) {
        return value.trim();
    }
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 19).replace('T', ' ') : null;
}

function normalizeSnapshotRow(row = null) {
    if (!row) return null;
    return {
        creator_id: Number(row.creator_id || 0) || row.creator_id,
        active_event_keys: parseJsonSafe(row.active_event_keys_json, []),
        overlay_flags: parseJsonSafe(row.overlay_flags_json, []),
        compat_ev_flags: parseJsonSafe(row.compat_ev_flags_json, {}),
        latest_event_at: row.latest_event_at || null,
        rebuilt_at: row.rebuilt_at || null,
    };
}

async function fetchCreatorEventSnapshotsMap(dbConn, creatorIds = []) {
    const ids = [...new Set((creatorIds || []).map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0))];
    if (ids.length === 0) return new Map();
    try {
        const rows = await dbConn.prepare(`
            SELECT creator_id, active_event_keys_json, overlay_flags_json, compat_ev_flags_json, latest_event_at, rebuilt_at
            FROM creator_event_snapshot
            WHERE creator_id IN (${ids.map(() => '?').join(', ')})
        `).all(...ids);
        return new Map((rows || []).map((row) => [Number(row.creator_id), normalizeSnapshotRow(row)]));
    } catch (err) {
        if (isMissingSnapshotTableError(err)) return new Map();
        throw err;
    }
}

async function rebuildCreatorEventSnapshot(dbConn, creatorId) {
    const numericCreatorId = Number(creatorId);
    if (!Number.isFinite(numericCreatorId) || numericCreatorId <= 0) return null;

    const rows = await dbConn.prepare(`
        SELECT id, creator_id, event_key, event_type, owner, status, event_state, trigger_source,
               trigger_text, start_at, end_at, created_at, updated_at, meta, canonical_event_key,
               review_state, evidence_tier, source_kind, source_event_at, detected_at, lifecycle_effect
        FROM events
        WHERE creator_id = ?
          AND status IN ('active', 'completed')
        ORDER BY COALESCE(source_event_at, start_at, created_at) DESC, id DESC
    `).all(numericCreatorId);

    const lifecycleEvents = (rows || [])
        .map((row) => normalizeLifecycleEventRow(row))
        .filter((row) => canEventDriveLifecycle(row));
    const activeKeys = [...new Set(lifecycleEvents.map((event) => event.event_key || event.canonical_event_key).filter(Boolean))];
    const overlays = collectOverlayFlags(lifecycleEvents);
    const compatFlags = buildCompatFlags(lifecycleEvents);
    const latestEventAt = lifecycleEvents[0]
        ? toSqlDatetime(lifecycleEvents[0].source_event_at || lifecycleEvents[0].start_at || lifecycleEvents[0].created_at)
        : null;

    try {
        await dbConn.prepare(`
            INSERT INTO creator_event_snapshot (
                creator_id, active_event_keys_json, overlay_flags_json, compat_ev_flags_json, latest_event_at, rebuilt_at
            ) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            ON DUPLICATE KEY UPDATE
                active_event_keys_json = VALUES(active_event_keys_json),
                overlay_flags_json = VALUES(overlay_flags_json),
                compat_ev_flags_json = VALUES(compat_ev_flags_json),
                latest_event_at = VALUES(latest_event_at),
                rebuilt_at = CURRENT_TIMESTAMP
        `).run(
            numericCreatorId,
            JSON.stringify(activeKeys),
            JSON.stringify(overlays),
            JSON.stringify(compatFlags),
            latestEventAt,
        );
    } catch (err) {
        if (isMissingSnapshotTableError(err)) return null;
        throw err;
    }

    return {
        creator_id: numericCreatorId,
        active_event_keys: activeKeys,
        overlay_flags: overlays,
        compat_ev_flags: compatFlags,
        latest_event_at: latestEventAt,
        rebuilt_at: new Date().toISOString(),
    };
}

module.exports = {
    buildCompatFlags,
    collectOverlayFlags,
    fetchCreatorEventSnapshotsMap,
    normalizeSnapshotRow,
    rebuildCreatorEventSnapshot,
};
