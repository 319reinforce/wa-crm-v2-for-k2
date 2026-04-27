# WA Sessions Manager — 设计文档

> 状态：Draft v2（已吸收 code review 意见）
> 作者：AI Agent + 运维
> 目标读者：后端 / 前端 / 运维
> 范围：Web UI 多 owner WA session 管理；MVP 聚焦扫码、登出、重启、清空四个动作。

---

## 0. v1 → v2 变更摘要

收敛 review 后四个关键决策：

| 决策 | 选择 |
|---|---|
| 主 service 归属 | **纯 API**（`DISABLE_WA_SERVICE=true, DISABLE_WA_WORKER=true`）；Beau 登录态迁到 `wa-crawler-beau` |
| HTTP 返回语义 | **202 Accepted + cmdId** 异步模式，前端轮询命令结果 |
| 前端单测工具 | 沿用 `node --test`（`tests/**/*.test.mjs`） |
| Volume 迁移策略 | 一次性改名 + 保留现有 Beau 登录，不重扫 |

此外补充三条默认值：
- **卡住 restart 处理**：MVP 不提供 "abort stuck command"；超时返回后前端提示"稍后重试"，下一条 command 会覆盖
- **admin 守卫落点**：per-route middleware `requireAdminOnly`（新增到 `appAuth.js`）
- **并发控制**：路由层按 `sid` 的 in-flight 锁（同一 sid 同时只允许一条 control command 入队）

---

## 1. 背景

当前 `test-wa-crm-1` 通过 `moras-composer` 部署到测试环境。容器内只跑了一个主 service，`/app/.wwebjs_auth/session-3000/` 登录了 Beau。终端 `qrcode-terminal` 只能打印这一个 session 的 QR。

业务上需要 **Beau / Yiyun / Jiawen / WangYouKe** 四个 owner 同时在线。CI/CD 化之后容器会被频繁重建，扫码流程必须：

1. 登录态沉淀到持久化 volume，CI pull + 重建容器**不需要重扫**。
2. 首次扫码是运维 bootstrap 动作，通过 Web UI 完成，不依赖 SSH 终端。
3. 掉线重扫同样通过 Web UI 完成，不重建容器。
4. owner-scoped token 只能看/操作自己 scope 内的 session。

前端当前**完全没有 QR 扫码 UI**。后端仅有 `GET /api/wa/qr` 和 `/api/wa/status`，缺少 logout / restart / clear_auth 的操作端点。本文档定义补齐方案。

---

## 2. 核心决策

| # | 决策 | 备注 |
|---|---|---|
| D1 | 入口放独立页面 `/settings/wa-sessions` | 侧边栏新增 "📱 WA 会话" 菜单项 |
| D2 | MVP 只支持 compose 预定义 owner 名单 | 不做 "动态新建 session" |
| D3 | 破坏性操作用 Modal 二次确认 + 输入 `session_id` 原文 | 防误操作 |
| D4 | 主 service ↔ crawler 通信走现有文件 IPC 队列 | 不引入 Docker API、不挂 docker.sock |
| D5 | 登录态每个 owner 一个 named volume | `wa_crm_session_<owner>`，CI 不 touch |
| D6 | QR 轮询周期 2s，最大 5 min 自动停 | 保护后端 Puppeteer 资源 |
| **D7** | **主 service API-only，不再跑 waService** | **Phase 1 硬前置**。所有 WA 功能下放给 crawler |
| **D8** | **HTTP 接口采用 202 Accepted + cmdId 异步模式** | 规避 Cloudflare 524 / nginx proxy_read_timeout |
| D9 | 破坏性操作用 `requireAdminOnly` middleware 守卫 | `role === 'admin'`，排除 `service` 和 owner-locked |
| D10 | 路由层用 in-flight 锁避免并发重复入队 | 同 sid 的 control command 只允许一条在途 |

---

## 3. 现有代码与基础设施盘点

### 3.1 IPC 队列（`server/services/waIpc.js`）

- 存储：文件系统 `{/app,..}/.wa_ipc/`
  ```
  .wa_ipc/
  ├── status/<sid>.json
  ├── commands/<sid>/pending/<cmdId>.json
  ├── commands/<sid>/processing/<cmdId>.json
  └── results/<sid>/<cmdId>.json
  ```
