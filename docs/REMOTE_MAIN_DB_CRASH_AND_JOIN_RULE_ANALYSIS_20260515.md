# Remote Main DB Crash And JOIN Rule Analysis

Date: 2026-05-15
Status: Active analysis
Scope: `origin/main` latest rollout, database startup risk, and new business-query JOIN usage

## Executive Summary

The latest remote `origin/main` head observed on 2026-05-15 is `7f18918cdd82b70b70b0cf8383774f76a26056de`.

That commit itself only updates the production image tag:

- `deploy/values-prod.yaml`: `20260507-696d9b7` -> `20260509-3608d96`

The code-bearing change behind that image is merge commit `3608d96`, which merged `6a8ba49 chore: complete tech debt remediation phases 1-5`.

Static inspection shows:

- `6a8ba49` did not change `schema.sql`.
- `6a8ba49` did not change `scripts/run-startup-migrations.cjs`.
- `6a8ba49` did add new business-query `LEFT JOIN` usage in `server/routes/audit.js`.
- `scripts/docker-entrypoint.sh` always runs `node scripts/run-startup-migrations.cjs` before starting the server, so any migration failure still crashes container startup.

Current best reading: the last remote rollout likely triggered a new container image and therefore re-ran startup migrations before the server started. The code merge itself does not appear to have introduced a new database-creation script, but it did introduce new non-compliant business `LEFT JOIN` queries. Those queries should be fixed independently and the startup path should gain stricter preflight gates so a future deploy cannot discover database incompatibility only after the pod starts.

## Evidence

### Remote commit chain

Observed remote head:

```text
7f18918 refs/heads/main
```

First-parent commits after local stale `origin/main` (`d87d7c7`):

```text
7f18918 chore(deploy): update image tag to 20260509-3608d96 [skip ci]
3608d96 Merge pull request 'chore: complete tech debt remediation phases 1-5' (#111) from codex/may-template-kickoff into main
```

The deploy commit only changes image tag. The operational consequence is large because Kubernetes pulls a new image and the entrypoint runs startup migrations before `server/index.cjs`.

### Startup path

`scripts/docker-entrypoint.sh`:

```sh
node scripts/run-startup-migrations.cjs
exec "$@"
```

`scripts/run-startup-migrations.cjs` defaults `DB_MIGRATE_ON_STARTUP` to true and wraps SQL migrations in a MySQL advisory lock. If `apply-sql-migrations.cjs` exits non-zero, the entrypoint exits non-zero and the server never starts.

This behavior is intentional, but it means DB creation/migration problems are startup blockers. A deploy-only tag can therefore surface a database failure even when the tag commit did not modify schema files.

### New JOIN usage introduced by the merge

The merge added `buildAbEvaluationSummary()` and `buildGenerationStatsSummary()` in `server/routes/audit.js`. The new code contains these business-query joins:

- `LEFT JOIN creators c ON c.wa_phone = JSON_UNQUOTE(JSON_EXTRACT(sm.context_json, "$.client_id"))`
- `LEFT JOIN creators c ON c.wa_phone = JSON_UNQUOTE(JSON_EXTRACT(sm.context_json, '$.client_id'))`
- `LEFT JOIN creators c ON c.wa_phone = gl.client_id`

It also performs aggregate grouping in the same query family:

- `GROUP BY JSON_EXTRACT(context_json, '$.scene')`
- `GROUP BY c.wa_owner`
- `GROUP BY DATE(sm.created_at)`
- `GROUP BY gl.provider`
- `GROUP BY gl.route`
- `GROUP BY DATE(gl.created_at)`

Per the project rule supplied for `dev-standards.md` Section 4.1, `LEFT JOIN`, `INNER JOIN`, and `RIGHT JOIN` are not separate categories. New business queries must not add multi-table JOIN. A `LEFT JOIN` must be rewritten as:

1. Query the primary table.
2. Batch query the secondary table with an `IN (?)` set.
3. Build a `Map`.
4. Merge in application code, preserving missing secondary rows as `null` or defaults.

### Historical JOINs are not the same risk class

The repository already contains many historical JOINs. The stated exception allows existing historical JOINs to remain. The issue here is the new query surface introduced by the last merge. Do not use the existence of older JOINs as precedent for new business SQL.

Startup migration SQL is also a separate category from request-path business queries. Migrations may need controlled backfills, but they should be reviewed for lock/runtime impact and should not be used as a loophole for new request-time JOINs.

## Likely Failure Modes

### Failure Mode A: Startup migration blocks server boot

Symptoms:

- Container starts.
- `scripts/docker-entrypoint.sh` runs migrations.
- A migration query fails, locks too long, or connects to a DB state it did not expect.
- Node exits before Express starts.

Why the latest remote head can trigger this:

- `7f18918` updates prod image tag.
- New pod starts.
- Entrypoint runs migrations even though `7f18918` only changed deploy metadata.

