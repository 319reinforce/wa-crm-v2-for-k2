# Cleanup History - 2026-04-16

## Context

This document records the project slimming work completed on 2026-04-16 for WA CRM v2. It consolidates:

- stage 1 historical artifact cleanup
- stage 2 SQLite/legacy code cleanup
- `.wwebjs_auth` session audit results

It is intended as an operational handoff note for future cleanup and deployment work.

## Stage 1 - Historical Artifact Cleanup

### Goal

Reduce local workspace size without affecting the current MySQL + modular server runtime.

### Removed

- `reports/`
- `backups/wwebjs/`
- `.wwebjs_auth/session-yiyun.bak.20260411-114851`
- empty `session-*` directories under `.wwebjs_auth/`
- `.wwebjs_cache/`
- `src/node_modules/.vite/`
- `server.log`
- all `.DS_Store`
- `data/*.json`
- `crm.db`
- `crm.db-shm`
- `crm.db-wal`

### Preserved

- active named WhatsApp sessions:
  - `session-beau`
  - `session-yiyun`
  - `session-youke`
  - `session-jiawen`
- current code and runtime assets

### Documentation produced

- `docs/HISTORICAL_REPORTS_ARCHIVE.md`

That archive preserves the useful conclusions from the deleted `reports/` directory without keeping raw PII-bearing exports and screenshots.

## Stage 2 - Legacy SQLite Cleanup

### Goal

Remove SQLite-era entrypoints, migration scripts, and dependencies that no longer participate in the current production path.

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

- removed `deasync`
- removed `better-sqlite3`
- updated `package-lock.json` via `npm uninstall`

### Supporting updates

- removed stale npm scripts that pointed at deleted legacy files
- updated `scripts/test-smoke.cjs`
- updated `Dockerfile` comment that still referenced `deasync`
- updated entry and onboarding docs to reflect the current MySQL runtime

### Documentation updated

- `AGENTS.md`
- `CLAUDE.md`
- `SFT_PROJECT.md`
- `docs/RLHF_ONBOARDING.md`
- `docs/EVENT_SYSTEM.md`
- `docs/EVENT_SYSTEM_REQUIREMENTS.md`
- `docs/LEGACY_CLEANUP_LOG.md`

### Verification

- `npm run build` passed
- `npm run test:unit` passed (`54` tests)
- grep against current entry docs and runtime files no longer finds active references to:
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

## Memory Record

Cleanup state was preserved locally in:

- `docs/HISTORICAL_REPORTS_ARCHIVE.md`
- `docs/LEGACY_CLEANUP_LOG.md`
- this file: `docs/CLEANUP_HISTORY_20260416.md`

As of 2026-04-25, the durable memory note is:

- `docs/obsidian/notes/2026-04-16-legacy-cleanup-memory.md`

## `.wwebjs_auth` Session Audit

### Current non-empty directories

| Directory | Size | Last observed write time | Assessment |
|-----------|------|--------------------------|------------|
| `session-beau` | `823M` | `2026-04-11 12:46` | active, keep |
| `session-yiyun` | `6.4G` | `2026-04-13 14:03` | active, keep |
| `session-youke` | `264M` | `2026-04-11 10:56` | active but waiting for QR, keep |
| `session-jiawen` | `4.6G` | `2026-04-11 10:56` | active, keep |
| `session-3000` | `212M` | `2026-04-10 19:11` | high-risk legacy/default fallback, keep for now |
| `session-3001` | `142M` | `2026-04-10 14:41` | likely removable |
| `session-3101` | `33M` | `2026-04-10 20:48` | likely removable |
| `session` | `167M` | `2026-04-10 18:29` | likely removable |
| `sessions-beau` | `33M` | `2026-04-10 00:01` | likely removable |
| `sessions-yiyun` | `157M` | `2026-04-10 00:01` | likely removable |
| `sessions-wangyouke` | `120M` | `2026-04-10 00:01` | likely removable |

### Evidence used

#### Active named sessions

`ecosystem.wa-crawlers.config.cjs` currently defines the four active crawler sessions:

- `beau`
- `yiyun`
- `youke`
- `jiawen`

`.wa_ipc/status/` contains live status files for exactly those four names.

At audit time:

- `beau`: ready/live
- `yiyun`: ready/live
- `jiawen`: ready/live
- `youke`: running but still waiting for QR / not ready

These four should not be deleted.

#### Why `session-3000` is still risky

`server/index.cjs` starts WA service unless `DISABLE_WA_SERVICE=true`.

Runtime behavior:

- `PORT` defaults to `3000`
- `WA_SESSION_ID` falls back to `PORT`
- the WA service stores its session under `session-${WA_SESSION_ID}`

That means a default `npm start` process can still attach to `.wwebjs_auth/session-3000`.

At audit time, port `3000` was actively listening with a `node` process, so `session-3000` was kept in the high-risk bucket.

#### Why the others are likely removable

No current code/config reference was found for:

- `session-3001`
- `session-3101`
- `session`
- `sessions-beau`
- `sessions-yiyun`
- `sessions-wangyouke`

Also:

- no listener was found on ports `3001` or `3101`
- these directories only showed old singleton/local profile artifacts
- their timestamps predate the currently active named-session workflow

### Safe next deletion candidate set

If the goal is another conservative cleanup pass, the first candidate set is:

- `.wwebjs_auth/session-3001`
- `.wwebjs_auth/session-3101`
- `.wwebjs_auth/session`
- `.wwebjs_auth/sessions-beau`
- `.wwebjs_auth/sessions-yiyun`
- `.wwebjs_auth/sessions-wangyouke`

### Do not delete yet

- `.wwebjs_auth/session-beau`
- `.wwebjs_auth/session-yiyun`
- `.wwebjs_auth/session-youke`
- `.wwebjs_auth/session-jiawen`
- `.wwebjs_auth/session-3000`

## Recommended Next Step

Before deleting the likely-removable session set, stop any ad hoc local WA/browser process that may still hold old singleton files, then delete only this bucket:

- `session-3001`
- `session-3101`
- `session`
- `sessions-beau`
- `sessions-yiyun`
- `sessions-wangyouke`

Leave `session-3000` in place until the API WA service is explicitly disabled in your runtime or confirmed to use a different named session.

## Obsidian Sync

- Status: historical-backfill
- Note: `docs/obsidian/notes/2026-04-16-legacy-cleanup-memory.md`
- Index: `docs/obsidian/index.md`
