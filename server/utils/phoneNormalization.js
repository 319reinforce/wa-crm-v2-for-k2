'use strict';

function digitsOnly(value) {
    return String(value || '').replace(/\D/g, '').trim();
}

function normalizeWaPhoneForStorage(value) {
    const digits = digitsOnly(value);
    if (digits.length === 10) return `1${digits}`;
    return digits;
}

function getWaPhoneLookupVariants(value) {
    const normalized = normalizeWaPhoneForStorage(value);
    const variants = new Set();
    if (normalized) variants.add(normalized);
    if (normalized.length === 11 && normalized.startsWith('1')) {
        variants.add(normalized.slice(1));
    }
    return [...variants];
}

module.exports = {
    digitsOnly,
    normalizeWaPhoneForStorage,
    getWaPhoneLookupVariants,
};
