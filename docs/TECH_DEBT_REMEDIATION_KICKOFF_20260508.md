# WA CRM v2 Tech Debt Remediation Kickoff

Date: 2026-05-08
Status: Phase 5 implemented
Scope: risk verification, phased remediation plan, implementation records, and verification status

This document verifies the reported High/Medium/Low risks against the current repository state and tracks the staged remediation rollout. Phases 1-5 are now implemented; remaining work is optional follow-up, not a Phase 5 exit blocker.

## Current Status

Date: 2026-05-09
Status: Phase 5 complete

Implemented:

- Phase 1: duplicate `/api/admin` mount removal and bounded composer message cache.
- Phase 2: cross-tab auth scope sync, request IDs, and creator/message sensitive-field projection.
- Phase 3: SFT request dedupe/aggregation and AI slow-path feedback.
- Phase 4: App decomposition, panel feedback normalization, mobile/header/a11y hardening.
- Phase 5: route-level rate limiting, SSE client lifecycle hardening, and request-scoped structured server logs.

Current rollout boundary:

- Rate limiting is process-memory backed and immediately bounds single-process bursts.
- Redis-backed distributed limits remain optional if production later runs multiple API workers.
- No SQLite/`crm.db` path was restored.

## Verification Summary

| ID | Reported risk | Current status | Evidence | Implementation note |
| --- | --- | --- | --- | --- |
| H1 | `App.jsx` giant component and 30+ `useState` | Exists, worse than reported | `src/App.jsx` is 3846 lines and has 63 `useState` calls. It also contains App shell, contact management, import modal, kanban, list items, helpers, and mobile branching. | Split by workflow boundary, not by cosmetic component size. |
| H2 | Unbounded memory cache growth | Partially exists | `src/components/WAMessageComposer.jsx:30` uses module-level `messagesCache = new Map()` with TTL deletion only on read/delete. `server/routes/v1Board.js:678` uses a single replacement cache object with TTL, so it is bounded by assignment rather than count. `server/events/sseBus.js` already caps `recentWaMessageIds` at 10000. | Fix composer cache first. Keep v1Board as watch item unless snapshots grow unexpectedly. |
| H3 | Multi-tab owner scope inconsistency | Exists | `src/utils/appAuth.js:148-163` writes owner scope to `localStorage`; `src/App.jsx:159-168` reads it during render/state initialization. There is no `storage` event listener to reconcile another tab's login/logout/scope switch. | Add single auth state source and cross-tab sync before touching owner-scoped UI. |
| H4 | Duplicate `/api/admin` route registration | Exists | `server/index.cjs:384` and `server/index.cjs:387` both mount `aiProvidersRouter` under `/api/admin`. | Remove duplicate mount and add regression assertion. |
| H5 | Creator API returns broad/sensitive fields | Partially exists | List route hides `wa_phone` unless privileged with requested field at `server/routes/creators.js:101` and `:703`, but detail route returns `getCreatorFull()` wholesale at `server/routes/creators.js:1258-1303`; `db.js:326-423` includes `wa_phone`, `messages` from `SELECT *`, aliases, keeper, JoinBrands, and WACRM fields. | Define role-aware response projections for list/detail/messages. Do not break fields needed by composer. |
| H6 | React StrictMode duplicate requests causing token waste | Partially exists | `src/main.jsx:26-32` enables `React.StrictMode`. `SFTDashboard.jsx:21-22` calls `loadData()` in mount effect; `SFTDashboard.jsx:29-57` fires tab-specific requests. SFTDashboard does not generate AI tokens directly, but duplicate fetches and 5 concurrent evaluation calls are real. | Treat as duplicate request/concurrency waste, not direct AI token waste for SFTDashboard. |

## Medium And Low Risk Check

