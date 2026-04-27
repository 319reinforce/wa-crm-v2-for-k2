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
- Keep current RAG direction on knowledge-source standards, local deterministic rules, and OpenAI hosted RAG.
- Keep referenced reports while active handoffs still need them, but classify each with an owner and cleanup condition.
- Do not commit generated observation reports, runtime state, backups, local media data, or build assets unless they are intentional product assets.

## Source

- Cleanup plan: `docs/RUNTIME_ARTIFACT_CLEANUP_PLAN_20260427.md`
- Report inventory: `docs/archive/reports/REPORTS_INDEX_20260427.md`

## Verification

- `git ls-files LightRAG` should return no tracked files.
- `git diff --check` should pass before merging.
- Report references should remain only in owning handoffs, archive docs, or scripts that generate report output.
