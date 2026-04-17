# Security & Quality Fix Report

> 状态更新：2026-04-17
> Canonical plan：`docs/SECURITY_FIX_PLAN.md`
> 变更记录：`docs/SECURITY_CHANGES_2026-04-16.md`、`docs/SECURITY_CHANGES_2026-04-17.md`

## 当前结论

截至 2026-04-17，安全修复主线已经完成：

- P0 全部完成
- P1 全部完成
- P2 中 P2-1、P2-4、P2-7 已完成
- 当前剩余项只剩 P2-2、P2-3、P2-5、P2-6

## 已完成项

### P0 — 高优先级安全修复

- P0-1：`LOCAL_API_AUTH_BYPASS` 默认关闭，需显式设为 `true` 才启用 localhost 绕过
- P0-2：移除 URL query token；普通 API 走 `Authorization: Bearer`，SSE/EventSource 走同源 `httpOnly` cookie
- P0-3：内部服务 token 不再回退 admin token
- P0-4：`audit_log` 写入前和读取前统一递归脱敏，遮罩 `wa_phone` / `phone` / `client_id` / `record_id` / `password` / `token` / `secret`
- P0-5：`LIMIT/OFFSET` 与 generation log `LIMIT` 残留已全部参数化

### P1 — 已全部完成

- P1-1：`/api/events/broadcast` 显式挂载 `jsonBody`，并对 SSE event 名做 allowlist
- P1-2：`GET /api/creators` 默认隐藏 `wa_phone`；仅在 `?fields=wa_phone` 且为 admin/service token 时返回
- P1-3：`PUT /api/creators/:id` 与 `PUT /api/creators/:id/wacrm` 改为 audit 白名单字段写入
- P1-4：SFT 路由逻辑已收口到 `server/services/sftService.js`
- P1-5：SFT review 已补齐 `writeAudit('sft_review', ...)`
- P1-6：DELETE `/api/events/:id` 已使用事务包裹
- P1-7：`GET /:operator/clients` 已支持 `limit` / `offset`，并且不返回 `wa_phone`

### P2 — 已完成部分

- P2-1：`sendOwnerScopeForbidden` 已提取到 `server/middleware/appAuth.js`
- P2-4：`POST /api/wa/send` 响应体已移除 `wa_phone`
- P2-7：`buildTokenEntries` 已加模块级缓存 `_tokenEntriesCache`

## 剩余项

| 编号 | 当前状态 |
|------|------|
| P2-2 | `resolveRequestedOwner` 仍在 `sft.js` / `events.js` / `audit.js` 重复实现，需统一收口到 `ownerScope.js` |
| P2-3 | `db.getCreatorFull()` 仍是串行查询，需评估并行化 messages / aliases / keeper 读取 |
| P2-5 | `schema.sql` 的函数索引仍缺少 MySQL `8.0.13+` 注释 |
| P2-6 | `index.cjs`、`waService.js`、`waWorker.js` 等处仍有较多 `console.log` |

## 验证结果

### `npm test`（2026-04-17 实测）

- backend syntax check：通过
- `vite build`：通过
- `node --test`：`114/114` passed
- smoke 总结果：`[SMOKE] PASSED`

### 默认跳过项

- API integration smoke
- UI acceptance smoke
- WA send smoke

这些仍按环境变量开关控制，未包含在本次默认 `npm test` 中。
