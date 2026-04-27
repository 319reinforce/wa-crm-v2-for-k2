---
title: Baileys Session Direction
date: 2026-04-27
project: wa-crm-v2
type: decision
source_path: docs/WA_SESSIONS_DESIGN.md
status: active
tags:
  - wa-crm-v2
  - whatsapp
  - baileys
  - runtime
---

# Baileys Session Direction

## Summary

WA CRM v2 will use Baileys as the forward WhatsApp runtime direction. WWeb/Chrome/Puppeteer is legacy compatibility only and should not be the target for new session, QR, media, or history-sync work.

## Key Decisions

- New WA session planning assumes Baileys.
- WWeb remains only until live accounts are verified and compatibility code can be removed.
- Docs now point to `.baileys_auth`, Baileys JIDs, proto persistence, and Baileys history sync.
- Chrome-only features should be treated as blocked or legacy, not expanded.

## Source

- `docs/WA_SESSIONS_DESIGN.md`
- `docs/BAILEYS_ROLLOUT.md`

## Follow-Ups

- Verify all live accounts on Baileys.
- Then remove WWeb driver, `whatsapp-web.js`, Chromium/Puppeteer deployment needs, and UI copy that presents WWeb as equal.
