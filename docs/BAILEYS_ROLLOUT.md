# Baileys 迁移运维手册

> 代号: proud-rain | 分支: `feat/baileys-driver-migration` | 更新: 2026-04-22

---

## 概述

whatsapp-mgr 从 `whatsapp-web.js` (Chromium) 迁移到 `Baileys` (纯 WebSocket)，采用双驱动架构按 session 切换。

**资源收益**: 每 session 从 200–500 MB → 30–60 MB，Chromium 冷启 15s+ → WebSocket 秒级。

**封号风险**: Baileys 走 WhatsApp 非官方协议，灰度期间需监控账号状态。

---

## 架构速查

```
HTTP /api/wa/*
  → waSessionRouter
    → waService.js (facade)
      → wa/index.js createDriver(cfg)
        → wwebjsDriver.js  (Chromium)  或  baileysDriver.js (WebSocket)
```

切换方式：`POST /api/wa/sessions/:sessionId/driver { driver: 'baileys', force_disconnect: true }`

---

## 核心运维端点

### 切换 Driver（异步 202 + cmdId）

```bash
# 查看当前 driver
curl -s http://localhost:3000/api/wa/sessions \
  -H "Authorization: Bearer $TOKEN" | jq '.[]|{session_id, driver}'

# 切换到 Baileys（admin-only，立即 202 返回 command_id）
curl -X POST http://localhost:3000/api/wa/sessions/jiawen/driver \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"driver":"baileys","force_disconnect":true}'
# → 202 { "command_id": "...", "status": "pending",
#         "poll_url": "/api/wa/sessions/jiawen/commands/..." }

# 轮询命令状态（pending → running → completed | failed | timeout）
CMD_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
curl -s http://localhost:3000/api/wa/sessions/jiawen/commands/$CMD_ID \
  -H "Authorization: Bearer $TOKEN"
# → { "ok": true, "command": { "status": "completed", "progress": "done",
#     "result": { "driver": "baileys", "hint": "..." }, ... } }

# 切换回 wwebjs
curl -X POST http://localhost:3000/api/wa/sessions/jiawen/driver \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"driver":"wwebjs","force_disconnect":true}'
```

**说明**:
- 端点 admin-only，owner-scoped / service token 403
- 同步阶段只写 DB 字段 + 入队 cmdId，< 500ms 返回（不再吃 30s）
- 异步后台：等 runtime_state=stopped（最多 30s）→ desired_state=running
- timeout 不影响正确性：desired_state 已是 stopped，reconciler 会继续推进
- 切换后 session 会重启，新 QR 在 `/api/wa/qr?session_id=jiawen` 生成

### 监控指标

```bash
# Prometheus 格式指标
curl -s http://localhost:3000/metrics/wa

# 关键指标
wa_driver_status{session_id="jiawen",driver="baileys"}  # 0=disc 1=connecting 2=ready
wa_messages_received_total{session_id="jiawen",driver="baileys"}
wa_messages_sent_total{session_id="jiawen",driver="baileys",result="success"}
wa_send_latency_ms_bucket{driver="baileys",le="2500"}
wa_disconnect_total{session_id="jiawen",driver="baileys",reason="loggedOut"}
```

### 日志查询

```bash
# 过滤 wa_metric JSON Lines
pm2 logs wa-crm --lines 1000 --nostream 2>&1 | grep '"wa_metric"' | head -50

# 运行对比报告
node scripts/driver-compare-report.mjs --days 7 < $(pm2 pid 0 | xargs -I{} pm2 describe {} | grep 'exec path' | awk '{print $3}')/../../logs/*.log
```

---

## 灰度 Rollout 流程

### W0: 部署新版本

1. 部署 `feat/baileys-driver-migration` 版本
2. 运行 migration: `npm run wa:driver:migrate` 或 `node migrate-wa-sessions-driver.js`
3. 验证列: `SELECT driver, COUNT(*) FROM wa_sessions GROUP BY driver`
4. 所有 session 默认 `driver='wwebjs'`，行为不变

### W1: 单账号灰度

1. 选低价值账号（建议 `jiawen` 或新建 `test`）
2. 执行切换端点（见上）
3. 运营扫码，盯 `/api/wa/status`
4. 每日检查：
   - `wa_disconnect_total` 里 `loggedOut` 是否 > 0
   - `wa_send_latency_ms` p95 是否 ≤ 2.5s
   - `/api/wa/groups` 返回群数是否与 wwebjs 账号一致

