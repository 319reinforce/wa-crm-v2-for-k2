#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const qrcode = require('qrcode-terminal');

let activeLockPath = '';

function parseArgs(argv) {
  const args = {
    mode: 'single',
    session: 'yiyun',
    intervalMs: 20000,
    start: 'beau',
    apiBase: 'http://127.0.0.1:3000',
  };

  if (argv[0] === 'single' || argv[0] === 'batch') {
    args.mode = argv[0];
    argv = argv.slice(1);
  }

  for (let i = 0; i < argv.length; i += 1) {
    const token = String(argv[i] || '');
    if (token === '--mode' || token === '-m') {
      const next = String(argv[i + 1] || '').trim().toLowerCase();
      if (next === 'single' || next === 'batch') args.mode = next;
      i += 1;
      continue;
    }
    if (token === '--session' || token === '-s') {
      args.session = String(argv[i + 1] || '').trim() || args.session;
      i += 1;
      continue;
    }
    if (token === '--interval' || token === '-i') {
      const ms = Number(argv[i + 1]);
      if (Number.isFinite(ms) && ms >= 300) args.intervalMs = ms;
      i += 1;
      continue;
    }
    if (token === '--start') {
      args.start = String(argv[i + 1] || '').trim() || args.start;
      i += 1;
      continue;
    }
    if (token === '--api-base') {
      args.apiBase = String(argv[i + 1] || '').trim() || args.apiBase;
      i += 1;
      continue;
    }
  }
  return args;
}

function readStatus(statusPath) {
  try {
    const raw = fs.readFileSync(statusPath, 'utf8');
    return JSON.parse(raw);
  } catch (_) {
    return null;
  }
}

function lockPathForSession(sessionId) {
  return path.join('/tmp', `wa-qr-watch-${sessionId}.lock`);
}

function acquireSingleLock(sessionId) {
  const lockPath = lockPathForSession(sessionId);
  activeLockPath = lockPath;
  try {
    const raw = fs.readFileSync(lockPath, 'utf8').trim();
    const pid = Number(raw);
    if (Number.isInteger(pid) && pid > 0) {
      try {
        process.kill(pid, 0);
        if (pid !== process.pid) {
          console.error(`[watch-wa-qr] another renderer is running for session=${sessionId} (pid=${pid})`);
          process.exit(1);
        }
      } catch (_) {}
    }
  } catch (_) {}

  fs.writeFileSync(lockPath, String(process.pid));
}

function releaseSingleLock() {
  if (!activeLockPath) return;
  try {
    const raw = fs.readFileSync(activeLockPath, 'utf8').trim();
    if (Number(raw) === process.pid) {
      fs.unlinkSync(activeLockPath);
    }
  } catch (_) {}
}

function clearScreen() {
  process.stdout.write('\x1Bc');
}

function renderState(status, sessionId) {
  const ts = new Date().toISOString();
  const hasStatus = !!status;
  const ready = !!status?.ready;
  const hasQr = !!status?.hasQr && !!status?.qr_value;

  clearScreen();
  console.log(`[watch-wa-qr] session=${sessionId}`);
  console.log(`[watch-wa-qr] now=${ts}`);
  if (!hasStatus) {
    console.log('[watch-wa-qr] status file not found yet, waiting...');
    return;
  }

  console.log(
    `[watch-wa-qr] updated_at=${status.updated_at || 'n/a'} ready=${ready} hasQr=${hasQr} qr_refresh_count=${status.qr_refresh_count || 0}`
  );
  if (status.error) {
    console.log(`[watch-wa-qr] error=${status.error}`);
  }

  if (ready) {
    console.log('[watch-wa-qr] WhatsApp already ready, no QR needed.');
    return;
  }

  if (!hasQr) {
    console.log('[watch-wa-qr] QR not available yet, waiting...');
    return;
  }

  console.log('='.repeat(56));
  qrcode.generate(String(status.qr_value), { small: true });
  console.log('='.repeat(56));
  console.log('[watch-wa-qr] Scan path: WhatsApp -> Linked devices -> Link a device');
}

function runSingle({ session, intervalMs }) {
  acquireSingleLock(session);
  process.on('exit', () => releaseSingleLock());
  const statusPath = path.join(process.cwd(), '.wa_ipc', 'status', `${session}.json`);
  let lastRenderKey = '';
  let warnedWidth = false;

  const tick = () => {
    const status = readStatus(statusPath);
    const cols = Number(process.stdout.columns || 0);
    if (!warnedWidth && cols > 0 && cols < 72) {
      warnedWidth = true;
      clearScreen();
      console.log(`[watch-wa-qr] warning: terminal width ${cols} is narrow; QR may appear truncated.`);
      console.log('[watch-wa-qr] please widen terminal to at least 72 columns.');
    }
    const renderKey = status
      ? `${status.qr_value || ''}|${status.ready ? 1 : 0}|${status.hasQr ? 1 : 0}|${status.error || ''}`
      : 'missing';
    if (renderKey !== lastRenderKey) {
      lastRenderKey = renderKey;
      renderState(status, session);
    }
  };

  tick();
  const timer = setInterval(tick, intervalMs);

  process.on('SIGINT', () => {
    clearInterval(timer);
    releaseSingleLock();
    console.log('\n[watch-wa-qr] stopped by SIGINT');
    process.exit(0);
  });
  process.on('SIGTERM', () => {
    clearInterval(timer);
    releaseSingleLock();
    console.log('\n[watch-wa-qr] stopped by SIGTERM');
    process.exit(0);
  });
}

function runBatch({ start, apiBase, intervalMs }) {
  const scriptPath = path.join(process.cwd(), 'scripts', 'wa-session.sh');
  if (!fs.existsSync(scriptPath)) {
    console.error(`[watch-wa-qr] missing script: ${scriptPath}`);
    process.exit(1);
  }

  console.log(`[watch-wa-qr] batch mode start=${start} apiBase=${apiBase}`);
  console.log('[watch-wa-qr] renderer strategy: redraw only when QR/status changes');

  const child = spawn('bash', [scriptPath, 'start-auto-route', start, apiBase], {
    stdio: 'inherit',
    env: {
      ...process.env,
      WA_QR_RENDER_ENABLED: '1',
      WA_QR_RENDER_INTERVAL_MS: String(intervalMs),
    },
  });

  child.on('exit', (code, signal) => {
    if (signal) {
      console.error(`[watch-wa-qr] batch stopped by signal: ${signal}`);
      process.exit(1);
    }
    process.exit(code || 0);
  });
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.mode === 'batch') {
    runBatch(args);
    return;
  }
  runSingle(args);
}

main();
