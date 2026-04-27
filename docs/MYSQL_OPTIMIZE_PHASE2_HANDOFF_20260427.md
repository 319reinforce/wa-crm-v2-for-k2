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
| `joinbrands_link.ev_*` | Compatibility cache only. Forward writes go to `events`, `event_evidence`, and `creator_event_snapshot`. |
| `wa_crm_data.monthly_fee_status` | Derived from `monthly_challenge` event state. Normal UI writes should create/update events. |
| `wa_crm_data.monthly_fee_amount` | Billing/policy data, not lifecycle state. Keep frozen until a billing fact table or event meta contract is implemented. |
| `wa_crm_data.video_count` | Challenge progress fact. Use `event_periods.video_count` for period-level progress. |
| `wa_crm_data.video_target` | Policy target. Derive from `events_policy.policy_json.weekly_target` by owner/event key. |
| `wa_crm_data.video_last_checked` | Period/progress observation timestamp. Put in `event_periods.meta` or a future progress-check table. |
| `wa_crm_data.agency_bound` | Derived from `agency_bound` event state. |
| `wa_crm_data.agency_bound_at` | Event date / verification metadata for `agency_bound`. |
| `wa_crm_data.agency_deadline` | Deadline/schedule metadata. Keep frozen until deadline ownership is added to event meta or a dedicated schedule table. |

## Retention And Archive Policy

| Data | Hot window | Archive / cold policy | Keep exceptions |
| --- | --- | --- | --- |
| `generation_log` | 90 days full detail | Roll up success/latency/provider stats after 90 days; keep rows linked to approved SFT examples or incidents. | rows linked from `sft_memory.generation_log_id` |
| `retrieval_snapshot` | 90 days full context | Compress or redact rich context after 90-180 days; retain hash and metadata. | rows linked from `sft_memory.retrieval_snapshot_id` |
| `ai_usage_logs` | 180 days raw | Keep `ai_usage_daily` aggregates long term. | billing disputes / launch experiments |
| `audit_log` | 365+ days | Keep longer than product logs; archive by month rather than delete during active ops. | security/admin actions |
| `wa_messages` | 180-365 days in hot DB | Archive old inactive creator conversations by creator/month. | messages referenced by events, evidence, SFT, or active lifecycle state |
| `wa_group_messages` | 90-180 days in hot DB | Archive by group/month; group noise can age out faster than 1:1 messages. | messages linked to creator evidence or incidents |
| `media_assets` and files | existing default 30-day retention | Soft delete to `storage_tier=deleted`, then purge after configured grace window. | `cleanup_exemptions`, event/SFT references, active templates |

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

## Staging/Prod Runbook

Run with the target DB env loaded. For non-local DB hosts, confirm intent explicitly:

```bash
CONFIRM_REMOTE_MIGRATION=1 npm run db:migrate:sql -- \
  server/migrations/005_active_event_detection_queue.sql \
  server/migrations/006_managed_runtime_tables.sql \
  server/migrations/007_creator_import_tables.sql \
  server/migrations/008_template_media_training_tables.sql \
  server/migrations/009_ai_profile_creator_id_backfill.sql \
  server/migrations/010_schema_index_backfill.sql

node scripts/analyze-schema-state.js
```

Expected analyzer result: no missing tables, no extra tables, no column diffs, no index diffs, no key findings.

## Remaining Work

1. Run the 005-010 migration sequence against staging and production once DB env access is available.
2. Add write paths for negative/cancel lifecycle transitions if the UI needs to clear event states, not only create positive transitions.
3. Implement canonical billing/progress ownership for `monthly_fee_amount`, `video_count`, `video_target`, `video_last_checked`, and agency deadlines.
4. Add retention/archive jobs after the policy is approved, starting with generation/retrieval logs and media.
5. After a verification window, remove read dependence on `joinbrands_link.ev_*` and narrow deprecated lifecycle fields in `wa_crm_data`.

## Obsidian Sync

- Status: synced
- Note: `docs/obsidian/notes/2026-04-27-mysql-optimize-phase2-handoff.md`
- Index: `docs/obsidian/index.md`
