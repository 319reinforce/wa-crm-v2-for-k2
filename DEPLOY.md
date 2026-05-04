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

For container deployments, the image entrypoint runs the managed migration sequence before the Node process starts. Startup runs `server/migrations/004_event_lifecycle_fact_model.sql` through `server/migrations/013_retention_external_archive_checks.sql` under a MySQL named lock, then starts `node server/index.cjs`.

To skip startup migration intentionally:

```bash
DB_MIGRATE_ON_STARTUP=false
```

The event/lifecycle base migration is included by default:

```bash
DB_MIGRATION_INCLUDE_004=true
```

Only set `DB_MIGRATION_INCLUDE_004=false` if you intentionally want to skip migration 004.

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

## Deploy on a fresh VM (Aliyun, behind reverse proxy)

This runbook deploys wa-crm on a new VM as a parallel instance — no downtime
on the existing deployment, no shared infra. Validated 2026-05-04 on krev
(`43.111.224.242`) for the `wa.moras.ai` domain alongside the existing
`waaa.moras.ai` deployment on ktest.

### Pre-requisites

- Linux VM with Docker (≥ v20) + Docker Compose plugin (≥ v2)
- Reverse proxy (host nginx, Caddy, Cloudflare Tunnel, etc.) — wa-crm origin is HTTP only
- Outbound network access to:
  - Gitea registry `git.k2lab.ai` (TLS) for image pull
  - Docker Hub for `mysql` and `redis` base images
  - WhatsApp Web endpoints (Meta-hosted) for active sessions
- Gitea personal access token with `read:packages` scope (used as docker password)

### 1. Clone + build the .env

```bash
git clone git@git.k2lab.ai:K2Lab/whatsapp-mgr.git ~/whatsapp-mgr
cd ~/whatsapp-mgr
cp .env.example .env
chmod 600 .env
# Edit .env to fill secrets (DB_PASSWORD, OPENAI_API_KEY, MINIMAX_API_KEY, etc.)
```

If you're sourcing from an existing wa-crm host, the cleanest copy is:

```bash
# From the new VM, pulling from the existing host (replace OLD_HOST):
ssh OLD_HOST 'cat /path/to/existing/.env' > /home/dev/whatsapp-mgr/.env.from-source
chmod 600 /home/dev/whatsapp-mgr/.env.from-source
# Then build the new .env by whitelisting only the keys this repo's compose
# uses — see .env.example for the complete list.
```

### 2. Override host port bindings if needed

If the host already runs MySQL on 3306 or Redis on 6379, override in `.env`:

```bash
DB_EXPOSE_PORT=13306
REDIS_EXPOSE_PORT=16379
```

If the host runs nginx (or any reverse proxy) and you want wa-crm reachable
**only** through it, lock the wa-crm bind:

```bash
WA_BIND_HOST=127.0.0.1
```

### 3. Pull the pre-built image (recommended for prod)

Building from source on the VM works (`Dockerfile` in repo) but installs
Chromium and takes ~10 min. Faster + reproducible: pull a tagged image from
the Gitea registry.

```bash
# Login once with a Gitea personal access token:
echo "$GITEA_TOKEN" | docker login git.k2lab.ai -u <gitea-username> --password-stdin

# Pin to a specific tag (list at git.k2lab.ai/K2Lab/-/packages):
docker pull git.k2lab.ai/k2lab/wa-crm:<tag>
```

#### Tip: intra-VPC private-IP pull (Aliyun same-zone)

If the new VM is in the same Aliyun VPC as the Gitea host, route image pulls
through the private network to avoid public egress charges:

```bash
# As root, add a /etc/hosts override pointing git.k2lab.ai at the private IP:
echo '<gitea-private-ip>  git.k2lab.ai' | sudo tee -a /etc/hosts
# TLS cert is for git.k2lab.ai regardless of which IP serves it — verifies cleanly.
```

### 4. Override compose to use the pulled image

```bash
cp docker-compose.prod-override.example.yml docker-compose.prod-override.yml
# Edit: change CHANGE-ME-TO-A-PINNED-TAG to your tag from step 3
```

### 5. Boot the stack

```bash
docker compose -f docker-compose.server.yml \
               -f docker-compose.prod-override.yml up -d
docker compose -f docker-compose.server.yml \
               -f docker-compose.prod-override.yml ps
# Wait until mysql + redis are (healthy), then wa-crm reaches Up.

# Verify:
curl -sS http://127.0.0.1:3000/api/health   # → {"status":"ok"}
docker compose -f docker-compose.server.yml \
               -f docker-compose.prod-override.yml \
  exec wa-crm node -e \
  "require('ioredis').prototype || 0; const c=new (require('ioredis'))({host:'redis'}); c.ping().then(p=>{console.log(p);process.exit(0)});"
# → PONG
```

On first boot, schema.sql + the managed migration sequence run automatically
(unless `DB_MIGRATE_ON_STARTUP=false`). Empty volumes start with structural
seed only — no real conversation data.

### 6. (Optional) Restore data from an existing wa-crm host

For a parallel deploy that inherits historical data without disturbing the
source:

```bash
# A. On the source host (running wa-crm) — InnoDB consistent snapshot, no locks:
docker exec -e MYSQL_PWD=<pw> <source-mysql-container> sh -c \
  'mysqldump --single-transaction --quick --routines --triggers --events \
             --hex-blob --set-gtid-purged=OFF -uroot wa_crm_v2 | gzip' \
  > /tmp/wa_crm_v2.dump.sql.gz

# B. Transfer to the new VM (scp / rsync), verify sha256 matches.

# C. On the new VM, drop the seed DB and restore the snapshot:
docker compose -f docker-compose.server.yml \
               -f docker-compose.prod-override.yml stop wa-crm
docker exec -e MYSQL_PWD=<pw> whatsapp-mgr-mysql-1 \
  mysql -uroot -e "DROP DATABASE IF EXISTS wa_crm_v2; \
                   CREATE DATABASE wa_crm_v2 \
                   CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
zcat /tmp/wa_crm_v2.dump.sql.gz | \
  docker exec -i -e MYSQL_PWD=<pw> whatsapp-mgr-mysql-1 mysql -uroot wa_crm_v2
docker compose -f docker-compose.server.yml \
               -f docker-compose.prod-override.yml up -d wa-crm
```

WhatsApp session auth volumes (`.wwebjs_auth/`, `.baileys_auth/`) are
**deliberately not migrated** in a parallel deploy — copying them would mean
two boxes hold the same WA session and one would get disconnected. New box
operators re-pair each session via QR scan once routing is live.

### 7. Reverse-proxy template (HTTP-only origin)

Sample nginx vhost on the host (assumes Cloudflare or another edge terminates
TLS for the public-facing domain):

```nginx
upstream wa_crm_backend {
    server 127.0.0.1:3000;
    keepalive 32;
}

map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}

server {
    listen 80;
    listen [::]:80;
    server_name wa.example.com;

    client_max_body_size 100m;  # WA media uploads

    location / {
        proxy_pass http://wa_crm_backend;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_buffering off;          # SSE / long polling friendly
        proxy_read_timeout 600s;
    }
}
```

Always `nginx -t` before reload, and verify any pre-existing vhost still
responds with the same status after `systemctl reload nginx`.

### 8. Rollback

```bash
docker compose -f docker-compose.server.yml \
               -f docker-compose.prod-override.yml down -v   # wipes volumes
rm -f docker-compose.prod-override.yml .env
# Remove nginx vhost: rm /etc/nginx/conf.d/wa.example.com.conf && systemctl reload nginx
```

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
