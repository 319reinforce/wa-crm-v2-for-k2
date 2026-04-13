#!/usr/bin/env bash
set -euo pipefail

ROOT="/Users/depp/wa-bot/wa-crm-v2"
API_BASE_DEFAULT="http://127.0.0.1:3000"
ROUTE_MAP_FILE="$ROOT/.wwebjs_auth/session-route.map"
DEFAULT_AUTO_WAIT_SEC="${WA_AUTO_ROUTE_WAIT_SEC:-300}"
QR_RENDER_ENABLED="${WA_QR_RENDER_ENABLED:-1}"
QR_RENDER_INTERVAL_MS="${WA_QR_RENDER_INTERVAL_MS:-20000}"
QR_RENDER_SCRIPT="$ROOT/scripts/watch-wa-qr.cjs"
SESSION_ORDER=(beau yiyun youke jiawen)
LAST_ROUTE_TARGET_SID=""
LAST_ROUTE_DETECTED_OWNER=""
LAST_ROUTE_DETECTED_PHONE=""
MENU_RESULT=""

ensure_node_runtime() {
  if [[ -s "$HOME/.nvm/nvm.sh" ]]; then
    # shellcheck disable=SC1090
    source "$HOME/.nvm/nvm.sh"
    if [[ -f "$ROOT/.nvmrc" ]]; then
      nvm use >/dev/null
    fi
  fi
}

usage() {
  cat <<'USAGE'
Usage:
  scripts/wa-session.sh start <session_id> [owner] [api_base]
  scripts/wa-session.sh stop <session_id>
  scripts/wa-session.sh status <session_id>
  scripts/wa-session.sh logs <session_id>
  scripts/wa-session.sh route <session_id> [api_base]
  scripts/wa-session.sh start-auto-route <session_id> [api_base]
  scripts/wa-session.sh remap-all [api_base]
  scripts/wa-session.sh map

Examples:
  scripts/wa-session.sh start beau
  scripts/wa-session.sh logs beau
  scripts/wa-session.sh route beau
  scripts/wa-session.sh start-auto-route beau
  scripts/wa-session.sh remap-all
USAGE
}

normalize_key() {
  echo "${1:-}" | tr '[:upper:]' '[:lower:]' | tr -cd 'a-z0-9'
}

infer_owner_by_sid() {
  local raw
  raw="$(normalize_key "${1:-}")"
  case "$raw" in
    beau) echo "Beau" ;;
    yiyun) echo "Yiyun" ;;
    youke|wangyouke) echo "WangYouKe" ;;
    jiawen|sybil) echo "Jiawen" ;;
    *) echo "" ;;
  esac
}

infer_sid_by_owner() {
  local raw
  raw="$(normalize_key "${1:-}")"
  case "$raw" in
    beau|yifan) echo "beau" ;;
    yiyun|alice|yanyiyun) echo "yiyun" ;;
    wangyouke|youke|bella|youkebella) echo "youke" ;;
    jiawen|sybil) echo "jiawen" ;;
    *) echo "" ;;
  esac
}

is_known_sid() {
  case "${1:-}" in
    beau|yiyun|youke|jiawen) return 0 ;;
    *) return 1 ;;
  esac
}