| Risk | Current status | Evidence / rationale | Plan |
| --- | --- | --- | --- |
| SSE race / connection leak | Partially exists | Frontend closes EventSource on error and cleanup; backend removes clients on `res.close`. Remaining risk is no explicit auth/scope tagging per client and no max-client guard. | Keep in operational hardening phase. |
| No request ID tracing | Exists | Only UI jump `requestId` exists in `src/App.jsx`; no server `x-request-id` or `req.id` middleware was found. | Add request ID middleware and fetch propagation. |
| AI generation timeout has weak user feedback | Partially exists | Frontend uses 60s timeout in `experienceRouter.js`; provider path has 15s fine-tuned timeout and 60s fallback. UI shows loading/error, but no staged "still working/fallback provider" state. | Add generation progress states and timeout copy. |
| SFTDashboard tab switch starts 5 concurrent requests | Exists | Evaluation tab uses `Promise.all` across five endpoints in `SFTDashboard.jsx:29-36`. | Batch server endpoint or request cancellation/cache. |
| Error state display inconsistent | Exists | Several key loaders only `console.error`, e.g. `SFTDashboard.jsx:60`, `:77`, `EventPanel.jsx:187`, `App.jsx:340`, while other paths use toast or inline errors. | Standardize error surface per panel. |
| Mobile adaptation incomplete | Partially verified | Dedicated mobile shell exists, but large desktop components remain embedded inside generic mobile screens and require visual QA. | Include mobile screenshot and interaction checks per frontend phase. |
| Missing rate limiting | Mostly exists | Only translation quota returns 429; no general rate-limit middleware or dependency was found. | Add route-level limits for auth, AI, media upload, and write routes. |
| No integration tests | False as written | `tests/integration/` exists with Baileys receive/send/driver switch tests; package has `test:unit`, `test:full`, `test:ci`, and UI acceptance script. | Reframe as "integration coverage gaps for auth scope, SSE, creator projection, UI." |
| Logs not structured | Partially exists | `server/services/perfLog.js` emits optional JSON perf logs, but most runtime logs use `console.*` strings. | Adopt request-scoped structured logging gradually. |
| Keyboard navigation and ARIA missing | Partially exists | Some ARIA exists in modals/mobile nav, but many custom buttons/icons lack keyboard semantics. | Audit high-traffic flows first. |
| Emoji rendering compatibility | Unverified | Emoji picker and emoji prompt paths exist; no cross-platform rendering tests were found. | Cover with UI smoke and fallback font review after major UI work. |

## Remediation Principles

1. Preserve current MySQL and Obsidian-only project direction.
2. Do not reintroduce SQLite or `crm.db`.
3. Keep owner scope and `wa_phone` handling conservative; add tests before broadening responses.
4. Prefer response projection and cache wrappers over one-off field deletion at call sites.
5. Each phase must ship with its own verification before the next phase starts.

## Phase Plan

### Phase 0: Baseline Guardrails

Goal: lock down current behavior before refactors.

Implementation:

- Add or update tests that prove current route mounting, creator field exposure, owner scope, and core SFT dashboard request behavior.
- Document expected public fields for creator list/detail/message APIs.
- Add a source grep checklist for cache maps, route mounts, localStorage auth scope, and `SELECT *` responses.

Required tests:

- `npm run test:unit`
- `npm run test:full`
- Targeted route tests: `tests/creatorListFields.test.mjs`, `tests/routeScopeGuards.test.mjs`, `tests/api/requireAdminOnly.test.mjs`
- Manual grep gate: `rg -n "messagesCache|app.use\\('/api/admin|setAppAuthScope|SELECT \\*" src server db.js`

Exit criteria:

- Current known exposure and duplicate route behavior are captured in tests or documented as expected failing cases for the next phase.
- No production behavior changes except tests/docs.

### Phase 1: Low-Blast-Radius Server Fixes

Goal: remove obvious duplicated registration and bound the highest-confidence cache risk.

Implementation:

- Remove the duplicate `/api/admin` router mount.
- Wrap `messagesCache` with max entries plus TTL sweep on insert.
- Leave `v1Board` cache as object-replacement TTL unless memory profiling shows growth.

Required tests:

- `npm run test:unit`
- Add route mount regression test or supertest assertion that `/api/admin/ai-providers` executes once.
- Add unit test for composer cache helper if extracted; otherwise add a small module-level cache test after extraction.
- `npm run build`

Exit criteria:

- Duplicate admin route is gone.
- Composer message cache has bounded entry count and deterministic eviction.

### Phase 2: Auth Scope, Sensitive Projection, And Request IDs

Goal: harden cross-tab scope and make API/log traces correlate.

Implementation:

