---
title: Event Lifecycle Backfill Handoff
date: 2026-04-25
project: wa-crm-v2
type: handoff
source_path: docs/EVENT_LIFECYCLE_BACKFILL_HANDOFF_20260425.md
status: active
tags:
  - wa-crm-v2
  - events
  - lifecycle
  - backfill
---

# Event Lifecycle Backfill Handoff

## Summary

The 2026-04-25 event lifecycle backfill landed the event fact columns, evidence table, creator event snapshot, front-end metric split, Tier 2 compatibility downgrade, snapshot-based filtering, and EventPanel human review flow.

## Key Decisions

- Legacy canonical active/completed events were initially backfilled as Tier 2 for compatibility, then placeholder-only `v1_import` agency rows were downgraded.
- `creator_event_snapshot` is now the primary read source for event filters, with `joinbrands_link.ev_*` retained as fallback compatibility data.
- Tier 0 draft events stay non-driving until human review confirms them as Tier 2.
- MiniMax is allowed only as a dry-run/import candidate source; Tier 0/1 candidates remain gated by review.

## Source

- Source document: `docs/EVENT_LIFECYCLE_BACKFILL_HANDOFF_20260425.md`
- PRD: `docs/EVENT_LIFECYCLE_DATA_PRD_20260425.md`
- Earlier handoff archive: `docs/archive/handoffs/EVENT_LIFECYCLE_HANDOFF_20260425.md`

## Verification

- Backfilled 1622 events, inserted 1622 evidence rows, and rebuilt 279 creator event snapshots.
- Downgraded 52 placeholder-only historical Tier 2 rows and recomputed lifecycle snapshots for 52 affected creators.
- Focused tests passed: 25/25.
- `npm run build` passed.
- `git diff --check` passed.
- Local health endpoint passed; authenticated creators/events endpoints were not smoke-tested without credentials.

## Follow-Ups

- Browser smoke test the EventPanel review UI.
- Decide whether MiniMax per-message errors need retry/timeout handling.
- Move future manual `ev_*` writes to event-first writes plus snapshot rebuild.
- Add persistent audit rows for bulk Tier 2 downgrade if operator-visible history is required.
