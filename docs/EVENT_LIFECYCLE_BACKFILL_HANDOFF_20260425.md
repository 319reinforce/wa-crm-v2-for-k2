# Event Lifecycle Backfill Handoff

Date: 2026-04-25
Scope: event data model Phase 1, local DB backfill, front-end metric split, V1 layout document compatibility check

## Summary

This session continued the event/lifecycle optimization work and completed the local event fact backfill.

Repository artifacts added or updated:

- `docs/EVENT_LIFECYCLE_DATA_PRD_20260425.md`
- `docs/archive/handoffs/EVENT_LIFECYCLE_HANDOFF_20260425.md`
- `docs/EVENT_LIFECYCLE_BACKFILL_HANDOFF_20260425.md`
- `docs/sql/event_lifecycle_audit_20260425.sql`
- `server/migrations/004_event_lifecycle_fact_model.sql`
- `schema.sql`
- `server/services/eventLifecycleFacts.js`
- `server/services/creatorEventSnapshotService.js`
- `server/routes/stats.js`
- `server/routes/events.js`
- `server/routes/creators.js`
- `server/services/lifecycleService.js`
- `server/services/lifecyclePersistenceService.js`
- `server/services/replyStrategyService.js`
- `src/App.jsx`
- `src/components/EventPanel.jsx`
- `scripts/audit-tier2-compat-events.cjs`
- `scripts/backfill-event-lifecycle-facts.cjs`
- `scripts/test-event-lifecycle-top-creators.cjs`
- `tests/eventLifecycleFacts.test.mjs`
- `reports/event-lifecycle-top-creators-20260425-local.json`
- `reports/event-lifecycle-top-creators-20260425-minimax.json`
- `reports/tier2-compat-event-audit-20260425.json`

Compatibility note:

- Rebasing onto latest `origin/main` (`bbccdab`) succeeded on 2026-04-25.
- Git skipped the previous local `dac1f9f` commit because the same patch already exists upstream as `a69edc4`.

## Key Data Model Decision

The backfill intentionally preserves current production lifecycle behavior for legacy canonical events.

Reason:

- Before this migration, canonical `active` / `completed` events without evidence metadata were already consumed by lifecycle logic as transitional fallback.
- If the backfill wrote those rows as Tier 0 or Tier 1, many lifecycle stages would suddenly move backward.

Backfill rule:

- Canonical `active` / `completed` rows become Tier 2 unless an explicit tier already exists.
- Generated/dynamic rows become Tier 0 and `lifecycle_effect='none'`.
- Draft canonical rows become Tier 0 and stay non-driving.
- `referral`, `recall_pending`, and `second_touch` use `lifecycle_effect='overlay'`.
- Mainline canonical keys use `lifecycle_effect='stage_signal'`.

This is a compatibility bridge, not final evidence review. The next cleanup phase should review legacy Tier 2 rows and downgrade rows that cannot be verified.

## Backfill Execution

Command:

```bash
node scripts/backfill-event-lifecycle-facts.cjs --write
```

Result:

- Added missing `events` columns:
  - `canonical_event_key`
  - `event_state`
  - `review_state`
  - `evidence_tier`
  - `source_kind`
  - `source_event_at`
  - `detected_at`
  - `verified_at`
  - `verified_by`
  - `idempotency_key`
  - `lifecycle_effect`
  - `expires_at`
- Seeded 10 `event_definitions`.
- Scanned 1622 `events` rows.
- Updated 1622 `events` rows.
- Inserted 1622 `event_evidence` rows.
- Upserted 279 `creator_event_snapshot` rows.

Idempotency check:

```bash
node scripts/backfill-event-lifecycle-facts.cjs
```

Result:

- `events_to_update: 0`
- `evidence_to_insert: 0`
- `creator_snapshots_planned: 279`

## Post-Backfill Verification

Read-only DB verification:

- `events.total`: 1622
- `events.canonical_event_key IS NOT NULL`: 277
- `events.evidence_tier IS NULL`: 0
- `events.lifecycle_effect='none'`: 1345
- `event_evidence.total`: 1622
- `creator_event_snapshot.total`: 279
- `event_definitions.total`: 10

Tier/effect distribution:

