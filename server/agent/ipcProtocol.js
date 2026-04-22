/**
 * Agent IPC Protocol
 *
 * 父进程(SessionRegistry) ↔ 子进程(waAgent) 的消息类型常量。
 * 两端共用以避免字符串 typo。
 */

// ===== Parent → Agent (commands) =====
const CMD_SEND_MESSAGE = 'send_message';
const CMD_SEND_MEDIA = 'send_media';
const CMD_AUDIT_RECENT_MESSAGES = 'audit_recent_messages';
const CMD_CHANGE_DRIVER = 'change_driver';
const CMD_SHUTDOWN = 'shutdown';

// ===== Agent → Parent (events, one-way) =====
const EVT_QR = 'qr';
const EVT_READY = 'ready';
const EVT_ERROR = 'error';
const EVT_DISCONNECTED = 'disconnected';
const EVT_HEARTBEAT = 'heartbeat';
const EVT_WA_MESSAGE = 'wa-message';   // Step 7 用
const EVT_STATE_CHANGE = 'state-change';

// ===== Message envelope types =====
const TYPE_CMD = 'cmd';
const TYPE_CMD_RESULT = 'cmd_result';
const TYPE_EVENT = 'event';

function makeCommand(id, cmd, payload = {}) {
    return { type: TYPE_CMD, id, cmd, payload };
}

function makeCommandResult(id, result) {
    // 注意：id 必须在 ...result 之后展开，否则 result 里同名字段（比如
    // BaileysDriver.sendMessage 返回的 WhatsApp 消息 id）会把 envelope id
    // 覆盖掉，parent 拿到错的 id → pendingCommands 查不到 → 命令超时。
    return { type: TYPE_CMD_RESULT, ...result, id };
}

function makeEvent(kind, payload = {}) {
    return { type: TYPE_EVENT, kind, ...payload };
}

module.exports = {
    CMD_SEND_MESSAGE,
    CMD_SEND_MEDIA,
    CMD_AUDIT_RECENT_MESSAGES,
    CMD_SHUTDOWN,

    EVT_QR,
    EVT_READY,
    EVT_ERROR,
    EVT_DISCONNECTED,
    EVT_HEARTBEAT,
    EVT_WA_MESSAGE,
    EVT_STATE_CHANGE,

    TYPE_CMD,
    TYPE_CMD_RESULT,
    TYPE_EVENT,

    makeCommand,
    makeCommandResult,
    makeEvent,
};
