# WangYouKe Phone Normalization And Translation Handoff

Date: 2026-04-28
Status: Active
Branch: `codex/youke-phone-normalization`
Commits: `16a91d8`, `43b9c02`
Scope: WangYouKe creator phone normalization, Baileys sync compatibility, startup rebuild, and translation fallback repair

## Summary

This handoff records the fix for the WangYouKe import/sync issue and the chat translation issue.

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

- `scripts/run-startup-migrations.cjs` runs the rebuild after SQL migrations.
- default enabled: `STARTUP_REBUILD_WANGYOUKE_CREATORS=true`.
- disable with `STARTUP_REBUILD_WANGYOUKE_CREATORS=false`.
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

## Translation Repair

Updated files:

- `server/services/translationService.js`
- `server/services/aiService.js`
- `src/components/WAMessageComposer.jsx`
- `tests/translationService.test.mjs`

Behavior:

- DeepL Chinese target is now `zh-HANS`.
- single-message translation treats unchanged English-to-Chinese output as a failed provider result and falls back to MiniMax.
- batch translation repairs unchanged per-message DeepL outputs through MiniMax fallback.
- MiniMax translation mode now accepts `to_en` and `to_zh`, instead of collapsing every non-auto mode to Chinese.
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

1. Deploy branch `codex/youke-phone-normalization`.
2. Keep `STARTUP_REBUILD_WANGYOUKE_CREATORS=true` for the first deploy so the startup migration runner repairs the owner data.
3. After deploy, check startup logs for `[wangyouke-rebuild]`.
4. Confirm `conflicts` is empty or review any reported cross-owner conflicts manually.
5. Run the Baileys readiness report for WangYouKe after the rebuild:

```bash
node scripts/report-baileys-backfill-readiness.cjs --owner=WangYouKe --include-ok --limit=50
```

6. Retest a WangYouKe creator whose number was imported as a US 10-digit value.
7. Retest chat translation on an English message; the translation line should show Chinese or stay hidden if no effective translation is returned.

## Known Boundaries

- The rebuild will not merge a same-phone variant if another owner has a conflicting creator outside WangYouKe scope; it reports the conflict.
- Existing rows with wrong non-US country assumptions cannot be inferred automatically. Only 10-digit local US numbers are normalized to `1xxxxxxxxxx`.
- Baileys history backfill still requires a valid Baileys anchor for deep history fetch; phone normalization fixes the target JID and matching layer, not the anchor requirement.
- Generated build assets are not committed; only source and tests are part of this handoff.

## Obsidian Sync

- Status: synced
- Note: `docs/obsidian/notes/2026-04-28-wangyouke-phone-normalization-translation-handoff.md`
- Index: `docs/obsidian/index.md`
