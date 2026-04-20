# April SOP Mapping - Current Document To Runtime Assets

Source document: `/Users/depp/Downloads/达人建联各SOP话述(4月版).docx`

Purpose: split the current April SOP into assets that fit the existing WA CRM reply architecture without mixing campaign copy, hard policy, and operator-specific style.

## Bucket A - Yiyun Operator Config

These parts are best treated as `Yiyun`-specific operator behavior or future `operator_experiences` input:

- short, conservative, one-question-at-a-time reply style
- invite code + onboarding flow
- WhatsApp preferred, but email-only fallback accepted
- ask for Moras Username after signup
- monthly fee explanation for creator support replies
- MCN hesitation wording
- setup trouble / `video_not_loading` handling
- payout support wording

Primary asset:

- `docs/rag/sources/playbook-yiyun-onboarding-and-payment-apr-2026-v1.md`

## Bucket B - Default Core Rules

These parts are better treated as reusable local knowledge sources for all operators:

- how Moras works
- product recommendation logic
- audience-fit explanation
- creator control / review-before-posting
- similar-video differentiation wording
- current product constraints:
  - iOS only
  - manual script editing not yet supported
  - Spanish support in progress

Primary asset:

- `docs/rag/sources/faq-moras-product-mechanics-and-support-apr-2026-v1.md`

## Bucket C - Keep Out Of Core Prompt

These parts should not be used as default runtime grounding because they are time-bound, high-risk, or marketing-heavy:

- subject-line pools
- `Top 100`, `Last 50 spots`, April-only scarcity framing
- historical campaign promises or month-specific incentive copy
- aggressive GMV brag lines
- hard claims like `100% of creators ...`
- old subsidy or milestone language that may conflict with current policy

These can stay as outreach templates or CRM operator references, but not as authoritative grounding for reply generation.

## Architecture Note

The current runtime still separates concerns this way:

- `operator_experiences`: operator-specific style and scene fragments
- `policy_documents`: hard policy and business constraints
- `docs/rag/sources/*.md`: local explainable knowledge sources

This means the April SOP should be split instead of inserted as one monolithic prompt.
