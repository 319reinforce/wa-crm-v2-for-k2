---
name: Data & Infrastructure Code Review Report
type: review
date: 2026-04-11
scope: db, schema, scripts, infra
---

# Data & Infrastructure Code Review Report

**Date:** 2026-04-11
**Scope:** `db.js`, `schema.sql`, `scripts/`, config files
**Files Reviewed:** 40+ files

---

## 1. Executive Summary

| Severity | Count |
|----------|-------|
| Critical | 3 |
| High | 7 |
| Medium | 10 |
| Low / Observation | 11 |
| **Total** | **31** |

**Overall Assessment:** Production-grade connection pooling and parameterized SQL. Critical issues are credential hygiene and migration bugs. Multiple destructive scripts lack confirmation guards and write PII to outputs.

---

## 2. Critical Issues

### C-1: Hardcoded credentials committed to git
**File:** `.env.example:2,9,20`
Real `DB_PASSWORD`, `OPENAI_API_KEY`, and `MINIMAX_API_KEY` values are in a committed file. The safe template is `.env.example.public`, which is not referenced in `.gitignore`.

### C-2: Overly-permissive file permissions on `.env.example`
Mode 644/664 means group/world can read committed credentials.

### C-3: Double DELETE on events table in transaction
**File:** `scripts/lib/hardDeleteCreator.js:34-40`
`event_periods` has `ON DELETE CASCADE` FK from `events`. Explicit loop over `eventRows` is redundant and will also fail if schema differs.

---

## 3. High Issues

### H-1: Hardcoded absolute paths in scripts
**File:** `scripts/backfill-operator-roster.js:10-14`
Script crashes on any machine except depp's MacBook.

### H-2: Invalid MySQL `DROP INDEX` syntax
**File:** `migrate-message-hash.js:62`
```sql
DROP INDEX idx_messages_dedup ON wa_messages
```
MySQL requires `ALTER TABLE wa_messages DROP INDEX idx_messages_dedup`. Current syntax always errors.

### H-3: wa_phone PII written to stdout and report files
- `scripts/generate-events-from-chat.cjs:296`
- `scripts/cleanup-invalid-creators.cjs:48`
- `scripts/export-invalid-chat-review.js:179-203`
- `scripts/export-unmapped-roster-review.js:170`
- `scripts/export-unmapped-roster-aggressive-review.js:264`
- `scripts/export-final-roster-full.js:40`
- `scripts/apply-wa-review-decisions.js:330`
- `scripts/apply-crosscheck-v2-final.js:153`

### H-4: Non-atomic migration in `migrate-message-hash.js`
Multiple DDL operations without a transaction. Mid-run failure leaves schema in partial state.

### H-5: Dynamic column allowlist SQL injection risk
**File:** `scripts/generate-sft-from-history.cjs:257-263`
Column list derived from object keys, not a hardcoded allowlist.

### H-6: `generate-events-from-chat.cjs` bypasses db.js connection pool
**File:** `scripts/generate-events-from-chat.cjs:256`
Creates raw `mysql.createConnection()` instead of using `db.getDb()`.

### H-7: `analyze-schema-state.js` unquoted table name interpolation
**File:** `scripts/analyze-schema-state.js:41`

---

## 4. Medium Issues

### M-1: No `--dry-run` confirmation on destructive scripts
`backfill-operator-roster.js`, `delete-null-phone-creators.js`, `apply-crosscheck-decisions.js`, `apply-wa-review-decisions.js`, `apply-crosscheck-v2-final.js`, `sync-owners-from-csv.cjs`

### M-2: Error path doesn't explicitly call `closeDb()`
`cleanup-invalid-creators.cjs:84-86`

### M-3: Loads all creators into memory without pagination
`scripts/generate-events-from-chat.cjs:282`

### M-4: Loads all messages per creator, uses only last 10
**File:** `scripts/generate-sft-from-history.cjs:164`

### M-5: NULL/0 timestamp rows all get same hash — collisions
**File:** `migrate-message-hash.js:53-57`

### M-6: Raw LLM error messages logged to stdout without sanitization
**File:** `scripts/generate-events-from-chat.cjs:320`

### M-7: Hardcoded absolute script paths
`run-finetuned-canary-rollout.cjs:37,43`

### M-8: Imports service layer creating double connection pool
**File:** `scripts/generate-events-from-chat.cjs:15`

### M-9: CSV exports contain conversational snippets that may contain creator PII
**File:** `scripts/export-invalid-chat-review.js`

### M-10: NaN from failed parseInt silently makes REGEXP bounds checks always true
**File:** `batch-review-pending.cjs:40-44`

---

## 5. Low Issues / Observations

### L-1: `package.json` has no `engines` field. `.nvmrc` says `20` but no install guard.
### L-2: `sft_memory` missing index on `created_date`.
### L-3: `operator_creator_roster` prefix unique key doesn't enforce true uniqueness.
### L-4: `generation_log` has no TTL/cleanup — unbounded growth.
### L-5: `sync_log` missing index on `synced_at`.
### L-6: `closeDb()` errors silently swallowed in catch (`sync-owners-from-csv.cjs:176`)
### L-7: `fs.readFileSync` loads entire file into memory (`train-sft-local.cjs:38`)
### L-8: `closeDb()` in finally can throw and mask original error
### L-9: `generate-sft-from-history.cjs` — dry-run mode silently skips without logging
### L-10: `generate-events-from-chat.cjs` — no retry on transient MySQL errors (1205, 1213, 2006, 2013)
### L-11: Hardcoded `LIMIT 80` for messages is arbitrary

