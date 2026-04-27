---
title: Agent Onboarding And Bot Integration
date: 2026-04-25
project: wa-crm-v2
type: standard
source_path: AGENTS.md
status: active
tags:
  - wa-crm-v2
  - onboarding
  - agents
---

# Agent Onboarding And Bot Integration

## Summary

Agent onboarding now points new agents to the documentation index, core module overview, current progress handoffs, and Obsidian memory standard after the project entry docs. Bot integration docs now describe JSON raw data and SQLite as historical migration context, not current runtime inputs.

## Key Decisions

- Read order includes `docs/OBSIDIAN_MEMORY_STANDARD.md`.
- Read order includes `docs/DOCS_INDEX.md` and `docs/CORE_MODULES_OVERVIEW.md` so agents can quickly find the module they need to work on.
- Latest event/lifecycle progress is anchored at `docs/EVENT_LIFECYCLE_BACKFILL_HANDOFF_20260425.md`.
- Event onboarding now points to current lifecycle/data-model docs and active event detection handoff instead of the legacy event requirements archive.
- Documentation cleanup guidance now points to `docs/DOCUMENT_RETENTION_AUDIT_20260427.md`.
- Session closeout reports Obsidian sync status.
- `data/*.json` is historical migration context.
- `crm.db` / SQLite must not be restored.

## Source

- `AGENTS.md`
- `CLAUDE.md`
- `BOT_INTEGRATION.md`
- `docs/DOCS_INDEX.md`
- `docs/CORE_MODULES_OVERVIEW.md`

## Verification

- Grep confirms active sync rules now reference Obsidian.

## Follow-Ups

- Keep future agent rule updates synced into `docs/obsidian/index.md`.
