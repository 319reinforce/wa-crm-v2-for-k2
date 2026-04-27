#!/usr/bin/env node
require('dotenv').config();

const db = require('../db');
const { runRetentionArchiveJobs } = require('../server/services/dataRetentionService');

function parseArgs(argv) {
    const args = {
        apply: false,
        policyKey: null,
        limit: null,
        includeDisabled: false,
    };
    for (const arg of argv) {
        if (arg === '--apply') {
            args.apply = true;
        } else if (arg === '--dry-run') {
            args.apply = false;
        } else if (arg === '--include-disabled') {
            args.includeDisabled = true;
        } else if (arg.startsWith('--policy=')) {
            args.policyKey = arg.slice('--policy='.length).trim() || null;
        } else if (arg.startsWith('--limit=')) {
            const numeric = Number(arg.slice('--limit='.length));
            args.limit = Number.isFinite(numeric) && numeric > 0 ? Math.trunc(numeric) : null;
        } else if (arg === '--help' || arg === '-h') {
            args.help = true;
        } else {
            throw new Error(`Unknown argument: ${arg}`);
        }
    }
    return args;
}

function printHelp() {
    console.log(`Usage:
  node scripts/run-retention-archive-jobs.cjs [--dry-run] [--apply] [--policy=<key>] [--limit=<n>]

Default mode is --dry-run. Dry-run reads candidates only and does not write archive refs or update media tiers.

Examples:
  node scripts/run-retention-archive-jobs.cjs --dry-run
  node scripts/run-retention-archive-jobs.cjs --apply --policy=media_assets_30d --limit=100
`);
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
        printHelp();
        return;
    }
    const result = await runRetentionArchiveJobs(db.getDb(), {
        policyKey: args.policyKey,
        apply: args.apply,
        limit: args.limit,
        triggeredBy: args.apply ? 'script_apply' : 'script_dry_run',
        includeDisabled: args.includeDisabled,
    });
    console.log(JSON.stringify(result, null, 2));
}

main()
    .catch((err) => {
        console.error('[run-retention-archive-jobs] failed:', err.message);
        process.exitCode = 1;
    })
    .finally(async () => {
        await db.closeDb().catch(() => {});
    });
