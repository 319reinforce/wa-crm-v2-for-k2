# Security Fix Plan — WA CRM v2

> 生成日期：2026-04-16
> 状态更新：2026-04-16
> 审核来源：全量代码审核（review-agent + checklist）

---

## 状态快照（截至 2026-04-16）

### 已完成

- P0-1：localhost 鉴权绕过默认关闭
- P0-2：移除 URL query token，改为 header / httpOnly cookie
- P0-3：internal service token 不再回退 admin token
- P0-4：audit log 统一敏感字段脱敏
- P0-5：`LIMIT/OFFSET` 参数化；`audit.js` generation log 残留动态 `LIMIT` 也已补齐
- P1-1：`/api/events/broadcast` 显式挂载 `jsonBody`
- P1-2：`GET /api/creators` 默认隐藏 `wa_phone`
- P1-3：`PUT /api/creators/:id/wacrm` 改为 audit 白名单字段写入
- P1-4：SFT 路由逻辑收口到 `sftService`
- P1-5：SFT review 补齐 audit log
- P1-6：DELETE `/api/events/:id` 使用事务包裹

### 仍待处理

- P1-7：`experience.js` 客户列表分页
- 部分 P2 清理项，见下文表格

---

## P0 修复分析（需上线前完成）

### P0-1：本地鉴权绕过范围过宽

**文件：** `server/middleware/appAuth.js:161–181`

**问题：**
`LOCAL_API_AUTH_BYPASS` 默认值为 `true`（只要 `!== 'false'`），在任何非 production 环境下，来自 127.0.0.1 的请求直接获得 admin 权限，无需 token。如果服务器上 `NODE_ENV` 未设置或设置为 `development`，这个绕过在生产服务器上也会生效。

**修复方案：**
将默认值反转——默认关闭，需要显式开启：

```js
// 改前
const allowLocalBypass = process.env.LOCAL_API_AUTH_BYPASS !== 'false';

// 改后
const allowLocalBypass = process.env.LOCAL_API_AUTH_BYPASS === 'true';
```

同时在 `.env.example` 中明确注释：
```
# 本地开发时允许 localhost 无 token 访问，生产环境必须为 false 或不设置
LOCAL_API_AUTH_BYPASS=false
```

---

### P0-2：Token 写入 URL query string（凭证泄露）

**文件：** `server/middleware/appAuth.js:136` / `src/utils/appAuth.js:122–135`

**问题：**
`extractToken` 接受 `?token=` 作为鉴权方式，`buildAppAuthUrl` 主动把 token 拼入 URL。Token 会出现在：
- 服务器 access log（Nginx/Apache 默认记录完整 URL）
- 浏览器历史记录
- HTTP Referer 头（跳转到第三方时）

**修复方案：**
`extractToken` 中移除 query string 回退，只接受 `Authorization: Bearer` header：

```js
function extractToken(req) {
    const authHeader = String(req.headers.authorization || '');
    if (authHeader.startsWith('Bearer ')) {
        return authHeader.slice(7).trim();
    }
    return '';  // 不再读 req.query.token
}
```

对于 SSE 和 QR 等无法设置 header 的端点，改用 cookie（`httpOnly: true, sameSite: 'strict'`）或在建立连接前通过 POST 换取短期 one-time token。

`buildAppAuthUrl` 中移除 `token` 参数拼接逻辑。

---

### P0-3：内部服务 token 回退到 admin token

**文件：** `server/utils/internalAuth.js:1–9`

**问题：**
`INTERNAL_SERVICE_TOKEN_ENV_KEYS` 包含 `API_AUTH_TOKEN`、`CRM_ADMIN_TOKEN`、`WA_ADMIN_TOKEN`。没有专用内部 token 时，函数返回 admin token，并在 `buildTokenEntries` 中以 `role: 'service'` 注册。结果：
- 同一个 admin token 在两个 role 下都有效
- 服务间调用用 admin token 时，`req.auth.role` 变成 `'service'`，可能绕过下游的 `role === 'admin'` 检查

**修复方案：**
从 `INTERNAL_SERVICE_TOKEN_ENV_KEYS` 中移除所有 admin token key，只保留专用内部 token：

```js
const INTERNAL_SERVICE_TOKEN_ENV_KEYS = [
    'INTERNAL_SERVICE_TOKEN',
    'TRAINING_TRIGGER_TOKEN',
    'INTERNAL_API_TOKEN',
    'AI_PROXY_TOKEN',
    // 不再包含 API_AUTH_TOKEN / CRM_ADMIN_TOKEN / WA_ADMIN_TOKEN
];
```

在 `.env.example` 中补充：
```
# 服务间内部调用专用 token，必须与 admin token 不同
INTERNAL_SERVICE_TOKEN=
```

---

### P0-4：`wa_phone` 写入 audit_log

**文件：** `server/middleware/audit.js:35` / `server/routes/creators.js:644–652, 882, 1043`

**问题：**
`writeAudit` 直接序列化传入的对象到 `after_value` JSON 列。`creators.js:644` 明确传入了 `wa_phone: normalizedPhone`，`882` 传入 `req.body`（可能含 wa_phone），`1043` 传入 `{ ...req.body, ... }`。`GET /api/audit-log` 可公开查询这些记录。

**修复方案：**

方案 A（推荐）：在 `writeAudit` 内统一脱敏，递归删除 `wa_phone` 字段：

