---
title: Document Sync Refresh
date: 2026-05-08
project: wa-crm-v2
type: status
source_path: docs/DOCS_INDEX.md
status: active
tags:
  - wa-crm-v2
  - docs
  - obsidian
  - cleanup
---

# Document Sync Refresh

## Summary

A full documentation sync pass was run on 2026-05-08 across active WA CRM v2 Markdown entry points, current handoffs, runbooks, PRDs, standards, and Obsidian notes.

## Key Decisions

- Treat `docs/obsidian/` as the canonical project memory vault, per `docs/OBSIDIAN_MEMORY_STANDARD.md`.
- Ignore vendored or transitional non-project documentation such as `LightRAG/` and RAG source files for per-document sync notes.
- Add the 2026-05-08 stash cleanup audit to the repo-local Obsidian vault, not only the external desktop mirror.
- Refresh `docs/DOCS_INDEX.md` and `docs/obsidian/index.md` to date 2026-05-08.
- Add `related` frontmatter to multi-source notes so `BOT_INTEGRATION.md`, `docs/BAILEYS_ROLLOUT.md`, `docs/CORE_MODULES_OVERVIEW.md`, `docs/SSE_HARDENING.md`, and `docs/archive/reports/REPORTS_INDEX_20260427.md` are represented without duplicating notes.

## Source

- `docs/DOCS_INDEX.md`
- `docs/OBSIDIAN_MEMORY_STANDARD.md`
- `docs/obsidian/index.md`

## Verification

- Scanned active repo docs for missing `Obsidian Sync` blocks.
- Checked source document sync blocks for missing note files.
- Checked Obsidian notes for missing source files.
- Ran `git stash list` after stash cleanup; it returned empty.

## Follow-Ups

- Keep future dated operational cleanups in repo-local `docs/obsidian/notes/` first; external Obsidian mirrors are secondary.