- 原子性：tmp + rename；多 crawler 抢占同一命令时只有一个 `rename` 成功
- 提交 API：`createSessionCommand(sid, payload)`
- 等待 API：`waitForSessionCommandResult(sid, cmdId, timeoutMs=20000)`
- 现有 command types：`send_message` / `send_media` / `audit_recent_messages`

**v2 注意点**：
- `sanitizeSessionId` 会**静默替换非法字符为 `_`**（见 `waIpc.js:14-18`）。必须在路由层做严格 sid 校验后才调，不能直接把 `req.params.sid` 喂进去。
- `ensureSessionDirs` 会创建目录，校验失败前不要调用。

### 3.2 现有 HTTP API（`server/routes/wa.js`）

| 方法 | 路径 | 用途 |
|---|---|---|
| GET | `/api/wa/qr` | 返回 `data:image/png;base64,...`，404 无 QR 时 `{"ok":false,"message":"无可用二维码"}` |
| GET | `/api/wa/status` | 主 service 单 session 状态 |
| GET | `/api/wa/sessions` | 所有 session 聚合状态 |
| POST | `/api/wa/send` / `/send-media` | 发消息 |
| POST | `/api/wa/reconcile-contact` / `/sync-contact` / `/replace-contact` | 回填/同步消息 |

**v2 注意点**：
- 现有 GET `/api/wa/qr` 不设 `Cache-Control`，可能被 Cloudflare 默认策略缓存。需要补 `Cache-Control: no-store, private`。

### 3.3 鉴权（`server/middleware/appAuth.js`）

- 两种 token：
  - admin 级：`API_AUTH_TOKEN` / `CRM_ADMIN_TOKEN` / `WA_ADMIN_TOKEN` → `role: 'admin'`
  - owner 级：`BEAU_ACCESS_TOKEN` / `YIYUN_ACCESS_TOKEN` / `JIAWEN_ACCESS_TOKEN` → `role: 'owner'`
  - 服务间：internal service token → `role: 'service'`
- 传递方式：`Authorization: Bearer <token>` 或 Cookie `wa_crm_app_auth`
- 辅助工具：`getLockedOwner(req)` / `matchesOwnerScope(req, owner)` / `sendOwnerScopeForbidden(res, lockedOwner)`

**v2 新增 helper**（本次实施）：

```js
function requireAdminOnly(req, res, next) {
  if (req.auth?.role === 'admin') return next();
  return res.status(403).json({ ok: false, error: 'Forbidden: admin role required' });
}
```

**关键区分**：`role === 'admin'` ≠ "not owner-locked"。`service` role 也不是 owner-locked，但不应具备破坏性操作权限。

### 3.4 waService 抽象缺口

当前 `server/services/waService.js` 只提供 `start() / stop() / getStatus() / getQrValue()`。**没有** `restartClient()` 返回 Promise 等待 ready。v2 实施需要新增：

```js
// waService.js 新增导出
async function restartClient({ timeoutMs = 30000 } = {}) {
  // 1. await currentClient.destroy()
  // 2. await waitPuppeteerExit()
  // 3. initClient() → 新 client
  // 4. resolve on 'ready', reject on 'auth_failure' 或超时
}
```

### 3.5 前端基础设施

- `src/utils/waAdmin.js`：`fetchWaAdmin(url, opts)` 自动带 Bearer
- `src/utils/appAuth.js`：`getAppAuthToken/getAppAuthScopeOwner/isAppAuthOwnerLocked`
- `src/components/AuthSessionControls.jsx`：顶栏显示 owner scope、切换 token

---

## 4. 用户故事

| 角色 | 场景 | 频次 |
|---|---|---|
| admin | 首次部署后给 4 个 owner 扫码 bootstrap | 低，每环境一次 |
| admin | 某 owner 掉线后重扫 | 低频 |
| admin | Puppeteer 卡死时 restart crawler | 低频 |
| admin | Session 需要强制清空重扫（换号） | 极低频 |
| owner-locked | 只能扫自己的号 | 按需 |
| 只读观察者 | 看整体健康 | 高频 |

---

## 5. 状态机（6 态）

**前端必须把后端各种字段归一成 6 个状态**：

