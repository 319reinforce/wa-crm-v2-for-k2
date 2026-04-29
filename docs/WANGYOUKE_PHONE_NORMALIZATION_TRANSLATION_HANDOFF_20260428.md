# WangYouKe Phone Normalization And Translation Handoff

Date: 2026-04-28
Status: Active, revised after #97 rollback review
Branch: `codex/youke-phone-normalization`
Commits: `16a91d8`, `43b9c02`, follow-up safety edits
Scope: WangYouKe creator phone normalization, in-system phone edits, Baileys history repair, and translation fallback repair

## Summary

This handoff records the fix for the WangYouKe import/sync issue and the chat translation issue.

Follow-up review found that running the WangYouKe rebuild from startup migrations by default is too risky for production because it can move messages, merge duplicate creators, and delete source creator rows during every container start. The safe direction is now: normalize phone values in normal create/edit/import paths, expose explicit Baileys history repair actions, and keep bulk rebuild scripts manual only.

The message sync root cause was phone identity format. WA CRM uses `creators.wa_phone` as the canonical WhatsApp contact key, and Baileys turns that value into a JID as:

```text
<digits>@s.whatsapp.net
```

Before this change, manual and bulk creator import only stripped non-digits. A US phone pasted as `(410) 801-0355` became `4108010355`, so Baileys queried `4108010355@s.whatsapp.net` instead of the real `14108010355@s.whatsapp.net`. That also allowed duplicate creators such as `4108010355` and `14108010355` to coexist.

The translation root cause was that the UI forced `provider: deepl`, while the server accepted unchanged provider output as a successful translation. In the observed case, the bubble-level translation rendered the original English under the message instead of a Chinese translation.

## Phone Identity Rules

Runtime identity now follows these rules:

- `creators.wa_phone` should be stored as digits only.
- US local 10-digit numbers are normalized to `1 + 10 digits`.
- Existing international prefixes are preserved, for example `86...` and `852...`.
- Lookup treats `4108010355` and `14108010355` as the same US number variant.
- Baileys JID creation also normalizes 10-digit US numbers to `1 + 10 digits` before appending `@s.whatsapp.net`.

Primary helper:

- `server/utils/phoneNormalization.js`

## Import And Sync Changes

Updated import paths:

- `server/routes/creators.js`
- `server/services/creatorImportBatchService.js`
- `src/App.jsx`

Behavior:

- manual create and CSV/bulk import normalize US 10-digit values before writing `creators.wa_phone`.
- duplicate checks search both canonical and old local variants.
- if an old local-variant creator is reused, it is updated to the canonical `1xxxxxxxxxx` value.
- the bulk import preview displays the canonical number that will be sent to the API.

Updated edit path:

- `PUT /api/creators/:id`
- `src/components/CreatorDetail.jsx`

Behavior:

- editing a creator phone through the existing creator edit panel now goes through backend normalization.
- US 10-digit values are stored as `1xxxxxxxxxx`.
- the update rejects same-phone variant conflicts with `409` instead of silently merging or overwriting another creator.
- this is the preferred way to fix a WangYouKe creator phone after import. Do not use startup rebuild for routine edits.

Updated Baileys/worker paths:

- `server/services/wa/driver/jidUtils.js`
- `server/waWorker.js`

Behavior:

- Baileys `normalizeJid()` normalizes the phone before building the driver JID.
- realtime and history batch ingestion search both canonical and legacy local variants before creating a new creator.
- this protects existing 10-digit WangYouKe rows while the startup rebuild cleans them.

## Startup Rebuild

New script:

```bash
node scripts/rebuild-wangyouke-creators.cjs --dry-run
node scripts/rebuild-wangyouke-creators.cjs --write
```

Startup integration:

- `scripts/run-startup-migrations.cjs` can run the rebuild after SQL migrations only when explicitly enabled.
- default enabled: `STARTUP_REBUILD_WANGYOUKE_CREATORS=false`.
- enable only for a reviewed one-off maintenance window with `STARTUP_REBUILD_WANGYOUKE_CREATORS=true`.
- default owner: `WangYouKe`.
- override owner with `WANGYOUKE_REBUILD_OWNER=<owner>`.

The rebuild:

- scans creators owned by WangYouKe or present in WangYouKe primary roster.
- canonicalizes US 10-digit phones.
- ensures `operator_creator_roster` primary assignment for the owner/session.
- ensures `wa_crm_data` exists.
- merges duplicate 10-digit and 11-digit rows for the same number.
- preserves existing native message metadata by moving messages before creator merge.
- reports cross-owner conflicts instead of merging them.

Local dry-run on this machine returned zero scanned rows because the local DB did not contain the newly imported WangYouKe batch:

