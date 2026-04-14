#!/usr/bin/env node

const net = require('node:net');
const { spawn } = require('node:child_process');
const path = require('node:path');

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

function parseJsonSafe(text) {
  try {
    return text ? JSON.parse(text) : null;
  } catch (_) {
    return { raw: text };
  }
}

async function request(base, route, { method = 'GET', body, expectedStatus } = {}) {
  const res = await fetch(`${base}${route}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const json = parseJsonSafe(text);
  if (Number.isInteger(expectedStatus)) {
    if (res.status !== expectedStatus) {
      throw new Error(`${method} ${route} expected HTTP ${expectedStatus}, got ${res.status} ${JSON.stringify(json)}`);
    }
    return json;
  }
  if (!res.ok) {
    throw new Error(`${method} ${route} failed: HTTP ${res.status} ${JSON.stringify(json)}`);
  }
  return json;
}

async function main() {
  const port = Number(process.env.API_IT_PORT) || await findFreePort();
  const base = `http://127.0.0.1:${port}/api`;
  const serverEntry = path.join(process.cwd(), 'server', 'index.cjs');

  console.log('[lifecycle-api] PORT =', port);
  console.log('[lifecycle-api] BASE =', base);

  const child = spawn(process.execPath, [serverEntry], {
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

  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += String(chunk); });
  child.stderr.on('data', (chunk) => { stderr += String(chunk); });

  try {
    await waitForHealth(base);

    const config = await request(base, '/lifecycle-config');
    if (!config.ok) throw new Error('lifecycle-config missing ok=true');
    if (!config.config || typeof config.config !== 'object') {
      throw new Error('lifecycle-config missing config object');
    }
    if ('agency_bound_mainline' in config.config) {
      throw new Error('lifecycle-config still exposes deprecated agency_bound_mainline');
    }

    const dashboard = await request(base, '/lifecycle/dashboard');
    if (!dashboard.ok) throw new Error('lifecycle-dashboard missing ok=true');
    if (dashboard.snapshot_ready !== true) {
      throw new Error(`expected snapshot_ready=true, got ${JSON.stringify(dashboard.snapshot_ready)}`);
    }
    if (!dashboard.stage_counts || typeof dashboard.stage_counts !== 'object') {
      throw new Error('dashboard missing stage_counts');
    }

    const creators = await request(base, '/creators');
    if (!Array.isArray(creators) || creators.length === 0) {
      throw new Error('creators list is empty');
    }
    const first = creators.find((item) => item?.id && item?.lifecycle?.stage_key) || creators[0];
    if (!first?.id) throw new Error('no creator id found in creators list');

    const lifecycle = await request(base, `/creators/${first.id}/lifecycle`);
    const lifecycleStage = lifecycle?.lifecycle?.stage_key || lifecycle?.stage_key;
    if (!lifecycleStage) {
      throw new Error(`creator lifecycle missing stage_key for creator ${first.id}`);
    }

    const history = await request(base, `/creators/${first.id}/lifecycle-history?limit=5`);
    if (!Array.isArray(history?.transitions)) {
      throw new Error('lifecycle-history missing transitions array');
    }
    if (!['transition_table', 'audit_log'].includes(history?.source)) {
      throw new Error(`unexpected lifecycle-history source ${JSON.stringify(history?.source)}`);
    }

    const rebuild = await request(base, '/lifecycle/rebuild', {
      method: 'POST',
      body: {
        creator_ids: [first.id],
        dry_run: true,
        write_snapshot: false,
        write_transition: false,
        reason: 'api_it_dry_run',
      },
    });
    if (!rebuild.ok || rebuild.dry_run !== true) {
      throw new Error('lifecycle rebuild dry-run did not return ok=true and dry_run=true');
    }
    if (!Array.isArray(rebuild.results) || rebuild.results.length === 0) {
      throw new Error('lifecycle rebuild dry-run returned empty results');
    }
    if (Number(rebuild.results[0].creator_id) !== Number(first.id)) {
      throw new Error(`lifecycle rebuild returned unexpected creator_id ${JSON.stringify(rebuild.results[0])}`);
    }

    console.log('[lifecycle-api] PASS');
  } finally {
    child.kill('SIGTERM');
    await Promise.race([
      new Promise((resolve) => child.once('exit', resolve)),
      sleep(5000),
    ]);
    if (child.exitCode === null && !child.killed) {
      child.kill('SIGKILL');
    }
    if (process.env.DEBUG_LIFECYCLE_API_IT === '1') {
      if (stdout.trim()) console.log('[lifecycle-api][stdout]\n' + stdout.trim());
      if (stderr.trim()) console.log('[lifecycle-api][stderr]\n' + stderr.trim());
    }
  }
}

main().catch((err) => {
  console.error('[lifecycle-api] FAIL:', err.message);
  process.exit(1);
});
