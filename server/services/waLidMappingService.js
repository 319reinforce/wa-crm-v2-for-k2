'use strict';

const crypto = require('crypto');
const db = require('../../db');

const TABLE_NAME = 'wa_lid_mappings';

function normalizeSessionId(value) {
    return String(value || 'default').trim().replace(/[^a-zA-Z0-9._-]/g, '_') || 'default';
}

function normalizeJid(value) {
    return String(value || '').trim().toLowerCase();
}

function isLidJid(value) {
    return normalizeJid(value).endsWith('@lid');
}

function isPnJid(value) {
    return normalizeJid(value).endsWith('@s.whatsapp.net');
}

function phoneFromPnJid(value) {
    const pnJid = normalizeJid(value);
    if (!isPnJid(pnJid)) return null;
    const digits = pnJid.split('@')[0].replace(/\D/g, '');
    return digits || null;
}

function maskPhone(value) {
    const digits = String(value || '').replace(/\D/g, '');
    if (!digits) return null;
    return digits.length <= 4 ? '***' : `***${digits.slice(-4)}`;
}

function phoneHash(value) {
    const digits = String(value || '').replace(/\D/g, '');
    if (!digits) return null;
    return crypto.createHash('sha256').update(digits).digest('hex');
}

function safeJson(value) {
    if (!value || typeof value !== 'object') return null;
    try {
        return JSON.stringify(value).slice(0, 4000);
    } catch (_) {
        return null;
    }
}

function isMissingTableError(error) {
    const code = String(error?.code || '');
    const message = String(error?.message || '');
    return code === 'ER_NO_SUCH_TABLE' || message.includes(TABLE_NAME);
}

async function loadLidMappings(sessionId, { dbConn = db.getDb() } = {}) {
    const safeSessionId = normalizeSessionId(sessionId);
    try {
        const rows = await dbConn.prepare(`
            SELECT lid_jid, pn_jid
            FROM wa_lid_mappings
            WHERE session_id = ?
        `).all(safeSessionId);
        const mappings = new Map();
        for (const row of rows || []) {
            const lidJid = normalizeJid(row.lid_jid);
            const pnJid = normalizeJid(row.pn_jid);
            if (isLidJid(lidJid) && isPnJid(pnJid)) mappings.set(lidJid, pnJid);
        }
        return mappings;
    } catch (error) {
        if (isMissingTableError(error)) return new Map();
        throw error;
    }
}

async function resolveLidJid({ sessionId, lidJid, dbConn = db.getDb() }) {
    const safeSessionId = normalizeSessionId(sessionId);
    const safeLidJid = normalizeJid(lidJid);
    if (!isLidJid(safeLidJid)) return null;
    try {
        const row = await dbConn.prepare(`
            SELECT pn_jid
            FROM wa_lid_mappings
            WHERE session_id = ? AND lid_jid = ?
            LIMIT 1
        `).get(safeSessionId, safeLidJid);
        const pnJid = normalizeJid(row?.pn_jid);
        return isPnJid(pnJid) ? pnJid : null;
    } catch (error) {
        if (isMissingTableError(error)) return null;
        throw error;
    }
}

async function upsertLidMapping({
    sessionId,
    operator = null,
    lidJid,
    pnJid,
    source = 'unknown',
    confidence = 2,
    meta = null,
    dbConn = db.getDb(),
}) {
    const safeSessionId = normalizeSessionId(sessionId);
    const safeLidJid = normalizeJid(lidJid);
    const safePnJid = normalizeJid(pnJid);
    if (!isLidJid(safeLidJid) || !isPnJid(safePnJid)) {
        return { ok: false, reason: 'invalid_jid_pair' };
    }

    const phone = phoneFromPnJid(safePnJid);
    const safeConfidence = Math.max(0, Math.min(3, Number(confidence) || 0));
    const metaJson = safeJson(meta);

    try {
        await dbConn.prepare(`
            INSERT INTO wa_lid_mappings (
                session_id, operator, lid_jid, pn_jid, phone,
                source, confidence, meta_json, first_seen_at, last_seen_at, hit_count
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW(), 1)
            ON DUPLICATE KEY UPDATE
                operator = COALESCE(VALUES(operator), operator),
                pn_jid = VALUES(pn_jid),
                phone = VALUES(phone),
                source = VALUES(source),
                confidence = GREATEST(confidence, VALUES(confidence)),
                meta_json = COALESCE(VALUES(meta_json), meta_json),
                last_seen_at = NOW(),
                hit_count = hit_count + 1,
                updated_at = NOW()
        `).run(
            safeSessionId,
            operator ? String(operator).trim() || null : null,
            safeLidJid,
            safePnJid,
            phone,
            String(source || 'unknown').slice(0, 64),
            safeConfidence,
            metaJson,
        );
        return { ok: true, session_id: safeSessionId, phone_masked: maskPhone(phone), phone_hash: phoneHash(phone) };
    } catch (error) {
        if (isMissingTableError(error)) return { ok: false, reason: 'schema_missing' };
        throw error;
    }
}

module.exports = {
    loadLidMappings,
    resolveLidJid,
    upsertLidMapping,
    normalizeJid,
    isLidJid,
    isPnJid,
    phoneFromPnJid,
    maskPhone,
    phoneHash,
};
