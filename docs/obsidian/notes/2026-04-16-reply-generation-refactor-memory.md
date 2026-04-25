---
title: Reply Generation Refactor Memory
date: 2026-04-16
project: wa-crm-v2
type: status
source_path: docs/REPLY_GENERATION_REFACTOR_MEMORY_20260416.md
status: historical
tags:
  - wa-crm-v2
  - reply-generation
  - sft
---

# Reply Generation Refactor Memory

## Summary

The reply generation refactor unified AI candidate generation into `replyGenerationService` and added SFT generation tracking fields.

## Key Decisions

- Front-end generation moved from a two-request flow to `POST /api/ai/generate-candidates`.
- `/api/minimax` and `/api/experience/route` became compatibility entrypoints.
- `sft_memory` gained formal generation tracking columns.
- The original document predated the Obsidian memory standard and is now backfilled here.

## Source

- Source document: `docs/REPLY_GENERATION_REFACTOR_MEMORY_20260416.md`

## Verification

- Source document records syntax checks, build, tests, and migration execution.

## Follow-Ups

- Keep SFT and AI reply docs aligned with the current single-service generation path.