| 前端状态 | 判定条件（按优先级从上到下） | 色 | 主 CTA |
|---|---|---|---|
| `not_deployed` | registry 有此 sid 但 `readSessionStatus(sid) === null`（没有任何心跳历史） | 浅灰 | 提示 "运维未部署 crawler" |
| `ready` | `running === true && ready === true && worker.clientReady === true` | 绿 | 登出 |
| `awaiting_qr` | `running === true && hasQr === true` | 黄 | 展示 QR 抽屉 |
| `initializing` | `running === true && ready === false && hasQr === false && error == null` | 蓝 | 禁用 + spinner |
| `stale` | `running === false` 或 `error === 'Session heartbeat stale'` | 深灰 | 重启 |
| `errored` | 其它非空 `error` | 红 | 重启 / 复制错误 |

**实施前校验**：Phase 1 结束后，从真实 `/api/wa/sessions` 拉一次返回 snapshot，逐字段核对来源再锁定 `deriveSessionState()` 的判定（防止出现 `worker.clientError` 这种不存在的字段名）。

纯函数签名（`src/utils/waSessionState.js`）：

```js
/**
 * @typedef {Object} RawSession
 * @property {string} session_id
 * @property {boolean} [running]
 * @property {boolean} [ready]
 * @property {boolean} [hasQr]
 * @property {string|null} [error]
 * @property {Object} [worker]
 * @property {boolean} [worker.clientReady]
 */

/**
 * @param {RawSession|null} raw - null 表示 not_deployed
 * @returns {'not_deployed'|'ready'|'awaiting_qr'|'initializing'|'stale'|'errored'}
 */
function deriveSessionState(raw) { /* ... */ }
```

必须单测覆盖 6 态 + 12 个边界（all fields undefined / worker 缺失 / error 空串 / ready 为 truthy 非 bool etc.）。

---

## 6. 后端 API 设计

### 6.1 新增命令端点（异步模式）

所有端点：
- 需要 `Authorization: Bearer <token>`
- 挂 `requireAppAuth` middleware
- 破坏性操作额外挂 `requireAdminOnly`
- 返回 `202 Accepted` + `command_id`，**不再同步 wait 结果**

#### POST `/api/wa/sessions/:sid/logout`

- 权限：`requireAppAuth`；owner-locked 必须 `sid === getLockedSessionId(req)`
- 前置校验（入队前，顺序）：
  1. `sid` 经 `sanitizeSessionId` 后等于原值（否则 400）
  2. `sid` 在 `getSessionRegistry()` 中（否则 404）
  3. `readSessionStatus(sid)?.running === true && pid != null`（否则 409）
  4. 该 sid 没有 in-flight control command（否则 409 `command already running`）
- 动作：入队 `{ type: 'logout', priority: 'control' }`
- 返回：
  ```json
  HTTP 202
  {
    "ok": true,
    "session_id": "beau",
    "command_id": "1726580000000-abcd1234",
    "poll_url": "/api/wa/sessions/beau/commands/1726580000000-abcd1234"
  }
  ```

#### POST `/api/wa/sessions/:sid/restart`

- 权限：同上
- 前置：同上
- 动作：入队 `{ type: 'restart', priority: 'control' }`
- 返回：同 logout

#### DELETE `/api/wa/sessions/:sid/auth`

- 权限：`requireAppAuth` + **`requireAdminOnly`**
- 前置：同 logout，额外要求**请求体** `{ "confirm_sid": "<sid>" }` 与路径 sid 完全相同（防止前端 bug）
- 动作：入队 `{ type: 'clear_auth', priority: 'control' }`
- 返回：同 logout

#### GET `/api/wa/sessions/:sid/commands/:cmdId`

命令状态轮询端点。

- 权限：同该 command 的入队端点
- 查找顺序：
  1. `results/<sid>/<cmdId>.json` 存在 → 返回结果，**删除文件**（只允许一次消费）
  2. `processing/<cmdId>.json` 存在 → `{ state: 'processing' }`
  3. `pending/<cmdId>.json` 存在 → `{ state: 'pending' }`
  4. 都不存在 → 404 `command_not_found`（可能已被消费或超期清理）
- 前端策略：
  - 轮询间隔 1s
  - 2 分钟后仍 pending/processing → 提示"卡住"，给"强制刷新"按钮（前端自行清空 cmdId 状态）
  - `state === 'processing'` 时间过长（>60s）同样提示

### 6.2 现有端点改动

- `GET /api/wa/qr` 补 `Cache-Control: no-store, private`
- 其它端点不动

### 6.3 错误码约定

