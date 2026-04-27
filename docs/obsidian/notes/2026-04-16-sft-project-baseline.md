---
title: SFT Project Baseline
date: 2026-04-16
project: wa-crm-v2
type: status
source_path: docs/obsidian/notes/2026-04-16-sft-project-baseline.md
status: historical
tags:
  - wa-crm-v2
  - sft
  - memory
---

# SFT Project Baseline

## Summary

The former root `SFT_PROJECT.md` was removed from source control during the 2026-04-27 deep cleanup because it mixed useful SFT concepts with obsolete `server.js`, SQLite-era, and early RLHF rollout instructions. This note is the retained historical baseline.

## Key Decisions

- MySQL `wa_crm_v2` and `schema.sql` are the current data baseline.
- `data/*.json` describes historical migration input only.
- `client_memory` design notes from 2026-04-10 must be checked against current services before use.
- Obsidian is the current memory standard.

## Source

- Original source document removed: `SFT_PROJECT.md`
- Current entry point: `docs/AI_REPLY_GENERATION_SYSTEM.md`

## Verification

- Source document references `docs/OBSIDIAN_MEMORY_STANDARD.md`.

## Follow-Ups

- Rebuild any future SFT reference from current code paths rather than restoring the removed long-form document.
