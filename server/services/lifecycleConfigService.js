const DEFAULT_POLICY_KEY = 'lifecycle.aarrr';

const DEFAULT_CONFIG = {
    policy_key: DEFAULT_POLICY_KEY,
    policy_version: 'v1',
    applicable_scenarios: ['lifecycle_management'],
    is_active: 1,
    config: {
        revenue_requires_gmv: false,
        revenue_gmv_threshold: 2000,
        agency_bound_mainline: true,
    },
};

function parseJsonSafe(value, fallback) {
    if (value === null || value === undefined) return fallback;
    if (typeof value === 'object') return value;
    try {
        return JSON.parse(value);
    } catch (_) {
        return fallback;
    }
}

function normalizeConfig(raw = {}) {
    const revenueRequiresGmv = raw?.revenue_requires_gmv === true || raw?.revenue_requires_gmv === 1;
    const thresholdRaw = Number(raw?.revenue_gmv_threshold);
    const threshold = Number.isFinite(thresholdRaw) ? thresholdRaw : DEFAULT_CONFIG.config.revenue_gmv_threshold;
    const agencyBoundMainline = raw?.agency_bound_mainline === undefined
        ? true
        : (raw?.agency_bound_mainline === true || raw?.agency_bound_mainline === 1);

    return {
        revenue_requires_gmv: revenueRequiresGmv,
        revenue_gmv_threshold: threshold,
        agency_bound_mainline: agencyBoundMainline,
    };
}

function normalizeScenarios(value) {
    if (!Array.isArray(value)) return DEFAULT_CONFIG.applicable_scenarios;
    const list = value.map((item) => String(item || '').trim()).filter(Boolean);
    return list.length > 0 ? list : DEFAULT_CONFIG.applicable_scenarios;
}

function buildDefaultPayload() {
    return {
        ...DEFAULT_CONFIG,
        config: normalizeConfig(DEFAULT_CONFIG.config),
    };
}

function extractPayloadFromRow(row) {
    if (!row) {
        return {
            ...buildDefaultPayload(),
            source: 'default',
            updated_at: null,
        };
    }
    const parsed = parseJsonSafe(row.policy_content, {});
    const config = normalizeConfig(parsed?.config || parsed);
    return {
        policy_key: row.policy_key || DEFAULT_POLICY_KEY,
        policy_version: row.policy_version || DEFAULT_CONFIG.policy_version,
        applicable_scenarios: normalizeScenarios(parseJsonSafe(row.applicable_scenarios, DEFAULT_CONFIG.applicable_scenarios)),
        is_active: row.is_active === undefined ? 1 : (row.is_active ? 1 : 0),
        config,
        source: 'db',
        updated_at: row.updated_at || null,
    };
}

module.exports = {
    DEFAULT_POLICY_KEY,
    DEFAULT_CONFIG,
    normalizeConfig,
    buildDefaultPayload,
    extractPayloadFromRow,
};
