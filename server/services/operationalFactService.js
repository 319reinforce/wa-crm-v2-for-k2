const { assertManagedSchemaReady, tableExists, columnExists } = require('./schemaReadinessGuard');

const MIGRATION_PATH = 'server/migrations/011_billing_progress_deadline_retention.sql';
const WACRM_PREFIX = 'wa_crm_data.';

const OPERATIONAL_WACRM_FIELDS = Object.freeze([
    'monthly_fee_amount',
    'video_count',
    'video_target',
    'video_last_checked',
    'agency_deadline',
]);

const REQUIRED_TABLES = [
    'event_billing_facts',
    'event_progress_facts',
    'event_deadline_facts',
];

const REQUIRED_COLUMNS = {
    event_billing_facts: [
        'id', 'creator_id', 'event_id', 'event_key', 'billing_key', 'amount',
        'currency', 'billing_status', 'effective_at', 'source_kind',
        'source_record_id', 'meta_json', 'created_at', 'updated_at',
    ],
    event_progress_facts: [
        'id', 'creator_id', 'event_id', 'event_key', 'progress_key',
        'period_start', 'period_end', 'video_count', 'video_target',
        'last_checked_at', 'observed_at', 'source_kind', 'source_record_id',
        'meta_json', 'created_at', 'updated_at',
    ],
    event_deadline_facts: [
        'id', 'creator_id', 'event_id', 'event_key', 'deadline_key',
        'deadline_at', 'status', 'source_kind', 'source_record_id',
        'meta_json', 'created_at', 'updated_at',
    ],
};

let writeSchemaReady = false;

function hasOwn(source, field) {
    return Object.prototype.hasOwnProperty.call(source || {}, field) && source[field] !== undefined;
}

function isBlank(value) {
    return value === null || value === undefined || String(value).trim() === '';
}

function toNumberOrNull(value) {
    if (isBlank(value)) return null;
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
}

function toIntOrNull(value) {
    const numeric = toNumberOrNull(value);
    return numeric === null ? null : Math.trunc(numeric);
}