**Go/No-Go 判据**:

| 指标 | 阈值 |
|------|------|
| 无 `loggedOut` disconnect | 100% |
| 重连频率 | ≤ wwebjs baseline × 1.5 |
| Send p95 latency | ≤ 2.5s |
| Group sync parity | 群数一致 |
| 媒体接收 | 5 类 MIME 全部成功 |

### W2: 决策点

- **OK** → `WA_DEFAULT_DRIVER=baileys`（新账号默认 baileys），老账号按运营节奏逐步切换
- **Fail** → 全量切回 `WA_DEFAULT_DRIVER=wwebjs`，运行所有账号的切换端点切回 wwebjs

### W3–W4+: 全面迁移

- 老账号运营配合重扫 QR 迁移
- 保留 1 个 wwebjs 账号做观察组
- 所有账号稳定 2 周后，独立 PR 移除 Chromium + `.wwebjs_*` volumes

---

## QR 重扫标准流程

1. 确认 `runtime_state` 已是 `stopped`（切换端点已处理）
2. `GET /api/wa/qr?session_id=xxx` 获取 QR DataURL
3. 在前台展示给运营人员
4. 运营扫码后 `GET /api/wa/status?session_id=xxx` 确认 `ready: true`
5. 观察 5 分钟无 disconnect

---

## 紧急回滚

### 单账号回滚
```bash
curl -X POST http://localhost:3000/api/wa/sessions/$SID/driver \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"driver":"wwebjs","force_disconnect":true}'
# → 重扫 QR
```

### 紧急熔断（全部 Baileys 切回 wwebjs）
在 `docker-compose.server.yml` 设置 `WA_KILL_BAILEYS=true`，然后：
```bash
# 所有账号切回
for sid in beau yiyun youke jiawen; do
  curl -X POST http://localhost:3000/api/wa/sessions/$sid/driver \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"driver":"wwebjs","force_disconnect":true}'
done
```
数据零丢失（消息在 DB，`message_hash` 去重保证重复不写）。

---

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `WA_DEFAULT_DRIVER` | `wwebjs` | 新账号默认驱动 |
| `WA_BAILEYS_AUTH_ROOT` | `/app/.baileys_auth` | Baileys auth 目录 |
| `WA_KILL_BAILEYS` | `(空)` | 设置任意值强制 fallback 到 wwebjs |
| `WA_METRICS_ENABLED` | `true` | 关闭 wa_metric JSON Lines 输出 |

---

## 已知差异（wwebjs vs Baileys）

| 维度 | wwebjs | Baileys |
|------|--------|---------|
| wa_message_id 格式 | `_serialized` 字符串 | 原始 hash 字符串 |
| Auth 存储 | `.wwebjs_auth/` | `.baileys_auth/` |
| 发送延迟 | 较慢（DOM 操作） | 较快（WebSocket） |
| 群同步 | `chat.fetchMessages()` | `messages.upsert` + `sock.groupFetchAllParticipating()` |
| 媒体: ogg 音频 | 支持 | 支持 |
| 媒体: webp 贴纸 | 支持 | 支持 |
| 重连策略 | Puppeteer 内部 | 显式 `DisconnectReason` 判断 |

---

## ToS 免责

WhatsApp 官方不支持 Baileys 等第三方库。Meta / WhatsApp LLC 可能检测并封禁使用非官方协议接口的账号。灰度期间使用低价值账号，发现封号立即回滚。生产全量迁移前需业务方确认封号风险可接受。

---

## 关键文件

| 文件 | 用途 |
|------|------|
| `server/services/wa/driver/baileysDriver.js` | Baileys 驱动实现 |
| `server/services/wa/driver/wwebjsDriver.js` | wwebjs 驱动（迁自 waService.js） |
| `server/services/wa/index.js` | 驱动工厂 |
| `server/services/waMetrics.js` | Prometheus 指标 |
| `server/routes/wa.js` → `POST /sessions/:id/driver` | 切换端点 |
| `server/migrations/003_add_wa_sessions_driver.sql` | Schema migration |
| `migrate-wa-sessions-driver.js` | CLI migration 脚本 |
| `scripts/driver-compare-report.mjs` | 指标对比报告 |
| `docker-compose.server.yml` | volumes + env 新增 |
| `Dockerfile` | .baileys_auth 目录新增 |
