# Recent Branch And Documentation Mapping

Date: 2026-04-27
Remote of record: Gitea `origin` (`git@git.k2lab.ai:K2Lab/whatsapp-mgr.git`)
Status: Active reference

This document maps the recent WA CRM v2 branches, Gitea PRs, and archive tags to their handoff documents and Obsidian notes. Use this as the quick entry point before reopening recent work.

## Current Local Branch State

| Local branch | Status vs `origin/main` | Handling |
| --- | --- | --- |
| `main` | Synced to `origin/main` at `76f59a3` | Current baseline branch. |
| `codex/mysqloptimize` | Preserved intentionally; do not modify without explicit request | User asked to leave this branch untouched. |

Removed local branches after merge:

- `codex/contact-import-template-assets`
- `codex/eventoptimize`
- `codex/import`
- `codex/my` (mistaken branch)
- `codex/local-archive-20260420` (replaced by archive tag)

## Recent Gitea PR Mapping

| Gitea PR / merge | Source branch | Main commit | Primary scope | Repository docs | Obsidian notes |
| --- | --- | --- | --- | --- | --- |
| `#77` `feat: 功能：新增所有者范围内的联系人管理和模板媒体资源` | `codex/contact-import-template-assets` | `76f59a3` merge, `3be6d8a` feature | Owner-scoped contact management, batch creator import, optional welcome sending, template media decoupling | `docs/CREATOR_IMPORT_WELCOME_HANDOFF_20260426.md`, `docs/archive/handoffs/TEMPLATE_CUSTOM_TOPIC_HANDOFF_20260424.md` | `docs/obsidian/notes/2026-04-26-creator-import-welcome-handoff.md`, `docs/obsidian/notes/2026-04-26-template-custom-topic-handoff.md` |
| `#76` `feat: add active event detection queue` | `codex/import` | `e761059` merge, `f34e1ca` feature | Active event detection queue, dry-run/write rollout, message supplement integration, repair hooks | `docs/ACTIVE_EVENT_DETECTION_HANDOFF_20260426.md` | `docs/obsidian/notes/2026-04-26-active-event-detection-handoff.md` |
| `#74` `eventoptimize` | `codex/eventoptimize` | `bc811d1` merge, `cec106b` docs tail | Event/lifecycle backfill hardening, docs index, core module handoff | `docs/EVENT_LIFECYCLE_BACKFILL_HANDOFF_20260425.md`, `docs/DOCS_INDEX.md`, `docs/CORE_MODULES_OVERVIEW.md` | `docs/obsidian/notes/2026-04-25-event-lifecycle-backfill-handoff.md`, `docs/obsidian/notes/2026-04-25-docs-index-and-core-modules.md` |
| `#75` `fix: sync V1 layout follow-up with latest main` | `codex/v1-layout-followup-sync` | `bbccdab` merge, `fa75ec7` feature | V1/V2 layout follow-up sync | `docs/archive/handoffs/V1_LAYOUT_HANDOFF_20260425.md`, `docs/archive/handoffs/V1_LAYOUT_FOLLOWUP_HANDOFF_20260425.md` | `docs/obsidian/notes/2026-04-25-v1-layout-handoff.md` |
| `#73` `feat: recover custom topic templates` | `feat/template-custom-recover` | `6ec538d` merge, `f787157` asset tail | Custom topic templates, April SOP assets, knowledge manifest updates | `docs/archive/handoffs/TEMPLATE_CUSTOM_TOPIC_HANDOFF_20260424.md`, `docs/rag/APRIL_DOC_CONFIG_MAPPING_20260420.md`, `docs/rag/knowledge-manifest.json` | `docs/obsidian/notes/2026-04-26-template-custom-topic-handoff.md` for the later media-decoupling update |

## Archive Tag Mapping

| Tag | Original branch / snapshot | Preserved commit | Contents | Guidance |
| --- | --- | --- | --- | --- |
| `archive/local-archive-20260420` | `codex/local-archive-20260420` | tag object `a525922`, commit `bd2734e` | 2026-04-20 local archive containing AI Providers admin panel, LLM provider DB config, usage logging, package/schema/app changes, and archived uncommitted residue | Do not merge directly. Cherry-pick small pieces only if the AI Providers work is reopened. |
| `archive/fix-reply-deck-close-and-layout-20260424` | historical branch cleanup | `db81c44` | Reply Deck close/layout related historical cleanup | Keep as historical reference. |
| `archive/mergev1-20260424` | historical mergev1 work | `837ce11` | V1 board/cross-app navigation historical state | Keep as historical reference. |
| `archive/template-pop-20260424` | historical template-pop work | `95ca5fc` | Template-first Reply Deck historical state | Keep as historical reference. |

## Compatibility Notes

- `origin/main` is the only remote baseline for current work. Do not use GitHub remote state for local branch decisions unless explicitly requested.
- `codex/mysqloptimize` is intentionally preserved and may be older than `origin/main`; avoid merging or rebasing it without a separate task.
- `archive/local-archive-20260420` is not compatible with current `origin/main` as a direct merge because it predates the latest event queue, contact management, dynamic owner, and template media changes. Treat it as a source for selective cherry-picks.
- The contact/import/template work in PR `#77` supersedes earlier assumptions that SOP images are bound to text templates. Image assets are now separate media templates.

## Operational Checklist

When a future agent resumes recent work:

1. Start from `main` synced to Gitea `origin/main`.
2. Read this document and then the relevant handoff document in the mapping table.
3. Check `docs/obsidian/index.md` for the matching memory note.
4. If touching an archived feature, inspect the archive tag first instead of resurrecting old local branches.
5. Keep `codex/mysqloptimize` untouched unless the user explicitly asks to work on MySQL optimization.

## Obsidian Sync

- Status: synced
- Note: `docs/obsidian/notes/2026-04-27-recent-branch-doc-mapping.md`
- Index: `docs/obsidian/index.md`
