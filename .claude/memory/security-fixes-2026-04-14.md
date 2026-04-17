# Security & Quality Fixes Handoff — 2026-04-14 to 2026-04-17

> 文件名保留 `2026-04-14` 仅为兼容旧会话引用；内容已同步到 2026-04-17 当前状态。

## Canonical 文档入口

- `docs/SECURITY_FIX_PLAN.md`：当前状态和剩余项的主文档
- `docs/SECURITY_CHANGES_2026-04-16.md`：P0 主修复 + 后续补修记录
- `docs/SECURITY_CHANGES_2026-04-17.md`：audit 脱敏补修和文档同步记录
- `docs/SECURITY_FIX_REPORT.md`：精简版状态摘要
- `docs/SECURITY_CHANGES_20260416.md`：旧路径兼容入口

## 当前真实状态

- P0：全部完成
- P1：全部完成
- P2：P2-1 / P2-4 / P2-7 已完成
- 当前剩余项：P2-2 / P2-3 / P2-5 / P2-6

## 关键决策

### 鉴权

- `LOCAL_API_AUTH_BYPASS` 已改为默认关闭，必须显式设 `true` 才允许 localhost 绕过
- URL query token 已移除；普通 API 走 `Authorization: Bearer`，SSE/EventSource 走同源 `httpOnly` cookie
- internal service token 不再回退 admin token
- `buildTokenEntries()` 已加模块级缓存 `_tokenEntriesCache`

### audit / 隐私

- `writeAudit()` 写入前统一做递归脱敏
- `sanitizeAuditRecordId()` 会遮罩 phone-like `record_id`
- `GET /api/audit-log` 返回前也会再次脱敏，兜底历史脏数据
- creators 更新类 audit 已改为白名单字段，不再写整包 `req.body`

### 数据暴露面

- `GET /api/creators` 默认隐藏 `wa_phone`；只有显式 `?fields=wa_phone` 且为 admin/service token 时才返回
- `GET /:operator/clients` 已分页且不返回 `wa_phone`
- `POST /api/wa/send` 响应体已移除 `wa_phone`
- `sendOwnerScopeForbidden` 已统一提取到 `appAuth.js`

### 一致性 / 结构

- `POST /api/events/broadcast` 已显式挂载 `jsonBody`，并使用 event allowlist
- SFT 路由主逻辑已收口到 `server/services/sftService.js`
- DELETE `/api/events/:id` 已用事务包裹

## 剩余未处理项

- P2-2：`resolveRequestedOwner` 仍在 `sft.js` / `events.js` / `audit.js` 重复实现
- P2-3：`db.getCreatorFull()` 仍是串行查询
- P2-5：`schema.sql` 的函数索引仍缺少 MySQL `8.0.13+` 注释
- P2-6：`index.cjs`、`waService.js`、`waWorker.js` 等处仍有较多 `console.log`

## 最新验证

- 2026-04-17 实测 `npm test`：`114/114` passed
- `[SMOKE] PASSED`
- 默认仍跳过 API integration smoke、UI acceptance smoke、WA send smoke

## 下次会话建议

- 先读 `docs/SECURITY_FIX_PLAN.md`
- 如果要继续修代码，优先做 P2-2 -> P2-3 -> P2-5 -> P2-6
- 如果要继续审计数据风险，重点查历史 `audit_log` 中是否还有旧的未脱敏记录
