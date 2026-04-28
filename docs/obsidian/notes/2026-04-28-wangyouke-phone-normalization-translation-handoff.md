---
title: WangYouKe Phone Normalization, Safe Edit, And Baileys Repair Handoff
date: 2026-04-28
project: wa-crm-v2
type: handoff
source_path: docs/WANGYOUKE_PHONE_NORMALIZATION_TRANSLATION_HANDOFF_20260428.md
status: active
tags:
  - wa-crm-v2
  - wangyouke
  - baileys
  - phone-normalization
  - translation
---

# WangYouKe Phone Normalization, Safe Edit, And Baileys Repair Handoff

## Summary

Branch `codex/youke-phone-normalization` fixes WangYouKe creator sync failures caused by US local 10-digit numbers and fixes chat translation cases where the UI showed the original English text as if it were translated. A follow-up safety review moved the data repair strategy away from default startup rebuilds and toward explicit system actions.

## Key Decisions

- `creators.wa_phone` remains the canonical WhatsApp contact key.
- US local 10-digit numbers are normalized to `1 + 10 digits`.
- Lookup and duplicate checks treat `4108010355` and `14108010355` as the same number variant.
- Baileys JID generation also normalizes the phone before appending `@s.whatsapp.net`.
- Startup migrations no longer run `scripts/rebuild-wangyouke-creators.cjs --write` by default.
- Creator phone edits through `PUT /api/creators/:id` now normalize US 10-digit values and reject same-phone variant conflicts.
- `POST /api/wa/repair-baileys-history` explicitly triggers Baileys on-demand history repair for a creator/session.
- DeepL Chinese output targets `zh-HANS`; DeepL remains the default translator, while failures and unchanged output fallback to OpenAI. MiniMax is only used for explicit `provider=minimax`.

## Operational Facts

- Startup rebuild env flag: `STARTUP_REBUILD_WANGYOUKE_CREATORS`, default `false`.
- Owner override: `WANGYOUKE_REBUILD_OWNER`.
- Manual run:

```bash
node scripts/rebuild-wangyouke-creators.cjs --dry-run
node scripts/rebuild-wangyouke-creators.cjs --write
```

- Preferred single-creator phone fix: edit the phone in the creator detail panel or call `PUT /api/creators/:id`.
- Explicit Baileys repair, wired to the existing chat repair button (`RepairIcon` / mobile `🩺`):

```http
POST /api/wa/repair-baileys-history
```

- Post-deploy readiness check:

```bash
node scripts/report-baileys-backfill-readiness.cjs --owner=WangYouKe --include-ok --limit=50
```

## Verification Retained

- `node --check` on changed backend scripts/services.
- targeted tests passed.
- `npm run test:unit` passed with `42` pass and `3` skipped.
- `npm run build` passed.
- `git diff --check` passed.
- local WangYouKe rebuild dry-run produced an empty safe report because local DB had no WangYouKe rows.
- follow-up syntax checks passed for creator update, WA route, WA session router, and WA agent changes.

## Source

- `docs/WANGYOUKE_PHONE_NORMALIZATION_TRANSLATION_HANDOFF_20260428.md`
- `server/utils/phoneNormalization.js`
- `scripts/rebuild-wangyouke-creators.cjs`
- `server/routes/creators.js`
- `server/routes/wa.js`
- `server/services/waSessionRouter.js`
- `server/agent/waAgent.js`
- `server/services/translationService.js`
- `src/components/WAMessageComposer.jsx`

## Follow-Ups

- Keep startup rebuild disabled unless a maintenance run is explicitly approved.
- Resolve any reported phone variant conflicts manually.
- Retest a WangYouKe phone edit, Baileys history repair, and an English message translation in chat.
