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

/**
 * 比较两个 operator 名字是否指向同一个人。
 *
 * 背景：新增的动态 operator（不在静态 OPERATOR_ROSTER 里）没有权威大小写，
 * 各处写入 DB 时可能存成 'jiawei' / 'Jiawei' 不一致。normalizeOperatorName
 * 只对 roster 里的已知别名做归一化，对陌生 operator 原样返回，导致严格 ===
 * 比较会误判 "operator does not match client owner"。
 *
 * 比较策略：
 * 1. 先 normalizeOperatorName 两边 → roster 成员会被归到权威大小写，直接相等
 * 2. 如仍不等，进一步做 toLowerCase 比较 → 覆盖非 roster 的 case drift
 */
function ownersEqual(a, b) {
    const na = normalizeOperatorName(a, null);
    const nb = normalizeOperatorName(b, null);
    if (na == null || nb == null) return na === nb;
    if (na === nb) return true;
    return String(na).toLowerCase() === String(nb).toLowerCase();
}

module.exports = {
    getOperatorProfileByPhone,
    getOperatorRoster,
    normalizeOperatorName,
    ownersEqual,
    resolveOperatorByPhone,
    normalizeDigits,
};
