# Reports Archive Index

Date: 2026-04-27
Status: Active report inventory

This index tracks generated reports that still exist in source control. Reports are evidence, not active requirements. Active implementation guidance should live in PRDs, runbooks, handoffs, or Obsidian notes.

## Keep While Referenced

| Report | Owner doc | Cleanup condition |
| --- | --- | --- |
| `reports/active-event-detection-1072-keyword-20260426.json` | `docs/ACTIVE_EVENT_DETECTION_HANDOFF_20260426.md` | Delete after active event detection rollout records final verification. |
| `reports/active-event-detection-1087-keyword-20260426.json` | `docs/ACTIVE_EVENT_DETECTION_HANDOFF_20260426.md` | Delete after active event detection rollout records final verification. |
| `reports/event-lifecycle-top-creators-20260425-local.json` | `docs/EVENT_LIFECYCLE_BACKFILL_HANDOFF_20260425.md` | Delete after lifecycle backfill summary is folded into current event docs. |
| `reports/event-lifecycle-top-creators-20260425-minimax.json` | `docs/EVENT_LIFECYCLE_BACKFILL_HANDOFF_20260425.md` | Delete after LLM comparison evidence is no longer needed. |
| `reports/tier2-compat-event-audit-20260425.json` | `docs/EVENT_LIFECYCLE_BACKFILL_HANDOFF_20260425.md` | Delete after schema/event compatibility cleanup supersedes it. |

## Archive Or Delete Candidate

| Report | Reason |
| --- | --- |
| `reports/dirty-data-cleanup-20260416.sql` | Historical cleanup SQL. Do not execute directly. Preserve only the conclusion in archive docs, then delete or move under a clearly non-executable archive path. |

## Policy

- New generated reports should default to ignored output directories.
- If a report must be committed, it needs an owner doc, a cleanup condition, and a date in the filename.
- Reports must not contain raw `wa_phone`, secrets, or full message content.

## Obsidian Sync

- Status: synced
- Note: `docs/obsidian/notes/2026-04-27-runtime-artifact-cleanup-plan.md`
- Index: `docs/obsidian/index.md`
