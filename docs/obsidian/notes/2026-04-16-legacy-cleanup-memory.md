---
title: Legacy Cleanup Memory
date: 2026-04-16
project: wa-crm-v2
type: status
source_path: docs/archive/PRE_20260420_DOCS_ARCHIVE.md
status: historical
tags:
  - wa-crm-v2
  - cleanup
  - historical
---

# Legacy Cleanup Memory

## Summary

The 2026-04-16 cleanup removed historical JSON exports, SQLite artifacts, legacy migration entrypoints, and obsolete dependencies after the MySQL runtime became the active path. The original cleanup docs were consolidated into the pre-2026-04-20 archive on 2026-04-27.

## Key Decisions

- `crm.db`, SQLite WAL files, and `data/*.json` were removed from the active workspace.
- `better-sqlite3` and `deasync` were removed.
- Legacy cleanup records remain historical context in `docs/archive/PRE_20260420_DOCS_ARCHIVE.md` and are not current operating instructions.
- Cleanup memory is now tracked through the Obsidian standard.

## Source

- `docs/archive/PRE_20260420_DOCS_ARCHIVE.md`

## Verification

- Consolidated archive records the original cleanup verification at a summary level.

## Follow-Ups

- Keep onboarding docs aligned with the MySQL runtime and avoid reintroducing JSON or SQLite paths.
