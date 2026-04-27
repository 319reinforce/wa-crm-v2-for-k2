---
title: Runtime Architecture Docs
date: 2026-04-27
project: wa-crm-v2
type: architecture
source_path: docs/DOCUMENT_RETENTION_AUDIT_20260427.md
status: active
tags:
  - wa-crm-v2
  - memory
  - runtime
  - architecture
---

# Runtime Architecture Docs

## Summary

The active runtime architecture docs are spread across AI reply generation, SFT/RLHF, WhatsApp sessions, Baileys rollout, and SSE hardening. This note gives future agents the compact map so historical review documents do not become the default entry point.

## Active Runtime References

- AI reply generation: `docs/AI_REPLY_GENERATION_SYSTEM.md`
- SFT/RLHF pipeline: `docs/SFT_RLHF_PIPELINE.md`
- RLHF operator onboarding: `docs/RLHF_ONBOARDING.md`
- WA session control design: `docs/WA_SESSIONS_DESIGN.md`
- Baileys rollout runbook: `docs/BAILEYS_ROLLOUT.md`
- SSE hardening: `docs/SSE_HARDENING.md`
- Core module index: `docs/CORE_MODULES_OVERVIEW.md`

## Current Boundaries

- The main AI reply path is `POST /api/ai/generate-candidates`, orchestrated by `server/services/replyGenerationService.js`.
- Legacy `/api/minimax` and `/api/experience/route` paths should be treated as compatibility routes unless current code proves otherwise.
- SFT/RLHF docs are still useful, but older rollout sections must be reconciled with the current `replyGenerationService` path before becoming implementation instructions.
- WA session docs describe the intended multi-session control plane; verify current code before executing destructive session actions.
- Baileys is a rollout/runbook concern with account-risk implications; do not treat it as a purely mechanical driver swap.
- SSE hardening remains relevant for `/api/events/subscribe` and proxy/compression behavior.

## Historical Noise To Avoid

- Pre-2026-04-20 review/security/runtime docs were consolidated into `docs/archive/PRE_20260420_DOCS_ARCHIVE.md`.
- The archive is SQLite/server.js-era context and should not be used as a current defect list.
- Old task-specific handoffs and duplicate security reports were removed from the active documentation path.
