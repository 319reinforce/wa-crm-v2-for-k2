# Pre-2026-04-20 Documentation Archive

Date: 2026-04-27
Status: Consolidated archive; replaces scattered pre-2026-04-20 review, cleanup, security, and refactor notes

This archive preserves the useful engineering conclusions from old project documents dated before 2026-04-20. The original documents were removed from the active documentation surface so future agents do not treat outdated SQLite/server.js-era notes as current instructions.

## Why This Archive Exists

Before 2026-04-20, WA CRM v2 went through several rapid cleanup and migration passes:

- SQLite and JSON-era data paths were retired.
- The runtime moved toward MySQL, `server/index.cjs`, and modular route/service files.
- Security findings were fixed across auth, audit logging, owner scope, and parameterized SQL.
- Reply generation was consolidated into a single backend service.
- Raw historical reports with PII risk were summarized and removed.

These findings are still useful as background, but they should not compete with current docs such as:

- `AGENTS.md`
- `docs/DOCS_INDEX.md`
- `docs/CORE_MODULES_OVERVIEW.md`
- `docs/DATABASE_SCHEMA_OPTIMIZATION_PLAN_20260427.md`
- `docs/EVENT_LIFECYCLE_DATA_PRD_20260425.md`
- `docs/ACTIVE_EVENT_DETECTION_HANDOFF_20260426.md`
- `docs/AI_REPLY_GENERATION_SYSTEM.md`
- `docs/SFT_RLHF_PIPELINE.md`
- `docs/rag/KNOWLEDGE_SOURCE_STANDARD.md`

## Consolidated Source Documents

The following source files were consolidated here and deleted from active docs:

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

## Preserved Conclusions

### Runtime Baseline

- Current runtime is MySQL, not SQLite.
- `crm.db`, SQLite WAL files, and `data/*.json` should remain retired.
- The active server entry is `server/index.cjs`.
- `schema.sql` is the schema baseline.
- Historical `server.js` line references are obsolete and should not drive code changes.

### Security And Auth

The old security work landed these important principles:

- Local auth bypass must be opt-in, not default-on.
- Query-string tokens should not be used for normal API auth.
- Audit logs must redact sensitive identifiers and secrets.
- Internal service tokens must not silently reuse admin/operator tokens.
- Owner-scoped routes must prevent cross-owner data access.
- `wa_phone` must not leak through non-admin API responses, logs, audit payloads, or external systems.
- `LIMIT`/`OFFSET` and other SQL inputs should be parameterized or strictly validated.

If security work resumes, use current code plus `docs/obsidian/notes/2026-04-16-code-review-archive.md`; do not resurrect old line-number checklists.

### Destructive Cleanup Safety

The most durable lesson from the old code review was about destructive message repair:

- Do not delete or overwrite `wa_messages` unless the raw evidence window is complete enough to prove the target rows are invalid.
- Deduplication should avoid treating legitimate repeated short messages such as `ok`, `thanks`, or `done` as pollution.
- Repair tools should prefer dry-run, explicit confirmation, narrow matching keys, and auditability.

### Reply Generation And SFT

The reply-generation refactor established the current shape:

- Main candidate generation flows through `POST /api/ai/generate-candidates`.
- `server/services/replyGenerationService.js` orchestrates provider routing, prompt construction, retrieval snapshots, and generation logs.
- Legacy `/api/minimax` and `/api/experience/route` became compatibility entrypoints.
- `sft_memory` gained generation tracking fields.
- Current implementation guidance lives in `docs/AI_REPLY_GENERATION_SYSTEM.md` and `docs/SFT_RLHF_PIPELINE.md`.

### RAG And Local Rules

The pre-4/20 RAG work established:

- Knowledge sources should live under `docs/rag/sources/`.
- `docs/rag/knowledge-manifest.json` controls source metadata and status.
- Deterministic local rule retrieval is important for small, policy-heavy source sets.
- Old runtime `.env`/provider state from 2026-04-16 is not current and must not be treated as rollout guidance.
- `docs/rag/SESSION_SUMMARY_20260420.md` duplicated `docs/rag/LOCAL_RULE_IMPLEMENTATION_20260420.md`, so only the implementation doc remains active.

### Event System Docs

The old `EVENT_SYSTEM` documents were duplicate legacy notes. The current event/lifecycle entry points are:

- `docs/EVENT_LIFECYCLE_DATA_PRD_20260425.md`
- `docs/obsidian/notes/2026-04-25-event-lifecycle-handoff.md`
- `docs/EVENT_LIFECYCLE_BACKFILL_HANDOFF_20260425.md`
- `docs/ACTIVE_EVENT_DETECTION_HANDOFF_20260426.md`

### Dirty Data Findings

The old dirty-data trace found issues that are now better handled through the current database optimization plan:

- Some creator insert paths historically missed companion `wa_crm_data` rows.
- `client_profiles` had placeholder rows and weak fallback behavior.
- Profile-analysis snapshots/change events were not always connected to user-visible profile state.
- Historical SFT rows lacked `system_prompt_used` because backfill ran before all columns existed.
- Empty-text and null-operator `wa_messages` were mostly migration residue.
- `operator_experiences` lagged behind the real owner roster.

Use `docs/DATABASE_SCHEMA_OPTIMIZATION_PLAN_20260427.md` for current schema cleanup, ownership, and retention planning.

## Deleted Files With No Ongoing Value

- `docs/.DS_Store` was macOS metadata and had no documentation value.

## Obsidian References

Useful memories that supersede the deleted source files:

- `docs/obsidian/notes/2026-04-16-code-review-archive.md`
- `docs/obsidian/notes/2026-04-16-legacy-cleanup-memory.md`
- `docs/obsidian/notes/2026-04-16-reply-generation-refactor-memory.md`
- `docs/obsidian/notes/2026-04-27-document-retention-audit.md`
- `docs/obsidian/notes/2026-04-27-runtime-architecture-docs.md`
- `docs/obsidian/notes/2026-04-27-rag-knowledge-source-docs.md`

## Obsidian Sync

- Status: synced
- Note: `docs/obsidian/notes/2026-04-27-pre-20260420-docs-archive.md`
- Index: `docs/obsidian/index.md`
