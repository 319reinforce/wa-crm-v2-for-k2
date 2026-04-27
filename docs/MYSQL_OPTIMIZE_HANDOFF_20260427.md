# MySQL Optimize Handoff

Date: 2026-04-27
Branch: `codex/mysqloptimize`
Status: Handoff for first implementation pass
Scope: schema source of truth, managed runtime tables, event detection ownership, and legacy lifecycle write freeze

## 1. Executive Summary

This pass started the database cleanup work described in `docs/DATABASE_SCHEMA_OPTIMIZATION_PLAN_20260427.md`.

The main outcome is that the active runtime-created schema is now represented in canonical schema files and migrations, while lifecycle compatibility fields are no longer safe hidden write targets by default.

Important correction from the first inventory:

- `event_detection_cursor` and `event_detection_runs` are not orphaned tables.
- Their owner is `server/services/activeEventDetectionService.js`.
- They are active queue/run-state tables and should be kept.

## 2. Previous-Round Change Report

### 2.1 Schema Source Of Truth

Updated `schema.sql`.

Added active runtime tables:

| Domain | Tables |
| --- | --- |
| WA group messages | `wa_group_chats`, `wa_group_messages` |
| Profile analysis | `profile_analysis_state`, `client_profile_snapshots`, `client_profile_change_events` |
| Active event detection | `event_detection_cursor`, `event_detection_runs` |

Also marked legacy compatibility fields:

- `wa_crm_data.monthly_fee_*`
- `wa_crm_data.beta_*`
- `wa_crm_data.agency_*`
- `wa_crm_data.video_*`
- `joinbrands_link.ev_*`

These columns now carry schema comments that identify them as deprecated compatibility state. The target write path is `events` plus `event_evidence`, followed by snapshot rebuilds.

### 2.2 Migrations

Updated `server/migrations/005_active_event_detection_queue.sql`.

Change:

- Kept `event_detection_cursor` and `event_detection_runs`.
- Moved indexes into `CREATE TABLE IF NOT EXISTS` definitions so the migration can run safely on a fresh database without failing on repeated standalone `CREATE INDEX`.

Added `server/migrations/006_managed_runtime_tables.sql`.

It creates:

- `wa_group_chats`
- `wa_group_messages`
- `profile_analysis_state`
- `client_profile_snapshots`
- `client_profile_change_events`

After rebasing onto latest Gitea `origin/main`, added `server/migrations/007_creator_import_tables.sql`.

It creates the creator import tables that were already present in latest `schema.sql`:

- `operator_outreach_templates`
- `creator_import_batches`
- `creator_import_items`

### 2.3 Runtime DDL Removal

Changed these services so they no longer create active tables at runtime:

- `server/services/groupMessageService.js`
- `server/services/profileAnalysisService.js`
- `server/services/activeEventDetectionService.js`

New behavior:

- Each service checks whether its required managed tables exist.
- If tables are missing, it fails with an actionable migration filename.
- Schema creation is now owned by `schema.sql` and migrations, not normal request/runtime execution.

### 2.4 Event Detection Ownership Decision

Decision:

- Do not archive `event_detection_cursor`.
- Do not archive `event_detection_runs`.

Reason:

- `activeEventDetectionService` owns them.
- Message ingestion and repair paths enqueue event detection work.
- `scripts/run-active-event-detection.cjs` uses the same service contract.

The original "possible orphan" assumption was corrected in the design doc and Obsidian note.

### 2.5 Legacy Lifecycle Write Freeze

Added `server/services/legacyLifecycleWriteGuard.js`.

Protected fields:

- `wa_crm_data` lifecycle fields: monthly fee, beta, agency, video progress.
- `joinbrands_link.ev_*` compatibility flags.

Changed write paths:

- `db.js` now guards `updateWacrm()` against legacy lifecycle writes.
- `server/routes/creators.js` now returns `409 legacy_lifecycle_writes_frozen` when `PUT /api/creators/:id/wacrm` tries to write deprecated lifecycle fields.

Temporary escape hatch:

```bash
ALLOW_LEGACY_LIFECYCLE_WRITES=1
```

Use this only for controlled migration or rollback work. Normal product writes should go through canonical event facts.

### 2.6 Schema Analyzer Fix

Updated `scripts/analyze-schema-state.js`.

Fix:

- The parser no longer treats generated-column SQL fragments such as `CASE` and foreign-key continuation lines such as `ON DELETE` as expected columns.

This removes false drift findings for generated columns and multi-line constraints.

### 2.7 Documentation Updates

Updated:

- `docs/DATABASE_SCHEMA_OPTIMIZATION_PLAN_20260427.md`
- `docs/obsidian/notes/2026-04-27-database-schema-optimization-plan.md`

This handoff document adds the execution-level report and future development plan.

## 3. Verification Results

Commands run:

