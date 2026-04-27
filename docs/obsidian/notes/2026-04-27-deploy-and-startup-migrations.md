---
title: Deploy And Startup Migrations
date: 2026-04-27
project: wa-crm-v2
type: runbook
source_path: DEPLOY.md
status: active
tags:
  - wa-crm-v2
  - deploy
  - docker
  - mysql
---

# Deploy And Startup Migrations

## Summary

WA CRM v2 deploys as a Node.js + MySQL app. Container images now have an entrypoint-controlled startup migration path that can apply managed SQL migrations before the API starts.

## Key Decisions

- The Docker image entrypoint is `scripts/docker-entrypoint.sh`.
- Startup migrations are disabled by default.
- Set `DB_MIGRATE_ON_STARTUP=true` to run `server/migrations/005_active_event_detection_queue.sql` through `server/migrations/013_retention_external_archive_checks.sql` before `node server/index.cjs`.
- Set `DB_MIGRATION_INCLUDE_004=true` only for older environments that never received the event/lifecycle base migration.
- Non-local DB hosts still require `CONFIRM_REMOTE_MIGRATION=1`.
- Startup migrations use a MySQL named lock to reduce multi-container DDL race risk.
- `crm.db` and SQLite remain banned.

## Verification Or Rollout Notes

- Startup migration runner: `scripts/run-startup-migrations.cjs`.
- Docker entrypoint: `scripts/docker-entrypoint.sh`.
- NPM helper: `npm run db:migrate:startup`.
- Optional analyzer after startup migration: `DB_MIGRATION_ANALYZE_AFTER=true`.

## Source Document

- `DEPLOY.md`

## Follow-Up Items

- Enable `DB_MIGRATE_ON_STARTUP=true` only after backup/rollout approval.
- Confirm startup migration logs before relying on startup event-derived-data recompute.
- Keep SQL migrations idempotent because the entrypoint path is repeatable on every image/container restart.