| HTTP | 条件 | Body |
|---|---|---|
| 202 | 命令成功入队 | `{ ok:true, session_id, command_id, poll_url }` |
| 400 | sid 非法字符 / body 缺 `confirm_sid` / `confirm_sid` 与路径不符 | `{ ok:false, error:'...' }` |
| 401 | 无 token 或 token 未知 | `{ error:'Unauthorized' }` |
| 403 | owner-locked 越权 / 非 admin 调 DELETE auth / service role 调破坏性操作 | `{ ok:false, error:'Forbidden: ...' }` |
| 404 | sid 不在 registry；或 cmdId 不存在 | `{ ok:false, error:'...' }` |
| 409 | session `running:false`；或同 sid 有 in-flight control command | `{ ok:false, error:'...' }` |

---

## 7. Crawler 新 command type

### 7.1 必须抽出独立模块（阻断点）

`waCrawler.cjs` 目前已经较大。**禁止**直接在 `waCrawler.cjs` 的 `processSessionCommands` 里 open-code 三个新分支。必须抽出：

```
server/services/sessionCommandProcessor.js
```

接口：

```js
/**
 * @typedef {Object} Deps
 * @property {(phone, text) => Promise<Result>} sendMessage
 * @property {(phone, opts) => Promise<Result>} sendMedia
 * @property {(auditOpts) => Promise<Result>} auditRecentMessages
 * @property {() => Promise<void>} logout
 * @property {(opts) => Promise<void>} restartClient
 * @property {() => Promise<void>} clearAuth
 * @property {() => string} getAuthRoot
 */

function createCommandProcessor(deps) {
  return async function processClaimed(claimed) { /* dispatch by payload.type */ };
}
```

`waCrawler.cjs` 只负责：
1. 初始化 deps（调用 `waService` 和 `fs`）
2. 调 `claimNextSessionCommand` 拿 claimed
3. 交给 `processClaimed(claimed)` 执行
4. 调 `completeClaimedCommand(claimed, result)` 写回

这样 `processClaimed` 纯逻辑可被 `node --test` 覆盖。

### 7.2 三个新 command 的处理

#### `type: 'logout'`
```
await deps.logout();        // client.logout()，保留 auth 文件
publishStatus({ ready: false, hasQr: false });
→ complete({ ok: true })
```

#### `type: 'restart'`
```
await deps.restartClient({ timeoutMs: 30000 });
  // 内部：destroy + 等 Puppeteer exit + initialize + 等 ready
publishStatus();
→ complete({ ok: true })
```

> `restartClient` 必须是 waService 新增的 Promise-based API（见 §3.4）。**不要**在 crawler 闭包里拼装 `destroy + initialize`——会拿到过时的 client 引用。

#### `type: 'clear_auth'`
```
try {
  await deps.logout();       // 忽略失败
} catch (_) {}
await deps.destroyClient();
await waitPuppeteerExit();   // 等 pupBrowser 进程真正退出

const authRoot = deps.getAuthRoot();   // 来自 resolveAuthRoot()
const sessionDir = path.join(authRoot, `session-${WA_SESSION_ID}`);
const trashDir = `${sessionDir}.trash-${Date.now()}`;

fs.renameSync(sessionDir, trashDir);    // 原子转移到垃圾堆
// 异步清理 trash（不阻塞 command）
setTimeout(() => rmSync(trashDir, { recursive: true, force: true }), 5000);

// 显式清掉 Chromium lock（防止残留）
try { fs.unlinkSync(path.join(authRoot, `session-${WA_SESSION_ID}`, 'SingletonLock')); } catch (_) {}

await deps.restartClient();   // 重新初始化 → 产出新 QR
publishStatus();
→ complete({ ok: true })
```

**路径解析**：统一用 `resolveAuthRoot()`（默认 `WA_AUTH_ROOT || path.join(__dirname, '../../.wwebjs_auth')`），不要硬编码 `/app/.wwebjs_auth`。

### 7.3 绕过 syncing 守卫

control 命令（logout/restart/clear_auth）的 `priority === 'control'`。`sendViaSessionCommand` / `sessionCommandProcessor` 必须跳过现有 "session syncing" 短路（`waSessionRouter.js:312-321` 只对 `audit_recent_messages` 生效，不影响新 command，但 processor 内部**不要**在 worker.phase 非 idle 时跳过 control 命令）。

### 7.4 错误处理契约

任何步骤失败都必须 `completeClaimedCommand(claimed, { ok: false, error: err.message })`，否则 result 文件永远不出现，前端轮询永远 404。用 `try { ... } catch { complete fail }` 包裹整个 dispatch body。

---

## 8. 前端页面设计

