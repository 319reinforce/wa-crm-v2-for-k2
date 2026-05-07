# May Template Rollout Kickoff

Date: 2026-05-07
Status: Superseded by implementation handoff
Branch: `codex/may-template-kickoff`
Source docx: `/Users/depp/Downloads/达人建联各SOP话述(5月版) (1).docx`
Superseding handoff: `docs/MAY_TEMPLATE_ROLLOUT_HANDOFF_20260507.md`
System design: `docs/TEMPLATE_SYSTEM_DESIGN_20260507.md`

## Goal

Prepare a safe path to merge the May creator outreach SOP templates into WA CRM v2 after production rollout, then rebuild/restart the app so the latest template source is visible to operators.

This document started as a planning-only kickoff. On 2026-05-07 it was updated with the May Markdown SOP conversion, retrieval hardening, and validation notes.

## Current Template Storage Map

WA CRM v2 currently has three different template layers:

1. `custom_topic_templates`
   - API: `GET/POST/PUT /api/custom-topic-templates`
   - Main files: `server/routes/customTopicTemplates.js`, `src/components/WAMessageComposer.jsx`
   - Storage: MySQL rows with `label`, `topic_group`, `intent_key`, `scene_key`, `template_text`, `media_items_json`, and `owner_scope`.
   - Best fit: operator-maintained topic templates, including image-only templates.

2. `operator_outreach_templates`
   - API: `/api/creator-import-batches/outreach-templates`
   - Main files: `server/services/creatorImportBatchService.js`, `server/routes/creatorImportBatches.js`, `src/App.jsx`
   - Storage: MySQL rows keyed by `owner + template_key`; import batches snapshot `welcome_text`.
   - Best fit: owner-specific welcome copy used during batch creator import.

3. Manifest-backed Reply Deck templates
   - API: `POST /api/experience/retrieve-template`
   - Main files: `server/services/localRuleRetrievalService.js`, `docs/rag/knowledge-manifest.json`, `docs/rag/sources/`
   - Storage: tracked Markdown SOP files plus a JSON manifest.
   - Best fit: standard SOP/source templates shared across operators.

## May Docx Initial Read

The uploaded file was readable and contains 370 extracted text paragraphs. It appears to be a mixed SOP pack with:

- first outreach scripts;
- May new-user and pre-May existing-user policy sections;
- Moras explanation and case/data copy;
- MCN binding, settlement, posting, ad authorization, product, violation, appeal, referral, and version-update copy;
- image placeholders/sections for policy screenshots, but not yet mapped to repo asset paths.

Important content-risk note: although the file name says May version, the extracted text still includes some April wording and high-claim statements. Before import, the content should be normalized and policy-reviewed instead of blindly copied into production templates.

## Recommended Rollout Path

Use a two-track import instead of directly merging a historical template branch:

1. Convert the docx into a structured Markdown source under `docs/rag/sources/`, likely `sop-creator-outreach-may-2026-v1.md`.
2. Add one manifest entry to `docs/rag/knowledge-manifest.json` with explicit `scene`, `topic`, `keywords`, `effective_from`, and `priority`.
3. For high-frequency operator-specific quick replies, optionally seed selected rows into `custom_topic_templates` via API or a reviewed script after schema readiness is confirmed.
4. For bulk-import welcome copy only, update `operator_outreach_templates` through its API; do not mix that welcome copy with Reply Deck SOP templates unless the same text is intentionally approved for both workflows.
5. If screenshot assets from the docx are needed, extract them to a dated directory such as `public/sop-assets/may-2026/` and reference them through `media_items`.
6. After deployment, rebuild/restart the app process. `localRuleRetrievalService` caches the manifest in-process, so a process restart is the reliable way to load a changed manifest.

## Branch Merge Assessment

Direct branch merge is not the right path for the May template update.

- `origin/feat/template-custom-recover` is already in current `main`.
- `github/codex/contact-import-template-assets` is already in current `main`.
- `origin/template-pop` is an archived April-era template branch. A dry merge analysis shows conflicts across Reply Deck and template retrieval files, and it does not contain the May docx content.

The safer approach is a fresh May source/template import branch based on current `main`.

## Template Logic Review Findings

### P1: Fixed template shortcut can shadow newer SOP sources

`retrieveTemplateSlots()` returns `FIXED_TOPIC_TEMPLATES[intent_key]` before reading `docs/rag/knowledge-manifest.json`. For `outreach_contact`, `resolveIntentKey()` defaults to `first_outreach_fixed`, so the hard-coded initial outreach text can win permanently over a May SOP source. If May changes first-touch copy, adding a new Markdown source alone may not affect op1.

Relevant code:

- `server/services/localRuleRetrievalService.js:243`
- `server/services/localRuleRetrievalService.js:257`
- `server/services/localRuleRetrievalService.js:758`

Suggested follow-up: either remove the hard-coded first-touch shortcut, lower it to a fallback after manifest ranking, or move fixed templates into the same source/manifest path as May templates.

### P2: SOP metadata inference depends on brittle English heading strings

`inferSectionMetadata()` assigns topic/intent by checking phrases like `script a`, `invite code reply`, `whatsapp first check-in`, and `appeal template`. The May docx uses many Chinese headings, numeric section titles, and mixed-language labels, so a straightforward Markdown conversion may fall through to broad defaults or the wrong intent.

Relevant code:

- `server/services/localRuleRetrievalService.js:423`
- `server/services/localRuleRetrievalService.js:439`
- `server/services/localRuleRetrievalService.js:560`

Suggested follow-up: include explicit metadata in the May Markdown sections or add a small structured template manifest so routing does not depend on heading wording.

### P2: Custom template upsert is keyed only by owner scope and label

