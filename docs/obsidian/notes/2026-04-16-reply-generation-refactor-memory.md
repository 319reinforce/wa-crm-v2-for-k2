---
title: Reply Generation Refactor Memory
date: 2026-04-16
project: wa-crm-v2
type: status
source_path: docs/archive/PRE_20260420_DOCS_ARCHIVE.md
status: historical
tags:
  - wa-crm-v2
  - reply-generation
  - sft
---

# Reply Generation Refactor Memory

## Summary

The reply generation refactor unified AI candidate generation into `replyGenerationService` and added SFT generation tracking fields. The original 2026-04-16 source docs were consolidated into the pre-2026-04-20 archive on 2026-04-27.

## Key Decisions

- Front-end generation moved from a two-request flow to `POST /api/ai/generate-candidates`.
- `/api/minimax` and `/api/experience/route` became compatibility entrypoints.
- `sft_memory` gained formal generation tracking columns.
- The original document predated the Obsidian memory standard and is now backfilled here.

## Source

- Source archive: `docs/archive/PRE_20260420_DOCS_ARCHIVE.md`

## Verification

- Consolidated archive records the original verification at a summary level.

## Follow-Ups

- Keep SFT and AI reply docs aligned with the current single-service generation path.
