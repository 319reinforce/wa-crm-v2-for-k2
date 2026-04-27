---
title: Agent Current State And Doc Coverage
date: 2026-04-27
project: wa-crm-v2
type: status
source_path: docs/DOCS_INDEX.md
status: active
tags:
  - wa-crm-v2
  - agent-onboarding
  - docs
  - cleanup
---

# Agent Current State And Doc Coverage

## Summary

This is the current onboarding snapshot after the deep documentation cleanup. New agents should treat `AGENTS.md`, `docs/DOCS_INDEX.md`, `docs/CORE_MODULES_OVERVIEW.md`, and this note as the active navigation layer. Obsidian is the retained memory layer; deleted historical docs should not be restored.

## Current Product Direction

- Runtime database: MySQL and `schema.sql`; never restore SQLite or `crm.db`.
- WhatsApp runtime direction: Baileys. WWeb/Chrome/Puppeteer is legacy fallback only.
- AI reply path: current code plus `docs/AI_REPLY_GENERATION_SYSTEM.md`.
- Profile/memory direction: per-user Markdown profile memory / skill memory, not heavier RAG.
- RAG status: legacy manifest/sources remain only because current local-rule code still reads them.
- Documentation memory: Obsidian only.

## Active Document Coverage

| Source | Status | Obsidian coverage |
| --- | --- | --- |
| `AGENTS.md` | active entry | `2026-04-25-agent-onboarding-and-bot-integration.md`, this note |
| `BOT_INTEGRATION.md` | active API quick reference | `2026-04-25-agent-onboarding-and-bot-integration.md` |
| `DEPLOY.md` | active Baileys-oriented deploy guide | `2026-04-27-sse-and-deployment-current.md`, `2026-04-27-baileys-session-direction.md` |
| `docs/DOCS_INDEX.md` | active docs index | `2026-04-25-docs-index-and-core-modules.md`, this note |
| `docs/CORE_MODULES_OVERVIEW.md` | active module map | `2026-04-25-docs-index-and-core-modules.md`, this note |
| `docs/AI_REPLY_GENERATION_SYSTEM.md` | active AI reply reference | `2026-04-27-ai-reply-generation-current.md` |
| `docs/WA_SESSIONS_DESIGN.md` | active Baileys direction | `2026-04-27-baileys-session-direction.md` |
| `docs/BAILEYS_ROLLOUT.md` | active Baileys runbook | `2026-04-27-baileys-session-direction.md` |
| `docs/SSE_HARDENING.md` | active transport runbook | `2026-04-27-sse-and-deployment-current.md` |
| `docs/DATABASE_SCHEMA_OPTIMIZATION_PLAN_20260427.md` | active schema plan | `2026-04-27-database-schema-optimization-plan.md` |
| `docs/EVENT_LIFECYCLE_DATA_PRD_20260425.md` | active event PRD | `2026-04-25-event-lifecycle-data-model.md` |
| `docs/EVENT_LIFECYCLE_BACKFILL_HANDOFF_20260425.md` | active event handoff | `2026-04-25-event-lifecycle-backfill-handoff.md` |
| `docs/ACTIVE_EVENT_DETECTION_HANDOFF_20260426.md` | active detector handoff | `2026-04-26-active-event-detection-handoff.md` |
| `docs/EVENT_DECISION_TABLE.md` | active small decision table | `2026-04-27-event-decision-table-current.md` |
| `docs/CREATOR_IMPORT_WELCOME_HANDOFF_20260426.md` | active import/template handoff | `2026-04-26-creator-import-welcome-handoff.md`, `2026-04-26-template-custom-topic-handoff.md` |
| `docs/OBSIDIAN_MEMORY_STANDARD.md` | active memory standard | `2026-04-25-obsidian-memory-standard.md` |
| `docs/RUNTIME_ARTIFACT_CLEANUP_PLAN_20260427.md` | active artifact boundary | `2026-04-27-runtime-artifact-cleanup-plan.md` |
| `docs/DOCUMENT_RETENTION_AUDIT_20260427.md` | active cleanup record | `2026-04-27-document-retention-audit.md` |
| `docs/RECENT_BRANCH_DOC_MAPPING_20260427.md` | active branch/doc map | `2026-04-27-recent-branch-doc-mapping.md` |
| `docs/archive/PRE_20260420_DOCS_ARCHIVE.md` | historical archive | `2026-04-27-pre-20260420-docs-archive.md` |
| `docs/archive/reports/REPORTS_INDEX_20260427.md` | historical report inventory | `2026-04-27-runtime-artifact-cleanup-plan.md` |
| `docs/rag/knowledge-manifest.json` and `docs/rag/sources/` | transitional runtime inputs | `2026-04-27-rag-knowledge-source-docs.md`, `2026-04-27-profile-skill-memory-direction.md` |

The remaining `docs/rag/sources/*.md` files intentionally do not carry per-file Obsidian sync blocks because they are still parsed as knowledge-source content. Their migration status is represented by `2026-04-27-rag-knowledge-source-docs.md`.

## Legacy State

- Removed: `.claude/`, `CLAUDE.md`, old SFT/RLHF docs, old reports, old RAG runbooks/design docs, WWeb-heavy session/deploy docs.
- Retained in Obsidian: historical decisions, cleanup reasons, and branch mapping.
- Do not use deleted files as implementation instructions.

## Agent Handoff Rules

- Start from active docs, then Obsidian notes.
- If a source document and an Obsidian note disagree, prefer the newer date; if dates match, prefer the source doc for implementation detail and the note for decisions/status.
- Do not add generated reports or runtime state under `docs/`.
- Do not add new RAG docs unless the direction changes away from profile/skill memory.