- Introduce an app auth store/hook that subscribes to `storage` events and refreshes session state across tabs.
- Make App derive `lockedOwner`, role, and write permissions from that store instead of one-time localStorage reads.
- Add request ID middleware that accepts or generates `X-Request-Id`, attaches it to `req`, response headers, audit context, and frontend fetch wrappers.
- Define creator response projections:
  - list: minimal fields, existing privileged `wa_phone` request remains explicit.
  - detail: role-aware field allowlist.
  - messages: message fields projected instead of `SELECT *` pass-through.

Required tests:

- `npm run test:unit`
- `npm run test:full`
- Add route tests for admin/operator/viewer creator list/detail/message projections.
- Add auth cross-tab manual test: login as one owner in Tab A, switch/logout in Tab B, confirm Tab A scope and writable controls update without reload.
- Verify no raw phone in server logs during tests with targeted grep on generated logs if available.

Exit criteria:

- Owner scope is consistent across tabs.
- Sensitive fields are explicitly projected by role and route.
- Every API response includes a request ID.

### Phase 3: AI/SFT Request Concurrency And User Feedback

Goal: reduce duplicate calls and make slow AI generation understandable to operators.

Implementation:

- Add idempotent load guards for `SFTDashboard` mount and active tab effects under StrictMode.
- Cancel or dedupe SFT tab requests on rapid tab switching.
- Replace evaluation tab's five independent fetches with either a backend aggregate endpoint or a frontend cache with cancellation.
- Add AI generation progress states: initial generation, fine-tuned timeout/fallback, retryable failure, and final provider metadata.

Required tests:

- `npm run test:unit`
- `npm run build`
- Add SFT route aggregate test if backend endpoint is introduced.
- Add UI acceptance check for SFT tab switching: no stale data overwrite and no duplicate pending state.
- Manual AI slow-path test with mocked provider timeout: visible progress and recoverable error.

Exit criteria:

- StrictMode no longer doubles SFT data loads.
- Evaluation tab no longer bursts five uncached requests on every switch.
- AI slow/fallback path has visible operator feedback.

### Phase 4: Frontend Decomposition, Error States, Mobile, And A11y

Goal: reduce `App.jsx` blast radius and normalize operator-facing UX.

Implementation:

- Extract `App.jsx` by workflow:
  - shell and routing state
  - creator list/filter state
  - contact management/import
  - owner transfer
  - kanban/list item view models
  - mobile shell adapters
- Standardize error surfaces: inline panel errors for data load, toast for transient actions, retry controls for recoverable failures.
- Run mobile UI pass on creator list, chat, event panel, SFT dashboard, accounts panel.
- Add keyboard/ARIA fixes for custom controls created during extraction.

Required tests:

- `npm run test:unit`
- `npm run build`
- `npm run test:ui:acceptance`
- Manual responsive checks at 390x844, 768x1024, and desktop widths.
- Keyboard smoke: tab order, Enter/Space activation, Escape closes modals/sheets.

Exit criteria:

- `App.jsx` no longer owns unrelated modal/import/kanban implementations.
- Main workflows show consistent loading/error/empty states.
- Mobile screens do not depend on hidden desktop-only affordances.

### Phase 5: Operational Hardening

Goal: make production behavior safer under bursts and reconnects.

Implementation:

- Add route-level rate limiting:
  - strict for `/api/auth/login`
  - moderate for AI generation and translation
  - upload-aware for media endpoints
  - conservative write limits for mutation routes
- Add SSE client caps, scoped event metadata, and clearer close/error metrics.
- Move high-value server logs to request-scoped structured JSON while leaving noisy worker logs for a later pass.
- Add integration coverage for SSE subscribe/broadcast cleanup and rate-limit 429 behavior.

Required tests:

- `npm run test:unit`
- `npm run test:full`
- Add SSE cleanup integration test.
- Add rate-limit tests for auth and AI routes.
- Run a short local soak: repeated SSE reconnects plus creator refresh, then confirm client count returns to zero.

Exit criteria:

- Burst behavior is bounded.
- SSE client lifecycle is observable.
- Request ID appears in structured logs for API errors.

## Initial Priority Order

1. H4 duplicate `/api/admin` mount.
2. H2 composer `messagesCache` bound.
3. H3 cross-tab auth owner scope.
4. H5 creator/detail/message response projection.
5. H6/SFT concurrency and AI feedback.
6. H1 App decomposition.
7. Rate limiting, SSE hardening, structured logs, a11y/mobile polish.

