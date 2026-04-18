/**
 * writeAudit — 审计日志写入辅助函数
 * Used by: creators, sft, policy, client-memory routes
 */
const db = require('../../db');
let auditRecordIdSupportsStrings = null;

async function detectAuditRecordIdSupportsStrings(db2) {
    if (auditRecordIdSupportsStrings !== null) return auditRecordIdSupportsStrings;
    try {
        const row = await db2.prepare("SHOW COLUMNS FROM audit_log LIKE 'record_id'").get();
        const type = String(row?.Type || '').toLowerCase();
        auditRecordIdSupportsStrings = !/(^|[^a-z])(tinyint|smallint|mediumint|int|bigint|decimal|float|double)([^a-z]|$)/.test(type);
    } catch (_) {
        auditRecordIdSupportsStrings = true;
    }
    return auditRecordIdSupportsStrings;
}

function normalizeNumericRecordId(recordId) {
    if (recordId === null || recordId === undefined) return null;
    if (typeof recordId === 'number' && Number.isFinite(recordId)) return String(recordId);
    if (typeof recordId === 'string' && /^\d+$/.test(recordId.trim())) return recordId.trim();
    return null;
}

const AUDIT_REDACTED_FIELDS = new Set([
    'wa_phone',
    'phone',
    'password',
    'token',
    'secret',
    'client_id',
    'record_id',
]);
const AUDIT_REDACTED_VALUE = '[REDACTED]';

function shouldRedactAuditField(fieldName) {
    return AUDIT_REDACTED_FIELDS.has(String(fieldName || '').trim().toLowerCase());
}

function looksLikePhoneIdentifier(value) {
    const normalized = String(value || '').trim();
    if (!normalized || normalized === AUDIT_REDACTED_VALUE) return false;
    if (!/^[+\d\s\-()]+$/.test(normalized)) return false;
    const digits = normalized.replace(/\D/g, '');
    return digits.length >= 10 && digits.length <= 15;
}

function sanitizeAuditRecordId(recordId) {
    if (recordId === null || recordId === undefined) return null;
    const normalized = typeof recordId === 'string' ? recordId.trim() : recordId;
    const asText = String(normalized || '').trim();
    if (!asText) return null;
    return looksLikePhoneIdentifier(asText) ? AUDIT_REDACTED_VALUE : normalized;
}

function sanitizeAuditValue(value) {
    if (Array.isArray(value)) {
        return value.map((item) => sanitizeAuditValue(item));
    }
    if (!value || typeof value !== 'object') return value;

    return Object.entries(value).reduce((result, [field, fieldValue]) => {
        result[field] = shouldRedactAuditField(field)
            ? AUDIT_REDACTED_VALUE
            : sanitizeAuditValue(fieldValue);
        return result;
    }, {});
}

function parseAuditJsonValue(value) {
    if (value === null || value === undefined) return null;
    if (typeof value !== 'string') return value;
    try {
        return JSON.parse(value);
    } catch (_) {
        return value;
    }
}

function sanitizeAuditLogRow(row = {}) {
    return {
        ...row,
        record_id: sanitizeAuditRecordId(row.record_id),
        before_value: sanitizeAuditValue(parseAuditJsonValue(row.before_value)),
        after_value: sanitizeAuditValue(parseAuditJsonValue(row.after_value)),
    };
}

function resetAuditRecordIdSupportCache() {
    auditRecordIdSupportsStrings = null;
}

async function writeAudit(action, tableName, recordId, beforeValue, afterValue, req) {
    try {
        const db2 = db.getDb();
        const supportsStrings = await detectAuditRecordIdSupportsStrings(db2);
        const sanitizedRecordId = sanitizeAuditRecordId(recordId);
        const normalizedRecordId = supportsStrings
            ? (sanitizedRecordId === null || sanitizedRecordId === undefined ? null : String(sanitizedRecordId))
            : normalizeNumericRecordId(sanitizedRecordId);
        const auth = req?.auth || {};
        const operatorDisplay = auth.owner || auth.username || 'system';
        await db2.prepare(`
            INSERT INTO audit_log (
                action, table_name, record_id,
                operator, user_id, user_role, auth_source, token_principal,
                before_value, after_value, ip_address, user_agent
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            action,
            tableName,
            normalizedRecordId,
            operatorDisplay,
            auth.user_id || null,
            auth.role || null,
            auth.source || null,
            auth.token_principal || null,
            beforeValue ? JSON.stringify(sanitizeAuditValue(beforeValue)) : null,
            afterValue ? JSON.stringify(sanitizeAuditValue(afterValue)) : null,
            req.ip || req.connection?.remoteAddress || null,
            req.get('User-Agent') || null
        );
    } catch (e) {
        console.error('Audit log error:', e.message);
    }
}

module.exports = {
    writeAudit,
    sanitizeAuditValue,
    sanitizeAuditRecordId,
    sanitizeAuditLogRow,
};
module.exports._private = {
    shouldRedactAuditField,
    looksLikePhoneIdentifier,
    parseAuditJsonValue,
    resetAuditRecordIdSupportCache,
};
