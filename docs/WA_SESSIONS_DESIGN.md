# WA Sessions Manager - Baileys Direction

Date: 2026-04-27
Status: Active

## Summary

WA CRM v2 will move forward on Baileys as the WhatsApp session direction. WWeb/Chrome/Puppeteer is legacy compatibility only and should not be used as the target architecture for new work.

## Current Decision

- Default product direction: Baileys WebSocket sessions.
- WWeb/Chrome is a temporary fallback while runtime code still supports both drivers.
- New session design, deployment notes, and operational runbooks should assume `.baileys_auth` and Baileys message normalization.
- Do not build new features that depend on Chromium, Puppeteer chat objects, or `.wwebjs_auth`.

## Active Runtime Boundaries

Primary code:

- `server/services/waService.js`
- `server/services/wa/index.js`
- `server/services/wa/driver/baileysDriver.js`
- `server/services/wa/driver/jidUtils.js`
- `server/waWorker.js`
- `server/agent/waAgent.js`
- `server/routes/wa.js`
- `server/routes/waSessions.js`
- `src/components/AccountsPanel.jsx`

Baileys-specific storage and data:

- Auth root: `WA_BAILEYS_AUTH_ROOT` or `.baileys_auth`.
- Incoming proto persistence: `wa_messages.proto_driver = 'baileys'`.
- Message JID format: `phone@s.whatsapp.net`.
- History sync path: Baileys `messaging-history.set` and explicit gap-fill helpers.

## Migration Cleanup Targets

When the Baileys runtime is stable, remove or downgrade these WWeb compatibility surfaces:

- `server/services/wa/driver/wwebjsDriver.js`
- `whatsapp-web.js` package dependency
- Chromium/Puppeteer deployment requirements
- `.wwebjs_auth` volume assumptions
- UI copy that presents WWeb as an equal option
- tests whose only value is validating WWeb fallback behavior

Do not remove these until the live accounts have been verified on Baileys and any required QR/login workflow is documented.

## Implementation Rules

1. Prefer Baileys-native message shapes in new persistence and repair logic.
2. Keep JID conversion explicit through `server/services/wa/driver/jidUtils.js`.
3. Preserve `proto_driver` and raw proto bytes where they help retry, quote, edit, or gap-fill messages.
4. Treat WWeb branches as compatibility guards only.
5. If a feature cannot work on Baileys, mark it as blocked instead of adding a Chrome-only path.

## Operational Notes

- Existing driver switching endpoints may remain until the code cleanup phase, but docs and future planning should describe Baileys as the target.
- Use `docs/BAILEYS_ROLLOUT.md` for current operational checks.
- Any destructive auth cleanup must preserve backups until live account readiness is confirmed.

## Future Documentation Direction

This document replaces the older WWeb-heavy multi-session plan. Keep future updates concise and implementation-facing:

- Baileys account readiness.
- QR/login flow.
- media send/receive behavior.
- history sync and gap-fill.
- removal checklist for WWeb compatibility.

## Obsidian Sync

- Status: synced
- Note: `docs/obsidian/notes/2026-04-27-baileys-session-direction.md`
- Index: `docs/obsidian/index.md`
