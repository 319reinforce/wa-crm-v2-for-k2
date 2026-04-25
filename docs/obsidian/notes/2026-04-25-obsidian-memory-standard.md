---
title: Obsidian Memory Standard
date: 2026-04-25
project: wa-crm-v2
type: standard
source_path: docs/OBSIDIAN_MEMORY_STANDARD.md
status: active
tags:
  - wa-crm-v2
  - memory
  - obsidian
---

# Obsidian Memory Standard

## Summary

WA CRM v2 now uses the repository-local Obsidian vault at `docs/obsidian/` as the active project memory target.

## Key Decisions

- Repository Markdown remains the operational source of truth.
- Obsidian notes are concise summaries and navigation anchors.
- Specs, standards, PRDs, runbooks, rollout docs, routing decisions, and dated handoffs require an Obsidian sync note.
- Active agent closeout should report Obsidian sync status.

## Source

- Source document: `docs/OBSIDIAN_MEMORY_STANDARD.md`
- Vault index: `docs/obsidian/index.md`
- Desktop mirror: `/Users/depp/depp's obsidan/Projects/WA CRM v2/`

## Verification

- Grep should show active memory rules pointing to Obsidian.
- Legacy external-memory terms should not appear in project documentation.

## Follow-Ups

- If a human wants an external desktop Obsidian vault, mirror `docs/obsidian/` there without changing the repo standard.
