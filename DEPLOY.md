# WA CRM v2 Deployment Guide

Date: 2026-04-27
Status: Active

## Runtime Direction

WA CRM v2 deploys as a Node.js + MySQL application. WhatsApp runtime planning should assume Baileys as the forward driver. WWeb/Chrome/Puppeteer deployment paths are legacy compatibility only and should not be expanded.

## Quick Start

```bash
git clone git@git.k2lab.ai:K2Lab/whatsapp-mgr.git
cd whatsapp-mgr
cp .env.example .env
npm ci
npm start
```

Health check:

```bash
curl http://localhost:3000/api/health
```

## Required Environment

| Variable | Purpose |
| --- | --- |
| `DB_HOST` | MySQL host |
| `DB_PORT` | MySQL port |
| `DB_USER` | MySQL user |
| `DB_PASSWORD` | MySQL password |
| `DB_NAME` | MySQL database, usually `wa_crm_v2` |
| `OPENAI_API_KEY` or `MINIMAX_API_KEY` | AI provider credential |

## WhatsApp Runtime Environment

| Variable | Direction |
| --- | --- |
| `WA_DEFAULT_DRIVER` | Set to `baileys` for the forward path. |
| `WA_BAILEYS_AUTH_ROOT` | Baileys auth root, for example `/app/.baileys_auth`. |
| `WA_SESSION_ID` | Session id such as `beau`, `yiyun`, `jiawei`, or `youke`. |
| `WA_OWNER` | Operator owner for the session. |
| `WA_API_BASE` | API base used by crawler/agent processes. |

Legacy WWeb variables and Chrome/Puppeteer settings may still exist in code while compatibility cleanup is pending, but they are not the target deployment path.

## Database

Create or migrate the MySQL schema from `schema.sql` and server migrations:

```bash
mysql -h "$DB_HOST" -u "$DB_USER" -p "$DB_NAME" < schema.sql
```

For container deployments, the image entrypoint runs the managed migration sequence before the Node process starts. Startup runs `server/migrations/005_active_event_detection_queue.sql` through `server/migrations/013_retention_external_archive_checks.sql` under a MySQL named lock, then starts `node server/index.cjs`.

To skip startup migration intentionally:

```bash
DB_MIGRATE_ON_STARTUP=false
```

For older environments that never received the event/lifecycle base migration, also set:

```bash
DB_MIGRATION_INCLUDE_004=true
```

Optional verification after the startup migration:

```bash
DB_MIGRATION_ANALYZE_AFTER=true
```

Do not restore SQLite or `crm.db`.

## Persistent Data

Keep these out of source control:

- MySQL data directory or volume.
- `.baileys_auth/`
- `data/runtime-state/`
- `data/media-assets/`
- `backups/`
- generated `reports/`

## Docker Notes

Docker deployment should persist MySQL data, Baileys auth, and media assets. Chromium is not part of the future deployment requirement once WWeb compatibility is removed.

The Docker image uses `scripts/docker-entrypoint.sh`. It applies the managed migration sequence on every image/container restart unless `DB_MIGRATE_ON_STARTUP=false` is set. The migration SQL must remain idempotent because this path is intentionally repeatable.

## Useful Docs

- `AGENTS.md`
- `BOT_INTEGRATION.md`
- `docs/DOCS_INDEX.md`
- `docs/WA_SESSIONS_DESIGN.md`
- `docs/BAILEYS_ROLLOUT.md`
- `docs/DATABASE_SCHEMA_OPTIMIZATION_PLAN_20260427.md`

## Obsidian Sync

- Status: synced
- Note: `docs/obsidian/notes/2026-04-27-deploy-and-startup-migrations.md`
- Index: `docs/obsidian/index.md`
