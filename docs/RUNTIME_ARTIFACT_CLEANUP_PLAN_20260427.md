# Runtime Artifact And Report Cleanup Plan

Date: 2026-04-27
Status: Active cleanup baseline
Scope: `reports/`, runtime exports, local generated artifacts, and removed external RAG vendor code

## 1. Goal

This plan separates source-controlled product knowledge from generated runtime artifacts. It also records the decision to remove the old `LightRAG` gitlink and keep future RAG work on the current local-rule/OpenAI hosted RAG path.

The cleanup must not affect the parallel MySQL optimization branch. Execute this work from a clean branch or isolated worktree based on the documentation cleanup branch.

## 2. Boundary Rules

| Area | Source control rule | Notes |
| --- | --- | --- |
| `docs/` | Keep active standards, PRDs, handoffs, runbooks, Obsidian notes, and compact archives. | Avoid putting raw generated evidence in the active docs path. |
| `reports/` | Short-lived generated output. Keep only if a handoff needs reproducible evidence. | Prefer a compact index summary over raw report history. |
| `docs/exports/` | Removed from active source control. | Existing lifecycle exports were dated 2026-04-14, contained raw phone values, and should not guide current lifecycle behavior. |
| `docs/rag/observation-reports/` | Generated observation output. Ignore generated files; keep `.gitkeep` only. | The report directory is already ignored in `.gitignore`. |
| `docs/wa/*state.json` | Removed from active source control. | Runtime state now belongs under ignored `data/runtime-state/`. |
| `data/` | Local runtime data only. | Keep ignored. Remove `.DS_Store` when found. |
| `data/runtime-state/` | Local mutable runtime cursors and state. | Ignored; scripts may recreate files here. |
| `backups/` | Local backup output only. | Keep ignored and out of commits. |
| `public/assets/` | Build output. | Keep ignored. |
| `public/sop-assets/` | Product SOP image assets. | Keep tracked while templates reference them. |
| `LightRAG/` | Removed from this repo. | Future work should not use the old LightRAG vendor/submodule path. |

## 3. LightRAG Decision

Decision: remove `LightRAG` from WA CRM v2.

Reasons:

- The repository had a gitlink at `LightRAG` but no `.gitmodules` mapping, which made it a broken half-submodule.
- Local checkout size was about 102 MB and mostly external vendor code, tests, and docs.
- Current WA CRM RAG direction is documented in:
  - `docs/rag/KNOWLEDGE_SOURCE_STANDARD.md`
  - `docs/rag/OPENAI_RAG_RUNBOOK.md`
  - `docs/rag/LOCAL_RULE_RETRIEVAL_DESIGN_20260420.md`
  - `docs/rag/LOCAL_RULE_IMPLEMENTATION_20260420.md`
- The project will not adopt the LightRAG solution path.

Implementation:

- Remove tracked `LightRAG` gitlink.
- Add `LightRAG/` to `.gitignore` so local experiments are not reintroduced.
- Do not add LightRAG documentation to `docs/DOCS_INDEX.md`.

## 4. Current Report Inventory

| File | Type | Current references | Recommendation |
| --- | --- | --- | --- |
| `reports/active-event-detection-1072-keyword-20260426.json` | Active event dry-run evidence | `docs/ACTIVE_EVENT_DETECTION_HANDOFF_20260426.md` | Keep until active-event rollout closes; then summarize and delete. |
| `reports/active-event-detection-1087-keyword-20260426.json` | Active event dry-run evidence | `docs/ACTIVE_EVENT_DETECTION_HANDOFF_20260426.md` | Keep until active-event rollout closes; then summarize and delete. |
| `reports/event-lifecycle-top-creators-20260425-local.json` | Lifecycle backfill evidence | `docs/EVENT_LIFECYCLE_BACKFILL_HANDOFF_20260425.md`, `docs/obsidian/notes/2026-04-25-event-lifecycle-handoff.md` | Keep while those handoffs are active; later archive summary only. |
| `reports/event-lifecycle-top-creators-20260425-minimax.json` | Lifecycle LLM comparison evidence | `docs/EVENT_LIFECYCLE_BACKFILL_HANDOFF_20260425.md` | Keep while lifecycle backfill is under review; later delete after summary. |
| `reports/tier2-compat-event-audit-20260425.json` | Compatibility audit evidence | `docs/EVENT_LIFECYCLE_BACKFILL_HANDOFF_20260425.md`, `docs/obsidian/notes/2026-04-25-worktree-remediation-plan.md` | Keep until compatibility audit is superseded by schema cleanup. |
| `reports/dirty-data-cleanup-20260416.sql` | Historical SQL output | No active docs should execute it directly. | Removed; conclusions live in `docs/archive/PRE_20260420_DOCS_ARCHIVE.md` and the schema optimization plan. |
| `docs/exports/lifecycle-*.{csv,md}` | Historical lifecycle exports | No active docs should depend on them. | Removed because they predate the current lifecycle model and contained raw phone values. |

## 5. Cleanup Phases

### Phase A: Safe Immediate Cleanup

- Remove the broken `LightRAG` gitlink.
- Ignore `LightRAG/`.
- Delete `.DS_Store` files from `docs/`, `reports/`, `data/`, `public/`, and local vendor directories when present.
- Keep tracked report files that are still referenced by active handoffs.
- Remove pre-2026-04-20 exports/reports that contain raw phone values or executable cleanup SQL after summarizing them in archive/Obsidian.

### Phase B: Report Slimming

- For each tracked report, write a short summary in the owning handoff or an archive index.
- Replace raw report links in active docs with summary text when rollout decisions no longer require the original output.
- Delete raw JSON/SQL reports after references are removed.

### Phase C: Runtime State Boundary

- Move mutable state files out of `docs/`.
- `scripts/beau-nightly-role-heartbeat.cjs` now writes to `data/runtime-state/beau-nightly-role-heartbeat-state.json` by default. Override with `BEAU_HEARTBEAT_STATE_PATH` if needed.
- Ensure `data/`, `backups/`, and generated observation reports remain ignored.

### Phase D: Docs Index Slimming

- Keep `docs/DOCS_INDEX.md` focused on active docs.
- Move historical rollout output to `docs/archive/` or Obsidian summaries.
- Do not add vendor docs or generated reports as normal reading entry points.

## 6. Verification

Before merging any cleanup PR:

```bash
git diff --check
rg -n "LightRAG|reports/.*202604|docs/exports|dirty-data-cleanup|docs/wa/.*state" AGENTS.md BOT_INTEGRATION.md DEPLOY.md docs scripts server src reports || true
git ls-files LightRAG reports docs/exports docs/rag/observation-reports docs/wa
git status --short --branch
```

Expected:

- `git ls-files LightRAG` returns no tracked files.
- `git ls-files docs/exports docs/wa` returns no tracked runtime/export artifacts.
- Active entry docs do not point at LightRAG.
- Report references remain only in owning handoffs, archive docs, or scripts that generate new reports.
- No schema/server/mysql optimize files are touched by this cleanup.

## Obsidian Sync

- Status: synced
- Note: `docs/obsidian/notes/2026-04-27-runtime-artifact-cleanup-plan.md`
- Index: `docs/obsidian/index.md`
