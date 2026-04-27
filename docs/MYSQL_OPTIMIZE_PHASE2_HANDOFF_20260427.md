# MySQL Optimize Phase 2 Handoff

Date: 2026-04-27
Status: Implemented locally, pending staging/prod env access
Branch: `codex/mysqloptimize-phase2`

## Summary

This pass continues the MySQL schema cleanup after PR #84 was merged. It removes the next set of request/runtime DDL paths, adds explicit migration coverage for template/media/training tables, adds `creator_id` linkage to AI/profile tables, migrates CreatorDetail lifecycle edits to event-first writes, and upgrades schema verification to include indexes.

## What Changed

### Managed migrations

Added:

- `server/migrations/008_template_media_training_tables.sql`
- `server/migrations/009_ai_profile_creator_id_backfill.sql`
- `server/migrations/010_schema_index_backfill.sql`

Migration order for target environments is now:

1. `005_active_event_detection_queue.sql`
2. `006_managed_runtime_tables.sql`
3. `007_creator_import_tables.sql`
4. `008_template_media_training_tables.sql`
5. `009_ai_profile_creator_id_backfill.sql`
6. `010_schema_index_backfill.sql`

Added `scripts/apply-sql-migrations.cjs` plus `npm run db:migrate:sql` so migration application uses the same MySQL env variables as the app. Non-local DB hosts require `CONFIRM_REMOTE_MIGRATION=1` or `--allow-remote`.

### Runtime DDL cleanup

Normal request/runtime paths no longer create tables or add columns in:

- `server/services/creatorImportBatchService.js`
- `server/routes/customTopicTemplates.js`
- `server/services/mediaAssetService.js`
- `server/services/mediaCleanupService.js`
- `server/workers/trainingWorker.js`

They now call `server/services/schemaReadinessGuard.js` and fail with a specific migration hint when schema is missing.

Verification command:

```bash
rg -n "CREATE TABLE IF NOT EXISTS|ALTER TABLE|CREATE INDEX IF NOT EXISTS|ADD COLUMN" server/services server/routes server/workers
```

Result: no matches in normal service/route/worker paths after this pass.

### CreatorDetail lifecycle edit migration

`src/components/CreatorDetail.jsx` now sends positive lifecycle transitions to `POST /api/events` instead of submitting deprecated lifecycle fields to `PUT /api/creators/:id/wacrm`.

Event-first mappings:

| UI edit | Canonical write |
| --- | --- |
| `ev_trial_active=true` or beta started/completed | `events.event_key=trial_7day` |
| monthly started/joined or paid status | `events.event_key=monthly_challenge` |
| agency bound | `events.event_key=agency_bound` |
| GMV milestone flags | `events.event_key=gmv_milestone` with highest threshold |
| churned / beta churned | `events.event_key=churned` |

The `wacrm` request now keeps non-lifecycle operational writes such as `priority`, `next_action`, and Keeper metrics. It no longer sends `joinbrands_link.ev_*` or lifecycle `wa_crm_data` fields during normal CreatorDetail saves.

### Canonical event cancel/clear

CreatorDetail now has the inverse path for manual lifecycle edits: when an operator clears a lifecycle state in the UI, the app cancels canonical event state rather than writing old `joinbrands_link.ev_*` or `wa_crm_data` lifecycle fields back to false/null.

Canonical contract:

- API: `POST /api/events/cancel-by-key`
- Body: `creator_id`, `event_key`, optional `reason`, `trigger_source`, and `meta`
- Behavior: find this creator's canonical events for the key in active/draft/pending/completed lifecycle states, mark them `cancelled`, set `event_state=cancelled`, set `lifecycle_effect=none`, write audit history, persist creator lifecycle, and rebuild `creator_event_snapshot`
- UI owner: `CreatorDetail` lifecycle editor should send clear actions through this API before sending non-lifecycle `wacrm` updates

