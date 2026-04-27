# Active Event Detection Handoff

Date: 2026-04-26
Status: Implemented locally, pending production rollout
Owner: WA CRM maintainers

## Summary

The 2026-04-16 event-recognition cutoff was caused by the event system relying on manual/historical imports instead of a continuously queued detector. Existing routes could classify one text snippet, and historical scripts could backfill old data, but new WhatsApp messages and message-supplement jobs did not automatically enqueue lifecycle/event recognition work.

This handoff introduces an active event-detection queue:

- New messages and message supplements enqueue the creator for detection.
- Manual/API/script dry-runs can inspect candidates without mutating cursors.
- Write-mode candidates are inserted as draft, unreviewed, non-lifecycle-driving events.
- Event display now prefers business/source time before import/detection time, so imported 2026-04-16 rows do not visually look like event starts.

## Implemented Files

| File | Change |
| --- | --- |
| `server/services/activeEventDetectionService.js` | Queue schema, enqueue helpers, keyword/MiniMax provider processing, candidate normalization, draft insert, cursor/run tracking. |
| `server/migrations/005_active_event_detection_queue.sql` | Adds `event_detection_cursor` and `event_detection_runs`. |
| `schema.sql` | Adds active detection tables to the main schema. |
| `server/index.cjs` | Ensures active detection schema at startup. |
| `server/routes/events.js` | Adds `/api/events/detection/cursors`, `/api/events/detection/enqueue`, `/api/events/detection/run`; updates event display time priority. |
| `server/services/directMessagePersistenceService.js` | Enqueues after direct message persistence and message backfill inserts. |
| `server/services/waMessageRepairService.js` | Enqueues after message supplement/reconcile/replace inserts. |
| `server/waWorker.js` | Enqueues after WA worker batch inserts. |
| `db.js` | Enqueues from legacy message insert paths. |
| `scripts/run-active-event-detection.cjs` | CLI for enqueueing, dry-run scanning, and write-mode processing. |

## Runtime Model

### Tables

`event_detection_cursor`

- One row per creator.
- Tracks queue status, pending reason, pending start point, last scanned message, last run, and errors.
- Used by supplement jobs and active detection workers.

`event_detection_runs`

- One row per detection attempt.
- Tracks provider, dry-run/write mode, scan window, scanned message count, candidate count, write count, skip count, and errors.
- Safe to keep for audit and rollout debugging.

### Provider Modes

`keyword`

- Local deterministic recall using `EVENT_RECALL_KEYWORDS`.
- No external data leaves the environment.
- Produces weak Tier 0 draft candidates by default.

`minimax` / `llm`

- Uses the existing `detectEventsWithMiniMax` path.
- Requires `MINIMAX_API_KEY`.
- Should only be enabled after operator authorization because CRM message context is sent to MiniMax.

## API

### Inspect cursors

```http
GET /api/events/detection/cursors?status=pending&limit=50
```

### Enqueue one creator

```http
POST /api/events/detection/enqueue
{
  "creator_id": 1087,
  "since": "2026-04-16T00:00:00+08:00",
  "reason": "manual_enqueue"
}
```

### Enqueue creators with new messages

```http
POST /api/events/detection/enqueue
{
  "owner": "Beau",
  "since": "2026-04-16T00:00:00+08:00",
  "limit": 100,
  "reason": "message_supplement_scan"
}
```

### Dry-run detection

```http
POST /api/events/detection/run
{
  "creator_id": 1087,
  "provider": "keyword",
  "since": "2026-04-16T00:00:00+08:00",
  "message_limit": 120,
  "write": false
}
```

Dry-run writes an `event_detection_runs` audit row but does not advance `event_detection_cursor`.

### Write-mode detection

```http
POST /api/events/detection/run
{
  "creator_id": 1087,
  "provider": "keyword",
  "since": "2026-04-16T00:00:00+08:00",
  "message_limit": 120,
  "write": true
}
```

Write-mode inserts candidates as:

- `status = draft`
- `event_state = candidate`
- `review_state = unreviewed`
- `evidence_tier = 0` unless provider evidence says otherwise
- `lifecycle_effect = none`

These rows must be promoted by manual/evidence review before they can drive lifecycle state.

## CLI

Dry-run one creator:

```bash
node scripts/run-active-event-detection.cjs \
  --creator=1087 \
  --since=2026-04-16T00:00:00+08:00 \
  --provider=keyword \
  --message-limit=120
```

Enqueue creators with new messages:

```bash
node scripts/run-active-event-detection.cjs \
  --enqueue-new \
  --owner=Beau \
  --since=2026-04-16T00:00:00+08:00 \
  --limit=100
```

Process pending queue in dry-run:

```bash
node scripts/run-active-event-detection.cjs \
  --process-pending \
  --provider=keyword \
  --limit=20
```

Process pending queue in write mode:

