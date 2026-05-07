---
title: Reply Deck Image Template Plan
date: 2026-05-07
project: wa-crm-v2
type: design
source_path: docs/REPLY_DECK_IMAGE_TEMPLATE_PLAN_20260507.md
status: active
tags:
  - wa-crm-v2
  - templates
  - reply-deck
  - images
---

# Reply Deck Image Template Plan

## Summary

The Reply Deck image-template work is implemented on the frontend and pending browser QA. The composer image icon now opens the template image library by default, local upload is a secondary action, Reply Deck gains `op3` as a recommended image card, and AI replies shift visually to `op4` and `op5` while preserving SFT semantics.

## Key Decisions

- Image sends remain standalone media and are not appended to text replies.
- The composer image flow should become a two-source picker: template library first, local upload second.
- Reply Deck card order becomes `op1` recommended text template, `op2` original/reference text template, `op3` recommended image, `op4` AI option 1, and `op5` AI option 2.
- The current large-preview overlay should be reused for composer library images, saved template images, and Reply Deck image thumbnails.
- Static SOP image metadata should move from hard-coded frontend constants to a versioned JSON manifest with checksum/dimension validation.
- Global templates remain read-only for owner-scoped users until an admin UI is explicitly implemented.
- May SOP image metadata now lives in `public/sop-assets/may-2026/manifest.json`.
- April SOP image metadata now lives in `public/sop-assets/apr-2026/manifest.json`.
- Frontend image candidates no longer depend on April/May hard-coded fallback constants.
- `scripts/validate-sop-image-manifest.cjs` validates manifest fields, image existence, checksums, dimensions, and duplicate URLs.

## Source

- `docs/REPLY_DECK_IMAGE_TEMPLATE_PLAN_20260507.md`

## Verification

Completed checks:

- `node --check scripts/validate-sop-image-manifest.cjs`
- `node scripts/validate-sop-image-manifest.cjs public/sop-assets/may-2026/manifest.json`
- `node scripts/validate-sop-image-manifest.cjs public/sop-assets/apr-2026/manifest.json`
- `node --check server/routes/customTopicTemplates.js`
- `node --check server/services/localRuleRetrievalService.js`
- `node scripts/validate-knowledge-manifest.cjs`
- `node scripts/test-may-template-retrieval.cjs` passed 8/8.
- `node scripts/test-local-rule-retrieval.js` passed 7/7.
- `npm run build`
- Runtime check: server started on `http://localhost:3001`; `/api/health` returned OK and `/sop-assets/may-2026/manifest.json` returned 200.

## Follow-Ups

- Browser QA for image picker modal, local upload, `op3` preview, and standalone media send.
- Decide whether `op3` should prefer owner-specific saved images or globally reviewed SOP images.
- Decide whether high-risk image assets need send-time blocking or only review warnings.
- Choose whether the local upload action appears as a tab, footer button, or secondary icon in the new image picker.
- Scope a separate admin UI if global template CRUD becomes operationally necessary.
