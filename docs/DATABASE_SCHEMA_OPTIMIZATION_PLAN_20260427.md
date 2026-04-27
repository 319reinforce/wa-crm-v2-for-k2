# Database Schema Optimization Plan

Date: 2026-04-27
Status: Proposed implementation baseline
Scope: WA CRM v2 MySQL schema, data ownership, compatibility cleanup, and migration order

## 1. Goal

The current database problem is not just table count. The deeper issue is that source-of-truth tables, derived snapshots, compatibility caches, runtime-created tables, and operational logs are mixed together without explicit ownership.

This plan defines a cleaner target model and a staged migration path. It does not require immediate destructive changes. The first milestone is to make table ownership and write paths explicit, then migrate high-risk compatibility state gradually.

## 2. Current Findings

Before the first implementation pass, static `schema.sql` defined 42 tables.

The local MySQL database currently has 49 tables. `scripts/analyze-schema-state.js` reported no missing schema tables, but found 7 actual tables that are not in `schema.sql`:

| Table | Rows | Current status | Recommendation |
| --- | ---: | --- | --- |
| `client_profile_change_events` | 166 | Runtime-created by `profileAnalysisService` | Add to `schema.sql` and migration. |
| `client_profile_snapshots` | 166 | Runtime-created by `profileAnalysisService` | Add to `schema.sql`; this is profile history, not current profile state. |
| `event_detection_cursor` | 2 | Owned by `activeEventDetectionService`; enqueue path is called from message ingestion/repair. | Add to `schema.sql` and migration; do not archive. |
| `event_detection_runs` | 4 | Owned by `activeEventDetectionService`; records detection runs. | Add to `schema.sql` and migration; do not archive. |
| `profile_analysis_state` | 250 | Runtime-created by `profileAnalysisService` | Add to `schema.sql`; use as profile analysis work queue state. |
| `wa_group_chats` | 56 | Runtime-created by `groupMessageService` | Add to `schema.sql`; this is active WA group data. |
| `wa_group_messages` | 3184 | Runtime-created by `groupMessageService` | Add to `schema.sql`; this is active WA group data. |

Other structural issues:

- `wa_crm_data` mixes operator work state, beta/monthly/agency lifecycle state, and video counters.
- `joinbrands_link` mixes external JoinBrands attributes with deprecated `ev_*` lifecycle flags.
- `events`, `event_evidence`, `creator_event_snapshot`, and `creator_lifecycle_snapshot` now provide a stronger fact/snapshot lifecycle model, but old readers and writers still touch legacy tables.
- AI generation logs are among the largest tables: `generation_log` has 5194 rows and `retrieval_snapshot` has 5051 rows. These need retention and archive rules before they become the next source of database clutter.
- Many AI/profile tables still use `client_id` as an external identifier. New work should prefer `creator_id` internally and keep external ids scoped, hashed, or compatibility-only.
- Some services still create tables at runtime. Schema creation belongs in `schema.sql` and explicit migrations.

Implementation update:

- `schema.sql` now includes all 7 managed runtime tables.
- `event_detection_cursor` and `event_detection_runs` are covered by `server/migrations/005_active_event_detection_queue.sql`.
- `server/migrations/006_managed_runtime_tables.sql` covers WA group tables and profile analysis tables, so fresh environments can converge without relying on service-time DDL.
- `groupMessageService`, `profileAnalysisService`, and `activeEventDetectionService` now check for managed tables instead of creating them at runtime.
- `event_detection_cursor` and `event_detection_runs` were not archived because an active owner was found.
- `scripts/analyze-schema-state.js` was updated so generated column expressions do not create the false `CASE` column finding.
- Legacy lifecycle writes to `joinbrands_link.ev_*` and lifecycle-related `wa_crm_data` fields are blocked by default. Temporary migration writes require `ALLOW_LEGACY_LIFECYCLE_WRITES=1`.

## 3. Target Table Roles

Every table should have exactly one primary role:

