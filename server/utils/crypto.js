/**
 * sha256 — SHA256 hash helper
 * Used by: sft routes
 */
const crypto = require('crypto');

function sha256(str) {
    return crypto.createHash('sha256').update(str || '').digest('hex');
}

module.exports = { sha256 };
