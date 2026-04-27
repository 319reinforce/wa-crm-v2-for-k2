#!/usr/bin/env node
require('dotenv').config();

const db = require('../db');
const {
    recordExternalArchiveVerification,
    runRetentionArchiveJobs,
} = require('../server/services/dataRetentionService');

function parseArgs(argv) {
    const args = {
        apply: false,
        policyKey: null,
        limit: null,
        purge: false,
        includeDisabled: false,
        verifyExternalArchive: false,
        archiveUri: null,
        manifestSha256: null,
        coveredBefore: null,
        recordCount: 0,
        checkedBy: 'script',
        expiresAt: null,
    };
    for (const arg of argv) {
        if (arg === '--apply') {
            args.apply = true;
        } else if (arg === '--dry-run') {
            args.apply = false;
        } else if (arg === '--purge') {
            args.purge = true;
        } else if (arg === '--include-disabled') {
            args.includeDisabled = true;
        } else if (arg === '--verify-external-archive') {
            args.verifyExternalArchive = true;
        } else if (arg.startsWith('--policy=')) {
            args.policyKey = arg.slice('--policy='.length).trim() || null;
        } else if (arg.startsWith('--archive-uri=')) {
            args.archiveUri = arg.slice('--archive-uri='.length).trim() || null;
        } else if (arg.startsWith('--manifest-sha256=')) {
            args.manifestSha256 = arg.slice('--manifest-sha256='.length).trim() || null;
        } else if (arg.startsWith('--covered-before=')) {
            args.coveredBefore = arg.slice('--covered-before='.length).trim() || null;
        } else if (arg.startsWith('--record-count=')) {
            const numeric = Number(arg.slice('--record-count='.length));
            args.recordCount = Number.isFinite(numeric) && numeric >= 0 ? Math.trunc(numeric) : 0;
        } else if (arg.startsWith('--checked-by=')) {
            args.checkedBy = arg.slice('--checked-by='.length).trim() || 'script';
        } else if (arg.startsWith('--expires-at=')) {
            args.expiresAt = arg.slice('--expires-at='.length).trim() || null;
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
  node scripts/run-retention-archive-jobs.cjs [--dry-run] [--apply] [--purge] [--policy=<key>] [--limit=<n>]
  node scripts/run-retention-archive-jobs.cjs --verify-external-archive --policy=<key> --archive-uri=<uri> --manifest-sha256=<sha256> --covered-before=<datetime> [--record-count=<n>]

Default mode is --dry-run. Dry-run reads candidates and rollup groups only.
Apply writes rollups and archive refs. --purge only works together with --apply and only for policies whose hard-delete window and safety rules allow it.
WA message purge requires a verified row in data_retention_external_archive_checks covering the purge cutoff.

Examples:
  node scripts/run-retention-archive-jobs.cjs --dry-run
  node scripts/run-retention-archive-jobs.cjs --apply --policy=media_assets_30d --limit=100
  node scripts/run-retention-archive-jobs.cjs --apply --purge --policy=ai_usage_logs_180d --limit=100
  node scripts/run-retention-archive-jobs.cjs --verify-external-archive --policy=wa_messages_365d --archive-uri=s3://bucket/wa_messages/ --manifest-sha256=<sha256> --covered-before=2023-04-28 --record-count=100000
`);
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
        printHelp();
        return;
    }
    if (args.verifyExternalArchive) {
        const result = await recordExternalArchiveVerification(db.getDb(), {
            policyKey: args.policyKey,
            archiveUri: args.archiveUri,
            manifestSha256: args.manifestSha256,
            coveredBefore: args.coveredBefore,
            recordCount: args.recordCount,
            checkedBy: args.checkedBy,
            expiresAt: args.expiresAt,
            meta: {
                source: 'run-retention-archive-jobs',
            },
        });
        console.log(JSON.stringify(result, null, 2));
        return;
    }
    const result = await runRetentionArchiveJobs(db.getDb(), {
        policyKey: args.policyKey,
        apply: args.apply,
        purge: args.purge,
        limit: args.limit,
        triggeredBy: args.apply ? (args.purge ? 'script_apply_purge' : 'script_apply') : 'script_dry_run',
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
