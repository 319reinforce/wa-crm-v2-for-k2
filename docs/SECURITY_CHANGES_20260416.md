# Security Changes — 2026-04-16

## 背景

全量代码审核后，针对 P0 安全问题完成修复。审核文档见 `docs/SECURITY_FIX_PLAN.md`。

---

## 今日改动

### 1. `server/middleware/appAuth.js`

- P0-1：`LOCAL_API_AUTH_BYPASS` 默认值从 `!== 'false'`（默认开）改为 `=== 'true'`（默认关），防止 NODE_ENV 未设置时绕过生效
- P0-2：`extractToken` 移除 query string token 读取，只接受 `Authorization: Bearer` header
- linter 自动：`buildTokenEntries` 加模块级缓存 `_tokenEntriesCache`，避免每次请求重建
- linter 自动：新增 `sendOwnerScopeForbidden(res, lockedOwner)` 并 export，解决 P2-1 重复定义问题

### 2. `server/middleware/audit.js`

- P0-4：新增 `AUDIT_REDACTED_FIELDS` 和 `sanitizeAuditValue(obj)`，在 `writeAudit` 内对 `beforeValue`/`afterValue` 统一脱敏，`wa_phone`、`phone`、`password`、`token`、`secret` 字段自动替换为 `[REDACTED]`

### 3. `server/utils/internalAuth.js`

- P0-3：`INTERNAL_SERVICE_TOKEN_ENV_KEYS` 移除 `API_AUTH_TOKEN`、`CRM_ADMIN_TOKEN`、`WA_ADMIN_TOKEN`，防止 admin token 以 `role: 'service'` 双重注册

### 4. `server/index.cjs`

- P0-2 SSE 兼容：`/api/events/subscribe` 端点加前置中间件，将 query string token 注入 `Authorization` header，解决原生 `EventSource` 不支持自定义 header 的问题。其他所有端点不受影响

### 5. LIMIT/OFFSET 参数化（P0-5）

6 处模板字符串拼接全部改为 `?` 占位符：

| 文件 | 行号 |
|------|------|
| `server/routes/sft.js` | 323, 652 |
| `server/routes/events.js` | 399 |
| `server/routes/audit.js` | 252 |
| `server/services/sftService.js` | 140 |
| `db.js` | 289 |

### 6. linter 自动修复（顺带完成的 P1/P2）

- `server/routes/events.js:695`：`DELETE /api/events/:id` 改用 `db2.transaction()` 包裹两步删除（P1-6）
- `server/routes/sft.js:381`：`PATCH /api/sft-memory/:id/review` 加 `writeAudit('sft_review', ...)` 审计记录（P1-5）
- `server/middleware/appAuth.js`：`sendOwnerScopeForbidden` 提取并 export（P2-1）

---

## 测试结果

```
87/87 tests passed
[SMOKE] PASSED
```

---

## 待处理（未动）

- P1-1：`/api/events/broadcast` body 解析顺序 + SSE event 名 allowlist
- P1-2：`GET /api/creators` 返回全量 `wa_phone`，需字段过滤
- P1-3：`PUT /api/creators/:id/wacrm` req.body 写入 audit
- P1-4：sftService 与 sft 路由业务逻辑重复
- P1-7：`experience.js` 客户列表无分页
- P2-2/P2-3/P2-4/P2-5/P2-6：见 `SECURITY_FIX_PLAN.md`

---

## 注意事项

- 本地开发需在 `.env` 中显式设置 `LOCAL_API_AUTH_BYPASS=true` 才能启用 localhost 无 token 访问
- 如需服务间调用，必须配置专用 `INTERNAL_SERVICE_TOKEN`，不能复用 admin token
