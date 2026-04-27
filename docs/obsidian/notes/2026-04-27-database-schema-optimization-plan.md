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

The WA CRM v2 database currently has 49 actual MySQL tables while `schema.sql` defines 42. The mismatch comes from runtime-created profile/group-message tables and two orphaned event detection tables. The plan defines explicit table roles, target domains, write ownership, and a staged cleanup path.

## Key Decisions

- Treat table count as a symptom. The real fix is to separate source-of-truth tables, derived snapshots, compatibility caches, logs, work queues, and archive candidates.
- Move runtime-created active tables into `schema.sql` and migrations.
- Keep `events` plus `event_evidence` as the lifecycle fact source of truth.
- Downgrade `joinbrands_link.ev_*` and lifecycle fields in `wa_crm_data` to compatibility/work-state paths.
- Prefer `creator_id` for new AI/profile/memory joins while keeping external `client_id` compatibility.
- Add retention and archive rules for `generation_log`, `retrieval_snapshot`, `ai_usage_logs`, audit data, and message/media history.

## Source Document

- `docs/DATABASE_SCHEMA_OPTIMIZATION_PLAN_20260427.md`

## Verification Notes

- `node scripts/analyze-schema-state.js` was run against local MySQL on 2026-04-27.
- Actual table count: 49.
- Expected table count from `schema.sql`: 42.
- Extra tables: `client_profile_change_events`, `client_profile_snapshots`, `event_detection_cursor`, `event_detection_runs`, `profile_analysis_state`, `wa_group_chats`, `wa_group_messages`.
- Row-count inventory was collected without exposing phone numbers or message contents.

## Follow-Up Items

- Create the schema source-of-truth PR for runtime-created active tables.
- Decide whether `event_detection_cursor` and `event_detection_runs` still have a code owner.
- Add write guards around legacy lifecycle fields.
- Add `creator_id` backfill plan for AI/profile tables.
- Define retention windows for high-volume logs.