next_sid_in_order() {
  local current="${1:-}"
  local i
  for ((i = 0; i < ${#SESSION_ORDER[@]}; i++)); do
    if [[ "${SESSION_ORDER[$i]}" ***REMOVED*** "$current" ]]; then
      if (( i + 1 < ${#SESSION_ORDER[@]} )); then
        echo "${SESSION_ORDER[$((i + 1))]}"
      else
        echo ""
      fi
      return 0
    fi
  done
  echo ""
}

pid_file_for() {
  echo "/tmp/wa-crawler-${1}.pid"
}

log_file_for() {
  echo "/tmp/wa-crawler-${1}.log"
}

singleton_glob_for() {
  echo "$ROOT/.wwebjs_auth/session-${1}/session/Singleton*"
}

is_running_sid() {
  local sid="$1"
  local pid_file
  pid_file="$(pid_file_for "$sid")"

  if [[ -f "$pid_file" ]]; then
    local pid
    pid="$(cat "$pid_file" 2>/dev/null || true)"
    if [[ -n "${pid:-}" ]] && kill -0 "$pid" 2>/dev/null; then
      return 0
    fi
    rm -f "$pid_file"
  fi

  local probe_pid
  probe_pid="$(pgrep -f "node server/waCrawler.cjs --session-id=${sid}" | head -n1 || true)"
  if [[ -n "${probe_pid:-}" ]]; then
    echo "$probe_pid" >"$pid_file"
    return 0
  fi

  return 1
}

start_sid() {
  local sid="$1"
  local owner="${2:-}"
  local api_base="${3:-$API_BASE_DEFAULT}"
  local pid_file log_file singleton_glob

  if [[ -z "$owner" ]]; then
    owner="$(infer_owner_by_sid "$sid")"
  fi
  if [[ -z "$owner" ]]; then
    echo "[wa-session] owner is required for unknown session_id: $sid"
    return 1
  fi

  pid_file="$(pid_file_for "$sid")"
  log_file="$(log_file_for "$sid")"
  singleton_glob="$(singleton_glob_for "$sid")"

  if is_running_sid "$sid"; then
    echo "[wa-session] ${sid} already running (pid=$(cat "$pid_file"))"
    echo "[wa-session] logs: $log_file"
    return 0
  fi

  # 清理遗留锁，避免 "browser is already running"
  pkill -f "session-${sid}/session" >/dev/null 2>&1 || true
  rm -f $singleton_glob >/dev/null 2>&1 || true

  cd "$ROOT"
  ensure_node_runtime
  WA_API_BASE="$api_base" WA_SESSION_ID="$sid" WA_OWNER="$owner" \
    nohup node server/waCrawler.cjs --session-id="$sid" --owner="$owner" >"$log_file" 2>&1 &
  echo $! >"$pid_file"
  sleep 1
  echo "[wa-session] started ${sid} (owner=${owner}, pid=$(cat "$pid_file"))"
  echo "[wa-session] logs: $log_file"
  echo "[wa-session] 扫码后建议执行: scripts/wa-session.sh route ${sid}"
}

stop_sid() {
  local sid="$1"
  local pid_file singleton_glob

  pid_file="$(pid_file_for "$sid")"
  singleton_glob="$(singleton_glob_for "$sid")"

  if [[ -f "$pid_file" ]]; then
    local pid
    pid="$(cat "$pid_file" 2>/dev/null || true)"
    if [[ -n "${pid:-}" ]]; then
      kill "$pid" >/dev/null 2>&1 || true
    fi
    rm -f "$pid_file"
  fi

  pkill -f "node server/waCrawler.cjs --session-id=${sid}" >/dev/null 2>&1 || true
  # 兜底清理对应 session 的 chrome 进程
  pkill -f "session-${sid}/session" >/dev/null 2>&1 || true
  rm -f $singleton_glob >/dev/null 2>&1 || true
  echo "[wa-session] stopped ${sid}"
}

status_sid() {
  local sid="$1"
  local pid_file log_file
  pid_file="$(pid_file_for "$sid")"
  log_file="$(log_file_for "$sid")"

  if is_running_sid "$sid"; then
    echo "[wa-session] ${sid} running (pid=$(cat "$pid_file"))"
  else
    echo "[wa-session] ${sid} stopped"
  fi

  if [[ -f "$log_file" ]]; then
    echo "[wa-session] recent logs:"
    tail -n 20 "$log_file"
  else
    echo "[wa-session] no log file: $log_file"
  fi
}

logs_sid() {
  local sid="$1"
  local log_file
  log_file="$(log_file_for "$sid")"
  touch "$log_file"
  tail -f "$log_file"
}

extract_latest_ready_from_log() {
  local sid="$1"
  local log_file line raw

  log_file="$(log_file_for "$sid")"
  if [[ ! -f "$log_file" ]]; then
    return 1
  fi

  raw="$(rg -n "WhatsApp 已就绪! owner=" "$log_file" | tail -n1 || true)"
  if [[ -z "$raw" ]]; then
    return 1
  fi

  line="$(echo "$raw" | sed -E 's/^[0-9]+://')"
  local detected_owner detected_phone
  detected_owner="$(echo "$line" | sed -E 's/.*owner=([^ ]+).*/\1/')"
  detected_phone="$(echo "$line" | sed -E 's/.*phone=([^ ]+).*/\1/')"

  if [[ -z "$detected_owner" ]]; then
    return 1
  fi

  echo "$detected_owner|$detected_phone|$line"
}

append_route_map() {
  local source_sid="$1"
  local detected_owner="$2"
  local detected_phone="$3"
  local target_sid="$4"
  local action="$5"
  local now

  now="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  mkdir -p "$(dirname "$ROUTE_MAP_FILE")"

  if [[ ! -f "$ROUTE_MAP_FILE" ]]; then
    echo -e "timestamp_utc\tsource_sid\tdetected_owner\tdetected_phone\ttarget_sid\taction" >"$ROUTE_MAP_FILE"
  fi

  echo -e "${now}\t${source_sid}\t${detected_owner}\t${detected_phone}\t${target_sid}\t${action}" >>"$ROUTE_MAP_FILE"
}

route_sid() {
  local sid="$1"
  local api_base="${2:-$API_BASE_DEFAULT}"
  local parsed detected_owner detected_phone target_sid
  LAST_ROUTE_TARGET_SID=""
  LAST_ROUTE_DETECTED_OWNER=""
  LAST_ROUTE_DETECTED_PHONE=""

  parsed="$(extract_latest_ready_from_log "$sid" || true)"
  if [[ -z "$parsed" ]]; then
    echo "[wa-session] ${sid}: 未找到扫码成功记录（请先扫码并出现 WhatsApp 已就绪）"
    return 1
  fi

  detected_owner="$(echo "$parsed" | cut -d'|' -f1)"
  detected_phone="$(echo "$parsed" | cut -d'|' -f2)"
  target_sid="$(infer_sid_by_owner "$detected_owner")"

  if [[ -z "$target_sid" ]]; then
    echo "[wa-session] ${sid}: 无法根据 owner=${detected_owner} 推断目标 session"
    return 1
  fi

  if [[ "$sid" ***REMOVED*** "$target_sid" ]]; then
    append_route_map "$sid" "$detected_owner" "$detected_phone" "$target_sid" "aligned"
    LAST_ROUTE_TARGET_SID="$target_sid"
    LAST_ROUTE_DETECTED_OWNER="$detected_owner"
    LAST_ROUTE_DETECTED_PHONE="$detected_phone"
    echo "[wa-session] ${sid}: 已对齐 owner=${detected_owner} phone=${detected_phone}"
    return 0
  fi

  echo "[wa-session] ${sid}: 检测到 owner=${detected_owner} phone=${detected_phone}，将路由到 ${target_sid}"

  stop_sid "$sid" >/dev/null
  stop_sid "$target_sid" >/dev/null

  local src_dir dst_dir
  src_dir="$ROOT/.wwebjs_auth/session-${sid}"
  dst_dir="$ROOT/.wwebjs_auth/session-${target_sid}"

  if [[ -d "$src_dir" ]]; then
    if [[ -d "$dst_dir" ]]; then
      local backup
      backup="${dst_dir}.bak.$(date +%Y%m%d-%H%M%S)"
      mv "$dst_dir" "$backup"
      echo "[wa-session] backup: ${dst_dir} -> ${backup}"
    fi
    mv "$src_dir" "$dst_dir"
    echo "[wa-session] moved auth: ${src_dir} -> ${dst_dir}"
  fi

  start_sid "$target_sid" "$detected_owner" "$api_base" >/dev/null
  append_route_map "$sid" "$detected_owner" "$detected_phone" "$target_sid" "rerouted"
  LAST_ROUTE_TARGET_SID="$target_sid"
  LAST_ROUTE_DETECTED_OWNER="$detected_owner"
  LAST_ROUTE_DETECTED_PHONE="$detected_phone"
  echo "[wa-session] rerouted: ${sid} -> ${target_sid} (owner=${detected_owner})"
}

resolve_sid_input() {
  local input="${1:-}"
  local raw sid_by_owner
  raw="$(normalize_key "$input")"
  if is_known_sid "$raw"; then
    echo "$raw"
    return 0
  fi
  sid_by_owner="$(infer_sid_by_owner "$input")"
  if [[ -n "$sid_by_owner" ]]; then
    echo "$sid_by_owner"
    return 0
  fi
  echo ""
  return 1
}

wait_for_ready_event() {
  local sid="$1"
  local timeout_sec="${2:-$DEFAULT_AUTO_WAIT_SEC}"
  local elapsed=0

  is_ready_by_status() {
    local status_file="$ROOT/.wa_ipc/status/${sid}.json"
    if [[ ! -f "$status_file" ]]; then
      return 1
    fi
    if node -e '
      const fs=require("fs");
      const p=process.argv[1];
      try{
        const s=JSON.parse(fs.readFileSync(p,"utf8"));
        process.exit(s && s.ready***REMOVED***=true ? 0 : 1);
      }catch(_){ process.exit(1); }
    ' "$status_file"; then
      return 0
    fi
    return 1
  }

  if is_ready_by_status || extract_latest_ready_from_log "$sid" >/dev/null 2>&1; then
    return 0
  fi

  while (( elapsed < timeout_sec )); do
    if is_ready_by_status || extract_latest_ready_from_log "$sid" >/dev/null 2>&1; then
      return 0
    fi

    if ! is_running_sid "$sid"; then
      echo "[wa-session] ${sid}: 进程已退出，停止等待扫码"
      return 2
    fi

    if [[ "$QR_RENDER_ENABLED" != "1" ]] && (( elapsed > 0 )) && (( elapsed % 15 ***REMOVED*** 0 )); then
      echo "[wa-session] ${sid}: 已等待 ${elapsed}s，继续等待扫码..."
    fi

    sleep 1
    elapsed=$((elapsed + 1))
  done

  echo "[wa-session] ${sid}: 等待扫码超时（${timeout_sec}s）"
  return 1
}

auto_scan_and_route_once() {
  local sid="$1"
  local api_base="${2:-$API_BASE_DEFAULT}"
  local timeout_sec="${3:-$DEFAULT_AUTO_WAIT_SEC}"
  local log_file tail_pid wait_rc qr_pid=""

  start_sid "$sid" "" "$api_base" || return 1
  log_file="$(log_file_for "$sid")"

  if [[ "$QR_RENDER_ENABLED" ***REMOVED*** "1" ]] && [[ -f "$QR_RENDER_SCRIPT" ]]; then
    echo "[wa-session] ${sid}: 启用二维码变化渲染（扫码成功后会自动 route）"
    node "$QR_RENDER_SCRIPT" single --session "$sid" --interval "$QR_RENDER_INTERVAL_MS" &
    qr_pid=$!
  else
    echo "[wa-session] ${sid}: 输出实时日志（扫码成功后会自动路由）"
    tail -n 120 -f "$log_file" &
    tail_pid=$!
  fi

  if wait_for_ready_event "$sid" "$timeout_sec"; then
    wait_rc=0
  else
    wait_rc=$?
  fi

  if [[ -n "${qr_pid:-}" ]]; then
    kill "$qr_pid" >/dev/null 2>&1 || true
    wait "$qr_pid" >/dev/null 2>&1 || true
  else
    kill "$tail_pid" >/dev/null 2>&1 || true
    wait "$tail_pid" >/dev/null 2>&1 || true
  fi

  if [[ "$wait_rc" -ne 0 ]]; then
    return "$wait_rc"
  fi

  echo "[wa-session] ${sid}: 检测到扫码成功，开始 route..."
  route_sid "$sid" "$api_base"
}

prompt_sid_pick() {
  local picked resolved
  while true; do
    read -r -p "输入 session/operator (beau/yiyun/youke/jiawen 或 Beau/Yiyun/...): " picked
    resolved="$(resolve_sid_input "$picked")"
    if [[ -n "$resolved" ]]; then
      MENU_RESULT="$resolved"
      return 0
    fi
    echo "[wa-session] 无效输入，请重试。"
  done
}

prompt_next_after_success() {
  local current_sid="$1"
  local next_sid skip_to_sid
  next_sid="$(next_sid_in_order "$current_sid")"
  skip_to_sid="$(next_sid_in_order "$next_sid")"

  while true; do
    echo
    echo "[auto-route] ${current_sid} 扫码流程完成，下一步："
    if [[ -n "$next_sid" ]]; then
      echo "  1) 扫下一个（${next_sid}）"
    else
      echo "  1) 扫下一个（无可用）"
    fi
    if [[ -n "$skip_to_sid" ]]; then
      echo "  2) 跳过 ${next_sid}，扫 ${skip_to_sid}"
    else
      echo "  2) 跳过下一个（无可用）"
    fi
    echo "  3) 指定要扫的 session/operator"
    echo "  4) 结束 auto-route"
    read -r -p "请选择 [1/2/3/4]: " choice

    case "$choice" in
      1)
        if [[ -z "$next_sid" ]]; then
          echo "[wa-session] 没有下一个 session。"
          continue
        fi
        MENU_RESULT="$next_sid"
        return 0
        ;;
      2)
        if [[ -z "$skip_to_sid" ]]; then
          echo "[wa-session] 没有可跳过后的目标 session。"
          continue
        fi
        MENU_RESULT="$skip_to_sid"
        return 0
        ;;
      3)
        prompt_sid_pick
        return 0
        ;;
      4)
        MENU_RESULT="__END__"
        return 0
        ;;
      *)
        echo "[wa-session] 无效选择，请重试。"
        ;;
    esac
  done
}

prompt_after_failure() {
  local current_sid="$1"

  while true; do
    echo
    echo "[auto-route] ${current_sid} 本轮未完成，下一步："
    echo "  1) 重试当前 ${current_sid}"
    echo "  2) 跳过当前，扫下一个"
    echo "  3) 指定要扫的 session/operator"
    echo "  4) 结束 auto-route"
    read -r -p "请选择 [1/2/3/4]: " choice

    case "$choice" in
      1)
        MENU_RESULT="$current_sid"
        return 0
        ;;
      2)
        local next_sid
        next_sid="$(next_sid_in_order "$current_sid")"
        if [[ -z "$next_sid" ]]; then
          echo "[wa-session] 当前已是最后一个，没有下一个 session。"
          continue
        fi
        MENU_RESULT="$next_sid"
        return 0
        ;;
      3)
        prompt_sid_pick
        return 0
        ;;
      4)
        MENU_RESULT="__END__"
        return 0
        ;;
      *)
        echo "[wa-session] 无效选择，请重试。"
        ;;
    esac
  done
}

