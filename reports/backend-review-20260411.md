---
name: Backend Code Review Report
type: review
date: 2026-04-11
scope: server/
---

# Backend Code Review Report

**Date:** 2026-04-11
**Scope:** `server/` (all routes, services, middleware, workers, utils)
**Files Reviewed:** 28 source files + schema.sql + db.js

---

## 1. Executive Summary

| Severity | Count |
|----------|-------|
| Critical | 0 |
| High | 5 |
| Medium | 11 |
| Low / Observations | 15 |
| **Total Issues** | **31** |

| Category | Count |
|----------|-------|
| Security Findings | 7 |
| Performance Observations | 5 |
| Best Practices Violations | 6 |
| Positive Findings | 9 |
| Recommendations | 4 |

**Overall Assessment:** The codebase is in good shape. All SQL queries use parameterized statements. Auth guards are consistently applied. The main areas for improvement are: (1) missing operator-level authorization checks on sensitive routes, (2) `wa_phone` leaking into API responses, (3) significant code duplication across AI routing, memory extraction, and system prompt building, (4) missing composite database indexes, and (5) unbounded Map growth in caching.

---

## 2. Critical Issues

*None identified.*

---

## 3. High Issues

### H-1: `wa_phone` exposed in GET /api/events response
**File:** `server/routes/events.js:30`
```sql
SELECT e.*, c.primary_name as creator_name, c.wa_phone as creator_phone
```
The `wa_phone` field is selected and returned in the `GET /api/events` response (also at line 62 for `GET /api/events/:id`). **CLAUDE.md Rule Violated**

### H-2: `req.params.id` used in SQL without integer validation
**File:** `server/routes/events.js` (lines 41, 65, 148, 176, 252, 265, 270, 387, 392)
Multiple routes accept `req.params.id` from the URL path and use them directly in SQL without type coercion.

### H-3: `req.params.creatorId` used in SQL without validation
**File:** `server/routes/events.js:387`

### H-4: Unbounded Map growth in `canonicalCreatorResolver.js`
**File:** `server/services/canonicalCreatorResolver.js:6`
```js
const cacheByOperator = new Map();
```
Expired cache entries (30s TTL) are never removed. Map grows without bound over server lifetime.

### H-5: Silent audit log failure with no alerting
**File:** `server/middleware/audit.js:23-24`
Failed audit INSERTs are logged only to console with no monitoring/metrics.

---

## 4. Medium Issues

### M-1: Inline LIMIT/OFFSET — inconsistent pattern
**Files:** `messages.js:34`, `sft.js:179,423`, `audit.js:70,227`, `training.js:60`, `sftService.js:32`, `db.js:271`

### M-2: Missing composite database indexes

| Table | Missing Index | Query Pattern |
|-------|---------------|---------------|
| `events` | `(creator_id, status)` | Frequent in events.js |
| `events` | `(owner, status)` | events.js filter |
| `client_tags` | `(tag)` | Profile queries |
| `audit_log` | `(action, created_at)` | audit.js |
| `sft_feedback` | `(client_id, created_at)` | Feedback queries |

### M-3: No operator-level authorization on `/api/events` filtering
**File:** `server/routes/events.js:25-26`

### M-4: No operator-level authorization on audit/SFT routes
**Files:** `audit.js:252,364,464,493`

### M-5: Missing input validation on POST /api/events/detect
**File:** `server/routes/events.js:193-194` — `text` has no length limit.

### M-6: `getGroundingContext` fetches all active policies then filters in-memory
**File:** `server/services/retrievalService.js:61-68`

### M-7: Fragile parameter ordering in events list pagination
**File:** `server/routes/events.js:46-47`

### M-8: Redundant `resolveCanonicalCreator` call for known creators
**File:** `server/waWorker.js:329-342`

### M-9: No timeout on profile-agent fetch calls
**File:** `server/waWorker.js:360-368,447-455`

### M-10: `X-WA-Proxy-Bypass` header bypasses routing without auth
**File:** `server/services/waSessionRouter.js:117`

### M-11: `creator_id` ordering risk in params array
**File:** `server/routes/events.js:46`

---

## 5. Low Issues / Observations

