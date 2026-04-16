#!/usr/bin/env node

const net = require('node:net');
const { spawn } = require('node:child_process');
const path = require('node:path');

let BASE = process.env.API_BASE_URL || '';
const AUTH_TOKEN = (
  process.env.API_AUTH_TOKEN
  || process.env.CRM_ADMIN_TOKEN
  || process.env.WA_ADMIN_TOKEN
  || process.env.AI_PROXY_TOKEN
  || ''
).trim();

async function findFreePort() {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = address && typeof address === 'object' ? address.port : 0;
      server.close((err) => {
        if (err) reject(err);
        else resolve(port);
      });
    });
  });
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForHealth(base, timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${base}/health`);
      if (res.ok) return;
    } catch (_) {}
    await sleep(300);
  }
  throw new Error(`health check timeout after ${timeoutMs}ms`);
}

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
    if (res.status !== expectedStatus) {
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
  let child = null;
  let stdout = '';
  let stderr = '';

  if (!BASE) {
    const port = Number(process.env.API_IT_PORT) || await findFreePort();
    BASE = `http://127.0.0.1:${port}/api`;
    const serverEntry = path.join(process.cwd(), 'server', 'index.cjs');
    child = spawn(process.execPath, [serverEntry], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PORT: String(port),
        DISABLE_WA_SERVICE: 'true',
        DISABLE_WA_WORKER: 'true',
        LOCAL_API_AUTH_BYPASS: 'true',
        NODE_ENV: process.env.NODE_ENV || 'development',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', (chunk) => { stdout += String(chunk); });
    child.stderr.on('data', (chunk) => { stderr += String(chunk); });
    await waitForHealth(BASE);
  }

  console.log('[strategy-api] BASE =', BASE);
  console.log('[strategy-api] AUTH =', AUTH_TOKEN ? 'Bearer <set>' : 'none');
  const before = await request('/strategy-config/unbound-agency');
  if (!Array.isArray(before.strategies) || before.strategies.length === 0) {
    throw new Error('strategy list is empty');
  }

  const marker = ` [api-it-${Date.now()}]`;
  const payload = toPutPayload(before);
  payload.policy_version = `it_${Date.now()}`;
  payload.strategies = payload.strategies.map((item, idx) => (
    idx === 0
      ? { ...item, short_desc: `${item.short_desc || ''}${marker}`.trim() }
      : item
  ));

  try {
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
      if (after.policy_version !== payload.policy_version) {
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
  } finally {
    if (child) {
      child.kill('SIGTERM');
      await Promise.race([
        new Promise((resolve) => child.once('exit', resolve)),
        sleep(5000),
      ]);
      if (child.exitCode === null && !child.killed) {
        child.kill('SIGKILL');
      }
      if (process.env.DEBUG_STRATEGY_API_IT === '1') {
        if (stdout.trim()) console.log('[strategy-api][stdout]\n' + stdout.trim());
        if (stderr.trim()) console.log('[strategy-api][stderr]\n' + stderr.trim());
      }
    }
  }
}

main().catch((err) => {
  console.error('[strategy-api] FAIL:', err.message);
  process.exit(1);
});
