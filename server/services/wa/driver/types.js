/**
 * @fileoverview Shared driver interface contracts for whatsapp-mgr dual-driver architecture.
 *
 * All WA drivers (wwebjs, baileys) must implement the WaDriver interface below.
 * The upper layer (waService.js facade, waWorker, waSessionRouter) is driver-agnostic.
 *
 * Key invariants:
 * - phone numbers are always E.164 strings (e.g. "+85255550001") in DB and public API
 * - driver internally converts to its native JID format (e.g. "85255550001@c.us" vs "85255550001@s.whatsapp.net")
 * - all timestamps are Unix milliseconds
 * - sendMessage/sendMedia return SendResult (never throws)
 */

/**
 * @typedef {Object} SessionConfig
 * @property {string} sessionId
 * @property {string} owner
 * @property {'wwebjs'|'baileys'} driver
 * @property {string} authRootDir      Base directory for session auth state
 * @property {object} [driverMeta]     Persisted metadata from wa_sessions.driver_meta
 */

/**
 * @typedef {Object} SendResult
 * @property {boolean} ok
 * @property {string}  [id]          wa_message_id (wwebjs: _serialized, baileys: key.id raw hash)
 * @property {number}  [timestamp]   milliseconds
 * @property {string}  [chatId]      E.164 phone (NOT JID) of the chat
 * @property {string}  [error]
 */

/**
 * @typedef {Object} MediaPayload
 * @property {string} [media_path]     Local filesystem path
 * @property {string} [media_url]      Remote HTTP URL (driver downloads before sending)
 * @property {string} [data_base64]    Base64-encoded file content
 * @property {string} [mime_type]      e.g. "image/jpeg"
 * @property {string} [file_name]      Display name
 * @property {string} [caption]         Message caption / media caption
 */

/**
 * @typedef {Object} IncomingMessage
 * @property {string}  id           wa_message_id
 * @property {string}  chatId       E.164 phone of the chat
 * @property {string}  from         E.164 sender phone (for group: the group phone)
 * @property {boolean} fromMe
 * @property {boolean} isGroup
 * @property {number}  timestamp   ms
 * @property {'user'|'me'} role
 * @property {string}  text        Decoded body / caption
 * @property {string|null} authorJid  JID of group message author (null for 1:1)
 * @property {string|null} authorName
 * @property {object|null} media    { mimeType, fileName, size, localPath }
 * @property {object} raw           Raw message object for debugging
 */

/**
 * @typedef {Object} GroupInfo
 * @property {string} id          Group JID
 * @property {string} name
 * @property {number} size       Participant count
 * @property {string|null} subjectOwner
 */

/**
 * Driver status shape returned by getStatus().
 * Consumers (routes/wa.js getStatus handler) expect at minimum the fields below,
 * but each driver can extend with driver-specific fields.
 * @typedef {Object} DriverStatus
 * @property {boolean} ready
 * @property {boolean} hasQr
 * @property {string|null} accountPhone  E.164 or null
 * @property {string} driverName         'wwebjs' | 'baileys'
 * @property {string|null} error
 * @property {number} [connectedAt]      ms, set when first becomes ready
 */

/**
 * @typedef {Object} DisconnectInfo
 * @property {number} reason   DisconnectReason code
 * @property {boolean} autoReconnect
 */

/**
 * @typedef {'ready'|'qr'|'disconnect'|'message'|'group_message'|'failed'} WaDriverEvent
 */

/**
 * Minimal interface that all drivers must implement.
 *
 * @typedef {Object} WaDriver
 * @property {(event: WaDriverEvent, handler: Function) => void} on
 * @property {(event: WaDriverEvent, handler: Function) => void} off
 * @property {() => Promise<void>} start
 * @property {() => Promise<void>} stop
 * @property {() => DriverStatus} getStatus
 * @property {() => string|null} getQR
 * @property {(timeoutMs?: number) => Promise<void>} waitForReady
 * @property {(phoneE164: string, text: string) => Promise<SendResult>} sendMessage
 * @property {(phoneE164: string, payload: MediaPayload) => Promise<SendResult>} sendMedia
 * @property {(phoneE164: string, limit?: number) => Promise<IncomingMessage[]>} fetchRecentMessages
 * @property {() => Promise<GroupInfo[]>} fetchGroups
 * @property {(chatId: string, limit?: number) => Promise<IncomingMessage[]>} fetchGroupMessages
 */

module.exports = {};