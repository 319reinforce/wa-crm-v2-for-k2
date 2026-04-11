const { normalizeOperatorName } = require('../utils/operator');

const INTERNAL_NAME_PATTERNS = [
    /\bbeau\b/i,
    /\byiyun\b/i,
    /\bwang\s*you\s*ke\b/i,
    /\bmoras\b/i,
    /\breinforce\b/i,
];

const RELEVANCE_KEYWORDS = [
    'tiktok', 'shop', 'video', 'content', 'creator', 'beta', 'trial', 'monthly',
    'gmv', 'commission', 'invite', 'invite code', 'code', 'payment', 'order',
    'bonus', 'agency', 'mcn', 'referral', 'review', 'campaign', 'posted',
];

const DEFAULT_CUTOFF_MS = new Date('2026-01-21T00:00:00+08:00').getTime();

function hasChinese(text) {
    return /[\u4e00-\u9fff]/.test(text || '');
}

function getMessageText(message) {
    return message?.text || message?.body || message?.content || '';
}

function toTimestampMs(timestamp) {
    if (!timestamp) return 0;
    return timestamp > 1e12 ? timestamp : timestamp * 1000;
}

function normalizePhone(phone) {
    return String(phone || '').trim();
}

function getPhoneDigits(phone) {
    return normalizePhone(phone).replace(/\D/g, '');
}

function isChinaPhone(phone) {
    const digits = getPhoneDigits(phone);
    return digits.startsWith('86') && digits.length >= 11;
}

function isNonTargetPhone(phone) {
    const normalized = normalizePhone(phone);
    const digits = getPhoneDigits(phone);
    if (!digits) return true;
    if (isChinaPhone(phone)) return true;
    if (digits.length ***REMOVED***= 11 && !digits.startsWith('1')) return true;
    if (normalized.startsWith('+') && !normalized.startsWith('+1')) return true;
    return false;
}

function isInternalContact(name) {
    return INTERNAL_NAME_PATTERNS.some((pattern) => pattern.test(name || ''));
}

function getRelevanceSignals(messages = []) {
    const texts = messages.map(getMessageText).map((text) => text.toLowerCase());
    let hitCount = 0;
    for (const text of texts) {
        if (RELEVANCE_KEYWORDS.some((keyword) => text.includes(keyword))) {
            hitCount += 1;
        }
    }
    return hitCount;
}

function analyzeCreatorEligibility(phone, name, recentMsgs = [], options = {}) {
    const {
        mode = 'history',
        cutoffMs = DEFAULT_CUTOFF_MS,
    } = options;

    const reasons = [];
    const messageCount = recentMsgs.length;
    const chineseCount = recentMsgs.filter((msg) => hasChinese(getMessageText(msg))).length;
    const relevanceHits = getRelevanceSignals(recentMsgs);
    const lastMsg = recentMsgs[recentMsgs.length - 1];
    const lastTsMs = toTimestampMs(lastMsg?.timestamp || lastMsg?.timestamp_ms);

    if (isChinaPhone(phone)) reasons.push('cn_phone');
    else if (isNonTargetPhone(phone)) reasons.push('non_target_phone');

    if (isInternalContact(name)) reasons.push('internal_contact');

    if (messageCount > 0 && chineseCount > messageCount * 0.5) {
        reasons.push('mostly_chinese');
    }

    if (messageCount > 0 && relevanceHits ***REMOVED***= 0 && messageCount < 8) {
        reasons.push('irrelevant_chat');
    }

    if (mode !***REMOVED*** 'realtime') {
        if (messageCount ***REMOVED***= 0) reasons.push('no_wa_messages');
        if (messageCount > 0 && messageCount < 3) reasons.push('too_few_messages');
        if (lastTsMs && lastTsMs < cutoffMs) reasons.push('stale_chat');
    }

    return {
        eligible: reasons.length ***REMOVED***= 0,
        reasons,
        metrics: {
            messageCount,
            chineseCount,
            relevanceHits,
            lastTsMs,
        },
    };
}

function normalizeCreatorOwner(owner) {
    return normalizeOperatorName(owner, 'Beau');
}

module.exports = {
    DEFAULT_CUTOFF_MS,
    analyzeCreatorEligibility,
    getRelevanceSignals,
    getMessageText,
    getPhoneDigits,
    hasChinese,
    normalizeCreatorOwner,
    normalizePhone,
    toTimestampMs,
};
