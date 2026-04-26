---
title: Active Event Detection Handoff
date: 2026-04-26
project: wa-crm-v2
type: handoff
source_path: docs/ACTIVE_EVENT_DETECTION_HANDOFF_20260426.md
status: active
tags:
  - wa-crm-v2
  - memory
  - events
  - lifecycle
rollout: implemented-locally-pending-production
---

## Summary

The event-recognition section appeared stuck on 2026-04-16 because event detection was driven by historical/manual imports, not by an active queue tied to new WhatsApp messages and message supplements. The implementation adds queue/run tables, enqueue hooks, API endpoints, and a CLI so new or supplemented messages can be scanned in dry-run or write mode.

## Key Decisions

- Active detection starts as queue + batch processing, not an always-on external LLM worker.
- Dry-run records an audit run but does not advance `event_detection_cursor`.
- Write-mode candidates are inserted as `draft`, `unreviewed`, Tier 0 by default, and `lifecycle_effect = none`.
- Message supplement, WA worker, direct persistence, and legacy insert paths enqueue creators for later detection.
- Event display should prefer `source_event_at`/`start_at` before import/detection time.
- MiniMax semantic review requires explicit authorization and production/recent message access.

## Source Document

- `docs/ACTIVE_EVENT_DETECTION_HANDOFF_20260426.md`

## Verification And Rollout Notes

- Syntax checks passed for active detection service, route, script, DB integration, direct persistence, and repair service files.
- Local keyword dry-run since `2026-04-16T00:00:00+08:00` scanned creator 1072 and creator 1087 with zero new candidates.
- Local database showed 1622 total events and latest imported event timestamps on 2026-04-16, confirming the visible cutoff is not a live detector.
- Production realtime inspection still requires a production/staging DB or API connection.

## Follow-Up Items

- Confirm whether the current environment points to production, staging, or a local snapshot.
- Choose two production creators for semantic correctness review.
- Run owner-scoped dry-runs, then promote a small write-mode batch after review.
- Add a scheduler/worker after manual batch behavior is stable.
