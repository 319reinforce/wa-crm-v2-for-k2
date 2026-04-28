---
title: WangYouKe Phone Normalization And Translation Handoff
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

# WangYouKe Phone Normalization And Translation Handoff

## Summary

Branch `codex/youke-phone-normalization` fixes WangYouKe creator sync failures caused by US local 10-digit numbers and fixes chat translation cases where the UI showed the original English text as if it were translated.

## Key Decisions

- `creators.wa_phone` remains the canonical WhatsApp contact key.
- US local 10-digit numbers are normalized to `1 + 10 digits`.
- Lookup and duplicate checks treat `4108010355` and `14108010355` as the same number variant.
- Baileys JID generation also normalizes the phone before appending `@s.whatsapp.net`.
- Startup migrations now run `scripts/rebuild-wangyouke-creators.cjs --write` by default.
- DeepL Chinese output targets `zh-HANS`, and unchanged provider output falls back to MiniMax instead of being rendered as a successful translation.

## Operational Facts

- Startup rebuild env flag: `STARTUP_REBUILD_WANGYOUKE_CREATORS`, default `true`.
- Owner override: `WANGYOUKE_REBUILD_OWNER`.
- Manual run:

```bash
node scripts/rebuild-wangyouke-creators.cjs --dry-run
node scripts/rebuild-wangyouke-creators.cjs --write
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

## Source

- `docs/WANGYOUKE_PHONE_NORMALIZATION_TRANSLATION_HANDOFF_20260428.md`
- `server/utils/phoneNormalization.js`
- `scripts/rebuild-wangyouke-creators.cjs`
- `server/services/translationService.js`
- `src/components/WAMessageComposer.jsx`

## Follow-Ups

- Inspect production startup logs for `[wangyouke-rebuild]`.
- Resolve any reported cross-owner phone conflicts manually.
- Retest a WangYouKe 10-digit import and an English message translation in chat.