This keeps both positive and negative lifecycle edits inside the canonical event system. If no matching event exists, the API returns a no-op result plus the rebuilt snapshot so the caller can stop trying to mutate deprecated compatibility columns. `POST /api/events` now also rebuilds `creator_event_snapshot` after positive event writes, and `GET /api/creators/:id` exposes `event_snapshot` so CreatorDetail can prefer canonical snapshot flags over old compatibility columns.

### Startup event derived-data recompute

Production/staging DB credentials are intentionally not required for this PR. The app now owns an idempotent startup recompute path that runs after the API process starts:

- Service: `server/services/eventDerivedDataRecomputeService.js`
- Startup hook: `server/index.cjs`
- Default behavior: enabled unless `STARTUP_EVENT_RECOMPUTE_ENABLED=0`
- Safety gate: checks required event/lifecycle tables and columns first; if lifecycle schema plus migrations 004-010 have not been applied, it skips and logs the missing schema instead of creating tables or blocking startup
- Recomputed data: `creator_event_snapshot` via `rebuildCreatorEventSnapshot`, and `creator_lifecycle_snapshot` via `persistLifecycleForCreator`
- Transition safety: startup recompute writes snapshots only and sets `writeTransition=false`, so restarts do not spam lifecycle transition history

Rollout expectation: staging/prod can deploy the code before DB migration without failing. Once migrations are executed by an operator with DB access, restart the API process and look for `[Startup][EventDerivedData] recompute done` in logs. For large databases, use `STARTUP_EVENT_RECOMPUTE_BATCH_SIZE` to tune batch size or `STARTUP_EVENT_RECOMPUTE_MAX_CREATORS` for a bounded canary run.

### AI/profile creator linkage

`schema.sql` and migration 009 add nullable `creator_id` columns plus indexes to:

- `client_memory`
- `client_profiles`
- `client_tags`
- `profile_analysis_state`
- `client_profile_snapshots`
- `client_profile_change_events`
- `retrieval_snapshot`
- `generation_log`
- `sft_feedback`

Migration 009 backfills those columns from `creators.wa_phone = <table>.client_id`.

Forward writes now populate `creator_id` in the hot paths for:

- profile analysis state/snapshots/change events
- manual profile/memory/tag APIs
- memory extraction
- reply generation retrieval/generation logs
- SFT feedback
- reply strategy memory
- creator merge client-scoped data

## Field Ownership

| Legacy field | Forward owner |
| --- | --- |
| `joinbrands_link.ev_*` | Compatibility cache only. Forward writes go to `events`, `event_evidence`, and `creator_event_snapshot`; creator list/detail projection, kanban filters, CreatorDetail, EventPanel, and AI prompt helpers now prefer snapshot flags before this cache. |
| `wa_crm_data.monthly_fee_status` | Derived from `monthly_challenge` event state. Normal UI writes should create/update events. |
| `wa_crm_data.monthly_fee_amount` | Canonical forward owner is `event_billing_facts` with `billing_key='monthly_fee'`. |
| `wa_crm_data.video_count` | Canonical forward owner is `event_progress_facts` with `progress_key='video_progress'`; period settlement still uses `event_periods.video_count`. |
| `wa_crm_data.video_target` | Canonical forward owner is `event_progress_facts.video_target` for observed/operator overrides; owner policy defaults can still live in `events_policy`. |
| `wa_crm_data.video_last_checked` | Canonical forward owner is `event_progress_facts.last_checked_at` / `observed_at`. |
| `wa_crm_data.agency_bound` | Derived from `agency_bound` event state. |
| `wa_crm_data.agency_bound_at` | Event date / verification metadata for `agency_bound`. |
| `wa_crm_data.agency_deadline` | Canonical forward owner is `event_deadline_facts` with `deadline_key='agency_deadline'`. |

Migration 011 adds the three fact tables and backfills existing `wa_crm_data` values with `source_kind='migration'`. Forward writes use:

