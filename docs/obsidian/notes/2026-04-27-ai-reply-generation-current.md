---
title: AI Reply Generation Current
date: 2026-04-27
project: wa-crm-v2
type: design
source_path: docs/AI_REPLY_GENERATION_SYSTEM.md
status: active
tags:
  - wa-crm-v2
  - ai-reply
  - sft
  - experience-router
---

# AI Reply Generation Current

## Summary

`docs/AI_REPLY_GENERATION_SYSTEM.md` is the active reference for reply generation. It replaces older SFT/RLHF long-form docs as the primary AI path documentation.

## Current Chain

- Frontend entry: `src/components/WAMessageComposer.jsx` and `src/components/WAMessageComposer/ai/experienceRouter.js`.
- Backend routes: `server/routes/ai.js` and compatibility `server/routes/experience.js`.
- Core service: `server/services/replyGenerationService.js`.
- Strategy and grounding: `server/services/replyStrategyService.js`, `server/services/retrievalService.js`, transitional `server/services/localRuleRetrievalService.js`.
- Persistence: `retrieval_snapshot`, `generation_log`, `sft_memory`, and `sft_feedback`.

## Key Decisions

- Policy grounding is required before policy-sensitive replies.
- Operator identity must be confirmed before using Beau/Yiyun-specific language.
- SFT capture remains a data collection path, but old training-rollout docs are historical.
- Future personalization should use per-user Markdown profile memory / skill memory.
- Legacy manifest-backed local rules are transitional and should not be expanded into a larger RAG program.

## Follow-Ups

- Design the Markdown profile schema and sync rules.
- Reconcile any SFT dashboard copy that still frames retrieval as RAG once profile/skill memory is implemented.
