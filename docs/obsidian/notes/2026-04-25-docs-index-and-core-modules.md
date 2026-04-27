---
title: Docs Index And Core Modules
date: 2026-04-25
project: wa-crm-v2
type: standard
source_path: docs/DOCS_INDEX.md
status: active
tags:
  - wa-crm-v2
  - docs
  - modules
---

# Docs Index And Core Modules

## Summary

The documentation set now has a top-level index and a module overview for the main WA CRM v2 areas: runtime/API, creator data, WA sessions, AI reply generation, SFT, profile memory, event lifecycle, RAG/policy, and frontend operations UI.

## Key Decisions

- `docs/DOCS_INDEX.md` is the navigation entry for project docs.
- `docs/CORE_MODULES_OVERVIEW.md` is the current map of the most important modules.
- `docs/DATABASE_SCHEMA_OPTIMIZATION_PLAN_20260427.md` is the active database schema cleanup and ownership plan.
- `docs/DOCUMENT_RETENTION_AUDIT_20260427.md` is the active documentation cleanup record.
- `docs/archive/PRE_20260420_DOCS_ARCHIVE.md` holds the consolidated pre-2026-04-20 review/security/runtime/event history.
- Latest event/lifecycle progress is linked through `docs/EVENT_LIFECYCLE_BACKFILL_HANDOFF_20260425.md`.
- Creator bulk import, owner welcome template pool, and standard welcome-message publish progress is linked through `docs/CREATOR_IMPORT_WELCOME_HANDOFF_20260426.md`.
- Older review and cleanup docs were removed from active navigation after consolidation; use the archive only for historical rationale.

## Source

- `docs/DOCS_INDEX.md`
- `docs/CORE_MODULES_OVERVIEW.md`

## Verification

- Documentation index and module overview include Obsidian sync blocks.

## Follow-Ups

- Keep future active docs pointed at `docs/DOCS_INDEX.md`, current dated handoffs, or Obsidian notes rather than deleted legacy files.