| Role | Meaning | Examples |
| --- | --- | --- |
| Source of truth | Authoritative business, identity, message, or configuration fact | `creators`, `wa_messages`, `events`, `event_evidence`, `policy_documents` |
| Derived snapshot | Rebuildable current-state projection | `creator_event_snapshot`, `creator_lifecycle_snapshot`, `ai_usage_daily` |
| Compatibility cache | Temporary API/backward-compatibility output | `joinbrands_link.ev_*`, legacy parts of `wa_crm_data` |
| Operational log | Append-heavy audit, generation, usage, job, or sync history | `generation_log`, `retrieval_snapshot`, `audit_log`, `ai_usage_logs` |
| Work queue/state | Current progress marker for background processing | `profile_analysis_state`, `event_detection_cursor` |
| Archive candidate | Unused, empty, superseded, or no current code owner | `manual_match` |

The key rule: snapshots and compatibility caches must never become hidden write targets for new business facts.

## 4. Target Domains

### 4.1 Identity And Ownership

Keep:

- `creators`
- `creator_aliases`
- `operator_creator_roster`
- `operator_directory`
- `operator_directory_members`
- `users`
- `user_sessions`

Direction:

- `creators.id` is the internal primary identity.
- `wa_phone`, Keeper username, TikTok handle, JoinBrands name, and email are aliases or external identifiers.
- `operator_creator_roster` is the active ownership scoping table for app permissions and operator filtering.
- `manual_match` currently has 0 rows. Convert its useful history into alias verification/audit, then archive or drop it.

### 4.2 WhatsApp Messages And Media

Keep:

- `wa_sessions`
- `wa_messages`
- `wa_group_chats`
- `wa_group_messages`
- `media_assets`
- `media_send_log`
- `cleanup_jobs`
- `cleanup_exemptions`

Direction:

- `wa_messages` and `wa_group_messages` are raw communication facts.
- Message tables should not store lifecycle or CRM interpretation beyond persistence metadata.
- `wa_group_chats` and `wa_group_messages` must move from runtime-created schema into normal migrations.
- Media retention should be driven by `media_assets.status`, `storage_tier`, `cleanup_jobs`, and `cleanup_exemptions`.

### 4.3 CRM Facts, Events, And Lifecycle

Keep as source of truth:

- `events`
- `event_definitions`
- `event_evidence`
- `event_state_transitions`
- `event_periods`
- `keeper_link`
- JoinBrands external attributes in `joinbrands_link`

Keep as derived:

- `creator_event_snapshot`
- `creator_lifecycle_snapshot`
- `creator_lifecycle_transition`

Deprecate as write targets:

- `joinbrands_link.ev_*`
- lifecycle-related columns in `wa_crm_data`

Direction:

- All lifecycle-driving facts should enter through `events` with evidence.
- `event_definitions` owns canonical event meaning.
- `event_evidence` owns source anchors, external system evidence, and quote/hash metadata.
- `creator_event_snapshot` provides fast creator list filters and replacement compatibility flags.
- `creator_lifecycle_snapshot` is rebuildable current state; it should be written only by lifecycle persistence services.
- `joinbrands_link.ev_*` becomes read-only compatibility output until removed.

### 4.4 Operator Work State

Current table:

- `wa_crm_data`

Direction:

Split this table conceptually before changing schema:

| Current column group | Target owner |
| --- | --- |
| `priority`, `next_action`, `urgency_level` | Keep as operator work state, possibly renamed to `creator_work_state`. |
| `beta_status`, `beta_cycle_start`, `beta_program_type` | Move to `events` and `event_periods`. |
| `monthly_fee_*` | Move to policy-backed event/settlement facts. |
| `agency_bound`, `agency_bound_at`, `agency_deadline` | Move to canonical `agency_bound` events with evidence. |
| `video_count`, `video_target`, `video_last_checked` | Move to challenge periods or external Keeper/JB facts. |

Do not rename or drop `wa_crm_data` until all readers are migrated.

### 4.5 AI, SFT, Profile, And Memory

Keep:

- `sft_memory`
- `sft_feedback`
- `generation_log`
- `retrieval_snapshot`
- `client_profiles`
- `client_profile_snapshots`
- `client_profile_change_events`
- `profile_analysis_state`
- `client_memory`
- `client_tags`
- `policy_documents`
- `operator_experiences`
- `custom_topic_templates`
- `ai_provider_configs`
- `ai_usage_logs`
- `ai_usage_daily`

Direction:

