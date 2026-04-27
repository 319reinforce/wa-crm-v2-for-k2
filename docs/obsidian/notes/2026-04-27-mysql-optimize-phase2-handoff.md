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
- Target environments now need migrations 005 through 010 before deploying this code.
- `joinbrands_link.ev_*` and lifecycle fields in `wa_crm_data` remain compatibility/read paths, not normal write targets.
- CreatorDetail positive lifecycle edits should create canonical `events` rows.
- `monthly_fee_amount`, video progress fields, and agency deadline fields stay frozen until billing/progress/deadline ownership is implemented.
- AI/profile tables now carry nullable `creator_id` for stable joins and future cleanup.

## Verification

- Local `.env` points to `127.0.0.1:3306/wa_crm_v2`; no staging/prod DB env was present.
- Local migrations 005-010 were applied with `scripts/apply-sql-migrations.cjs`.
- `node scripts/analyze-schema-state.js` reported 52 expected tables, 52 actual tables, no missing/extra tables, no column diffs, no index diffs, and no key findings.
- Runtime DDL grep over `server/services`, `server/routes`, and `server/workers` returned no normal path matches.

## Source Document

- `docs/MYSQL_OPTIMIZE_PHASE2_HANDOFF_20260427.md`

## Follow-Up Items

- Run migrations 005-010 in staging/prod once DB env access is available.
- Add canonical write APIs for billing/progress/deadline fields.
- Add negative/cancel event transitions from UI if users need to clear lifecycle state.
- Implement retention/archive jobs for generation/retrieval logs and media after policy approval.
- Remove read dependence on deprecated compatibility fields after a verification window.
