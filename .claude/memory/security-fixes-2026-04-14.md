# Security & Quality Fixes — 2026-04-14

## 背景
对 WA CRM v2 后端进行了一轮安全审查，修复了 6 项 P1 安全问题和 3 项 P2 质量问题。

## 已完成修复

### appAuth.js
- `buildTokenEntries()` 加模块级缓存 `_tokenEntriesCache`，进程生命周期内只构建一次
- 新增 `sendOwnerScopeForbidden(res, lockedOwner)` 函数并 export，统一 403 响应格式
- 新增 `setAppAuthCookie` / `clearAppAuthCookie` / `APP_AUTH_COOKIE_NAME` export（linter 同步）

### server/index.cjs — broadcast allowlist
`POST /api/events/broadcast` 的 `event` 字段改为 allowlist 校验：
```js
const ALLOWED_EVENTS = ['creators-updated', 'refresh', 'sft-updated', 'events-updated'];
const event = ALLOWED_EVENTS.includes(rawEvent) ? rawEvent : 'creators-updated';
```

### server/routes/creators.js
- `GET /api/creators` 列表：非 admin token 不返回 `wa_phone`（`req.auth.role === 'admin'` 才返回）
- `PUT /api/creators/:id/wacrm` audit：删除 `...req.body`，只传白名单字段
- 5 个路由文件统一从 `appAuth` import `sendOwnerScopeForbidden`，删除本地重复定义

### server/routes/sft.js
- `PATCH /api/sft-memory/:id/review` 加 `writeAudit('sft_review', ...)` 审计记录

### server/routes/events.js
- `DELETE /api/events/:id` 两步删除（event_periods + events）用 `db2.transaction()` 包裹

### server/routes/experience.js
- `GET /:operator/clients` 加分页：`limit`（默认 50，最大 200）、`offset`（默认 0）
- 响应移除 `wa_phone` 字段

### server/routes/wa.js
- `POST /api/wa/send` 响应体删除 `wa_phone` 字段

## 未处理项（待后续跟进）
- P1-4: sftService 与 sft 路由重复逻辑提取（业务逻辑重构，风险较高）
- P2-2: resolveRequestedOwner 3处重复（sft/events 各有本地实现，需确认语义一致）
- P2-3: getCreatorFull 并行查询优化
- P2-5: schema 注释补全
- P2-6: console.log 清理（只保留 error/warn）

## 关键约定
- `req.auth.role` 取值：`'admin'` | `'owner'` | `'service'`
- admin token 可获取完整数据（含 wa_phone），owner/service token 受限
- audit log 只传白名单字段，不传 req.body
- SSE broadcast event 字段必须在 allowlist 内