- `client_profiles` is the current profile.
- `client_profile_snapshots` is profile history.
- `client_profile_change_events` is review workflow state.
- `client_memory` is stable operator/AI memory.
- `client_tags` is a compact label index, not a replacement for memory.
- `generation_log` and `retrieval_snapshot` are audit/debug logs. Add retention and aggregation rules.
- `sft_memory` is training data and should keep enough generation context to reproduce what was reviewed.
- New AI/profile rows should include `creator_id` where possible, while keeping hashed or scoped external ids for privacy and compatibility.

### 4.6 Ops, Audit, And Jobs

Keep:

- `audit_log`
- `sync_log`
- `training_log`
- `cleanup_jobs`
- `ai_usage_logs`
- `ai_usage_daily`

Direction:

- `audit_log` remains security/product audit.
- `sync_log`, `training_log`, and `cleanup_jobs` can remain separate for now, but future consolidation into `job_runs` is reasonable if more job types appear.
- Add retention:
  - Keep `audit_log` longer than product logs.
  - Roll up `ai_usage_logs` into `ai_usage_daily`.
  - Archive old `retrieval_snapshot` and `generation_log` rows after rollout windows.

## 5. Write Ownership Rules

| Data area | Only allowed writer |
| --- | --- |
| Creator identity | creator service, merge service, roster import scripts |
| Raw WA messages | WA persistence services and repair scripts |
| Group messages | group message service |
| Event facts | event routes/services and approved backfill scripts |
| Event snapshots | `creatorEventSnapshotService` only |
| Lifecycle snapshots | `lifecyclePersistenceService` only |
| Profile current state | profile/profile-analysis services |
| AI generation logs | reply generation service |
| SFT memory | SFT service/routes |
| Policy documents | policy routes and lifecycle policy routes |
| Auth users/sessions | user/session repositories |

Forbidden after Phase 1:

- Runtime `CREATE TABLE` in services.
- New writes to `joinbrands_link.ev_*`.
- New lifecycle writes directly to `wa_crm_data`.
- Query code treating weak/generated event rows as lifecycle-driving facts.
- Logging raw `wa_phone` to external systems or debug logs.

## 6. Migration Plan

### Phase 0: Inventory And Freeze

Status: this document starts the inventory.

Actions:

- Add owner/role/action metadata for all tables.
- Keep row counts in reports without exposing message content or phone values.
- Freeze new schema additions unless they go through migration and `schema.sql`.
- Mark `joinbrands_link.ev_*` and lifecycle-related `wa_crm_data` columns as deprecated write targets.

Acceptance:

- Maintainers can answer who owns every table.
- No new runtime-created table appears after this point.

### Phase 1: Restore Schema Source Of Truth

Status: implemented in the first mysql optimize pass.

Actions:

- Add the 7 managed runtime-created tables to `schema.sql` and a migration:
  - `wa_group_chats`
  - `wa_group_messages`
  - `profile_analysis_state`
  - `client_profile_snapshots`
  - `client_profile_change_events`
  - `event_detection_cursor`
  - `event_detection_runs`
- Identify `activeEventDetectionService` as the owner for `event_detection_cursor` and `event_detection_runs`; do not archive them.
- Remove runtime table creation from services once migrations are present.
- Fix `scripts/analyze-schema-state.js` parser so generated columns do not produce the `CASE` false positive.

Acceptance:

- `scripts/analyze-schema-state.js` reports no extra active tables.
- `rg -n "CREATE TABLE IF NOT EXISTS" server scripts` shows only migrations or approved setup scripts.

### Phase 2: Normalize Creator Identity In AI/Profile Tables

Actions:

- Add nullable `creator_id` to active AI/profile tables that currently rely on `client_id`:
  - `client_memory`
  - `client_profiles`
  - `client_tags`
  - `client_profile_snapshots`
  - `client_profile_change_events`
  - `profile_analysis_state`
  - `generation_log`
  - `retrieval_snapshot`
  - `sft_feedback`
- Backfill `creator_id` through the canonical creator resolver.
- Keep external ids for compatibility, but do not build new joins on external phone strings.

Acceptance:

- New profile/memory/generation writes include `creator_id` when the creator can be resolved.
- Existing APIs continue to accept `client_id` and resolve it safely.

### Phase 3: Migrate CRM State Into Events

Actions:

- Create helper functions for writing canonical CRM facts:
  - beta/trial start
  - monthly challenge start/settlement
  - agency bound
  - GMV milestone
  - referral/recall overlays
