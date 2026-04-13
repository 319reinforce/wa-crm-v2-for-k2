#!/usr/bin/env bash
set -euo pipefail

ROOT="/Users/depp/wa-bot/wa-crm-v2"
ECOSYSTEM_FILE="$ROOT/ecosystem.wa-crawlers.config.cjs"
APP_NAMES=(wa-crawler-beau wa-crawler-yiyun wa-crawler-youke wa-crawler-jiawen)

usage() {
  cat <<'USAGE'
Usage:
  scripts/wa-pm2.sh start
  scripts/wa-pm2.sh stop
  scripts/wa-pm2.sh restart
  scripts/wa-pm2.sh delete
  scripts/wa-pm2.sh status
  scripts/wa-pm2.sh logs [app_name]
  scripts/wa-pm2.sh setup-logrotate
  scripts/wa-pm2.sh save
  scripts/wa-pm2.sh doctor
USAGE
}

require_pm2() {
  if ! command -v pm2 >/dev/null 2>&1; then
    echo "pm2 not found. Please install: npm i -g pm2"
    exit 1
  fi
}

stop_raw_crawlers() {
  for sid in beau yiyun youke jiawen; do
    "$ROOT/scripts/wa-session.sh" stop "$sid" >/dev/null 2>&1 || true
  done
  pkill -f "node server/waCrawler.cjs" >/dev/null 2>&1 || true
}

start_apps() {
  require_pm2
  stop_raw_crawlers
  cd "$ROOT"

  for app in "${APP_NAMES[@]}"; do
    pm2 delete "$app" >/dev/null 2>&1 || true
  done

  pm2 start "$ECOSYSTEM_FILE"
  pm2 save
}

stop_apps() {
  require_pm2
  for app in "${APP_NAMES[@]}"; do
    pm2 stop "$app" >/dev/null 2>&1 || true
  done
}

restart_apps() {
  require_pm2
  for app in "${APP_NAMES[@]}"; do
    pm2 restart "$app" >/dev/null 2>&1 || true
  done
  pm2 save
}

delete_apps() {
  require_pm2
  for app in "${APP_NAMES[@]}"; do
    pm2 delete "$app" >/dev/null 2>&1 || true
  done
  pm2 save
}

status_apps() {
  require_pm2
  pm2 list
}

logs_apps() {
  require_pm2
  local app="${1:-}"
  if [[ -n "$app" ]]; then
    pm2 logs "$app"
  else
    pm2 logs --lines 80
  fi
}

setup_logrotate() {
  require_pm2
  pm2 install pm2-logrotate || true
  pm2 set pm2-logrotate:max_size 50M
  pm2 set pm2-logrotate:retain 14
  pm2 set pm2-logrotate:compress true
  pm2 set pm2-logrotate:dateFormat YYYY-MM-DD_HH-mm-ss
  pm2 set pm2-logrotate:rotateInterval '0 0 * * *'
  pm2 set pm2-logrotate:workerInterval 30
  pm2 set pm2-logrotate:rotateModule true
  pm2 save
  echo "pm2-logrotate configured"
}

doctor() {
  require_pm2
  echo "[doctor] expected apps: ${APP_NAMES[*]}"
  if ! curl -fsS http://127.0.0.1:3000/api/health >/dev/null 2>&1; then
    echo "[doctor] warning: API http://127.0.0.1:3000/api/health unreachable"
    echo "[doctor] suggestion: run API separately (DISABLE_WA_SERVICE=true DISABLE_WA_WORKER=true PORT=3000 npm start)"
  fi
  pm2 jlist | node -e '
let data="";
process.stdin.on("data",d=>data+=d);
process.stdin.on("end",()=>{
  const apps=JSON.parse(data||"[]");
  const expected=["wa-crawler-beau","wa-crawler-yiyun","wa-crawler-youke","wa-crawler-jiawen"];
  const rows=expected.map(name=>{
    const app=apps.find(a=>a.name === name);
    return {
      name,
      status: app?.pm2_env?.status || "missing",
      restarts: app?.pm2_env?.restart_time ?? -1,
      pid: app?.pid ?? -1
    }
  });
  console.table(rows);
  const unhealthy=rows.filter(r=>r.status !== "online");
  if(unhealthy.length){
    process.exitCode=2;
  }
});'
}

cmd="${1:-}"
case "$cmd" in
  start) start_apps ;;
  stop) stop_apps ;;
  restart) restart_apps ;;
  delete) delete_apps ;;
  status) status_apps ;;
  logs) logs_apps "${2:-}" ;;
  setup-logrotate) setup_logrotate ;;
  save) require_pm2; pm2 save ;;
  doctor) doctor ;;
  *) usage; exit 1 ;;
esac