```bash
node --check db.js
node --check server/routes/creators.js
node --check server/services/activeEventDetectionService.js
node --check server/services/groupMessageService.js
node --check server/services/profileAnalysisService.js
node --check server/services/legacyLifecycleWriteGuard.js
node --check scripts/analyze-schema-state.js
npm run test:unit
npm test
node scripts/analyze-schema-state.js
git diff --check
```

Results:

| Check | Result |
| --- | --- |
| JS syntax checks | Passed |
| `npm run test:unit` | Passed: 35 pass, 3 skipped |
| `npm test` | Passed smoke, build, and unit suite |
| `git diff --check` | Passed |
| `analyze-schema-state` | Passed after applying migration 007 locally: 52 actual tables, 52 expected tables, no missing tables, no extra tables, no column diffs |

Current local DB note:

- Local MySQL now matches the latest rebased canonical schema table inventory.
- `event_detection_cursor` and `event_detection_runs` are kept as active managed tables because `activeEventDetectionService` owns them.
- `server/migrations/006_managed_runtime_tables.sql` is still required for fresh or partially migrated environments that do not yet have the WA group/profile analysis tables.
- `server/migrations/007_creator_import_tables.sql` is required for environments that have latest `schema.sql` but have not let the creator import runtime path create those tables yet.

## 4. Current Risk Register

| Risk | Impact | Mitigation |
| --- | --- | --- |
| `PUT /api/creators/:id/wacrm` now blocks legacy lifecycle fields | Existing UI edit forms that still submit those fields may get 409 | Next pass must route these edits into event fact writes or temporarily gate old UI fields. |
| Missing migration on an environment | Group/profile/event-detection services can fail fast | Apply migrations before deploy; error messages name the required migration file. |
| `ALLOW_LEGACY_LIFECYCLE_WRITES=1` used casually | Old hidden write paths continue | Treat it as migration-only and avoid setting it in normal runtime env. |
| Some runtime DDL remains outside this pass | Schema source-of-truth is improved but not perfect | Continue cleanup for creator import, custom topic, media, and training tables. |
| Frontend still reads legacy fields | Read compatibility is still needed | Keep read paths and snapshot compatibility until UI and APIs migrate. |

## 5. Latest Future Development Plan

### Phase A: Apply And Verify Migrations

Goal:

- Make local/staging/prod MySQL match `schema.sql`.

Tasks:

1. Apply `server/migrations/005_active_event_detection_queue.sql` where needed.
2. Apply `server/migrations/006_managed_runtime_tables.sql`.
3. Apply `server/migrations/007_creator_import_tables.sql`.
4. Run `node scripts/analyze-schema-state.js`.
5. Confirm:
   - no missing active tables,
   - no extra unowned tables,
   - no column diffs,
   - group/profile/event detection services start without runtime DDL.

Acceptance:

- `actual_table_count === expected_table_count`.
- `missing_tables` and `extra_tables` are empty.

### Phase B: Replace Legacy Lifecycle Writes With Event Fact Writes

Goal:

- Make lifecycle changes write `events` and `event_evidence`, not compatibility fields.

Status:

- Partially implemented after the first handoff commit.
- Added `server/services/lifecycleEventWriteService.js`.
- `PUT /api/creators/:id/wacrm` now converts mappable legacy lifecycle payloads into canonical event facts when `ALLOW_LEGACY_LIFECYCLE_WRITES` is not set.
- The route still blocks unmapped legacy fields instead of silently writing deprecated columns.
- `creator_event_snapshot` is rebuilt after converted event writes; lifecycle persistence still runs through the existing lifecycle persistence service.

Tasks:

1. Add a backend helper for canonical lifecycle fact writes:
   - `trial_7day`
   - `monthly_challenge`
   - `agency_bound`
   - `gmv_milestone`
   - `churned` / terminal signals where policy allows
2. Update `PUT /api/creators/:id/wacrm`:
   - keep operator work-state writes such as `priority`, `next_action`, `urgency_level`,
   - convert lifecycle requests into event facts,
   - rebuild `creator_event_snapshot`,
   - persist lifecycle snapshot.
3. Update audit payloads to record both requested fields and created event ids.
4. Add tests for blocked legacy writes and new event fact writes.

Current mapped fields:

| Legacy input | Canonical event |
| --- | --- |
| `ev_trial_active`, `ev_trial_7day`, active/completed `beta_status` | `trial_7day` |
| `ev_monthly_started`, `ev_monthly_joined`, active/paid `monthly_fee_status`, `monthly_fee_deducted` | `monthly_challenge` |
| `agency_bound`, `ev_agency_bound` | `agency_bound` |
| `ev_gmv_1k`, `ev_gmv_2k`, `ev_gmv_5k`, `ev_gmv_10k` | `gmv_milestone` with highest threshold |
| `ev_churned`, `beta_status=churned` | `churned` |