### L-1: `creator_name` may be NULL in events responses (left join edge case)
### L-2: `normalizeOwner` duplicates `normalizeOperatorName`
**File:** `server/routes/events.js:13-17`
### L-3: `_pendingRefresh` Map — no size cap
**File:** `server/services/profileService.js:8`
### L-4: `toTimestampMs` duplicated across 4 files
**Files:** `messages.js:12`, `waWorker.js:58`, `creatorEligibilityService.js:27`, `db.js:53`
### L-5: `parseJsonSafe` duplicated across 5 files
**Files:** `audit.js:9`, `profile.js:15`, `retrievalService.js:9`, `experience.js:14`, `sftService.js:23`
### L-6: Response text extraction duplicated
`server/routes/ai.js:41-71` vs `server/services/memoryExtractionService.js:143-181`
### L-7: `maskClientId` duplicated
`server/routes/ai.js:102-108` vs `server/services/memoryExtractionService.js:34-40`
### L-8: Duplicate `getOrCreateCreator` call in realtime handler
**File:** `server/waWorker.js:341`
### L-9: Hardcoded Feishu chat ID
**File:** `server/workers/trainingWorker.js:24`
### L-10: `execSync` in async function
**File:** `server/workers/trainingWorker.js:187`
### L-11: `getPolicy` relies on MySQL driver JSON parsing
**File:** `server/utils/policyMatcher.js:11-12`
### L-12: SFT CRUD duplicated between routes and service
### L-13: Fragile `[BASE_PROMPT]` string substitution
**File:** `server/routes/experience.js:45`
### L-14: `hasRosterAssignments()` on every creators list request
**File:** `server/routes/creators.js:23`
### L-15: `compileSystemPrompt` duplicated
`routes/experience.js` vs `systemPromptBuilder.cjs`

---

## 6. Security Findings

| ID | Severity | File | Description |
|----|----------|------|-------------|
| S-1 | Medium | `events.js:30,62` | `wa_phone` in API responses (CLAUDE.md violation) |
| S-2 | Medium | `waSessionRouter.js:117` | `X-WA-Proxy-Bypass` bypasses routing without token |
| S-3 | Medium | `events.js:25`, `audit.js` | No operator-level data isolation |
| S-4 | Info | Multiple | No startup validation for required API keys |
| S-5 | Low | `middleware/appAuth.js:34-39` | Auth bypass in non-production |
| S-6 | Medium | `creators.js:176` | `wa_phone` potentially in audit log |
| S-7 | Low | All routes | No rate limiting on AI API endpoints |

---

## 7. Performance Observations

| ID | File | Description |
|----|------|-------------|
| P-1 | `creators.js:23` | `hasRosterAssignments()` on every list request |
| P-2 | `retrievalService.js:61` | Fetches all policies then filters in memory |
| P-3 | `waWorker.js:341` | Redundant resolveCanonicalCreator for known creators |
| P-4 | `canonicalCreatorResolver.js:183` | GROUP_CONCAT on every cache miss |
| P-5 | `sftService.js:195-230` | Sequential queries in getSftMemoryTrends |

---

## 8. Best Practices Violations

- B-1: `toTimestampMs` — 4 implementations
- B-2: `parseJsonSafe` — 5 implementations
- B-3: SFT CRUD duplicated
- B-4: `compileSystemPrompt` duplicated
- B-5: Inline vs parameterized LIMIT/OFFSET inconsistency
- B-6: `wa_phone` in audit log

---

## 9. Positive Findings

1. **All SQL queries use prepared statements** — no raw SQL concatenation.
2. **`writeAudit` consistently applied** — centralized audit logging.
3. **No hardcoded secrets** — all API keys from `process.env`.
4. **`normalizeOperatorName` is comprehensive** — phone-based resolution, aliases, roster matching.
5. **Graceful error handling** — all async handlers have try/catch.
6. **Auth guards consistently applied** — `requireAppAuth` wraps all sensitive routes.
7. **`AbortSignal.timeout` on most external fetch calls**.
8. **`dedupCache` prevents duplicate message processing**.
9. **Transaction-based creator merge** with proper rollback.

---

## 10. Recommendations

**REC-1:** Consolidate duplicate utilities → `server/utils/time.js`, `server/utils/json.js`, `server/utils/masking.js`
**REC-2:** Add `requireOperatorAuth` middleware for events and audit routes
**REC-3:** Add startup validation for required env vars in `server/index.cjs`
**REC-4:** Unify `compileSystemPrompt` between `experience.js` and `systemPromptBuilder.cjs`
