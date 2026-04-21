# WA Sessions Design — Code Review Report

> 评审对象：`docs/WA_SESSIONS_DESIGN.md` v1 (Draft)
> 评审人：AI code-reviewer subagent
> 评审维度：正确性 / 完整性 / 安全性 / 可落地性 / 可测试性 / 运维复杂度 / 项目规则一致性
> 评审日期：2026-04-17

---

## Summary

- **总体结论：GO with changes**
- 架构方向正确（复用文件 IPC 队列），但有 **2 个 CRITICAL 问题必须在 Phase 1 启动前解决**
- 发现统计：**CRITICAL × 2，HIGH × 5，MEDIUM × 5，LOW × 3**

---

## Critical Findings

### [CRITICAL-1] 主 service 不处理 IPC 命令，对它发 logout/restart/clear_auth 必然 504

**位置**：设计文档 §3.2, §7, §14.2 + `server/waCrawler.cjs:371-462`, `server/services/waService.js:1-448`, `server/index.cjs:242`

**事实**：
- `processSessionCommands()` **只存在于 `waCrawler.cjs`**（第 371 行）
- 主 Express service（`server/index.cjs` → `waService.js`）**没有 `claimNextSessionCommand` 轮询**
- 测试机当前跑的 `test-wa-crm-1` 容器 `WA_SESSION_ID` 默认 `"3000"`（PORT fallback），登录为 Beau
- 对 `sid="3000"` 入队的 logout 命令**没有消费者**，主 service `waitForSessionCommandResult` 会在 15s 后抛错 → 路由返回 504

**影响**：设计文档 §14.2 把这个列为"开放问题"，但它实际上是 **Phase 1 的阻断前提**。不解决这个，整个 UI 对当前部署不可用。

**建议**：
- 把"主 service API-only + WA 功能下放到 crawler"从 §14 迁到 §2/§10，作为 **Phase 1 硬前置**
- 主 service 环境变量改为：`DISABLE_WA_SERVICE=true, DISABLE_WA_WORKER=true`
- Beau 当前 `/app/.wwebjs_auth/session-3000` 的登录态需要**迁移到** `wa-crawler-beau` 容器的 `session-beau`（涉及 volume 重命名）
- `sendViaSessionCommand` 入队前必须断言 `status.running && status.pid != null`，否则直接 409

---

### [CRITICAL-2] `appAuth.js` 没有 admin-only 守卫，`DELETE /auth` 会被 owner-locked token 调用

**位置**：设计文档 §6.1, §9 + `server/middleware/appAuth.js:195-221`, `server/index.cjs:242`

**事实**：
- `appAuth.js` 导出 `getLockedOwner/matchesOwnerScope/sendOwnerScopeForbidden`，但**没有 `requireAdminOnly` / `requireNonScoped`**
- `/api/wa` 整个命名空间只挂了 `requireAppAuth`
- 设计文档 §9 声明 "clear session: admin 限定"，但 §6.1 没指定**enforcement point**
- 即使 handler 里手动检查 `getLockedOwner(req)`，未来重构容易丢失

**风险**：Beau 的 owner token 可以 `DELETE /api/wa/sessions/yiyun/auth` 把 Yiyun 的登录态整个干掉。

**建议**：
- 在 `appAuth.js` 加头等公民 `requireAdminOnly(req, res, next)` 并导出
- §6.1 的 `DELETE /auth` 路由明确标注挂 `requireAdminOnly` middleware
- 角色判断用 `req.auth.role === 'admin'`，**不用** `!getLockedOwner()`（见 HIGH-1）

---

## High Findings

### [HIGH-1] service-role token 会被当成 admin

**位置**：设计文档 §9 + `server/middleware/appAuth.js:91-102`

`buildTokenEntries` 注册的 internal service token 是 `owner: null, role: 'service'`。`getLockedOwner(req)` 对它返回 `null`，所以 "admin == 不是 owner-locked" 的判定会让 service caller 通过所有破坏性端点。

**建议**：显式要求 `req.auth.role === 'admin'`；§9 权限表里把 `service` 单列一行。

### [HIGH-2] restart 命令的 "destroy + initialize" 不能在单次 command 迭代里同步做完

**位置**：设计文档 §7 + `server/services/waService.js:143-175, 177-263, 422-434`

