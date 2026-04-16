#!/usr/bin/env node

const DEFAULT_API_BASE = process.env.API_BASE || 'http://127.0.0.1:3000';
const DEFAULT_PHONE = process.env.TEST_WA_PHONE || '+8613187012419';
const DEFAULT_SESSION_ID = process.env.TEST_WA_SESSION_ID || 'yiyun';
const DEFAULT_OPERATOR = process.env.TEST_WA_OPERATOR || 'Yiyun';
const DEFAULT_CREATOR_ID = process.env.TEST_WA_CREATOR_ID || '3320';
const DEFAULT_TOKEN = process.env.TEST_WA_TOKEN || '';

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

async function postJson(url, payload, token = '') {
  const headers = { 'Content-Type': 'application/json' };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  const response = await fetch(url, {
    method: 'POST',
    headers,
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

function buildSmokeText(explicitText, phone) {
  if (explicitText) return explicitText;
  const stamp = new Date().toISOString();
  return `[WA smoke ${stamp}] test message for ${phone}`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const apiBase = String(args['api-base'] || DEFAULT_API_BASE).replace(/\/$/, '');
  const phone = String(args.phone || DEFAULT_PHONE);
  const sessionId = String(args['session-id'] || DEFAULT_SESSION_ID);
  const operator = String(args.operator || DEFAULT_OPERATOR);
  const creatorIdRaw = args['creator-id'] || DEFAULT_CREATOR_ID;
  const token = String(args.token || DEFAULT_TOKEN).trim();
  const creatorId = creatorIdRaw ? parseInt(creatorIdRaw, 10) : null;
  const text = buildSmokeText(args.text, phone);

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
    auth_token: token ? '[provided]' : '[none]',
    text,
  }, null, 2));

  const data = await postJson(`${apiBase}/api/wa/send`, payload, token);
  console.log('[wa-send-smoke] success');
  console.log(JSON.stringify(data, null, 2));
}

main().catch((err) => {
  console.error('[wa-send-smoke] failed:', err.message);
  process.exit(1);
});