Immediate triage:

```bash
git show 7f18918 -- deploy/values-prod.yaml
git show --stat 3608d96
node scripts/run-startup-migrations.cjs
```

Use a staging clone or prod-safe read-only logs for the last command, not a blind prod shell run.

### Failure Mode B: New audit endpoints create heavy or invalid DB work

Symptoms:

- Server starts.
- SFT or audit dashboard calls `/api/generation-log/evaluation-summary`.
- Query planner hits `sft_memory` or `generation_log`, then joins `creators` through phone/client_id expressions.
- Missing index, JSON extraction, or schema drift causes slow scans or errors.

Why this violates the rule:

- The new code uses multi-table `LEFT JOIN` in normal request handling.
- The rule does not carve out an exception for `LEFT JOIN`.
- The correct shape is single-table aggregate queries plus application-layer owner enrichment/filtering.

### Failure Mode C: Owner filtering changes LEFT semantics

Current pattern:

```sql
FROM sft_memory sm
LEFT JOIN creators c ON ...
WHERE c.wa_owner = ?
```

Even though the SQL says `LEFT JOIN`, adding `WHERE c.wa_owner = ?` makes unmatched secondary rows disappear. In application-layer form this should be explicit:

- Owner-scoped view: filter to primary rows whose resolved creator owner matches.
- Global view: keep unmatched rows and group them under `Unknown`.

## Required Remediation

### P0: Stabilize deployment/startup

1. Confirm whether the crash happens before Express starts or after a specific endpoint is called.
2. If it is startup-only, inspect migration logs around `scripts/run-startup-migrations.cjs`.
3. Keep `DB_MIGRATE_ON_STARTUP` behavior, but add a CI/staging gate that runs the same migration list against a schema clone before the production image tag is advanced.
4. Add an operator runbook step: deploy commits that only change image tags still require startup migration log review.

### P1: Remove newly introduced business JOINs

Target: `server/routes/audit.js`

Rewrite `buildAbEvaluationSummary()` and `buildGenerationStatsSummary()` so each SQL statement touches one table only. Use helper functions:

- Fetch SFT rows/aggregates from `sft_memory`.
- Fetch generation rows/aggregates from `generation_log`.
- Extract client IDs in JS.
- Fetch creator owner map from `creators` with `WHERE wa_phone IN (?)`.
- Merge/filter/group in JS.

LEFT semantics:

- Global summary keeps unmatched rows as owner `Unknown`.
- Owner-scoped summary filters out rows whose creator owner does not match.
- Missing creator rows never crash the request.

### P2: Add static guardrails

Add a repository test that rejects new business-query JOINs outside an explicit allowlist:

- Scan `server/routes/**/*.js` and `server/services/**/*.js`.
- Detect `JOIN`, `LEFT JOIN`, `INNER JOIN`, `RIGHT JOIN` inside SQL template/string literals.
- Allow existing historical files/line fingerprints only.
- Fail when a new JOIN appears without adding a documented exception.

This guard should distinguish:

- Business runtime query: default deny.
- Migration/backfill SQL: allowed only with review notes and runtime estimate.
- Docs/tests/examples: ignored or separately reviewed.

### P3: Add database startup preflight

Add a CI or release job that runs:

```bash
DB_MIGRATION_FILES="$(node scripts/list-default-migrations.cjs)" node scripts/run-startup-migrations.cjs
```

Against an isolated schema clone, before the deployment tag is committed.

If a standalone list script is not available, create one rather than duplicating the migration list in CI.

## Non-Goals

- Do not reintroduce SQLite or `crm.db`.
- Do not disable startup migrations permanently as a workaround.
- Do not rewrite all historical JOINs in one emergency patch.
- Do not add per-row lookup loops that create N+1 queries.

## Verification Plan

For the immediate repair:

```bash
node --check server/routes/audit.js
node --test tests/auditRoutes.test.mjs
rg -n "\\b(?:LEFT|RIGHT|INNER)?\\s*JOIN\\b" server/routes/audit.js
npm run build
```

For startup safety:

```bash
node --check scripts/run-startup-migrations.cjs
node scripts/run-startup-migrations.cjs
```

Run migration commands only against a confirmed local/staging DB unless the operator explicitly approves production execution.

## Decision

Treat `7f18918` as the rollout trigger and `6a8ba49` as the code-change source. The urgent code fix is to remove the newly introduced business `LEFT JOIN` queries. The urgent process fix is to add pre-deploy migration rehearsal and static JOIN guardrails so future deploy-tag commits cannot surprise production with either startup DB failures or new request-path multi-table joins.

## Obsidian Sync

- Status: synced
- Note: `docs/obsidian/notes/2026-05-15-remote-main-db-crash-and-join-remediation.md`
- Index: `docs/obsidian/index.md`
