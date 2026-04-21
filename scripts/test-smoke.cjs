#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = process.cwd();
const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function shouldRunDestructiveGroupPollutionPurge(env = process.env) {
  return env.SMOKE_PURGE_GROUP_POLLUTION === '1';
}

function runStep(label, cmd, args) {
  process.stdout.write(`\n[SMOKE] ${label}\n`);
  const result = spawnSync(cmd, args, {
    cwd: ROOT,
    stdio: 'inherit',
    env: process.env,
  });
  return result.status === 0;
}

function collectServerFiles() {
  const startDir = path.join(ROOT, 'server');
  const files = [];
  if (!fs.existsSync(startDir)) return files;

  const stack = [startDir];
  while (stack.length > 0) {
    const current = stack.pop();
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }
      if (!entry.isFile()) continue;
      if (fullPath.endsWith('.js') || fullPath.endsWith('.cjs')) {
        files.push(path.relative(ROOT, fullPath));
      }
    }
  }

  return files.sort();
}

function collectSyntaxTargets() {
  const targets = new Set(collectServerFiles());
    const rootCandidates = [
        'db.js',
        'systemPromptBuilder.cjs',
        'migrate-sft-dedup-index.js',
        'migrate-sft-feedback-uniq.js',
        'migrate-sft-generation-columns.js',
    ];
  for (const candidate of rootCandidates) {
    if (fs.existsSync(path.join(ROOT, candidate))) {
      targets.add(candidate);
    }
  }
  return [...targets];
}

function main() {
  const syntaxTargets = collectSyntaxTargets();
  if (syntaxTargets.length === 0) {
    console.error('[SMOKE] No syntax targets found');
    process.exit(1);
  }

  let failed = false;
  for (const file of syntaxTargets) {
    const ok = runStep(`node --check ${file}`, process.execPath, ['--check', file]);
    if (!ok) failed = true;
  }

  const buildOk = runStep('npm run build', npmCmd, ['run', 'build']);
  if (!buildOk) failed = true;

  const unitOk = runStep('npm run test:unit', npmCmd, ['run', 'test:unit']);
  if (!unitOk) failed = true;

  const includeApiIT = process.env.SMOKE_INCLUDE_API_IT === '1';
  if (includeApiIT) {
    const apiItOk = runStep('npm run test:api:strategy', npmCmd, ['run', 'test:api:strategy']);
    if (!apiItOk) failed = true;
    const lifecycleApiItOk = runStep('npm run test:api:lifecycle', npmCmd, ['run', 'test:api:lifecycle']);
    if (!lifecycleApiItOk) failed = true;
    const eventsApiItOk = runStep('npm run test:api:events', npmCmd, ['run', 'test:api:events']);
    if (!eventsApiItOk) failed = true;
    const purgeGroupPollution = shouldRunDestructiveGroupPollutionPurge(process.env);
    if (purgeGroupPollution) {
      const groupPurgeOk = runStep(
        'npm run test:data:group-pollution:purge',
        npmCmd,
        ['run', 'test:data:group-pollution:purge']
      );
      if (!groupPurgeOk) failed = true;
    } else {
      process.stdout.write('\n[SMOKE] skip destructive group-pollution purge by default (set SMOKE_PURGE_GROUP_POLLUTION=1 to enable)\n');
    }
    const groupPollutionOk = runStep('npm run test:data:group-pollution', npmCmd, ['run', 'test:data:group-pollution']);
    if (!groupPollutionOk) failed = true;
  } else {
    process.stdout.write('\n[SMOKE] skip api integration (set SMOKE_INCLUDE_API_IT=1 to enable)\n');
  }

  const includeUiIT = process.env.SMOKE_INCLUDE_UI_IT === '1';
  if (includeUiIT) {
    const uiAcceptanceOk = runStep('npm run test:ui:acceptance', npmCmd, ['run', 'test:ui:acceptance']);
    if (!uiAcceptanceOk) failed = true;
  } else {
    process.stdout.write('\n[SMOKE] skip ui acceptance (set SMOKE_INCLUDE_UI_IT=1 to enable)\n');
  }

  const includeWaSend = process.env.SMOKE_INCLUDE_WA_SEND === '1';
  if (includeWaSend) {
    const phone = process.env.TEST_WA_PHONE || '+8613187012419';
    const waSendOk = runStep(`npm run wa:smoke -> ${phone}`, npmCmd, ['run', 'wa:smoke']);
    if (!waSendOk) failed = true;
  } else {
    process.stdout.write('\n[SMOKE] skip wa send smoke (set SMOKE_INCLUDE_WA_SEND=1 to enable)\n');
  }

  const includeBaileys = process.env.SMOKE_INCLUDE_BAILEYS === '1';
  if (includeBaileys) {
    // Unit-level driver load checks (no real WA account needed)
    const bailLoadOk = runStep('node --test tests/unit/baileysDriver.unit.test.mjs', process.execPath, ['--test', 'tests/unit/baileysDriver.unit.test.mjs']);
    if (!bailLoadOk) failed = true;
    const switchLoadOk = runStep('node --test tests/integration/driverSwitch.test.mjs', process.execPath, ['--test', 'tests/integration/driverSwitch.test.mjs']);
    if (!switchLoadOk) failed = true;
    // Full integration requires WA_INTEGRATION=1
    if (process.env.WA_INTEGRATION === '1') {
      const bailSendOk = runStep('node --test tests/integration/baileysSendMessage.test.mjs', process.execPath, ['--test', 'tests/integration/baileysSendMessage.test.mjs']);
      if (!bailSendOk) failed = true;
      const bailRecvOk = runStep('node --test tests/integration/baileysReceiveMessage.test.mjs', process.execPath, ['--test', 'tests/integration/baileysReceiveMessage.test.mjs']);
      if (!bailRecvOk) failed = true;
    } else {
      process.stdout.write('\n[SMOKE] skip baileys integration (set WA_INTEGRATION=1 to enable)\n');
    }
  } else {
    process.stdout.write('\n[SMOKE] skip baileys smoke (set SMOKE_INCLUDE_BAILEYS=1 to enable)\n');
  }

  if (failed) {
    console.error('\n[SMOKE] FAILED');
    process.exit(1);
  }

  console.log('\n[SMOKE] PASSED');
}

module.exports = {
  main,
  _private: {
    shouldRunDestructiveGroupPollutionPurge,
    collectServerFiles,
    collectSyntaxTargets,
  },
};

if (require.main === module) {
  main();
}
