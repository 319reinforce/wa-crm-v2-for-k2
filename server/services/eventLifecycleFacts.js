const {
    CANONICAL_LIFECYCLE_EVENT_KEYS,
} = require('../constants/eventDecisionRules');

const CANONICAL_LIFECYCLE_EVENT_KEY_SET = new Set(CANONICAL_LIFECYCLE_EVENT_KEYS);

function parseEventMeta(value, fallback = {}) {
    if (value === null || value === undefined || value === '') return fallback;
    if (typeof value === 'object' && !Array.isArray(value)) return value;
    try {
        const parsed = JSON.parse(value);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : fallback;
    } catch (_) {
        return fallback;
    }
}

function normalizeEventStatus(value) {
    const status = String(value || '').trim().toLowerCase();
    if (!status) return 'active';
    if (status === 'pending') return 'draft';
    return status;
}

function isGeneratedLifecycleEventKey(eventKey = '') {
    const key = String(eventKey || '').trim();
    return /^jb_touchpoint_/i.test(key)
        || /^violation_/i.test(key)
        || /_unknown$/i.test(key)
        || /^gmv_milestone_\d+/i.test(key);
}

function isCanonicalLifecycleEventKey(eventKey = '') {
    const key = String(eventKey || '').trim();
    return CANONICAL_LIFECYCLE_EVENT_KEY_SET.has(key) && !isGeneratedLifecycleEventKey(key);
}

function getEventMeta(event = {}) {
    return parseEventMeta(event?.meta, {});
}

function getEventEvidenceTier(event = {}) {
    const meta = getEventMeta(event);
    const directTier = event?.evidence_tier ?? event?.evidenceTier;
    const contractTier = meta?.evidence_contract?.evidence_tier ?? directTier;
    if (contractTier !== undefined && contractTier !== null && contractTier !== '') {
        const numeric = Number(contractTier);
        return Number.isFinite(numeric) ? Math.max(0, Math.min(Math.trunc(numeric), 3)) : 0;
    }

    const reviewState = String(event?.review_state || event?.reviewState || '').trim().toLowerCase();
    const verificationStatus = String(meta?.verification?.review_status || '').trim().toLowerCase();
    if (reviewState === 'confirmed' || verificationStatus === 'confirmed') return 2;
    return null;
}

function canEventDriveLifecycle(event = {}, allowedStatuses = ['active', 'completed']) {
    const key = String(event?.event_key || event?.eventKey || event?.canonical_event_key || '').trim();
    if (!isCanonicalLifecycleEventKey(key)) return false;
    const status = normalizeEventStatus(event?.status || event?.event_state || event?.eventState);
    if (!allowedStatuses.includes(status)) return false;

    const meta = getEventMeta(event);
    const overlay = meta?.lifecycle_overlay && typeof meta.lifecycle_overlay === 'object'
        ? meta.lifecycle_overlay
        : {};
    const rawLifecycleEffect = event?.lifecycle_effect
        ?? (Object.prototype.hasOwnProperty.call(overlay, 'drives_main_stage') ? overlay.drives_main_stage : '');
    const lifecycleEffect = String(rawLifecycleEffect).trim().toLowerCase();
    if (lifecycleEffect === 'none' || lifecycleEffect === 'false') return false;

    const evidenceTier = getEventEvidenceTier(event);
    if (evidenceTier !== null && evidenceTier < 2) return false;
    return true;
}

function normalizeLifecycleEventRow(row = {}) {
    const meta = parseEventMeta(row.meta, null);
    return {
        ...row,
        creator_id: Number(row.creator_id || 0) || row.creator_id,
        status: normalizeEventStatus(row.status || row.event_state),
        meta,
    };
}

function toTimestampMs(value) {
    if (value === null || value === undefined || value === '') return 0;
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) {
        return numeric > 1e12 ? Math.floor(numeric) : Math.floor(numeric * 1000);
    }
    const dateTs = new Date(value).getTime();
    return Number.isFinite(dateTs) && dateTs > 0 ? dateTs : 0;
}

