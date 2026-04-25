# WA CRM v2 Obsidian Memory Standard

Date: 2026-04-25
Status: Active
Owner: WA CRM maintainers and AI agents

## 1. Decision

WA CRM v2 uses an Obsidian-compatible vault as the active shared-memory target.

The canonical vault is stored inside this repository:

- Vault root: `docs/obsidian/`
- Memory index: `docs/obsidian/index.md`
- Note directory: `docs/obsidian/notes/`
- Templates: `docs/obsidian/templates/`

The desktop Obsidian mirror path is:

- `/Users/depp/depp's obsidan/Projects/WA CRM v2/`

This keeps project memory versioned, reviewable, and available to every agent that can read the repo. If a human later mirrors `docs/obsidian/` into an external Obsidian vault, the repo copy remains the canonical project record.

## 2. Source Of Truth

Project facts must be written in this order:

1. Update the canonical repository document first.
2. Write or update an Obsidian memory note under `docs/obsidian/notes/`.
3. Update `docs/obsidian/index.md`.
4. Add or refresh an `Obsidian Sync` section in the source document when the document is a spec, standard, checklist, design, runbook, PRD, rollout note, or dated handoff.

The repository document is the operational source of truth. Obsidian notes are durable summaries and navigation anchors, not a replacement for the full document.

## 3. What Must Be Synced

Sync an Obsidian note whenever a document is created or materially updated in any of these categories:

- Standard, spec, checklist, or agent working rule.
- Design, architecture, PRD, technical plan, or implementation baseline.
- Runbook, rollout plan, deployment note, or rollback decision.
- Routing, model, RAG, policy, SFT, lifecycle, security, or permission decision.
- Dated handoff that contains decisions, verification results, or remaining work.

Do not create Obsidian notes for:

- Raw exports, generated reports, screenshots, logs, caches, or local runtime state.
- Secrets, `.env` values, tokens, wa_phone values, or private message bodies.
- Pure code edits that do not change a documented decision or workflow.

## 4. Note Naming

Use one note per source document or decision bundle.

Format:

```text
docs/obsidian/notes/YYYY-MM-DD-short-kebab-title.md
```

Examples:

- `docs/obsidian/notes/2026-04-25-obsidian-memory-standard.md`
- `docs/obsidian/notes/2026-04-25-event-lifecycle-data-model.md`

If a source document is updated later, update the existing note instead of creating a duplicate unless the update is a distinct decision.

## 5. Required Frontmatter

Every Obsidian memory note must start with YAML frontmatter:

```yaml
---
title: Short title
date: YYYY-MM-DD
project: wa-crm-v2
type: standard|design|runbook|handoff|decision|review|status
source_path: docs/example.md
status: active|superseded|historical
tags:
  - wa-crm-v2
  - memory
---
```

Optional fields:

- `related`: source paths or note paths.
- `supersedes`: previous note path.
- `rollout`: rollout status or verification status.

## 6. Required Note Body

Each note must contain:

1. Summary.
2. Key decisions.
3. Source document path.
4. Verification or rollout notes.
5. Follow-up items.

Keep the note concise. The goal is fast retrieval, not copying the whole source document.

## 7. Source Document Sync Block

Specs, standards, PRDs, runbooks, rollout docs, and handoffs should end with:

```markdown
## Obsidian Sync

- Status: synced
- Note: `docs/obsidian/notes/YYYY-MM-DD-short-kebab-title.md`
- Index: `docs/obsidian/index.md`
```

For historical documents that predate this standard, use:

```markdown
## Obsidian Sync

- Status: historical-backfill
- Note: `docs/obsidian/notes/YYYY-MM-DD-short-kebab-title.md`
```

## 8. Retired External Memory Rules

External shared-memory services and CLI-based memory tools are not part of this repository's active workflow.

Agents must not:

- Create external shared-memory entries for WA CRM v2.
- Treat external shared-memory write failures as a blocker.
- Ask for external memory CLI or token debugging as part of the standard workflow.

Historical documents were cleaned on 2026-04-25 so the active documentation set points to Obsidian only.

## 9. Session Closeout

When ending a session, report:

1. Three things completed.
2. Remaining work.
3. Obsidian sync status:
   - `synced: <note path>`
   - `not required: <reason>`
   - `blocked: <reason>`
4. Ask: `要继续吗？`

Do not report legacy external-memory sync states; report Obsidian sync status instead.

## 10. Verification

After changing memory or documentation rules, run:

```bash
rg -n "Obsidian Sync|docs/obsidian|OBSIDIAN_MEMORY_STANDARD" -g '*.md'
```

Expected result:

- New active rules point to Obsidian.
- Legacy external-memory terms are absent from project documentation.
- New or updated normative documents include an Obsidian sync block when applicable.
