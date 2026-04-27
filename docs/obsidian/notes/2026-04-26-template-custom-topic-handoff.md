---
title: Template Custom Topic Handoff
date: 2026-04-26
project: wa-crm-v2
type: handoff
source_path: docs/archive/handoffs/TEMPLATE_CUSTOM_TOPIC_HANDOFF_20260424.md
status: active
tags:
  - wa-crm-v2
  - memory
  - templates
  - whatsapp
---

# Template Custom Topic Handoff

## Summary

WA CRM v2 custom topic templates now support independent image assets. A saved template can contain text, images, or images only. SOP image chips in the topic route panel should create image-only templates, and Reply Deck image tiles send WhatsApp media separately from any text reply.

## Key Decisions

- Local public image paths such as `/sop-assets/apr-2026/image1.png` are valid template image URLs and should render as previews.
- Template persistence accepts a label plus either `template_text` or `media_items`; text is no longer mandatory when image assets exist.
- Custom template retrieval returns image-only templates into `op1` so operators can select and send them.
- Template text and template images are intentionally decoupled: `直接发送` sends text, while `单独发送图片` sends an image tile as a media message.
- SOP image topic buttons should not inject their old summary text into the template body.
- Backend retrieval should not auto-infer SOP images for text templates; image sending should come from saved/selectable image-only templates.

## Source

- Source document: `docs/archive/handoffs/TEMPLATE_CUSTOM_TOPIC_HANDOFF_20260424.md`
- Main code paths:
  - `server/routes/customTopicTemplates.js`
  - `server/services/localRuleRetrievalService.js`
  - `src/components/WAMessageComposer.jsx`
  - `src/components/AIReplyPicker.jsx`
  - `src/components/StandardReplyCard.jsx`

## Verification

- Required local checks: `node --check server/routes/customTopicTemplates.js`, `node --check server/services/localRuleRetrievalService.js`, `npm test`, and production build.
- Browser rollout should verify saving an image-only SOP template, previewing `/sop-assets/...` images, and sending one image tile independently from text.
