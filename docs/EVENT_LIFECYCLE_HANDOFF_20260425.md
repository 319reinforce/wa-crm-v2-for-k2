# Event/Lifecycle Data Model Handoff

Date: 2026-04-25
Branch context: local workspace
Status: Phase 1 compatibility hardening landed

## What Changed

### Documents

- Added PRD: `docs/EVENT_LIFECYCLE_DATA_PRD_20260425.md`
- Added read-only production audit SQL: `docs/sql/event_lifecycle_audit_20260425.sql`
- Added additive migration draft: `server/migrations/004_event_lifecycle_fact_model.sql`
- Updated fresh-install schema: `schema.sql`

### Code

- Added shared event fact helper: `server/services/eventLifecycleFacts.js`
- Lifecycle evaluation now uses the same canonical/evidence filter in:
  - `server/services/lifecycleService.js`
  - `server/services/lifecyclePersistenceService.js`
  - `server/services/replyStrategyService.js`
  - `server/routes/creators.js`
- Creator list lifecycle reads now fetch and parse `events.meta`; weak or generated rows no longer become strong facts just because a list path omitted metadata.
- Stats route now returns explicit event metric bases:
  - `total_events`
  - `total_canonical_events`
  - `total_lifecycle_driving_events`
  - `yesterday_detected_events`
  - `yesterday_business_events`
  - `yesterday_confirmed_events`
  - `yesterday_new_events` remains an alias for detected events for UI compatibility.
- Events list supports optional `scope`:
  - `scope=all`
  - `scope=canonical`
  - `scope=generated`
  - `scope=lifecycle`

### Tests

- Added `tests/eventLifecycleFacts.test.mjs`
- Ran focused unit tests successfully:
  - `tests/eventLifecycleFacts.test.mjs`
  - `tests/lifecycleService.test.mjs`
  - `tests/creatorListFields.test.mjs`

## Production Audit Result

The read-only SQL was executed against local MySQL using project `.env` settings.

Output file:

- `/tmp/event_lifecycle_audit_20260425.out`

High-signal findings:

- `events` total rows: 1622
- Canonical event rows: 277
  - active: 111
  - completed: 130
  - draft: 36
- Generated/dynamic rows: 1326
  - active: 54
  - completed: 1272
- Missing explicit evidence tier: 1622 rows
- Active/completed challenge rows without `event_periods`: 105
- Stored lifecycle snapshots with conflicts: 20
- Yesterday metrics from audit:
  - detected: 0
  - business: 0
  - confirmed: 0

Interpretation:

- The screenshot showing `昨日新增事件数 = 0` is consistent with current data. The bigger issue is not the zero itself; the issue is that the UI only shows one ambiguous metric.
- Most rows are generated/imported touchpoints, so total event counts are currently not a reliable business KPI without `scope`.
- The evidence migration is still pending; the current code keeps legacy canonical rows as a transitional fallback, while blocking explicit weak Tier 0/1 and generated rows.

## Important Design Decisions

1. `events` remains backward compatible. Existing `status` and `meta` are still supported.
2. New schema is additive. No destructive migration was introduced.
3. `joinbrands_link.ev_*` is not removed. It remains a compatibility cache, but the PRD defines a path to make event facts the write source.
4. Lifecycle main stage only consumes canonical active/completed events allowed by `canEventDriveLifecycle()`.
5. Evidence Tier 0/1 rows do not drive lifecycle when evidence metadata exists.
6. Legacy canonical rows with no evidence metadata are still accepted during transition to avoid suddenly erasing existing lifecycle state.

## Follow-Up Work

### Next Code Changes

- Add a safe migration runner or manual migration runbook for `004_event_lifecycle_fact_model.sql`.
- Backfill `events.evidence_tier`, `source_kind`, `review_state`, `canonical_event_key`, and `lifecycle_effect` from existing `meta`.
- Materialize `event_evidence` from existing `meta.source_anchor` and `meta.verification`.
- Build `creator_event_snapshot` and start moving frontend event filters away from `joinbrands_link.ev_*`.
- Rename UI metric labels so `昨日新增事件数` becomes separate detected/business/confirmed counters.

### Data Cleanup

- Review 105 active/completed challenge rows without period evidence.
- Review 54 active generated/dynamic rows and confirm they are display-only.
- Build a 30-case lifecycle truth set before tightening the legacy fallback for missing evidence tiers.
- Decide whether imported `v1_import` agency rows should be Tier 1 or operator-confirmed Tier 2.

## Validation

Commands run:

```bash
node --check server/services/eventLifecycleFacts.js
node --check server/services/lifecycleService.js
node --check server/routes/stats.js
node --check server/routes/events.js
node --check server/routes/creators.js
node --test tests/eventLifecycleFacts.test.mjs tests/lifecycleService.test.mjs tests/creatorListFields.test.mjs
node scripts/test-event-lifecycle-top-creators.cjs --no-llm --creator-limit=3 --max-llm-messages-per-creator=12 --output=reports/event-lifecycle-top-creators-20260425-local.json
```

Focused tests passed: 25/25.

The first MySQL CLI attempt failed because the CLI was run without password. The Node audit runner succeeded using `.env` and only executed read-only queries.

## Top-Message Creator Event Logic Test

User request on 2026-04-25: rerun the event logic against the three existing creators with the most messages.

Selected creators:

| Creator ID | Name | Owner | Message Count | Current Lifecycle |
| --- | --- | --- | ---: | --- |
| 1072 | Noelia(elkingdomi1) | Yiyun | 508 | revenue |
| 1148 | Anjale(bosslady023) | Yiyun | 499 | retention |
| 1087 | Jessica(614jessicam) | Yiyun | 493 | revenue |

Local dry-run output:

- `reports/event-lifecycle-top-creators-20260425-local.json`

What the local dry-run did:

- Read all messages for each selected creator.
- Scanned the full message set for event recall keywords.
- Picked high-signal messages for candidate replay.
- Generated keyword-only draft candidates with Tier 0 evidence and `weak_event_evidence` overlay.
- Compared existing event rows against `canEventDriveLifecycle()`.
- Evaluated current lifecycle state without writing database changes.

Results:

| Creator ID | Existing Events | Existing Lifecycle-Driving Events | Local Draft Candidates | Notes |
| --- | ---: | ---: | ---: | --- |
| 1072 | 4 | 3 | 22 | Existing generated violation row did not drive lifecycle. |
| 1148 | 3 | 2 | 19 | Existing generated violation row did not drive lifecycle. |
| 1087 | 5 | 4 | 20 | Existing generated violation row did not drive lifecycle. |

Safety note:

- A MiniMax dry-run was attempted for the same three creators, but the approval reviewer rejected it because it would send private CRM message content to an external API without explicit user authorization.
- No workaround was used. The committed report is local-only and read-only.
- To run the external MiniMax version, the user must explicitly authorize sending private CRM message content for these creators to MiniMax.

## Obsidian Sync

- Status: synced
- Note: `docs/obsidian/notes/2026-04-25-event-lifecycle-handoff.md`
- Related note: `docs/obsidian/notes/2026-04-25-event-lifecycle-data-model.md`
- Index: `docs/obsidian/index.md`
