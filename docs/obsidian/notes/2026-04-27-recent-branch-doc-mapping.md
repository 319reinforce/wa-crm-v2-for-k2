---
title: Recent Branch Doc Mapping
date: 2026-04-27
project: wa-crm-v2
type: handoff
source_path: docs/RECENT_BRANCH_DOC_MAPPING_20260427.md
status: active
tags:
  - wa-crm-v2
  - memory
  - git
  - handoff
---

# Recent Branch Doc Mapping

## Summary

WA CRM v2 now has a current branch-to-document mapping for recent Gitea work. The source document records merged PRs, removed local branches, the preserved `codex/mysqloptimize` branch, and the archive tag that replaced `codex/local-archive-20260420`.

## Key Decisions

- Gitea `origin` is the remote of record for branch and merge status.
- `main` is synced to `origin/main` at `76f59a3`.
- `codex/mysqloptimize` is intentionally preserved and should not be touched without explicit user approval.
- `codex/local-archive-20260420` was converted into `archive/local-archive-20260420`; use selective cherry-pick only if reopening the AI Providers / LLM config work.
- PR `#77` maps to creator import/contact management and template media handoffs.
- PR `#76` maps to active event detection handoff.
- PR `#74` maps to event lifecycle backfill and docs/core module index work.

## Source

- Source document: `docs/RECENT_BRANCH_DOC_MAPPING_20260427.md`
- Index updates:
  - `docs/DOCS_INDEX.md`
  - `docs/obsidian/index.md`

## Verification

- Local branch cleanup had already left only `main` and `codex/mysqloptimize`.
- Archive tag `archive/local-archive-20260420` exists locally and on Gitea.
