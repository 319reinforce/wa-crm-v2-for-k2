# Security & Quality Fix Report

Date: 2026-04-14

## Summary

本次修复覆盖 9 项安全/质量问题，全部通过语法检查。

---

## P1 — 安全修复

### P1-1: broadcast event 字段 allowlist
**文件**: `server/index.cjs`

`POST /api/events/broadcast` 的 `event` 字段改为 allowlist 校验，非白名单值 fallback 到 `creators-updated`，防止任意字符串注入 SSE 流。

白名单: `['creators-updated', 'refresh', 'sft-updated', 'events-updated']`

### P1-2: GET /api/creators 过滤 wa_phone
**文件**: `server/routes/creators.js`

列表接口对非 admin token 不返回 `wa_phone` 字段，减少手机号泄露面。admin token (`req.auth.role === 'admin'`) 仍可获取完整数据。

### P1-3: PUT /api/creators/:id/wacrm audit 白名单
**文件**: `server/routes/creators.js`

`writeAudit` 调用不再传 `...req.body`，改为只传白名单字段（`updated`, `lifecycle_before`, `lifecycle_after`, `lifecycle_changed`, `reply_strategy`），防止用户可控数据写入 audit log。

### P1-5: SFT review 操作加 audit log
**文件**: `server/routes/sft.js`

`PATCH /api/sft-memory/:id/review` 在状态变更后调用 `writeAudit('sft_review', ...)`，记录 before/after status、comment、reviewed_by，满足操作可追溯要求。

### P1-6: DELETE /api/events/:id 两步删除加事务
**文件**: `server/routes/events.js`

删除 `event_periods` 和 `events` 两步操作用 `db2.transaction()` 包裹，防止中间失败导致孤儿记录。

### P1-7: experience /:operator/clients 加分页
**文件**: `server/routes/experience.js`

`GET /:operator/clients` 加入分页参数，防止全表扫描：
- `limit`: 默认 50，最大 200
- `offset`: 默认 0
- 响应新增 `limit`、`offset` 字段
- 同时移除响应中的 `wa_phone` 字段

---

## P2 — 质量改进

### P2-1: sendOwnerScopeForbidden 提取到 appAuth.js
**文件**: `server/middleware/appAuth.js` + 5 个路由文件

`sendOwnerScopeForbidden` 函数原本在 5 个路由文件中各自重复定义，现统一提取到 `appAuth.js` 并 export。各路由文件改为从 `appAuth` import，消除重复代码。

涉及文件: `creators.js`, `sft.js`, `events.js`, `messages.js`, `wa.js`

### P2-4: POST /api/wa/send 响应体删除 wa_phone
**文件**: `server/routes/wa.js`

发送消息接口的响应体移除 `wa_phone` 字段，减少手机号在 API 响应中的暴露。

### P2-7: buildTokenEntries 模块级缓存
**文件**: `server/middleware/appAuth.js`

`buildTokenEntries()` 每次调用都重新遍历 env 变量，加入模块级缓存 `_tokenEntriesCache`，进程生命周期内只构建一次，减少重复计算。env 变更需重启进程（可接受行为）。

---

## 未处理项（需单独评估）

| 编号 | 描述 | 原因 |
|------|------|------|
| P1-4 | sftService 与 sft 路由重复逻辑 | 涉及业务逻辑重构，风险较高 |
| P2-2 | resolveRequestedOwner 3处重复 | 需确认各处语义是否完全一致 |
| P2-3 | getCreatorFull 并行查询优化 | 性能优化，非安全问题 |
| P2-5 | schema 注释补全 | 文档类，低优先级 |
| P2-6 | console.log 清理 | 仅保留 error/warn 级别 |

---

## 验证

所有修改文件通过 `node -c` 语法检查：

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
