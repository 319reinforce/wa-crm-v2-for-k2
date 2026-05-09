---
title: Tech Debt Remediation Kickoff
date: 2026-05-08
project: wa-crm-v2
type: review
source_path: docs/TECH_DEBT_REMEDIATION_KICKOFF_20260508.md
status: implemented
tags:
  - wa-crm-v2
  - tech-debt
  - remediation
  - frontend
  - api-security
---

# Tech Debt Remediation Kickoff

## Summary

The 2026-05-08 kickoff verified the reported High/Medium/Low risks. As of 2026-05-09, Phases 1-5 are implemented: server guardrails, auth/projection/request IDs, SFT/AI request dedupe and feedback, frontend decomposition, and operational hardening.

## Key Decisions

- Treat `src/App.jsx` size and state sprawl as a phased decomposition problem after server/auth guardrails are in place.
- Fix the duplicate `/api/admin` router mount and unbounded composer message cache first because they are high-confidence and low blast radius.
- Reframe SFTDashboard StrictMode concern as duplicate/concurrent fetch waste, not direct AI token waste.
- Use role-aware response projections for creator list/detail/message APIs before broader frontend refactors.
- Add request ID tracing and cross-tab auth state sync in the same auth/API hardening phase.

## Source Document

- `docs/TECH_DEBT_REMEDIATION_KICKOFF_20260508.md`

## Verification Notes

- `src/App.jsx`: 3846 lines, 63 `useState` calls.
- `src/components/WAMessageComposer.jsx`: module-level `messagesCache = new Map()` with TTL but no max entry cap.
- `server/index.cjs`: duplicate `/api/admin` mount found.
- `src/main.jsx`: `React.StrictMode` enabled.
- `SFTDashboard.jsx`: mount load and evaluation tab's five concurrent requests confirmed.
- `tests/integration/`: Baileys receive/send/driver switch integration tests exist.

## Phase 1 Rollout

- Removed duplicate `/api/admin` router mount in `server/index.cjs`.
- Bounded composer message cache with `MESSAGES_CACHE_MAX_ENTRIES = 120` and pruning in `src/components/WAMessageComposer.jsx`.
- Added `tests/phase1TechDebt.test.mjs`.
- Verification passed for Phase 1 regression tests, permission/scope tests, `node --check server/index.cjs`, and `npm run build`.
- Full `npm run test:unit` was blocked by `tests/unit/baileysDriver.unit.test.mjs` leaving a pending promise/open handle after 146s; this is tracked as a separate test lifecycle issue, not a Phase 1 functional failure.

## Phase 2 Rollout

- Added global `X-Request-Id` middleware and frontend request ID propagation through auth fetch helpers.
- Added auth localStorage change subscriptions so App owner scope updates across tabs and AppAuthGate notices cross-tab logout.
- Projected message API fields explicitly, excluding `proto_bytes` and `proto_driver`.
- Projected creator detail embedded `messages` to strip proto/internal message fields.
- Resolved creator detail phone policy: default detail responses include `wa_phone_masked`; raw `wa_phone` requires explicit `fields=wa_phone` and admin/service or matching owner scope.
- Updated app-side detail fetches to explicitly request `fields=wa_phone` for current `client_id` bridge flows.
- Added Phase 2 request/auth/message projection tests and extended creator field tests.
- UI acceptance now includes browser-level cross-tab auth scope automation and passed with `crossTabAuthSynced: true`.
- Verification passed for targeted permission/scope tests, request-id/message projection tests, syntax checks, and `npm run build`.

## Phase 3 Rollout

- Added `GET /api/generation-log/evaluation-summary` to aggregate the SFT evaluation tab's previous five independent API calls.
- Updated `SFTDashboard` with a 30s in-flight/result cache and stale-response guards, reducing StrictMode duplicate loads and rapid tab-switch overwrites.
- Added AI generation progress states in the Reply Deck: preparing context, generating, waiting for backend fallback, retryable failure, and final provider/model metadata.
- Added Phase 3 regression coverage in `tests/phase3SftAiFeedback.test.mjs` and `tests/auditRoutes.test.mjs`.
- UI acceptance now includes browser-level rapid SFT tab switching automation and passed with `sftRapidTabStable: true`.
- Phase 3 source regression coverage now locks the slow-provider fallback timer, 60s abort timeout, and timeout-specific retryable error copy.
- Verification passed for Phase 3 targeted tests, Phase 1/2 regression tests, `node --check server/routes/audit.js`, `npm run build`, `npm run test:unit`, and `npm run test:ui:acceptance`.

