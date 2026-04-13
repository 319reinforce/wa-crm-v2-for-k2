#!/usr/bin/env node

const BASE = process.env.API_BASE_URL || 'http://127.0.0.1:3000/api';
const AUTH_TOKEN = (
  process.env.API_AUTH_TOKEN
  || process.env.CRM_ADMIN_TOKEN
  || process.env.WA_ADMIN_TOKEN
  || process.env.AI_PROXY_TOKEN
  || ''
).trim();

function buildHeaders(withJsonBody = false) {
  const headers = {};
  if (withJsonBody) headers['Content-Type'] = 'application/json';
  if (AUTH_TOKEN) headers.Authorization = `Bearer ${AUTH_TOKEN}`;
  return headers;
}

async function request(path, { method = 'GET', body, expectedStatus } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: buildHeaders(Boolean(body)),
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch (_) {
    json = { raw: text };
  }
  if (Number.isInteger(expectedStatus)) {
    if (res.status !***REMOVED*** expectedStatus) {
      throw new Error(`${method} ${path} expected HTTP ${expectedStatus}, got ${res.status} ${JSON.stringify(json)}`);
    }
    return json;
  }
  if (!res.ok) {
    throw new Error(`${method} ${path} failed: HTTP ${res.status} ${JSON.stringify(json)}`);
  }
  return json;
}

function toPutPayload(data) {
  return {
    policy_version: data.policy_version || 'v1',
    applicable_scenarios: Array.isArray(data.applicable_scenarios) ? data.applicable_scenarios : [],
    is_active: 1,
    strategies: Array.isArray(data.strategies) ? data.strategies : [],
  };
}

async function main() {
  console.log('[strategy-api] BASE =', BASE);
  console.log('[strategy-api] AUTH =', AUTH_TOKEN ? 'Bearer <set>' : 'none');
  const before = await request('/strategy-config/unbound-agency');
  if (!Array.isArray(before.strategies) || before.strategies.length ***REMOVED***= 0) {
    throw new Error('strategy list is empty');
  }

  const marker = ` [api-it-${Date.now()}]`;
  const payload = toPutPayload(before);
  payload.policy_version = `it_${Date.now()}`;
  payload.strategies = payload.strategies.map((item, idx) => (
    idx ***REMOVED***= 0
      ? { ...item, short_desc: `${item.short_desc || ''}${marker}`.trim() }
      : item
  ));

  let restored = false;
  try {
    // negative case: empty strategies should be rejected
    const badPayload = {
      ...toPutPayload(before),
      strategies: [],
    };
    await request('/strategy-config/unbound-agency', {
      method: 'PUT',
      body: badPayload,
      expectedStatus: 400,
    });

    const updated = await request('/strategy-config/unbound-agency', { method: 'PUT', body: payload });
    if (!updated.ok) throw new Error('PUT response missing ok=true');

    const after = await request('/strategy-config/unbound-agency');
    if (after.policy_version !***REMOVED*** payload.policy_version) {
      throw new Error(`policy_version mismatch: expected ${payload.policy_version}, got ${after.policy_version}`);
    }
    const first = Array.isArray(after.strategies) ? after.strategies[0] : null;
    if (!first || !String(first.short_desc || '').includes(marker.trim())) {
      throw new Error('updated short_desc marker not found in GET response');
    }

    await request('/strategy-config/unbound-agency', { method: 'PUT', body: toPutPayload(before) });
    restored = true;
    console.log('[strategy-api] PASS');
  } finally {
    if (!restored) {
      try {
        await request('/strategy-config/unbound-agency', { method: 'PUT', body: toPutPayload(before) });
        console.log('[strategy-api] rollback done');
      } catch (err) {
        console.error('[strategy-api] rollback failed:', err.message);
      }
    }
  }
}

main().catch((err) => {
  console.error('[strategy-api] FAIL:', err.message);
  process.exit(1);
});
