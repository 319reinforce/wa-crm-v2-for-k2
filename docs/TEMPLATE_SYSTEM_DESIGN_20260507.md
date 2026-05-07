# Template System Design

Date: 2026-05-07
Status: Active
Scope: Reply Deck templates, custom topic templates, SOP image assets, and import welcome templates

## Purpose

WA CRM v2 now has three template layers. They must stay separate because they solve different operator workflows and have different persistence semantics.

## Template Layers

### 1. Manifest-Backed Reply Deck SOP Templates

Best for standard SOP copy shared across operators.

- API: `POST /api/experience/retrieve-template`
- Main code:
  - `server/services/localRuleRetrievalService.js`
  - `server/routes/experience.js`
  - `src/components/WAMessageComposer.jsx`
- Source files:
  - `docs/rag/knowledge-manifest.json`
  - `docs/rag/sources/*.md`
- Current May source:
  - `docs/rag/sources/sop-creator-outreach-may-2026-v1.md`

Markdown SOP sections may include explicit metadata blocks:

```markdown
<!-- template-meta
topic_group: settlement_pricing
intent_key: may_policy_overview
scene_keys: monthly_inquiry, mcn_binding, payment_issue
template_kind: policy
priority: 1
sendable: true
-->
```

Rules:

- Use explicit `template-meta` for Chinese or mixed-language headings.
- `sendable: false` marks reference-only content; do not use it as direct reply copy.
- `FIXED_TOPIC_TEMPLATES` is fallback-only after manifest-backed sections are ranked.
- Restart the Node process after changing the manifest because it is cached in-process.

### 2. DB-Backed Custom Topic Templates

Best for operator-maintained quick replies and image-only saved templates.

- API:
  - `GET /api/custom-topic-templates`
  - `POST /api/custom-topic-templates`
  - `PUT /api/custom-topic-templates/:id`
  - `DELETE /api/custom-topic-templates/:id`
- Main code:
  - `server/routes/customTopicTemplates.js`
  - `src/components/WAMessageComposer.jsx`
  - `src/components/StandardReplyCard.jsx`
- Storage:
  - `custom_topic_templates`
  - fields include `label`, `topic_group`, `intent_key`, `scene_key`, `template_text`, `media_items_json`, `owner_scope`, and `is_active`.

Rules:

- A template may contain text, images, or images only.
- Image-only templates store URLs in `media_items_json`; `template_text` may be empty.
- Template images are not auto-appended to text replies. Reply Deck sends text and media as separate actions.
- Delete is soft delete: `is_active = 0`.
- Current uniqueness/upsert behavior is still keyed by `owner_scope + label`; use `scripts/validate-custom-topic-template-import.cjs` before bulk imports.

### 3. Operator Outreach Import Templates

Best for bulk-import welcome copy only.

- API:
  - `GET /api/creator-import-batches/outreach-templates?owner=<owner>`
  - `POST /api/creator-import-batches/outreach-templates`
- Main code:
  - `server/services/creatorImportBatchService.js`
  - `server/routes/creatorImportBatches.js`
  - `src/App.jsx`
- Storage:
  - `operator_outreach_templates`
  - import batches snapshot `welcome_text`.

Rules:

- Do not mix import welcome copy with Reply Deck SOP templates unless the same copy is explicitly approved for both workflows.
- Later template edits do not mutate already-created import batches.

## SOP Image Assets

Static SOP images are stored separately from text templates.

- April assets: `public/sop-assets/apr-2026/`
- May assets: `public/sop-assets/may-2026/`
- May gallery: `public/sop-assets/may-2026/index.html`

Frontend SOP image candidates are loaded from versioned JSON manifests:

- `public/sop-assets/may-2026/manifest.json`
- `public/sop-assets/apr-2026/manifest.json`

`src/components/WAMessageComposer.jsx` loads these manifests at runtime and ranks image candidates by current topic, intent, scene, owner-saved templates, and static SOP metadata.

Rules:

- Store image references as URL media items such as `/sop-assets/may-2026/image10.png`.
- Do not embed image bytes in DB template rows.
- Add `sourceTitle` in each image manifest so the picker labels the source correctly.
- Run `scripts/validate-sop-image-manifest.cjs` after changing a SOP image manifest.
- Operators can click a saved-template image thumbnail to open a larger preview.

## Current Verification

Required checks after template retrieval or image-picker changes:

```bash
node --check server/routes/customTopicTemplates.js
node --check server/services/localRuleRetrievalService.js
node scripts/validate-knowledge-manifest.cjs
node scripts/test-may-template-retrieval.cjs
node scripts/test-local-rule-retrieval.js
node scripts/validate-sop-image-manifest.cjs public/sop-assets/may-2026/manifest.json
node scripts/validate-sop-image-manifest.cjs public/sop-assets/apr-2026/manifest.json
npm run build
```

Runtime checks:

- `GET /api/health`
- `GET /sop-assets/may-2026/index.html`
- `GET /sop-assets/may-2026/image10.png`
- Manual browser check:
  - save an image-only template;
  - click the thumbnail and confirm large preview;
  - delete a saved template and confirm it disappears from the saved list;
  - send text and media separately from Reply Deck.

## Known Risks

1. Policy/high-claim content remains present in the May SOP source.
   - Some GMV, conversion-rate, incentive, and compensation claims are retained for operator context.
   - `sendable: false` and review notes reduce direct-send risk but do not replace human policy review.

2. Static SOP image mapping can drift.
   - Static image metadata is now manifest-maintained rather than frontend constant-maintained.
   - If images are reordered or replaced, labels and topics must be reviewed manually and `scripts/validate-sop-image-manifest.cjs` must pass.

3. Custom template upsert is still label-based.
   - Duplicate `owner_scope + label` updates an existing row regardless of topic/intent.
   - Bulk imports must run `scripts/validate-custom-topic-template-import.cjs`.

4. Global template mutation is intentionally limited.
   - Owner-scoped users can read global templates but cannot update/delete global rows through the owner-scoped route.
   - Admin-created global template management may need a separate admin UX if global templates become common.

5. Soft delete does not rewrite historical cards or messages.
   - Deleted templates disappear from future GET results.
   - Existing in-memory UI state or previously selected Reply Deck slots may remain until reload/regeneration.

6. Manifest and built frontend need deployment discipline.
   - Manifest changes require a Node process restart.
   - Frontend image-picker changes require `npm run build` for static production assets.

## Obsidian Sync

- Status: synced
- Note: `docs/obsidian/notes/2026-05-07-template-system-design.md`
- Index: `docs/obsidian/index.md`
