# Reply Deck Image Template Development Plan

Date: 2026-05-07
Status: Implemented frontend / pending browser QA
Scope: Composer image picker, Reply Deck image recommendation slot, SOP image metadata, owner-scoped template management

## Background

The May template rollout introduced static SOP image assets and DB-backed image-only custom topic templates. Current behavior is useful but split across different UI surfaces:

- The composer image button opens local file selection directly.
- The SOP image library is available inside the template management modal, not as the default image-send flow.
- Reply Deck has four visible cards: `op1` recommended template, `op2` original template, `op3` AI option 1, and `op4` AI option 2.
- Template thumbnails can open a large preview in the template management modal, but Reply Deck media thumbnails still open browser tabs.

Target behavior from the screenshots:

1. The image icon in the composer opens the template image library by default.
2. Local image upload remains available as a separate UI action inside that image flow.
3. Reply Deck adds a recommended image card as `op3`.
4. AI generated replies shift behind it to `op4` and `op5`.
5. Existing visual style and interaction density stay consistent.
6. Clicking any recommended/template image opens an in-app large preview.

## Current Code Map

Frontend:

- `src/components/WAMessageComposer.jsx`
  - `SOP_IMAGE_TOPIC_TEMPLATES` currently hard-codes May/April SOP image candidates.
  - `handlePickImage()` and `handleImageFileChange()` drive local image upload.
  - `templateImagePreview` renders the current large preview overlay.
  - `sendTemplateMediaItem()` sends a URL-backed template image as standalone media.
  - Topic/template modal can load saved templates and SOP image candidates.
- `src/components/AIReplyPicker.jsx`
  - Renders current fixed card order: template `op1`, template `op2`, AI `op3`, AI `op4`.
- `src/components/StandardReplyCard.jsx`
  - Renders template text/media and supports standalone image sending.
  - Media thumbnails currently use anchors to open a new tab.

Backend and data:

- `server/routes/customTopicTemplates.js`
  - Owner-scoped `GET/POST/PUT/DELETE /api/custom-topic-templates`.
  - Owner-scoped users can read global templates but cannot update/delete them.
  - Upsert key remains `owner_scope + label`.
- `server/services/localRuleRetrievalService.js`
  - Returns template slots and custom template sections.
- `schema.sql`
  - `custom_topic_templates` unique key is `uk_custom_topic_owner_label (owner_scope, label)`.
- `scripts/validate-custom-topic-template-import.cjs`
  - Guards bulk import against duplicate labels before DB writes.

## Product Decisions

1. Composer image icon becomes a two-source image picker:
   - Default tab: template image library.
   - Secondary tab/action: local image upload.
   - The existing local-upload behavior is retained but no longer the first click outcome.

2. Template image library should include:
   - Recommended images for the current topic/operator first.
   - Saved DB image templates for the current owner and global scope.
   - Static SOP images from May/April metadata.
   - Search and topic filters once the list is larger than a single viewport.

3. Reply Deck slot order becomes:
   - `op1` recommended text template.
   - `op2` original/reference text template.
   - `op3` recommended image.
   - `op4` AI option 1.
   - `op5` AI option 2.

4. Images remain independently sendable media. They are not auto-appended to AI or text replies.

5. `op3` is a recommendation surface, not a forced send. If no image is available, it shows the same empty-card treatment as the current template cards.

6. Large preview should be in-app for:
   - Composer image library thumbnails.
   - Reply Deck `op3` image thumbnails.
   - Saved template image thumbnails.

## Phased Implementation

### Phase 0: Preflight And Data Shape

Goals:

- Confirm all image-related UI paths before editing.
- Define one frontend image candidate shape reused by picker, Reply Deck, and saved templates.

Implementation notes:

- Grep all references to `SOP_IMAGE_TOPIC_TEMPLATES`, `media_items`, `templateImagePreview`, `handlePickImage`, and `sendTemplateMediaItem`.
- Introduce a normalized frontend shape:

```js
{
  id,
  label,
  url,
  sourceTitle,
  topic_group,
  intent_key,
  scene_key,
  summary,
  owner_scope,
  custom_template_id,
  rank
}
```

Acceptance:

- No behavior change yet.
- Existing image-only templates and local upload continue to work.

### Phase 1: Composer Image Picker

Goals:

- Change image icon click from direct local file chooser to an image picker modal.
- Keep local file selection as a clear secondary UI.

Implementation notes:

- Replace `handlePickImage()` behavior with `setImagePickerOpen(true)`.
- Add a modal in `WAMessageComposer.jsx` using existing WA theme styling.
- Default view opens to template image library.
- Add a local-upload button that calls `mediaInputRef.current?.click()`.
- Reuse the existing hidden file input and `handleImageFileChange()` for local files.
- Keep pending local image preview/caption/send flow unchanged after a local file is selected.
- Allow actions from template image cards:
  - `预览`: opens `templateImagePreview`.
  - `发送图片`: calls `sendTemplateMediaItem()`.
  - `保存/更新模板`: opens existing template management modal when applicable.

Acceptance:

