---
title: Runtime Artifact Cleanup Plan
date: 2026-04-27
project: wa-crm-v2
type: cleanup
source_path: docs/RUNTIME_ARTIFACT_CLEANUP_PLAN_20260427.md
status: active
tags:
  - wa-crm-v2
  - cleanup
  - reports
  - rag
---

# Runtime Artifact Cleanup Plan

## Summary

WA CRM v2 now has an explicit cleanup baseline for reports, runtime exports, generated artifacts, and the old LightRAG path. LightRAG is removed from the repo because it was a broken gitlink without `.gitmodules`, and the project will not adopt that solution.

## Key Decisions

- Remove tracked `LightRAG` gitlink.
- Add `LightRAG/` to `.gitignore`.
- Avoid expanding the heavy RAG path; remaining manifest-backed local-rule files are transitional until profile/skill memory replaces them.
- Remove raw generated reports once their conclusions are summarized in handoffs or Obsidian.
- Do not commit generated observation reports, runtime state, backups, local media data, or build assets unless they are intentional product assets.
- Pre-2026-04-20 lifecycle exports and dirty-data SQL were removed after their value was summarized; lifecycle exports contained raw phone values and should not remain in source control.
- Runtime state moved from `docs/wa/*state.json` to ignored `data/runtime-state/`.

## Source

- Cleanup plan: `docs/RUNTIME_ARTIFACT_CLEANUP_PLAN_20260427.md`
- Report inventory: `docs/archive/reports/REPORTS_INDEX_20260427.md`

## Verification

- `git ls-files LightRAG` should return no tracked files.
- `git diff --check` should pass before merging.
- Report references should remain only as regeneration commands or summarized historical evidence.
