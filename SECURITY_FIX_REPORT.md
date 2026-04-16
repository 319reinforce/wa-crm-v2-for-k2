# Security & Quality Fix Report

**Date:** 2025-01-27  
**Scope:** P1 (Security) + P2 (Quality) fixes across server routes and middleware

---

## P1 — Security Fixes

### P1-1: Broadcast event 字段 allowlist
**File:** `server/index.cjs`  
**Problem:** `POST /api/events/broadcast` 直接将 `req.body.event` 拼入 SSE 帧，攻击者可注入任意字符串（含换行符）污染 SSE 流。  
**Fix:** 加 allowlist `['creators-updated', 'refresh', 'sft-updated', 'events-updated']`，非白名单值 fallback 到 `creators-updated`。

### P1-2: GET /api/creators 过滤 wa_phone
**File:** `server/routes/creators.js`  
**Problem:** 列表接口对所有 token（含 owner-scoped）返回 `wa_phone`，泄露其他 operator 的手机号。  
**Fix:** `mapped` 阶段检查 `req.auth?.role === 'admin'`，非 admin 将 `wa_phone` 设为 `undefined`（不序列化到 JSON）。

### P1-3: PUT /api/creators/:id/wacrm audit 白名单
**File:** `server/routes/creators.js`  
**Problem:** `writeAudit` 调用传入 `...req.body`，将用户提交的任意字段写入 audit log，可能污染审计记录。  
**Fix:** 删除 `...req.body`，只传白名单字段：`updated`, `lifecycle_before`, `lifecycle_after`, `lifecycle_changed`, `reply_strategy`。

### P1-5: SFT review 操作加 audit log
**File:** `server/routes/sft.js`  
**Problem:** `PATCH /api/sft-memory/:id/review` approve/reject 操作无审计记录，无法追溯谁在何时做了什么决定。  
**Fix:** 在 UPDATE 成功后加 `writeAudit('sft_review', ...)` 记录操作前后状态、comment 和 reviewed_by。

### P1-6: DELETE /api/events/:id 两步删除加事务
**File:** `server/routes/events.js`  
**Problem:** 先删 `event_periods` 再删 `events`，两步之间若进程崩溃会产生孤儿记录，破坏数据一致性。  
**Fix:** 用 `db2.transaction(() => { ... })()` 包裹两步删除，保证原子性。

### P1-7: experience /:operator/clients 加分页
**File:** `server/routes/experience.js`  
**Problem:** 无 LIMIT，operator 客户量大时全量返回，可能导致内存溢出和响应超时。  
**Fix:** 从 `req.query` 读取 `limit`（默认 50，最大 200）和 `offset`（默认 0），SQL 末尾加 `LIMIT ? OFFSET ?`，响应体加 `limit`/`offset` 字段。

---

## P2 — Quality Fixes

### P2-1: sendOwnerScopeForbidden 提取到 appAuth.js
**Files:** `server/middleware/appAuth.js` + 5 个路由文件  
**Problem:** `sendOwnerScopeForbidden` 函数在 creators/sft/events/messages/wa 5 个文件中各自复制了一份，共 5 处重复定义。  
**Fix:** 在 `appAuth.js` 中定义并 export，5 个路由文件删除本地定义，改为从 `appAuth` import。

### P2-4: POST /api/wa/send 响应体删除 wa_phone
**File:** `server/routes/wa.js`  
**Problem:** 发送消息的响应体包含 `wa_phone: resolvedCreator.phone`，不必要地暴露手机号给调用方。  
**Fix:** 删除响应体中的 `wa_phone` 字段。

### P2-7: buildTokenEntries 模块级缓存
**File:** `server/middleware/appAuth.js`  
**Problem:** `buildTokenEntries()` 每次请求都重新遍历 env 变量构建 token 列表，高并发下有不必要的 CPU 开销。  
**Fix:** 加模块级变量 `_tokenEntriesCache`，首次调用后缓存结果，进程重启时自动失效。

---

## 未执行项（建议后续跟进）

| ID | 描述 | 原因 |
|----|------|------|
| P1-4 | sftService 与 sft 路由重复逻辑提取 | 涉及业务逻辑重构，风险较高，建议单独 PR |
| P2-2 | resolveRequestedOwner 3处重复提取 | sft/events 各有本地实现，需确认行为一致后再合并 |
| P2-3 | getCreatorFull 并行查询优化 | 性能优化，无安全风险，可单独处理 |
| P2-5 | DB schema 注释补全 | 文档类，低优先级 |
| P2-6 | console.log 清理 | 噪音清理，低优先级 |

---

## 验证

所有修改文件均通过 `node -c` 语法检查：

```
server/middleware/appAuth.js: OK
server/routes/creators.js: OK
server/routes/sft.js: OK
server/routes/events.js: OK
server/routes/messages.js: OK
server/routes/wa.js: OK
server/routes/experience.js: OK
server/index.cjs: OK
```
