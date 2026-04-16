# Historical Reports Archive

> Created on 2026-04-16 before deleting raw files under `reports/`
> Scope: historical report conclusions from 2026-04-11 to 2026-04-15
> Privacy note: this archive keeps only redacted findings and counts. Raw CSV/JSON details with phone-level data were intentionally not copied.

## Why this file exists

The old `reports/` directory contained useful historical conclusions mixed with one-off exports, screenshots, backups, and some PII-bearing artifacts. This document preserves the parts that are still useful for engineering and operations after the raw report files are deleted.

## Code Review Snapshot

### Backend review (`2026-04-11`)

- 31 total issues: 5 high, 11 medium, 15 low/observations.
- Main historical concerns:
  - operator-level authorization gaps on sensitive routes
  - `wa_phone` exposure in API responses and some audit paths
  - duplicated logic across AI routing, prompt building, and memory extraction
  - missing composite indexes
  - unbounded in-memory maps/caches
- Positive baseline recorded at the time:
  - SQL usage was consistently parameterized
  - auth guards were broadly applied
  - async error handling was generally solid

### Frontend review (`2026-04-11`)

- 30 total issues: 4 high, 10 medium, 16 low/observations.
- Main historical concerns:
  - SSE reconnection was not actually implemented
  - message polling had an abort-related stale state leak risk
  - `WAMessageComposer` lacked full abort cleanup for async preloads
  - one manual generation error path still used blocking `alert()`
- Positive baseline recorded at the time:
  - no XSS issues were found
  - race-condition prevention patterns were generally good
  - fetch calls already used timeout guards

### Data and infrastructure review (`2026-04-11`)

- 31 total issues: 3 critical, 7 high, 10 medium, 11 low/observations.
- Main historical concerns:
  - committed secrets in `.env.example`
  - migration script correctness bugs
  - destructive scripts without confirmation
  - report/export flows writing PII to outputs
  - hardcoded absolute paths in several scripts
- Historical recommendation highlights:
  - remove committed credentials
  - redact `wa_phone` in logs and report outputs
  - replace ad hoc destructive script patterns with safer defaults
  - retire `deasync`

## Data Cleanup And Migration Milestones

### Migration readiness snapshot (`2026-04-11 10:40`)

- Snapshot was explicitly marked as pre-migration only; no schema migration had been executed yet.
- Recorded row counts at that point:
  - `creators`: 1405
  - `wa_messages`: 15265
  - `operator_creator_roster`: 107
  - `events`: 232
  - `sft_memory`: 643
- Historical health indicators:
  - roster mapping was already complete: Beau 52, Jiawen 14, Yiyun 41
  - normalized phone duplicate groups: 0
  - message hash duplicate groups: 0
  - creators with null `wa_phone`: 1187

### WA phone readiness and null-phone cleanup (`2026-04-11`)

- Before cleanup:
  - total creators: 1405
  - null-phone creators: 1187
  - active creators: 202
  - active null-phone creators: 0
  - roster creators with null phone: 0
- Historical recommendation at that time:
  - roster was already safe
  - the safest first cleanup bucket was 320 null-phone shell creators with no related rows
- After cleanup:
  - total creators: 218
  - null-phone creators: 0
  - active creators: 202
  - active null-phone creators: 0
  - roster creators with null phone: 0

### Roster review and manual review outcomes (`2026-04-11`)

- Unmapped roster review progression:
  - initial review: 19 unmapped roster rows
  - later review: 17 unmapped roster rows
  - aggressive review: 14 unmapped roster rows
- Final roster export after review:
  - total roster: 107
  - Beau: 52
  - Jiawen: 14
  - Yiyun: 41
- Invalid chat review:
  - scanned creators: 130
  - creators with messages: 50
  - definite invalid: 0
  - manual review required: 50
- Review apply result:
  - reviewed rows: 50
  - kept: 29
  - marked not to keep: 19
  - possible duplicates needing follow-up: 2

### Message normalization and duplicate cleanup (`2026-04-11` to `2026-04-13`)

- Legacy timestamp normalization:
  - delete candidates: 6438
  - update candidates: 1600
  - applied deletes: 6438
  - applied updates: 1600
  - remaining legacy rows after apply: 0
- Poll duplicate cleanup:
  - Beau applied pass removed 1327 duplicate rows and updated 13 roles
  - Yiyun applied pass removed 322 duplicate rows
  - Jiawen applied pass removed 50 duplicate rows
  - combined duplicate rows removed in those applied passes: 1699
- WA message structure audit progression:
  - first audit found 22 repeat groups
  - second audit found 4 repeat groups
  - third audit found 0 repeat groups
- Message hash backfill:
  - first full pass touched 104 creators
  - duplicate rows removed: 5982
  - message hashes updated: 475
  - second pass found nothing remaining to clean

### Role anomaly and group pollution cleanup (`2026-04-11` to `2026-04-15`)

- Role anomaly backfill final pass:
  - applied: yes
  - delete rules checked: 5
  - rows deleted: 4
  - update rules checked: 1
  - rows updated in that final pass: 0
- Manual group pollution purge (`2026-04-15`):
  - matched polluted rows: 37
- Group pollution cleaner broad scan:
  - dry run on `2026-04-15 05:57` scanned 230 creators and hit 125 errors, mainly timeout/chat lookup issues
  - tuned apply run on `2026-04-15 06:30` scanned 232 creators across Beau, Yiyun, and Jiawen
  - polluted cases detected: 64
  - successful replacements applied: 3
  - errors after tuning: 0

### History backfill and pending SFT rule review

- Jiawen history backfill (`2026-04-14`):
  - creators scanned: 57
  - messages checked: 169
  - new messages inserted: 18
- Pending rule review snapshot:
  - total pending rule-review rows: 36
  - by scene:
    - `follow_up`: 17
    - `payment_issue`: 16
    - `monthly_inquiry`: 1
    - `mcn_binding`: 1
    - `trial_intro`: 1

## Verification And Release Notes

### UI acceptance snapshot

- Three acceptance runs were preserved historically:
  - generic local run
  - Beau-scoped run
  - Jiawen-scoped run
- All three recorded:
  - HTTP 200 navigation
  - no overlay blocking
  - group button visible
  - group view visible
  - zero console errors
  - zero page errors

### Finetuned canary snapshot (`2026-04-12`)

- Historical production note:
  - `USE_FINETUNED=true`
  - `AB_RATIO=0.1`
- Executive summary recorded at the time:
  - latest 12-request window succeeded 100%
  - finetuned hit was observed in production traffic
  - latency on the finetuned path was about 5811 ms in that window
- Historical next-step recommendation:
  - continue monitoring for 24h
  - if stable, increase `AB_RATIO` to `0.2`

## What was intentionally not preserved

- Raw CSV exports
- Full SQL backups
- Screenshot files
- Per-message manual purge details
- Per-creator detail rows from cleanup runs
- Any raw artifact containing phone-level or message-level data

## Source families covered by this archive

- backend review
- frontend review
- data/infrastructure review
- migration readiness snapshot
- roster and invalid-chat review summaries
- WA phone readiness summaries
- timestamp normalization summaries
- poll duplicate cleanup summaries
- WA message structure audit summaries
- message hash backfill summaries
- role anomaly backfill summaries
- group pollution cleaner summaries
- Jiawen history backfill summary
- pending SFT rule review summary
- UI acceptance summaries
- canary executive summaries