```js
function sanitizeAuditValue(obj) {
    if (!obj || typeof obj !== 'object') return obj;
    const result = { ...obj };
    delete result.wa_phone;
    delete result.phone;
    return result;
}

async function writeAudit(action, tableName, recordId, beforeValue, afterValue, req) {
    // ...
    await db2.prepare(`...`).run(
        action, tableName, normalizedRecordId,
        beforeValue ? JSON.stringify(sanitizeAuditValue(beforeValue)) : null,
        afterValue  ? JSON.stringify(sanitizeAuditValue(afterValue))  : null,
        req.ip || req.connection?.remoteAddress || null,
        req.get('User-Agent') || null
    );
}
```

方案 B：在每个 `writeAudit` 调用处手动删除 `wa_phone`（容易遗漏，不推荐）。

---

### P0-5：SQL LIMIT/OFFSET 模板字符串拼接

**文件：** `server/routes/sft.js:323,652` / `server/routes/events.js:399` / `server/routes/audit.js:252` / `server/services/sftService.js:140` / `db.js:289`

**问题：**
`LIMIT ${limit} OFFSET ${offset}` 直接内联进 SQL 字符串。虽然当前有 `parseInt` 保护，但：
- 模式不一致（部分有 `Math.min` 上限，部分没有）
- 未来移除 parseInt 保护会静默开洞
- MySQL driver（mysql2）实际上支持 LIMIT/OFFSET 参数化

**修复方案：**
统一改为参数化，并加上合理上限：

```js
// 改前
sql += ` LIMIT ${limit} OFFSET ${offset}`;
const rows = db.prepare(sql).all(...params);

// 改后
const safeLimit  = Math.min(Math.max(parseInt(limit)  || 20, 1), 500);
const safeOffset = Math.max(parseInt(offset) || 0, 0);
sql += ` LIMIT ? OFFSET ?`;
const rows = db.prepare(sql).all(...params, safeLimit, safeOffset);
```

需要修改的位置（共 6 处）：
- `server/routes/sft.js:323`
- `server/routes/sft.js:652`
- `server/routes/events.js:399`
- `server/routes/audit.js:252`
- `server/services/sftService.js:140`
- `db.js:289`

---

## P1 修复路径

| # | 问题 | 文件 | 修复方式 |
|---|------|------|---------|
| P1-1 | broadcast 端点 body 解析顺序 + SSE event 名未校验 | `server/index.cjs:69–84` | 已完成：端点显式挂载 `jsonBody`，allowlist 校验保留 |
| P1-2 | `GET /api/creators` 返回全部 wa_phone | `server/routes/creators.js:387–492` | 已完成：默认不返回 `wa_phone`，需 `?fields=wa_phone` 且为 admin/service |
| P1-3 | `PUT /api/creators/:id/wacrm` 把 req.body 原样写入 audit | `creators.js:1043` | 已完成：改为白名单字段写入；同类 `PUT /api/creators/:id` 也一并收口 |
| P1-4 | sftService 与 sft 路由业务逻辑重复且不同步 | `sftService.js` / `sft.js` | 已完成：路由层调用 service，service 负责统一 create/list/review/stats 逻辑 |
| P1-5 | SFT review 操作无 audit log | `sft.js:364–386` | 已完成：approve/reject 路径补齐 `writeAudit('sft_review', ...)` |
| P1-6 | DELETE /api/events/:id 两步删除不在事务内 | `events.js:694–695` | 已完成：使用事务包裹删除 |
| P1-7 | experience.js 客户列表无分页 | `experience.js:180–202` | 加 `LIMIT ? OFFSET ?` 参数，默认 limit=50 |

---

## P2 修复路径

| # | 问题 | 文件 | 修复方式 |
|---|------|------|---------|
| P2-1 | `sendOwnerScopeForbidden` 5处复制粘贴 | `creators.js`, `sft.js`, `events.js`, `messages.js`, `wa.js` | 提取到 `appAuth.js` 并 export，各文件改为 import 调用 |
| P2-2 | `resolveRequestedOwner` 3处重复实现 | `sft.js:33`, `events.js:60`, `experience.js:162` | 统一使用 `ownerScope.js` 中已有的实现 |
| P2-3 | `getCreatorFull` 3个串行查询 | `db.js:369–378` | `Promise.all` 并行 messages + aliases；删除冗余的 keeper 单独查询 |
| P2-4 | `POST /api/wa/send` 响应体含 wa_phone | `wa.js:244` | 从响应中删除 `wa_phone` 字段 |
| P2-5 | schema.sql 函数索引未注明 MySQL 版本要求 | `schema.sql:528` | 加注释 `-- requires MySQL 8.0.13+` |
| P2-6 | console.log 残留 | `index.cjs`, `waService.js`, `waWorker.js` 等 | 替换为结构化日志或删除 |
| P2-7 | `buildTokenEntries` 每次请求重建 | `appAuth.js` | 模块级缓存，进程启动时构建一次，env 变更时失效 |

---

## 建议修复顺序

```
P0-4（wa_phone 脱敏）→ P0-2（token URL）→ P0-1（bypass 默认值）→ P0-3（internal token）→ P0-5（LIMIT 参数化）
→ P1-1（broadcast body 顺序）→ P1-6（事务）→ P1-2（creators 字段过滤）
→ P2-1/P2-2（重复代码提取）→ 其余 P2
```

P0-4 优先是因为它是数据合规问题，且改动最小（只改 `audit.js` 一处）。
