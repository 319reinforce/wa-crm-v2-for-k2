/**
 * 群聊发送保护：
 * 永远不要默认启用群聊发送功能。只有在人工连续两次明确确认“同意启用群聊”后，
 * 才允许通过 WA_GROUP_SEND_UNLOCK 临时解锁；未满足此前，所有群聊发送必须拒绝。
 */

const GROUP_SEND_APPROVAL_PHRASE = '同意启用群聊';
const REQUIRED_UNLOCK_SEQUENCE = `${GROUP_SEND_APPROVAL_PHRASE}|${GROUP_SEND_APPROVAL_PHRASE}`;

function normalizeUnlockSequence(value) {
    return String(value || '')
        .split(/[\s,，|]+/)
        .map((item) => String(item || '').trim())
        .filter(Boolean)
        .join('|');
}

function isGroupChatTarget(value) {
    const normalized = String(value || '').trim().toLowerCase();
    if (!normalized) return false;
    return normalized.endsWith('@g.us') || normalized.includes('@g.us');
}

function isGroupSendExplicitlyEnabled() {
    return normalizeUnlockSequence(process.env.WA_GROUP_SEND_UNLOCK) === REQUIRED_UNLOCK_SEQUENCE;
}

function assertNoGroupSend(target, { source = 'wa_send' } = {}) {
    if (!isGroupChatTarget(target)) {
        return { ok: true };
    }
    if (isGroupSendExplicitlyEnabled()) {
        return { ok: true, unlocked: true };
    }
    return {
        ok: false,
        error: `群聊发送已禁用(${source})；除非人工连续两次明确确认“${GROUP_SEND_APPROVAL_PHRASE}”，否则永不启用`,
        code: 'group_send_disabled',
    };
}

module.exports = {
    GROUP_SEND_APPROVAL_PHRASE,
    isGroupChatTarget,
    isGroupSendExplicitlyEnabled,
    assertNoGroupSend,
};