### 8.1 路由与入口

- 路由：`/settings/wa-sessions`（在 `App.jsx` 挂载）
- 入口：主布局侧边导航新增 "📱 WA 会话"
- 可见性：token 存在即可见；进入页面后按 owner scope 过滤列表

### 8.2 布局

```
┌────────────────────────────────────────────────────────┐
│  WA 会话管理                     [+ 新建 session*]      │
├────────────────────────────────────────────────────────┤
│  筛选: [全部 ▼] [健康 ▼]        自动刷新: ● 5s          │
├──┬──────────┬──────────┬─────────┬──────────┬─────────┤
│  │ Owner    │ Session  │ 账号     │ 状态     │ 操作    │
├──┼──────────┼──────────┼─────────┼──────────┼─────────┤
│●│ Beau     │ beau     │ +184... │ ✓ 就绪    │ 登出 … │
│◐│ Yiyun    │ yiyun    │ +861... │ ⚠ 待扫码  │ 扫码 …  │
│─│ Jiawen   │ jiawen   │ -       │ – 未部署  │ 联运维   │
│◐│ WangYouKe│ youke    │ +861... │ ◷ 心跳陈旧│ 重连 … │
└──┴──────────┴──────────┴─────────┴──────────┴─────────┘
```

\* `[+ 新建 session]` 在 MVP 禁用（灰色），tooltip 提示 "请联系运维在 compose 中添加 service"。

点击行 → 右侧抽屉展开：
- 当前状态徽章 + 账号 + pushname
- QR 面板（若 `awaiting_qr`）
- 错误详情（若 `errored`）
- crawler 运行时信息：pid / uptime / `api_base` / 最近心跳时间
- 操作按钮组：登出 / 重启 / 清空 session（admin 可见）
- 当前 in-flight command（若有）+ 轮询 progress

### 8.3 组件拆分

```
src/pages/WASessionsPage.jsx                    顶层，组合路由和全局状态
src/components/wa-sessions/
  ├── SessionTable.jsx                          列表
  ├── SessionStatusBadge.jsx                    纯展示，接收归一后 state
  ├── SessionDetailDrawer.jsx                   右侧抽屉
  ├── QRScanPanel.jsx                           QR 图 + 倒计时 + 刷新计数
  ├── SessionActionsMenu.jsx                    操作下拉
  ├── ConfirmDestructiveModal.jsx               破坏性操作二次确认
  └── CommandProgressRow.jsx                    in-flight command 进度条

src/hooks/
  ├── useWaSessions.js                          轮询 /api/wa/sessions，默认 5s
  ├── useWaQr.js                                轮询 /api/wa/qr，2s + 指数退避
  ├── useSessionCommand.js                      POST 后轮询 commands/:cmdId，1s
  └── useAdminRole.js                           从 token scope 派生 isAdmin

src/utils/waSessionState.js                     deriveSessionState 纯函数
```

### 8.4 QRScanPanel 行为

- 初次打开：立即请求 `/api/wa/qr?session_id=<sid>`；展示 QR + "QR 有效期约 20s"
- 后续每 2s 轮询：
  - 200 → 更新 `<img src>`（WA 端每 ~20s 刷新 QR）
  - 404 → 并发请求 `/api/wa/sessions/:sid`：
    - `state === 'ready'` → "扫码成功" 动画 2s → 自动关抽屉
    - 其它 → 继续等
  - 401/403 → 提示重新登录
- 5 min 超时：停止轮询，展示 "继续等待" 按钮
- unmount：`AbortController.abort()` 取消 inflight

### 8.5 ConfirmDestructiveModal 行为

| 动作 | 文案 | 确认方式 |
|---|---|---|
| 登出 | "将断开 `<owner>` 当前 WA 连接。确认？" | 勾选 + 点按钮 |
| 重启 | "将销毁 Puppeteer 并重新初始化，预计 30s。确认？" | 勾选 + 点按钮 |
| 清空 session | "将删除 `.wwebjs_auth/session-<sid>` 全部文件，**不可逆**。输入 `<sid>` 确认：" | 键入 sid 原文才可提交 |

键入 sid 后，前端在请求 body 带 `{ "confirm_sid": "<sid>" }`，后端 `requireAdminOnly` + 二次校验一致。

### 8.6 命令进度 UX

