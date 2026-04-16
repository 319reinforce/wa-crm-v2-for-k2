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

const AUDIT_REDACTED_FIELDS = ['wa_phone', 'phone', 'password', 'token', 'secret'];

function sanitizeAuditValue(obj) {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return obj;
    const result = { ...obj };
    for (const field of AUDIT_REDACTED_FIELDS) {
        if (field in result) result[field] = '[REDACTED]';
    }
    return result;
}

async function writeAudit(action, tableName, recordId, beforeValue, afterValue, req) {
    try {
        const db2 = db.getDb();
        const supportsStrings = await detectAuditRecordIdSupportsStrings(db2);
        const normalizedRecordId = supportsStrings
            ? (recordId === null || recordId === undefined ? null : String(recordId))
            : normalizeNumericRecordId(recordId);
        await db2.prepare(`
            INSERT INTO audit_log (action, table_name, record_id, before_value, after_value, ip_address, user_agent)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(
            action,
            tableName,
            normalizedRecordId,
            beforeValue ? JSON.stringify(sanitizeAuditValue(beforeValue)) : null,
            afterValue ? JSON.stringify(sanitizeAuditValue(afterValue)) : null,
            req.ip || req.connection?.remoteAddress || null,
            req.get('User-Agent') || null
        );
    } catch (e) {
        console.error('Audit log error:', e.message);
    }
}

module.exports = { writeAudit };
