/**
 * JID utilities for dual-driver WA.
 *
 * wwebjs JID format:  phone@c.us
 * Baileys JID format: phone@s.whatsapp.net
 * Both use:           group_id@g.us (identical)
 */
'use strict';

/**
 * Convert E.164 phone to driver's native JID format.
 * @param {string} phoneE164  e.g. "+85255550001"
 * @param {'wwebjs'|'baileys'} [driver='baileys']
 * @returns {string} JID
 */
function normalizeJid(phoneE164, driver = 'baileys') {
    const digits = String(phoneE164).replace(/[^\d]/g, '');
    const suffix = driver === 'baileys' ? '@s.whatsapp.net' : '@c.us';
    return `${digits}${suffix}`;
}

/** @param {string|null|undefined} jid @returns {boolean} */
function isGroupJid(jid) {
    return String(jid || '').endsWith('@g.us');
}

/** @param {string} jid @returns {string} E.164, e.g. "+85255550001" */
function jidToPhoneE164(jid) {
    if (!jid) return '';
    const base = String(jid).split('@')[0].replace(/:.*$/, '');
    return `+${base}`;
}

/** @param {string} jid @returns {string} */
function bareJid(jid) {
    if (!jid) return '';
    return String(jid).split(':')[0];
}

module.exports = { normalizeJid, isGroupJid, jidToPhoneE164, bareJid };
