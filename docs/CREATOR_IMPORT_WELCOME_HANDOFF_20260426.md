# Creator Import Welcome Handoff

Date: 2026-04-26
Status: Implemented baseline; scope corrected after WhatsApp Web validation
Scope: dynamic owner roster, batch creator import, owner-bound standard welcome-message publish

## Summary

This handoff captures the first implementation of the creator bulk-import welcome-message flow.

The previous import path only created/reused CRM creator records. The new path can also bind the imported rows to an owner and publish the same owner-specific standard welcome message for each imported creator.

Important boundary: WhatsApp Web cannot reliably complete native contact-book add or phone-side remark sync for this workflow. Contact add/remark remains a manual operation outside WA CRM v2. This feature must not be treated as a hidden contact-management driver; it only imports CRM rows and sends the approved welcome message through the existing owner/session router.

## Implemented Changes

Dynamic owner baseline:

- `GET /api/operator-roster` now returns owners discovered from runtime data only:
  - `users.operator_name`
  - `creators.wa_owner`
  - `wa_sessions.owner`
- `server/config/operatorRoster.js` is still used for alias/profile enrichment, but the local fixed roster is no longer injected into the UI owner list.
- Frontend `OWNER_ORDER` is now empty, so fixed local owners do not appear unless they exist in runtime data.
- `waSessionRouter` no longer falls back to static Beau/Yiyun/Jiawen/WangYouKe targets unless `WA_ENABLE_LEGACY_SESSION_TARGETS=true`.

Batch import + welcome send:

- Added `server/services/creatorImportBatchService.js`.
- Added `server/routes/creatorImportBatches.js`.
- Mounted API at `/api/creator-import-batches`.
- Added schema definitions to `schema.sql`:
  - `operator_outreach_templates`
  - `creator_import_batches`
  - `creator_import_items`
- Extended the existing bulk import modal in `src/App.jsx` with:
  - owner selection from dynamic owner data
  - explicit `发送欢迎消息` switch, defaulting to off for historical creators that were already welcomed manually
  - owner welcome template pool selector
  - welcome message textarea
  - save-current-message-as-template action

Welcome template pool:

- `operator_outreach_templates` stores owner-scoped outreach templates.
- The first supported template key is `welcome`.
- The frontend loads the owner template pool when welcome send is enabled.
- Saving from the bulk import modal updates the selected owner/template key so the welcome copy can be changed without code edits.
- Each import batch stores a `welcome_text` snapshot. Later template edits do not mutate already-created batches.

## API

Create a batch:

```http
POST /api/creator-import-batches
Content-Type: application/json

{
  "owner": "Jiawei",
  "source": "csv-import",
  "send_welcome": true,
  "welcome_template_key": "welcome",
  "welcome_text": "Hi ...",
  "rows": [
    { "name": "creator handle", "phone": "+1..." }
  ]
}
```

Response:

```json
{
  "ok": true,
  "batch": {
    "id": 1,
    "owner": "Jiawei",
    "status": "running",
    "send_welcome": true,
    "summary": {
      "total": 20,
      "created": 20,
      "reused": 0,
      "skipped": 0,
      "errors": 0,
      "welcome_queued": 20,
      "welcome_sent": 0,
      "welcome_failed": 0
    }
  }
}
```

Read status:

```http
GET /api/creator-import-batches/:id
```

Run or retry background sending:

```http
POST /api/creator-import-batches/:id/run
POST /api/creator-import-batches/:id/retry
```

List owner welcome templates:

```http
GET /api/creator-import-batches/outreach-templates?owner=Jiawei
```

Create or update an owner template:

```http
POST /api/creator-import-batches/outreach-templates
Content-Type: application/json

{
  "owner": "Jiawei",
  "template_key": "welcome",
  "label": "Welcome",
  "body": "Hi ..."
}
```

## Runtime Behavior

Import behavior:

- Each valid row upserts `creators` by `wa_phone`.
- Each imported creator is assigned to `operator_creator_roster`.
- `wa_crm_data` is created if missing.
- Owner-scoped users cannot import a phone already owned by another owner.
- Admins can still intentionally reuse/reassign existing creators, matching the existing import behavior.

Welcome send behavior:

- The frontend switch is the operational gate. When it is off, import only creates/reuses CRM creators and owner bindings; it must not enqueue or send welcome messages.
- If `send_welcome=true`, valid imported/reused rows enter `send_status='queued'`.
- If `welcome_text` is provided, that exact text is snapshotted into the batch.
- If `welcome_text` is empty, the backend uses the active owner template identified by `welcome_template_key`.
- Sending runs asynchronously in-process after batch creation.
- Each send uses `sendRoutedMessage`, so routing follows owner/session assignment.
- Successful sends are persisted to `wa_messages` through `persistDirectMessageRecord` with role `me`.
- Failed rows keep `send_status='failed'` and can be retried.
- Send spacing is controlled by `CREATOR_IMPORT_SEND_DELAY_MS`, default `8000`.

## Current Limits

- In-process background jobs are not durable across a process restart. Imported rows remain in DB and can be resumed with `/run` or `/retry`.
- There is no UI polling panel for batch details yet; the backend status endpoint is ready.
- No native WhatsApp contact-book add/remark write is implemented, and it is no longer a target of this handoff. It must stay manual unless a separate project is explicitly authorized.
- Template CRUD is intentionally minimal: list active templates and upsert one selected template from the import modal.

## Suggested Jiawei Test

Use the 20-row remote import list as a first Jiawei test batch, but do not put raw phone numbers into handoff docs or logs.

Checklist:

- Confirm `Jiawei` exists in `wa_sessions.owner` or `users.operator_name`.
- Confirm Jiawei's session is ready in `/api/wa/sessions`.
- Paste the 20 rows into the frontend bulk import modal.
- Select `Jiawei`.
- Enable welcome send only for creators that have not already received the standard welcome message. Leave it off for historical creators that were manually welcomed before CRM import.
- If enabled, provide the exact message.
- Optionally save the message into Jiawei's `welcome` template before submitting.
- Submit and check:
  - `GET /api/creator-import-batches/:id`
  - imported creators appear under Jiawei
  - `wa_messages` contains persisted outbound welcome rows
  - failed rows have actionable errors such as session not ready or phone not registered

## Verification

Verified on 2026-04-26:

```bash
node --check server/services/creatorImportBatchService.js
node --check server/routes/creatorImportBatches.js
node --check server/routes/operatorRoster.js
npm test
```

`npm test` includes the smoke build and unit tests. WA send smoke remains skipped unless `SMOKE_INCLUDE_WA_SEND=1` is set, so no live welcome message was sent during this verification.

## Follow-Ups

- Add batch-detail UI with polling and retry controls.
- Add a richer template management screen if more template keys are needed.
- Add durable queue pickup on startup for batches stuck in `running`/`queued`.

## Obsidian Sync

- Status: synced
- Note: `docs/obsidian/notes/2026-04-26-creator-import-welcome-handoff.md`
- Index: `docs/obsidian/index.md`
