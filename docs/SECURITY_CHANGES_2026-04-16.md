# Security Changes — 2026-04-16

## 背景

全量代码审核后，针对 P0 安全问题完成修复。

---

## 已修复（P0）

### 1. 本地鉴权绕过默认值反转
**文件：** `server/middleware/appAuth.js`

```js
// 改前：默认允许绕过（只要不显式设置 false）
const allowLocalBypass = process.env.LOCAL_API_AUTH_BYPASS !== 'false';

// 改后：默认禁止，需要显式开启
const allowLocalBypass = process.env.LOCAL_API_AUTH_BYPASS === 'true';
```

### 2. 删除 URL query string token 支持
**文件：** `server/middleware/appAuth.js`、`server/index.cjs`、`src/utils/appAuth.js`、`src/App.jsx`

`extractToken` 不再接受 `req.query.token`。现在鉴权来源只有两种：
- `Authorization: Bearer <token>` header（普通 API）
- 同源 `httpOnly` cookie（SSE / EventSource）

同时补上了 cookie 会话桥接：
- `POST /api/auth/login` 成功后写入 `httpOnly + SameSite=Strict` cookie
- `GET /api/auth/session` 在当前 token 校验通过后刷新 cookie
- `POST /api/auth/logout` 清理 cookie
- 前端删除 `buildAppAuthUrl` 的 query-token 拼接和 `consumeTokenFromUrl` 的地址栏 token 接收
- `EventSource('/api/events/subscribe')` 改为直接走同源 cookie

这样 URL、浏览器历史、Referer 中都不再携带 token。

### 3. internalAuth 移除 admin token 回退
**文件：** `server/utils/internalAuth.js`

从 `INTERNAL_SERVICE_TOKEN_ENV_KEYS` 中移除了 `API_AUTH_TOKEN`、`CRM_ADMIN_TOKEN`、`WA_ADMIN_TOKEN`，防止 admin token 以 `role: 'service'` 被注册。

### 4. audit log 敏感字段脱敏
**文件：** `server/middleware/audit.js`

新增递归版 `sanitizeAuditValue` 与 `sanitizeAuditRecordId`：
- `wa_phone`、`phone`、`client_id`、`record_id`、`password`、`token`、`secret` 会被统一替换为 `[REDACTED]`
- 数组 / 嵌套对象内的敏感字段也会继续递归脱敏
- phone-like 的 audit `record_id` 在写入时不再原样落库
- `GET /api/audit-log` 返回前会再做一层脱敏，避免历史脏数据继续泄露

### 5. LIMIT/OFFSET 参数化
**文件：** `server/routes/sft.js`、`server/routes/events.js`、`server/routes/audit.js`、`server/services/sftService.js`、`db.js`

原先遗漏的 `server/routes/audit.js` 内 generation log `LIMIT` 片段也已改为占位符参数化。

---

## 顺带完成的清理项（P1/P2）

- `buildTokenEntries` 加了模块级缓存 `_tokenEntriesCache`，避免每次请求重建
- `sendOwnerScopeForbidden` 提取到 `appAuth.js` 并 export，消除重复定义
- `events.js` DELETE 事件改用 `db2.transaction()` 包裹（P1-6）
- `sft.js` review 操作补充了 `writeAudit` 调用（P1-5）
- `.env.example` 中 `LOCAL_API_AUTH_BYPASS` 默认值已改为 `false`
- 当前仓库未新增正式 `lint` 命令，因此这里不再使用 “linter” 表述

---

## 后续补修（P1）

- `POST /api/events/broadcast` 显式挂载 `jsonBody`，allowlist 校验不再依赖全局中间件注册顺序
- `GET /api/creators` 默认不返回 `wa_phone`；只有显式传 `?fields=wa_phone` 且使用 admin/service token 时才返回
- `sft.js` 的创建、列表、pending、review、stats、trends、feedback 逻辑已收口到 `server/services/sftService.js`，路由层保留 scope/audit/export 组合逻辑
- `server/routes/audit.js` 的 generation log 查询移除动态 `LIMIT` 片段；有限列表使用固定 `LIMIT ?` 语句，无上限场景走单独查询分支
- `PUT /api/creators/:id` 与 `PUT /api/creators/:id/wacrm` 的 audit 写入改为白名单字段，避免将整包 `req.body` 直接落库

---

## 追加记录（2026-04-16）

### 1. `audit.js` 动态 LIMIT 彻底清理
**文件：** `server/routes/audit.js`

- 新增 `normalizeGenerationRowLimit`
- generation log 查询改为两条固定 SQL 路径：
  - 有 limit 时使用 `LIMIT ?`
  - 无 limit 时不拼接任何 `LIMIT` 片段
- 不再保留 `const limitSql = ... LIMIT ${...}` 这种模式

### 2. creators 更新类 audit 全部改为白名单 payload
**文件：** `server/routes/creators.js`

- 新增 `buildCreatorUpdateAuditPayload`
- 新增 `buildCreatorWacrmAuditPayload`
- `PUT /api/creators/:id` 不再直接写入 `req.body`
- `PUT /api/creators/:id/wacrm` 不再写入 `{ ...req.body, ... }`
- audit 现在只保留允许字段、更新字段列表、lifecycle 变化和 reply strategy 结果

### 3. 补充回归测试
**文件：** `tests/auditMiddleware.test.mjs`、`tests/auditRoutes.test.mjs`、`tests/creatorListFields.test.mjs`

- 覆盖 `fetchGenerationRows` 的参数化 `LIMIT ?` 查询路径
- 覆盖 unlimited 查询路径不含 `LIMIT`
- 覆盖 `writeAudit` 的递归脱敏与 phone-like `record_id` 脱敏
- 覆盖 `/api/audit-log` 返回前的 `record_id` / `client_id` / 嵌套字段脱敏
- 覆盖 creator 基础信息更新 audit 白名单
- 覆盖 creator WA CRM 更新 audit 白名单

### 4. 本次落盘文件

- `server/middleware/audit.js`
- `server/routes/audit.js`
- `server/routes/creators.js`
- `tests/auditMiddleware.test.mjs`
- `tests/auditRoutes.test.mjs`
- `tests/creatorListFields.test.mjs`
- `docs/SECURITY_CHANGES_2026-04-16.md`

---

## 待处理（P1/P2）

详见 `docs/SECURITY_FIX_PLAN.md`

---

## 测试结果

``` 
114/114 tests passed
SMOKE: PASSED
Syntax check: ALL OK
```
