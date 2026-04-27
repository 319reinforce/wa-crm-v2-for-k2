---
title: Database Schema Optimization Plan
date: 2026-04-27
project: wa-crm-v2
type: design
source_path: docs/DATABASE_SCHEMA_OPTIMIZATION_PLAN_20260427.md
status: active
tags:
  - wa-crm-v2
  - database
  - schema
  - cleanup
---

# Database Schema Optimization Plan

## Summary

The WA CRM v2 database had 49 actual MySQL tables while `schema.sql` defined 42 before the first implementation pass. The mismatch came from runtime-created profile/group-message tables and active event detection tables. The plan defines explicit table roles, target domains, write ownership, and a staged cleanup path.

## Key Decisions

- Treat table count as a symptom. The real fix is to separate source-of-truth tables, derived snapshots, compatibility caches, logs, work queues, and archive candidates.
- Move runtime-created active tables into `schema.sql` and migrations.
- Keep `event_detection_cursor` and `event_detection_runs`; owner is `activeEventDetectionService`, so they are not archive candidates.
- Keep `events` plus `event_evidence` as the lifecycle fact source of truth.
- Downgrade `joinbrands_link.ev_*` and lifecycle fields in `wa_crm_data` to compatibility/work-state paths.
- Block direct legacy lifecycle writes by default; temporary migration writes require `ALLOW_LEGACY_LIFECYCLE_WRITES=1`.
- Prefer `creator_id` for new AI/profile/memory joins while keeping external `client_id` compatibility.
- Add retention and archive rules for `generation_log`, `retrieval_snapshot`, `ai_usage_logs`, audit data, and message/media history.

## Source Document

- `docs/DATABASE_SCHEMA_OPTIMIZATION_PLAN_20260427.md`

## Verification Notes

- `node scripts/analyze-schema-state.js` was run against local MySQL on 2026-04-27.
- Pre-implementation actual table count: 49.
- Pre-implementation expected table count from `schema.sql`: 42.
- Extra tables: `client_profile_change_events`, `client_profile_snapshots`, `event_detection_cursor`, `event_detection_runs`, `profile_analysis_state`, `wa_group_chats`, `wa_group_messages`.
- Row-count inventory was collected without exposing phone numbers or message contents.
- First implementation pass added the managed runtime tables to `schema.sql`.
- `event_detection_cursor` and `event_detection_runs` are covered by `server/migrations/005_active_event_detection_queue.sql`.
- `server/migrations/006_managed_runtime_tables.sql` covers WA group tables and profile analysis tables.
- Post-implementation schema check on local MySQL reports 49 actual tables, 49 expected tables, and no missing/extra/column diffs.
- Runtime DDL was removed from `groupMessageService`, `profileAnalysisService`, and `activeEventDetectionService`; these services now fail clearly if the migration has not been run.
- Second pass added backend canonical lifecycle event writes for mappable `wacrm` legacy payloads while keeping unmapped amount/progress fields protected.

## Follow-Up Items

- Apply and verify `server/migrations/005_active_event_detection_queue.sql` and `server/migrations/006_managed_runtime_tables.sql` in target environments.
- Add `creator_id` backfill plan for AI/profile tables.
- Define retention windows for high-volume logs.
