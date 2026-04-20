# Trial Package Policy (v1)

## Scope

- Scenes: `trial_intro`, `trial_followup`
- Primary operator: `Yiyun`
- Status: approved
- Effective from: `2026-04-15`
- Rule version: `2026-04-15`
- Goal: keep trial-package replies consistent, especially when a creator has already finished the 7-day trial.

## Rules

### 1. Trial introduction

- The trial package is a 7-day trial.
- During the trial, the creator can use up to 20 AI generations per day.
- The trial should be positioned as a low-friction way to test Moras before moving into the monthly path.
- The reply should stay short and answer the creator's direct question first.

### 2. Trial completion status

- If the creator says they finished, completed, passed, or already used the 7-day trial, treat the trial as completed.
- A completed trial must not be described as still active.
- Do not invite the creator to start the same 7-day trial again.
- Move the conversation to post-trial next steps: monthly plan, usage limit, posting plan, or payment clarification.

### 3. Monthly plan after trial

- The monthly subscription is $20.
- The $20 monthly subscription can be deducted from video subsidy or eligible earnings when available.
- If the current week does not have enough subsidy or eligible earnings to cover $20, do not imply an automatic charge from unavailable funds.
- Keep the explanation practical and avoid over-explaining internal settlement mechanics.

### 4. MCN and usage limit

- Do not require MCN binding before the creator understands the trial or monthly path.
- If the creator asks why MCN binding matters, explain it as a way to unlock tracking, higher usage, support, and commission-return workflows.
- Do not pressure the creator into binding.

## Do

- Confirm the creator's current status before giving next-step instructions.
- Use "completed" or "finished" when the creator explicitly says the trial is done.
- Explain the $20 monthly plan only when relevant to the question.
- Keep the tone concise and one-question-at-a-time.

## Do Not

- Do not call a completed trial "active".
- Do not promise guaranteed earnings, guaranteed safety, or guaranteed GMV.
- Do not say the $20 fee is charged if the available subsidy or eligible earnings are insufficient.
- Do not mention internal routing, model names, RAG, vector stores, or finetuning.

## Example: Trial completed

Creator:

```text
I finished the 7-day trial. What happens now?
```

Good reply:

```text
Nice, that means your trial is completed.

The next step is the monthly plan. It is $20/month, and when you have enough eligible subsidy/earnings, it can be deducted from that.

If you want, I can help you check which option fits your posting plan next.
```

Bad reply:

```text
Great, your trial is still active. I can restart the 7-day trial for you.
```

Reason: the creator explicitly said the trial was finished, so the status must be completed, not active.

## Example: Trial intro

Creator:

```text
How does the trial work?
```

Good reply:

```text
You can try Moras for 7 days first.

During the trial, you can generate up to 20 AI videos per day, so you can test the workflow before deciding on the monthly plan.
```

## Version Log

- v1 (2026-04-20): added as the local source of truth for trial intro and trial completion handling.
