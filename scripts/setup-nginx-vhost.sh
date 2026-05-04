#!/usr/bin/env bash
#
# setup-nginx-vhost.sh — bootstrap a TLS-terminating nginx vhost for wa-crm
#
# What this does
# --------------
# On the host where wa-crm's docker compose stack runs:
#   1. Generates a self-signed TLS cert for $HOSTNAME (idempotent — skips if it
#      already exists; pass --regen-cert to force).
#   2. Writes /etc/nginx/conf.d/$HOSTNAME.conf with HTTP (:80) + HTTPS (:443)
#      server blocks proxying to wa-crm at $UPSTREAM:$PORT.
#   3. Validates the new config with `nginx -t` and (optionally) reloads.
#   4. On nginx -t failure, automatically rolls back to the previous vhost file.
#
# Why self-signed
# ---------------
# When the host sits behind Cloudflare in "Full" (non-strict) mode, CF accepts
# any cert at the origin — it only validates that origin presents one. Self-
# signed gets us TLS termination + a valid CF→origin TLS leg with zero LE /
# ACME / DNS-01 friction. For "Full (strict)" mode, swap in a CF Origin CA
# cert or a Let's Encrypt cert later — the vhost file format is unchanged.
#
# Usage
# -----
#   sudo ./scripts/setup-nginx-vhost.sh wa.moras.ai
#   sudo ./scripts/setup-nginx-vhost.sh wa.moras.ai --port 3000 --reload
#   ./scripts/setup-nginx-vhost.sh wa.moras.ai --dry-run        # prints, no writes
#   sudo ./scripts/setup-nginx-vhost.sh wa.moras.ai --regen-cert
#
# Args
# ----
#   $1                   HOSTNAME (required, e.g. wa.example.com)
#   --port N             backend port (default: 3000)
#   --upstream HOST      backend upstream host (default: 127.0.0.1)
#   --cert-dir PATH      cert directory (default: /etc/nginx/certs/$HOSTNAME)
#   --vhost-dir PATH     nginx conf.d dir (default: /etc/nginx/conf.d)
#   --backup-dir PATH    backup dir for replaced vhost files (default: /root/nginx-backup-$(date +%Y-%m-%d))
#   --reload             run `systemctl reload nginx` after `nginx -t` passes
#   --regen-cert         regenerate the cert even if it already exists
#   --dry-run            print the cert + vhost paths and rendered vhost; do not write
#   --help               show this help
#
# Idempotency
# -----------
# Re-running with the same args is safe: cert is re-used unless --regen-cert,
# vhost file is re-rendered (so changes to --port / --upstream propagate),
# previous vhost is backed up to $BACKUP_DIR with timestamp.
#
set -euo pipefail

HOSTNAME=""
PORT=3000
UPSTREAM=127.0.0.1
CERT_DIR=""
VHOST_DIR=/etc/nginx/conf.d
BACKUP_DIR=""
RELOAD=0
REGEN_CERT=0
DRY_RUN=0

err() { echo "ERROR: $*" >&2; exit 1; }
log() { echo "[setup-nginx-vhost] $*"; }

while [ $# -gt 0 ]; do
  case "$1" in
    --port)         PORT="$2"; shift 2 ;;
    --upstream)     UPSTREAM="$2"; shift 2 ;;
    --cert-dir)     CERT_DIR="$2"; shift 2 ;;
    --vhost-dir)    VHOST_DIR="$2"; shift 2 ;;
    --backup-dir)   BACKUP_DIR="$2"; shift 2 ;;
    --reload)       RELOAD=1; shift ;;
    --regen-cert)   REGEN_CERT=1; shift ;;
    --dry-run)      DRY_RUN=1; shift ;;
    --help|-h)      sed -n '/^# Usage/,/^# Idempotency/p' "$0" | sed 's/^# \?//'; exit 0 ;;
    -*)             err "unknown flag: $1" ;;
    *)              [ -z "$HOSTNAME" ] && HOSTNAME="$1" || err "extra positional arg: $1"; shift ;;
  esac
