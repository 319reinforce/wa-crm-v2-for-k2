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

## Source Document

- `docs/MYSQL_OPTIMIZE_HANDOFF_20260427.md`

## Verification Notes

- `npm test` passed smoke, build, and unit suite.
- `npm run test:unit` passed.
- Relevant `node --check` commands passed.
- `git diff --check` passed.
- `node scripts/analyze-schema-state.js` reports 49 actual tables, 49 expected tables, no missing tables, no extra tables, and no column diffs.

## Follow-Up Items

- Apply and verify migrations 005 and 006 in target environments.
- Replace `PUT /api/creators/:id/wacrm` lifecycle edits with canonical event fact writes.
- Update frontend edit flows so normal UI does not submit deprecated lifecycle fields.
- Continue runtime DDL cleanup for creator import, custom topic, media, and training paths.
- Plan `creator_id` backfill for profile and AI tables.