- Tier 0, migration, none: 1326
- Tier 2, llm, stage_signal: 152
- Tier 2, migration, stage_signal: 52
- Tier 2, llm, overlay: 36
- Tier 0, llm, stage_signal: 30
- Tier 0, llm, none: 19
- Tier 0, llm, overlay: 3
- Tier 0, migration, stage_signal: 3
- Tier 2, migration, confirmed, stage_signal: 1

Updated helper stats from local DB:

```json
{
  "total_events": 1622,
  "total_canonical_events": 277,
  "total_lifecycle_driving_events": 241,
  "yesterday_detected_events": 0,
  "yesterday_business_events": 0,
  "yesterday_confirmed_events": 0
}
```

Post-backfill audit output:

- `/tmp/event_lifecycle_audit_20260425_post_backfill.out`

## Front-End Metric Split

Updated `src/App.jsx`.

Previous UI:

- `昨日新增事件数`
- `昨日最新事件数`

New UI:

- Left footer card: `昨日业务事件`
- Workspace cards:
  - `事件总数`
  - subline: `标准 N · 可驱动 N`
  - `昨日识别事件`
  - `昨日业务事件`
  - `昨日确认事件`

Compatibility:

- The front end still falls back to `stats.yesterday_new_events` if new fields are not present.
- `server/routes/stats.js` still returns `yesterday_new_events` as an alias for `yesterday_detected_events`.

## Top-Message Creator Rerun

Script:

```bash
node scripts/test-event-lifecycle-top-creators.cjs --no-llm --creator-limit=3 --max-llm-messages-per-creator=12 --output=reports/event-lifecycle-top-creators-20260425-local.json
```

Selected creators:

| Creator ID | Name | Owner | Message Count | Current Lifecycle |
| --- | --- | --- | ---: | --- |
| 1072 | Noelia(elkingdomi1) | Yiyun | 508 | revenue |
| 1148 | Anjale(bosslady023) | Yiyun | 499 | retention |
| 1087 | Jessica(614jessicam) | Yiyun | 493 | revenue |

Local-only result:

| Creator ID | Existing Events | Existing Lifecycle-Driving Events | Local Draft Candidates |
| --- | ---: | ---: | ---: |
| 1072 | 4 | 3 | 22 |
| 1148 | 3 | 2 | 19 |
| 1087 | 5 | 4 | 20 |

Notes:

- The test scans all messages locally.
- Keyword candidates are Tier 0 draft candidates with `weak_event_evidence`.
- Generated violation rows stayed non-driving for all three creators.
- External MiniMax dry-run was initially held until explicit authorization. It was executed later in this session; see "MiniMax Authorized Dry-Run" below.

## V1 Layout Documents

Files checked:

- `docs/archive/handoffs/V1_LAYOUT_HANDOFF_20260425.md`
- `docs/archive/handoffs/V1_LAYOUT_FOLLOWUP_HANDOFF_20260425.md`

Remote conflict check:

- Ran `git fetch --all --prune`.
- `origin/main` advanced to `bbccdab`.
- `origin/main` does not contain either `docs/V1_LAYOUT_*` file.
- No same-path conflict exists.

Compatibility/content check:

- The V1 layout docs describe changes in the latest layout follow-up commit (`fa75ec7`), including `src/App.jsx`, `src/components/CreatorDetail.jsx`, `src/components/AIReplyPicker.jsx`, `src/components/WAMessageComposer.jsx`, `public/v1/index.html`, and `server/routes/v1Board.js`.
- The docs are handoff-only and do not affect runtime.
- They are safe to keep as local-leading documentation if this branch will preserve session handoffs.
- User requested both files be submitted with this branch, so they are included in the final change set.

## Latest Follow-Up Changes

### Tier 2 Compatibility Audit And Downgrade

Scripts:

```bash
node scripts/audit-tier2-compat-events.cjs
node scripts/audit-tier2-compat-events.cjs --write
```

Report:

- `reports/tier2-compat-event-audit-20260425.json`

Decision:

- LLM-origin Tier 2 rows were kept because they have stored source quotes.
- Legacy `v1_import` / `migration` / `agency_bound` rows were downgraded when the only quote was `legacy agency binding` and there was no source message anchor.

Write result:

