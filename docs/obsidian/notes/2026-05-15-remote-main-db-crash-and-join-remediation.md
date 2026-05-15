---
title: Remote Main DB Crash And JOIN Remediation
date: 2026-05-15
project: wa-crm-v2
type: runbook
source_path: docs/REMOTE_MAIN_DB_CRASH_AND_JOIN_RULE_ANALYSIS_20260515.md
status: implemented
tags:
  - wa-crm-v2
  - database
  - migrations
  - join-policy
  - rollout
related:
  - docs/JOIN_FREE_DB_REMEDIATION_CONSTRUCTION_PLAN_20260515.md
  - scripts/run-startup-migrations.cjs
  - server/routes/audit.js
rollout: code-remediation-implemented
---

# Remote Main DB Crash And JOIN Remediation

## Summary

The latest observed remote `origin/main` head was `7f18918`, a deploy tag update to image `20260509-3608d96`. The code-bearing merge behind it was `3608d96`, from `6a8ba49 chore: complete tech debt remediation phases 1-5`. The deploy tag likely triggered container startup migrations, while the merge introduced new business-query `LEFT JOIN` usage in `server/routes/audit.js`.

## Key Decisions

- Treat `7f18918` as the rollout trigger and `6a8ba49` as the code-change source.
- Do not special-case `LEFT JOIN`; it is covered by the no-new-business-JOIN rule.
- Refactor newly introduced audit summary joins into single-table queries plus application-layer `Map` merges.
- Keep startup migrations fail-closed, but rehearse the same migration list before production image tags are advanced.
- Add a static no-new-business-JOIN test for runtime route/service files.

## Source Documents

- `docs/REMOTE_MAIN_DB_CRASH_AND_JOIN_RULE_ANALYSIS_20260515.md`
- `docs/JOIN_FREE_DB_REMEDIATION_CONSTRUCTION_PLAN_20260515.md`

## Verification Notes

- Static inspection confirmed `7f18918` only changed `deploy/values-prod.yaml`.
- Static inspection confirmed `6a8ba49` did not change `schema.sql` or `scripts/run-startup-migrations.cjs`.
- New business `LEFT JOIN` usage was found in `server/routes/audit.js` aggregate summary functions.
- Startup path still runs `node scripts/run-startup-migrations.cjs` before server start.
- Implemented remediation removes the new JOINs from `buildAbEvaluationSummary()` and `buildGenerationStatsSummary()`.
- Added audit route tests for application-layer LEFT merge semantics and owner filtering.
- Added `tests/noNewBusinessJoin.test.mjs` to guard runtime business files against unreviewed new JOINs.
- Verification passed:
  - `node --check server/routes/audit.js`
  - `node --test tests/auditRoutes.test.mjs`
  - `node --test tests/noNewBusinessJoin.test.mjs`

## Follow-Up Items

- Add pre-deploy startup migration rehearsal against staging/schema clone.