done

[ -z "$HOSTNAME" ] && err "HOSTNAME is required (e.g. wa.example.com); see --help"

# Validate hostname shape — letters, digits, dot, hyphen only
if ! [[ "$HOSTNAME" =~ ^[a-zA-Z0-9]([a-zA-Z0-9.-]*[a-zA-Z0-9])?$ ]]; then
  err "invalid hostname: '$HOSTNAME'"
fi
[ -z "$CERT_DIR" ] && CERT_DIR="/etc/nginx/certs/$HOSTNAME"
[ -z "$BACKUP_DIR" ] && BACKUP_DIR="/root/nginx-backup-$(date +%Y-%m-%d)"

# Sanitize hostname for nginx variable name (only [a-zA-Z0-9_])
VAR_SUFFIX=$(echo "$HOSTNAME" | tr '.-' '__' | tr -cd 'a-zA-Z0-9_')
CONN_VAR="connection_upgrade_${VAR_SUFFIX}"

if [ "$DRY_RUN" -eq 0 ] && [ "$(id -u)" -ne 0 ]; then
  err "must run as root (or sudo) when not --dry-run; use --dry-run to preview"
fi

VHOST_FILE="$VHOST_DIR/$HOSTNAME.conf"
CERT_FILE="$CERT_DIR/cert.pem"
KEY_FILE="$CERT_DIR/key.pem"

log "HOSTNAME=$HOSTNAME  UPSTREAM=$UPSTREAM:$PORT"
log "CERT_FILE=$CERT_FILE  KEY_FILE=$KEY_FILE"
log "VHOST_FILE=$VHOST_FILE"
log "RELOAD=$RELOAD  REGEN_CERT=$REGEN_CERT  DRY_RUN=$DRY_RUN"

# ---- Step 1: cert ----
maybe_gen_cert() {
  if [ "$REGEN_CERT" -eq 0 ] && [ -f "$CERT_FILE" ] && [ -f "$KEY_FILE" ]; then
    log "cert already exists at $CERT_DIR — skipping (use --regen-cert to force)"
    return 0
  fi

  if [ "$DRY_RUN" -eq 1 ]; then
    log "[dry-run] would generate self-signed cert at $CERT_DIR (CN=$HOSTNAME, 10 years, RSA 2048)"
    return 0
  fi

  log "generating self-signed cert at $CERT_DIR"
  mkdir -p "$CERT_DIR"
  chmod 700 "$CERT_DIR"
  openssl req -x509 -nodes -newkey rsa:2048 \
    -keyout "$KEY_FILE" \
    -out "$CERT_FILE" \
    -days 3650 \
    -subj "/CN=$HOSTNAME" \
    -addext "subjectAltName = DNS:$HOSTNAME" \
    >/dev/null 2>&1
  chmod 600 "$KEY_FILE"
  chmod 644 "$CERT_FILE"
  log "cert: $(openssl x509 -in "$CERT_FILE" -noout -subject -enddate)"
}

# ---- Step 2: render vhost ----
render_vhost() {
  cat <<NGINXEOF
# $HOSTNAME -> wa-crm @ $UPSTREAM:$PORT
# Generated by scripts/setup-nginx-vhost.sh on $(date -Iseconds)
# Idempotent — re-run the script with new --port / --upstream to update.

# Per-vhost connection-upgrade map (unique var name avoids collision with
# other vhosts on the same host that may already define \$connection_upgrade).
map \$http_upgrade \$$CONN_VAR {
    default upgrade;
    ''      close;
}

upstream wa_crm_backend_${VAR_SUFFIX} {
    server $UPSTREAM:$PORT;
    keepalive 32;
}

# HTTP — works for direct access AND for Cloudflare "Flexible" mode.
# Does NOT redirect to HTTPS at origin (would loop under Flexible).
server {
    listen 80;
    listen [::]:80;
    server_name $HOSTNAME;

    client_max_body_size 100m;

    location / {
        proxy_pass http://wa_crm_backend_${VAR_SUFFIX};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection \$$CONN_VAR;
        proxy_buffering off;
        proxy_read_timeout 600s;
    }
}

# HTTPS — used by Cloudflare "Full" / "Full (strict)" modes.
# Self-signed cert is fine for "Full" (non-strict). Swap to a CF Origin CA
# cert or LE cert for "Full (strict)" — only the ssl_certificate paths change.
server {
    listen 443 ssl;
    listen [::]:443 ssl;
    server_name $HOSTNAME;

    ssl_certificate     $CERT_FILE;
    ssl_certificate_key $KEY_FILE;
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_ciphers         HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;

    client_max_body_size 100m;

    location / {
        proxy_pass http://wa_crm_backend_${VAR_SUFFIX};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection \$$CONN_VAR;
        proxy_buffering off;
        proxy_read_timeout 600s;
    }
}
NGINXEOF
}

