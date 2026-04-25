# Lifecycle Event Strategy Handoff — 2026-04-24

## Scope

This handoff summarizes a read-only review of WA CRM v2 event-driven lifecycle recognition. No code was changed.

Primary files inspected:

- `server/routes/events.js`
- `server/services/lifecycleService.js`
- `server/services/lifecyclePersistenceService.js`
- `server/services/eventVerificationService.js`
- `src/components/EventPanel.jsx`
- `docs/LIFECYCLE_REFACTOR_PRD.md`
- `docs/EVENT_DECISION_TABLE.md`

## Current Diagnosis

The current lifecycle model is directionally useful, but it is not precise enough for production operation because event facts, event status, and lifecycle signals are not separated strictly enough.

Key observations from read-only DB checks:

- `events` contains 1622 rows.
- 1271 rows are generated `jb_touchpoint_*` event keys. These are high-volume touchpoints, not canonical lifecycle facts.
- 36 active rows are generated `violation_*` event keys with `event_type='challenge'`, which can pollute challenge counts and lifecycle evidence.
- Only 1 active event had `verification.review_status='confirmed'`; 180 active events were missing verification.
- 1404 completed events were missing verification.
- Active `trial_7day` and `monthly_challenge` events had no `event_periods` rows in the sampled aggregate, so challenge state is not connected to weekly settlement evidence.
- `creator_lifecycle_snapshot` had 20 conflict-bearing rows. Common conflict: a creator is in Retention or Revenue without a confirmed WA channel signal.

## Three High-Information Creators

The following creators should be used as calibration cases before changing lifecycle rules. They cover Revenue, Retention, Terminated, referral overlay, violation/risk overlay, imported events, and stale snapshot behavior.

### 1. Kelsey Sheppard — creator_id 957

Current runtime evaluation:

- Stage: `revenue`
- Signals: `gmv>=2000`, `agency_bound`
- Flags: `wa_joined=true`, `agency_bound=true`, `trial_completed=true`, `referral_active=true`, `gmv_tier=gte_5k`
- Keeper GMV: 9557.69
- Notable recent context: account freeze / withdrawal uncertainty / safety concern / bank account setup difficulty.

Why this sample matters:

- It is a strong Revenue case by GMV and order volume.
- It is not a clean "growth" Revenue case because there is an active account/withdrawal risk.
- Snapshot and runtime evaluation diverged before re-evaluation: stored snapshot had `agency_bound=false` while CRM facts had `agency_bound=1`. This means snapshot freshness must be part of the next fix.

Recommended lifecycle treatment:

- Main stage should remain `revenue`.
- Add overlay flag: `risk_control_active` or `settlement_blocked`.
- Option0 should not be generic GMV amplification. It should prioritize settlement path, account recovery, payout feasibility, and safe restart.

### 2. Amanda Gonzalez — creator_id 932

Current runtime evaluation:

- Stage: `retention`
- Signals: `agency_bound`
- Flags: `wa_joined=true`, `agency_bound=true`, `trial_completed=true`, `referral_active=true`, `gmv_tier=lt_2k`
- Keeper GMV: null
- Notable recent context: creator says account is banned, cannot post, asks how commission will be paid on old sales, and mentions GMV around $9,400 in chat.

Why this sample matters:

- Structured GMV data is missing, but conversation contains a strong revenue/settlement claim.
- Current rules keep the creator in Retention because only structured Keeper/JB GMV is consumed for Revenue.
- This exposes a gap between "verified external GMV" and "claimed/in-chat GMV requiring review".

Recommended lifecycle treatment:

- Main stage should be `retention` until GMV is cross-checked.
- Add overlay flag: `revenue_claim_pending_verification`.
- If operator or external system confirms the GMV amount, transition to `revenue`.
- If account ban prevents posting, add overlay `risk_control_active`; do not mark `terminated` unless there is explicit opt-out or no remaining settlement/recovery path.

### 3. Ashley Tabor — creator_id 711

Current runtime evaluation:

- Stage: `terminated`
- Signals: `ev_churned|termination_signal`
- Flags: `wa_joined=true`, `agency_bound=true`, `trial_completed=true`, `trial_in_progress=true`, `referral_active=true`, `gmv_tier=lt_2k`
- Conflict: `gmv_not_revenue`
- Notable context: monthly beta/payment-cycle discussion, referral activity, agency linking, violation/appeal handling, weekly video count and settlement discussion.

Why this sample matters:

- It shows a terminal-stage override colliding with active business signals.
- The creator has referral and settlement context after earlier risk/churn indicators.
- The current conflict says GMV reached but stage is not Revenue, even though `keeper_gmv=0`. This likely comes from imported/completed GMV event data rather than current external GMV.

Recommended lifecycle treatment:

- Do not let cached `ev_churned` alone force `terminated` when later messages show active payment/referral/support behavior.
- Introduce `blocked_or_risk_hold` overlay instead of terminal override unless explicit stop/contact rejection exists.
- Treat imported GMV milestones without amount/source verification as weak evidence and do not use them as Revenue main-stage triggers.

