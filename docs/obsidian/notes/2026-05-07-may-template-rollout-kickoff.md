---
title: May Template Rollout Kickoff
date: 2026-05-07
project: wa-crm-v2
type: plan
source_path: docs/MAY_TEMPLATE_ROLLOUT_KICKOFF_20260507.md
status: superseded
tags:
  - wa-crm-v2
  - templates
  - sop
  - rollout
---

# May Template Rollout Kickoff

## Summary

Created a kickoff and then implemented the first May template rollout step: converting the uploaded May creator outreach SOP docx into a manifest-backed Markdown source with explicit routing metadata.

Superseding docs:

- `docs/MAY_TEMPLATE_ROLLOUT_HANDOFF_20260507.md`
- `docs/TEMPLATE_SYSTEM_DESIGN_20260507.md`

## Key Decisions

- Do not directly merge archived template branches for the May rollout. Current relevant template branches are already merged into `main`, except `origin/template-pop`, which is April-era and conflicts with current Reply Deck/template files.
- Treat the May docx as a new source that must be normalized into structured Markdown and/or DB templates.
- Prefer a new manifest-backed source for standard Reply Deck templates, with selected high-frequency entries optionally seeded into `custom_topic_templates`.
- Use `operator_outreach_templates` only for batch-import welcome copy.
- Rebuild/restart after deploy because `localRuleRetrievalService` caches `docs/rag/knowledge-manifest.json` in process.
- Use `docs/rag/sources/sop-creator-outreach-may-2026-v1.md` as the May source and route sections by explicit `template-meta`, not by heading text.
- Keep DB-backed bulk import behind duplicate-label validation; no DB custom templates were inserted in this step.
- Store May docx images separately under `public/sop-assets/may-2026/` and reference them through `media_items` URLs only.

## Review Notes

- `FIXED_TOPIC_TEMPLATES` can shadow newer SOP sources, especially first outreach.
- `inferSectionMetadata()` depends on English heading fragments and may misclassify Chinese/mixed-language May sections.
- `custom_topic_templates` upsert is keyed by owner scope and label, so duplicate labels can overwrite content during bulk import.
- SOP image UI still labels image-topic imports as April assets.

## Rollout Checks

- Normalize stale April wording and high-risk claims before import.
- Define versioning for May versus April templates.
- Add retrieval validation cases for first outreach, May new-user policy, existing-user policy, MCN binding, settlement, posting safety, product logic, and violation appeal.

## Verification

- Read the uploaded docx enough to confirm it extracts into 370 paragraphs and contains May policy material plus mixed legacy/April wording.
- Read current template route, storage, retrieval, and UI code paths.
- Added retrieval validation coverage in `scripts/test-may-template-retrieval.cjs`.

## Implementation Update

- Added `sop-creator-outreach-may-2026-v1` to `docs/rag/knowledge-manifest.json`.
- Changed template slot retrieval so fixed templates are fallback-only after manifest-backed sections are ranked.
- Added `scripts/convert-may-docx-to-sop-md.py` and `scripts/validate-custom-topic-template-import.cjs`.
- Normalized stale April wording in the first outreach section to May wording and aligned the bonus line with the May $100 challenge policy.

## Rollout Verification

- `node --check server/services/localRuleRetrievalService.js` passed.
- `node scripts/validate-knowledge-manifest.cjs` passed.
- `node scripts/test-may-template-retrieval.cjs` passed 8/8.
- `node scripts/test-local-rule-retrieval.js` passed 7/7.
- `npm run build` completed.
- Verification server on `PORT=3010` returned health OK and retrieved May first outreach from `sop-creator-outreach-may-2026-v1`.
- Default ports `3000` and `3001` were occupied by local `ssh` listeners, so the production-default restart remains blocked until those listeners are cleared or the deployed process is restarted by its normal process manager.

## Image Asset Import

- Extracted 17 docx images to `public/sop-assets/may-2026/`.
- Added `public/sop-assets/may-2026/index.html` for local visual verification.
- Added May image-only candidates to `src/components/WAMessageComposer.jsx` before the April image candidates.
- Replaced the image modal source label with per-item `sourceTitle` so May images are labeled `5月版 SOP 图片`.
- Closed old `ssh` listener PID `85672`, which had occupied local ports `3000` and `3001`.

## Superseded By

- `docs/obsidian/notes/2026-05-07-may-template-rollout-handoff.md`
- `docs/obsidian/notes/2026-05-07-template-system-design.md`
