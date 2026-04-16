const INTERNAL_SERVICE_TOKEN_ENV_KEYS = [
    'INTERNAL_SERVICE_TOKEN',
    'TRAINING_TRIGGER_TOKEN',
    'INTERNAL_API_TOKEN',
    'AI_PROXY_TOKEN',
];

function getInternalServiceTokenEntry() {
    for (const key of INTERNAL_SERVICE_TOKEN_ENV_KEYS) {
        const token = String(process.env[key] || '').trim();
        if (token) {
            return { key, token };
        }
    }
    return null;
}

function getInternalServiceToken() {
    return getInternalServiceTokenEntry()?.token || '';
}

function getInternalServiceHeaders(extraHeaders = {}) {
    const token = getInternalServiceToken();
    return token
        ? { ...extraHeaders, Authorization: `Bearer ${token}` }
        : { ...extraHeaders };
}

module.exports = {
    INTERNAL_SERVICE_TOKEN_ENV_KEYS,
    getInternalServiceTokenEntry,
    getInternalServiceToken,
    getInternalServiceHeaders,
};