```bash
node scripts/run-active-event-detection.cjs \
  --process-pending \
  --provider=keyword \
  --write \
  --limit=20
```

## Local Audit Results

The local configured MySQL database shows:

- `events.total = 1622`
- latest event import/create timestamp: `2026-04-16T11:27:40.000Z`
- latest detected timestamp: `2026-04-16T03:27:40.000Z`
- `v1_import` rows on 2026-04-16: 1382
- latest local WhatsApp message timestamp: `1776471630000`
- `events` rows missing `start_at`: 0
- `events` rows missing `source_event_at`: 0

Conclusion: the visible 2026-04-16 recognition section is mainly an import/detection timestamp problem plus no continuous active detector. The data model already has `start_at`/`source_event_at`, but the UI/API display needed to prefer business/source time over import time.

## Two-Creator Dry-Run

Dry-runs used local keyword detection only, starting from `2026-04-16T00:00:00+08:00`.

| Creator | Local creator id | Scanned messages | Candidates | Written | Evidence |
| --- | ---: | ---: | ---: | ---: | --- |
| Noelia(elkingdomi1) | 1072 | 1 | 0 | 0 | Summary retained here; raw JSON removed from source control. |
| Jessica(614jessicam) | 1087 | 2 | 0 | 0 | Summary retained here; raw JSON removed from source control. |

Interpretation:

- The latest local post-2026-04-16 messages for these two creators did not match deterministic canonical-event recall keywords.
- Existing imported agency/legacy events remain compatibility events and should stay non-lifecycle-driving unless manually confirmed.
- Existing Tier 2 LLM events are plausible but need evidence review if they will be used for lifecycle movement.
- A MiniMax pass can provide better semantic judgement, but it requires explicit authorization and production/recent message access.

Molly Russell could not be verified locally because the local database has imported events but no raw WhatsApp messages for that creator.

## Can We See Remote Event Recognition Realtime?

Not automatically from this workspace.

The agent can see only:

- repository files,
- local runtime/API responses,
- whatever database/API the current `.env` points to,
- command output the user authorizes.

To inspect true production event recognition in realtime, provide one of:

- a readonly production or replica MySQL connection in `.env`,
- a VPN/tunnel/API endpoint that exposes production `/api/events` and detection cursors,
- exported anonymized rows for two creators with message windows, event rows, evidence rows, and snapshots.

Do not provide raw secrets in chat. Put credentials in local env files or a secret manager available to the runtime.

## What The User Needs To Do

1. Confirm whether the current local `.env` points to production, staging, or a local snapshot.
2. Pick two creator ids/names for production verification, or approve using the two local sampled creators above.
3. Authorize MiniMax semantic detection if the goal is correctness review beyond deterministic keyword recall.
4. Approve write-mode rollout only after dry-run reports are reviewed.
5. Decide whether active detection should run as an API-triggered batch first or as a scheduled worker later.

## Rollout Plan

1. Deploy schema migration and code.
2. Run `GET /api/events/detection/cursors` to confirm tables exist.
3. Dry-run a small owner-scoped batch with `provider=keyword`.
4. Review candidates and evidence.
5. Enable write mode for a small batch; candidates stay `draft` and `unreviewed`.
6. Run MiniMax only for selected creators/messages after authorization.
7. Promote confirmed candidates through the existing review UI/manual confirmation flow.
8. Add a scheduler/worker once batch behavior is stable.

## Verification

Commands run locally:

```bash
node --check scripts/run-active-event-detection.cjs
node --check server/services/activeEventDetectionService.js
node --check server/routes/events.js
node --check db.js
node --check server/services/directMessagePersistenceService.js
node --check server/services/waMessageRepairService.js
node scripts/run-active-event-detection.cjs --creator=1072 --since=2026-04-16T00:00:00+08:00 --provider=keyword --message-limit=120 --output=reports/active-event-detection-1072-keyword-20260426.json
node scripts/run-active-event-detection.cjs --creator=1087 --since=2026-04-16T00:00:00+08:00 --provider=keyword --message-limit=120 --output=reports/active-event-detection-1087-keyword-20260426.json
```

The two dry-run commands used the local configured MySQL database and did not write event candidates. The output paths are regeneration examples only; generated JSON should stay under ignored `reports/`.

## Known Caveats

- Dry-runs before the final script correction created local cursor rows for the two sampled creators. The current script no longer enqueues or advances cursors unless `--write`, `--advance-cursor`, or `--enqueue` is used.
- Keyword mode is intentionally conservative and will miss semantic events that do not contain recall keywords.
- MiniMax mode should be treated as a controlled rollout because it sends message context to an external provider.
- New active candidates are intentionally non-driving until human/evidence review promotes them.

## Obsidian Sync

- Status: synced
- Note: `docs/obsidian/notes/2026-04-26-active-event-detection-handoff.md`
- Index: `docs/obsidian/index.md`
