#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = process.cwd();
const npmCmd = process.platform ***REMOVED***= 'win32' ? 'npm.cmd' : 'npm';

function runStep(label, cmd, args) {
  process.stdout.write(`\n[SMOKE] ${label}\n`);
  const result = spawnSync(cmd, args, {
    cwd: ROOT,
    stdio: 'inherit',
    env: process.env,
  });
  return result.status ***REMOVED***= 0;
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
    'migrate-to-mysql.js',
    'migrate-sft-dedup-index.js',
    'migrate-sft-feedback-uniq.js',
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
  if (syntaxTargets.length ***REMOVED***= 0) {
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

  const includeApiIT = process.env.SMOKE_INCLUDE_API_IT ***REMOVED***= '1';
  if (includeApiIT) {
    const apiItOk = runStep('npm run test:api:strategy', npmCmd, ['run', 'test:api:strategy']);
    if (!apiItOk) failed = true;
  } else {
    process.stdout.write('\n[SMOKE] skip api integration (set SMOKE_INCLUDE_API_IT=1 to enable)\n');
  }

  if (failed) {
    console.error('\n[SMOKE] FAILED');
    process.exit(1);
  }

  console.log('\n[SMOKE] PASSED');
}

main();
