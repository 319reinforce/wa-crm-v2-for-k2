# WA CRM v2 Documentation Index

Date: 2026-04-25
Status: Active

This index is the starting point for project documentation. It groups the current docs by purpose and points agents to the right source before changing code or policy.

## Start Here

Read in this order:

1. `AGENTS.md` - agent entry guide and working rules.
2. `BOT_INTEGRATION.md` - API and integration quick reference.
3. `SFT_PROJECT.md` - SFT, Experience Router, profile memory, and generation tracking deep reference.
4. `docs/CORE_MODULES_OVERVIEW.md` - current module map.
5. `docs/EVENT_LIFECYCLE_BACKFILL_HANDOFF_20260425.md` - latest event/lifecycle backfill and review UI progress.
6. `docs/OBSIDIAN_MEMORY_STANDARD.md` - Obsidian memory and sync standard.

## Core Architecture

| Document | Purpose |
| --- | --- |
| `docs/CORE_MODULES_OVERVIEW.md` | Current map of the most important modules and ownership boundaries. |
| `docs/AI_REPLY_GENERATION_SYSTEM.md` | AI reply generation architecture. |
| `docs/SFT_RLHF_PIPELINE.md` | SFT/RLHF collection, export, and rollout flow. |
| `docs/RLHF_ONBOARDING.md` | RLHF onboarding and operator workflow. |
| `docs/PROJECT_ANALYSIS.md` | Historical project analysis and review context. |

## Event And Lifecycle

| Document | Purpose |
| --- | --- |
| `docs/EVENT_LIFECYCLE_DATA_PRD_20260425.md` | Current event/lifecycle data-model PRD. |
| `docs/EVENT_LIFECYCLE_HANDOFF_20260425.md` | 2026-04-25 lifecycle implementation handoff. |
| `docs/EVENT_LIFECYCLE_BACKFILL_HANDOFF_20260425.md` | Backfill and audit handoff. |
| `docs/ACTIVE_EVENT_DETECTION_HANDOFF_20260426.md` | Active event-detection queue, message-supplement integration, dry-run/write rollout, and local audit handoff. |
| `docs/LIFECYCLE_REFACTOR_PRD.md` | Larger lifecycle refactor plan. |
| `docs/LIFECYCLE_EVENT_STRATEGY_HANDOFF_20260424.md` | Event strategy handoff before the fact-model PRD. |
| `docs/EVENT_SYSTEM.md` | Event system implementation notes. |
| `docs/EVENT_SYSTEM_REQUIREMENTS.md` | Earlier event requirements. |
| `docs/EVENT_DECISION_TABLE.md` | Event decision table. |
| `docs/sql/event_lifecycle_audit_20260425.sql` | Audit SQL for event/lifecycle data checks. |

## Frontend And Layout

| Document | Purpose |
| --- | --- |
| `docs/V1_LAYOUT_HANDOFF_20260425.md` | V1/V2 navigation and finance/layout handoff. |
| `docs/V1_LAYOUT_FOLLOWUP_HANDOFF_20260425.md` | Follow-up layout adjustments. |
| `docs/FRONTEND_LAYOUT_REFACTOR.md` | Frontend layout refactor notes. |
| `docs/FRONTEND_LOAD_OPTIMIZATION_20260423.md` | Frontend load optimization notes. |
| `docs/VIEWER_ROLE_20260423.md` | Viewer role feature notes. |
| `docs/TEMPLATE_CUSTOM_TOPIC_HANDOFF_20260424.md` | Custom topic template handoff. |

## WhatsApp Runtime

| Document | Purpose |
| --- | --- |
| `docs/WA_SESSIONS_DESIGN.md` | WA multi-session design and IPC/volume planning. |
| `docs/WA_SESSIONS_DESIGN_REVIEW.md` | Review of WA sessions design. |
| `docs/BAILEYS_ROLLOUT.md` | Baileys driver rollout and risk notes. |
| `docs/SSE_HARDENING.md` | SSE transport hardening. |
| `docs/wa/beau-nightly-role-heartbeat-state.json` | Runtime heartbeat state; treat as state, not a normative doc. |

