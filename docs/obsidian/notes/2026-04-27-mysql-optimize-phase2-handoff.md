---
title: MySQL Optimize Phase 2 Handoff
date: 2026-04-27
project: wa-crm-v2
type: handoff
source_path: docs/MYSQL_OPTIMIZE_PHASE2_HANDOFF_20260427.md
status: active
tags:
  - wa-crm-v2
  - mysql
  - schema
  - handoff
---

# MySQL Optimize Phase 2 Handoff

## Summary

Phase 2 continues the database cleanup after PR #84. It adds managed migration coverage for template/media/training runtime tables, removes remaining normal service-time DDL, adds `creator_id` linkage for AI/profile data, moves CreatorDetail lifecycle edits to event-first writes, and documents field ownership plus retention policy.

## Key Decisions

- Normal service/route/worker paths should check schema readiness and fail with migration guidance instead of creating tables or columns.
- Target environments now need migrations 004 through 013 before deploying this code.
- `joinbrands_link.ev_*` and lifecycle fields in `wa_crm_data` remain compatibility/read paths, not normal write targets.
- CreatorDetail positive lifecycle edits should create canonical `events` rows.
- CreatorDetail clear/cancel lifecycle edits now use `POST /api/events/cancel-by-key`, cancel canonical event rows, rebuild lifecycle/snapshot state, and never write deprecated lifecycle fields back to false/null.
- Creator detail responses expose `event_snapshot`, and positive `POST /api/events` writes rebuild `creator_event_snapshot` so the UI can prefer canonical flags over deprecated compatibility columns.
- The API process now schedules startup event derived-data recompute after boot. It checks schema first, skips safely if staging/prod lifecycle/SQL migrations are not applied, and recomputes `creator_event_snapshot` plus `creator_lifecycle_snapshot` after migration/restart.
- `monthly_fee_amount`, video progress fields, and agency deadline fields now write to `event_billing_facts`, `event_progress_facts`, and `event_deadline_facts` instead of deprecated `wa_crm_data` lifecycle columns.
- Retention/archive jobs are now represented by `data_retention_policies`, `data_retention_runs`, `data_retention_archive_refs`, `message_archive_monthly_rollups`, and `data_retention_external_archive_checks`; the runner defaults to dry-run, apply mode writes rollups/archive refs, and purge remains a separate explicit flag.
- Hard-delete windows are explicit: generation/retrieval after 365 days if unlinked, AI usage after 730 days after daily rollup, WA 1:1 after 1095 days and WA group after 730 days only after a verified external archive check covers the purge cutoff, media after 90 days via media cleanup ownership.
- List/detail reads, kanban filters, CreatorDetail/EventPanel agency checks, AI prompt helpers, stats, V1 board payloads, lifecycle persistence, duplicate merge, and final roster export now prefer `creator_event_snapshot` compatibility flags and operational facts before falling back to deprecated `joinbrands_link.ev_*` / `wa_crm_data` fields.
- AI/profile tables now carry nullable `creator_id` for stable joins and future cleanup.

## Verification

- Local `.env` points to `127.0.0.1:3306/wa_crm_v2`; no staging/prod DB env was present.
- Local migrations 004-013 were applied with `scripts/apply-sql-migrations.cjs` / `npm run db:migrate:sql`; staging/prod still need the 004-013 sequence with target DB env loaded.
- `node scripts/analyze-schema-state.js` reported 52 expected tables, 52 actual tables, no missing/extra tables, no column diffs, no index diffs, and no key findings.
- Runtime DDL grep over `server/services`, `server/routes`, and `server/workers` returned no normal path matches.
- Canonical event cancel/clear patch verification: `npm test` passed, and `node scripts/analyze-schema-state.js` again reported no table/column/index drift.
- Startup recompute was checked with targeted `node --check`, `npm run build`, and `npm run test:unit`.
- Migration 011 local verification: analyzer reported 58 expected tables, 58 actual tables, no missing/extra tables, no column/index diffs; retention dry-run returned seven seeded policies with zero local candidates and no writes.
- Migration 012 verification: analyzer reported 59 expected tables, 59 actual tables, no missing/extra tables, no column/index diffs; retention dry-run returned AI daily rollup and WA monthly rollup previews plus explicit purge windows with no local candidates.
- Migration 013 verification: analyzer reported 60 expected tables, 60 actual tables, no missing/extra tables, no column/index diffs; WA message dry-runs returned `external_archive_verification_required`, proving hard-delete candidate enumeration is blocked until `data_retention_external_archive_checks` has a verified covering record with manifest sha256.

## Source Document

- `docs/MYSQL_OPTIMIZE_PHASE2_HANDOFF_20260427.md`

## Follow-Up Items

- Run migrations 004-013 in staging/prod once DB env access is available.
- Restart staging/prod after migration and confirm startup event derived-data recompute logs.
- Verify `POST /api/events/cancel-by-key` in staging/prod with CreatorDetail clear/cancel actions.
- Verify `POST /api/creators/:id/operational-facts` in staging/prod after migration 011.
- Run `node scripts/run-retention-archive-jobs.cjs --dry-run` in staging/prod and review rollup/candidate samples before any apply.
- Continue removing deprecated compatibility reads after the snapshot/facts verification window; remaining consumers include creator list SQL fallbacks, reply strategy, retrieval/profile prompt context, and older one-off scripts.
- Before WA message hard deletes, record and review verified `data_retention_external_archive_checks` rows for both 1:1 and group message archives, including archive URI, manifest sha256, record count, and covered cutoff.
