# Event and Lifecycle Data Model PRD

Date: 2026-04-25
Project: WA CRM v2
Status: Implementation baseline

## 1. Goal

The event system must stop treating every row in `events` as the same kind of business fact.

The target model separates four concerns:

- Event definitions: what event keys mean.
- Event facts: what happened to a creator.
- Evidence and verification: why the system believes the fact.
- Lifecycle snapshots: the derived current stage and transition history.

This keeps operational views, AI routing, lifecycle evaluation, and dashboard statistics on one stable contract.

## 2. Current Problems

The current codebase already has `events`, `event_periods`, `events_policy`, `creator_lifecycle_snapshot`, and `creator_lifecycle_transition`, but the boundary between them is still soft.

Main issues:

- `events` mixes canonical lifecycle facts, semantic drafts, imported JoinBrands touchpoints, generated violation events, and GMV hints.
- `joinbrands_link.ev_*` is still writable from `/api/creators/:id/wacrm` and still drives list filters.
- Some lifecycle readers fetch event rows without `meta`, so weak MiniMax or keyword evidence can look stronger than it is.
- Dashboard stats count `events.created_at`, which answers "when the system recorded a row", not necessarily "when the business event happened".
- Challenge events can be active/completed without matching `event_periods`, so bonus settlement has no period-level evidence.

## 3. Data Layers

### 3.1 Definition Layer

`event_definitions` owns the meaning of each canonical event key.

Required fields:

| Field | Meaning |
| --- | --- |
| `event_key` | Canonical key such as `trial_7day` or `agency_bound` |
| `event_type` | `challenge`, `agency`, `gmv`, `referral`, `termination`, `followup` |
| `label` | Display label |
| `lifecycle_effect` | `none`, `overlay`, or `stage_signal` |
| `is_periodic` | Whether `event_periods` is expected |
| `allow_parallel` | Whether multiple active instances may coexist |
| `requires_verification` | Whether human or external confirmation is required |
| `owner_scope_json` | Owners allowed to use this event |

Canonical lifecycle keys remain:

- `trial_7day`
- `monthly_challenge`
- `agency_bound`
- `gmv_milestone`
- `referral`
- `recall_pending`
- `second_touch`
- `churned`
- `do_not_contact`
- `opt_out`

Generated keys such as `jb_touchpoint_*`, `violation_*`, `*_unknown`, and `gmv_milestone_10k` are not canonical lifecycle facts.

### 3.2 Fact Layer

`events` records business facts and candidates.

Additive target fields:

| Field | Meaning |
| --- | --- |
| `canonical_event_key` | Normalized canonical key; null for non-canonical generated rows |
| `event_state` | `candidate`, `active`, `completed`, `cancelled`, `expired` |
| `review_state` | `unreviewed`, `confirmed`, `rejected`, `uncertain` |
| `evidence_tier` | 0 to 3 evidence strength |
| `source_kind` | `keyword`, `llm`, `operator`, `external_system`, `migration` |
| `source_event_at` | When the business event happened |
| `detected_at` | When WA CRM detected or imported it |
| `verified_at` | When it was confirmed |
| `verified_by` | Operator or system actor |
| `idempotency_key` | Stable dedupe key |
| `lifecycle_effect` | Copied from definition at write time |
| `expires_at` | Optional expiry for candidates and temporary overlays |

Compatibility rule:

- Existing `status` remains until API consumers migrate.
- `status='draft'` maps to `event_state='candidate'`.
- `status in ('active','completed')` can only drive lifecycle when evidence is strong enough.

### 3.3 Evidence Layer

`event_evidence` records why a fact exists.

Required fields:

| Field | Meaning |
| --- | --- |
| `event_id` | Parent event |
| `source_kind` | Message, external system, operator, migration, LLM |
| `source_table` | Optional table name such as `wa_messages` |
| `source_record_id` | Optional source row id |
| `source_message_id` | Message anchor |
| `source_message_hash` | Message hash anchor |
| `source_quote` | Short source quote |
| `external_system` | Keeper, JoinBrands, manual CSV, etc. |
| `raw_payload_hash` | Dedupe and audit hash |

`event_state_transitions` records every event state change. Audit log remains for security and operator auditing, not for product history.

### 3.4 Derived Snapshot Layer