- `waService.js` 内部用 `scheduleReconnect` 异步调度重连，只暴露 `start()/stop()`
- 没有 `restartClient()` 返回 Promise 等到 `ready` 或 `failed`
- 在 `processSessionCommands` 里 open-code `destroy(); initialize();` 会把 crawler 阻塞 30+s，`commandInFlight` 锁住其它命令
- `getClient()` 返回内部引用——`initClient()` 换掉后 crawler 闭包拿到的是旧的

**建议**：在 `waService.js` 新增 `async restartClient()` 返回 ready/failed Promise，带独立超时。`processSessionCommands` 只调这个，不要自己拼装。

### [HIGH-3] `clear_auth` 的 `rm -rf` 会和 LocalAuth 文件句柄撞车

**位置**：设计文档 §7 + `server/services/waService.js:60, 197-203`

- `whatsapp-web.js` 的 `LocalAuth` 持有 `SESSION_DIR` 下的 fd
- `destroy()` 之后立刻 `rmSync` 在 Linux 上会留下孤儿 `.ldb` 或 Chromium 的 `SingletonLock` 文件
- 下次 `initialize()` 就会报 "Browser is already running"——这正是 §12 想防止的

**建议**：
1. `destroy()` 后等 `client.pupBrowser?.process?.()` 真正 exit
2. 显式删除 `${SESSION_DIR}/SingletonLock`
3. 或者先 `mv` 到带时间戳的 trash 目录，异步 rm

### [HIGH-4] 同步 45s 超时会被 Cloudflare 524 / nginx 切

**位置**：设计文档 §6.1 + `server/services/waIpc.js:135-151`

- `waitForSessionCommandResult` 250ms 轮询到 45s
- Cloudflare 默认 524 超时 100s；nginx `proxy_read_timeout` 常见 60s
- 用户同时点 3 个 session 的 restart 会吃光并发连接

**建议**：
- 改为 **202 Accepted + cmdId** 语义：立即返回 `{ok:true, command_id}`
- 前端用 `GET /api/wa/sessions/:sid/commands/:cmdId` 轮询结果
- 至少要把 `req.setTimeout` 设到 60s 以上，在文档里标明 Cloudflare / nginx 超时底线

### [HIGH-5] `session_id` 校验太弱，路径参数会污染兄弟目录

**位置**：设计文档 §6.3 + `server/services/waIpc.js:14-18`

`sanitizeSessionId` 把非法字符**静默替换为 `_`**，不是拒绝。如果路由先 `ensureSessionDirs(req.params.sid)` 再查 registry，任何 404 都会**先创建** `commands/xxx/pending`、`processing`、`results/xxx`。长此以往垃圾目录累积；§6.3 的 404 分支永远不会触发。

**建议**：§6.3 必须规定：`sanitize(sid) === sid` **且** `sid` 在 `getSessionRegistry()` 返回中，否则 400，在触碰 IPC 前校验。

---

## Medium Findings

### [MEDIUM-1] §5 状态机与 `buildSessionStatus` 实际输出不完全对齐

**位置**：设计文档 §5 + `server/services/waSessionRouter.js:279-308`

- `buildSessionStatus` 已经在 `running:false` 时强制 `ready:false, hasQr:false`——所以 "stale" 判定会吞掉 `awaiting_qr`，这是想要的，但要写清楚
- 顶层**没有** `clientError` 字段，只有 `error`（派生）和 `worker.clientError`（grep 发现 `waWorker.getProgress` 并不产生这个 key）

**建议**：Phase 1 启动前先 snapshot 真实 `/api/wa/sessions` 返回，逐字段核对来源，重做 §5 表格。

### [MEDIUM-2] 现有的 `session syncing` 守卫会把 control 命令挡住

**位置**：设计文档 §6.1 + `server/services/waSessionRouter.js:310-321`

`sendViaSessionCommand` 对 `audit_recent_messages` 在 `worker.phase === 'sync'` 时返回 `{ok:false, error:'session syncing'}`。用户在初次 `syncHistory` 期间 restart，会卡在 pending 几分钟。

**建议**：给新 command 加 `priority: 'control'`，绕过 syncing 守卫或插队。

### [MEDIUM-3] `/api/wa/qr` 没有 `Cache-Control: no-store`

**位置**：设计文档 §12 + `server/routes/wa.js:619-644`

handler 不设缓存头，Cloudflare 可能按默认策略缓存。§12 只一句"加 header"——应作为显式实现任务列出。

