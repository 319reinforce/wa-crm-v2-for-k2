---
title: Database Structure Future Optimization Handoff
date: 2026-04-27
project: wa-crm-v2
type: handoff
source_path: docs/DATABASE_STRUCTURE_FUTURE_OPTIMIZATION_HANDOFF_20260427.md
status: active
tags:
  - wa-crm-v2
  - mysql
  - schema
  - handoff
  - roadmap
---

# Database Structure Future Optimization Handoff

## Summary

This note summarizes the post-rollout database optimization roadmap after the MySQL optimize startup migration branch. The project is at a 60-table target schema with startup migrations 004-013 and event-derived rebuilds; the next work is compatibility read cleanup, retention/archive rollout, and eventual old-field removal.

## Key Decisions

- Do not optimize by table count alone; optimize by ownership, write path, rebuildability, and retention.
- `events`, `event_evidence`, `creator_event_snapshot`, and `creator_lifecycle_snapshot` remain the canonical event/lifecycle path.
- `joinbrands_link.ev_*` and lifecycle fields in `wa_crm_data` are deprecated compatibility fallback only.
- `event_billing_facts`, `event_progress_facts`, and `event_deadline_facts` own amount/progress/deadline facts.
- AI/profile tables should use `creator_id` as internal identity, with `client_id` retained only as scoped compatibility.
- Retention work must proceed from dry-run to archive/rollup to externally verified purge; WA message hard delete remains gated.
- Drop/archive work comes last, after grep proof and a validation window.

## Verification Or Rollout Notes

- Current local baseline: 60 expected tables, 60 actual tables, no table/column/index diffs.
- Container startup migration now runs 004-013 by default.
- The roadmap recommends schema analyzer output as the first staging/prod baseline artifact after rollout.
- Each future database PR should include grep proof for deprecated reads and analyzer verification.

## Source Document

- `docs/DATABASE_STRUCTURE_FUTURE_OPTIMIZATION_HANDOFF_20260427.md`

## Follow-Up Items

- Finish staging/prod rollout baseline validation.
- Shrink old lifecycle reads in creator list/detail, prompt context, reporting, and export scripts.
- Split `wa_crm_data` into work state plus canonical facts.
- Convert `joinbrands_link.ev_*` to snapshot-only compatibility output, then drop after the validation window.
- Move retention jobs from dry-run to controlled apply for AI usage and message monthly rollups.
- Plan the first drop/archive PR only after 30-60 days of no deprecated read/write dependency.
