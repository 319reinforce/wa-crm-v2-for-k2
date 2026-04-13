#!/usr/bin/env node

const DEFAULT_API_BASE = process.env.API_BASE || 'http://127.0.0.1:3000';
const DEFAULT_PHONE = process.env.TEST_WA_PHONE || '+8613187012419';
const DEFAULT_SESSION_ID = process.env.TEST_WA_SESSION_ID || 'beau';
const DEFAULT_OPERATOR = process.env.TEST_WA_OPERATOR || 'Beau';

function parseArgs(argv) {
  const options = {};
  for (const entry of argv) {
    if (!entry.startsWith('--')) continue;
    const [rawKey, ...rest] = entry.slice(2).split('=');
    const key = rawKey.trim();
    const value = rest.length > 0 ? rest.join('=') : 'true';
    options[key] = value;
  }
  return options;
}

async function postJson(url, payload) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch (_) {
    data = { raw: text };
  }
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}: ${JSON.stringify(data)}`);
  }
  return data;
}

function buildSmokeText(explicitText) {
  if (explicitText) return explicitText;
  const stamp = new Date().toISOString();
  return `[WA smoke ${stamp}] test message for +8613187012419`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const apiBase = String(args['api-base'] || DEFAULT_API_BASE).replace(/\/$/, '');
  const phone = String(args.phone || DEFAULT_PHONE);
  const sessionId = String(args['session-id'] || DEFAULT_SESSION_ID);
  const operator = String(args.operator || DEFAULT_OPERATOR);
  const creatorIdRaw = args['creator-id'];
  const creatorId = creatorIdRaw ? parseInt(creatorIdRaw, 10) : null;
  const text = buildSmokeText(args.text);

  const payload = {
    phone,
    text,
    session_id: sessionId,
    operator,
  };
  if (Number.isInteger(creatorId) && creatorId > 0) {
    payload.creator_id = creatorId;
  }

  console.log('[wa-send-smoke] sending...');
  console.log(JSON.stringify({
    apiBase,
    phone,
    session_id: sessionId,
    operator,
    creator_id: payload.creator_id || null,
    text,
  }, null, 2));

  const data = await postJson(`${apiBase}/api/wa/send`, payload);
  console.log('[wa-send-smoke] success');
  console.log(JSON.stringify(data, null, 2));
}

main().catch((err) => {
  console.error('[wa-send-smoke] failed:', err.message);
  process.exit(1);
});