start_auto_route_flow() {
  local sid="$1"
  local api_base="${2:-$API_BASE_DEFAULT}"
  local current_sid="$sid"
  local timeout_sec="$DEFAULT_AUTO_WAIT_SEC"

  if [[ ! -t 0 ]]; then
    echo "[wa-session] start-auto-route 需要交互终端（TTY）"
    return 1
  fi

  while true; do
    echo
    echo "════════════════════════════════════════════════════"
    echo "[auto-route] 开始处理 session=${current_sid}（超时 ${timeout_sec}s）"
    echo "════════════════════════════════════════════════════"

    if auto_scan_and_route_once "$current_sid" "$api_base" "$timeout_sec"; then
      local routed_sid
      routed_sid="${LAST_ROUTE_TARGET_SID:-$current_sid}"
      echo "[auto-route] 完成：source=${current_sid}, target=${routed_sid}, owner=${LAST_ROUTE_DETECTED_OWNER:-unknown}"
      prompt_next_after_success "$routed_sid"
    else
      echo "[auto-route] ${current_sid} 未完成自动路由，请选择后续动作。"
      prompt_after_failure "$current_sid"
    fi

    if [[ "$MENU_RESULT" ***REMOVED*** "__END__" ]]; then
      echo "[auto-route] 已结束。"
      return 0
    fi

    current_sid="$MENU_RESULT"
  done
}

