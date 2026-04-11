# Migration Readiness Snapshot

Contents:
- `health-check.json`: read-only health check output
- `row-count-snapshot.json`: key table counts and roster totals
- `full-db-backup.sql`: full logical backup for rollback
- `schema-only.sql`: schema dump before migration
- `final-roster-full.csv`: current final roster export (107 creators)
- `phase-a-additive-ddl.sql`: prepared-only low-risk additive DDL draft

Notes:
- This directory is a pre-migration snapshot only.
- No schema migration has been executed.
