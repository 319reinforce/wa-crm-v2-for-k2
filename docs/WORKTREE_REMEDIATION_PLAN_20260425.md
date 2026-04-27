# Worktree Remediation Plan

Date: 2026-04-25
Status: Planning only

This plan covers current code conflicts and non-document changes. It intentionally does not modify source code.

## Current State

`git status --short --branch` shows the branch:

- `codex/eventoptimize`

Document work in progress:

- Entry and standards docs updated for Obsidian.
- New docs under `docs/obsidian/`.
- New event/lifecycle and V1 layout handoff docs are untracked.

Code and generated/non-document work already present before this planning pass:

- Generated/build output:
  - `public/index.html` currently appears deleted in `git status`. Earlier status had shown it as conflicted. Treat it as generated Vite output and decide whether to regenerate/commit it only after the source changes are reviewed.
- Staged modifications:
  - `schema.sql`
  - `server/routes/creators.js`
  - `server/routes/events.js`
  - `server/routes/stats.js`
  - `server/services/lifecyclePersistenceService.js`
  - `server/services/lifecycleService.js`
  - `server/services/replyStrategyService.js`
  - `src/App.jsx`
- Additional unstaged modifications:
  - `server/routes/creators.js`
  - `server/routes/events.js`
  - `src/App.jsx`
  - `src/components/EventPanel.jsx`
- Untracked implementation/test/report files:
  - `server/migrations/004_event_lifecycle_fact_model.sql`
  - `server/services/creatorEventSnapshotService.js`
  - `server/services/eventLifecycleFacts.js`
  - `tests/eventLifecycleFacts.test.mjs`
  - `scripts/audit-tier2-compat-events.cjs`
  - `scripts/backfill-event-lifecycle-facts.cjs`
  - `scripts/test-event-lifecycle-top-creators.cjs`
  - `reports/event-lifecycle-top-creators-20260425-local.json`
  - `reports/event-lifecycle-top-creators-20260425-minimax.json`
  - `reports/tier2-compat-event-audit-20260425.json`

At the time of this plan, `git diff --name-only --diff-filter=U` returned no unmerged files. Recheck before touching build output because `public/index.html` changed state during the branch work.

## Proposed Split

### Change Set A: Documentation And Obsidian

Scope:

- `AGENTS.md`
- `CLAUDE.md`
- `BOT_INTEGRATION.md`
- `SFT_PROJECT.md`
- `docs/archive/PRE_20260420_DOCS_ARCHIVE.md`
- `docs/DOCS_INDEX.md`
- `docs/CORE_MODULES_OVERVIEW.md`
- `docs/OBSIDIAN_MEMORY_STANDARD.md`
- `docs/WORKTREE_REMEDIATION_PLAN_20260425.md`
- `docs/obsidian/`
- Updated handoff and standards docs.

Goal:

- Land documentation cleanup separately from code.
- Keep this change set reviewable without build artifacts.

Validation:

```bash
git diff --check -- AGENTS.md CLAUDE.md BOT_INTEGRATION.md SFT_PROJECT.md docs
rg -n "Obsidian Sync|docs/obsidian|OBSIDIAN_MEMORY_STANDARD" -g '*.md'
```

### Change Set B: Event Lifecycle Data Model

Scope:

- `schema.sql`
- `server/migrations/004_event_lifecycle_fact_model.sql`
- `server/services/eventLifecycleFacts.js`
- `server/services/creatorEventSnapshotService.js`
- `server/routes/events.js`
- `server/routes/creators.js`
- `server/routes/stats.js`
- `server/services/lifecyclePersistenceService.js`
- `server/services/lifecycleService.js`
- `server/services/replyStrategyService.js`
- `tests/eventLifecycleFacts.test.mjs`
- lifecycle audit/backfill scripts.

Goal:

- Isolate the lifecycle fact-model work from layout changes.
- Verify schema, service, route, and stats behavior together.

Validation:

```bash
node --check server/services/eventLifecycleFacts.js
node --check server/services/creatorEventSnapshotService.js
node --check server/routes/events.js
node --check server/routes/creators.js
node --test tests/eventLifecycleFacts.test.mjs
```

Additional validation after DB is available:

```bash
npm run test:api:events
node scripts/audit-tier2-compat-events.cjs
```

### Change Set C: Frontend Layout And Event UI

Scope:

- `src/App.jsx`
- `src/components/EventPanel.jsx`
- generated `public/index.html` only if build output is intentionally committed.

Goal:

- Separate UI/layout review from event model review.
- Avoid mixing generated Vite assets with source changes unless the project requires committed build output.

Validation:

```bash
npm run build
git diff --check -- src/App.jsx src/components/EventPanel.jsx public/index.html
```

Browser checks:

- `http://localhost:3000/`
- `http://localhost:3000/v1/?tab=lifecycle&source=v2`
- `http://localhost:3000/v1/?tab=finance&source=v2`

## Recommended Order

1. Finish and optionally commit Change Set A first.
2. Re-run `git status --short` and confirm whether `public/index.html` still has conflict markers.
3. Review Change Set B service-by-service, starting with schema/migration and pure service tests.
4. Review Change Set C after Change Set B API contracts are stable.
5. Only then run full build/test and decide whether generated assets belong in the commit.

## Do Not Do Yet

- Do not revert code files blindly; staged and unstaged changes may contain useful work.
- Do not run destructive cleanup commands.
- Do not send private CRM message content to external LLM APIs without explicit authorization.
- Do not commit reports containing sensitive message content without reviewing redaction needs.

## Obsidian Sync

- Status: synced
- Note: `docs/obsidian/notes/2026-04-25-worktree-remediation-plan.md`
- Index: `docs/obsidian/index.md`
