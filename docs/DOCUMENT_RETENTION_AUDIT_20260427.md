# Documentation Retention Audit

Date: 2026-04-27
Remote of record: Gitea `origin`
Status: Cleanup executed

This audit records the documentation cleanup for pre-2026-04-20 material. The goal is to keep `docs/DOCS_INDEX.md` and Obsidian as the active entry points while moving old review/security/runtime/event notes out of the working path.

## Scope

Reviewed:

- Root project docs: `AGENTS.md`, `BOT_INTEGRATION.md`, `DEPLOY.md`.
- Top-level `docs/*.md`.
- transitional `docs/rag/knowledge-manifest.json`, `docs/rag/sources/*.md`, and shadow-case fixtures.
- Existing `docs/obsidian/notes/*.md`.

Not treated as deletion candidates in this pass:

- Runtime state JSON, CSV exports, SQL helper files, deployment rsync lists, and generated runtime artifacts.
- `.claude/` local agent notes were later removed because they were Claude-specific and described obsolete SQLite/server.js workflows.

Later update: `LightRAG` was removed in the runtime artifact cleanup because the project will not adopt that solution and the repository only had a broken gitlink without `.gitmodules`.

## Current Source Of Truth

Use these as the active entry points for future development:

| Area | Keep as source of truth | Obsidian memory |
| --- | --- | --- |
| Agent onboarding | `AGENTS.md`, `BOT_INTEGRATION.md`, `docs/DOCS_INDEX.md`, `docs/CORE_MODULES_OVERVIEW.md` | `docs/obsidian/notes/2026-04-25-agent-onboarding-and-bot-integration.md`, `docs/obsidian/notes/2026-04-25-docs-index-and-core-modules.md` |
| Database/schema cleanup | `docs/DATABASE_SCHEMA_OPTIMIZATION_PLAN_20260427.md`, `schema.sql` | `docs/obsidian/notes/2026-04-27-database-schema-optimization-plan.md` |
| Event/lifecycle | `docs/EVENT_LIFECYCLE_DATA_PRD_20260425.md`, `docs/EVENT_LIFECYCLE_BACKFILL_HANDOFF_20260425.md`, `docs/ACTIVE_EVENT_DETECTION_HANDOFF_20260426.md` | Existing dated event/lifecycle notes under `docs/obsidian/notes/`; older handoffs were removed from `docs/archive/handoffs/` |
| Contact import and templates | `docs/CREATOR_IMPORT_WELCOME_HANDOFF_20260426.md` | `2026-04-26-creator-import-welcome-handoff.md`, `2026-04-26-template-custom-topic-handoff.md` |
| Runtime architecture | `docs/AI_REPLY_GENERATION_SYSTEM.md`, `docs/WA_SESSIONS_DESIGN.md`, `docs/BAILEYS_ROLLOUT.md`, `docs/SSE_HARDENING.md` | `docs/obsidian/notes/2026-04-27-runtime-architecture-docs.md` |
| Knowledge source / profile memory | `docs/rag/knowledge-manifest.json`, approved files in `docs/rag/sources/`, and future per-user Markdown profile notes | `docs/obsidian/notes/2026-04-27-rag-knowledge-source-docs.md`, `docs/obsidian/notes/2026-04-27-profile-skill-memory-direction.md` |
| Branch and archive mapping | `docs/RECENT_BRANCH_DOC_MAPPING_20260427.md` | `docs/obsidian/notes/2026-04-27-recent-branch-doc-mapping.md` |
| Runtime artifact cleanup | `docs/RUNTIME_ARTIFACT_CLEANUP_PLAN_20260427.md`, `docs/archive/reports/REPORTS_INDEX_20260427.md` | `docs/obsidian/notes/2026-04-27-runtime-artifact-cleanup-plan.md` |
| Pre-2026-04-20 archive | `docs/archive/PRE_20260420_DOCS_ARCHIVE.md` | `docs/obsidian/notes/2026-04-27-pre-20260420-docs-archive.md` |
| Obsidian standard | `docs/OBSIDIAN_MEMORY_STANDARD.md` | `docs/obsidian/notes/2026-04-25-obsidian-memory-standard.md` |

## Cleanup Executed

Deleted low-value or superseded files after consolidating useful context into `docs/archive/PRE_20260420_DOCS_ARCHIVE.md` and Obsidian:

- `CODE_REVIEW.md`
- root `SECURITY_FIX_REPORT.md`
- `docs/CODE_REVIEW_FINDINGS_20260416.md`
- `docs/REVIEW_FIX_REPORT_20260416.md`
- `docs/PROJECT_ANALYSIS.md`
- `docs/CLEANUP_HISTORY_20260416.md`
- `docs/LEGACY_CLEANUP_LOG.md`
- `docs/HISTORICAL_REPORTS_ARCHIVE.md`
- `docs/PHASE_1A_HANDOFF.md`
- `docs/REPLY_GENERATION_REFACTOR_ISSUES_20260416.md`
- `docs/REPLY_GENERATION_REFACTOR_MEMORY_20260416.md`
- `docs/SECURITY_FIX_PLAN.md`
- `docs/SECURITY_FIX_REPORT.md`
- `docs/SECURITY_CHANGES_20260416.md`
- `docs/SECURITY_CHANGES_2026-04-16.md`
- `docs/EVENT_SYSTEM.md`
- `docs/EVENT_SYSTEM_REQUIREMENTS.md`
- `docs/rag/RUNTIME_ALIGNMENT_20260416.md`
- `docs/rag/SESSION_SUMMARY_20260420.md`
- `reports/dirty-data-root-cause-20260416.md`
- `docs/.DS_Store`

## Consolidated Value

The archive preserves the parts that still matter:

- Runtime baseline: Express entry is `server/index.cjs`, runtime port is 3000, MySQL is the runtime database, and `crm.db` / SQLite must not be restored.
- Security/auth lessons: use current middleware, parameterized queries, and policy retrieval boundaries; do not treat 2026-04-16 line numbers as current.
- Destructive cleanup safety: avoid deleting runtime state or user data without explicit confirmation; preserve migration/audit context.
- Reply generation/SFT context: keep the shift toward `replyGenerationService`, Experience Router, generation metadata, and SFT feedback, but use current AI/SFT docs for implementation.
- Event docs: legacy event requirements were replaced by lifecycle fact/status/backfill docs and active event detection handoff.
- RAG/runtime notes: old provider state was archived; RAG runbooks/design docs were removed from active docs. The future direction is per-user Markdown profile memory / skill memory, with the manifest retained only while code still reads it.
- Dirty-data finding: `joinbrands_link` may be empty in some environments; verify with current DB before assuming event filters are broken.

## Retained Historical Docs

Some older docs remain active because they still describe live behavior:

- `docs/obsidian/notes/2026-04-27-profile-skill-memory-direction.md`
- `docs/EVENT_DECISION_TABLE.md`

These are not automatically current authorities; use `docs/DOCS_INDEX.md` to decide whether they are background or an active module reference.

## Verification Checklist

- `docs/DOCS_INDEX.md` no longer lists deleted files as active docs.
- `AGENTS.md`, `BOT_INTEGRATION.md`, and `DEPLOY.md` no longer direct agents to deleted review/security/event files.
- Obsidian index links the new archive and retention notes.
- Deleted file names are allowed only in the archive, this audit, and historical Obsidian notes that explicitly say the source was consolidated.

## Obsidian Sync

- Status: synced
- Note: `docs/obsidian/notes/2026-04-27-document-retention-audit.md`
- Index: `docs/obsidian/index.md`