## Phase 1 Implementation Record

Date: 2026-05-08
Status: implemented

Changes:

- Removed the duplicate `app.use('/api/admin', aiProvidersRouter)` registration from `server/index.cjs`.
- Added `MESSAGES_CACHE_MAX_ENTRIES = 120` and `pruneMessagesCache()` to `src/components/WAMessageComposer.jsx`.
- Added `tests/phase1TechDebt.test.mjs` to assert the admin router is mounted once and the composer message cache remains bounded/pruned.

Verification:

- Passed: `node --test tests/phase1TechDebt.test.mjs`
- Passed: `node --test tests/api/requireAdminOnly.test.mjs tests/routeScopeGuards.test.mjs tests/creatorListFields.test.mjs`
- Passed: `node --check server/index.cjs`
- Passed: `npm run build`
- Passed: `node --test tests/phase1TechDebt.test.mjs tests/api/requireAdminOnly.test.mjs tests/routeScopeGuards.test.mjs tests/creatorListFields.test.mjs tests/api/driverSwitchCommands.test.mjs tests/unit/operatorOwnersEqual.unit.test.mjs`
- Blocked: `npm run test:unit` did not complete because `tests/unit/baileysDriver.unit.test.mjs` left a pending promise/open handle after 146s. The tests completed before that point reported 42 pass, 3 skip, 0 assertion failures, and 1 cancelled file after interruption.

Rollout note:

- Phase 1 is safe to review as a small code change. The full-unit blocker should be tracked separately because it reproduces in the Baileys driver test lifecycle, outside the modified files.

## Phase 2 Implementation Record

Date: 2026-05-08
Status: implemented

Changes:

- Added `server/middleware/requestId.js` and mounted it globally in `server/index.cjs`.
- Frontend auth fetch helpers now add `X-Request-Id` when the caller does not provide one.
- Added auth localStorage change notifications in `src/utils/appAuth.js`.
- Updated `src/App.jsx` to subscribe to auth snapshot changes so owner lock state updates after another tab changes login/scope.
- Updated `src/components/AppAuthGate.jsx` to react to cross-tab logout and username changes.
- Replaced `wm.*` in `server/routes/messages.js` with an explicit message/media field projection that excludes `proto_bytes` and `proto_driver`.
- Added creator detail message projection in `server/routes/creators.js` so embedded `detail.messages` also strips proto/internal fields.
- Resolved the creator-detail phone policy: raw `wa_phone` is only returned when the caller explicitly requests `fields=wa_phone` and is admin/service or owner-scoped to that creator; default detail responses include `wa_phone_masked`.
- Updated frontend detail fetches to request `fields=wa_phone` only for authenticated app workflows that still need phone as the current `client_id` bridge.
- Added `tests/phase2RequestAuthMessages.test.mjs` and extended `tests/creatorListFields.test.mjs`.
- Extended UI acceptance with browser-level cross-tab auth scope automation.

Verification:

- Passed: `npm run test:unit`
- Passed: `node --test tests/phase2RequestAuthMessages.test.mjs tests/phase1TechDebt.test.mjs tests/api/requireAdminOnly.test.mjs tests/routeScopeGuards.test.mjs tests/creatorListFields.test.mjs`
- Passed: `node --test tests/phase2RequestAuthMessages.test.mjs tests/creatorListFields.test.mjs tests/routeScopeGuards.test.mjs tests/api/requireAdminOnly.test.mjs`
- Passed: `node --check server/index.cjs && node --check server/middleware/requestId.js && node --check server/routes/messages.js`
- Passed: `node --check server/routes/creators.js && node --check server/routes/messages.js && node --check server/middleware/requestId.js`
- Passed: `npm run build`
- Passed: `npm run test:ui:acceptance` with `crossTabAuthSynced: true`

Remaining Phase 2 work:

- None inside Phase 2 scope.
- Deferred to Phase 5 logging: propagate request IDs into structured server logs.

## Phase 3 Implementation Record

Date: 2026-05-09
Status: implemented

Changes:

