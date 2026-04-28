---
title: Baileys Message Sync And Repair Handoff
date: 2026-04-28
project: wa-crm-v2
type: handoff
source_path: docs/BAILEYS_MESSAGE_SYNC_REPAIR_HANDOFF_20260428.md
status: active
tags:
  - wa-crm-v2
  - whatsapp
  - baileys
  - message-sync
  - repair
---

# Baileys Message Sync And Repair Handoff

## Summary

PR `#92` moved the message sync repair path toward Baileys-only operation. Baileys sessions no longer rely on hidden WWeb/Chrome polling as a repair fallback. Creators without a Baileys-keyed anchor are now visible in readiness/backfill reports, and LID to phone-number mappings are persisted across restarts.

## Key Decisions

- Baileys mode uses Baileys events, `messaging-history.set`, ring buffer checks, and `fetchMessageHistory` only when a valid Baileys anchor exists.
- A valid anchor is a `wa_messages` row with `proto_driver = 'baileys'` and a non-empty `wa_message_id`.
- No-anchor roster creators are reported instead of silently skipped.
- `wa_lid_mappings` persists learned `@lid` to phone-number JID mappings per session/operator.
- The message repair path can consume Baileys audit output, with `audit_source` metadata exposing buffer/history details.

## Operational Facts

- Backfill/report interval is controlled by `WA_BAILEYS_BACKFILL_INTERVAL_MS`; default is `10` minutes and `0` disables it.
- Reports are written to `data/runtime-state/wa-backfill-reports/<WA_SESSION_ID>-latest.json` unless `WA_BAILEYS_BACKFILL_REPORT_DIR` overrides the directory.
- Readiness CLI: `node scripts/report-baileys-backfill-readiness.cjs --owner=<operator> --limit=50`.
- Audit history wait knobs: `WA_BAILEYS_AUDIT_HISTORY_WAIT_MS` and `WA_BAILEYS_AUDIT_HISTORY_IDLE_MS`.

## Verification Retained

- `node --check` on touched runtime and script files.
- `npm run test:unit`.
- `npm run build`.
- `git diff --check`.
- Yiyun readiness report showed `42` primary roster creators and `0` Baileys anchors immediately after switch, matching the observed stale-history behavior.

## Source

- `docs/BAILEYS_MESSAGE_SYNC_REPAIR_HANDOFF_20260428.md`
- `docs/BAILEYS_ROLLOUT.md`
- `docs/WA_SESSIONS_DESIGN.md`

## Follow-Ups

- After each owner switches to Baileys, run the readiness CLI and inspect the runtime report.
- For no-anchor creators, create a Baileys-keyed message through live send/receive before expecting deep history fetch repair.
- Continue removing WWeb compatibility only after live Baileys account readiness is verified.
