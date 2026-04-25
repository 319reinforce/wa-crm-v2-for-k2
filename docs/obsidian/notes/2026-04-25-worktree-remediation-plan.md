---
title: Worktree Remediation Plan
date: 2026-04-25
project: wa-crm-v2
type: decision
source_path: docs/WORKTREE_REMEDIATION_PLAN_20260425.md
status: active
tags:
  - wa-crm-v2
  - git
  - planning
---

# Worktree Remediation Plan

## Summary

The current dirty worktree should be split into documentation, event lifecycle data-model work, and frontend layout/event UI work. No code should be changed as part of this planning note.

## Key Decisions

- Land documentation and Obsidian cleanup separately.
- Review event lifecycle schema/service/route changes as one coherent change set.
- Review frontend layout and generated assets separately.
- Do not revert existing code changes blindly.

## Source

- Source document: `docs/WORKTREE_REMEDIATION_PLAN_20260425.md`

## Verification

- The source plan records current staged, unstaged, and untracked non-document changes.

## Follow-Ups

- Recheck `git status --short` before implementing the plan.
- Decide whether generated `public/index.html` belongs in a source commit.
