#!/usr/bin/env node
/**
 * Guard DB-backed custom topic template imports against label collisions.
 *
 * Input JSON shape:
 *   [
 *     { "owner_scope": "all", "label": "打招呼", "topic_group": "signup_onboarding", ... }
 *   ]
 */

const fs = require('fs');
const path = require('path');

const input = process.argv[2];
if (!input) {
    console.error('Usage: node scripts/validate-custom-topic-template-import.cjs <templates.json>');
    process.exit(2);
}

const absolutePath = path.resolve(process.cwd(), input);
let payload;
try {
    payload = JSON.parse(fs.readFileSync(absolutePath, 'utf8'));
} catch (err) {
    console.error(`Failed to read JSON: ${err.message}`);
    process.exit(2);
}

const templates = Array.isArray(payload) ? payload : payload.templates;
if (!Array.isArray(templates)) {
    console.error('Input must be an array or an object with a templates array');
    process.exit(2);
}

const byOwnerLabel = new Map();
const byLabel = new Map();
const errors = [];
const warnings = [];

templates.forEach((item, idx) => {
    const owner = String(item.owner_scope || 'all').trim() || 'all';
    const label = String(item.label || '').trim();
    const topic = String(item.topic_group || 'custom_topic').trim() || 'custom_topic';
    const intent = String(item.intent_key || 'custom_template').trim() || 'custom_template';

    if (!label) {
        errors.push(`templates[${idx}] missing label`);
        return;
    }

    const ownerLabelKey = `${owner}::${label}`;
    const existing = byOwnerLabel.get(ownerLabelKey);
    if (existing) {
        errors.push(`duplicate owner_scope + label "${ownerLabelKey}" at templates[${existing.idx}] and templates[${idx}]`);
        if (existing.topic !== topic || existing.intent !== intent) {
            errors.push(`duplicate label would overwrite different route: ${existing.topic}/${existing.intent} -> ${topic}/${intent}`);
        }
    } else {
        byOwnerLabel.set(ownerLabelKey, { idx, topic, intent });
    }

    const labelSet = byLabel.get(label) || new Set();
    labelSet.add(`${topic}/${intent}`);
    byLabel.set(label, labelSet);
});

for (const [label, routes] of byLabel.entries()) {
    if (routes.size > 1) {
        warnings.push(`label "${label}" appears in multiple routes: ${Array.from(routes).join(', ')}`);
    }
}

warnings.forEach((warning) => console.warn(`[WARN] ${warning}`));
errors.forEach((error) => console.error(`[ERROR] ${error}`));

if (errors.length > 0) process.exit(1);
console.log(`[OK] custom topic import labels are safe (${templates.length} templates)`);
