const crypto = require('crypto');

const EVENT_DEFINITIONS = Object.freeze({
    trial_7day: { event_type: 'challenge' },
    monthly_challenge: { event_type: 'challenge' },
    agency_bound: { event_type: 'agency' },
    gmv_milestone: { event_type: 'gmv' },
    churned: { event_type: 'termination' },
});

const WACRM_FIELD_PREFIX = 'wa_crm_data.';
const JOINBRANDS_FIELD_PREFIX = 'joinbrands_link.';

function hasOwn(source, field) {
    return Object.prototype.hasOwnProperty.call(source, field) && source[field] !== undefined;
}

function normalizeText(value) {
    return String(value ?? '').trim().toLowerCase();
}

function isTruthyFlag(value) {
    if (value === true) return true;
    if (value === false || value === null || value === undefined || value === '') return false;
    if (typeof value === 'number') return value !== 0;
    const text = normalizeText(value);
    return ['1', 'true', 'yes', 'y', 'on', 'active', 'completed', 'paid', 'joined', 'bound'].includes(text);
}

function isEmptyOrZero(value) {
    if (value === null || value === undefined || value === '') return true;
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric === 0;
}

function isDefaultVideoTarget(value) {
    if (value === null || value === undefined || value === '') return true;
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric === 35;
}

function toSqlDatetime(value = Date.now()) {
    const date = value instanceof Date ? value : new Date(value);
    return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 19).replace('T', ' ') : null;
}