- Change `/api/creators/:id/wacrm` and batch update paths so lifecycle changes write `events` first.
- Rebuild `creator_event_snapshot` from facts.
- Keep `wa_crm_data` only for operator work state.

Acceptance:

- No code path writes lifecycle flags directly into `joinbrands_link.ev_*`.
- Creator filters use `creator_event_snapshot` or event fact services.
- A lifecycle state can be traced back to an event and evidence row.

### Phase 4: Retention And Archive Policy

Actions:

- Define retention for high-volume logs:
  - `generation_log`
  - `retrieval_snapshot`
  - `ai_usage_logs`
  - `audit_log`
  - `wa_group_messages`
  - `wa_messages`
- Add archive scripts that redact or hash external identifiers where needed.
- Add `ai_usage_daily` rollup job if it is intended to be used; it currently has 0 rows.

Acceptance:

- Product logs have clear retention.
- AI usage daily metrics are either populated or the table is removed from the active model.

### Phase 5: Compatibility Removal

Actions:

- After one verification window, remove deprecated readers.
- Rename or replace `wa_crm_data` with a narrower work-state table only after all APIs are migrated.
- Drop or archive `manual_match` if it remains empty.
- Keep `event_detection_cursor` and `event_detection_runs` while `activeEventDetectionService` owns them; revisit only if that service contract is removed.

Acceptance:

- Table count decreases because compatibility and orphan tables are gone, not because unrelated concepts were merged.
- All public APIs still return the fields the frontend expects.

## 7. Immediate Next PRs

Recommended order after the first implementation pass:

1. Migration application and schema convergence PR:
   - Apply migrations 005 and 006 in target environments.
   - Verify `node scripts/analyze-schema-state.js` reports no drift.
2. Event-fact write helper plus backend `wacrm` route migration:
   - Convert lifecycle edits into `events` plus `event_evidence`.
   - Rebuild event/lifecycle snapshots after writes.
3. Frontend creator detail edit migration:
   - Stop normal UI forms from submitting deprecated lifecycle fields.
   - Handle `legacy_lifecycle_writes_frozen` responses clearly.
4. Remaining runtime DDL cleanup:
   - Classify creator import, custom topic, media, and training DDL paths.
   - Move request/runtime DDL into migrations where needed.
5. `creator_id` profile/AI backfill:
   - Add nullable `creator_id` columns.
   - Backfill and update new writes to prefer internal creator identity.
6. Retention PR:
   - Add archive/rollup policy and scripts for generation/retrieval/usage logs.

## 8. Verification Checklist

Run before each migration ships:

```bash
node scripts/analyze-schema-state.js
rg -n "CREATE TABLE IF NOT EXISTS" server scripts
rg -n "joinbrands_link|ev_joined|ev_trial|ev_monthly|ev_agency|ev_gmv" server scripts src db.js
rg -n "wa_crm_data" server scripts src db.js
```

Expected direction:

- `analyze-schema-state` has no unowned extra tables.
- Runtime services no longer create active tables.
- Legacy event flag writes shrink to zero.
- `wa_crm_data` references shrink to operator work-state fields.
- Event/lifecycle APIs return consistent status for the same creator.

## 9. Rollout Risks

| Risk | Mitigation |
| --- | --- |
| Frontend filters break when legacy flags stop updating | Keep compatibility output in `creator_event_snapshot.compat_ev_flags_json` until frontend fully migrates. |
| Lifecycle stage changes unexpectedly | Rebuild snapshots in dry-run mode and compare stage distributions before write. |
| AI prompts lose context during `client_id` to `creator_id` migration | Dual-read by `creator_id` and legacy `client_id` during rollout. |
| Log retention deletes useful training/debug context | Retain linked SFT/generation snapshots for approved SFT records even if general logs are archived. |
| Runtime-created table removal breaks cold start | Add migrations first, deploy, verify, then remove runtime creation. |

## 10. Non-Goals

- No immediate `DROP TABLE` without backup and owner approval.
- No SQLite or `crm.db` restoration.
- No schema rewrite that changes public API responses in the same step.
- No external memory system migration; project memory remains in `docs/obsidian/`.

## Obsidian Sync

- Status: synced
- Note: `docs/obsidian/notes/2026-04-27-database-schema-optimization-plan.md`
- Index: `docs/obsidian/index.md`
