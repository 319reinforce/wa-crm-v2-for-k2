# Legacy Cleanup Log

## 2026-04-16

### Scope

- Second-stage legacy cleanup after the historical artifact purge
- Goal: remove SQLite-era entrypoints and dependencies that no longer participate in the current MySQL runtime

### Removed files

- `index_v2.js`
- `key_creators.js`
- `migrate.js`
- `migrate-to-mysql.js`
- `migrate-events.js`
- `migrate-experience.js`
- `migrate-profiles.js`
- `agents/profile-agent.js`

### Dependency cleanup

- Removed `deasync` from `package.json`
- Removed `better-sqlite3` from `package.json`
- Updated `package-lock.json` via `npm uninstall deasync better-sqlite3`

### Runtime and tooling updates

- Removed legacy npm scripts pointing at deleted SQLite files
- Removed stale smoke-test syntax target for `migrate-to-mysql.js`
- Updated `Dockerfile` comment to stop implying `deasync` is still required

### Documentation updates

- Updated `AGENTS.md`
- Updated `CLAUDE.md`
- Updated `SFT_PROJECT.md`
- Updated `docs/RLHF_ONBOARDING.md`
- Updated `docs/EVENT_SYSTEM.md`
- Updated `docs/EVENT_SYSTEM_REQUIREMENTS.md`

### Verification

- `rg` against current entry docs and runtime files no longer finds active references to:
  - `index_v2.js`
  - `key_creators.js`
  - `migrate.js`
  - `migrate-to-mysql.js`
  - `migrate-events.js`
  - `migrate-experience.js`
  - `migrate-profiles.js`
  - `agents/profile-agent.js`
  - `better-sqlite3`
  - `deasync`
- `npm run build` passed
- `npm run test:unit` passed (`54` tests)

### Notes

- Historical review and analysis documents still mention some removed files intentionally as past context.
- As of 2026-04-25, cleanup memory is tracked through `docs/OBSIDIAN_MEMORY_STANDARD.md` and `docs/obsidian/notes/2026-04-16-legacy-cleanup-memory.md`.

## Obsidian Sync

- Status: historical-backfill
- Note: `docs/obsidian/notes/2026-04-16-legacy-cleanup-memory.md`
- Index: `docs/obsidian/index.md`
