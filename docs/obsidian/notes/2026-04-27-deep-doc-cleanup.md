---
title: Deep Doc Cleanup
date: 2026-04-27
project: wa-crm-v2
type: cleanup
source_path: docs/DOCUMENT_RETENTION_AUDIT_20260427.md
status: active
tags:
  - wa-crm-v2
  - cleanup
  - docs
  - claude
---

# Deep Doc Cleanup

## Summary

Claude-specific skills, agents, memory, and old plans were removed from source control because they conflicted with the current `AGENTS.md` + Obsidian workflow and still described SQLite/server.js-era operation. Stale project logs and old handoffs were also removed after their useful decisions were captured in current docs or Obsidian notes.

## Removed

- `.claude/` including Claude agents, skills, memory, rules, and plans.
- Root `CLAUDE.md`; `AGENTS.md` is the only active agent entry.
- `project_wa_crm_v2.md`, an old project changelog from the SQLite/server.js era.
- `docs/LIFECYCLE_REFACTOR_PRD.md`, superseded by the current event/lifecycle data PRD and schema optimization plan.
- `docs/WA_SESSIONS_DESIGN_REVIEW.md`, superseded by the current WA session design doc and runtime architecture notes.
- Old frontend role/layout/load notes whose durable decisions should now be read from code, current docs, or Obsidian.
- `docs/archive/handoffs/`, because the handoff value is now preserved in Obsidian and branch mapping notes.

## Current Guidance

- Use `AGENTS.md` for agent onboarding.
- Use `docs/DOCS_INDEX.md` for active docs.
- Use Obsidian notes for historical context.
- Do not reintroduce Claude-specific skills or `.claude/` project memory.