`useSessionCommand` 成功入队后：
- 乐观更新：列表那一行徽章立即变 `initializing` 蓝
- 每 1s 拉 `poll_url`
- `state === 'processing'` → "执行中..." spinner
- `state === 'pending'` → "等待 crawler 消费..."
- 结果来了：
  - `ok: true` → toast "操作成功"，继续依赖 `/sessions` 轮询派生最终状态
  - `ok: false, error: "..."` → toast 红色 + 具体错误
- 2 min 无结果 → toast "命令卡住，请刷新页面查看"

---

## 9. 权限规则

| 能力 | admin | owner-locked | service |
|---|---|---|---|
| 进入页面 | ✓ | ✓ | ✗（不会用前端） |
| 看全部 session 列表 | ✓ | ✗（只看自己） | — |
| 触发扫码 / 刷新 QR | ✓ 任意 | ✓ 仅本人 | ✗ |
| 登出 | ✓ 任意 | ✓ 仅本人 | ✗（挂 `requireAdminOnly`? 否。owner 合法）|
| 重启 | ✓ 任意 | ✓ 仅本人 | ✗ |
| 清空 session | ✓ | **✗** | ✗ |
| 新建 session | ✓（MVP 禁用） | ✗ | ✗ |

**middleware 挂载**（路由层显式）：
- logout / restart：`requireAppAuth`（owner-locked 可过）
- clear_auth：`requireAppAuth` + `requireAdminOnly`

owner-locked 不可见按钮必须前端 hide，不要让用户点了被 403（体验差）。

---

## 10. 部署层改动

### 10.1 主 service 角色变更（Phase 1 硬前置）

`moras-composer/system/docker-compose.test.yml` 里 `wa-crm` 服务的 env 改动：

```yaml
wa-crm-api:
  # 原先 test-wa-crm-1
  environment:
    DISABLE_WA_SERVICE: "true"    # 关键
    DISABLE_WA_WORKER: "true"     # 关键
    # 其它不变
```

这条改动一旦生效，`test-wa-crm-1` 容器不再自己跑 waService，原本登录的 Beau session（`session-3000`）**会立即离线**。所以必须在同一次改动里同时把 `wa-crawler-beau` service 起起来，并做 volume 迁移（§10.4）。

### 10.2 共享 IPC volume

```yaml
volumes:
  wa_crm_ipc:
```

主 service 和所有 crawler service 都挂 `/app/.wa_ipc`：

```yaml
wa-crm-api:
  volumes:
    - wa_crm_ipc:/app/.wa_ipc

wa-crawler-beau:
  volumes:
    - wa_crm_ipc:/app/.wa_ipc
    - wa_crm_session_beau:/app/.wwebjs_auth
```

### 10.3 crawler service 示例

```yaml
wa-crawler-beau:
  image: git.k2lab.ai/k2lab/whatsapp-mgr:test-latest
  command: ["node", "server/waCrawler.cjs"]
  environment:
    WA_SESSION_ID: beau
    WA_OWNER: Beau
    WA_API_BASE: http://wa-crm-api:3000
    WA_AUTH_ROOT: /app/.wwebjs_auth
    PUPPETEER_EXECUTABLE_PATH: /usr/bin/chromium
  env_file:
    - /home/dev/moras-composer/test/.env
  volumes:
    - wa_crm_ipc:/app/.wa_ipc
    - wa_crm_session_beau:/app/.wwebjs_auth
  shm_size: "1gb"
  restart: unless-stopped
```

### 10.4 Volume 迁移 runbook（保留 Beau 登录，一次性改名）

> 按当前运维变更标准执行：先备份、再改配置、最后验证；所有命令进日志。

**前置**：所有相关容器停机；备份当前 volume 快照。

