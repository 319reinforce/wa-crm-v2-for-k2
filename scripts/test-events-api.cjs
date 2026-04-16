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
      server.close((err) => err ? reject(err) : resolve(port));
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

function isSkippableVerifyDependencyError(error) {
  const message = String(error?.message || error || '');
  return /OpenAI API key not configured/i.test(message)
    || /insufficient_quota/i.test(message)
    || /\b429\b/.test(message)
    || /rate limit/i.test(message)
    || /MODEL_CAPACITY_EXHAUSTED/i.test(message)
    || /capacity exhausted/i.test(message)
    || /OpenAI error 503/i.test(message);
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

  console.log('[events-api] PORT =', port);
  console.log('[events-api] BASE =', base);

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

  let createdEventId = null;

  try {
    await waitForHealth(base);

    const creators = await request(base, '/creators');
    const list = Array.isArray(creators) ? creators : [];
    if (list.length === 0) throw new Error('creators list is empty');

    let targetCreator = null;
    let message = null;
    for (const creator of list.slice(0, 40)) {
      const messageData = await request(base, `/creators/${creator.id}/messages?limit=20`);
      const messages = Array.isArray(messageData?.messages) ? messageData.messages : [];
      const candidate = [...messages].reverse().find((item) => String(item?.text || '').trim());
      if (candidate) {
        targetCreator = creator;
        message = candidate;
        break;
      }
    }

    if (!targetCreator || !message) {
      throw new Error('no creator with usable messages found');
    }

    const detect = await request(base, '/events/detect', {
      method: 'POST',
      body: {
        creator_id: targetCreator.id,
        text: message.text,
        source_message_id: message.id,
        source_message_timestamp: message.timestamp,
        source_message_hash: message.message_hash || null,
      },
    });
    if (!Array.isArray(detect?.detected)) {
      throw new Error('events detect missing detected array');
    }

    const create = await request(base, '/events', {
      method: 'POST',
      body: {
        creator_id: targetCreator.id,
        event_key: 'trial_7day',
        event_type: 'challenge',
        owner: targetCreator.wa_owner || 'Yiyun',
        trigger_source: 'semantic_auto',
        trigger_text: String(message.text || '').slice(0, 280),
        meta: {
          source_text: String(message.text || '').slice(0, 280),
          source_anchor: {
            message_id: message.id,
            timestamp: message.timestamp,
            message_hash: message.message_hash || null,
          },
        },
      },
    });
    createdEventId = Number(create?.id || 0);
    if (!createdEventId) throw new Error('event create did not return id');

    const event = await request(base, `/events/${createdEventId}`);
    if (!event?.source_anchor || Number(event?.source_message_id || 0) !== Number(message.id)) {
      throw new Error('created event did not retain source anchor');
    }

    const context = await request(base, `/events/${createdEventId}/verification-context`);
    if (!Array.isArray(context?.messages) || context.messages.length === 0) {
      throw new Error('verification-context missing messages');
    }
    if (!context?.source_anchor || Number(context.source_anchor.message_id || 0) <= 0) {
      throw new Error('verification-context missing source_anchor');
    }

    try {
      const verify = await request(base, `/events/${createdEventId}/verify`, {
        method: 'POST',
        body: { context_window: { before: 5, after: 4 } },
      });
      const status = verify?.verification?.review_status;
      if (!['confirmed', 'rejected', 'uncertain'].includes(status)) {
        throw new Error(`unexpected verification review_status ${JSON.stringify(status)}`);
      }
    } catch (err) {
      if (isSkippableVerifyDependencyError(err)) {
        console.log('[events-api] skip OpenAI verify step because verification dependency is unavailable:', String(err.message || err));
      } else {
        throw err;
      }
    }

    await request(base, `/events/${createdEventId}`, { method: 'DELETE' });
    createdEventId = null;

    console.log('[events-api] PASS');
  } finally {
    if (createdEventId) {
      try {
        await request(base, `/events/${createdEventId}`, { method: 'DELETE', expectedStatus: 200 });
      } catch (_) {}
    }
    child.kill('SIGTERM');
    await Promise.race([
      new Promise((resolve) => child.once('exit', resolve)),
      sleep(5000),
    ]);
    if (child.exitCode === null && !child.killed) child.kill('SIGKILL');
    if (process.env.DEBUG_EVENTS_API_IT === '1') {
      if (stdout.trim()) console.log('[events-api][stdout]\n' + stdout.trim());
      if (stderr.trim()) console.log('[events-api][stderr]\n' + stderr.trim());
    }
  }
}

main().catch((err) => {
  console.error('[events-api] FAIL:', err.message);
  process.exit(1);
});