---

## 6. Schema & Database Issues

| ID | File | Description |
|----|------|-------------|
| Schema-1 | `schema.sql:14` | `creators.wa_phone` allows NULL in DB but `NOT NULL` in schema. Blind apply will fail. |
| Schema-2 | `schema.sql:297,326` | `policy_documents` and `training_log` lack `ENGINE=InnoDB` |
| Schema-3 | `schema.sql` | `retrieval_snapshot` has no TTL — unbounded JSON growth |
| Schema-4 | `schema.sql:169` | `ON DELETE SET NULL` on `INT NOT NULL` column is contradictory |
| Schema-5 | `export-final-roster-full.js:138` | `BINARY` cast comparison prevents index usage |
| Schema-6 | `schema.sql:465` | Functional partial unique index with `IF()` is opaque |

---

## 7. Security Findings

| ID | Severity | Description |
|----|----------|-------------|
| SEC-1 | Critical | Real credentials committed (C-1) |
| SEC-2 | High | wa_phone PII in output files (H-3) |
| SEC-3 | Medium | `mock-finetuned-server.cjs:64` binds to `0.0.0.0` |
| SEC-4 | Medium | Mock server has no authentication on `/v1/messages` |
| SEC-5 | Low | `WA_ADMIN_TOKEN` as hidden auth bypass |
| SEC-6 | Medium | CSV export `csvEscape()` does not escape `\r\n` — row injection possible |

---

## 8. Dependency Audit

| Package | Version | Notes |
|---------|---------|-------|
| `express` | 4.22.1 | CVE-2024-29041, CVE-2024-45590 affect <=4.21.0. Upgrade to 4.23.0+ |
| `mysql2` | 3.20.0 | Check CVE-2024-36000 |
| `whatsapp-web.js` | 1.34.6 | Major version jump from `^1.26.0` without package.json update |
| `dotenv` | 16.6.1 | OK (CVE-2024-29251 patched) |
| `deasync` | 0.1.31 | Native addon, blocks event loop — anti-pattern in production |
| `better-sqlite3` | 11.0.0 | OK (dev dependency only) |

---

## 9. Script Quality

### Positive
- All SQL uses prepared statements across 30+ scripts
- `db.js` pool: `connectionLimit: 10`, `waitForConnections: true`, `enableKeepAlive: true`
- Transaction rollback correctly implemented
- Migration script is idempotent for DDL
- `batch-review-pending.cjs` has proper dry-run
- Mock server handles SIGINT/SIGTERM
- SFT backfill has retry logic with backoff
- Consistent `utf8mb4_unicode_ci` collation

### Violations
- 5+ scripts have hardcoded absolute paths
- 8+ scripts write wa_phone to output
- 6 destructive scripts lack confirmation guards
- `generate-events-from-chat.cjs` bypasses db.js pool
- Multiple scripts skip explicit `closeDb()` on error paths

---

## 10. Positive Findings

1. Consistent parameterized SQL across all 30+ scripts
2. `db.js` connection pool is production-grade
3. Migration script idempotent for DDL (column/index existence checks)
4. `.env.example.public` separates secrets from safe defaults
5. Transaction rollback/release pattern in `db.js` is correct
6. `validate-knowledge-manifest.cjs` is read-only
7. Mock server exits cleanly on signals
8. SFT backfill has retry logic for rate limits
9. Consistent `utf8mb4_unicode_ci` collation across all tables
10. Foreign keys correctly cascade for most tables

---

## 11. Recommendations (Prioritized)

### Immediate (before next deploy)
1. Remove real credentials from `.env.example`; add it to `.gitignore`
2. Fix `DROP INDEX` syntax in `migrate-message-hash.js:62`
3. Fix double-delete in `scripts/lib/hardDeleteCreator.js`
4. Hash wa_phone in all console output and report CSVs

### Short-term
5. Fix absolute paths in `backfill-operator-roster.js` and `run-finetuned-canary-rollout.cjs`
6. Add `--dry-run` default and `--confirm` to destructive scripts
7. Upgrade `express` to 4.23.0+
8. Add `--redact-pii` flag to all report scripts
9. Fix `manual_match` FK contradiction (Schema-4)
10. Fix `operator_creator_roster` prefix unique key

### Medium-term
11. Implement `generation_log` cleanup/TTL
12. Replace `deasync` with Promise-based alternative
13. Add `engines` field to `package.json`
14. Add indexes on `sft_memory(created_date)` and `sync_log(synced_at)`
15. Add cursor pagination to `generate-events-from-chat.cjs`
16. Use `db.js` in `generate-events-from-chat.cjs`

### Long-term
17. Formal migration framework (not one-off `.js` scripts)
18. Integration tests for all migration scripts
19. Centralize destructive script patterns into shared library
20. Partition `generation_log` and `retrieval_snapshot` by date
