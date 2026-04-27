# Local Rule Shadow Cases

Date label: `2026-04-20`

These fixtures define the first validation set for local rule retrieval.

The goal is not to test model quality. The goal is to ensure that deterministic local retrieval can find the right authoritative source before any local rule cards are injected into the reply prompt.

## Files

- `local-rule-shadow-cases.json`: source-grounding cases for trial, payment, posting safety, and violation-risk flows.
- Historical design context is retained in Obsidian; the active future direction is profile/skill memory rather than expanding RAG.

## Validation

Run:

```bash
npm run test:unit
```

The unit tests verify that:

- Approved manifest sources exist on disk.
- Shadow cases reference approved sources.
- Referenced sources cover the case scene.
- Evidence terms exist in the expected source documents.
- A simple lexical scorer ranks the expected source first for each case.

## Obsidian Sync

- Status: synced
- Note: `docs/obsidian/notes/2026-04-27-rag-knowledge-source-docs.md`
- Index: `docs/obsidian/index.md`