- Added `GET /api/generation-log/evaluation-summary` in `server/routes/audit.js` so the SFT evaluation tab can load A/B evaluation, generation stats, recent generation logs, RAG observation, and RAG sources through one aggregate request.
- Refactored `src/components/SFTDashboard.jsx` to use a small in-flight/result cache with 30s TTL, preventing StrictMode duplicate mount loads and deduping rapid tab switches.
- Added stale-response guards for SFT tab data so old tab responses cannot overwrite the currently active tab.
- Added visible AI generation progress stages in `src/components/WAMessageComposer/ai/experienceRouter.js`, `src/components/WAMessageComposer.jsx`, and `src/components/AIReplyPicker.jsx`: context preparation, generation, slow/fallback wait, retryable failure, and final provider/model metadata.
- Added `tests/phase3SftAiFeedback.test.mjs` and extended `tests/auditRoutes.test.mjs` for the aggregate endpoint.
- Extended UI acceptance with browser-level rapid SFT tab switching automation.
- Tightened Phase 3 source regression coverage for slow-provider fallback timing, 60s abort timeout, and timeout-specific retryable error copy.

Verification:

- Passed: `npm run test:unit`
- Passed: `node --check server/routes/audit.js`
- Passed: `node --test tests/phase3SftAiFeedback.test.mjs tests/auditRoutes.test.mjs`
- Passed: `node --test tests/phase2RequestAuthMessages.test.mjs tests/phase1TechDebt.test.mjs tests/api/requireAdminOnly.test.mjs tests/routeScopeGuards.test.mjs tests/creatorListFields.test.mjs`
- Passed: `npm run build`
- Passed: `npm run test:ui:acceptance` with `sftRapidTabStable: true`

Remaining Phase 3 work:

- None inside Phase 3 scope.
- Note: full end-to-end provider timeout against a live external provider remains an operational/manual QA scenario; local regression coverage now locks the slow/fallback UI path and timeout copy.

## Phase 4 Implementation Record

Date: 2026-05-09
Status: implemented

Changes:

- Extracted reusable panel resizing logic from `src/App.jsx` into `src/hooks/useResizablePanelWidths.js`, preserving localStorage-backed width memory and drag handling.
- Extracted kanban rendering from `src/App.jsx` into `src/components/KanbanView.jsx`, including button-based card activation and list semantics.
- Extracted contact management, manual creator entry, bulk import parsing, and owner transfer UI from `src/App.jsx` into `src/components/ContactManagementPage.jsx`.
- Added shared panel feedback primitives in `src/components/common/PanelFeedback.jsx`.
- Updated `src/components/SFTDashboard.jsx` and `src/components/EventPanel.jsx` to use consistent inline error/loading/empty surfaces for recoverable panel states.
- Added keyboard activation and `aria-pressed` state to event cards.
- Hardened the desktop/tablet top bar so primary tabs and operator actions do not push controls outside the viewport at 768px widths.
- Extracted owner transfer state, preview loading, execution, and error handling from `src/App.jsx` into `src/hooks/useOwnerTransfer.js`.
- Added dialog semantics and Escape close behavior to the manual creator/import modal.
- Added `tests/phase4FrontendDecomposition.test.mjs` to keep the App shell decomposition and feedback/a11y boundaries from regressing.
- Updated `tests/unit/baileysDriver.unit.test.mjs` to mock Baileys and pino, keeping the unit suite offline and removing the long-running real socket lifecycle.

Verification:

- Passed: `npm run test:unit`
- Passed: `node --test tests/phase4FrontendDecomposition.test.mjs`
- Passed: `node --test tests/unit/baileysDriver.unit.test.mjs`
- Passed: `npm run build`
- Passed: `npm run test:ui:acceptance`
- Passed: browser smoke at 390x844, 768x1024, and desktop widths after the header overflow fix.
- Passed: modal/sheet keyboard smoke for manual creator dialog, mobile filter sheet, and mobile more/account sheet; Tab focus moved into the surfaces and Escape closed them.

Rollout note:

- `src/App.jsx` is reduced from roughly 3848 lines to 2433 lines. It no longer owns the contact/import modal implementations, kanban card implementation, owner transfer API state, or low-level panel resize implementation.
- Phase 4 is ready to review as an incremental extraction and UX hardening pass. Chat shell and mobile shell extraction remain good future slices, but are no longer required for this phase's exit criteria.

## Phase 5 Implementation Record

Date: 2026-05-09
Status: implemented

Scope clarification:

