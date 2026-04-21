# Local Rule Retrieval Design - 2026-04-20

Date label: `2026-04-20`

Status: PR-ready design and shadow validation plan

Scope: WA CRM reply generation grounding path

## Runtime Decision

The main reply path should stay on the OpenAI-compatible provider, but the experimental layers should no longer block or influence the primary path.

Recommended current-instance environment:

| Variable | Target value | Purpose |
| --- | --- | --- |
| `USE_OPENAI` | `true` | Keep OpenAI-compatible inference as the main provider. |
| `OPENAI_MODEL` | `gpt-4.1-mini` | Keep the current low-latency main model. |
| `VITE_USE_OPENAI` | `true` | Keep the frontend on the OpenAI-backed generation path. |
| `USE_FINETUNED` | `false` | Disable finetuned model routing. |
| `AB_RATIO` | `0` | Prevent canary traffic from reaching the finetuned branch. |
| `OPENAI_RAG_ENABLED` | `false` | Remove vector retrieval from the main reply chain. |
| `OPENAI_VECTOR_STORE_ID` | keep configured | Dormant rollback/experiment value only. |
| `OPENAI_RAG_TOP_K` | keep configured | Dormant rollback/experiment value only. |
| `FINETUNED_BASE` | keep configured | Dormant rollback value only. |
| `FINETUNED_MODEL` | keep configured | Dormant rollback value only. |

## Problem

The current data scale and rule surface are small, operator-specific, and policy-heavy. This makes deterministic local retrieval more reliable than vector RAG or finetuning:

- Policy changes must be auditable by source, version, and effective date.
- Operator-specific rules are already structured in `operator_experiences`.
- Customer-specific memory is already structured in `client_memory`.
- Vector RAG is useful for experiments, but it should not decide the main reply grounding when the source set is small.
- Finetuning is slower to update and less transparent for hard policy changes.

## Goals

- Replace vector-store dependency in the main path with local, deterministic rule retrieval.
- Keep rule selection explainable through `retrieval_snapshot.grounding_json`.
- Keep vector RAG as an optional experiment, controlled by `OPENAI_RAG_ENABLED`.
- Keep the current OpenAI-compatible generation path unchanged.
- Support shadow validation before prompt injection becomes default.

## Non-Goals

- Do not remove OpenAI inference.
- Do not delete vector-store scripts or vector-store configuration.
- Do not train or route traffic to finetuned models in the main path.
- Do not add a new database dependency for phase 1.

## Existing Anchors

Current grounding already centralizes the important data sources:

- `server/services/retrievalService.js` loads creator lifecycle, operator experience, client memory, active policy documents, and optional vector hits.
- `systemPromptBuilder.cjs` already has a prompt insertion slot after policy and memory grounding.
- `retrieval_snapshot.grounding_json` already records selected policy, memory, and RAG metadata.
- `generation_log` already records provider/model/route/latency, which is enough for shadow evaluation.

This means the first implementation should extend the existing retrieval layer instead of replacing the reply generation service.

## Corpus Sources

Local rule retrieval should normalize these sources into one rule corpus.

| Source | Role | Priority |
| --- | --- | --- |
| `policy_documents` | Hard policy and business constraints | 1 |
| `operator_experiences` | Operator-specific system prompt, scene fragments, forbidden rules | 2 |
| `docs/rag/knowledge-manifest.json` + `docs/rag/sources/*.md` | SOP, FAQ, playbook, pricing, compliance notes | 3 |
| `client_memory` | Personalization hints and client-specific preferences | Separate block |

Conflict rule: `policy > operator_experience > sop/playbook/faq > client_memory`.

## Rule Unit Contract

Every source should be normalized into compact rule cards:

```js
{
  rule_id: 'policy-trial-pack-v1:trial-completed',
  source_type: 'policy',
  source_ref: 'docs/rag/sources/policy-trial-pack-v1.md',
  title: 'Trial completion is completed, not active',
  scene_scope: ['trial_intro', 'trial_followup'],
  operator_scope: ['Yiyun'],
  lifecycle_scope: [],
  beta_scope: ['trial_active', 'trial_completed'],
  priority: 1,
  status: 'approved',
  effective_from: '2026-04-15',
  rule_version: '2026-04-15',
  keywords: ['7-day trial', 'finished', 'completed', 'monthly', '$20'],
  must_follow: ['Treat a finished 7-day trial as completed, not active.'],
  must_avoid: ['Do not invite the creator to start the same trial again.'],
  snippet: 'If the creator says they finished the 7-day trial, move to post-trial/monthly guidance.',
  examples: []
}
```

## Retrieval Algorithm

1. Load approved sources:
   - Active rows from `policy_documents`.
   - Active rows from `operator_experiences`.
   - Manifest sources with `status=approved` and existing local files.
   - Current `client_memory` for the selected client.
