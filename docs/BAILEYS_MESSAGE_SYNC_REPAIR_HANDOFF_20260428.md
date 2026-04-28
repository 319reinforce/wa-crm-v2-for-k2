# Baileys Message Sync And Repair Handoff

Date: 2026-04-28
Status: Active
Scope: Baileys long-connection message sync, roster backfill observability, LID mapping persistence, and message repair compatibility
Related PR: Gitea `#92` (`fix(wa): harden Baileys message sync and repair`)

## Summary

WA CRM v2 now treats Baileys as the forward message ingestion path. The previous WWeb/Chrome polling behavior is not used as a hidden fallback for Baileys accounts. Instead, Baileys ingestion is explicit and observable:

- live messages are persisted from the Baileys WebSocket event stream.
- Baileys `messaging-history.set` batches are normalized and inserted through the worker.
- roster creators without a Baileys-keyed anchor are reported instead of silently skipped.
- LID to phone-number JID mappings are persisted across restarts.
- the existing message repair path can use Baileys ring-buffer/history audit output without relying on WWeb chat APIs.

The production symptom behind this work was that after QR login and driver switch, some creators appeared stale in CRM even though new WhatsApp Web messages existed. The key root cause is that Baileys does not provide the same Chrome-side chat polling surface that WWeb had. A creator with only legacy WWeb messages has no Baileys anchor key that can safely seed `fetchMessageHistory`, so the system must surface that state as a readiness/backfill report.

## Runtime Decisions

### No WWeb Polling Fallback In Baileys Mode

When a session is running with `driver = baileys`, the worker receives messages from Baileys events. It does not fall back to WWeb `chat.fetchMessages()` or a Chrome polling pass.

Reason:

- WWeb message ids and Baileys message keys are not interchangeable.
- Using a WWeb id as a Baileys history anchor can produce no history, unusable history, or a stalled request.
- The target architecture is Baileys-only, so missing Baileys data must be observable rather than masked by Chrome.

### Baileys Anchor Rule

A roster creator is considered history-backfill ready only when `wa_messages` contains at least one row for that creator with:

- `proto_driver = 'baileys'`
- non-empty `wa_message_id`

That row provides the Baileys message key used by `driver.fetchMessageHistory()`. If no such row exists, the worker checks the Baileys in-memory ring buffer and then writes the creator into the no-anchor report.

### Persistent LID Mapping

Baileys may surface contacts as `@lid` aliases instead of phone-number JIDs. The implementation now persists learned LID to PN mappings in `wa_lid_mappings`.

Primary artifacts:

- `server/migrations/014_baileys_lid_mapping.sql`
- `migrate-wa-lid-mappings.js`
- `server/services/waLidMappingService.js`
- `server/services/wa/driver/baileysDriver.js`
- `schema.sql`

The mapping service stores session, operator, LID JID, PN JID, phone, confidence, source, and first/last seen timestamps. Reports and logs use masked phone values and hashes instead of raw phone output.

## Backfill And Observability

The Baileys worker now has a periodic backfill/report loop.

Default behavior:

- first run after startup: 30 seconds.
- interval: `WA_BAILEYS_BACKFILL_INTERVAL_MS`, default `10` minutes.
- disabled when `WA_BAILEYS_BACKFILL_INTERVAL_MS=0`.
- report directory: `WA_BAILEYS_BACKFILL_REPORT_DIR`, default `data/runtime-state/wa-backfill-reports`.
- latest report file: `<WA_SESSION_ID>-latest.json`.

Report categories:

- `anchor_triggered`: creator had a Baileys anchor and `fetchMessageHistory` was requested.
- `no_anchor`: creator could not be history-fetched because no Baileys anchor exists.
- `buffer_checked`: creator without an anchor was checked against the Baileys ring buffer.
- `buffer_inserted`: buffered messages were inserted and may create the first anchor.
- `skipped_recent`: latest Baileys anchor is recent enough that no gap fill was requested.
- `failed`: fetch or buffer processing failed.

Perf/log events to watch:

- `wa_baileys_backfill_report`
- `wa_baileys_backfill_skipped`
- `wa_gap_fill_requested`
- `wa_history_batch_persisted`
- `wa_unresolved_lid_message_skipped`

