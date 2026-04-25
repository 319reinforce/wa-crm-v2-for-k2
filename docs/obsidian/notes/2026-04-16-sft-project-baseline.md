---
title: SFT Project Baseline
date: 2026-04-16
project: wa-crm-v2
type: status
source_path: SFT_PROJECT.md
status: active
tags:
  - wa-crm-v2
  - sft
  - memory
---

# SFT Project Baseline

## Summary

`SFT_PROJECT.md` remains the deep project reference for SFT, Experience Router, profile memory, and generation tracking. It now explicitly marks `data/*.json` as historical and points memory sync to Obsidian.

## Key Decisions

- MySQL `wa_crm_v2` and `schema.sql` are the current data baseline.
- `data/*.json` describes historical migration input only.
- `client_memory` design notes from 2026-04-10 must be checked against current services before use.
- Obsidian is the current memory standard.

## Source

- Source document: `SFT_PROJECT.md`

## Verification

- Source document references `docs/OBSIDIAN_MEMORY_STANDARD.md`.

## Follow-Ups

- Reconcile older SFT rollout sections with the current `replyGenerationService` path when the next SFT doc pass happens.
