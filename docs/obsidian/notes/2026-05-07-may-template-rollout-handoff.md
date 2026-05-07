---
title: May Template Rollout Handoff
date: 2026-05-07
project: wa-crm-v2
type: handoff
source_path: docs/MAY_TEMPLATE_ROLLOUT_HANDOFF_20260507.md
status: active
tags:
  - wa-crm-v2
  - templates
  - sop
  - rollout
---

# May Template Rollout Handoff

## Summary

The May creator outreach docx is now represented as a manifest-backed Markdown SOP source plus separate static image assets. The template UI supports May SOP image-only candidates, large image preview from saved-template thumbnails, and soft delete for saved custom topic templates.

## Key Decisions

- May Markdown lives at `docs/rag/sources/sop-creator-outreach-may-2026-v1.md`.
- May images live separately under `public/sop-assets/may-2026/`.
- Image-only templates store URLs in `media_items`; image bytes are not stored in DB.
- `DELETE /api/custom-topic-templates/:id` soft-deletes rows with `is_active = 0`.
- May image labels are code-maintained in `SOP_IMAGE_TOPIC_TEMPLATES`, so manual visual QA remains required.

## Source

- `docs/MAY_TEMPLATE_ROLLOUT_HANDOFF_20260507.md`

## Verification

- May retrieval tests passed 8/8.
- Local rule shadow cases passed 7/7.
- Manifest validation passed.
- Build completed.
- Local health and May image static asset checks returned OK.

## Follow-Ups

- Policy-review high-claim May SOP sections.
- Add automated delete API and browser preview coverage.
- Consider static JSON metadata for SOP image labels/topics.
- Review global template CRUD needs.
