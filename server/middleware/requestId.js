const crypto = require('crypto');

const REQUEST_ID_HEADER = 'X-Request-Id';
const REQUEST_ID_HEADER_LOWER = 'x-request-id';
const REQUEST_ID_MAX_LENGTH = 128;
const REQUEST_ID_SAFE_PATTERN = /^[A-Za-z0-9._:-]+$/;

function normalizeRequestId(value) {
    const raw = Array.isArray(value) ? value[0] : value;
    const normalized = String(raw || '').trim();
    if (!normalized) return '';
    if (normalized.length > REQUEST_ID_MAX_LENGTH) return '';
    if (!REQUEST_ID_SAFE_PATTERN.test(normalized)) return '';
    return normalized;
}

function createRequestId() {
    if (typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }
    return crypto.randomBytes(16).toString('hex');
}

function requestIdMiddleware(req, res, next) {
    const incoming = normalizeRequestId(req.headers?.[REQUEST_ID_HEADER_LOWER]);
    const requestId = incoming || createRequestId();
    req.id = requestId;
    req.requestId = requestId;
    if (typeof res.setHeader === 'function') {
        res.setHeader(REQUEST_ID_HEADER, requestId);
    }
    next();
}

module.exports = {
    REQUEST_ID_HEADER,
    REQUEST_ID_HEADER_LOWER,
    normalizeRequestId,
    createRequestId,
    requestIdMiddleware,
};