Still protected / not silently migrated:

- `monthly_fee_amount`
- non-default `video_count`, `video_target`, `video_last_checked`
- `beta_program_type`, `beta_cycle_start`
- `agency_bound_at`, `agency_deadline`
- non-canonical JoinBrands flags such as `ev_whatsapp_shared`

Acceptance:

- No new writes to `joinbrands_link.ev_*`.
- No new lifecycle writes to deprecated `wa_crm_data` fields.
- The same creator has consistent lifecycle state from creator list, detail, strategy, and event APIs.

### Phase C: Frontend Editing Migration

Goal:

- Stop UI forms from submitting deprecated lifecycle fields directly.

Tasks:

1. Update `CreatorDetail.jsx` edit behavior:
   - direct work-state fields remain editable,
   - lifecycle edits become event actions or review decisions.
2. Add user-facing handling for `legacy_lifecycle_writes_frozen`.
3. Prefer event snapshot/lifecycle snapshot reads over raw legacy flags.

Acceptance:

- Editing priority/next action still works.
- Editing lifecycle state creates or updates canonical events.
- No normal UI operation requires `ALLOW_LEGACY_LIFECYCLE_WRITES=1`.

### Phase D: Finish Runtime DDL Cleanup

Goal:

- Move remaining service-time schema creation out of normal runtime paths.

Known remaining areas:

- `server/services/creatorImportBatchService.js`
- `server/routes/customTopicTemplates.js`
- `server/services/mediaAssetService.js`
- `server/workers/trainingWorker.js`
- selected backfill/setup scripts that should stay scripts, not request runtime

Tasks:

1. Classify each remaining DDL path as runtime, migration, or one-off script.
2. Move runtime DDL into migrations.
3. Keep one-off scripts clearly named and out of request paths.

Acceptance:

- `rg -n "CREATE TABLE IF NOT EXISTS" server` has no normal request/runtime DDL except explicitly approved migration/bootstrap code.

### Phase E: Normalize AI/Profile Identity

Goal:

- Prefer `creator_id` internally instead of relying on external `client_id`/phone joins.

Tables to plan:

- `client_memory`
- `client_profiles`
- `client_tags`
- `client_profile_snapshots`
- `client_profile_change_events`
- `profile_analysis_state`
- `generation_log`
- `retrieval_snapshot`
- `sft_feedback`

Acceptance:

- New writes include `creator_id` when resolvable.
- Existing API compatibility remains.
- Sensitive external identifiers stay scoped or hashed where appropriate.

### Phase F: Retention And Archive Policy

Goal:

- Prevent log tables from becoming the next schema/data clutter source.

Targets:

- `generation_log`
- `retrieval_snapshot`
- `ai_usage_logs`
- `audit_log`
- `wa_messages`
- `wa_group_messages`
- media tables

Acceptance:

- Retention windows are documented.
- Approved SFT-linked generation snapshots are preserved.
- Product/debug logs have archive or rollup jobs.

## 6. Suggested Next PR Order

1. Migration application and schema convergence PR.
   - Status: phase 2 added `008_template_media_training_tables.sql`, `009_ai_profile_creator_id_backfill.sql`, and `010_schema_index_backfill.sql`; local analyzer now reports no table/column/index drift.
2. Event-fact write helper plus backend `wacrm` route migration.
   - Status: backend helper and route migration are implemented in the second commit; frontend cleanup remains.
3. Frontend creator detail edit migration.
   - Status: phase 2 changed CreatorDetail positive lifecycle edits to `POST /api/events` and stopped normal UI saves from submitting deprecated lifecycle fields to `PUT /api/creators/:id/wacrm`.
4. Remaining runtime DDL cleanup.
   - Status: phase 2 removed service-time DDL from creator import, custom topic templates, media asset/cleanup, and training log paths; these paths now use schema readiness checks.
5. `creator_id` profile/AI backfill.
   - Status: phase 2 added nullable `creator_id` columns, local backfill, indexes, and forward writes for hot AI/profile paths.
6. Log retention and archive policy.
   - Status: phase 2 documented the initial retention/archive policy in `docs/MYSQL_OPTIMIZE_PHASE2_HANDOFF_20260427.md`.

## 7. Handoff Notes For The Next Agent

- Stay on `codex/mysqloptimize`.
- Do not set `ALLOW_LEGACY_LIFECYCLE_WRITES=1` unless intentionally testing a legacy migration path.
- Do not drop `event_detection_cursor` or `event_detection_runs`.
- Apply migrations 005 through 010 in target environments before deploying services that require the managed tables and new `creator_id` columns.
- Keep Obsidian sync up to date for any design, runbook, migration, or handoff update.

## Obsidian Sync

- Status: synced
- Note: `docs/obsidian/notes/2026-04-27-mysql-optimize-handoff.md`
- Index: `docs/obsidian/index.md`