## Readiness CLI

Use the readiness report CLI before and after switching an owner to Baileys:

```bash
node scripts/report-baileys-backfill-readiness.cjs --owner=Yiyun --limit=50
```

Useful options:

- `--owner=<operator>` filters to one operator roster.
- `--limit=<n>` controls displayed non-ready rows.
- `--include-ok` includes ready rows that already have a Baileys anchor.
- `--output=<path>` writes JSON to disk.

The CLI reports:

- total roster assignments.
- creators with and without Baileys anchors.
- creators with no messages.
- LID mapping counts by session/operator.
- per-row masked phone and phone hash.

Local verification during the implementation showed Yiyun had `42` primary roster creators and `0` Baileys anchors immediately after the switch, which explains why old WWeb-only histories could not be repaired by Baileys history fetch until a Baileys-keyed message was observed.

## Message Repair Compatibility

The prior WWeb repair behavior was ported to the Baileys path where Baileys can support it.

Key behavior:

- `server/agent/waAgent.js` has a Baileys audit path.
- Baileys audit first returns the driver's ring-buffer messages.
- If the DB has a Baileys anchor, audit can request `fetchMessageHistory()` and collect matching `history_set` messages for a bounded wait window.
- `server/services/waSessionRouter.js` returns `audit_source` metadata so callers can see whether audit data came from Baileys buffer/history.
- `server/services/waMessageRepairService.js` preserves native `message_id`, `proto_driver`, and metadata when reconciling raw audit messages.

Environment knobs:

- `WA_BAILEYS_AUDIT_HISTORY_WAIT_MS`, default `8000`.
- `WA_BAILEYS_AUDIT_HISTORY_IDLE_MS`, default `1500`.

Limit:

- if no Baileys anchor exists, Baileys repair is buffer-only and reports that state. It does not reach back through WWeb.

## Rollout Checklist

1. Deploy the schema and startup migration changes so `wa_lid_mappings` exists.
2. Run `node migrate-wa-lid-mappings.js` if applying migrations manually.
3. Confirm the target session is switched to `driver = baileys` and QR login is complete.
4. Run `node scripts/report-baileys-backfill-readiness.cjs --owner=<operator> --limit=50`.
5. Watch `data/runtime-state/wa-backfill-reports/<session>-latest.json` after the worker starts.
6. Send or receive at least one Baileys message for stale creators to create an anchor when possible.
7. Re-run the readiness CLI and confirm `with_baileys_anchor` increases.
8. Use repair/sync actions for creators with anchors; for no-anchor creators, rely on live Baileys events and the no-anchor report.

## Verification

Implementation verification before merge:

- `node --check` on the touched server/scripts files.
- `npm run test:unit`
- `npm run build`
- `git diff --check`
- `node scripts/report-baileys-backfill-readiness.cjs --owner=Yiyun --limit=3`

The unit suite passed with the known sandbox-only warning that Baileys LID mapping loading cannot connect to local MySQL in isolated test runs.

## Files Changed In PR 92

Primary runtime files:

- `server/services/wa/driver/baileysDriver.js`
- `server/waWorker.js`
- `server/agent/waAgent.js`
- `server/services/waMessageRepairService.js`
- `server/services/waSessionRouter.js`
- `server/services/waLidMappingService.js`

Migration and CLI files:

- `server/migrations/014_baileys_lid_mapping.sql`
- `migrate-wa-lid-mappings.js`
- `scripts/run-startup-migrations.cjs`
- `scripts/report-baileys-backfill-readiness.cjs`
- `schema.sql`
- `server/index.cjs`

Tests:

- `tests/waMessageRepairService.test.mjs`

## Known Boundaries

- No-anchor creators cannot be deep-fetched through Baileys until a Baileys-keyed message exists.
- In-memory ring buffer coverage only starts after the Baileys driver sees messages in the current process.
- WWeb remains in the codebase as legacy compatibility, but it should not be used to hide Baileys ingestion gaps.
- Runtime backfill report JSON belongs under ignored `data/runtime-state/`, not source control.

## Obsidian Sync

- Status: synced
- Note: `docs/obsidian/notes/2026-04-28-baileys-message-sync-repair-handoff.md`
- Index: `docs/obsidian/index.md`