function getBusinessTimestampMs(event = {}) {
    const meta = getEventMeta(event);
    return toTimestampMs(event.source_event_at)
        || toTimestampMs(meta?.source_anchor?.timestamp)
        || toTimestampMs(event.start_at)
        || toTimestampMs(event.created_at);
}

function getDetectedTimestampMs(event = {}) {
    return toTimestampMs(event.detected_at) || toTimestampMs(event.created_at);
}

function getConfirmedTimestampMs(event = {}) {
    const meta = getEventMeta(event);
    return toTimestampMs(event.verified_at)
        || toTimestampMs(meta?.verification?.verified_at)
        || toTimestampMs(meta?.verification?.reviewed_at)
        || 0;
}

function localDateKey(timestampMs, timeZone = 'Asia/Shanghai') {
    if (!timestampMs) return '';
    const date = new Date(timestampMs);
    if (!Number.isFinite(date.getTime())) return '';
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).formatToParts(date);
    const get = (type) => parts.find((part) => part.type === type)?.value || '00';
    return `${get('year')}-${get('month')}-${get('day')}`;
}

function getYesterdayDateKey(now = new Date(), timeZone = 'Asia/Shanghai') {
    const current = now instanceof Date ? now : new Date(now);
    const yesterday = new Date(current.getTime() - 24 * 60 * 60 * 1000);
    return localDateKey(yesterday.getTime(), timeZone);
}

function isConfirmedEvent(event = {}) {
    const meta = getEventMeta(event);
    const reviewState = String(event.review_state || event.reviewState || '').trim().toLowerCase();
    const verificationStatus = String(meta?.verification?.review_status || '').trim().toLowerCase();
    return reviewState === 'confirmed' || verificationStatus === 'confirmed';
}

function aggregateEventStats(events = [], options = {}) {
    const timeZone = options.timeZone || 'Asia/Shanghai';
    const yesterdayKey = options.yesterdayKey || getYesterdayDateKey(options.now || new Date(), timeZone);
    const stats = {
        total_events: 0,
        total_canonical_events: 0,
        total_lifecycle_driving_events: 0,
        yesterday_detected_events: 0,
        yesterday_business_events: 0,
        yesterday_confirmed_events: 0,
    };

    for (const rawEvent of Array.isArray(events) ? events : []) {
        const event = normalizeLifecycleEventRow(rawEvent);
        stats.total_events += 1;

        const canonical = isCanonicalLifecycleEventKey(event.event_key || event.canonical_event_key);
        if (canonical) stats.total_canonical_events += 1;

        const drivesLifecycle = canEventDriveLifecycle(event);
        if (drivesLifecycle) stats.total_lifecycle_driving_events += 1;

        if (localDateKey(getDetectedTimestampMs(event), timeZone) === yesterdayKey) {
            stats.yesterday_detected_events += 1;
        }
        if (drivesLifecycle && localDateKey(getBusinessTimestampMs(event), timeZone) === yesterdayKey) {
            stats.yesterday_business_events += 1;
        }
        if (isConfirmedEvent(event) && localDateKey(getConfirmedTimestampMs(event), timeZone) === yesterdayKey) {
            stats.yesterday_confirmed_events += 1;
        }
    }

    return stats;
}

module.exports = {
    CANONICAL_LIFECYCLE_EVENT_KEY_SET,
    parseEventMeta,
    normalizeEventStatus,
    isGeneratedLifecycleEventKey,
    isCanonicalLifecycleEventKey,
    getEventEvidenceTier,
    canEventDriveLifecycle,
    normalizeLifecycleEventRow,
    getBusinessTimestampMs,
    getDetectedTimestampMs,
    getConfirmedTimestampMs,
    aggregateEventStats,
};
