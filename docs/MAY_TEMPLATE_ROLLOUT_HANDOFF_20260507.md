# May Template Rollout Handoff

Date: 2026-05-07
Status: Implemented locally / needs operator content review before broad rollout
Scope: May SOP Markdown, May SOP image assets, template retrieval, image preview, saved-template delete

## Summary

The May creator outreach docx was converted into a manifest-backed Markdown SOP source and the embedded images were extracted as separate static assets. The Reply Deck template retrieval path now prefers manifest-backed May SOP sections over hard-coded fixed templates, while fixed templates remain fallback-only.

The frontend topic-route template UI now includes May image-only candidates, supports large preview from saved-template image thumbnails, and allows deleting saved custom topic templates.

## Implemented Files

Core runtime:

- `server/services/localRuleRetrievalService.js`
- `server/routes/customTopicTemplates.js`
- `src/components/WAMessageComposer.jsx`

Template sources and assets:

- `docs/rag/knowledge-manifest.json`
- `docs/rag/sources/sop-creator-outreach-may-2026-v1.md`
- `public/sop-assets/may-2026/image1.png` through `image17.png` / `.jpeg`
- `public/sop-assets/may-2026/index.html`

Scripts:

- `scripts/convert-may-docx-to-sop-md.py`
- `scripts/test-may-template-retrieval.cjs`
- `scripts/validate-custom-topic-template-import.cjs`

Docs:

- `docs/MAY_TEMPLATE_ROLLOUT_KICKOFF_20260507.md`
- `docs/TEMPLATE_SYSTEM_DESIGN_20260507.md`
- `docs/DOCS_INDEX.md`
- `docs/CORE_MODULES_OVERVIEW.md`
- `docs/AI_REPLY_GENERATION_SYSTEM.md`
- `BOT_INTEGRATION.md`
- Obsidian notes under `docs/obsidian/notes/`

## Runtime Behavior

May SOP retrieval:

- `sop-creator-outreach-may-2026-v1` is registered in `docs/rag/knowledge-manifest.json` with `priority: 0`.
- May Markdown sections contain explicit `template-meta` blocks for `topic_group`, `intent_key`, `scene_keys`, `template_kind`, `priority`, and `sendable`.
- `parseTemplateMetaBlock()` in `localRuleRetrievalService` lets Chinese headings route by declared metadata instead of English heading inference.
- `FIXED_TOPIC_TEMPLATES` is fallback-only when no manifest-backed section is selected.

May images:

- Images are stored as files under `public/sop-assets/may-2026/`.
- The frontend `SOP_IMAGE_TOPIC_TEMPLATES` list exposes May image-only candidates before April candidates.
- Saving a May SOP image candidate writes only the image URL into `media_items`; `template_text` remains empty unless an operator adds text manually.
- The source label shown in the save modal is dynamic via `sourceTitle`.

Saved template preview/delete:

- In the template save/update modal, image thumbnails are clickable and open a large overlay preview.
- `DELETE /api/custom-topic-templates/:id` soft-deletes saved templates by setting `is_active = 0`.
- The frontend delete button appears only in update mode for saved templates.

## Verification Completed

Commands run:

```bash
node --check server/routes/customTopicTemplates.js
node --check server/services/localRuleRetrievalService.js
node scripts/validate-knowledge-manifest.cjs
node scripts/test-may-template-retrieval.cjs
node scripts/test-local-rule-retrieval.js
npm run build
```

Results:

- May template retrieval passed 8/8.
- Local rule shadow cases passed 7/7.
- Manifest validation passed with 8 sources.
- Production build completed successfully.

Runtime checks:

- `GET http://127.0.0.1:3000/api/health` returned OK.
- `GET http://127.0.0.1:3000/sop-assets/may-2026/index.html` returned 200.
- `GET http://127.0.0.1:3000/sop-assets/may-2026/image10.png` returned 200.
- LAN health check passed on `http://192.168.123.178:3000`.

