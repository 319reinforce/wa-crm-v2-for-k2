---
title: Template System Design
date: 2026-05-07
project: wa-crm-v2
type: design
source_path: docs/TEMPLATE_SYSTEM_DESIGN_20260507.md
status: active
tags:
  - wa-crm-v2
  - templates
  - sop
  - reply-deck
---

# Template System Design

## Summary

WA CRM v2 has three separate template layers: manifest-backed Reply Deck SOP templates, DB-backed custom topic templates, and owner-specific import welcome templates. May SOP assets add explicit Markdown `template-meta`, local static image assets, large image preview, and saved-template soft delete.

## Key Decisions

- Manifest-backed SOP templates are for standard shared Reply Deck copy.
- `custom_topic_templates` is for operator-maintained text/image/image-only quick replies.
- `operator_outreach_templates` remains only for bulk-import welcome copy.
- SOP images live under `public/sop-assets/<version>/`; DB rows store only URL media items.
- May and April static SOP images are now described by versioned JSON manifests: `public/sop-assets/may-2026/manifest.json` and `public/sop-assets/apr-2026/manifest.json`.
- `WAMessageComposer.jsx` loads SOP image manifests at runtime instead of carrying static frontend image constants.
- `scripts/validate-sop-image-manifest.cjs` validates image manifest fields, checksums, dimensions, and duplicate URLs.
- `FIXED_TOPIC_TEMPLATES` is fallback-only after manifest ranking.
- Custom template delete is soft delete using `is_active = 0`.

## Source

- `docs/TEMPLATE_SYSTEM_DESIGN_20260507.md`

## Verification

Required checks include `node --check` for template routes/services, knowledge manifest validation, SOP image manifest validation for May/April, May retrieval tests, local rule shadow cases, `npm run build`, static asset health checks, and manual browser QA for image preview/delete.

## Follow-Ups

- Policy-review May SOP claims.
- Add API test coverage for custom template delete.
- Keep SOP image manifests in sync when replacing or re-importing image batches.
- Decide whether global shared template CRUD needs an admin UI.