## RAG And Knowledge Sources

| Document | Purpose |
| --- | --- |
| `docs/rag/KNOWLEDGE_SOURCE_STANDARD.md` | Knowledge source authoring and sync standard. |
| `docs/rag/OPENAI_RAG_RUNBOOK.md` | OpenAI hosted RAG runbook. |
| `docs/rag/LOCAL_RULE_RETRIEVAL_DESIGN_20260420.md` | Deterministic local rule retrieval design. |
| `docs/rag/LOCAL_RULE_IMPLEMENTATION_20260420.md` | Local rule retrieval implementation notes. |
| `docs/rag/RUNTIME_ALIGNMENT_20260416.md` | RAG/runtime alignment dated handoff. |
| `docs/rag/APRIL_DOC_CONFIG_MAPPING_20260420.md` | April SOP/config mapping. |
| `docs/rag/SESSION_SUMMARY_20260420.md` | RAG session summary. |
| `docs/rag/knowledge-manifest.json` | Active knowledge-source manifest. |
| `docs/rag/sources/` | Approved/draft policy, SOP, FAQ, and playbook sources. |
| `docs/rag/templates/` | Knowledge source templates. |
| `docs/rag/shadow-cases/` | Shadow validation cases. |

## Security, Review, And Cleanup

| Document | Purpose |
| --- | --- |
| `CODE_REVIEW.md` | Historical review archive; do not treat as current defect list without checking dated reports. |
| `docs/CODE_REVIEW_FINDINGS_20260416.md` | Current dated review findings. |
| `docs/REVIEW_FIX_REPORT_20260416.md` | Review fix report and verification. |
| `docs/SECURITY_FIX_PLAN.md` | Security fix plan. |
| `docs/SECURITY_FIX_REPORT.md` | Security fix report. |
| `docs/SECURITY_CHANGES_20260416.md` | Security change log. |
| `docs/SECURITY_CHANGES_2026-04-16.md` | Duplicate dated security change log; keep until consolidated. |
| `docs/CLEANUP_HISTORY_20260416.md` | Cleanup history and session audit. |
| `docs/LEGACY_CLEANUP_LOG.md` | Legacy cleanup log. |
| `docs/HISTORICAL_REPORTS_ARCHIVE.md` | Archive of historical report conclusions. |

## Obsidian Memory

| Document | Purpose |
| --- | --- |
| `docs/OBSIDIAN_MEMORY_STANDARD.md` | Memory sync standard. |
| `docs/obsidian/index.md` | Obsidian memory note index. |
| `docs/obsidian/notes/` | Dated memory notes. |
| `docs/obsidian/templates/MEMORY_NOTE_TEMPLATE.md` | Memory note template. |

## Worktree Planning

| Document | Purpose |
| --- | --- |
| `docs/WORKTREE_REMEDIATION_PLAN_20260425.md` | Plan for current code conflicts and non-document changes. |

## Cleanup Candidates

These docs are useful but should eventually be consolidated:

- `docs/SECURITY_CHANGES_20260416.md` and `docs/SECURITY_CHANGES_2026-04-16.md` appear to overlap.
- `docs/EVENT_SYSTEM.md`, `docs/EVENT_SYSTEM_REQUIREMENTS.md`, and `docs/LIFECYCLE_REFACTOR_PRD.md` should be cross-checked against `docs/EVENT_LIFECYCLE_DATA_PRD_20260425.md`.
- `CODE_REVIEW.md` should eventually become a short index to dated review reports.
- Old SFT rollout sections should be reconciled with the current `replyGenerationService` path.

## Obsidian Sync

- Status: synced
- Note: `docs/obsidian/notes/2026-04-25-docs-index-and-core-modules.md`
- Index: `docs/obsidian/index.md`
