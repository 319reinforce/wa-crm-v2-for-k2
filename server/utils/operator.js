const { findByPhone, getOperatorRoster, normalizeDigits } = require('../config/operatorRoster');

const OPERATOR_ALIASES = {
    beau: 'Beau',
    yiyun: 'Yiyun',
    yanyiyun: 'Yiyun',
    wangyouke: 'WangYouKe',
    youke: 'WangYouKe',
    jiawen: 'Jiawen',
    sybil: 'Jiawen',
    alice: 'Yiyun',
    yifan: 'Beau',
    bella: 'WangYouKe',
};

const EXTRA_ALIAS_MAP = (() => {
    const map = {};
    for (const item of getOperatorRoster()) {
        const rawKeys = [
            item.operator,
            item.real_name,
            item.wa_note,
            ...(item.aliases || []),
        ].filter(Boolean);
        for (const key of rawKeys) {
            const nk = String(key).toLowerCase().replace(/[^a-z0-9]/g, '');
            if (!nk) continue;
            map[nk] = item.operator;
        }
    }
    return map;
})();

function resolveOperatorByPhone(phone, fallback = null) {
    const hit = findByPhone(phone);
    return hit?.operator || fallback;
}

function getOperatorProfileByPhone(phone) {
    const hit = findByPhone(phone);
    if (!hit) return null;
    return {
        operator: hit.operator,
        real_name: hit.real_name,
        wa_note: hit.wa_note,
        phones: [...(hit.phones || [])],
    };
}

function normalizeOperatorName(value, fallback = null) {
    if (value === null || value === undefined) return fallback;
    const trimmed = String(value).trim();
    if (!trimmed) return fallback;

    const byPhone = resolveOperatorByPhone(trimmed, null);
    if (byPhone) return byPhone;

    const normalizedKey = trimmed.toLowerCase().replace(/[^a-z0-9]/g, '');
    return OPERATOR_ALIASES[normalizedKey] || EXTRA_ALIAS_MAP[normalizedKey] || trimmed;
}

module.exports = {
    getOperatorProfileByPhone,
    getOperatorRoster,
    normalizeOperatorName,
    resolveOperatorByPhone,
    normalizeDigits,
};
