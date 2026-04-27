---
title: Event Lifecycle Data Model
date: 2026-04-25
project: wa-crm-v2
type: design
source_path: docs/EVENT_LIFECYCLE_DATA_PRD_20260425.md
status: active
tags:
  - wa-crm-v2
  - events
  - lifecycle
---

# Event Lifecycle Data Model

## Summary

The event system is being separated into definitions, facts, evidence, and lifecycle snapshots so generated or weak evidence rows no longer drive lifecycle decisions.

## Key Decisions

- `events` should distinguish canonical facts from generated candidates.
- Evidence strength and review state must be explicit.
- `joinbrands_link.ev_*` becomes a compatibility output, not the primary write target.
- Dashboard metrics should separate detected time, business event time, and confirmed event counts.

## Source

- PRD: `docs/EVENT_LIFECYCLE_DATA_PRD_20260425.md`
- Handoff source was removed during deep doc cleanup; keep this Obsidian note as the historical summary.
- Backfill handoff: `docs/EVENT_LIFECYCLE_BACKFILL_HANDOFF_20260425.md`

## Verification

- Source documents contain implementation and validation notes.
- External MiniMax reruns require explicit authorization before sending private CRM message content.

## Follow-Ups

- Build review workflow for legacy Tier 2 rows.
- Migrate front-end filters to `creator_event_snapshot`.
- Add UI detail view for evidence and review state.
