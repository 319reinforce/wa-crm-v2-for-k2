# WA CRM v2 Core Modules Overview

Date: 2026-04-25
Status: Active

This document identifies the most important current modules. Use it to understand the system before making code changes.

## 1. Runtime Shell And API Gateway

Primary files:

- `server/index.cjs`
- `server/middleware/appAuth.js`
- `server/middleware/audit.js`
- `server/middleware/jsonBody.js`
- `server/middleware/timeout.js`
- `server/routes/users.js`
- `server/routes/audit.js`

Responsibilities:

- Starts the Express runtime on port 3000.
- Mounts REST routes and middleware.
- Applies app auth, JSON body handling, request timeout, and audit logging.
- Provides user/admin endpoints.

Current docs:

- `AGENTS.md`
- `BOT_INTEGRATION.md`
- `docs/DOCS_INDEX.md`
- `docs/archive/PRE_20260420_DOCS_ARCHIVE.md` for historical security cleanup only

## 2. Data Model And Creator Identity

Primary files:

- `schema.sql`
- `db.js`
- `server/routes/creators.js`
- `server/services/creatorService.js`
- `server/services/creatorCache.js`
- `server/services/canonicalCreatorResolver.js`
- `server/services/creatorMergeService.js`

Responsibilities:

- MySQL schema and SQLite-style compatibility wrapper.
- Creator identity, aliases, owner scoping, cache, and merge behavior.
- Keeper/JoinBrands compatibility data.

Current docs:

- `SFT_PROJECT.md`
- `docs/DATABASE_SCHEMA_OPTIMIZATION_PLAN_20260427.md`
- `docs/archive/PRE_20260420_DOCS_ARCHIVE.md` for historical SQLite/legacy cleanup only

## 3. WhatsApp Sessions, Messages, And Media

Primary files:

- `server/routes/wa.js`
- `server/routes/waSessions.js`
- `server/services/waService.js`
- `server/services/waSessionRouter.js`
- `server/services/sessionRegistry.js`
- `server/services/sessionRepository.js`
- `server/services/directMessagePersistenceService.js`
- `server/services/mediaAssetService.js`
- `server/services/waIncomingMediaService.js`
- `server/services/messageDedupService.js`
- `server/waCrawler.cjs`
- `server/waWorker.js`

Responsibilities:

- WA send, receive, QR, session routing, and driver switching.
- Direct message persistence after successful send.
- Incoming media download and media asset lifecycle.
- Multi-session crawler/worker operations.

Current docs:

- `docs/WA_SESSIONS_DESIGN.md`
- `docs/WA_SESSIONS_DESIGN_REVIEW.md`
- `docs/BAILEYS_ROLLOUT.md`
- `docs/SSE_HARDENING.md`

## 4. AI Reply Generation And Strategy

Primary files:

- `server/routes/ai.js`
- `server/routes/experience.js`
- `server/routes/strategy.js`
- `server/services/replyGenerationService.js`
- `server/services/replyStrategyService.js`
- `server/services/localRuleRetrievalService.js`
- `server/services/retrievalService.js`
- `server/utils/openai.js`
- `server/utils/openaiVectorStore.js`
- `src/components/WAMessageComposer.jsx`
- `src/components/AIReplyPicker.jsx`
- `src/components/StandardReplyCard.jsx`

Responsibilities:

- Generates reply candidates through the unified backend service.
- Applies operator experience, local rules, retrieval snapshots, and provider routing.
- Supports strategy configuration and reply-card UI.

Current docs:

- `docs/AI_REPLY_GENERATION_SYSTEM.md`
- `docs/SFT_RLHF_PIPELINE.md`
- `docs/obsidian/notes/2026-04-27-runtime-architecture-docs.md`
- `docs/obsidian/notes/2026-04-16-reply-generation-refactor-memory.md` for historical refactor context
- `docs/rag/LOCAL_RULE_RETRIEVAL_DESIGN_20260420.md`

## 5. SFT, Feedback, And Training

Primary files:

- `server/routes/sft.js`
- `server/routes/training.js`
- `server/services/sftService.js`
- `server/workers/trainingWorker.js`
- `src/components/SFTDashboard.jsx`
- `scripts/prepare-safe-finetune-jsonl.cjs`
- `scripts/train-sft-local.cjs`

Responsibilities:

- Captures human-selected reply data.
- Exports SFT records and generation metadata.
- Tracks skip/reject/edit feedback and training readiness.

Current docs:

- `SFT_PROJECT.md`
- `docs/SFT_RLHF_PIPELINE.md`
- `docs/RLHF_ONBOARDING.md`

## 6. Profile, Client Memory, And Tags

Primary files:

- `server/routes/profile.js`
- `server/routes/profileAnalysis.js`
- `server/services/profileService.js`
- `server/services/profileAnalysisService.js`
- `server/services/profileFallbackService.js`
- `server/services/memoryExtractionService.js`