```json
{"owner":"WangYouKe","session_id":"wangyouke","write":false,"scanned":0,"normalized":0,"merged":0,"conflicts":[],"skipped":[]}
```

## Baileys History Repair

New explicit API:

```http
POST /api/wa/repair-baileys-history
Content-Type: application/json

{
  "creator_id": 123,
  "fetch_limit": 500,
  "full_dedup": true
}
```

Implementation paths:

- `server/routes/wa.js`
- `server/services/waSessionRouter.js`
- `server/agent/ipcProtocol.js`
- `server/agent/waAgent.js`

Behavior:

- routes the request to the creator owner/session.
- requires the active session to be using the Baileys driver.
- uses the Baileys on-demand `fetchMessageHistory` path when a Baileys-keyed anchor exists.
- waits briefly for `messaging-history.set`, combines buffered live messages and fetched history, then runs the existing CRM reconciliation path.
- returns `audit_source.baileys_history_fetch` so operators can see whether a server-side history fetch was requested, skipped for missing anchor, or collected messages.

UI entry:

- Chat workspace header repair button (`RepairIcon` / mobile `🩺`) now calls `POST /api/wa/repair-baileys-history` first.
- If the routed session is not Baileys, the same button falls back to the existing `POST /api/wa/reconcile-contact` repair path.

Known boundary:

- if a creator has no Baileys-keyed anchor message yet, the endpoint can still reconcile the driver buffer but cannot force deep history from WA. Send/receive one Baileys message first or wait for normal history sync to create an anchor.

## Translation Repair

Updated files:

- `server/services/translationService.js`
- `server/services/aiService.js`
- `src/components/WAMessageComposer.jsx`
- `tests/translationService.test.mjs`

Behavior:

- DeepL Chinese target is now `zh-HANS`.
- DeepL remains the default translation provider.
- DeepL failures, quota blocks, and unchanged English-to-Chinese outputs fallback to OpenAI translation.
- batch translation repairs unchanged per-message DeepL outputs through OpenAI fallback.
- MiniMax is only used when explicitly requested with `provider=minimax`.
- MiniMax translation mode now accepts `to_en` and `to_zh`, instead of collapsing every non-auto mode to Chinese.
- the chat UI supports translating one message directly from the message bubble.
- the chat UI no longer renders original text as a fake translation when the backend returns no effective translation.

## Verification

Commands run:

```bash
node --check scripts/rebuild-wangyouke-creators.cjs
node --check scripts/run-startup-migrations.cjs
node --check server/services/translationService.js
node --check server/services/aiService.js
node --test tests/translationService.test.mjs tests/phoneNormalization.test.mjs server/services/wa/__tests__/jidUtils.test.mjs
node scripts/rebuild-wangyouke-creators.cjs --dry-run
npm run test:unit
npm run build
git diff --check
```

Results:

- targeted tests: `9` pass.
- unit suite: `42` pass, `3` skipped.
- build: passed.
- diff check: passed.
- known unit warning remains: Baileys LID mapping loading cannot connect to local MySQL in the sandboxed unit test process.

## Rollout Notes

1. Deploy branch `codex/youke-phone-normalization` after confirming `STARTUP_REBUILD_WANGYOUKE_CREATORS` remains unset or `false`.
2. Fix individual WangYouKe phones through the creator edit UI or `PUT /api/creators/:id`.
3. If bulk cleanup is needed, run `node scripts/rebuild-wangyouke-creators.cjs --dry-run` first and only use `--write` during a reviewed maintenance window.
4. Run the Baileys readiness report for WangYouKe:

```bash
node scripts/report-baileys-backfill-readiness.cjs --owner=WangYouKe --include-ok --limit=50
```

5. For a repaired creator, call `POST /api/wa/repair-baileys-history` or use the existing contact repair action.
6. Retest a WangYouKe creator whose number was imported as a US 10-digit value.
7. Retest chat translation on an English message; the translation line should show Chinese or stay hidden if no effective translation is returned.

## Known Boundaries

- The rebuild will not merge a same-phone variant if another owner has a conflicting creator outside WangYouKe scope; it reports the conflict.
- Existing rows with wrong non-US country assumptions cannot be inferred automatically. Only 10-digit local US numbers are normalized to `1xxxxxxxxxx`.
- Baileys history repair still requires a valid Baileys anchor for deep history fetch; phone normalization fixes the target JID and matching layer, not the anchor requirement.
- Generated build assets are not committed; only source and tests are part of this handoff.

## Obsidian Sync

- Status: synced
- Note: `docs/obsidian/notes/2026-04-28-wangyouke-phone-normalization-translation-handoff.md`
- Index: `docs/obsidian/index.md`
