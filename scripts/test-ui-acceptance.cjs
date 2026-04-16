#!/usr/bin/env node

const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

const ROOT = process.cwd();
const REPORT_DIR = path.join(ROOT, 'reports', 'acceptance');
const SERVER_ENTRY = path.join(ROOT, 'server', 'index.cjs');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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

async function waitForHealth(base, timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${base}/api/health`);
      if (res.ok) return;
    } catch (_) {}
    await sleep(300);
  }
  throw new Error(`health check timeout after ${timeoutMs}ms`);
}

function ensureReportDir() {
  fs.mkdirSync(REPORT_DIR, { recursive: true });
}

function resolveGlobalPlaywrightPath() {
  const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const result = spawnSync(npmCmd, ['root', '-g'], {
    cwd: ROOT,
    env: process.env,
    encoding: 'utf8',
  });
  if (result.status !== 0) return null;
  const globalRoot = String(result.stdout || '').trim();
  if (!globalRoot) return null;
  return path.join(globalRoot, 'playwright');
}

function resolvePlaywright() {
  try {
    return require('playwright');
  } catch (localError) {
    const globalPath = resolveGlobalPlaywrightPath();
    if (globalPath) {
      try {
        return require(globalPath);
      } catch (_) {}
    }
    throw new Error(`playwright not installed or not resolvable: ${localError.message}`);
  }
}

function summarizeResult(result) {
  return {
    url: result.url,
    checks: result.checks,
    screenshots: result.screenshots,
    reportPath: result.reportPath,
  };
}

async function runBrowserChecks(url) {
  ensureReportDir();
  const playwright = resolvePlaywright();
  const browser = await playwright.chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const accessToken = String(process.env.UI_ACCEPTANCE_TOKEN || '').trim();
  const targetUrl = accessToken
    ? `${url}${url.includes('?') ? '&' : '?'}token=${encodeURIComponent(accessToken)}`
    : url;

  const consoleErrors = [];
  const pageErrors = [];

  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => {
    pageErrors.push(String(err?.message || err));
  });

  const nav = { ok: false, status: null };
  try {
    const response = await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
    nav.ok = Boolean(response);
    nav.status = response ? response.status() : null;
  } catch (error) {
    nav.error = String(error?.message || error);
  }

  await page.waitForTimeout(2500);
  try {
    await page.waitForLoadState('networkidle', { timeout: 12000 });
  } catch (_) {}

  const homeScreenshot = path.join(REPORT_DIR, 'ui-home.png');
  await page.screenshot({ path: homeScreenshot, fullPage: true });

  const bodyTextLen = await page.evaluate(() => (document.body?.innerText || '').trim().length);
  const hasOverlay = await page.evaluate(() => (
    Boolean(document.querySelector('[data-nextjs-dialog], .vite-error-overlay, #webpack-dev-server-client-overlay'))
  ));
  const homeHasTitle = await page.locator('text=消息工作台').first().isVisible().catch(() => false);
  const groupButtonVisible = await page.locator('button:has-text("群聊")').first().isVisible().catch(() => false);

  let groupViewVisible = false;
  let groupEmptyOrSelectedVisible = false;
  if (groupButtonVisible) {
    await page.locator('button:has-text("群聊")').first().click();
    await page.waitForTimeout(1000);
    groupViewVisible = await page.locator('text=群聊归档').first().isVisible().catch(() => false);
    groupEmptyOrSelectedVisible = await Promise.any([
      page.locator('text=选择一个群聊').first().isVisible(),
      page.locator('text=Group Archive').first().isVisible(),
    ]).catch(() => false);
  }

  const groupScreenshot = path.join(REPORT_DIR, 'ui-groups.png');
  await page.screenshot({ path: groupScreenshot, fullPage: true });

  await browser.close();

  const checks = {
    bodyTextLen,
    hasOverlay,
    homeHasTitle,
    groupButtonVisible,
    groupViewVisible,
    groupEmptyOrSelectedVisible,
    consoleErrorCount: consoleErrors.length,
    pageErrorCount: pageErrors.length,
  };

  const reportPath = path.join(REPORT_DIR, 'ui-acceptance.json');
  const result = {
    url: targetUrl,
    nav,
    checks,
    consoleErrors,
    pageErrors,
    screenshots: {
      home: homeScreenshot,
      groups: groupScreenshot,
    },
    reportPath,
  };
  fs.writeFileSync(reportPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');

  const failures = [];
  if (!nav.ok || nav.status !== 200) failures.push(`page navigation failed (${JSON.stringify(nav)})`);
  if (bodyTextLen === 0) failures.push('page body is blank');
  if (hasOverlay) failures.push('error overlay detected');
  if (!homeHasTitle) failures.push('home workspace title not visible');
  if (!groupButtonVisible) failures.push('group tab button not visible');
  if (!groupViewVisible) failures.push('group archive view not visible after switching');
  if (!groupEmptyOrSelectedVisible) failures.push('group detail panel did not render expected empty or selected state');
  if (consoleErrors.length > 0) failures.push(`console errors detected (${consoleErrors.length})`);
  if (pageErrors.length > 0) failures.push(`page errors detected (${pageErrors.length})`);

  if (failures.length > 0) {
    throw new Error(`${failures.join('; ')}. report=${reportPath}`);
  }

  return result;
}

async function main() {
  const explicitBaseUrl = String(process.env.UI_ACCEPTANCE_BASE_URL || '').trim();
  let child = null;
  let serverStdout = '';
  let serverStderr = '';
  let baseUrl = explicitBaseUrl;

  try {
    if (!baseUrl) {
      const port = Number(process.env.UI_ACCEPTANCE_PORT) || await findFreePort();
      baseUrl = `http://127.0.0.1:${port}`;
      child = spawn(process.execPath, [SERVER_ENTRY], {
        cwd: ROOT,
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
      child.stdout.on('data', (chunk) => { serverStdout += String(chunk); });
      child.stderr.on('data', (chunk) => { serverStderr += String(chunk); });
      await waitForHealth(baseUrl);
    }

    const result = await runBrowserChecks(baseUrl);
    console.log(JSON.stringify(summarizeResult(result), null, 2));
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
    }
    if (process.env.DEBUG_UI_ACCEPTANCE === '1') {
      if (serverStdout.trim()) console.log('[ui-acceptance][server-stdout]\n' + serverStdout.trim());
      if (serverStderr.trim()) console.log('[ui-acceptance][server-stderr]\n' + serverStderr.trim());
    }
  }
}

main().catch((error) => {
  console.error('[ui-acceptance] FAIL:', error.message);
  if (String(error.message || '').includes('Executable doesn\'t exist')) {
    console.error('[ui-acceptance] Hint: run `npx playwright install chromium` before retrying locally.');
  }
  process.exit(1);
});