2. Build query text:
   - `latest_user_message`
   - `query_text`
   - `topicContext`
   - `richContext`
   - `conversationSummary`
   - scene/lifecycle/beta status tags
3. Hard filter:
   - `status=approved`
   - `effective_from <= today`
   - scene matches, unless the rule is global
   - operator matches, unless the rule is global
4. Score remaining rules:
   - exact scene match
   - exact operator match
   - lifecycle/beta status match
   - keyword overlap
   - phrase match
   - source priority boost
   - recency boost through `rule_version`
5. Resolve conflicts:
   - higher authority source wins
   - newer `rule_version` wins inside the same source type
   - lower `priority` wins as a tie-breaker
6. Return compact rule cards:
   - default `LOCAL_RULES_TOP_K=6`
   - reject cards below `LOCAL_RULES_MIN_SCORE`

## Prompt Integration

When `LOCAL_RULES_ENABLED=true`, inject selected cards as:

```text
【本地规则卡片 - 必须遵守】
1. [policy-trial-pack-v1 | policy | version=2026-04-15]
Must follow: Treat a finished 7-day trial as completed, not active.
Must avoid: Do not invite the creator to start the same trial again.
Snippet: Move to post-trial/monthly guidance.
```

Rules:

- The block should be placed after policy/operator grounding and before style rules.
- Keep the block short enough for reply generation.
- Do not inject raw full documents.
- Do not inject draft/deprecated sources.
- Keep `client_memory` in a separate personalization block.

## Observability

Write selected local rules into `retrieval_snapshot.grounding_json`:

```json
{
  "local_rules": {
    "enabled": true,
    "mode": "shadow",
    "selected": [
      {
        "rule_id": "policy-trial-pack-v1:trial-completed",
        "source_type": "policy",
        "score": 12,
        "rule_version": "2026-04-15"
      }
    ],
    "dropped_conflicts": [],
    "missing_sources": []
  },
  "rag": {
    "enabled": false
  }
}
```

## Shadow Validation

Shadow cases live under:

- `docs/rag/shadow-cases/local-rule-shadow-cases.json`

Unit validation lives under:

- `tests/localRuleShadowCases.test.mjs`

The shadow tests check:

- All approved manifest sources exist locally.
- Every shadow case references approved, existing sources.
- Expected sources cover the case scene.
- Expected evidence terms exist in the source docs.
- A simple deterministic lexical scorer can rank the expected source at the top for the case.

## Rollout Plan

Phase 0 - current PR:

- Disable finetuned routing with `USE_FINETUNED=false`.
- Set `AB_RATIO=0`.
- Disable vector retrieval with `OPENAI_RAG_ENABLED=false`.
- Add the missing local trial policy source.
- Add shadow validation cases and tests.
- Document the local rule retrieval target design.

Phase 1 - shadow implementation:

- Add `localRuleRetrievalService`.
- Load/normalize local rule corpus at process start.
- Run retrieval in shadow mode and write `grounding_json.local_rules`.
- Do not inject local rules into prompt yet.

Phase 2 - prompt injection:

- Enable `LOCAL_RULES_ENABLED=true`.
- Inject compact local rule cards into `systemPromptBuilder.cjs`.
- Keep `OPENAI_RAG_ENABLED=false`.

Phase 3 - optional RAG experiment:

- Compare local rules against vector-store RAG in a separate observation window.
- Keep vector RAG behind `OPENAI_RAG_ENABLED`.
- Do not let vector RAG override hard local policy.

## Suggested Future Env Vars

```bash
LOCAL_RULES_ENABLED=true
LOCAL_RULES_SHADOW_MODE=true
LOCAL_RULES_TOP_K=6
LOCAL_RULES_MIN_SCORE=2
LOCAL_RULES_MANIFEST_PATH=docs/rag/knowledge-manifest.json
LOCAL_RULES_SOURCES_DIR=docs/rag/sources
LOCAL_RULES_REQUIRE_EXISTING_FILES=true
LOCAL_RULES_REFRESH_SECONDS=60
LOCAL_RULES_LOG_VERBOSE=false
```

## PR Description Draft

Title:

```text
docs(rag): downgrade vector RAG and define local rule retrieval shadow path
```

Summary:

- Documents the decision to keep OpenAI-compatible generation as the main path while disabling finetuned canary routing and vector RAG in the active runtime configuration.
- Adds the missing `policy-trial-pack-v1.md` knowledge source referenced by the manifest.
- Adds local-rule shadow validation fixtures and unit tests so future implementation can verify source coverage before prompt injection.
- Keeps vector-store and finetuned model identifiers available as dormant rollback/experiment configuration only.

Validation:

- `npm run rag:manifest:check`
- `npm run test:unit`

Risk:

- This PR does not change runtime generation code.
- The `.env` change affects the active local instance by disabling finetuned and vector RAG paths.
- Future prompt injection should ship separately after shadow metrics are reviewed.