- Clicking the composer image icon opens template library first.
- Local upload is still available with one extra intentional click.
- No regression to caption send for local images.

### Phase 2: Image Recommendation Ranking

Goals:

- Provide the best image candidate for Reply Deck `op3`.
- Avoid hard-coding the recommendation only by visible label.

Implementation notes:

- Build `getRecommendedImageCandidate({ currentTopic, savedCustomTopicTemplates, operator })`.
- Rank in this order:
  - Current selected custom template image for the exact topic/intent.
  - Saved DB image templates matching current `topic_group + intent_key`.
  - Static SOP image candidates matching current `topic_group + intent_key`.
  - Static SOP image candidates matching `topic_group`.
  - No image.
- De-duplicate by URL.
- Keep risky image summaries visible as operator context, but do not block send in this phase because send-time review remains the policy gate.

Acceptance:

- `op3` is deterministic for the same topic state.
- Image recommendations favor owner-specific saved templates over generic static SOP images.

### Phase 3: Reply Deck Five-Slot UI

Goals:

- Add `op3 推荐图片`.
- Shift AI cards to `op4 AI 方案一` and `op5 AI 方案二`.
- Preserve existing horizontal card style, deck resizing, loading states, and send controls.

Implementation notes:

- Add an image-specific card component or extend `StandardReplyCard` with a cleaner media-only mode.
- Update `AIReplyPicker.jsx` slot order and badge labels.
- Leave `handleSelectCandidate()` model/SFT semantics unchanged for AI text options:
  - AI option 1 still maps to `opt1`.
  - AI option 2 still maps to `opt2`.
  - Only display labels shift to `op4/op5`.
- Add `onPreviewTemplateMedia` callback to avoid opening images in a new browser tab.
- Keep template text send behavior unchanged for `template_op1/template_op2`.

Acceptance:

- Reply Deck shows five cards on desktop horizontal scroll.
- The red-gap area in the screenshot is occupied by recommended image `op3`.
- AI generation button still creates two AI text candidates.
- SFT records still use `human_selected: opt1/opt2` for AI sends and `custom` for template sends.

### Phase 4: In-App Large Preview Everywhere

Goals:

- Use one preview overlay for all template/library/reply-deck images.

Implementation notes:

- Lift the existing `templateImagePreview` pattern into callbacks passed to `AIReplyPicker` and `StandardReplyCard`.
- Replace media thumbnail anchors in `StandardReplyCard` with buttons.
- Keep URL text visible in management modal for debugging broken static paths.

Acceptance:

- Clicking `op3` image opens a large in-app preview.
- Clicking saved template images opens the same overlay.
- Escape/click backdrop/close button behavior is consistent.

### Phase 5: Metadata Drift Optimization

Problem:

- `SOP_IMAGE_TOPIC_TEMPLATES` is currently manually maintained in code. If a docx is re-imported, image order, labels, or topics can drift from the actual assets.

Recommended solution:

1. Move static image metadata out of `WAMessageComposer.jsx` into a versioned JSON manifest:

```text
public/sop-assets/may-2026/manifest.json
```

2. Generate the manifest from the docx conversion script:

```text
scripts/convert-may-docx-to-sop-md.py
```

3. Include stable verification fields:
   - `asset_version`
   - `source_doc`
   - `image_file`
   - `sha256`
   - `width`
   - `height`
   - `label`
   - `topic_group`
   - `intent_key`
   - `scene_key`
   - `review_status`
   - `risk_note`

4. Add a validator:

```text
scripts/validate-sop-image-manifest.cjs
```

5. Make the frontend load static image manifests via an API or static JSON fetch instead of importing a code constant.

Rollout path:

- Phase 5A: create JSON manifest and validator while keeping the code constant as fallback.
- Phase 5B: switch UI to load the JSON manifest.
- Phase 5C: delete or reduce `SOP_IMAGE_TOPIC_TEMPLATES` to a fallback-only compatibility path.

Benefits:

- Updating image labels/categories no longer needs a frontend code edit.
- Re-imported docx assets can be verified by checksum and dimensions.
- Gallery, picker, and Reply Deck all read the same source of truth.

### Phase 6: Owner-Scoped Template Management Hardening

Current risk:

- DB custom template upsert is still keyed by `owner_scope + label`.
- Owner-scoped users can read global templates but cannot update/delete global rows.

Plan:

- Keep owner-scoped read-only behavior for global templates in this feature.
- In the image picker, label global templates as read-only.
- Disable update/delete actions for `owner_scope: global` unless admin mode is explicitly implemented.
- Before any bulk import, require:

```bash
node scripts/validate-custom-topic-template-import.cjs <templates.json>
```

Future schema option:

- Add a migration to prefer uniqueness by `owner_scope + topic_group + intent_key + label`.
- Update POST behavior to reject ambiguous overwrites unless an explicit `id` is supplied.
- Keep backward compatibility until existing rows are audited.

### Phase 7: Deployment Discipline And Hot Update Path

Current risk:

- Knowledge manifest updates require Node restart.
- Frontend template UI changes require build.

Plan:

