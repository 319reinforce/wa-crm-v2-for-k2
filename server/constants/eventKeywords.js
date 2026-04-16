/**
 * EVENT_KEYWORDS — 轻量召回关键词映射
 * Used by POST /api/events/detect
 */
const { EVENT_RECALL_KEYWORDS } = require('./eventDecisionRules');

const EVENT_KEYWORDS = EVENT_RECALL_KEYWORDS;

module.exports = { EVENT_KEYWORDS };