- `POST /api/creators/:id/operational-facts` for CreatorDetail amount/progress/deadline edits.
- `PUT /api/creators/:id/wacrm` compatibility handling for old clients; mapped operational fields are diverted into facts while deprecated legacy columns stay frozen unless `ALLOW_LEGACY_LIFECYCLE_WRITES=1`.
- `GET /api/creators/:id` returns `operational_facts` and projects latest canonical facts into `wacrm` for existing UI/read compatibility.

## Retention And Archive Policy

| Data | Hot window | Archive / cold policy | Keep exceptions |
| --- | --- | --- | --- |
| `generation_log` | 90 days full detail | Mark archive refs after 90 days; `--apply --purge` may hard delete after 365 days if not linked to SFT. | rows linked from `sft_memory.generation_log_id` |
| `retrieval_snapshot` | 90 days full context | Mark archive refs after 90 days; `--apply --purge` may hard delete after 365 days if not linked to SFT. | rows linked from `sft_memory.retrieval_snapshot_id` |
| `ai_usage_logs` | 180 days raw | Roll up into `ai_usage_daily`, mark archive refs after 180 days, and allow hard delete after 730 days with `--apply --purge`. | billing disputes / launch experiments |
| `audit_log` | 365+ days | Archive refs by record; never hard delete from this job. | security/admin actions |
| `wa_messages` | 365 days in hot DB | Roll up monthly creator/operator summaries into `message_archive_monthly_rollups` and record archive refs. Hard-delete window is 1095 days, but automated purge stays disabled until external archive verification exists. | messages referenced by events, evidence, SFT, or active lifecycle state |
| `wa_group_messages` | 180 days in hot DB | Roll up monthly group/operator summaries into `message_archive_monthly_rollups` and record archive refs. Hard-delete window is 730 days, but automated purge stays disabled until external archive verification exists. | messages linked to creator evidence or incidents |
| `media_assets` and files | existing default 30-day retention | `--apply` moves eligible hot active assets to `storage_tier='cold'` and writes archive refs. Hard-delete window is 90 days and remains owned by `mediaCleanupService`. | `cleanup_exemptions`, event/SFT references, active templates |

Migration 011 seeds `data_retention_policies`, `data_retention_runs`, and `data_retention_archive_refs`. The runner is intentionally conservative:

```bash
node scripts/run-retention-archive-jobs.cjs --dry-run
node scripts/run-retention-archive-jobs.cjs --apply --policy=media_assets_30d --limit=100
node scripts/run-retention-archive-jobs.cjs --apply --purge --policy=ai_usage_logs_180d --limit=100
```

Migration 012 adds `message_archive_monthly_rollups`, updates `purge_after_days`, and turns on the rollup path for `ai_usage_logs`, `wa_messages`, and `wa_group_messages`.

Dry-run does not write run records, rollups, archive refs, purge rows, or media tier updates. Apply mode writes rollups first, then `data_retention_runs` plus `data_retention_archive_refs`; media apply only marks eligible assets cold. `--purge` is separate from `--apply` and currently only deletes targets that have both a purge window and explicit service support.

## Verification

Local `.env` points to `127.0.0.1:3306/wa_crm_v2`. No staging/prod credentials are present in this workspace, so the migrations were executed against local MySQL only.

Commands run locally:

```bash
node scripts/apply-sql-migrations.cjs \
  server/migrations/005_active_event_detection_queue.sql \
  server/migrations/006_managed_runtime_tables.sql \
  server/migrations/007_creator_import_tables.sql \
  server/migrations/008_template_media_training_tables.sql \
  server/migrations/009_ai_profile_creator_id_backfill.sql

node scripts/apply-sql-migrations.cjs server/migrations/010_schema_index_backfill.sql

node scripts/analyze-schema-state.js
```

Analyzer result after migrations:

```json
{
  "actual_table_count": 52,
  "expected_table_count": 52,
  "missing_tables": [],
  "extra_tables": [],
  "column_diffs": [],
  "index_diffs": [],
  "key_findings": []
}
```

