function toTimestampMs(value) {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return 0;
    return n > 1e12 ? Math.floor(n) : Math.floor(n * 1000);
}

function normalizeMessageText(text) {
    return String(text || '')
        .replace(/\s+/g, ' ')
        .trim();
}

function buildMessageGroupKey(message) {
    return `${message.role || ''}\u0000${normalizeMessageText(message.text)}`;
}

function shouldApplyShortWindowGuard(message, options = {}) {
    const normalizedText = normalizeMessageText(message.text);
    const minTextLength = Number.isFinite(options.minTextLength)
        ? options.minTextLength
        : 12;
    if (!normalizedText) return false;
    if (normalizedText.length < minTextLength) return false;
    return true;
}

async function loadRecentMessages(executor, creatorId, minTs, maxTs) {
    return executor.prepare(`
        SELECT id, role, text, timestamp, operator, message_hash
        FROM wa_messages
        WHERE creator_id = ?
          AND timestamp BETWEEN ? AND ?
        ORDER BY timestamp ASC, id ASC
    `).all(creatorId, minTs, maxTs);
}

async function filterShortWindowDuplicates(executor, creatorId, messages = [], options = {}) {
    const windowMs = Number.isFinite(options.windowMs) ? options.windowMs : 15 * 60 * 1000;
    const normalized = (Array.isArray(messages) ? messages : [])
        .map((message, index) => ({
            ...message,
            __index: index,
            text: normalizeMessageText(message.text),
            timestamp: toTimestampMs(message.timestamp),
        }))
        .filter((message) => message.text && message.timestamp > 0);

    if (normalized.length === 0) {
        return { kept: [], dropped: [], existingSample: [] };
    }

    normalized.sort((a, b) => {
        if (a.timestamp !== b.timestamp) return a.timestamp - b.timestamp;
        return a.__index - b.__index;
    });

    const guardCandidates = normalized.filter((message) => shouldApplyShortWindowGuard(message, options));
    const minTs = Math.min(...guardCandidates.map((message) => message.timestamp), normalized[0].timestamp) - windowMs;
    const maxTs = Math.max(...guardCandidates.map((message) => message.timestamp), normalized[normalized.length - 1].timestamp) + windowMs;
    const recentRows = guardCandidates.length > 0
        ? await loadRecentMessages(executor, creatorId, minTs, maxTs)
        : [];

    const existingByKey = new Map();
    for (const row of recentRows) {
        const key = buildMessageGroupKey(row);
        const list = existingByKey.get(key) || [];
        list.push({
            id: row.id,
            timestamp: toTimestampMs(row.timestamp),
            role: row.role,
            text: normalizeMessageText(row.text),
        });
        existingByKey.set(key, list);
    }

    const batchAcceptedByKey = new Map();
    const kept = [];
    const dropped = [];

    for (const message of normalized) {
        if (!shouldApplyShortWindowGuard(message, options)) {
            kept.push(message);
            continue;
        }

        const key = buildMessageGroupKey(message);
        const existingMatches = existingByKey.get(key) || [];
        const acceptedMatches = batchAcceptedByKey.get(key) || [];

        const hasExistingNear = existingMatches.some((row) => Math.abs(row.timestamp - message.timestamp) <= windowMs);
        const hasAcceptedNear = acceptedMatches.some((row) => Math.abs(row.timestamp - message.timestamp) <= windowMs);

        if (hasExistingNear || hasAcceptedNear) {
            dropped.push({
                ...message,
                drop_reason: hasExistingNear ? 'existing_short_window_duplicate' : 'batch_short_window_duplicate',
            });
            continue;
        }

        acceptedMatches.push({ timestamp: message.timestamp });
        batchAcceptedByKey.set(key, acceptedMatches);
        kept.push(message);
    }

    return {
        kept,
        dropped,
        existingSample: recentRows.slice(0, 20),
    };
}

module.exports = {
    toTimestampMs,
    normalizeMessageText,
    shouldApplyShortWindowGuard,
    filterShortWindowDuplicates,
};
