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
];

function normalizeDigits(value) {
    return String(value || '').replace(/\D/g, '');
}

function findByPhone(phone) {
    const digits = normalizeDigits(phone);
    if (!digits) return null;

    for (const item of OPERATOR_ROSTER) {
        for (const p of item.phones || []) {
            const pd = normalizeDigits(p);
            if (!pd) continue;
            if (digits ***REMOVED***= pd) return item;
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
    OPERATOR_ROSTER,
    findByPhone,
    getOperatorRoster,
    normalizeDigits,
};
