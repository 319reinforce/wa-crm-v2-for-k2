---
title: SFT Docs And Report Cleanup
date: 2026-04-27
project: wa-crm-v2
type: cleanup
source_path: docs/DOCS_INDEX.md
status: active
tags:
  - wa-crm-v2
  - docs
  - cleanup
  - sft
  - reports
---

# SFT Docs And Report Cleanup

## Summary

The second deep-clean pass removed old SFT/RLHF long-form docs and raw generated report artifacts from source control. Current implementation guidance now points to current code, `docs/AI_REPLY_GENERATION_SYSTEM.md`, `docs/CORE_MODULES_OVERVIEW.md`, and focused Obsidian notes.

## Removed

- `SFT_PROJECT.md`
- `docs/SFT_RLHF_PIPELINE.md`
- `docs/RLHF_ONBOARDING.md`
- Tracked `reports/*.json` active-event/lifecycle evidence files after their summaries were retained in handoffs.
- `scripts/add-messages-creator-role-ts-index.sql`, because `schema.sql` already owns the index.
- `scripts/regression/`, because it referenced a missing creator contract and was not linked from active docs.
- `docs/rag/formal-launch-window.json`, because it is runtime state and now belongs under `data/runtime-state/`.

## Decisions

- Do not restore old SFT/RLHF docs as onboarding material; rebuild any future SFT reference from current routes/services.
- Generated report JSON should stay local unless an owner doc, cleanup condition, and sensitivity review are explicit.
- Formal launch metrics marker defaults to `data/runtime-state/formal-launch-window.json`.

## Verification

- Active entry docs now point away from the deleted SFT/RLHF long docs.
- Report inventory records that there are no currently tracked report JSON files.
