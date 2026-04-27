# WA CRM v2 Documentation Index

Date: 2026-04-27
Status: Active

This is the compact entry point for current project documentation. It intentionally avoids listing every historical handoff or generated report. Use Obsidian and `docs/archive/` for history.

## Start Here

Read in this order:

1. `AGENTS.md` - agent entry guide and working rules.
2. `BOT_INTEGRATION.md` - API and integration quick reference.
3. `SFT_PROJECT.md` - SFT, Experience Router, profile memory, and generation tracking deep reference.
4. `docs/CORE_MODULES_OVERVIEW.md` - current module map.
5. `docs/DATABASE_SCHEMA_OPTIMIZATION_PLAN_20260427.md` - schema ownership, compatibility cleanup, and migration order.
6. `docs/OBSIDIAN_MEMORY_STANDARD.md` - Obsidian memory and sync standard.
7. `docs/DOCUMENT_RETENTION_AUDIT_20260427.md` - documentation retention and pre-2026-04-20 cleanup record.
8. `docs/RUNTIME_ARTIFACT_CLEANUP_PLAN_20260427.md` - reports, runtime artifacts, and external vendor boundary.

## Current Product And Runtime Docs

| Document | Purpose |
| --- | --- |
| `docs/CORE_MODULES_OVERVIEW.md` | Current module ownership and code boundaries. |
| `docs/AI_REPLY_GENERATION_SYSTEM.md` | AI reply generation architecture. |
| `docs/SFT_RLHF_PIPELINE.md` | SFT/RLHF collection, export, and rollout flow. |
| `docs/RLHF_ONBOARDING.md` | RLHF operator workflow. |
| `docs/WA_SESSIONS_DESIGN.md` | WA multi-session design and IPC/volume planning. |
| `docs/BAILEYS_ROLLOUT.md` | Baileys driver rollout and risk notes. |
| `docs/SSE_HARDENING.md` | SSE transport hardening. |

## Current Event And Lifecycle Docs

| Document | Purpose |
| --- | --- |
| `docs/EVENT_LIFECYCLE_DATA_PRD_20260425.md` | Current event/lifecycle data-model PRD. |
| `docs/EVENT_LIFECYCLE_BACKFILL_HANDOFF_20260425.md` | Latest event/lifecycle backfill and review UI progress. |
| `docs/ACTIVE_EVENT_DETECTION_HANDOFF_20260426.md` | Active event-detection queue, message-supplement integration, dry-run/write rollout, and local audit handoff. |
| `docs/EVENT_DECISION_TABLE.md` | Small event decision reference table. |

## Current Frontend And Operations Docs

| Document | Purpose |
| --- | --- |
| `docs/CREATOR_IMPORT_WELCOME_HANDOFF_20260426.md` | Batch creator import, dynamic owners, owner welcome template pool, and standard welcome-message publish handoff. |
## Current RAG And Knowledge Source Docs

| Document | Purpose |
| --- | --- |
| `docs/rag/KNOWLEDGE_SOURCE_STANDARD.md` | Knowledge source authoring and sync standard. |
| `docs/rag/OPENAI_RAG_RUNBOOK.md` | OpenAI hosted RAG runbook. |
| `docs/rag/LOCAL_RULE_RETRIEVAL_DESIGN_20260420.md` | Deterministic local rule retrieval design. |
| `docs/rag/LOCAL_RULE_IMPLEMENTATION_20260420.md` | Local rule retrieval implementation notes. |
| `docs/rag/APRIL_DOC_CONFIG_MAPPING_20260420.md` | April SOP/config mapping. |
| `docs/rag/knowledge-manifest.json` | Active knowledge-source manifest. |

## Cleanup, Archive, And Memory

| Document | Purpose |
| --- | --- |
| `docs/archive/PRE_20260420_DOCS_ARCHIVE.md` | Consolidated pre-2026-04-20 review/security/runtime archive; not a current defect list. |
| `docs/archive/reports/REPORTS_INDEX_20260427.md` | Current tracked report inventory, sensitive-data classification, and cleanup conditions. |
| `docs/DOCUMENT_RETENTION_AUDIT_20260427.md` | Documentation retention decision log and cleanup verification. |
| `docs/RUNTIME_ARTIFACT_CLEANUP_PLAN_20260427.md` | Runtime artifact, report, and external vendor cleanup baseline. |
| `docs/RECENT_BRANCH_DOC_MAPPING_20260427.md` | Recent Gitea branch, PR, archive tag, and handoff/Obsidian mapping. |
| `docs/obsidian/index.md` | Obsidian memory note index. |

## Deleted Historical Handoffs

Old handoffs that were more than half stale against current branch direction were removed from `docs/archive/handoffs/`. Their useful decisions are preserved in Obsidian notes and current branch mapping docs.

## Runtime Artifact Boundary

- `LightRAG` was removed from source control and ignored. WA CRM v2 will not adopt that solution path.
- `docs/exports/` historical lifecycle exports were removed because they predated the current lifecycle model and contained raw phone values.
- `docs/wa/*state.json` runtime state was removed from docs; mutable state belongs under ignored `data/runtime-state/`.
- Generated reports, backups, local media data, and build assets are governed by `docs/RUNTIME_ARTIFACT_CLEANUP_PLAN_20260427.md`.

## Obsidian Sync

- Status: synced
- Note: `docs/obsidian/notes/2026-04-25-docs-index-and-core-modules.md`
- Index: `docs/obsidian/index.md`