`creator_event_snapshot` is the compatibility and performance layer.

Required fields:

| Field | Meaning |
| --- | --- |
| `creator_id` | Creator |
| `active_event_keys_json` | Active canonical keys |
| `overlay_flags_json` | Parallel flags such as referral or settlement risk |
| `compat_ev_flags_json` | Derived replacement for `joinbrands_link.ev_*` |
| `latest_event_at` | Latest business event timestamp |
| `rebuilt_at` | Snapshot rebuild time |

`joinbrands_link.ev_*` becomes a compatibility cache only. New writes should create events or verified facts first, then derive compatibility flags.

## 4. Evidence Tiers

| Tier | Source | Lifecycle behavior |
| --- | --- | --- |
| 0 | Raw keyword candidate or unanchored LLM hint | Never drives lifecycle |
| 1 | Imported/manual weak fact without quote or verification | Badge only; no main-stage transition |
| 2 | Anchored message or operator-confirmed canonical fact | Can drive lifecycle |
| 3 | External-system verified fact such as Keeper GMV | Highest-priority lifecycle input |

Lifecycle must consume only:

- Canonical event keys.
- `status in ('active','completed')`.
- Evidence Tier 2 or 3 when evidence metadata exists.
- Legacy canonical events without evidence metadata as transitional fallback.

## 5. Lifecycle Contract

Main stages remain singular:

- `acquisition`
- `activation`
- `retention`
- `revenue`
- `terminated`

Parallel overlays remain separate:

- `referral_active`
- `risk_control_active`
- `settlement_blocked`
- `revenue_claim_pending_verification`
- `migration_imported_fact`
- `weak_event_evidence`
- `challenge_period_missing`

Termination requires explicit opt-out, do-not-contact, or manual terminal confirmation. Account ban, violation, withdrawal issue, or posting block should be modeled as risk or settlement overlays, not terminal stage.

## 6. Dashboard Metrics

Dashboard event metrics must expose explicit basis:

| Metric | Basis |
| --- | --- |
| `total_events` | All event rows, backward compatible |
| `total_canonical_events` | Canonical, non-generated rows |
| `total_lifecycle_driving_events` | Canonical active/completed rows allowed to drive lifecycle |
| `yesterday_detected_events` | Rows created/detected yesterday |
| `yesterday_business_events` | Canonical lifecycle-driving events whose source/start/business time was yesterday |
| `yesterday_confirmed_events` | Events confirmed yesterday |

The old `yesterday_new_events` field remains as an alias for detected rows until the UI is renamed.

## 7. Implementation Phases

### Phase 1: Compatibility Hardening

- Add shared event fact helpers.
- Ensure lifecycle readers include `meta` and filter weak/generated rows consistently.
- Add explicit dashboard metric fields.
- Add production audit SQL.

### Phase 2: Schema Migration

- Add target columns to `events`.
- Add `event_definitions`, `event_evidence`, `event_state_transitions`, and `creator_event_snapshot`.
- Backfill evidence fields from `events.meta`.
- Build derived snapshots.

### Phase 3: Write-Path Migration

- Change manual WA CRM flag writes into event writes or verified fact writes.
- Make `joinbrands_link.ev_*` read-only compatibility output.
- Route event writes through idempotency keys.

### Phase 4: UI Migration

- Event filters read `creator_event_snapshot` or `/api/events` facts.
- Dashboard shows detected, business, and confirmed metrics with clear labels.
- Event panel can filter `scope=canonical`, `scope=lifecycle`, or `scope=all`.

## 8. Acceptance Gates

- No generated `jb_touchpoint_*`, `violation_*`, `*_unknown`, or tier-0/1 event drives lifecycle.
- Lifecycle readers produce the same result whether called from creator list, creator detail, reply strategy, or Experience Router.
- At least 80 percent of active/completed canonical events have source anchor, operator confirmation, or external-system evidence.
- Challenge active/completed events without `event_periods` are visible as audit findings.
- Dashboard exposes detected, business, and confirmed event counts separately.
- `joinbrands_link.ev_*` has a documented deprecation path and is no longer the primary write target for new event facts.

## Obsidian Sync

- Status: synced
- Note: `docs/obsidian/notes/2026-04-25-event-lifecycle-data-model.md`
- Index: `docs/obsidian/index.md`
