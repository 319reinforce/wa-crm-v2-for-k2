const defaults = require('../../config/unbound-agency-strategies.json');

const DEFAULT_POLICY_KEY = defaults.policy_key || 'strategy.unbound_agency';

function parseJsonSafe(value, fallback) {
    if (value ***REMOVED***= null || value ***REMOVED***= undefined) return fallback;
    if (typeof value ***REMOVED***= 'object') return value;
    try {
        return JSON.parse(value);
    } catch (_) {
        return fallback;
    }
}

function normalizeTextArray(value) {
    if (!Array.isArray(value)) return [];
    return value
        .map((item) => String(item || '').trim())
        .filter(Boolean);
}

function normalizeStrategy(item = {}) {
    const id = String(item.id || '').trim();
    const name = String(item.name || '').trim();
    const name_en = String(item.name_en ?? item.nameEn ?? '').trim();
    const short_desc = String(item.short_desc ?? item.shortDesc ?? '').trim();
    const memory_key = String(item.memory_key ?? item.memoryKey ?? '').trim();
    const memory_value = String(item.memory_value ?? item.memoryValue ?? '').trim();
    const next_action_template = String(item.next_action_template ?? item.nextActionTemplate ?? '').trim();
    const next_action_template_en = String(item.next_action_template_en ?? item.nextActionTemplateEn ?? '').trim();
    const prompt_hint = String(item.prompt_hint ?? item.promptHint ?? '').trim();
    const prompt_hint_en = String(item.prompt_hint_en ?? item.promptHintEn ?? '').trim();
    const aliases = normalizeTextArray(item.aliases || []);
    const priorityRaw = Number(item.priority);
    const priority = Number.isFinite(priorityRaw) ? priorityRaw : 0;

    return {
        id,
        name,
        name_en,
        short_desc,
        memory_key,
        memory_value,
        next_action_template,
        next_action_template_en,
        prompt_hint,
        prompt_hint_en,
        aliases,
        priority,
    };
}

function normalizeStrategies(value) {
    if (!Array.isArray(value)) return [];
    return value.map(normalizeStrategy).filter((item) => item.id && item.name && item.memory_key);
}

function buildDefaultPayload() {
    return {
        policy_key: DEFAULT_POLICY_KEY,
        policy_version: defaults.policy_version || 'v1',
        applicable_scenarios: normalizeTextArray(defaults.applicable_scenarios || []),
        strategies: normalizeStrategies(defaults.strategies || []),
    };
}

function extractPayloadFromRow(row) {
    const fallback = buildDefaultPayload();
    if (!row) return { ...fallback, source: 'default', updated_at: null };

    const contentObj = parseJsonSafe(row.policy_content, {});
    const contentStrategies = normalizeStrategies(contentObj?.strategies || []);
    const strategies = contentStrategies.length > 0 ? contentStrategies : fallback.strategies;
    return {
        policy_key: row.policy_key || fallback.policy_key,
        policy_version: row.policy_version || fallback.policy_version,
        applicable_scenarios: normalizeTextArray(parseJsonSafe(row.applicable_scenarios, fallback.applicable_scenarios)),
        strategies,
        source: contentStrategies.length > 0 ? 'db' : 'default',
        updated_at: row.updated_at || null,
    };
}

module.exports = {
    DEFAULT_POLICY_KEY,
    parseJsonSafe,
    normalizeTextArray,
    normalizeStrategy,
    normalizeStrategies,
    buildDefaultPayload,
    extractPayloadFromRow,
};
