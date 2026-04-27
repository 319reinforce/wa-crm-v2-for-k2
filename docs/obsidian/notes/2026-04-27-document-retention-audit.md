---
title: Documentation Retention Audit
date: 2026-04-27
project: wa-crm-v2
type: cleanup
source_path: docs/DOCUMENT_RETENTION_AUDIT_20260427.md
status: active
tags:
  - wa-crm-v2
  - memory
  - docs
  - cleanup
---

# Documentation Retention Audit

## Summary

WA CRM v2 now has a documentation retention audit that separates active development docs from historical reports. Pre-2026-04-20 review/security/runtime/event docs were consolidated into one archive, then removed from the active documentation surface.

## Key Decisions

- `docs/DOCS_INDEX.md` and `docs/obsidian/index.md` remain the active navigation surface.
- Gitea `origin` is the remote of record for branch-related documentation.
- High-value runtime and RAG docs were summarized into Obsidian so later agents do not need to scan every dated handoff.
- Old event-system docs and duplicate security logs were consolidated into `docs/archive/PRE_20260420_DOCS_ARCHIVE.md`.
- `docs/.DS_Store` had no documentation value and was removed.
- Historical review docs should not be used as current bug lists unless they explicitly point to current implementation status.

## Cleanup Executed

Deleted or consolidated:

- `docs/.DS_Store`
- `docs/EVENT_SYSTEM.md`
- `docs/EVENT_SYSTEM_REQUIREMENTS.md`
- `docs/SECURITY_CHANGES_20260416.md`
- `docs/SECURITY_CHANGES_2026-04-16.md`
- root `SECURITY_FIX_REPORT.md`
- `docs/rag/SESSION_SUMMARY_20260420.md`
- `docs/PHASE_1A_HANDOFF.md`
- `docs/REPLY_GENERATION_REFACTOR_ISSUES_20260416.md`
- `docs/REPLY_GENERATION_REFACTOR_MEMORY_20260416.md`
- `docs/PROJECT_ANALYSIS.md`
- `docs/SECURITY_FIX_REPORT.md`
- `docs/SECURITY_FIX_PLAN.md`
- `docs/rag/RUNTIME_ALIGNMENT_20260416.md`
- `CODE_REVIEW.md`
- `docs/CODE_REVIEW_FINDINGS_20260416.md`
- `docs/REVIEW_FIX_REPORT_20260416.md`
- `docs/CLEANUP_HISTORY_20260416.md`
- `docs/LEGACY_CLEANUP_LOG.md`
- `docs/HISTORICAL_REPORTS_ARCHIVE.md`
- `reports/dirty-data-root-cause-20260416.md`

## Source

- Source audit: `docs/DOCUMENT_RETENTION_AUDIT_20260427.md`
- Consolidated archive: `docs/archive/PRE_20260420_DOCS_ARCHIVE.md`
- Related indexes:
  - `docs/DOCS_INDEX.md`
  - `docs/obsidian/index.md`
