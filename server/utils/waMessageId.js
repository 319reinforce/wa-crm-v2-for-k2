/**
 * 抽取 whatsapp-web.js Message 对象上的原生消息 id。
 * 返回 Message.id._serialized（或其等价值）作为幂等主键；无可用 id 时返回 null。
 *
 * whatsapp-web.js 在不同版本/事件路径下 id 的存放位置不一致，
 * 这里按优先级逐个回退，容忍 string / object 两种形态。
 */

const MAX_ID_LENGTH = 128;

function pickSerialized(value) {
    if (!value) return null;
    if (typeof value === 'string') return value;
    if (typeof value === 'object') {
        if (typeof value._serialized === 'string') return value._serialized;
        if (typeof value.SerializedString === 'string') return value.SerializedString;
    }
    return null;
}

function extractWaMessageId(message) {
    if (!message || typeof message !== 'object') return null;

    const candidates = [
        pickSerialized(message.id),
        pickSerialized(message._data && message._data.id),
        pickSerialized(message.rawData && message.rawData.id),
        pickSerialized(message.data && message.data.id),
    ];

    for (const candidate of candidates) {
        if (typeof candidate !== 'string') continue;
        const trimmed = candidate.trim();
        if (trimmed.length === 0) continue;
        if (trimmed.length > MAX_ID_LENGTH) continue;
        return trimmed;
    }

    return null;
}

module.exports = {
    extractWaMessageId,
    MAX_ID_LENGTH,
};