- For this feature's static image metadata, prefer runtime JSON loading so image-label/category updates do not require `npm run build`.
- If an API is added for image manifests, use mtime-based reload or short TTL to avoid Node restarts for image metadata.
- Keep `docs/rag/knowledge-manifest.json` behavior unchanged unless separately scoped.

## Verification Plan

Code checks:

```bash
node --check server/routes/customTopicTemplates.js
node --check server/services/localRuleRetrievalService.js
node scripts/validate-knowledge-manifest.cjs
node scripts/test-may-template-retrieval.cjs
node scripts/test-local-rule-retrieval.js
npm run build
```

Additional checks after Phase 5:

```bash
node scripts/validate-sop-image-manifest.cjs public/sop-assets/may-2026/manifest.json
```

Manual QA:

1. Open a creator with an active topic.
2. Click the composer image icon.
3. Confirm the template image library opens by default.
4. Preview a template image in-app.
5. Send a template image as standalone media.
6. Use the local-upload action and confirm the old pending-image caption flow still works.
7. Open Reply Deck.
8. Confirm card order is `op1`, `op2`, `op3 推荐图片`, `op4 AI 方案一`, `op5 AI 方案二`.
9. Click the `op3` image and confirm large preview opens.
10. Generate AI and confirm AI sends still persist SFT as `opt1` / `opt2`.

## Implementation Update 2026-05-07

Implemented in this pass:

- Composer image icon now opens a template image library modal by default.
- Local image upload remains available through a `本地选择` action inside that modal and still uses the existing pending-image caption flow.
- Reply Deck now renders five cards: `op1` recommended template, `op2` original template, `op3 推荐图片`, `op4 AI 方案一`, and `op5 AI 方案二`.
- `op3` is ranked from owner/global saved image templates and static SOP images, preferring current topic/intent matches.
- Reply Deck image thumbnails now use the in-app large preview instead of opening a browser tab.
- Static May image metadata now lives in `public/sop-assets/may-2026/manifest.json` with checksum, dimensions, route metadata, review status, and risk note.
- Static April image metadata now lives in `public/sop-assets/apr-2026/manifest.json`; frontend image candidates no longer depend on April/May hard-coded image constants.
- Added `scripts/validate-sop-image-manifest.cjs` to validate manifest fields, duplicated URLs, file presence, SHA-256, and dimensions.

Verification completed:

```bash
node --check scripts/validate-sop-image-manifest.cjs
node scripts/validate-sop-image-manifest.cjs public/sop-assets/may-2026/manifest.json
node scripts/validate-sop-image-manifest.cjs public/sop-assets/apr-2026/manifest.json
node --check server/routes/customTopicTemplates.js
node --check server/services/localRuleRetrievalService.js
node scripts/validate-knowledge-manifest.cjs
node scripts/test-may-template-retrieval.cjs
node scripts/test-local-rule-retrieval.js
npm run build
```

Results:

- SOP image manifest validation passed for 17 May images.
- SOP image manifest validation passed for 15 April images.
- May template retrieval passed 8/8.
- Local rule shadow cases passed 7/7.
- Production build completed.
- Runtime server started on `http://localhost:3001` because port `3000` was held by an unresponsive existing Node process.
- `GET /api/health` returned OK on port `3001`.
- `HEAD /sop-assets/may-2026/manifest.json` returned 200 on port `3001`.

Remaining:

- Browser QA should confirm the modal layout, local upload path, `op3` preview, and standalone media send in the running app.
- Browser QA should still confirm the modal layout, local upload path, `op3` preview, and standalone media send in the running app.

## Implementation File List

Expected frontend files:

- `src/components/WAMessageComposer.jsx`
- `src/components/AIReplyPicker.jsx`
- `src/components/StandardReplyCard.jsx`

Expected docs/data files:

- `docs/REPLY_DECK_IMAGE_TEMPLATE_PLAN_20260507.md`
- `public/sop-assets/may-2026/manifest.json`

Possible scripts:

- `scripts/validate-sop-image-manifest.cjs`
- Updates to `scripts/convert-may-docx-to-sop-md.py`

Possible backend only if runtime manifest API is chosen:

- `server/routes/sopAssets.js`
- `server/index.cjs`

## Rollback Plan

- If image picker modal has issues, restore image icon to call local file input directly and leave template images accessible via existing template management modal.
- If five-slot Reply Deck layout is too wide for operators, keep data plumbing but hide `op3` behind a feature flag.
- If JSON image manifest loading fails, fall back to the existing code-maintained `SOP_IMAGE_TOPIC_TEMPLATES` list until the manifest is repaired.

## Open Questions

- Should `op3` prefer globally reviewed SOP images over owner-specific saved images when both match exactly?
- Should send-time review block high-risk SOP images, or only high-risk text claims?
- Should local upload live as a tab, a footer button, or a compact secondary icon inside the image picker?
- Do admins need global template CRUD in the same pass, or should it remain a separate admin UI project?

## Obsidian Sync

- Status: synced
- Note: `docs/obsidian/notes/2026-05-07-reply-deck-image-template-plan.md`
- Index: `docs/obsidian/index.md`
