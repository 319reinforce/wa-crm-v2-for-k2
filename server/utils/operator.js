const OPERATOR_ALIASES = {
    beau: 'Beau',
    yiyun: 'Yiyun',
    yanyiyun: 'Yiyun',
    wangyouke: 'WangYouKe',
    youke: 'WangYouKe',
};

function normalizeOperatorName(value, fallback = null) {
    if (value ***REMOVED***= null || value ***REMOVED***= undefined) return fallback;
    const trimmed = String(value).trim();
    if (!trimmed) return fallback;

    const normalizedKey = trimmed.toLowerCase().replace(/[\s_-]/g, '');
    return OPERATOR_ALIASES[normalizedKey] || trimmed;
}

module.exports = {
    normalizeOperatorName,
};