function hashPayload(payload) {
    return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

function createEventRequest(eventKey, {
    status = 'active',
    fields = [],
    meta = {},
    triggerText = '',
} = {}) {
    const definition = EVENT_DEFINITIONS[eventKey];
    if (!definition) return null;
    return {
        event_key: eventKey,
        canonical_event_key: eventKey,
        event_type: definition.event_type,
        status,
        event_state: status,
        fields: [...new Set(fields.filter(Boolean))],
        trigger_text: triggerText || `Manual lifecycle update: ${eventKey}`,
        meta,
    };
}

function mergeEventRequest(requests, request) {
    if (!request) return;
    const existing = requests.get(request.event_key);
    if (!existing) {
        requests.set(request.event_key, request);
        return;
    }
    existing.fields = [...new Set([...(existing.fields || []), ...(request.fields || [])])];
    existing.meta = { ...(existing.meta || {}), ...(request.meta || {}) };
    if (existing.status !== 'completed' && request.status === 'completed') {
        existing.status = 'completed';
        existing.event_state = 'completed';
    }
}

function buildLifecycleEventRequestsFromLegacyPayload(payload = {}) {
    const source = payload && typeof payload === 'object' ? payload : {};
    const requests = new Map();
    const ignoredFields = [];
    const unmappedFields = [];

    const addIgnored = (field) => ignoredFields.push(field);
    const addUnmapped = (field) => unmappedFields.push(field);

    if (hasOwn(source, 'ev_trial_active')) {
        if (isTruthyFlag(source.ev_trial_active)) {
            mergeEventRequest(requests, createEventRequest('trial_7day', {
                status: 'active',
                fields: [`${JOINBRANDS_FIELD_PREFIX}ev_trial_active`, `${JOINBRANDS_FIELD_PREFIX}ev_trial_7day`],
                triggerText: 'Manual update marked 7-day trial active',
            }));
        } else {
            addIgnored(`${JOINBRANDS_FIELD_PREFIX}ev_trial_active`);
        }
    }
    if (hasOwn(source, 'ev_trial_7day')) {
        if (isTruthyFlag(source.ev_trial_7day)) {
            mergeEventRequest(requests, createEventRequest('trial_7day', {
                status: 'active',
                fields: [`${JOINBRANDS_FIELD_PREFIX}ev_trial_7day`],
                triggerText: 'Manual update marked 7-day trial present',
            }));
        } else {
            addIgnored(`${JOINBRANDS_FIELD_PREFIX}ev_trial_7day`);
        }
    }

    if (hasOwn(source, 'beta_status')) {
        const betaStatus = normalizeText(source.beta_status);
        if (['started', 'active', 'trial', 'trial_active', 'joined'].includes(betaStatus)) {
            mergeEventRequest(requests, createEventRequest('trial_7day', {
                status: 'active',
                fields: [`${WACRM_FIELD_PREFIX}beta_status`],
                meta: { beta_status: source.beta_status },
                triggerText: `Manual beta status update: ${source.beta_status}`,
            }));
        } else if (['completed', 'finished', 'trial_completed'].includes(betaStatus)) {
            mergeEventRequest(requests, createEventRequest('trial_7day', {
                status: 'completed',
                fields: [`${WACRM_FIELD_PREFIX}beta_status`],
                meta: { beta_status: source.beta_status },
                triggerText: `Manual beta status update: ${source.beta_status}`,
            }));
        } else if (betaStatus === 'churned') {
            mergeEventRequest(requests, createEventRequest('churned', {
                status: 'active',
                fields: [`${WACRM_FIELD_PREFIX}beta_status`],
                meta: { beta_status: source.beta_status },
                triggerText: 'Manual beta status marked churned',
            }));
        } else if (!betaStatus || betaStatus === 'not_introduced') {
            addIgnored(`${WACRM_FIELD_PREFIX}beta_status`);
        } else {
            addUnmapped(`${WACRM_FIELD_PREFIX}beta_status`);
        }
    }

    if (hasOwn(source, 'ev_monthly_started')) {
        if (isTruthyFlag(source.ev_monthly_started)) {
            mergeEventRequest(requests, createEventRequest('monthly_challenge', {
                status: 'active',
                fields: [`${JOINBRANDS_FIELD_PREFIX}ev_monthly_started`],
                triggerText: 'Manual update marked monthly challenge started',
            }));
        } else {
            addIgnored(`${JOINBRANDS_FIELD_PREFIX}ev_monthly_started`);
        }
    }
    if (hasOwn(source, 'ev_monthly_joined')) {
        if (isTruthyFlag(source.ev_monthly_joined)) {
            mergeEventRequest(requests, createEventRequest('monthly_challenge', {
                status: 'completed',
                fields: [`${JOINBRANDS_FIELD_PREFIX}ev_monthly_joined`],
                triggerText: 'Manual update marked monthly challenge joined',
            }));
        } else {
            addIgnored(`${JOINBRANDS_FIELD_PREFIX}ev_monthly_joined`);
        }
    }
    if (hasOwn(source, 'monthly_fee_status')) {
        const monthlyStatus = normalizeText(source.monthly_fee_status);
        if (['active', 'started', 'joined'].includes(monthlyStatus)) {
            mergeEventRequest(requests, createEventRequest('monthly_challenge', {
                status: 'active',
                fields: [`${WACRM_FIELD_PREFIX}monthly_fee_status`],
                meta: { monthly_fee_status: source.monthly_fee_status },
                triggerText: `Manual monthly fee status update: ${source.monthly_fee_status}`,
            }));
        } else if (['paid', 'deducted', 'completed', 'settled'].includes(monthlyStatus)) {
            mergeEventRequest(requests, createEventRequest('monthly_challenge', {
                status: 'completed',
                fields: [`${WACRM_FIELD_PREFIX}monthly_fee_status`],
                meta: { monthly_fee_status: source.monthly_fee_status },
                triggerText: `Manual monthly fee status update: ${source.monthly_fee_status}`,
            }));
        } else if (!monthlyStatus || ['pending', 'unpaid', 'not_started'].includes(monthlyStatus)) {
            addIgnored(`${WACRM_FIELD_PREFIX}monthly_fee_status`);
        } else {
            addUnmapped(`${WACRM_FIELD_PREFIX}monthly_fee_status`);
        }
    }
    if (hasOwn(source, 'monthly_fee_deducted')) {
        if (isTruthyFlag(source.monthly_fee_deducted)) {
            mergeEventRequest(requests, createEventRequest('monthly_challenge', {
                status: 'completed',
                fields: [`${WACRM_FIELD_PREFIX}monthly_fee_deducted`],
                triggerText: 'Manual update marked monthly fee deducted',
            }));
        } else {
            addIgnored(`${WACRM_FIELD_PREFIX}monthly_fee_deducted`);
        }
    }

    if (hasOwn(source, 'agency_bound')) {
        if (isTruthyFlag(source.agency_bound)) {
            mergeEventRequest(requests, createEventRequest('agency_bound', {
                status: 'active',
                fields: [`${WACRM_FIELD_PREFIX}agency_bound`],
                triggerText: 'Manual update marked agency bound',
            }));
        } else {
            addIgnored(`${WACRM_FIELD_PREFIX}agency_bound`);
        }
    }
    if (hasOwn(source, 'ev_agency_bound')) {
        if (isTruthyFlag(source.ev_agency_bound)) {
            mergeEventRequest(requests, createEventRequest('agency_bound', {
                status: 'active',
                fields: [`${JOINBRANDS_FIELD_PREFIX}ev_agency_bound`],
                triggerText: 'Manual update marked agency bound',
            }));
        } else {
            addIgnored(`${JOINBRANDS_FIELD_PREFIX}ev_agency_bound`);
        }
    }

    if (hasOwn(source, 'ev_churned')) {
        if (isTruthyFlag(source.ev_churned)) {
            mergeEventRequest(requests, createEventRequest('churned', {
                status: 'active',
                fields: [`${JOINBRANDS_FIELD_PREFIX}ev_churned`],
                triggerText: 'Manual update marked creator churned',
            }));
        } else {
            addIgnored(`${JOINBRANDS_FIELD_PREFIX}ev_churned`);
        }
    }

    const gmvFields = [
        ['ev_gmv_1k', 1000],
        ['ev_gmv_2k', 2000],
        ['ev_gmv_5k', 5000],
        ['ev_gmv_10k', 10000],
    ];
    const activeGmvFields = [];
    let threshold = 0;
    for (const [field, value] of gmvFields) {
        if (!hasOwn(source, field)) continue;
        if (isTruthyFlag(source[field])) {
            activeGmvFields.push(`${JOINBRANDS_FIELD_PREFIX}${field}`);
            threshold = Math.max(threshold, value);
        } else {
            addIgnored(`${JOINBRANDS_FIELD_PREFIX}${field}`);
        }
    }
    if (threshold > 0) {
        mergeEventRequest(requests, createEventRequest('gmv_milestone', {
            status: 'completed',
            fields: activeGmvFields,
            meta: { threshold },
            triggerText: `Manual update marked GMV milestone ${threshold}`,
        }));
    }

    const passthroughIgnoredDefaults = [
        ['monthly_fee_amount', isEmptyOrZero],
        ['video_count', isEmptyOrZero],
        ['video_last_checked', isEmptyOrZero],
        ['agency_bound_at', isEmptyOrZero],
        ['agency_deadline', isEmptyOrZero],
        ['beta_cycle_start', isEmptyOrZero],
    ];
    for (const [field, isNoop] of passthroughIgnoredDefaults) {
        if (!hasOwn(source, field)) continue;
        if (isNoop(source[field])) addIgnored(`${WACRM_FIELD_PREFIX}${field}`);
        else addUnmapped(`${WACRM_FIELD_PREFIX}${field}`);
    }
    if (hasOwn(source, 'video_target')) {
        if (isDefaultVideoTarget(source.video_target)) addIgnored(`${WACRM_FIELD_PREFIX}video_target`);
        else addUnmapped(`${WACRM_FIELD_PREFIX}video_target`);
    }
    if (hasOwn(source, 'beta_program_type')) {
        if (!normalizeText(source.beta_program_type)) addIgnored(`${WACRM_FIELD_PREFIX}beta_program_type`);
        else addUnmapped(`${WACRM_FIELD_PREFIX}beta_program_type`);
    }

    for (const field of ['ev_joined', 'ev_ready_sent', 'ev_monthly_invited', 'ev_whatsapp_shared']) {
        if (!hasOwn(source, field)) continue;
        if (isTruthyFlag(source[field])) addUnmapped(`${JOINBRANDS_FIELD_PREFIX}${field}`);
        else addIgnored(`${JOINBRANDS_FIELD_PREFIX}${field}`);
    }

    return {
        eventRequests: [...requests.values()],
        ignoredFields: [...new Set(ignoredFields)],
        unmappedFields: [...new Set(unmappedFields)],
    };
}

function buildEventMeta(request, { actor = null, nowSql = null } = {}) {
    const timestamp = nowSql || toSqlDatetime();
    return {
        ...(request.meta || {}),
        migration_source: 'legacy_wacrm_update',
        requested_fields: request.fields || [],
        evidence_contract: {
            evidence_tier: 2,
            source_kind: 'operator',
        },
        verification: {
            review_status: 'confirmed',
            reviewed_at: timestamp,
            reviewed_by: actor || null,
        },
        lifecycle_overlay: {
            drives_main_stage: true,
        },
    };
}

async function insertEventEvidence(dbConn, eventId, request, { creatorId, rawPayloadHash }) {
    await dbConn.prepare(`
        INSERT INTO event_evidence (
            event_id, source_kind, source_table, source_record_id,
            source_quote, external_system, raw_payload_hash
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
        eventId,
        'operator',
        'wa_crm_data',
        String(creatorId),
        request.trigger_text,
        null,
        rawPayloadHash,
    );
}

async function upsertLifecycleEventFact(dbConn, request, {
    creatorId,
    owner,
    actor = null,
    now = Date.now(),
} = {}) {
    const nowSql = toSqlDatetime(now);
    const meta = buildEventMeta(request, { actor, nowSql });
    const rawPayloadHash = hashPayload({ creatorId, owner, request, actor });
    const existing = await dbConn.prepare(`
        SELECT id, status, meta
        FROM events
        WHERE creator_id = ?
          AND event_key = ?
          AND status IN ('active', 'completed')
        ORDER BY FIELD(status, 'completed', 'active'), id DESC
        LIMIT 1
    `).get(creatorId, request.event_key);

    if (existing) {
        const nextStatus = existing.status === 'completed' ? 'completed' : request.status;
        await dbConn.prepare(`
            UPDATE events
            SET status = ?,
                event_state = ?,
                review_state = 'confirmed',
                evidence_tier = 2,
                source_kind = 'operator',
                source_event_at = COALESCE(source_event_at, ?),
                detected_at = COALESCE(detected_at, ?),
                verified_at = ?,
                verified_by = ?,
                lifecycle_effect = 'stage_signal',
                trigger_source = 'wacrm_update',
                trigger_text = ?,
                meta = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        `).run(
            nextStatus,
            nextStatus,
            nowSql,
            nowSql,
            nowSql,
            actor,
            request.trigger_text,
            JSON.stringify(meta),
            existing.id,
        );
        await insertEventEvidence(dbConn, existing.id, request, { creatorId, rawPayloadHash });
        return { id: existing.id, event_key: request.event_key, status: nextStatus, updated_existing: true };
    }

    const idempotencyKey = `manual_lifecycle:${creatorId}:${request.event_key}:${hashPayload({
        fields: request.fields,
        meta: request.meta,
    }).slice(0, 32)}`;
    const duplicate = await dbConn.prepare('SELECT id, status FROM events WHERE idempotency_key = ? LIMIT 1')
        .get(idempotencyKey);
    if (duplicate) {
        await dbConn.prepare(`
            UPDATE events
            SET status = ?,
                event_state = ?,
                review_state = 'confirmed',
                evidence_tier = 2,
                source_kind = 'operator',
                verified_at = ?,
                verified_by = ?,
                lifecycle_effect = 'stage_signal',
                trigger_source = 'wacrm_update',
                trigger_text = ?,
                meta = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        `).run(
            request.status,
            request.event_state,
            nowSql,
            actor,
            request.trigger_text,
            JSON.stringify(meta),
            duplicate.id,
        );
        await insertEventEvidence(dbConn, duplicate.id, request, { creatorId, rawPayloadHash });
        return { id: duplicate.id, event_key: request.event_key, status: request.status, updated_existing: true };
    }
    const result = await dbConn.prepare(`
        INSERT INTO events (
            creator_id, event_key, canonical_event_key, event_type, owner, status, event_state,
            review_state, evidence_tier, source_kind, source_event_at, detected_at, verified_at,
            verified_by, idempotency_key, lifecycle_effect, trigger_source, trigger_text,
            start_at, meta
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        creatorId,
        request.event_key,
        request.canonical_event_key,
        request.event_type,
        owner,
        request.status,
        request.event_state,
        'confirmed',
        2,
        'operator',
        nowSql,
        nowSql,
        nowSql,
        actor,
        idempotencyKey,
        'stage_signal',
        'wacrm_update',
        request.trigger_text,
        nowSql,
        JSON.stringify(meta),
    );
    const eventId = result.lastInsertRowid;
    await insertEventEvidence(dbConn, eventId, request, { creatorId, rawPayloadHash });
    return { id: eventId, event_key: request.event_key, status: request.status, updated_existing: false };
}

async function writeLifecycleEventFactsFromLegacyPayload(dbConn, {
    creatorId,
    owner,
    payload,
    actor = null,
    now = Date.now(),
} = {}) {
    const plan = buildLifecycleEventRequestsFromLegacyPayload(payload);
    const eventWrites = [];
    for (const request of plan.eventRequests) {
        eventWrites.push(await upsertLifecycleEventFact(dbConn, request, {
            creatorId,
            owner,
            actor,
            now,
        }));
    }
    return {
        ...plan,
        eventWrites,
        updatedFields: eventWrites.map((item) => `events.${item.event_key}`),
    };
}

module.exports = {
    buildLifecycleEventRequestsFromLegacyPayload,
    writeLifecycleEventFactsFromLegacyPayload,
    _private: {
        isTruthyFlag,
        isEmptyOrZero,
        isDefaultVideoTarget,
        toSqlDatetime,
        hashPayload,
    },
};
