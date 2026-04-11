---
name: Frontend Code Review Report
type: review
date: 2026-04-11
scope: src/
---

# Frontend Code Review Report

**Review Date:** 2026-04-11
**Scope:** `src/` (React frontend, components, hooks, utils) + build tooling
**Files Reviewed:** 24 files (~3,500 lines of code)

---

## 1. Executive Summary

| Severity | Count |
|----------|-------|
| Critical | 0 |
| High | 4 |
| Medium | 10 |
| Low / Observation | 16 |
| **Total** | **30** |

**Overall Assessment:** Well-structured codebase with solid race condition prevention, SSE polling, and async patterns. No XSS vulnerabilities. Key concerns: SSE reconnection, memory leak in message polling, blocking alert() in error path, and accessibility gaps.

---

## 2. Critical Issues

*(None identified)*

---

## 3. High Issues

### H-1: SSE connection failure silently unrecoverable
**File:** `src/App.jsx:198-204`
Comment says "5秒后自动重连" but no reconnection logic exists. If SSE drops, the channel is permanently dead until component remount.

### H-2: Memory leak in `useMessagePolling` — requestVersion not incremented on abort
**File:** `src/components/WAMessageComposer/hooks/useMessagePolling.js:80-83`
When `AbortSignal.timeout(15000)` fires, `requestVersionRef` is **not** incremented. Stale responses from aborted requests can leak message state across creator switches.

### H-3: Missing `AbortController` cleanup in WAMessageComposer
**File:** `src/components/WAMessageComposer.jsx:167-229`
Preload `useEffect` starts async fetch operations without `AbortController`. In-flight requests continue after unmount, causing out-of-order responses on rapid creator switching.

### H-4: `handleManualGenerate` uses blocking `alert()` for error UX
**File:** `src/components/WAMessageComposer.jsx:744-746`
`alert()` blocks UI thread and is inaccessible. All other error paths use `setPickerError()`. Manual generate path is inconsistent.

---

## 4. Medium Issues

### M-1: Dead import — `useAICandidate` hook never used
**File:** `src/components/WAMessageComposer.jsx:7`

### M-2: Dead import — `useRef` unused in `useAICandidate.js`
**File:** `src/components/WAMessageComposer/hooks/useAICandidate.js:5`

### M-3: `handleBotIconClick` has no error feedback to user
**File:** `src/components/WAMessageComposer.jsx:424-428`
Silently swallows errors. Unlike `handleRegenerate` and `generateForIncoming`, no `setPickerError()` call.

### M-4: `EventPanel` create button has no loading/disabled state
**File:** `src/components/EventPanel.jsx:623-630`
Rapid double-click could trigger two API calls.

### M-5: `ReviewPanel` has no error display on failed review action
**File:** `src/components/SFTDashboard.jsx:437-438`
Review action silently fails — no toast or inline error shown.

### M-6: `SFTDashboard` initial load has no refresh on mount after background tab
**File:** `src/components/SFTDashboard.jsx:17-19`

### M-7: SSE `onerror` reconnection not implemented
**File:** `src/App.jsx:191-205`
No `es.close()` on connection failure. SSE channel permanently dead.

### M-8: `getCreatorLastConversationTs` misclassifies second-level timestamps
**File:** `src/App.jsx:754-773`
Threshold `> 1e12` could misclassify valid second timestamps (e.g., `1600000000`).

### M-9: `TrendsPanel` SVG chart Y-axis always scales to 100%
**File:** `src/components/SFTDashboard.jsx:565`
`maxVal` should auto-scale to actual maximum data value.

### M-10: `translateProgress` division by zero edge case
**File:** `src/components/WAMessageComposer.jsx:1008`
`parseInt('')` returns `NaN` → `width="NaN%"`.

---

## 5. Low Issues / Observations

- **L-1:** `vite.config.js:44` — `minify: false` in production build (intentional for debugging?)
- **L-2:** `SFTDashboard` `compact` prop accepted but ignored.
- **L-3:** `judging` state in `EventPanel` set but never read for UI feedback.
- **L-4:** `JudgeQuickForm` `onClose` prop passed as empty function.
- **L-5:** `ChatListItem` uses inline `onMouseEnter`/`onMouseLeave`. Should use CSS hover states.
- **L-6:** Hardcoded magic numbers scattered (polling intervals, thresholds).
- **L-7:** `handleCreate` resets form field by field instead of deriving from a constant.
- **L-8:** API URL base consistency is good — all calls use `const API_BASE = '/api'`.