Current local server:

- URL: `http://localhost:3000`
- LAN URL: `http://192.168.123.178:3000`
- Latest restarted PID observed during this work: `97444`

## Potential Issues

### P1: May SOP still contains high-risk claims

The docx source includes GMV examples, conversion-rate language, incentive details, and compensation-like statements. Some sections are marked `sendable: false`, but sendable May sections still include claims that should be policy-reviewed before broad operator use.

Recommended mitigation:

- Run a policy/content review pass over `docs/rag/sources/sop-creator-outreach-may-2026-v1.md`.
- Downgrade any unapproved high-claim section to `sendable: false`.
- Keep `GET /api/policy-documents` as a required step for policy-bearing AI replies.

### P2: Static image labels can drift from real image content

The May image mapping in `SOP_IMAGE_TOPIC_TEMPLATES` is manual. If the docx image order changes or a replacement docx is imported, labels such as `May结算明细表图` or `May申诉手机图` can point at the wrong file.

Recommended mitigation:

- Use `public/sop-assets/may-2026/index.html` for manual visual QA after every image import.
- Keep image labels reviewed by an operator before publishing.
- Consider moving image metadata into a JSON manifest if image batches become frequent.

### P2: Custom template upsert remains label-based

`POST /api/custom-topic-templates` still upserts by `owner_scope + label`. Repeated labels across different topics can overwrite an existing row during scripted imports.

Recommended mitigation:

- Run `scripts/validate-custom-topic-template-import.cjs` before DB-backed imports.
- Use stable labels that include version or topic when importing in bulk.
- Consider a future unique key including `topic_group` and `intent_key`.

### P2: Soft delete does not clear all live UI state

Deleting a template removes it from future GET results and refreshes the saved list, but any already selected Reply Deck card or open browser state may remain until reload/regeneration.

Recommended mitigation:

- After deleting, reload/regenerate Reply Deck before assuming no card can still be selected.
- Consider clearing active custom topic state if the deleted template id matches the current topic.

### P2: Global template management is incomplete

Owner-scoped users can read global templates but cannot update/delete global rows because routes are scoped by `owner_scope`. That is fine for safety, but it is a limitation if global shared templates are used operationally.

Recommended mitigation:

- Add an admin-only global template management flow before relying on global saved templates.
- Keep operator-specific templates owner-scoped for now.

### P3: Large image preview is frontend-only

The large preview relies on the image URL being browser-accessible. Broken URLs or protected remote images will still fail in the browser.

Recommended mitigation:

- Prefer local `/sop-assets/...` paths for SOP images.
- Check `GET /sop-assets/...` after each deploy.

### P3: Restart discipline remains manual

Manifest changes are cached in the Node process, and frontend changes need rebuilt static assets.

Recommended mitigation:

- Use the verification checklist in `docs/TEMPLATE_SYSTEM_DESIGN_20260507.md`.
- Restart Node after manifest updates.
- Run `npm run build` before serving production frontend assets.

## Manual QA Checklist

1. Open `http://192.168.123.178:3000`.
2. Open a creator and open the template/topic route modal.
3. Click a May SOP image chip and save it as an image-only template.
4. Reopen that saved template and click the thumbnail.
5. Confirm large preview opens and closes cleanly.
6. Click `删除模板`, confirm deletion, and verify it disappears from the saved list.
7. Reopen Reply Deck and verify text send and media send remain separate actions.

## Follow-Ups

- Policy-review May SOP claims and mark additional sections `sendable: false` if needed.
- Add automated API coverage for `DELETE /api/custom-topic-templates/:id`.
- Add Playwright/browser coverage for image preview and delete modal.
- Consider a static JSON manifest for SOP image metadata to reduce code drift.
- Decide whether global shared template CRUD needs an admin UI.

## Obsidian Sync

- Status: synced
- Note: `docs/obsidian/notes/2026-05-07-may-template-rollout-handoff.md`
- Index: `docs/obsidian/index.md`
