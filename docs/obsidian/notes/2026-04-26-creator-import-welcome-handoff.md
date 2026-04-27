---
title: Creator Import Welcome Handoff
date: 2026-04-26
project: wa-crm-v2
type: handoff
source_path: docs/CREATOR_IMPORT_WELCOME_HANDOFF_20260426.md
status: active
tags:
  - wa-crm-v2
  - memory
  - creator-import
  - whatsapp
---

# Creator Import Welcome Handoff

## Summary

WA CRM v2 now has a baseline for batch creator import with optional owner-bound standard welcome-message publishing. The flow creates/reuses CRM creators, binds them to an owner/session roster, snapshots the selected welcome copy, and persists sent welcome messages into CRM history.

## Key Decisions

- Owner selection is now runtime-driven from `users.operator_name`, `creators.wa_owner`, and `wa_sessions.owner`.
- Local static owner roster is no longer injected as frontend default options.
- Owner welcome copy now lives in `operator_outreach_templates`, with the initial supported key `welcome`.
- The bulk import modal can load the owner template pool, apply a template, and save the current welcome copy back into the selected template.
- Welcome send is controlled by an explicit frontend switch. When the switch is off, the batch should only import/reuse creators and bind owner roster rows, which is the intended path for historical creators that already received a manual welcome.
- Batch-level welcome text is snapshotted per import, so later template edits do not change existing batches.
- Native WhatsApp contact add/remark update is explicitly out of scope and should not be pursued inside this handoff. The current target is only CRM import plus standard welcome-message publishing.

## Source

- Source document: `docs/CREATOR_IMPORT_WELCOME_HANDOFF_20260426.md`
- Main code paths:
  - `server/services/creatorImportBatchService.js`
  - `server/routes/creatorImportBatches.js`
  - `src/App.jsx`
  - `schema.sql`

## Verification

- Verified with `node --check server/services/creatorImportBatchService.js`, `node --check server/routes/creatorImportBatches.js`, `node --check server/routes/operatorRoster.js`, and `npm test`.
- `npm test` includes the smoke build and unit tests. WA send smoke was not run because the project keeps it gated behind `SMOKE_INCLUDE_WA_SEND=1`.
- Runtime rollout should start with a Jiawei 20-row test batch after confirming the Jiawei WA session is ready.

## Follow-Ups

- Add batch status UI and retry controls.
- Add durable resume for queued/running batches after restart.
- Add a richer template management screen if more template keys are needed.
