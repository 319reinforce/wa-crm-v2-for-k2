# Baileys Operations Runbook

Date: 2026-04-27
Status: Active

## Decision

Baileys is the forward WhatsApp runtime direction for WA CRM v2. WWeb/Chrome remains legacy fallback only until the implementation cleanup removes it.

## Why

- Avoids one Chromium/Puppeteer process per account.
- Starts faster and uses less memory per session.
- Gives the project one target path for QR, auth, message normalization, media, and history sync.

## Readiness Checks

Before treating an account as ready:

```bash
curl -s http://localhost:3000/api/wa/sessions \
  -H "Authorization: Bearer $TOKEN"
```

Confirm:

- session uses `driver = baileys`.
- runtime state reaches ready.
- QR login has been completed if required.
- inbound and outbound messages persist in `wa_messages`.
- media send and receive behavior is verified for that owner.
- `proto_driver = 'baileys'` appears for Baileys-ingested messages where proto persistence is available.

## Driver Switch

While the compatibility endpoint still exists, use it only to move accounts toward Baileys:

```bash
curl -X POST http://localhost:3000/api/wa/sessions/jiawen/driver \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"driver":"baileys","force_disconnect":true}'
```

Then poll the command:

```bash
curl -s http://localhost:3000/api/wa/sessions/jiawen/commands/$CMD_ID \
  -H "Authorization: Bearer $TOKEN"
```

## Monitoring

Watch:

- session ready/connect/disconnect state.
- outbound send success and latency.
- inbound message persistence.
- media download failures.
- LID to phone-number mapping failures.
- history sync/gap-fill errors.

## Known Risk

Baileys is not an official WhatsApp API. Account risk must be accepted by the business owner before full migration. If an account fails on Baileys, record the exact failure and keep the fallback decision explicit; do not build new Chrome-only features around that exception.

## Cleanup Checklist

After all live accounts are verified on Baileys:

- remove WWeb driver code and tests.
- remove `whatsapp-web.js` dependency.
- remove Chromium/Puppeteer Docker requirements.
- remove `.wwebjs_auth` volume assumptions after backups are no longer needed.
- simplify account UI so Baileys is not presented as one option among equals.

## Related

- `docs/WA_SESSIONS_DESIGN.md`
- `server/services/wa/driver/baileysDriver.js`
- `server/waWorker.js`
- `server/agent/waAgent.js`

## Obsidian Sync

- Status: synced
- Note: `docs/obsidian/notes/2026-04-27-baileys-session-direction.md`
- Index: `docs/obsidian/index.md`