function toTimestampMs(value) {
    if (value === null || value === undefined || value === '') return 0;
    if (value instanceof Date) {
        const ms = value.getTime();
        return Number.isFinite(ms) ? ms : 0;
    }
    const raw = String(value).trim();
    if (!raw) return 0;

    const compactDate = raw.match(/^(\d{4})(\d{2})(\d{2})$/);
    if (compactDate) {
        const date = new Date(`${compactDate[1]}-${compactDate[2]}-${compactDate[3]}T00:00:00+08:00`);
        return Number.isFinite(date.getTime()) ? date.getTime() : 0;
    }

    const numeric = Number(raw);
    if (Number.isFinite(numeric) && numeric > 0) {
        if (numeric > 1e12) return Math.floor(numeric);
        if (numeric > 1e9) return Math.floor(numeric * 1000);
    }

    const parsed = new Date(raw).getTime();
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function toSqlDatetime(value = Date.now()) {
    const ms = toTimestampMs(value);
    if (!ms) return null;
    return new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
}

function fromSqlDatetimeToMs(value) {
    return toTimestampMs(value) || null;
}

function parseJson(value, fallback = null) {
    if (value === null || value === undefined) return fallback;
    if (typeof value === 'object') return value;
    try {
        return JSON.parse(value);
    } catch (_) {
        return fallback;
    }
}

function normalizeStatus(value) {
    const text = String(value || '').trim().toLowerCase();
    return text || null;
}

function buildMeta({
    creatorId,
    owner = null,
    actor = null,
    requestedFields = [],
    payload = {},
} = {}) {
    const sourcePayload = {};
    for (const field of OPERATIONAL_WACRM_FIELDS) {
        if (hasOwn(payload, field)) sourcePayload[field] = payload[field];
    }
    if (hasOwn(payload, 'monthly_fee_status')) sourcePayload.monthly_fee_status = payload.monthly_fee_status;
    return {
        migration_source: 'legacy_wacrm_operational_fact',
        source_table: 'wa_crm_data',
        source_record_id: String(creatorId),
        requested_fields: [...new Set(requestedFields)],
        owner: owner || null,
        actor: actor || null,
        source_payload: sourcePayload,
    };
}

async function inspectOperationalFactSchema(dbConn) {
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

async function ensureOperationalFactSchema(dbConn) {
    if (writeSchemaReady) return;
    await assertManagedSchemaReady(dbConn, {
        feature: 'Operational fact',
        migration: MIGRATION_PATH,
        tables: REQUIRED_TABLES,
        columns: REQUIRED_COLUMNS,
    });
    writeSchemaReady = true;
}

function buildOperationalFactRequestsFromLegacyPayload(payload = {}) {
    const source = payload && typeof payload === 'object' ? payload : {};
    const handledFields = [];
    const requests = [];

    const markHandled = (field) => {
        if (hasOwn(source, field)) handledFields.push(`${WACRM_PREFIX}${field}`);
    };

    if (hasOwn(source, 'monthly_fee_amount')) {
        markHandled('monthly_fee_amount');
        const amount = toNumberOrNull(source.monthly_fee_amount);
        requests.push({
            kind: 'billing',
            event_key: 'monthly_challenge',
            billing_key: 'monthly_fee',
            amount,
            currency: 'USD',
            billing_status: normalizeStatus(source.monthly_fee_status),
            effective_at: toSqlDatetime(Date.now()),
            requested_fields: [`${WACRM_PREFIX}monthly_fee_amount`],
        });
    }

    const progressFields = ['video_count', 'video_target', 'video_last_checked'];
    const hasProgress = progressFields.some((field) => hasOwn(source, field));
    if (hasProgress) {
        for (const field of progressFields) markHandled(field);
        const lastCheckedAt = toSqlDatetime(source.video_last_checked);
        requests.push({
            kind: 'progress',
            event_key: 'monthly_challenge',
            progress_key: 'video_progress',
            video_count: hasOwn(source, 'video_count') ? toIntOrNull(source.video_count) : null,
            video_target: hasOwn(source, 'video_target') ? toIntOrNull(source.video_target) : null,
            last_checked_at: lastCheckedAt,
            observed_at: lastCheckedAt || toSqlDatetime(Date.now()),
            requested_fields: progressFields
                .filter((field) => hasOwn(source, field))
                .map((field) => `${WACRM_PREFIX}${field}`),
        });
    }

    if (hasOwn(source, 'agency_deadline')) {
        markHandled('agency_deadline');
        const deadlineAt = toSqlDatetime(source.agency_deadline);
        requests.push({
            kind: 'deadline',
            event_key: 'agency_bound',
            deadline_key: 'agency_deadline',
            deadline_at: deadlineAt,
            status: deadlineAt ? 'active' : 'cleared',
            requested_fields: [`${WACRM_PREFIX}agency_deadline`],
        });
    }

    return {
        requests,
        handledFields: [...new Set(handledFields)],
    };
}

async function resolveLatestEventId(dbConn, creatorId, eventKey) {
    const row = await dbConn.prepare(`
        SELECT id
        FROM events
        WHERE creator_id = ?
          AND event_key = ?
          AND status IN ('active', 'completed', 'draft')
        ORDER BY FIELD(status, 'active', 'completed', 'draft'), id DESC
        LIMIT 1
    `).get(creatorId, eventKey);
    return row?.id || null;
}

async function insertBillingFact(dbConn, request, context) {
    const eventId = await resolveLatestEventId(dbConn, context.creatorId, request.event_key);
    const meta = buildMeta({
        ...context,
        requestedFields: request.requested_fields,
        payload: context.payload,
    });
    const result = await dbConn.prepare(`
        INSERT INTO event_billing_facts (
            creator_id, event_id, event_key, billing_key, amount, currency,
            billing_status, effective_at, source_kind, source_record_id, meta_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'operator', ?, ?)
    `).run(
        context.creatorId,
        eventId,
        request.event_key,
        request.billing_key,
        request.amount,
        request.currency,
        request.billing_status,
        request.effective_at,
        String(context.creatorId),
        JSON.stringify(meta),
    );
    return {
        kind: request.kind,
        id: result.lastInsertRowid || null,
        event_id: eventId,
        fields: request.requested_fields,
    };
}

async function insertProgressFact(dbConn, request, context) {
    const eventId = await resolveLatestEventId(dbConn, context.creatorId, request.event_key);
    const meta = buildMeta({
        ...context,
        requestedFields: request.requested_fields,
        payload: context.payload,
    });
    const result = await dbConn.prepare(`
        INSERT INTO event_progress_facts (
            creator_id, event_id, event_key, progress_key, video_count,
            video_target, last_checked_at, observed_at, source_kind,
            source_record_id, meta_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'operator', ?, ?)
    `).run(
        context.creatorId,
        eventId,
        request.event_key,
        request.progress_key,
        request.video_count,
        request.video_target,
        request.last_checked_at,
        request.observed_at,
        String(context.creatorId),
        JSON.stringify(meta),
    );
    return {
        kind: request.kind,
        id: result.lastInsertRowid || null,
        event_id: eventId,
        fields: request.requested_fields,
    };
}

async function insertDeadlineFact(dbConn, request, context) {
    const eventId = await resolveLatestEventId(dbConn, context.creatorId, request.event_key);
    const meta = buildMeta({
        ...context,
        requestedFields: request.requested_fields,
        payload: context.payload,
    });
    const result = await dbConn.prepare(`
        INSERT INTO event_deadline_facts (
            creator_id, event_id, event_key, deadline_key, deadline_at,
            status, source_kind, source_record_id, meta_json
        ) VALUES (?, ?, ?, ?, ?, ?, 'operator', ?, ?)
    `).run(
        context.creatorId,
        eventId,
        request.event_key,
        request.deadline_key,
        request.deadline_at,
        request.status,
        String(context.creatorId),
        JSON.stringify(meta),
    );
    return {
        kind: request.kind,
        id: result.lastInsertRowid || null,
        event_id: eventId,
        fields: request.requested_fields,
    };
}

async function writeOperationalFactsFromLegacyPayload(dbConn, {
    creatorId,
    owner = null,
    payload = {},
    actor = null,
} = {}) {
    const numericCreatorId = Number(creatorId);
    if (!Number.isFinite(numericCreatorId) || numericCreatorId <= 0) {
        throw new Error('invalid creatorId');
    }
    const plan = buildOperationalFactRequestsFromLegacyPayload(payload);
    if (plan.requests.length === 0) {
        return {
            factWrites: [],
            handledFields: plan.handledFields,
            updatedFields: [],
        };
    }

    await ensureOperationalFactSchema(dbConn);
    const context = {
        creatorId: numericCreatorId,
        owner,
        payload,
        actor,
    };
    const factWrites = [];
    for (const request of plan.requests) {
        if (request.kind === 'billing') {
            factWrites.push(await insertBillingFact(dbConn, request, context));
        } else if (request.kind === 'progress') {
            factWrites.push(await insertProgressFact(dbConn, request, context));
        } else if (request.kind === 'deadline') {
            factWrites.push(await insertDeadlineFact(dbConn, request, context));
        }
    }

    const updatedFields = [...new Set(
        plan.handledFields.map((field) => `facts.${field.replace(WACRM_PREFIX, '')}`)
    )];

    return {
        factWrites,
        handledFields: plan.handledFields,
        updatedFields,
    };
}

async function getLatestOperationalFactsForCreator(dbConn, creatorId) {
    const numericCreatorId = Number(creatorId);
    if (!Number.isFinite(numericCreatorId) || numericCreatorId <= 0) return null;
    const schema = await inspectOperationalFactSchema(dbConn);
    if (!schema.ok) {
        return {
            schema_ready: false,
            missing: schema.missing,
            billing: {},
            progress: {},
            deadlines: {},
        };
    }

    const [billingRows, progressRows, deadlineRows] = await Promise.all([
        dbConn.prepare(`
            SELECT *
            FROM event_billing_facts
            WHERE creator_id = ?
            ORDER BY created_at DESC, id DESC
            LIMIT 50
        `).all(numericCreatorId),
        dbConn.prepare(`
            SELECT *
            FROM event_progress_facts
            WHERE creator_id = ?
            ORDER BY observed_at DESC, created_at DESC, id DESC
            LIMIT 50
        `).all(numericCreatorId),
        dbConn.prepare(`
            SELECT *
            FROM event_deadline_facts
            WHERE creator_id = ?
            ORDER BY created_at DESC, id DESC
            LIMIT 50
        `).all(numericCreatorId),
    ]);

    const billing = {};
    for (const row of billingRows || []) {
        const key = row.billing_key || 'monthly_fee';
        if (billing[key]) continue;
        billing[key] = {
            id: row.id,
            event_id: row.event_id || null,
            event_key: row.event_key,
            billing_key: key,
            amount: row.amount === null || row.amount === undefined ? null : Number(row.amount),
            currency: row.currency || 'USD',
            billing_status: row.billing_status || null,
            effective_at: row.effective_at || null,
            created_at: row.created_at || null,
            meta: parseJson(row.meta_json, {}),
        };
    }

    const progress = {};
    for (const row of progressRows || []) {
        const key = row.progress_key || 'video_progress';
        if (progress[key]) continue;
        progress[key] = {
            id: row.id,
            event_id: row.event_id || null,
            event_key: row.event_key,
            progress_key: key,
            video_count: row.video_count === null || row.video_count === undefined ? null : Number(row.video_count),
            video_target: row.video_target === null || row.video_target === undefined ? null : Number(row.video_target),
            last_checked_at: row.last_checked_at || null,
            observed_at: row.observed_at || null,
            created_at: row.created_at || null,
            meta: parseJson(row.meta_json, {}),
        };
    }

    const deadlines = {};
    for (const row of deadlineRows || []) {
        const key = row.deadline_key || 'agency_deadline';
        if (deadlines[key]) continue;
        deadlines[key] = {
            id: row.id,
            event_id: row.event_id || null,
            event_key: row.event_key,
            deadline_key: key,
            deadline_at: row.deadline_at || null,
            status: row.status || null,
            created_at: row.created_at || null,
            meta: parseJson(row.meta_json, {}),
        };
    }

    return {
        schema_ready: true,
        billing,
        progress,
        deadlines,
    };
}

function projectOperationalFactsOntoWacrm(wacrm = {}, facts = null) {
    if (!facts || facts.schema_ready === false) return wacrm || null;
    const projected = { ...(wacrm || {}) };
    const monthlyFee = facts.billing?.monthly_fee;
    if (monthlyFee && monthlyFee.amount !== null && monthlyFee.amount !== undefined) {
        projected.monthly_fee_amount = monthlyFee.amount;
    }
    if (monthlyFee?.billing_status) {
        projected.monthly_fee_status = monthlyFee.billing_status;
    }

    const videoProgress = facts.progress?.video_progress;
    if (videoProgress) {
        if (videoProgress.video_count !== null && videoProgress.video_count !== undefined) {
            projected.video_count = videoProgress.video_count;
        }
        if (videoProgress.video_target !== null && videoProgress.video_target !== undefined) {
            projected.video_target = videoProgress.video_target;
        }
        if (videoProgress.last_checked_at) {
            projected.video_last_checked = fromSqlDatetimeToMs(videoProgress.last_checked_at);
        }
    }

    const agencyDeadline = facts.deadlines?.agency_deadline;
    if (agencyDeadline) {
        projected.agency_deadline = agencyDeadline.deadline_at
            ? fromSqlDatetimeToMs(agencyDeadline.deadline_at)
            : null;
    }
    return projected;
}

module.exports = {
    OPERATIONAL_WACRM_FIELDS,
    buildOperationalFactRequestsFromLegacyPayload,
    writeOperationalFactsFromLegacyPayload,
    getLatestOperationalFactsForCreator,
    projectOperationalFactsOntoWacrm,
    inspectOperationalFactSchema,
};
