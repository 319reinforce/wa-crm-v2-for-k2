---
title: Event Decision Table Current
date: 2026-04-27
project: wa-crm-v2
type: design
source_path: docs/EVENT_DECISION_TABLE.md
status: active
tags:
  - wa-crm-v2
  - events
  - lifecycle
---

# Event Decision Table Current

## Summary

`docs/EVENT_DECISION_TABLE.md` is the compact reference for event detection decisions. It should be read with the event/lifecycle PRD and backfill handoff.

## Current Rules

- Event decisions require explicit message evidence.
- Without clear evidence, the verdict should be `uncertain`.
- Evidence should prefer `message_id`, then `message_hash`, then timestamp.
- The event/lifecycle fact model replaces legacy `joinbrands_link.ev_*` as the forward state model.

## Related Sources

- `docs/EVENT_LIFECYCLE_DATA_PRD_20260425.md`
- `docs/EVENT_LIFECYCLE_BACKFILL_HANDOFF_20260425.md`
- `docs/ACTIVE_EVENT_DETECTION_HANDOFF_20260426.md`

## Follow-Ups

- Keep the table small and decision-oriented.
- Move large generated evidence into ignored reports or compact Obsidian summaries.