### [MEDIUM-4] `processSessionCommands` 没法单测

**位置**：设计文档 §11.2 + `waCrawler.cjs:464-480`

`main()` eager 调用 `startWaService() + startWaWorker`，`processSessionCommands` 强依赖模块级 `waService` 单例。没有 Puppeteer 不可能启动。

**建议**：抽出 `server/services/sessionCommandProcessor.js`，接受 `{sendMessage, sendMedia, logout, destroy, reinitialize}` 作为依赖注入。当前 `waCrawler.cjs` 已约 517 行，再加代码会逼近 CLAUDE.md "file <800 lines" 红线。

### [MEDIUM-5] owner-scope 用户看到主 service 的 `"3000"` session 没特殊处理

**位置**：设计文档 §8.1 + `server/services/waSessionRouter.js:161-168, 191-214`

`getSessionRegistry()` 默认 target 是 `beau/yiyun/youke/jiawen`。Beau 的 owner token 只能看 `session_id=beau`，而测试机真跑的是 `"3000"`。用户侧看到**空列表**。

**建议**：§5 加第 6 态 `not_deployed`——registry 有这个名字但 `readSessionStatus()` 返回 null。

---

## Low Findings

### [LOW-1] `/app/.wwebjs_auth` 路径硬编码

§7 用绝对路径 `/app/.wwebjs_auth/session-<sid>`，但 `WA_AUTH_ROOT` 是可配置的，开发环境 fallback 到 `../../.wwebjs_auth`。应通过 `resolveAuthRoot()` 解析。

### [LOW-2] 返回 body 里不该带 `state`

§6.1 返回 `{state:"initializing"}` 会和前端 `/sessions` 轮询产生 2s 的短暂不一致（`statusTimer` 2s 间隔）。建议让前端完全依赖 `/sessions` 派生状态。

### [LOW-3] §11.4 的 grep 验收点规则不清楚

"Grep `/api/wa/qr` 确认没遗漏" —— 没说是"禁止孤儿 ref"还是"所有 ref 必须走 `fetchWaAdmin`"。实施前补全措辞。

---

## Open Questions for Author

1. **§14.2 主 service 归属必须拍板**：
   (a) 主 service API-only（`DISABLE_WA_SERVICE=true`）
   (b) 主 service 重命名为 `WA_SESSION_ID=beau` 并自己跑 `processSessionCommands`（需要大改 `index.cjs`）
   **没这个结论 Phase 1 无法启动**。
2. **admin 守卫落点**：per-route `requireAdminOnly` middleware 还是 handler 内分支？写到 §6.1 里。
3. **卡住的 restart 如何取消**：45s 超时返回 504 但 crawler 仍在 init 中，后续 restart 会排队。需要 "abort stuck command" 路径吗？
4. **syncing 期间的 control command**：§6.1 前置是否绕过 `worker.phase === 'sync'` 守卫？
5. **Volume 迁移 runbook**：从当前 `wa_crm_wwebjs_auth`（含 `session-3000`）迁到 4 个 per-owner volume，不重扫的路径（§10 需要独立一节）。
6. **并发控制**：两个 admin tab 同时点 restart beau，当前 `commandInFlight` 只串行化单 crawler，第二条会在第一条还没完成时抢到。要不要路由层幂等锁或请求级去重？
7. **前端单测工具**：§14.1 node:test vs Vitest，Phase 2 之前必须定。

---

## 必须更新到 v2 设计文档的点

Phase 1 启动前，文档至少要做这些改动：

1. §2 补一条硬约束：**"主 service API-only 是 Phase 1 前置条件"**
2. §5 的状态表补 `not_deployed` 第 6 态；字段名与真实 `/sessions` 返回核对
3. §6.1 改为 **202 Accepted + cmdId** 异步模式，附 `GET /commands/:cmdId` 查询端点
4. §6.1 每个端点显式标 `requireAppAuth + requireAdminOnly`（DELETE）
5. §7 用 `restartClient()` 抽象替代"destroy + initialize"伪代码
6. §7 `clear_auth` 路径用 `resolveAuthRoot()`，并说明 `SingletonLock` 清理
7. §10 新增独立小节：**volume 迁移 runbook**
8. §11 加一条硬门禁：**不要在 `waCrawler.cjs` 里加 command 分支，抽到 `sessionCommandProcessor.js`**