- Deferred from Phase 2 to Phase 5 and now implemented: request ID propagation into request-scoped structured server logs.
- Phase 5 scope also includes route-level rate limiting, SSE lifecycle caps/metadata/metrics, and logging hardening.

Changes:

- Added `server/middleware/structuredLog.js` for JSON server events, request-context fields, request ID inclusion, and conservative phone/token/client ID redaction.
- Added `server/middleware/rateLimit.js` for process-memory route-level limits without introducing a new runtime dependency.
- Mounted strict login limiting on `POST /api/auth/login`.
- Mounted moderate AI limiting on the AI route bundle (`/api/minimax`, `/api/ai/*`, `/api/translate`).
- Mounted upload-aware media limiting for `/api/wa/media-assets` and `/api/wa/send-media`.
- Mounted a conservative unsafe-method `/api/*` write limiter as a general burst guard.
- Hardened `server/events/sseBus.js` with `SSE_MAX_CLIENTS`, scoped client metadata (`requestId`, owner scope, auth role, user id), initial `sse-meta` events, client summaries, and failed-write cleanup logging.
- Updated `/api/events/subscribe` and `/api/events/broadcast` logs to structured JSON.
- Aligned local API smoke tests with the current human-admin gate by allowing `LOCAL_API_AUTH_BYPASS` to satisfy `requireHumanAdmin` only outside production and only for the synthetic `LOCAL_BYPASS` auth principal.
- Added `tests/phase5OperationalHardening.test.mjs` for rate-limit 429 behavior, structured API error logging with request IDs, SSE cap/metadata/cleanup, and middleware mount regression.
- Extended `tests/api/requireAdminOnly.test.mjs` with `requireHumanAdmin` DB-admin, local-bypass, and production-rejection coverage.

Verification:

- Passed: `node --check server/middleware/structuredLog.js`
- Passed: `node --check server/middleware/rateLimit.js`
- Passed: `node --check server/events/sseBus.js`
- Passed: `node --check server/index.cjs`
- Passed: `node --check server/middleware/appAuth.js`
- Passed: `node --check tests/phase5OperationalHardening.test.mjs`
- Passed: `node --test tests/phase5OperationalHardening.test.mjs`
- Passed: `node --test tests/api/requireAdminOnly.test.mjs`
- Passed: `node --test tests/phase1TechDebt.test.mjs tests/phase2RequestAuthMessages.test.mjs tests/phase3SftAiFeedback.test.mjs tests/phase4FrontendDecomposition.test.mjs tests/phase5OperationalHardening.test.mjs tests/auditRoutes.test.mjs tests/aiRoutes.test.mjs tests/creatorListFields.test.mjs tests/routeScopeGuards.test.mjs tests/api/requireAdminOnly.test.mjs`
- Passed: `npm run test:unit`
- Passed: `npm run build`
- Passed: `npm run test:full`
- Passed: `npm run test:ci`
  - UI acceptance report: `reports/acceptance/ui-acceptance.json`
  - `consoleErrorCount: 0`
  - `pageErrorCount: 0`
  - `sftRapidTabStable: true`
  - `crossTabAuthSynced: true`
- Passed: local SSE bus soak with 75 repeated connect/broadcast/close cycles; final client count returned to 0.

Rollout note:

- The first rate-limit backend is in-process memory. It bounds single-process bursts immediately; Redis-backed or shared limits remain an optional future enhancement if deployment moves to multiple API workers.
- `LOCAL_API_AUTH_BYPASS` remains a non-production localhost-only bypass at the `requireAppAuth` layer; production still requires DB-backed admin sessions for `requireHumanAdmin`.

## Open Questions

- Should the SFT evaluation aggregate endpoint eventually include server-side response caching, or is the current frontend 30s in-flight/result cache enough for operator usage?
- Do we want Redis-backed rate limits later if production runs multiple API workers?

## Final Status

- Phase 1: implemented
- Phase 2: implemented
- Phase 3: implemented
- Phase 4: implemented
- Phase 5: implemented
- Verification: full local pass completed, including `npm run test:ci` with API smoke, build, unit tests, group-pollution check, and UI acceptance.

## Obsidian Sync

- Status: synced
- Note: `docs/obsidian/notes/2026-05-08-tech-debt-remediation-kickoff.md`
- Index: `docs/obsidian/index.md`
