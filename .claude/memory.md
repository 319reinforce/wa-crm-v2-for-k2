# WA CRM v2 — 项目记忆

## 项目概况

- **路径**: `/Users/depp/wa-bot/wa-crm-v2`
- **架构**: Express (CJS) 后端 + React 前端 + SQLite (better-sqlite3)
- **入口**: `server/index.cjs`
- **数据库**: `db.js` (根目录)

## 关键目录

```
server/
  index.cjs              # Express 主入口，SSE 广播，auth 路由
  middleware/
    appAuth.js           # Token 认证、cookie、sendOwnerScopeForbidden
    audit.js             # writeAudit() 审计日志
    jsonBody.js          # body-parser
  routes/
    creators.js          # /api/creators CRUD
    events.js            # /api/events
    sft.js               # /api/sft-memory, /api/sft-feedback
    messages.js          # /api/creators/:id/messages
    wa.js                # /api/wa/send, /api/wa/status
    experience.js        # /:operator/clients (分页)
    ai.js                # AI 回复生成
    audit.js             # /api/audit
  services/
    lifecycleService.js
    sftService.js
    waService.js
src/                     # React 前端
```

## 认证体系

- `appAuth.js` 管理所有 token 逻辑
- Token 类型: `admin` / `owner` / `service`
- `req.auth.role` — 当前请求的角色
- `req.auth.owner` — owner-scoped token 锁定的 operator
- `req.auth.owner_locked` — 是否被锁定到特定 owner
- `sendOwnerScopeForbidden(res, lockedOwner)` — 统一 403 响应，从 appAuth export
- `buildTokenEntries()` — 有模块级缓存 `_tokenEntriesCache`，进程重启失效

## 安全规则（已落地）

1. **wa_phone 保护**: `GET /api/creators` 非 admin token 不返回 `wa_phone`
2. **audit 白名单**: `writeAudit` 调用不传 `...req.body`，只传白名单字段
3. **SSE event allowlist**: broadcast 端点的 event 字段限定为 `['creators-updated', 'refresh', 'sft-updated', 'events-updated']`
4. **删除事务**: `DELETE /api/events/:id` 用 `db.transaction()` 包裹两步删除
5. **SFT 审计**: review 操作后调用 `writeAudit('sft_review', ...)`
6. **分页保护**: `experience/:operator/clients` 强制分页，默认 limit=50，最大 200

## 常见模式

### owner scope 检查
```js
const lockedOwner = getLockedOwner(req);
if (lockedOwner && !matchesOwnerScope(req, targetOwner)) {
    return sendOwnerScopeForbidden(res, lockedOwner);
}
```

### writeAudit 调用
```js
await writeAudit(action, table, recordId, before, after, req);
// 只传白名单字段，不传 ...req.body
```

### 事务删除
```js
await db.transaction(async (txDb) => {
    await txDb.prepare('DELETE FROM child WHERE parent_id = ?').run(id);
    await txDb.prepare('DELETE FROM parent WHERE id = ?').run(id);
});
```

## 待处理项

| 编号 | 描述 | 优先级 |
|------|------|--------|
| P1-4 | sftService 与 sft 路由重复逻辑提取 | P1 |
| P2-2 | resolveRequestedOwner 3处重复（sft/events/creators）提取 | P2 |
| P2-3 | getCreatorFull 并行查询优化 | P2 |
| P2-5 | schema.sql 注释补全 | P2 |
| P2-6 | console.log 清理（只保留 error/warn） | P2 |

## 最近变更记录

### 2026-04-14 安全+质量修复批次
- `server/index.cjs`: broadcast event allowlist
- `server/middleware/appAuth.js`: sendOwnerScopeForbidden export + buildTokenEntries 缓存
- `server/routes/creators.js`: wa_phone 过滤 + audit 白名单 + sendOwnerScopeForbidden import
- `server/routes/sft.js`: writeAudit review + sendOwnerScopeForbidden import
- `server/routes/events.js`: 删除事务 + sendOwnerScopeForbidden import
- `server/routes/messages.js`: sendOwnerScopeForbidden import
- `server/routes/wa.js`: 响应体删除 wa_phone + sendOwnerScopeForbidden import
- `server/routes/experience.js`: 分页 + wa_phone 过滤

### 2026-04-16 Git / 部署排查补充
- 清理了 `.wwebjs_auth` 的大缓存后，目录从约 `12.87 GiB` 降到约 `457 MiB`，主要删除了 `blob_storage`、`Cache`、`Code Cache`、`Service Worker` 等可重建缓存。
- 新增了部署排除规则文档：`docs/deploy/rsync-excludes.txt`、`docs/deploy/rsync-stateless-excludes.txt`、`docs/deploy/rsync-wwebjs-auth-minimal-excludes.txt`。
- 做过一轮服务器部署方案尝试，涉及 `Dockerfile`、`DEPLOY.md`、`.env.example`、`server/services/waService.js`、`docker-compose.server.yml`，目标是让 WA session 支持 Docker named volume 持久化；这些改动目前仍在工作区，尚未提交。
- 2026-04-16 已实际执行 `git fetch origin`，本地拿到最新 `origin/main` 及多个 `codex/*` 分支。
- K2Lab 远端 `main` 当前指向提交 `dd8811db669122400594c0400c1f5253af995d84`，提交信息是 `docs: add LOCAL_SETUP guide`。
- 该提交作者与提交者都是 `xiaolongnk <xiaolongnk@126.com>`。
- `git ls-remote --heads origin '*xiaolongnk*'` 没有返回任何公开分支，因此当前没有可见的 `xiaolongnk` 远端分支名；更可能是 `xiaolongnk` 的工作已经合入 `main`，原始分支已删除、私有化或从未按该名字公开。
