---
title: MySQL Optimize Handoff
date: 2026-04-27
project: wa-crm-v2
type: handoff
source_path: docs/MYSQL_OPTIMIZE_HANDOFF_20260427.md
status: active
tags:
  - wa-crm-v2
  - mysql
  - schema
  - handoff
---

# MySQL Optimize Handoff

## Summary

The first MySQL optimize implementation pass moved active runtime-created schema toward canonical ownership and froze hidden legacy lifecycle write paths by default.

## Key Decisions

- Keep `event_detection_cursor` and `event_detection_runs`; `activeEventDetectionService` owns them.
- Add managed runtime tables to `schema.sql` and migrations instead of creating them from normal services.
- Runtime services now check for required tables and fail with migration guidance.
- `joinbrands_link.ev_*` and lifecycle-related `wa_crm_data` fields are deprecated compatibility state.
- Direct legacy lifecycle writes are blocked unless `ALLOW_LEGACY_LIFECYCLE_WRITES=1` is set for controlled migration work.
- Second pass added a backend canonical event write helper and migrated mappable `PUT /api/creators/:id/wacrm` lifecycle payloads into `events` plus `event_evidence`.
- Unmapped lifecycle fields remain protected instead of being silently written to deprecated columns.

## Source Document

- `docs/MYSQL_OPTIMIZE_HANDOFF_20260427.md`

## Verification Notes

- `npm test` passed smoke, build, and unit suite.
- `npm run test:unit` passed: 35 pass, 3 skipped.
- `node --test tests/unit/lifecycleEventWriteService.unit.test.mjs tests/creatorListFields.test.mjs` passed after the backend route migration.
- Relevant `node --check` commands passed.
- `git diff --check` passed.
- `node scripts/analyze-schema-state.js` reports 52 actual tables, 52 expected tables, no missing tables, no extra tables, and no column diffs after applying migration 007 locally.

## Follow-Up Items

- Apply and verify migrations 005, 006, and 007 in target environments.
- Finish frontend edit flow migration so normal UI does not submit deprecated lifecycle fields.
- Decide canonical handling for still-protected amount/progress fields such as `monthly_fee_amount`, `video_count`, and `video_target`.
- Continue runtime DDL cleanup for creator import, custom topic, media, and training paths; migration 007 now covers creator import tables, but service-time DDL still needs removal after rollout.
- Plan `creator_id` backfill for profile and AI tables.
