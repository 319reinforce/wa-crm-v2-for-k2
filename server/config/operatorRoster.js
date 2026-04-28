const OPERATOR_ROSTER = [
    {
        operator: 'Yiyun',
        real_name: 'yiyun',
        wa_note: 'Alice',
        phones: ['+8613699226259'],
        aliases: ['yiyun', 'alice'],
    },
    {
        operator: 'Beau',
        real_name: 'yifan',
        wa_note: 'Beau',
        phones: ['+18459534090'],
        aliases: ['beau', 'yifan'],
    },
    {
        operator: 'WangYouKe',
        real_name: 'youke',
        wa_note: 'Youke(Bella)',
        phones: ['+8615603906010'],
        aliases: ['youke', 'wangyouke', 'bella', 'youkebella'],
    },
    {
        operator: 'Jiawen',
        real_name: 'jiawen',
        wa_note: 'Sybil',
        phones: ['+8617641210103'],
        aliases: ['jiawen', 'sybil'],
    },
    {
        operator: 'Jiawei',
        real_name: 'jiawei',
        wa_note: 'Jiawei',
        phones: ['+8613187012419'],
        aliases: ['jiawei', 'depp', 'moras'],
    },
];

// Business-facing display priority for owner chips and roster selectors.
const OPERATOR_DISPLAY_ORDER = [
    'Yiyun',
    'Beau',
    'WangYouKe',
    'Jaylyn',
    'Jiawei',
];

const OPERATOR_ORDER_ALIASES = {
    yiyun: 'Yiyun',
    yanyiyun: 'Yiyun',
    alice: 'Yiyun',
    beau: 'Beau',
    yifan: 'Beau',
    youke: 'WangYouKe',
    wangyouke: 'WangYouKe',
    bella: 'WangYouKe',
    youkebella: 'WangYouKe',
    jaylyn: 'Jaylyn',
    jiawei: 'Jiawei',
};

function normalizeDigits(value) {
    return String(value || '').replace(/\D/g, '');
}

function normalizeOrderKey(value) {
    const key = String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    return OPERATOR_ORDER_ALIASES[key] || value;
}

function getOperatorSortRank(operator) {
    const canonical = normalizeOrderKey(operator);
    const rank = OPERATOR_DISPLAY_ORDER.indexOf(canonical);
    return rank === -1 ? Number.POSITIVE_INFINITY : rank;
}

function sortOperatorNames(a, b) {
    const ar = getOperatorSortRank(a);
    const br = getOperatorSortRank(b);
    if (ar !== br) return ar - br;
    return String(a || '').localeCompare(String(b || ''), 'zh-CN');
}

function findByPhone(phone) {
    const digits = normalizeDigits(phone);
    if (!digits) return null;

    for (const item of OPERATOR_ROSTER) {
        for (const p of item.phones || []) {
            const pd = normalizeDigits(p);
            if (!pd) continue;
            if (digits === pd) return item;
            if (digits.endsWith(pd) || pd.endsWith(digits)) return item;
        }
    }
    return null;
}

function getOperatorRoster() {
    return OPERATOR_ROSTER.map((item) => ({
        operator: item.operator,
        real_name: item.real_name,
        wa_note: item.wa_note,
        phones: [...(item.phones || [])],
        aliases: [...(item.aliases || [])],
    }));
}

module.exports = {
    OPERATOR_DISPLAY_ORDER,
    OPERATOR_ROSTER,
    findByPhone,
    getOperatorSortRank,
    getOperatorRoster,
    normalizeDigits,
    sortOperatorNames,
};
