const LEGACY_WACRM_LIFECYCLE_FIELDS = Object.freeze([
    'monthly_fee_status',
    'monthly_fee_amount',
    'monthly_fee_deducted',
    'beta_status',
    'beta_cycle_start',
    'beta_program_type',
    'agency_bound',
    'agency_bound_at',
    'agency_deadline',
    'video_count',
    'video_target',
    'video_last_checked',
]);

const LEGACY_JOINBRANDS_EVENT_FIELDS = Object.freeze([
    'ev_joined',
    'ev_ready_sent',
    'ev_trial_7day',
    'ev_trial_active',
    'ev_monthly_started',
    'ev_monthly_invited',
    'ev_monthly_joined',
    'ev_whatsapp_shared',
    'ev_gmv_1k',
    'ev_gmv_2k',
    'ev_gmv_5k',
    'ev_gmv_10k',
    'ev_agency_bound',
    'ev_churned',
]);

function isLegacyLifecycleWriteAllowed() {
    return /^(1|true|yes)$/i.test(String(process.env.ALLOW_LEGACY_LIFECYCLE_WRITES || '').trim());
}

function findLegacyLifecycleFields(payload, {
    includeWacrm = true,
    includeJoinbrands = true,
} = {}) {
    const source = payload && typeof payload === 'object' ? payload : {};
    const blocked = [];
    if (includeWacrm) {
        for (const field of LEGACY_WACRM_LIFECYCLE_FIELDS) {
            if (Object.prototype.hasOwnProperty.call(source, field) && source[field] !== undefined) {
                blocked.push(`wa_crm_data.${field}`);
            }
        }
    }
    if (includeJoinbrands) {
        for (const field of LEGACY_JOINBRANDS_EVENT_FIELDS) {
            if (Object.prototype.hasOwnProperty.call(source, field) && source[field] !== undefined) {
                blocked.push(`joinbrands_link.${field}`);
            }
        }
    }
    return blocked;
}

function assertLegacyLifecycleWritesAllowed(payload, options = {}) {
    const blockedFields = findLegacyLifecycleFields(payload, options);
    if (blockedFields.length === 0 || isLegacyLifecycleWriteAllowed()) {
        return { allowed: true, blockedFields };
    }
    const error = new Error('Legacy lifecycle writes are frozen; write canonical event facts and rebuild snapshots instead.');
    error.code = 'LEGACY_LIFECYCLE_WRITES_FROZEN';
    error.status = 409;
    error.blockedFields = blockedFields;
    throw error;
}

module.exports = {
    LEGACY_WACRM_LIFECYCLE_FIELDS,
    LEGACY_JOINBRANDS_EVENT_FIELDS,
    isLegacyLifecycleWriteAllowed,
    findLegacyLifecycleFields,
    assertLegacyLifecycleWritesAllowed,
};
