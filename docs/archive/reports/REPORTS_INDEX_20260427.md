# Reports Archive Index

Date: 2026-04-27
Status: Active report inventory

This index tracks generated reports and records which report/export artifacts were removed. Reports are evidence, not active requirements. Active implementation guidance should live in PRDs, runbooks, handoffs, or Obsidian notes.

## Current Tracked Reports

None. Generated report JSON is no longer tracked after the 2026-04-27 deep cleanup. Keep summaries in owning handoffs or Obsidian, and regenerate raw evidence locally when needed.

## Removed Report Artifacts

| Removed artifact | Purpose | Referenced by | Why removed | Sensitive data |
| --- | --- | --- | --- | --- |
| `reports/dirty-data-cleanup-20260416.sql` | Historical dirty-data cleanup checklist SQL. | No active source should execute it directly. | Superseded by `docs/archive/PRE_20260420_DOCS_ARCHIVE.md` and `docs/DATABASE_SCHEMA_OPTIMIZATION_PLAN_20260427.md`. | Medium: schema/table repair logic touches identifiers; direct execution risk. |
| `docs/exports/lifecycle-wa-mainline-2026-04-14.csv` | Historical lifecycle export. | No active source should depend on it. | Pre-current lifecycle model and contains raw phone values. | High: raw phone values and creator names. |
| `docs/exports/lifecycle-referral-overlay-2026-04-14.csv` | Historical referral overlay export. | No active source should depend on it. | Pre-current lifecycle model and contains raw phone values. | High: raw phone values and creator names. |
| `docs/exports/lifecycle-wa-audit-2026-04-14.md` | Historical lifecycle audit summary. | No active source should depend on it. | Superseded by lifecycle PRD/backfill docs and Obsidian notes. | Medium: creator names and lifecycle status. |
| `reports/active-event-detection-1072-keyword-20260426.json` | Active-event dry-run evidence. | Summary retained in `docs/ACTIVE_EVENT_DETECTION_HANDOFF_20260426.md`. | Removed after summary was retained. | Low: creator id/name and aggregate counts. |
| `reports/active-event-detection-1087-keyword-20260426.json` | Active-event dry-run evidence. | Summary retained in `docs/ACTIVE_EVENT_DETECTION_HANDOFF_20260426.md`. | Removed after summary was retained. | Low: creator id/name and aggregate counts. |
| `reports/event-lifecycle-top-creators-20260425-local.json` | Lifecycle backfill local-keyword comparison evidence. | Summary retained in `docs/EVENT_LIFECYCLE_BACKFILL_HANDOFF_20260425.md`. | Removed after summary was retained. | Medium: creator ids/names and message-id samples. |
| `reports/event-lifecycle-top-creators-20260425-minimax.json` | Lifecycle backfill LLM comparison evidence. | Summary retained in `docs/EVENT_LIFECYCLE_BACKFILL_HANDOFF_20260425.md`. | Removed after summary was retained. | Medium: creator ids/names and message-id samples. |
| `reports/tier2-compat-event-audit-20260425.json` | Compatibility audit for tier-2 event evidence quality. | Summary retained in `docs/EVENT_LIFECYCLE_BACKFILL_HANDOFF_20260425.md`. | Removed after summary was retained. | Medium: aggregate event evidence plus reason strings. |

## Policy

- New generated reports should default to ignored output directories.
- If a report must be committed, it needs an owner doc, a cleanup condition, and a date in the filename.
- Reports must not contain raw `wa_phone`, secrets, full message content, or operational tokens.
- Historical exports containing raw phone values should be summarized into Obsidian/archive notes, then removed from source control.

## Obsidian Sync

- Status: synced
- Note: `docs/obsidian/notes/2026-04-27-runtime-artifact-cleanup-plan.md`
- Index: `docs/obsidian/index.md`