```bash
# 0) 初始化日志
source /root/ops-logs/.session

# 1) 停相关容器
cd /home/dev/moras-composer/system
docker compose -f docker-compose.test.yml --env-file ../test/.env stop wa-crm
log_cmd "docker compose stop wa-crm" "停 wa-crm 做 volume 迁移" "done"

# 2) 备份旧 volume 到 tar（存 /home/dev/db-backups/）
TS=$(date +%Y%m%d-%H%M%S)
docker run --rm -v wa_crm_wwebjs_auth:/src -v /home/dev/db-backups:/dst \
  alpine tar czf /dst/wa_crm_wwebjs_auth-${TS}.tar.gz -C /src .
log_cmd "backup wa_crm_wwebjs_auth" "迁移前保险备份" "ok"

# 3) 创建新 volume
docker volume create wa_crm_session_beau
docker volume create wa_crm_session_yiyun
docker volume create wa_crm_session_jiawen
docker volume create wa_crm_session_youke
docker volume create wa_crm_ipc

# 4) 把 session-3000 拷到 wa_crm_session_beau（目录名改成 session-beau）
docker run --rm \
  -v wa_crm_wwebjs_auth:/src:ro \
  -v wa_crm_session_beau:/dst \
  alpine sh -c 'cp -a /src/session-3000/. /dst/session-beau/ && ls -la /dst'
log_cmd "cp session-3000 -> session-beau" "保留 Beau 登录态" "ok"

# 5) 改 compose（tmp + 校验 + 原子替换流程）
#    - wa-crm 加 DISABLE_WA_SERVICE/DISABLE_WA_WORKER=true
#    - 挂 wa_crm_ipc 到 wa-crm
#    - 新增 wa-crawler-beau/yiyun/jiawen/youke 四个 service
#    - volumes: 顶部声明五个新 volume
# （具体 diff 由实施阶段生成）

# 6) 起新服务
docker compose -f docker-compose.test.yml --env-file ../test/.env up -d \
  wa-crm-api wa-crawler-beau wa-crawler-yiyun wa-crawler-jiawen wa-crawler-youke
log_cmd "compose up crawlers" "起所有 crawler" "ok"

# 7) 验证
curl -H "Authorization: Bearer $TOKEN" \
  https://waaa.moras.ai/api/wa/sessions | jq '.sessions[] | {session_id, state, ready, hasQr}'
# 预期：beau ready:true（迁移成功）；yiyun/jiawen/youke awaiting_qr 或 initializing（首次启动）

# 8) 回滚（若 beau session 迁移失败）
#    docker compose down && docker volume rm wa_crm_session_beau
#    docker compose 回退到上一版 compose（用 .bak 原子恢复）
#    docker compose up -d wa-crm（恢复旧行为）
```

迁移验收：
- [ ] Beau session 未要求重扫（`ready:true` 直接可用）
- [ ] `docker volume ls | grep wa_crm_session_` 有 4 个新 volume
- [ ] `wa_crm_ipc` 被 5 个容器共同挂载（`docker inspect` 验证）
- [ ] `/api/wa/sessions` 返回 4 个 session（不再是以前的 stale 数据）
- [ ] 旧 volume `wa_crm_wwebjs_auth` 保留不删（观察一周确认无问题后再清理）

---

## 11. 测试策略

### 11.1 单元测试（Phase 1 必交付）

| 层 | 文件 | 覆盖点 |
|---|---|---|
| 纯函数 | `tests/unit/waSessionState.test.mjs` | 6 态 + 12 个边界输入 |
| 纯逻辑 | `tests/unit/sessionCommandProcessor.test.mjs` | dispatch 分发；每个 type 的成功 / 失败路径；错误必须调 complete fail |
| 后端 service | `tests/api/waSessionControl.test.mjs` | enqueue 成功 / in-flight 锁 / running 校验 / owner scope |
| 后端路由 | `tests/api/waSessionsRoutes.test.mjs` | 202/400/401/403/404/409 全覆盖；`requireAdminOnly` 独立测 |

**硬门禁**：
- `sessionCommandProcessor.js` 必须是纯函数模块，依赖通过参数注入；不能直接 `require('./waService')`
- `waCrawler.cjs` 的改动**只有** "调 processor 代替 inline dispatch"，不加新分支
- grep 全局 `rm -rf` 确认只出现在 clear_auth 路径
- grep `console.log` 确认无残留

### 11.2 集成测试

- 扩展 `scripts/test-smoke.cjs`
- 新增 smoke：mock crawler（不起 Puppeteer，只消费命令 + 写 result）→ 入队 logout → 验证 result 文件 + 路由 202/结果查询流

### 11.3 E2E（Phase 3）

Playwright：
1. admin 登录 → `/settings/wa-sessions`
2. 列表渲染 4 行
3. 对 `awaiting_qr` 行点"扫码" → QR 抽屉出现 → mock 后端 `/sessions` 返回 `ready:true` → 抽屉自动关
4. 对 `ready` 行点"登出" → Modal → 输入 sid（clear_auth 流）→ 202 → 轮询 poll_url → toast 成功
5. owner-locked token 看不到其它人的行；看不到 "清空 session" 按钮

### 11.4 自验证清单