`POST /api/custom-topic-templates` updates an existing row when `owner_scope + label` matches, regardless of `topic_group` or `intent_key`. During bulk May import, repeated labels such as "打招呼", "产品介绍", or "违规指导" across different topic groups could overwrite one another.

Relevant code:

- `server/routes/customTopicTemplates.js:134`
- `server/routes/customTopicTemplates.js:141`

Suggested follow-up: use stable unique labels during import or add an import guard/report that detects duplicate labels before calling the API.

### P3: SOP image UI still labels imported image topics as April assets

The image-only helper currently sets `routeSourceTitle` to `4月版 SOP 图片`. If May image assets are added, operators may see the wrong source label even when the media URL points to May assets.

Relevant code:

- `src/components/WAMessageComposer.jsx:2903`
- `src/components/WAMessageComposer.jsx:2917`

Suggested follow-up: make the source title dynamic when May assets are introduced.

## Pre-Implementation Checklist

- [x] Parse the docx into a review Markdown draft and mark section boundaries.
- Identify which sections are policy, which are sendable templates, and which are internal notes.
- [x] Remove or rewrite stale April-only language found in the first outreach section.
- Review claims involving GMV, conversion rates, guarantees, compensation, platform fees, and MCN requirements before exposing them to AI or operators.
- Decide which templates belong in manifest-backed Reply Deck versus DB-backed custom templates.
- [x] Create validation cases for at least:
  - initial outreach;
  - May new-user policy;
  - existing-user policy;
  - MCN binding;
  - payout/settlement;
  - posting safety;
  - product recommendation logic;
  - violation appeal.
- After import, run `node --check server/services/localRuleRetrievalService.js`, existing template retrieval tests, and a local browser check of op1/op2 template cards.
- Rebuild/restart production after merge so the manifest cache is refreshed.

## Implementation Update — 2026-05-07

The May docx was converted into `docs/rag/sources/sop-creator-outreach-may-2026-v1.md` with explicit section-level `template-meta` blocks. This makes Chinese titles such as `规则+MCN机制（文字版/图片版）`, `发布数量+产品tips`, and `视频违规指导  违规申诉话术参考` route by declared `topic_group`, `intent_key`, and `scene_keys` rather than brittle heading inference.

The May source was added to `docs/rag/knowledge-manifest.json` as `sop-creator-outreach-may-2026-v1` with `priority: 0`, `status: approved`, and `effective_from: 2026-05-07`.

Runtime retrieval was hardened so `FIXED_TOPIC_TEMPLATES` only acts as a fallback when no manifest-backed section is found. This prevents the hard-coded first outreach shortcut from permanently shadowing the May SOP source.

DB import collision risk is handled by `scripts/validate-custom-topic-template-import.cjs`, which checks `owner_scope + label` duplicates before any future bulk import into `custom_topic_templates`. No DB templates were inserted in this rollout step.

Post-change retrieval validation is covered by `scripts/test-may-template-retrieval.cjs` for initial outreach, May new-user policy, existing-user policy, MCN binding, settlement, posting safety, product recommendation logic, and violation appeal.

## Image Asset Import Update — 2026-05-07

The May docx embedded images were extracted separately from the Markdown/DB templates into `public/sop-assets/may-2026/`.

Imported files:

- `image1.png` through `image17.png`/`.jpeg` from `word/media/`
- Gallery index: `public/sop-assets/may-2026/index.html`

The frontend SOP image picker now includes May image-only candidates ahead of the April candidates. Each May candidate stores only the static URL such as `/sop-assets/may-2026/image10.png` in `media_items`; template text remains empty for image-only saves.

The old hard-coded image source label was replaced with a per-item `sourceTitle`, so May images show as `5月版 SOP 图片` and April images remain `4月版 SOP 图片`.

## UI Follow-Up Update — 2026-05-07

Saved custom topic templates now support:

- large image preview from the save/update modal thumbnail;
- soft delete through `DELETE /api/custom-topic-templates/:id`;
- refreshed saved-template list after delete.

The canonical implementation handoff is now `docs/MAY_TEMPLATE_ROLLOUT_HANDOFF_20260507.md`.

Verification on 2026-05-07:

- `node --check server/services/localRuleRetrievalService.js` passed.
- `node scripts/validate-knowledge-manifest.cjs` passed.
- `node scripts/test-may-template-retrieval.cjs` passed 8/8.
- `node scripts/test-local-rule-retrieval.js` passed 7/7 after updating the trial-intro shadow expectation to include the May source.
- `npm run build` completed successfully.
- A restarted verification server on `PORT=3010` returned `/api/health` OK and `POST /api/experience/retrieve-template` returned `op1.source = sop-creator-outreach-may-2026-v1` for first outreach.
- After image import, old `ssh` listener PID `85672` was closed because it occupied ports `3000` and `3001`.

Restart note: ports `3000` and `3001` were initially occupied by local `ssh` listeners. The verification restart used `PORT=3010 LOCAL_API_AUTH_BYPASS=true`; that process was stopped after verification. The later image-import verification should use a normal local `npm start` on port `3000` after the listener is closed.

## Open Questions

- Should May templates supersede April templates globally, or should both remain addressable by version?
- Which owner(s) should see the May templates by default?
- Are the case links and GMV claims approved for operator-facing use?
- Image assets from the docx were extracted into `public/sop-assets/may-2026/` and exposed through static URL media items.
- Should first outreach be moved out of hard-coded `FIXED_TOPIC_TEMPLATES` before this rollout?

## Obsidian Sync

- Status: synced
- Note: `docs/obsidian/notes/2026-05-07-may-template-rollout-kickoff.md`, `docs/obsidian/notes/2026-05-07-may-template-rollout-handoff.md`
- Index: `docs/obsidian/index.md`