Additional verification for the canonical event cancel/clear patch:

```bash
npm test
node scripts/analyze-schema-state.js
```

Result: smoke test passed; analyzer reported 52 expected tables, 52 actual tables, no missing/extra tables, no column diffs, no index diffs, and no key findings.

The startup recompute service was checked with `node --check server/services/eventDerivedDataRecomputeService.js`, `node --check server/index.cjs`, `npm run build`, and `npm run test:unit`.

Additional local verification for migration 011:

```bash
npm run db:migrate:sql -- server/migrations/011_billing_progress_deadline_retention.sql
node scripts/analyze-schema-state.js
node scripts/run-retention-archive-jobs.cjs --dry-run --limit=5
```

Result: migration 011 applied locally after a collation guard fix; analyzer reported 58 expected tables, 58 actual tables, no missing/extra tables, no column diffs, no index diffs, and no key findings. Retention dry-run returned all seven seeded policies with zero local candidates and no writes.

Migration 012 local verification after 011:

```bash
npm run db:migrate:sql -- server/migrations/012_retention_rollups_and_purge_windows.sql
node scripts/analyze-schema-state.js
node scripts/run-retention-archive-jobs.cjs --dry-run --limit=5
```

Result: migration 012 applied locally; analyzer reported 59 expected tables, 59 actual tables, no missing/extra tables, no column diffs, no index diffs, and no key findings. Retention dry-run returned `ai_usage_daily` rollup preview, `message_archive_monthly_rollups` previews for `wa_messages` / `wa_group_messages`, explicit `purge_after_days`, and no local candidates.

## Staging/Prod Runbook

Run with the target DB env loaded. For non-local DB hosts, confirm intent explicitly:

```bash
CONFIRM_REMOTE_MIGRATION=1 npm run db:migrate:sql -- \
  server/migrations/005_active_event_detection_queue.sql \
  server/migrations/006_managed_runtime_tables.sql \
  server/migrations/007_creator_import_tables.sql \
  server/migrations/008_template_media_training_tables.sql \
  server/migrations/009_ai_profile_creator_id_backfill.sql \
  server/migrations/010_schema_index_backfill.sql \
  server/migrations/011_billing_progress_deadline_retention.sql \
  server/migrations/012_retention_rollups_and_purge_windows.sql

node scripts/analyze-schema-state.js
node scripts/run-retention-archive-jobs.cjs --dry-run
```

Expected analyzer result: no missing tables, no extra tables, no column diffs, no index diffs, no key findings.

After migration, restart the API service. Expected startup log:

```text
[Startup][EventDerivedData] recompute done: processed=<n>, snapshots=<n>, lifecycles=<n>, duration_ms=<ms>
```

If the lifecycle schema or SQL migrations have not been applied, expected startup log is a skip with missing schema details, and the API should continue booting.

## Remaining Work

1. Run the 005-012 migration sequence against staging and production once DB env access is available.
2. Restart staging/prod after migration and confirm startup event derived-data recompute logs.
3. Verify `POST /api/events/cancel-by-key` plus `POST /api/creators/:id/operational-facts` in staging/prod with CreatorDetail edits.
4. Run retention dry-run in staging/prod and review rollup/candidate samples before any `--apply`.
5. After a verification window, continue removing server-side reads from `joinbrands_link.ev_*` and deprecated `wa_crm_data` fields; current list/detail reads, kanban filters, CreatorDetail/EventPanel agency checks, and AI prompt helpers now prefer `creator_event_snapshot` and operational facts.
6. Add external archive storage verification before enabling automated hard deletes for `wa_messages` / `wa_group_messages`.

## Obsidian Sync

- Status: synced
- Note: `docs/obsidian/notes/2026-04-27-mysql-optimize-phase2-handoff.md`
- Index: `docs/obsidian/index.md`
