# WA CRM v2 Documentation Index

Date: 2026-04-27
Status: Active

This is the compact entry point for current project documentation. It intentionally avoids listing every historical handoff or generated report. Use Obsidian and `docs/archive/` for history.

## Start Here

Read in this order:

1. `AGENTS.md` - agent entry guide and working rules.
2. `BOT_INTEGRATION.md` - API and integration quick reference.
3. `docs/obsidian/notes/2026-04-27-agent-current-state-and-doc-coverage.md` - latest agent-facing state, active-doc coverage, and legacy boundary.
4. `docs/CORE_MODULES_OVERVIEW.md` - current module map.
5. `docs/AI_REPLY_GENERATION_SYSTEM.md` - current reply generation, Experience Router, and SFT capture entry points.
6. `docs/DATABASE_SCHEMA_OPTIMIZATION_PLAN_20260427.md` - schema ownership, compatibility cleanup, and migration order.
7. `docs/DATABASE_STRUCTURE_FUTURE_OPTIMIZATION_HANDOFF_20260427.md` - future database optimization roadmap after startup migration rollout.
8. `docs/MYSQL_OPTIMIZE_PHASE2_HANDOFF_20260427.md` - latest managed migration, creator_id backfill, lifecycle edit migration, and retention policy handoff.
9. `docs/MYSQL_OPTIMIZE_PROD_ROLLOUT_HANDOFF_20260427.md` - production rollout confirmation for startup rebuild and explicit DB migrations.
10. `docs/OBSIDIAN_MEMORY_STANDARD.md` - Obsidian memory and sync standard.
11. `docs/DOCUMENT_RETENTION_AUDIT_20260427.md` - documentation retention and pre-2026-04-20 cleanup record.
12. `docs/RUNTIME_ARTIFACT_CLEANUP_PLAN_20260427.md` - reports, runtime artifacts, and external vendor boundary.

## Current Product And Runtime Docs

| Document | Purpose |
| --- | --- |
| `docs/CORE_MODULES_OVERVIEW.md` | Current module ownership and code boundaries. |
| `docs/DATABASE_SCHEMA_OPTIMIZATION_PLAN_20260427.md` | Database schema ownership, compatibility cleanup, and staged optimization plan. |
| `docs/DATABASE_STRUCTURE_FUTURE_OPTIMIZATION_HANDOFF_20260427.md` | Future database optimization roadmap: deprecated reads, work-state split, retention/archive, and drop/archive gates. |
| `docs/MYSQL_OPTIMIZE_HANDOFF_20260427.md` | MySQL optimize implementation report, verification notes, and future development plan. |
| `docs/MYSQL_OPTIMIZE_PHASE2_HANDOFF_20260427.md` | Phase 2 managed migrations, runtime DDL cleanup, CreatorDetail event-first migration, creator_id backfill, and retention policy. |
| `docs/MYSQL_OPTIMIZE_PROD_ROLLOUT_HANDOFF_20260427.md` | Production rollout confirmation: startup derived-data rebuild behavior, explicit migration requirement, and Chinese handoff summary. |
| `docs/AI_REPLY_GENERATION_SYSTEM.md` | AI reply generation architecture, topic detection, provider routing, and generation tracking. |
| `docs/WA_SESSIONS_DESIGN.md` | WA multi-session design and IPC/volume planning. |
| `docs/BAILEYS_ROLLOUT.md` | Baileys driver rollout and risk notes. |
| `docs/SSE_HARDENING.md` | SSE transport hardening. |
| `DEPLOY.md` | Baileys-oriented deployment baseline. |

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
## Transitional Knowledge Sources

| Document | Purpose |
| --- | --- |
| `docs/rag/knowledge-manifest.json` | Legacy manifest still read by current local-rule code. Not the future architecture. |
| `docs/rag/sources/` | Legacy SOP/policy source files retained until profile/skill memory replaces this path. |
| `docs/obsidian/notes/2026-04-27-profile-skill-memory-direction.md` | Future direction: per-user Markdown profile memory instead of heavy RAG. |

## Cleanup, Archive, And Memory

| Document | Purpose |
| --- | --- |
| `docs/archive/PRE_20260420_DOCS_ARCHIVE.md` | Consolidated pre-2026-04-20 review/security/runtime archive; not a current defect list. |
| `docs/archive/reports/REPORTS_INDEX_20260427.md` | Current tracked report inventory, sensitive-data classification, and cleanup conditions. |
| `docs/DOCUMENT_RETENTION_AUDIT_20260427.md` | Documentation retention decision log and cleanup verification. |
| `docs/RUNTIME_ARTIFACT_CLEANUP_PLAN_20260427.md` | Runtime artifact, report, and external vendor cleanup baseline. |
| `docs/RECENT_BRANCH_DOC_MAPPING_20260427.md` | Recent Gitea branch, PR, archive tag, and handoff/Obsidian mapping. |
| `docs/obsidian/index.md` | Obsidian memory note index. |
| `docs/obsidian/notes/2026-04-27-agent-current-state-and-doc-coverage.md` | Latest agent-facing coverage matrix. |

## Deleted Historical Handoffs

Old handoffs that were more than half stale against current branch direction were removed from `docs/archive/handoffs/`. Their useful decisions are preserved in Obsidian notes and current branch mapping docs.

## Deleted Historical SFT Docs

The old root `SFT_PROJECT.md`, `docs/SFT_RLHF_PIPELINE.md`, and `docs/RLHF_ONBOARDING.md` were removed because they mixed current concepts with obsolete `server.js`, SQLite-era, and early RLHF rollout instructions. Use current code, `docs/AI_REPLY_GENERATION_SYSTEM.md`, and the Obsidian SFT baseline note for retained context.

## Runtime Artifact Boundary

- `LightRAG` was removed from source control and ignored. WA CRM v2 will not adopt that solution path.
- `docs/exports/` historical lifecycle exports were removed because they predated the current lifecycle model and contained raw phone values.
- `docs/wa/*state.json` runtime state was removed from docs; mutable state belongs under ignored `data/runtime-state/`.
- Generated reports, backups, local media data, and build assets are governed by `docs/RUNTIME_ARTIFACT_CLEANUP_PLAN_20260427.md`.

## Obsidian Sync

- Status: synced
- Note: `docs/obsidian/notes/2026-04-25-docs-index-and-core-modules.md`, `docs/obsidian/notes/2026-04-27-agent-current-state-and-doc-coverage.md`, `docs/obsidian/notes/2026-04-27-mysql-optimize-phase2-handoff.md`, `docs/obsidian/notes/2026-04-27-mysql-optimize-prod-rollout-handoff.md`, `docs/obsidian/notes/2026-04-27-database-structure-future-optimization-handoff.md`
- Index: `docs/obsidian/index.md`
