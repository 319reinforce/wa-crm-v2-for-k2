---
title: Legacy Cleanup Memory
date: 2026-04-16
project: wa-crm-v2
type: status
source_path: docs/CLEANUP_HISTORY_20260416.md
status: historical
tags:
  - wa-crm-v2
  - cleanup
  - historical
---

# Legacy Cleanup Memory

## Summary

The 2026-04-16 cleanup removed historical JSON exports, SQLite artifacts, legacy migration entrypoints, and obsolete dependencies after the MySQL runtime became the active path.

## Key Decisions

- `crm.db`, SQLite WAL files, and `data/*.json` were removed from the active workspace.
- `better-sqlite3` and `deasync` were removed.
- Legacy cleanup records remain historical context and are not current operating instructions.
- Cleanup memory is now tracked through the Obsidian standard.

## Source

- `docs/CLEANUP_HISTORY_20260416.md`
- `docs/LEGACY_CLEANUP_LOG.md`

## Verification

- Historical document records `npm run build` and `npm run test:unit` passing at cleanup time.

## Follow-Ups

- Keep onboarding docs aligned with the MySQL runtime and avoid reintroducing JSON or SQLite paths.