## Phase 4 Rollout

- Extracted App shell internals into `src/hooks/useResizablePanelWidths.js`, `src/components/KanbanView.jsx`, and `src/components/ContactManagementPage.jsx`.
- Added shared panel feedback primitives in `src/components/common/PanelFeedback.jsx`.
- Updated SFT and Event panels to use consistent inline error/loading/empty surfaces.
- Added keyboard activation and pressed-state ARIA for event cards.
- Hardened the desktop/tablet top bar so tabs and operator actions stay reachable at 768px widths.
- Extracted owner transfer state/API handling into `src/hooks/useOwnerTransfer.js`.
- Added dialog semantics and Escape close behavior to the manual creator/import modal.
- Added `tests/phase4FrontendDecomposition.test.mjs` to guard decomposition and feedback/a11y boundaries.
- Updated `tests/unit/baileysDriver.unit.test.mjs` to mock Baileys and pino, keeping the unit suite offline and clearing the previous open-handle blocker.
- Verification passed for `npm run test:unit`, `node --test tests/phase4FrontendDecomposition.test.mjs`, `node --test tests/unit/baileysDriver.unit.test.mjs`, `npm run build`, and `npm run test:ui:acceptance`.
- Browser smoke passed at 390x844, 768x1024, and desktop widths; manual creator dialog, mobile filter sheet, and mobile more/account sheet passed Tab/Escape keyboard smoke.

## Phase 5 Rollout

- Implemented the item deferred from Phase 2: request IDs now appear in request-scoped structured JSON logs for API 5xx responses.
- Added JSON server logging with conservative redaction for phone-like values, tokens, passwords, secrets, `client_id`, and `wa_phone`.
- Added process-memory route-level rate limiting: strict login limit, moderate AI/translation limit, upload-aware media limit, and a conservative unsafe-method `/api/*` write guard.
- Hardened SSE with `SSE_MAX_CLIENTS`, scoped client metadata, initial `sse-meta` events, client summaries, clearer connect/disconnect logs, and failed-write cleanup logging.
- Aligned local smoke-test auth with the current human-admin gate: `LOCAL_API_AUTH_BYPASS` can satisfy `requireHumanAdmin` only outside production and only for the synthetic `LOCAL_BYPASS` principal.
- Added `tests/phase5OperationalHardening.test.mjs`.
- Extended `tests/api/requireAdminOnly.test.mjs` with `requireHumanAdmin` coverage.
- Verification passed for Phase 5 syntax checks, targeted operational hardening tests, human-admin gate tests, targeted Phase 1-5 regression tests, `npm run test:unit`, `npm run build`, `npm run test:full`, `npm run test:ci`, UI acceptance, and a local SSE bus reconnect/cleanup soak.
- Latest UI acceptance result: `consoleErrorCount: 0`, `pageErrorCount: 0`, `sftRapidTabStable: true`, `crossTabAuthSynced: true`.
- Rollout boundary: the current limiter is single-process. A Redis-backed limiter can be added later if deployment shifts to multiple API workers.

## Follow-Up Items

- Phase 0: baseline tests were confirmed for Phase 1 scope.
- Phase 1: implemented; Baileys unit-test caveat is now cleared by the Phase 4 test mock fix.
- Phase 2: implemented; request-ID structured logging was deferred to Phase 5 and is now implemented.
- Phase 3: implemented; live external-provider timeout remains manual operational QA, but local slow-path regression coverage is in place.
- Phase 4: implemented; future frontend work should continue with separate chat shell or mobile shell extraction slices.
- Phase 5: implemented for in-process rate limiting, SSE hardening, and request-scoped structured API error logs. Optional future work is Redis-backed distributed rate limiting if needed.

## Final Status

- Overall status: implemented through Phase 5.
- Required Phase 5 verification: passed.
- Full verification: `npm run test:ci` passed.
- Remaining work: optional Redis-backed distributed limits if production runs multiple API workers.
