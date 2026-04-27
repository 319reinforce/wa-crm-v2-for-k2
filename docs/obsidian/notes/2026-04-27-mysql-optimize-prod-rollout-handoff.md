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

- Production/staging schema changes require explicit migrations 005 through 013 with the target DB env loaded.
- The API process does not create or migrate production tables at startup.
- Container deployments can opt into startup migrations with `DB_MIGRATE_ON_STARTUP=true`; the entrypoint runs migrations 005-013 before `node server/index.cjs`.
- Non-local DB startup migrations still require `CONFIRM_REMOTE_MIGRATION=1`.
- `DB_MIGRATION_INCLUDE_004=true` can prepend the event/lifecycle base migration for older environments.
- Startup migrations run under a MySQL named lock to avoid multi-container DDL races.
- Startup recompute is enabled by default unless `STARTUP_EVENT_RECOMPUTE_ENABLED` is disabled.
- Startup recompute rebuilds `creator_event_snapshot` and `creator_lifecycle_snapshot` from existing facts/events/compatibility data.
- Startup recompute does not scan all historical WA messages and does not create new canonical events from message content.
- If schema is missing, startup recompute skips safely and the API continues booting.
- Historical AI/Minimax event extraction must remain a separate backfill plan, not an implicit production startup behavior.

## Verification Or Rollout Notes

- Local migrations 005-013 were already verified in the implementation branch.
- Local schema analyzer verification was clean after migration 013.
- Startup migration runner added: `scripts/run-startup-migrations.cjs`, `scripts/docker-entrypoint.sh`, and `npm run db:migrate:startup`.
- `013_retention_external_archive_checks.sql` index creation is guarded by information_schema so repeated image restarts remain idempotent.
- Staging/prod migration execution is still pending because no production database credentials are present in this workspace.
- Expected post-migration startup log: `[Startup][EventDerivedData] recompute done: processed=<n>, snapshots=<n>, lifecycles=<n>, duration_ms=<ms>`.
- Expected pre-migration/partial-migration startup log: `[Startup][EventDerivedData] skip recompute: schema missing ...`.

## Source Document

- `docs/MYSQL_OPTIMIZE_PROD_ROLLOUT_HANDOFF_20260427.md`

## Follow-Up Items

- Run migrations 005-013 in staging/prod through the approved DB operation path.
- For container rollout, set `DB_MIGRATE_ON_STARTUP=true`; add `CONFIRM_REMOTE_MIGRATION=1` for external DB hosts.
- Run `node scripts/analyze-schema-state.js` after migration.
- Restart API and confirm startup recompute logs.
- Keep deprecated `joinbrands_link.ev_*` and `wa_crm_data` fields as fallback until the verification window closes.
- Plan historical message-to-event extraction separately if the business wants a full AI rebuild beyond derived snapshots.
