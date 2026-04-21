#!/usr/bin/env bash
#
# analyze-perf-log.sh — 聚合 Phase 0 telemetry 日志
#
# 用法：
#   PERF_LOG_ENABLED=true 重启服务（pm2 restart wa-crm），采样 48h
#   然后跑：
#     bash scripts/analyze-perf-log.sh /tmp/wa-crawler-beau.log
#   或多文件：
#     bash scripts/analyze-perf-log.sh /tmp/wa-crawler-*.log /tmp/wa-crm-main.log
#
# 前置：需要 jq（brew install jq）
#
# 输出：p50/p95/p99 + QPS 的 markdown 表

set -euo pipefail

if [ $# -eq 0 ]; then
    echo "Usage: $0 <pm2-log-file> [more-logs...]" >&2
    exit 1
fi

LOGS="$*"
TMPDIR="$(mktemp -d -t perf-log-XXXXXX)"
trap 'rm -rf "$TMPDIR"' EXIT

# 1. 抽取所有 perf_log 行
cat $LOGS 2>/dev/null | grep -h '"perf_log":true' > "$TMPDIR/all.jsonl" || true
total=$(wc -l < "$TMPDIR/all.jsonl" | tr -d ' ')
if [ "$total" -eq 0 ]; then
    echo "❌ 没有找到任何 perf_log 行。确认：" >&2
    echo "   - 服务启动时带了 PERF_LOG_ENABLED=true" >&2
    echo "   - 日志文件路径正确（pm2 logs wa-crawler-beau --lines 0 | head 看）" >&2
    exit 2
fi
echo "✅ 共解析 $total 条 perf_log 记录"

# 2. 计算 phase 频次
echo
echo "## Phase 出现次数（过滤流量）"
echo
echo "| phase | count |"
echo "|---|---|"
jq -r '.phase' < "$TMPDIR/all.jsonl" | sort | uniq -c | sort -rn \
    | awk '{ printf "| %s | %s |\n", $2, $1 }'

# 3. 命令 IPC round-trip：配对 cmd_sent + cmd_wait_end
echo
echo "## 命令 IPC round-trip（main 发 cmd → main 收 result）"
echo

jq -r 'select(.phase=="cmd_sent") | [.cmdId, .ts] | @tsv' < "$TMPDIR/all.jsonl" \
    | sort > "$TMPDIR/sent.tsv"
jq -r 'select(.phase=="cmd_wait_end" and .outcome=="resolved") | [.cmdId, .ts] | @tsv' < "$TMPDIR/all.jsonl" \
    | sort > "$TMPDIR/wait.tsv"
join -t$'\t' "$TMPDIR/sent.tsv" "$TMPDIR/wait.tsv" \
    | awk -F'\t' '{ print ($3 - $2) }' \
    | sort -n > "$TMPDIR/roundtrip.txt"

n=$(wc -l < "$TMPDIR/roundtrip.txt" | tr -d ' ')
if [ "$n" -gt 0 ]; then
    p50=$(awk -v n=$n 'NR == int(n*0.5)+1 { print; exit }' "$TMPDIR/roundtrip.txt")
    p95=$(awk -v n=$n 'NR == int(n*0.95)+1 { print; exit }' "$TMPDIR/roundtrip.txt")
    p99=$(awk -v n=$n 'NR == int(n*0.99)+1 { print; exit }' "$TMPDIR/roundtrip.txt")
    echo "- 样本量: $n"
    echo "- p50: ${p50}ms"
    echo "- p95: ${p95}ms"
    echo "- p99: ${p99}ms"
else
    echo "- 没有配对成功的 cmd_sent + cmd_wait_end"
fi

# 4. REST 响应 p95 按 path 聚合
echo
echo "## REST 接口延迟（按 path + method）"
echo
echo "| method | path | count | p50 ms | p95 ms | p99 ms |"
echo "|---|---|---|---|---|---|"

jq -r 'select(.phase=="rest_response") | [.method, .path, .durationMs] | @tsv' < "$TMPDIR/all.jsonl" \
    | awk -F'\t' '{ key=$1"\t"$2; buckets[key] = (buckets[key] ? buckets[key] "," : "") $3 }
        END { for (k in buckets) print k "\t" buckets[k] }' \
    | while IFS=$'\t' read -r method path durations; do
        echo "$durations" | tr ',' '\n' | sort -n > "$TMPDIR/resp.txt"
        n=$(wc -l < "$TMPDIR/resp.txt" | tr -d ' ')
        [ "$n" -lt 3 ] && continue
        p50=$(awk -v n=$n 'NR == int(n*0.5)+1 { print; exit }' "$TMPDIR/resp.txt")
        p95=$(awk -v n=$n 'NR == int(n*0.95)+1 { print; exit }' "$TMPDIR/resp.txt")
        p99=$(awk -v n=$n 'NR == int(n*0.99)+1 { print; exit }' "$TMPDIR/resp.txt")
        echo "| $method | $path | $n | $p50 | $p95 | $p99 |"
    done

# 5. WhatsApp 消息端到端：wa_event_received → sse_broadcast
echo
echo "## 消息端到端（wa_event_received → sse_broadcast）"
echo

jq -r 'select(.phase=="wa_event_received" and .waMsgId != null) | [.waMsgId, .ts] | @tsv' < "$TMPDIR/all.jsonl" \
    | sort > "$TMPDIR/event.tsv"
jq -r 'select(.phase=="sse_broadcast" and .event=="wa-message" and .waMsgId != null) | [.waMsgId, .ts] | @tsv' < "$TMPDIR/all.jsonl" \
    | sort > "$TMPDIR/sse.tsv"
join -t$'\t' "$TMPDIR/event.tsv" "$TMPDIR/sse.tsv" \
    | awk -F'\t' '{ print ($3 - $2) }' \
    | sort -n > "$TMPDIR/e2e.txt"

n=$(wc -l < "$TMPDIR/e2e.txt" | tr -d ' ')
if [ "$n" -gt 0 ]; then
    p50=$(awk -v n=$n 'NR == int(n*0.5)+1 { print; exit }' "$TMPDIR/e2e.txt")
    p95=$(awk -v n=$n 'NR == int(n*0.95)+1 { print; exit }' "$TMPDIR/e2e.txt")
    p99=$(awk -v n=$n 'NR == int(n*0.99)+1 { print; exit }' "$TMPDIR/e2e.txt")
    echo "- 配对样本量: $n"
    echo "- p50: ${p50}ms, p95: ${p95}ms, p99: ${p99}ms"
else
    event_count=$(wc -l < "$TMPDIR/event.tsv" | tr -d ' ')
    sse_count=$(wc -l < "$TMPDIR/sse.tsv" | tr -d ' ')
    echo "- ⚠️  无配对。wa_event_received=$event_count, sse_broadcast(wa-message)=$sse_count"
    echo "- 若 sse_broadcast=0 → 确认 Phase 1 的爬虫路径 SSE 黑洞（预期现象，Phase 1 修后会有）"
fi

# 6. event-miss-rate（按 session 聚合）
echo
echo "## event-miss-rate：polling 兜底捕获的消息数 vs event 路径捕获数（按 session）"
echo
echo "| session | event_path | poll_path | miss_rate |"
echo "|---|---|---|---|"
jq -r 'select(.phase=="wa_event_received" and .sessionId != null) | .sessionId' < "$TMPDIR/all.jsonl" \
    | sort | uniq -c > "$TMPDIR/event_count.txt"
jq -r 'select(.phase=="wa_poll_inserted" and .sessionId != null) | .sessionId' < "$TMPDIR/all.jsonl" \
    | sort | uniq -c > "$TMPDIR/poll_count.txt"

# join 两个计数文件（格式 "count session"）按 session 名
awk 'FILENAME ~ /event/ { e[$2] = $1 } FILENAME ~ /poll/ { p[$2] = $1 }
    END {
        for (s in e) if (!(s in p)) p[s] = 0
        for (s in p) if (!(s in e)) e[s] = 0
        for (s in e) {
            total = e[s] + p[s]
            if (total == 0) continue
            miss = (p[s] * 100.0) / total
            printf "| %s | %d | %d | %.1f%% |\n", s, e[s], p[s], miss
        }
    }' "$TMPDIR/event_count.txt" "$TMPDIR/poll_count.txt"

# 7. 持久化耗时
echo
echo "## persistDirectMessageRecord 耗时"
echo

jq -r 'select(.phase=="persist_end" and .durationMs != null) | .durationMs' < "$TMPDIR/all.jsonl" \
    | sort -n > "$TMPDIR/persist.txt"

n=$(wc -l < "$TMPDIR/persist.txt" | tr -d ' ')
if [ "$n" -gt 0 ]; then
    p50=$(awk -v n=$n 'NR == int(n*0.5)+1 { print; exit }' "$TMPDIR/persist.txt")
    p95=$(awk -v n=$n 'NR == int(n*0.95)+1 { print; exit }' "$TMPDIR/persist.txt")
    p99=$(awk -v n=$n 'NR == int(n*0.99)+1 { print; exit }' "$TMPDIR/persist.txt")
    echo "- 样本量: $n"
    echo "- p50: ${p50}ms, p95: ${p95}ms, p99: ${p99}ms"
else
    echo "- 无样本（可能没人走 persistDirectMessageRecord，或 Phase 1 的 SSE 单一出口还没下沉到这条路径）"
fi

echo
echo "---"
echo "完成。建议结合 48h 采样窗口 + 真实用户活跃时段解读。"
