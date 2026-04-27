# Reports Archive Index

Date: 2026-04-27
Status: Active report inventory

This index tracks generated reports that still exist in source control and records which pre-2026-04-20 report/export artifacts were removed. Reports are evidence, not active requirements. Active implementation guidance should live in PRDs, runbooks, handoffs, or Obsidian notes.

## Current Tracked Reports

| Report | Purpose | Referenced by | Can delete? | Sensitive data |
| --- | --- | --- | --- | --- |
| `reports/active-event-detection-1072-keyword-20260426.json` | Dry-run evidence for active event detection on one creator. | `docs/ACTIVE_EVENT_DETECTION_HANDOFF_20260426.md` | Later, after active-event rollout records final verification. | Low: creator id/name and aggregate counts; no raw phone or message text found. |
| `reports/active-event-detection-1087-keyword-20260426.json` | Dry-run evidence for active event detection on one creator. | `docs/ACTIVE_EVENT_DETECTION_HANDOFF_20260426.md` | Later, after active-event rollout records final verification. | Low: creator id/name and aggregate counts; no raw phone or message text found. |
| `reports/event-lifecycle-top-creators-20260425-local.json` | Lifecycle backfill local-keyword comparison evidence. | `docs/EVENT_LIFECYCLE_BACKFILL_HANDOFF_20260425.md` | Later, after lifecycle backfill summary is folded into current event docs. | Medium: creator ids/names and message-id samples; no raw phone or full message text found. |
| `reports/event-lifecycle-top-creators-20260425-minimax.json` | Lifecycle backfill LLM comparison evidence. | `docs/EVENT_LIFECYCLE_BACKFILL_HANDOFF_20260425.md` | Later, after LLM comparison evidence is no longer needed. | Medium: creator ids/names and message-id samples; no raw phone or full message text found. |
| `reports/tier2-compat-event-audit-20260425.json` | Compatibility audit for tier-2 event evidence quality. | `docs/EVENT_LIFECYCLE_BACKFILL_HANDOFF_20260425.md` | Later, after schema/event compatibility cleanup supersedes it. | Medium: aggregate event evidence plus reason strings; no raw phone found. |

## Removed Pre-2026-04-20 Artifacts

| Removed artifact | Purpose | Referenced by | Why removed | Sensitive data |
| --- | --- | --- | --- | --- |
| `reports/dirty-data-cleanup-20260416.sql` | Historical dirty-data cleanup checklist SQL. | No active source should execute it directly. | Superseded by `docs/archive/PRE_20260420_DOCS_ARCHIVE.md` and `docs/DATABASE_SCHEMA_OPTIMIZATION_PLAN_20260427.md`. | Medium: schema/table repair logic touches identifiers; direct execution risk. |
| `docs/exports/lifecycle-wa-mainline-2026-04-14.csv` | Historical lifecycle export. | No active source should depend on it. | Pre-current lifecycle model and contains raw phone values. | High: raw phone values and creator names. |
| `docs/exports/lifecycle-referral-overlay-2026-04-14.csv` | Historical referral overlay export. | No active source should depend on it. | Pre-current lifecycle model and contains raw phone values. | High: raw phone values and creator names. |
| `docs/exports/lifecycle-wa-audit-2026-04-14.md` | Historical lifecycle audit summary. | No active source should depend on it. | Superseded by lifecycle PRD/backfill docs and Obsidian notes. | Medium: creator names and lifecycle status. |

## Policy

- New generated reports should default to ignored output directories.
- If a report must be committed, it needs an owner doc, a cleanup condition, and a date in the filename.
- Reports must not contain raw `wa_phone`, secrets, full message content, or operational tokens.
- Historical exports containing raw phone values should be summarized into Obsidian/archive notes, then removed from source control.

## Obsidian Sync

- Status: synced
- Note: `docs/obsidian/notes/2026-04-27-runtime-artifact-cleanup-plan.md`
- Index: `docs/obsidian/index.md`
