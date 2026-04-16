# WA CRM v2 dirty-data root cause trace

Generated on 2026-04-16 from live MySQL data and code-path inspection.

## Current data snapshot

- `creators`: 250
- `wa_crm_data`: 143
- `client_profiles`: 113
- `client_tags`: 0
- `client_profile_snapshots`: 76
- `client_profile_change_events`: 76, all `pending`
- `sft_memory`: 643
- `wa_messages`: 9481

## 1. Missing `wa_crm_data` rows are a write-path gap

Evidence from live DB:

- 107 creators are missing `wa_crm_data`
- 68 active creators with messages are missing `wa_crm_data`
- missing rows are concentrated in `source='wa'`

Root cause:

- the manual creator path does create the companion `wa_crm_data` row at [server/routes/creators.js](/Users/depp/wa-bot/wa-crm-v2/server/routes/creators.js#L607) through [server/routes/creators.js](/Users/depp/wa-bot/wa-crm-v2/server/routes/creators.js#L635)
- the worker path creates creators without creating `wa_crm_data` at [server/waWorker.js](/Users/depp/wa-bot/wa-crm-v2/server/waWorker.js#L641) through [server/waWorker.js](/Users/depp/wa-bot/wa-crm-v2/server/waWorker.js#L688)

Conclusion:

- this is not an async task lag
- this is an insertion-path inconsistency between manual create and worker create

## 2. Empty `client_profiles` are mostly placeholder rows

Evidence from live DB:

- 113 `client_profiles` rows exist
- only 3 have non-empty `summary`
- all 113 have `tags IS NULL`
- all 113 have `stage IS NULL`
- 137 creators still have no profile at all

Root cause:

- `POST /api/profile-agent/event` creates a placeholder `client_profiles` row before any real content exists at [server/routes/profile.js](/Users/depp/wa-bot/wa-crm-v2/server/routes/profile.js#L477) through [server/routes/profile.js](/Users/depp/wa-bot/wa-crm-v2/server/routes/profile.js#L490)
- the same route only adds tags if `extractTagsWithLLM()` returns usable JSON; any MiniMax/API/JSON failure returns `[]` and silently skips tag creation at [server/routes/profile.js](/Users/depp/wa-bot/wa-crm-v2/server/routes/profile.js#L399) through [server/routes/profile.js](/Users/depp/wa-bot/wa-crm-v2/server/routes/profile.js#L470)
- summary refresh is async and depends on another MiniMax request; non-`ok` responses simply return without fallback at [server/services/profileService.js](/Users/depp/wa-bot/wa-crm-v2/server/services/profileService.js#L31) through [server/services/profileService.js](/Users/depp/wa-bot/wa-crm-v2/server/services/profileService.js#L99)

Extra evidence:

- `audit_log` has 0 rows for `profile_tags_extracted`
- `audit_log` has 0 rows for `client_profile_update`
- `client_tags` has 0 rows total

Conclusion:

- the current profile route happily creates shell rows
- tag extraction and summary generation both depend on external LLM calls and have no durable fallback path

## 3. The advanced profile-analysis pipeline is disconnected

Evidence from live DB:

- `client_profile_snapshots`: 76
- `client_profile_change_events`: 76
- all 76 change events are still `pending`
- `profile_analysis_state` has 242 rows, but 134 have no matching `client_profiles`

Root cause:

- `runProfileAnalysis()` always writes a snapshot and a `pending` change event at [server/services/profileAnalysisService.js](/Users/depp/wa-bot/wa-crm-v2/server/services/profileAnalysisService.js#L430) through [server/services/profileAnalysisService.js](/Users/depp/wa-bot/wa-crm-v2/server/services/profileAnalysisService.js#L471)
- the result only becomes user-visible in `client_profiles` after `reviewChange()` accepts or edits it at [server/services/profileAnalysisService.js](/Users/depp/wa-bot/wa-crm-v2/server/services/profileAnalysisService.js#L578) through [server/services/profileAnalysisService.js](/Users/depp/wa-bot/wa-crm-v2/server/services/profileAnalysisService.js#L635)
- the route file exists, but it is not mounted in the server router list; [server/index.cjs](/Users/depp/wa-bot/wa-crm-v2/server/index.cjs#L210) through [server/index.cjs](/Users/depp/wa-bot/wa-crm-v2/server/index.cjs#L225) mounts `profileRouter` but not `profileAnalysisRouter`
- the worker only notifies `/api/profile-agent/event`, not `/api/profile-analysis/hook`; see [server/routes/profile.js](/Users/depp/wa-bot/wa-crm-v2/server/routes/profile.js#L477) and [server/waWorker.js](/Users/depp/wa-bot/wa-crm-v2/server/waWorker.js#L835)

Conclusion:

- this is partly a route-registration gap
- partly a missing worker hook
- partly a missing review/UI consumption path for pending profile changes

## 4. `client_tags` staying at zero is likely a no-fallback extraction problem

Evidence from live DB:

- `client_tags` has 0 rows
- `profile_tags_extracted` audit count is 0
- profiles still get created, so the route is at least partially executing

Most likely cause:

- the tag extraction path depends entirely on `extractTagsWithLLM()` and returns `[]` on any upstream failure or non-JSON reply at [server/routes/profile.js](/Users/depp/wa-bot/wa-crm-v2/server/routes/profile.js#L399) through [server/routes/profile.js](/Users/depp/wa-bot/wa-crm-v2/server/routes/profile.js#L470)
- there is no regex/heuristic fallback and no retry queue

Confidence:

- high confidence on the code-path weakness
- medium confidence that provider/API instability is the concrete runtime trigger, because the available business logs are sparse

## 5. `sft_memory.system_prompt_used` being null is a historical backfill-order issue

Evidence from live DB:

- all 643 `sft_memory` rows are missing `system_prompt_used`
- all 643 rows were created on 2026-04-10 or 2026-04-11
- all 643 rows have `human_selected='custom'`

Current code behavior:

- the current frontend does send `system_prompt_used` at [src/components/WAMessageComposer.jsx](/Users/depp/wa-bot/wa-crm-v2/src/components/WAMessageComposer.jsx#L1170) through [src/components/WAMessageComposer.jsx](/Users/depp/wa-bot/wa-crm-v2/src/components/WAMessageComposer.jsx#L1185)
- the current API does persist it at [server/routes/sft.js](/Users/depp/wa-bot/wa-crm-v2/server/routes/sft.js#L100) through [server/routes/sft.js](/Users/depp/wa-bot/wa-crm-v2/server/routes/sft.js#L227)

Historical backfill behavior:

- the history backfill script prepares `system_prompt_used`, but only inserts columns that exist in the live table at execution time at [scripts/generate-sft-from-history.cjs](/Users/depp/wa-bot/wa-crm-v2/scripts/generate-sft-from-history.cjs#L297) through [scripts/generate-sft-from-history.cjs](/Users/depp/wa-bot/wa-crm-v2/scripts/generate-sft-from-history.cjs#L329)
- a prior readiness snapshot explicitly noted that `sft_memory` lacked `system_prompt_used` at that stage in [scripts/generate-migration-readiness-snapshot.js](/Users/depp/wa-bot/wa-crm-v2/scripts/generate-migration-readiness-snapshot.js#L193) through [scripts/generate-migration-readiness-snapshot.js](/Users/depp/wa-bot/wa-crm-v2/scripts/generate-migration-readiness-snapshot.js#L195)

Conclusion:

- this is not the current `/api/sft-memory` write path failing
- this is historical data that was backfilled before the schema was fully ready, or while the backfill was column-gated
- this item is not fixable with SQL alone; it needs a prompt-rebuild script

## 6. Empty-text and null-operator `wa_messages` are mostly migration residue

Evidence from live DB:

- 557 messages have empty text
- 552 of those were created on 2026-04-10
- 1373 messages have `operator IS NULL`
- 898 of those null-operator rows were created on 2026-04-10
- 9 rows use `operator='codex'`, all on 2026-04-10

Root cause:

- the SQLite-to-MySQL migration copied raw `wa_messages` rows without cleansing at [migrate-to-mysql.js](/Users/depp/wa-bot/wa-crm-v2/migrate-to-mysql.js#L146) through [migrate-to-mysql.js](/Users/depp/wa-bot/wa-crm-v2/migrate-to-mysql.js#L158)
- the current worker insert path does filter out empty text before insert at [server/waWorker.js](/Users/depp/wa-bot/wa-crm-v2/server/waWorker.js#L430) through [server/waWorker.js](/Users/depp/wa-bot/wa-crm-v2/server/waWorker.js#L477)

Conclusion:

- the bulk of the dirty `wa_messages` rows came from migration, not the current worker
- `operator='codex'` is test residue, not production business data

## 7. `operator_experiences` is behind current owner reality

Evidence from live DB:

- `creators` contains 61 rows with `wa_owner='Jiawen'`
- `operator_experiences` contains only `Beau` and `Yiyun`

Root cause:

- the seed migration only inserts Beau and Yiyun at [migrate-experience.js](/Users/depp/wa-bot/wa-crm-v2/migrate-experience.js#L3) through [migrate-experience.js](/Users/depp/wa-bot/wa-crm-v2/migrate-experience.js#L130)

Conclusion:

- this is configuration drift caused by migration seed logic lagging behind the owner model now used elsewhere in the app

## 8. What is SQL-fixable vs non-SQL-fixable

SQL-fixable now:

- blank-to-NULL normalization on external IDs
- orphan `profile_analysis_state` cleanup
- deleting isolated `manual_test` rows
- removing placeholder `keeper_link` and `joinbrands_link` rows
- backfilling missing `wa_crm_data`
- optionally backfilling `client_tags` from existing event flags
- optionally hydrating `client_profiles.summary` from latest snapshot
- optionally seeding missing `operator_experiences`

Not SQL-fixable by itself:

- rebuilding `sft_memory.system_prompt_used`
- making profile analysis run continuously
- making pending profile changes land automatically
- making `client_tags` resilient to provider/API failures

## 9. Recommended repair order

1. Run safe SQL cleanup sections 1-5 in [dirty-data-cleanup-20260416.sql](/Users/depp/wa-bot/wa-crm-v2/reports/dirty-data-cleanup-20260416.sql)
2. Decide whether to trust latest profile snapshots enough to run optional section 7
3. Decide whether to seed Jiawen/WangYouKe operator experiences with optional section 8
4. Patch code so new worker-created creators always get `wa_crm_data`
5. Mount `profileAnalysisRouter`, wire worker to `/api/profile-analysis/hook`, and add a way to review/apply pending profile changes
6. Write a dedicated prompt-rebuild script for historical `sft_memory`
