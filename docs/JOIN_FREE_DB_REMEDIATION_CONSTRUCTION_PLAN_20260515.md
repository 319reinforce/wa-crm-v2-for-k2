# JOIN-Free DB Remediation Construction Plan

Date: 2026-05-15
Status: Implemented
Scope: remove newly introduced business JOINs and add prevention gates

## Goal

Repair the latest remote-branch risk without broad rewrites:

1. Remove new business-query `LEFT JOIN` usage introduced in the tech-debt merge.
2. Preserve endpoint response shapes.
3. Preserve owner scoping and LEFT semantics.
4. Add tests and static checks so future code cannot add multi-table JOINs silently.
5. Add release safety around startup migrations so database creation/migration failures are caught before deployment.

## Files To Touch

Primary code:

- `server/routes/audit.js`

Tests:

- `tests/auditRoutes.test.mjs`
- New: `tests/noNewBusinessJoin.test.mjs`

Optional helper:

- New: `server/services/auditAggregationService.js`, only if the refactor makes `server/routes/audit.js` too large.

Release safety:

- New: `scripts/list-default-startup-migrations.cjs`
- CI or deploy workflow file, depending on the actual release pipeline owner.

Docs:

- `docs/REMOTE_MAIN_DB_CRASH_AND_JOIN_RULE_ANALYSIS_20260515.md`
- `docs/JOIN_FREE_DB_REMEDIATION_CONSTRUCTION_PLAN_20260515.md`
- `docs/DOCS_INDEX.md`
- `docs/obsidian/index.md`
- `docs/obsidian/notes/2026-05-15-remote-main-db-crash-and-join-remediation.md`

## Phase 1: Refactor `buildAbEvaluationSummary`

### Current Problem

The current function joins `sft_memory` to `creators` to resolve owner, then groups by scene, owner, and day in SQL.

This violates the no-new-business-JOIN rule and also mixes owner filtering with LEFT semantics.

### Target Shape

Use only single-table queries:

1. Query `sft_memory` rows needed for the requested date range.
2. Extract `client_id` from `context_json` in application code.
3. Batch query `creators` by `wa_phone IN (?)`.
4. Build `creatorByPhone`.
5. Enrich SFT rows with `owner`.
6. Apply owner filter in JS.
7. Aggregate counts in JS.

### Implementation Sketch

```javascript
function parseContextClientId(contextJson) {
    const parsed = parseJsonSafe(contextJson, {});
    return typeof parsed.client_id === 'string' ? parsed.client_id.trim() : '';
}

async function fetchCreatorsByPhones(db2, phones) {
    const uniquePhones = [...new Set(phones.filter(Boolean))];
    if (uniquePhones.length === 0) return new Map();
    const rows = await db2.prepare(
        'SELECT wa_phone, wa_owner FROM creators WHERE wa_phone IN (?)'
    ).all(uniquePhones);
    return new Map(rows.map((row) => [String(row.wa_phone || ''), row]));
}

function keepOwner(row, owner) {
    if (!owner) return true;
    return row.owner === owner;
}
```

The `IN (?)` form follows the repo's mysql2 wrapper convention. If local tests reveal array expansion trouble in this wrapper, generate placeholders from the validated list length and pass the array as spread params.

### Expected Behavior

Global summary:

- Rows without a matching creator remain in totals.
- `by_owner` groups unmatched rows as `Unknown`.

Owner-scoped summary:

- Rows without a matching creator are excluded because they cannot be proven to belong to the locked owner.

## Phase 2: Refactor `buildGenerationStatsSummary`

### Current Problem

The current function joins `generation_log` to `creators` when owner is present, then uses SQL grouping for provider, route, and day.

### Target Shape

1. Query `generation_log` rows for the date window from one table.
2. If no owner is requested, aggregate directly in JS.
3. If owner is requested:
   - Extract `client_id`.
   - Batch query `creators`.
   - Filter rows by matched `wa_owner`.
4. Aggregate provider, route, day, success, failure, and average latency in JS.

### Aggregation Rules

- `success_count`: `status === 'success'`
- `failed_count`: `status === 'failed'`
- `avg_latency_ms`: average only finite numeric latency values.
- `by_provider`: unknown provider becomes `Unknown`.
- `by_route`: unknown route becomes `Unknown`.
- `by_day`: derive from `created_at` using the same date semantics already returned by MySQL where possible.

## Phase 3: Repair Endpoint Tests

Extend `tests/auditRoutes.test.mjs` with fixture coverage:

- Global evaluation summary includes unmatched SFT memory rows.
- Owner-scoped evaluation summary excludes unmatched rows and rows owned by another operator.
- Generation stats owner filter returns only matching owner rows.
- Response keys remain stable for frontend consumers.

Add a test for LEFT semantics:

```text
sft_memory row with client_id that has no creators row
global request -> total includes it, by_owner.Unknown increments
owner request -> total excludes it
```

## Phase 4: Static No-New-JOIN Guard

Create `tests/noNewBusinessJoin.test.mjs`.

### Scan Target

Default scan:

