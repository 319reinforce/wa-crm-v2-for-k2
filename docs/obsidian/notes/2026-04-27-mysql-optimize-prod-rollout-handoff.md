---
title: MySQL Optimize Prod Rollout Handoff
date: 2026-04-27
project: wa-crm-v2
type: handoff
source_path: docs/MYSQL_OPTIMIZE_PROD_ROLLOUT_HANDOFF_20260427.md
status: active
tags:
  - wa-crm-v2
  - mysql
  - schema
  - rollout
  - handoff
---

# MySQL Optimize Prod Rollout Handoff

## Summary

This note records the production rollout boundary for the MySQL optimize branch: API startup can rebuild event-derived snapshots after schema is ready, and container entrypoint startup migrations are available behind an explicit opt-in flag.

## Key Decisions

- Production/staging schema changes require explicit migrations 004 through 013 with the target DB env loaded.
- The API process does not create or migrate production tables at startup.
- Container deployments run startup migrations by default; the entrypoint runs migrations 004-013 before `node server/index.cjs`.
- Set `DB_MIGRATE_ON_STARTUP=false` only to intentionally skip startup migrations.
- Startup runner calls `scripts/apply-sql-migrations.cjs --allow-remote`, so no separate `CONFIRM_REMOTE_MIGRATION=1` is required for container startup.
- `DB_MIGRATION_INCLUDE_004=true` is the default so the event/lifecycle base migration runs with every startup migration sequence.
- Startup migrations run under a MySQL named lock to avoid multi-container DDL races.
- Startup recompute is enabled by default unless `STARTUP_EVENT_RECOMPUTE_ENABLED` is disabled.
- Startup recompute rebuilds `creator_event_snapshot` and `creator_lifecycle_snapshot` from existing facts/events/compatibility data.
- Startup recompute does not scan all historical WA messages and does not create new canonical events from message content.
- If schema is missing, startup recompute skips safely and the API continues booting.
- Historical AI/Minimax event extraction must remain a separate backfill plan, not an implicit production startup behavior.

## Verification Or Rollout Notes

- Local migrations 004-013 were verified in the implementation branch.
- Local schema analyzer verification was clean after migration 013.
- Startup migration runner added: `scripts/run-startup-migrations.cjs`, `scripts/docker-entrypoint.sh`, and `npm run db:migrate:startup`.
- `013_retention_external_archive_checks.sql` index creation is guarded by information_schema so repeated image restarts remain idempotent.
- Staging/prod migration execution is still pending because no production database credentials are present in this workspace.
- Expected post-migration startup log: `[Startup][EventDerivedData] recompute done: processed=<n>, snapshots=<n>, lifecycles=<n>, duration_ms=<ms>`.
- Expected pre-migration/partial-migration startup log: `[Startup][EventDerivedData] skip recompute: schema missing ...`.

## Source Document

- `docs/MYSQL_OPTIMIZE_PROD_ROLLOUT_HANDOFF_20260427.md`

## Follow-Up Items

- Run migrations 004-013 in staging/prod through the approved DB operation path.
- For container rollout, leave `DB_MIGRATE_ON_STARTUP` unset or set it to `true`.
- Run `node scripts/analyze-schema-state.js` after migration.
- Restart API and confirm startup recompute logs.
- Keep deprecated `joinbrands_link.ev_*` and `wa_crm_data` fields as fallback until the verification window closes.
- Plan historical message-to-event extraction separately if the business wants a full AI rebuild beyond derived snapshots.
