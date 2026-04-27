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
7. `docs/DOCUMENT_RETENTION_AUDIT_20260427.md` - current documentation retention and cleanup record.
8. `docs/RUNTIME_ARTIFACT_CLEANUP_PLAN_20260427.md` - reports, runtime artifacts, and external vendor cleanup baseline.

## Core Architecture

| Document | Purpose |
| --- | --- |
| `docs/CORE_MODULES_OVERVIEW.md` | Current map of the most important modules and ownership boundaries. |
| `docs/DATABASE_SCHEMA_OPTIMIZATION_PLAN_20260427.md` | Database schema ownership, compatibility cleanup, and staged optimization plan. |
| `docs/AI_REPLY_GENERATION_SYSTEM.md` | AI reply generation architecture. |
| `docs/SFT_RLHF_PIPELINE.md` | SFT/RLHF collection, export, and rollout flow. |
| `docs/RLHF_ONBOARDING.md` | RLHF onboarding and operator workflow. |
| `docs/archive/PRE_20260420_DOCS_ARCHIVE.md` | Consolidated 2026-04-20-and-earlier review/security/runtime archive; not a current defect list. |

## Event And Lifecycle

| Document | Purpose |
| --- | --- |
| `docs/EVENT_LIFECYCLE_DATA_PRD_20260425.md` | Current event/lifecycle data-model PRD. |
| `docs/EVENT_LIFECYCLE_HANDOFF_20260425.md` | 2026-04-25 lifecycle implementation handoff. |
| `docs/EVENT_LIFECYCLE_BACKFILL_HANDOFF_20260425.md` | Backfill and audit handoff. |
| `docs/ACTIVE_EVENT_DETECTION_HANDOFF_20260426.md` | Active event-detection queue, message-supplement integration, dry-run/write rollout, and local audit handoff. |
| `docs/LIFECYCLE_REFACTOR_PRD.md` | Larger lifecycle refactor plan. |
| `docs/LIFECYCLE_EVENT_STRATEGY_HANDOFF_20260424.md` | Event strategy handoff before the fact-model PRD. |
| `docs/EVENT_DECISION_TABLE.md` | Event decision table. |
| `docs/sql/event_lifecycle_audit_20260425.sql` | Audit SQL for event/lifecycle data checks. |

## Frontend And Layout

| Document | Purpose |
| --- | --- |
| `docs/V1_LAYOUT_HANDOFF_20260425.md` | V1/V2 navigation and finance/layout handoff. |
| `docs/V1_LAYOUT_FOLLOWUP_HANDOFF_20260425.md` | Follow-up layout adjustments. |
| `docs/CREATOR_IMPORT_WELCOME_HANDOFF_20260426.md` | Batch creator import, dynamic owners, owner welcome template pool, and standard welcome-message publish handoff. |
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
| `docs/rag/APRIL_DOC_CONFIG_MAPPING_20260420.md` | April SOP/config mapping. |
| `docs/rag/knowledge-manifest.json` | Active knowledge-source manifest. |
| `docs/rag/sources/` | Approved/draft policy, SOP, FAQ, and playbook sources. |
| `docs/rag/templates/` | Knowledge source templates. |
| `docs/rag/shadow-cases/` | Shadow validation cases. |

## Security, Review, And Cleanup

| Document | Purpose |
| --- | --- |
| `docs/archive/PRE_20260420_DOCS_ARCHIVE.md` | Consolidated archive for pre-2026-04-20 code review, security, cleanup, event, runtime, and dirty-data docs. |
| `docs/DOCUMENT_RETENTION_AUDIT_20260427.md` | Documentation retention decision log and cleanup verification. |
| `docs/RUNTIME_ARTIFACT_CLEANUP_PLAN_20260427.md` | Runtime artifact, report, and external vendor cleanup baseline. |
| `docs/archive/reports/REPORTS_INDEX_20260427.md` | Current tracked report inventory and cleanup conditions. |

## Obsidian Memory

| Document | Purpose |
| --- | --- |
| `docs/OBSIDIAN_MEMORY_STANDARD.md` | Memory sync standard. |
| `docs/obsidian/index.md` | Obsidian memory note index. |
| `docs/obsidian/notes/` | Dated memory notes. |
| `docs/obsidian/templates/MEMORY_NOTE_TEMPLATE.md` | Memory note template. |

## Worktree And Documentation Planning

| Document | Purpose |
| --- | --- |
| `docs/WORKTREE_REMEDIATION_PLAN_20260425.md` | Plan for current code conflicts and non-document changes. |
| `docs/RECENT_BRANCH_DOC_MAPPING_20260427.md` | Recent Gitea branch, PR, archive tag, and handoff/Obsidian mapping. |
| `docs/DOCUMENT_RETENTION_AUDIT_20260427.md` | Current documentation retention audit, Obsidian fill-in summary, and executed cleanup record. |
| `docs/RUNTIME_ARTIFACT_CLEANUP_PLAN_20260427.md` | Report/runtime artifact boundary and LightRAG removal decision. |

## Archived Or Removed Pre-2026-04-20 Docs

The current cleanup authority is `docs/DOCUMENT_RETENTION_AUDIT_20260427.md`.

Pre-2026-04-20 docs that could distract future development were consolidated into `docs/archive/PRE_20260420_DOCS_ARCHIVE.md` and removed from active indexes. Use that archive only for historical rationale, not for current module ownership or defect status.

Current docs retained from the 2026-04-20 boundary include the RAG local rule design/implementation docs because `localRuleRetrievalService` and template/media routing still depend on them.

## Runtime Artifacts And External Vendor Boundary

`LightRAG` was removed from source control and is ignored going forward. WA CRM v2 will not adopt that solution path; current RAG work stays on the local-rule and OpenAI hosted RAG docs listed above.

Generated reports, exports, runtime state, backups, local media data, and build assets are governed by `docs/RUNTIME_ARTIFACT_CLEANUP_PLAN_20260427.md`.

## Obsidian Sync

- Status: synced
- Note: `docs/obsidian/notes/2026-04-25-docs-index-and-core-modules.md`
- Index: `docs/obsidian/index.md`