# ---- Step 3: write vhost (with backup + nginx -t + auto-rollback) ----
maybe_write_vhost() {
  if [ "$DRY_RUN" -eq 1 ]; then
    log "[dry-run] would write $VHOST_FILE:"
    echo "----- BEGIN $VHOST_FILE -----"
    render_vhost
    echo "----- END $VHOST_FILE -----"
    return 0
  fi

  mkdir -p "$VHOST_DIR" "$BACKUP_DIR"

  # Snapshot existing file if any
  if [ -f "$VHOST_FILE" ]; then
    BACKUP_NAME="${HOSTNAME}.conf.$(date +%Y%m%d-%H%M%S).bak"
    cp -p "$VHOST_FILE" "$BACKUP_DIR/$BACKUP_NAME"
    log "backed up existing vhost → $BACKUP_DIR/$BACKUP_NAME"
  fi

  # Write to tmp, validate, then move into place
  TMP=$(mktemp)
  render_vhost > "$TMP"

  # Stage the new file at the target path so `nginx -t` sees the full picture
  cp "$VHOST_FILE" "${VHOST_FILE}.prev" 2>/dev/null || true
  cp "$TMP" "$VHOST_FILE"
  chmod 644 "$VHOST_FILE"

  if ! nginx -t 2>&1; then
    log "nginx -t FAILED — rolling back $VHOST_FILE"
    if [ -f "${VHOST_FILE}.prev" ]; then
      mv "${VHOST_FILE}.prev" "$VHOST_FILE"
      log "rolled back to previous vhost"
    else
      rm -f "$VHOST_FILE"
      log "removed broken vhost (no prior version to roll back to)"
    fi
    rm -f "$TMP"
    err "nginx config invalid; rolled back. inspect '$BACKUP_DIR' or run with --dry-run to debug."
  fi

  rm -f "${VHOST_FILE}.prev" "$TMP"
  log "wrote $VHOST_FILE; nginx -t OK"
}

# ---- Step 4: reload ----
maybe_reload() {
  if [ "$RELOAD" -eq 0 ]; then
    log "skip reload (use --reload to apply now). Manually: systemctl reload nginx"
    return 0
  fi
  if [ "$DRY_RUN" -eq 1 ]; then
    log "[dry-run] would: systemctl reload nginx"
    return 0
  fi
  log "reloading nginx"
  systemctl reload nginx
  sleep 1
  systemctl is-active nginx >/dev/null && log "nginx reloaded; active" || err "nginx not active after reload"
}

maybe_gen_cert
maybe_write_vhost
maybe_reload

if [ "$DRY_RUN" -eq 0 ] && [ "$RELOAD" -eq 1 ]; then
  log "smoke test: curl -k -H 'Host: $HOSTNAME' https://127.0.0.1/api/health"
  curl -k -sS -o /dev/null -w "  http=%{http_code} time=%{time_total}\n" \
    -H "Host: $HOSTNAME" \
    --resolve "$HOSTNAME:443:127.0.0.1" \
    "https://$HOSTNAME/api/health" -m 10 || \
    log "smoke test curl failed — wa-crm backend may not be reachable at $UPSTREAM:$PORT (check docker compose ps)"
fi

log "done."