## Proposed Strategy Optimization

### 1. Separate Main Stage From Overlays

Keep `stage_key` as a single AARRR mainline:

- `acquisition`
- `activation`
- `retention`
- `revenue`
- `terminated`

Move these into parallel flags/overlays:

- `referral_active`
- `risk_control_active`
- `settlement_blocked`
- `revenue_claim_pending_verification`
- `migration_imported_fact`
- `weak_event_evidence`
- `challenge_period_missing`

Do not create new main stages for referral, violation, risk, or settlement.

### 2. Add Evidence Tiers

Lifecycle should consume facts by evidence tier:

- Tier 0: raw keyword candidate, draft, or dynamic touchpoint. Never drives lifecycle.
- Tier 1: imported/manual event without source quote or verification. Can show badge, should not force main-stage transitions except as weak fallback.
- Tier 2: active/completed canonical event with source message anchor or operator-confirmed import. Can drive lifecycle.
- Tier 3: external-system verified fact, such as Keeper GMV or confirmed JoinBrands binding. Highest priority.

### 3. Canonical Event Keys Only

Only these event keys should feed lifecycle directly:

- `trial_7day`
- `monthly_challenge`
- `agency_bound`
- `gmv_milestone`
- `referral`
- `recall_pending`
- `second_touch`
- explicit termination keys such as `churned`, `do_not_contact`, `opt_out`

Generated keys such as `jb_touchpoint_*`, `violation_*`, `referral_unknown`, and `gmv_milestone_10k` should be normalized before lifecycle consumption or moved to overlays.

### 4. Stage Rules

Recommended mainline rules:

- `acquisition`: WA/channel is established or outreach is in progress; no verified trial, agency, or GMV.
- `activation`: verified trial/beta/challenge activity exists; no verified agency completion and no verified GMV threshold.
- `retention`: verified agency binding or sustained monthly execution exists; no verified GMV threshold.
- `revenue`: Keeper/JB GMV crosses threshold, or a canonical verified `gmv_milestone` includes amount/source confirmation.
- `terminated`: explicit opt-out, do-not-contact, permanently ended collaboration, or manually confirmed terminal status. Cached churn flags should not override later active settlement/referral/support evidence.

### 5. Precedence

Use precedence plus overlays:

1. Explicit do-not-contact or manual terminal confirmation -> `terminated`.
2. Verified GMV or settlement owed -> `revenue`, with risk overlay if account is frozen/banned.
3. Verified agency bound -> `retention`, with risk overlay if posting is blocked.
4. Verified trial/challenge -> `activation`.
5. WA joined only -> `acquisition`.

Important nuance: account ban or violation should not automatically mean `terminated`. It is often a risk/settlement state.

### 6. Challenge and Bonus Closure

Challenge lifecycle should not rely only on an active challenge event. It needs period evidence:

- `trial_7day` or `monthly_challenge` active without any `event_periods` should set `challenge_period_missing=true`.
- Bonus judge should consume external or operator-entered video count with source, not default `meta.video_count || 0`.
- `completed` challenge should require period close, explicit completion evidence, or operator confirmation.

## Next Agent Checklist

1. Rebuild an audit query over all creators:
   - active/completed canonical events without verification
   - generated event keys currently active/completed
   - lifecycle conflicts by stage
   - snapshot vs runtime evaluation mismatch
2. Create a 30-case truth set:
   - 10 Revenue/risk cases
   - 10 Retention/agency cases
   - 5 Terminated/churn cases
   - 5 Activation/challenge cases
3. Define a machine-readable event evidence contract:
   - `evidence_tier`
   - `source_kind`
   - `source_message_id`
   - `source_quote`
   - `external_system`
   - `verified_by`
   - `verified_at`
4. Update lifecycle evaluation only after the truth set has expected outputs.
5. Rebuild snapshots and compare before/after:
   - stage distribution
   - conflict count
   - number of creators moving out of terminal
   - number of creators moving into revenue only by verified GMV

## Suggested Acceptance Gates

- Active/completed lifecycle-driving events have at least 80% evidence coverage after backfill.
- No generated `jb_touchpoint_*` event drives lifecycle directly.
- No `violation_*` event is typed as `challenge` for lifecycle purposes.
- Runtime evaluation and stored snapshot agree for the sampled creators.
- Ashley-like cases do not become terminal unless there is explicit opt-out or manual terminal confirmation.
- Amanda-like cases receive `revenue_claim_pending_verification` rather than silent Retention.
- Kelsey-like cases remain Revenue but get risk/settlement overlays that change Option0.

## Verification Notes

Commands were read-only. A direct MySQL query required sandbox escalation because local DB access to `127.0.0.1:3306` was blocked in the default sandbox.

No repository code was modified as part of the analysis.