remap_all() {
  local api_base="${1:-$API_BASE_DEFAULT}"
  local any_change="false"

  for sid in beau yiyun youke jiawen; do
    if route_sid "$sid" "$api_base" >/tmp/wa-session-route-${sid}.tmp 2>&1; then
      any_change="true"
      cat "/tmp/wa-session-route-${sid}.tmp"
    else
      cat "/tmp/wa-session-route-${sid}.tmp"
    fi
    rm -f "/tmp/wa-session-route-${sid}.tmp"
  done

  if [[ "$any_change" ***REMOVED*** "false" ]]; then
    echo "[wa-session] remap-all: 未检测到可重映射项"
  fi
}

show_map() {
  if [[ -f "$ROUTE_MAP_FILE" ]]; then
    cat "$ROUTE_MAP_FILE"
  else
    echo "[wa-session] no route map file: $ROUTE_MAP_FILE"
  fi
}

cmd="${1:-}"
sid="${2:-}"
owner="${3:-}"
api_base="${4:-$API_BASE_DEFAULT}"

if [[ -z "$cmd" ]]; then
  usage
  exit 1
fi

case "$cmd" in
  start)
    if [[ -z "$sid" ]]; then
      echo "session_id is required"
      usage
      exit 1
    fi
    start_sid "$sid" "$owner" "$api_base"
    ;;

  stop)
    if [[ -z "$sid" ]]; then
      echo "session_id is required"
      usage
      exit 1
    fi
    stop_sid "$sid"
    ;;

  status)
    if [[ -z "$sid" ]]; then
      echo "session_id is required"
      usage
      exit 1
    fi
    status_sid "$sid"
    ;;

  logs)
    if [[ -z "$sid" ]]; then
      echo "session_id is required"
      usage
      exit 1
    fi
    logs_sid "$sid"
    ;;

  route)
    if [[ -z "$sid" ]]; then
      echo "session_id is required"
      usage
      exit 1
    fi
    route_sid "$sid" "$api_base"
    ;;

  start-auto-route)
    if [[ -z "$sid" ]]; then
      echo "session_id is required"
      usage
      exit 1
    fi
    if ! is_known_sid "$sid"; then
      local_sid="$(resolve_sid_input "$sid")"
      if [[ -z "$local_sid" ]]; then
        echo "[wa-session] 无法识别 session_id/operator: $sid"
        exit 1
      fi
      sid="$local_sid"
    fi
    start_auto_route_flow "$sid" "${3:-$API_BASE_DEFAULT}"
    ;;

  remap-all)
    remap_all "$api_base"
    ;;

  map)
    show_map
    ;;

  *)
    usage
    exit 1
    ;;
esac