- `server/routes/**/*.js`
- `server/services/**/*.js`

Ignore:

- `server/migrations/**/*.sql`
- `docs/**`
- `tests/**`
- Explicit allowlist entries for historical JOINs.

### Rule

Fail on:

```regex
\b(?:LEFT|RIGHT|INNER|OUTER|CROSS)?\s*JOIN\b
```

when found in runtime business files and not covered by the allowlist.

### Allowlist Format

Use a small inline allowlist:

```javascript
const HISTORICAL_JOIN_ALLOWLIST = new Set([
  'server/routes/messages.js',
  'server/routes/creators.js',
  'server/routes/events.js',
]);
```

For stricter control, store fingerprints:

```javascript
{
  file: 'server/routes/messages.js',
  reason: 'historical media flattening; planned later',
  pattern: 'LEFT JOIN media_assets ma',
}
```

The first implementation may allow file-level historical exceptions to avoid blocking emergency work. The follow-up should shrink to pattern-level exceptions.

## Phase 5: Startup Migration Safety

### Current Risk

The container entrypoint runs startup migrations before the server starts. That is good for schema consistency, but a migration failure causes a full startup failure.

### Construction

1. Export default migration list from `scripts/run-startup-migrations.cjs`, or add `scripts/list-default-startup-migrations.cjs`.
2. Add a release job that runs the startup migration list against a staging schema clone.
3. Require this job before advancing `deploy/values-prod.yaml` image tag.
4. Keep `DB_MIGRATE_ON_STARTUP=true` as the production default.

### Acceptance Criteria

- The same migration file list used at container startup is rehearsed before prod deployment.
- The deploy tag commit is blocked if migration rehearsal fails.
- The server boot path still fails closed if production schema migration actually fails.

## Phase 6: Review Checklist

Before merging:

- No new `JOIN` remains in `server/routes/audit.js`.
- `rg -n "\\b(?:LEFT|RIGHT|INNER|OUTER|CROSS)?\\s*JOIN\\b" server/routes/audit.js` returns only historical code that predates the merge, or nothing.
- Owner-scoped audit summaries pass tests.
- Global audit summaries keep unmatched rows as `Unknown`.
- Static no-new-JOIN test fails when a synthetic JOIN is added.
- Migration rehearsal command is documented and runnable.

## Rollback Plan

If the refactor causes dashboard regressions:

1. Disable only the affected aggregate endpoint behind an env flag.
2. Keep server startup and unrelated endpoints online.
3. Do not revert to multi-table business JOIN as the fix.
4. Ship a smaller fallback response with totals from single-table queries while owner breakdown is repaired.

## Verification Commands

```bash
node --check server/routes/audit.js
node --test tests/auditRoutes.test.mjs
node --test tests/noNewBusinessJoin.test.mjs
rg -n "\\b(?:LEFT|RIGHT|INNER|OUTER|CROSS)?\\s*JOIN\\b" server/routes/audit.js
npm run build
```

Startup migration rehearsal, local/staging only:

```bash
node --check scripts/run-startup-migrations.cjs
node scripts/run-startup-migrations.cjs
```

## Done Definition

This remediation is done when:

- The audit summary endpoints no longer add new business JOINs.
- Tests prove application-layer LEFT merge behavior.
- The static guard prevents accidental new runtime JOINs.
- The release process rehearses startup migrations before image-tag deployment.
- The analysis and construction documents are synced to Obsidian.

## Implementation Results

Implemented on 2026-05-15:

- `server/routes/audit.js` rewrote `buildAbEvaluationSummary()` and `buildGenerationStatsSummary()` to remove the new business-query JOINs.
- The replacement queries select only the required columns from `sft_memory` and `generation_log`.
- Creator ownership is resolved through a batched `creators WHERE wa_phone IN (?)` lookup with 500-phone chunks.
- Application-layer `Map` merge preserves LEFT semantics:
  - Global AB evaluation keeps unmatched creators under `Unknown`.
  - Owner-scoped AB evaluation and generation stats exclude unmatched/foreign-owner rows.
- `tests/auditRoutes.test.mjs` now covers Unknown-owner retention, owner filtering, generation stats filtering, and JOIN-free primary table queries.
- `tests/noNewBusinessJoin.test.mjs` adds a static runtime guard:
  - Existing historical JOINs must stay explicitly allowlisted.
  - `buildAbEvaluationSummary()` and `buildGenerationStatsSummary()` are checked as JOIN-free bodies.

Verification run:

```bash
node --check server/routes/audit.js
node --test tests/auditRoutes.test.mjs
node --test tests/noNewBusinessJoin.test.mjs
```

Result: passed.

Remaining release-process follow-up:

- Add startup migration rehearsal to CI/deploy before advancing `deploy/values-prod.yaml` image tags. Code-level JOIN remediation is complete; release-pipeline gating still requires pipeline-owner wiring.

## Obsidian Sync

- Status: synced
- Note: `docs/obsidian/notes/2026-05-15-remote-main-db-crash-and-join-remediation.md`
- Index: `docs/obsidian/index.md`
