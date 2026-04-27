---
title: Profile Skill Memory Direction
date: 2026-04-27
project: wa-crm-v2
type: decision
source_path: docs/DOCS_INDEX.md
status: active
tags:
  - wa-crm-v2
  - memory
  - profile
  - skill
---

# Profile Skill Memory Direction

## Summary

Future personalization should not depend on a heavy RAG setup. The preferred direction is to maintain one Markdown profile file per user/creator and use that as the primary basis for profile management, memory, and operator-facing context.

## Key Decisions

- RAG runbooks/design docs were removed from active docs.
- Remaining `docs/rag/knowledge-manifest.json` and `docs/rag/sources/` are transitional because current code still reads them.
- Per-user Markdown profiles should become the canonical profile-management layer.
- A future skill-style layer can read structured profile Markdown directly instead of requiring vector retrieval.

## Open Design Questions

- Profile file location and naming convention.
- Which fields are operator-editable versus system-derived.
- How profile Markdown syncs with `client_profiles`, `client_tags`, and `client_memory`.
- How to audit changes without leaking raw phone values.

## Follow-Ups

- Draft the Markdown profile schema.
- Decide whether profile files live under `docs/`, `data/`, or an ignored operational vault.
- Retire manifest-backed local rules after the profile/skill path has parity.