---

## 6. React-Specific Issues

| ID | File | Description |
|----|------|-------------|
| R-1 | `useMessagePolling.js` | 6 deps in `checkNewMessages` resets polling on every creator switch |
| R-2 | `SFTDashboard.jsx` | `loadData` dependency on `filterOwner` restarts 15s polling on filter change |
| R-3 | `KanbanCard` | Not wrapped in `React.memo` — unnecessary re-renders |
| R-4 | `SFTDashboard.jsx` | No `key` fallback for `records` — fragile if `record.id` not unique |
| R-5 | `App.jsx` | `buildCreatorViewModel` always returns new object reference |
| R-6 | `WAMessageComposer.jsx:631` | `sendOutboundMessage` doesn't clear `pickerError` on success |

---

## 7. Accessibility Findings

| ID | Severity | File | Description |
|----|----------|------|-------------|
| A-1 | High | `App.jsx:946` | `ChatListItem` is `<div>` with no `role`/`tabIndex`/`onKeyDown` |
| A-2 | Medium | Multiple | 10+ icon-only buttons missing `aria-label` |
| A-3 | Medium | `App.jsx:421-448` | Filter selects have no `<label>` or `aria-label` |
| A-4 | Low | `EventPanel.jsx:516-634` | Modal overlay doesn't trap focus |
| A-5 | Low | `SFTDashboard.jsx:189` | Loading spinner lacks `role="status"` |

---

## 8. Performance Observations

- **P-1:** `filteredCreators` re-filters 115+ array every 15s polling cycle.
- **P-2:** `AIReplyPicker` renders AI text without length cap.
- **P-3:** `translateProgress` string parsing runs on every render during translation.
- **P-4:** `KanbanView` re-renders on any creator update (missing memoization).

---

## 9. Positive Findings

1. **Race condition prevention**: `generationRaceRef` correctly prevents stale generation results.
2. **Stale closure pattern**: `loadDataRef` in `App.jsx` is the correct pattern for SSE handlers.
3. **AbortSignal timeout**: All fetch calls use `AbortSignal.timeout()` (15s-60s).
4. **Error handling**: All async API calls wrapped in try/catch.
5. **Pure function utilities**: `extractors.js`, `topicDetector.js`, `systemPromptBuilder.js` — no side effects.
6. **Input sanitization**: React's default text interpolation prevents XSS.
7. **Deleted files confirmed absent**: `src/utils/minimax.js` and `src/utils/openai.js` cause no errors.
8. **Token abstraction**: `appAuth.js` and `waAdmin.js` properly abstract auth.
9. **Memoized computations**: `filteredCreators`, `ownerOptions` use `useMemo`.
10. **CSS consistency**: Tailwind CSS used without global class collisions.

---

## 10. Recommendations

### Priority 1 (Fix Soon)
1. Fix SSE reconnection (`src/App.jsx:198-204`)
2. Fix `requestVersion` memory leak (`useMessagePolling.js:80-83`)
3. Replace `alert()` with `setPickerError()` (`WAMessageComposer.jsx:746`)
4. Add error feedback to `handleBotIconClick` (`WAMessageComposer.jsx:424-428`)

### Priority 2 (Nice to Have)
5. Add `disabled` state to EventPanel create button
6. Auto-scale Y-axis in TrendsPanel (`SFTDashboard.jsx:565`)
7. Keyboard navigation for `ChatListItem` — change `<div>` to `<button>`
8. Add `aria-label` to all icon-only buttons
9. Guard `translateProgress` parse — add `NaN` check
10. Remove dead `useAICandidate` import

### Priority 3 (Long-term)
11. Consider `React.memo` for `KanbanCard`
12. Extract magic numbers into `constants/` file
13. Enable `minify: true` in production builds
14. Add `<label>` elements for filter selects
15. Add `setPickerError(null)` after successful `sendOutboundMessage`
