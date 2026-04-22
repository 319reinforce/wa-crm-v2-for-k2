/**
 * @fileoverview Driver factory for whatsapp-mgr dual-driver architecture.
 *
 * Loads the appropriate driver implementation based on sessionConfig.driver.
 * Upper layer (waService.js) never directly requires wwebjs or baileys —
 * always goes through this factory.
 */
const path = require('path');

/**
 * Create a driver instance for the given session.
 * @param {import('./driver/types').SessionConfig} sessionConfig
 * @returns {Promise<WaDriver>} initialized but not started driver
 */
async function createDriver(sessionConfig) {
  const { driver = 'wwebjs' } = sessionConfig;

  if (driver === 'baileys') {
    const BaileysDriver = require('./driver/baileysDriver');
    return new BaileysDriver(sessionConfig);
  }

  if (driver === 'wwebjs') {
    const WwebjsDriver = require('./driver/wwebjsDriver');
    return new WwebjsDriver(sessionConfig);
  }

  throw new Error(`wa: unknown driver '${driver}' — must be 'wwebjs' or 'baileys'`);
}

/**
 * Resolve session config from DB row.
 * Called by session registry when spawning a session process.
 *
 * @param {object} sessionRow  One row from wa_sessions table
 * @returns {import('./driver/types').SessionConfig}
 */
function resolveSessionConfigFromRow(sessionRow) {
  const driver = sessionRow.driver || process.env.WA_DEFAULT_DRIVER || 'wwebjs';

  const authRootDir = driver === 'baileys'
    ? (process.env.WA_BAILEYS_AUTH_ROOT || '/app/.baileys_auth')
    : (process.env.WA_AUTH_ROOT || '/app/.wwebjs_auth');

  return {
    sessionId: sessionRow.session_id,
    owner: sessionRow.owner,
    driver,
    authRootDir,
    driverMeta: sessionRow.driver_meta || {},
  };
}

module.exports = { createDriver, resolveSessionConfigFromRow };