- [ ] 新 endpoints 遵循 REST 规范（/sessions/:sid/:action）
- [ ] 所有数据库查询使用预处理语句（本次无 SQL 改动）
- [ ] 错误情况返回适当的 HTTP 状态码（见 §6.3）
- [ ] 改动最小且专注
- [ ] 无 `console.log` 残留
- [ ] Grep `api/wa/qr|api/wa/status|api/wa/sessions` 确认调用走 `fetchWaAdmin`，无裸 fetch
- [ ] `waCrawler.cjs` 增量 < 40 行（只改 dispatch 入口）
- [ ] `sessionCommandProcessor.js` < 400 行

---

## 12. 边界与陷阱

| 坑 | 对策 |
|---|---|
| QR 20s 自动刷新，用户还在扫 | 前端显示倒计时；<5s 变黄 |
| 多标签页同时轮询 | 天然独立；不特殊处理 |
| 同一 WA 号被两个 owner 扫（冲突） | 扫成功后对比 `account_phone` 与 `creators.wa_phone`，冲突时弹 warning |
| crawler 挂了但 `running:true` 还在 | `last_heartbeat` 新鲜度 < 90s 才算活；超过 → `stale` |
| Puppeteer "browser is already running" | `clear_auth` 流程里显式 `rename → trash + 异步 rm + 删 SingletonLock`；透传 `clientError` 到 UI |
| 网络断 | hook 指数退避 1s → 2s → 4s → 最大 10s，不死循环 |
| owner-locked 看到非本人 row | 后端 `getLockedOwner(req)` 天然过滤；前端不需特判 |
| Cloudflare 缓存 QR | `/api/wa/qr` 加 `Cache-Control: no-store, private` |
| 并发 restart 同 sid | 路由层 in-flight 锁（键 `control:<sid>`，TTL=60s）；第二次调 409 |
| 卡住的 restart | 45s 超时后 complete fail；前端 toast "请刷新页面查看"；下次 restart 正常 |
| CI 重建容器 | volume 保留；登录态不丢；对应 crawler 容器自动跑起来从 volume 恢复 |
| 主 service 迁到 API-only 当场 Beau 掉线 | volume 迁移 runbook（§10.4）在同一次维护窗口完成 |

---

## 13. 分期交付

| 阶段 | 交付 | 预计 | 硬前置 |
|---|---|---|---|
| Phase 0 | 当前状态：Beau 单号可用 | — | — |
| **Phase 1a** | `appAuth.js` 加 `requireAdminOnly` | 0.5 天 | — |
| **Phase 1b** | `waService.js` 加 `restartClient()` + `destroyClient()` | 1 天 | Phase 1a |
| **Phase 1c** | 抽 `sessionCommandProcessor.js` + 三个 command 实现 + 单测 | 1.5 天 | Phase 1b |
| **Phase 1d** | 新增 4 个路由 + in-flight 锁 + 路由单测 | 1 天 | Phase 1c |
| Phase 2 | 前端 `/settings/wa-sessions` 页 + QR 抽屉 + 所有 hook 和单测 | 3 天 | Phase 1 完成 |
| Phase 3 | E2E + 本文档正式化 + `BOT_INTEGRATION.md` 同步 | 1 天 | Phase 2 完成 |
| **Phase 4**（运维） | compose 改动 + volume 迁移 runbook 执行 | 0.5 天 | Phase 1 完成 |
| Phase 5（P3） | 动态"新建 session"（改 compose + 热起 service） | 未定 | 暂不做 |

**关键依赖**：Phase 2 可以在 Phase 4 之前开发（用 mock 数据跑起来），但**真正"在生产能扫码"需要 Phase 1 + Phase 4 都完成**。

---

## 14. 参考

- `server/services/waIpc.js` — IPC 队列实现
- `server/services/waSessionRouter.js` — `sendViaSessionCommand` 现有 caller
- `server/services/waService.js` — 主 WA client 生命周期（待加 `restartClient`）
- `server/waCrawler.cjs:371-462` — `processSessionCommands` 现有 command 处理
- `server/middleware/appAuth.js` — 鉴权与 owner scope（待加 `requireAdminOnly`）
- `server/routes/wa.js` — 现有 WA 路由集合
- `ecosystem.wa-crawlers.config.cjs` — 4 个默认 owner 的 crawler 模板
- `DEPLOY.md` — 多 session 抓取章节
- `AGENTS.md` — 项目级 Agent 入口
