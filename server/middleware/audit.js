/**
 * writeAudit — 审计日志写入辅助函数
 * Used by: creators, sft, policy, client-memory routes
 */
const db = require('../../db');

function writeAudit(action, tableName, recordId, beforeValue, afterValue, req) {
    try {
        const db2 = db.getDb();
        db2.prepare(`
            INSERT INTO audit_log (action, table_name, record_id, before_value, after_value, ip_address, user_agent)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(
            action,
            tableName,
            recordId,
            beforeValue ? JSON.stringify(beforeValue) : null,
            afterValue ? JSON.stringify(afterValue) : null,
            req.ip || req.connection?.remoteAddress || null,
            req.get('User-Agent') || null
        );
    } catch (e) {
        console.error('Audit log error:', e.message);
    }
}

module.exports = { writeAudit };