Responsibilities:

- Extracts client tags, summaries, and memory records.
- Feeds profile and memory context into reply generation.
- Maintains client profile state and analysis fallback behavior.

Current docs:

- `SFT_PROJECT.md`
- `docs/rag/LOCAL_RULE_RETRIEVAL_DESIGN_20260420.md`

## 7. Event, Lifecycle, And V1 Board

Primary files:

- `server/routes/events.js`
- `server/routes/lifecycle.js`
- `server/routes/v1Board.js`
- `server/services/eventLifecycleFacts.js`
- `server/services/eventVerificationService.js`
- `server/services/creatorEventSnapshotService.js`
- `server/services/lifecycleService.js`
- `server/services/lifecyclePersistenceService.js`
- `server/services/lifecycleDashboardService.js`
- `server/constants/eventDecisionRules.js`
- `server/migrations/004_event_lifecycle_fact_model.sql`
- `src/components/EventPanel.jsx`
- `src/components/MobileEventTagsBar.jsx`
- `src/components/LifecycleConfigPanel.jsx`

Responsibilities:

- Separates event definitions, facts, evidence, and lifecycle snapshots.
- Replaces legacy `joinbrands_link.ev_*` with fact-based lifecycle state.
- Powers event panel, lifecycle dashboard, V1 board, and filters.

Current docs:

- `docs/EVENT_LIFECYCLE_DATA_PRD_20260425.md`
- `docs/EVENT_LIFECYCLE_HANDOFF_20260425.md`
- `docs/EVENT_LIFECYCLE_BACKFILL_HANDOFF_20260425.md`
- `docs/LIFECYCLE_REFACTOR_PRD.md`
- `docs/EVENT_DECISION_TABLE.md`

Latest progress:

- Event fact backfill, Tier 2 compatibility downgrade, `creator_event_snapshot` primary filtering, and EventPanel human review are summarized in `docs/EVENT_LIFECYCLE_BACKFILL_HANDOFF_20260425.md`.
- Obsidian note: `docs/obsidian/notes/2026-04-25-event-lifecycle-backfill-handoff.md`.

## 8. RAG, Policy, And Knowledge Sources

Primary files:

- `server/routes/policy.js`
- `server/utils/policyMatcher.js`
- `server/services/localRuleRetrievalService.js`
- `server/services/retrievalService.js`
- `scripts/validate-knowledge-manifest.cjs`
- `scripts/sync-openai-vector-store.cjs`
- `scripts/query-openai-vector-store.cjs`
- `docs/rag/knowledge-manifest.json`
- `docs/rag/sources/`

Responsibilities:

- Maintains policy/SOP/FAQ/playbook source material.
- Supports deterministic local retrieval and optional hosted vector retrieval.
- Keeps reply generation grounded in approved knowledge sources.

Current docs:

- `docs/rag/KNOWLEDGE_SOURCE_STANDARD.md`
- `docs/rag/OPENAI_RAG_RUNBOOK.md`
- `docs/rag/LOCAL_RULE_IMPLEMENTATION_20260420.md`
- `docs/rag/APRIL_DOC_CONFIG_MAPPING_20260420.md`

## 9. Frontend Shell And Operations UI

Primary files:

- `src/App.jsx`
- `src/components/CreatorDetail.jsx`
- `src/components/EventPanel.jsx`
- `src/components/WAMessageComposer.jsx`
- `src/components/SFTDashboard.jsx`
- `src/components/AccountsPanel.jsx`
- `src/components/UsersPanel.jsx`
- `src/components/mobile/`
- `src/utils/api.js`
- `src/utils/appAuth.js`
- `src/utils/creatorMeta.js`

Responsibilities:

- Provides the operator UI for creators, chat, events, finance, SFT, users, and accounts.
- Handles mobile shell and responsive controls.
- Bridges front-end state to REST APIs.

Current docs:

- `docs/V1_LAYOUT_HANDOFF_20260425.md`
- `docs/V1_LAYOUT_FOLLOWUP_HANDOFF_20260425.md`
- `docs/FRONTEND_LAYOUT_REFACTOR.md`
- `docs/FRONTEND_LOAD_OPTIMIZATION_20260423.md`

## Highest-Risk Active Areas

1. Event/lifecycle fact-model migration: touches schema, events, lifecycle, filters, dashboard, and reply strategy.
2. WA session/runtime behavior: can affect live accounts, QR flow, media, and outbound persistence.
3. AI reply generation: must keep policy grounding, operator scope, generation logs, and SFT feedback aligned.
4. Profile/client memory: personalization quality depends on accurate extraction and safe use of client facts.
5. Frontend layout convergence: V1/V2 navigation, finance, chat, and lifecycle panels are currently being normalized.

## Obsidian Sync

- Status: synced
- Note: `docs/obsidian/notes/2026-04-25-docs-index-and-core-modules.md`
- Index: `docs/obsidian/index.md`