- Downgraded 52 historical compatibility rows.
- New values: `evidence_tier=1`, `review_state=uncertain`, `lifecycle_effect=none`, `source_kind=migration_review`.
- Rebuilt 52 `creator_event_snapshot` rows.
- Recomputed lifecycle snapshots for 52 affected creators.
- 14 creators changed lifecycle stage after downgrade; reply strategy was rebuilt for those 14.

Scoped post-write verification:

```json
{
  "tier2_plus": "0",
  "downgraded": "52"
}
```

### Creator Event Snapshot As Primary Filter Source

Backend:

- Added `server/services/creatorEventSnapshotService.js`.
- `GET /api/creators` now loads `creator_event_snapshot` for listed creators.
- The `event` query filter reads snapshot-derived `compat_ev_flags` first and falls back to legacy `joinbrands_link.ev_*`.

Frontend:

- `src/App.jsx` now normalizes `event_snapshot`.
- Local event filters and list flags read `event_snapshot.compat_ev_flags` first and fall back to `joinbrands`.

### Evidence And Human Review UI

Backend:

- Event APIs now include stored `event_evidence` rows.
- `PATCH /api/events/:id` accepts `review_state`, `evidence_tier`, `source_kind`, and `lifecycle_effect`.
- Manual confirmation sets `verified_at/verified_by` if needed, updates `event_state`, and rebuilds the creator event snapshot.

Frontend:

- `src/components/EventPanel.jsx` now displays review state, evidence tier, source kind, canonical event key, lifecycle effect, and stored evidence rows.
- Tier 0 draft events now have explicit review actions:
  - confirm: `active + confirmed + Tier 2`
  - evidence insufficient: `uncertain + Tier 1 + none`
  - reject: `cancelled + rejected + Tier 0 + none`

### MiniMax Authorized Dry-Run

User authorized sending private CRM message snippets to MiniMax for a dry-run test of the top three message-heavy creators.

Command:

```bash
node scripts/test-event-lifecycle-top-creators.cjs --creator-limit=3 --max-llm-messages-per-creator=8 --output=reports/event-lifecycle-top-creators-20260425-minimax.json
```

Result summary:

| Creator ID | Messages | Selected Messages | Candidates | Errors | Current Lifecycle |
| --- | ---: | ---: | ---: | ---: | --- |
| 1072 | 508 | 8 | 4 | 4 | revenue |
| 1148 | 499 | 7 | 4 | 1 | retention |
| 1087 | 493 | 8 | 2 | 2 | revenue |

Notes:

- This was dry-run only and did not write new production events.
- MiniMax returned usable candidates but also had several per-message failures.
- Future MiniMax imports should keep the review gate: Tier 0/1 candidates remain non-driving until human confirmation or stronger evidence.

## Validation

Passed:

```bash
node --check scripts/backfill-event-lifecycle-facts.cjs
node --check scripts/test-event-lifecycle-top-creators.cjs
node --check scripts/audit-tier2-compat-events.cjs
node --check server/services/creatorEventSnapshotService.js
node --check server/routes/stats.js
node --check server/routes/creators.js
node --check server/services/lifecyclePersistenceService.js
node --check server/services/replyStrategyService.js
node --test tests/eventLifecycleFacts.test.mjs tests/lifecycleService.test.mjs tests/creatorListFields.test.mjs
npm run build
git diff --check
```

Focused tests passed: 25/25.

Known unrelated failure:

- `npm run test:unit` still fails on `tests/unit/operatorOwnersEqual.unit.test.mjs`.
- Failure: `normalizeOperatorName` returns `Jiawei`, test expects `jiawei`.
- This is unrelated to event/lifecycle changes and was not modified.

## Remaining Work

- Run a browser smoke test for the EventPanel review UI after the dev server is available.
- Decide whether MiniMax dry-run errors are acceptable or need provider-level retry/timeout handling.
- Move future manual `ev_*` writes to event-first writes plus snapshot rebuild.
- Add persisted audit rows for bulk Tier 2 downgrade if compliance requires operator-visible history beyond the JSON report.

## Obsidian Sync

- Status: synced
- Note: `docs/obsidian/notes/2026-04-25-event-lifecycle-backfill-handoff.md`
- Related notes:
  - `docs/obsidian/notes/2026-04-25-event-lifecycle-data-model.md`
  - `docs/obsidian/notes/2026-04-25-event-lifecycle-handoff.md`
- Index: `docs/obsidian/index.md`
