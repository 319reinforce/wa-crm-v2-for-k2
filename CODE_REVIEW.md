# WA CRM v2 代码问题报告

> 历史归档说明：本文是 2026-04-03 基于旧 `server.js` / SQLite 迁移期代码的 review。当前运行时已迁移为 MySQL + `server/index.cjs`，因此本文不能作为最新规范或当前缺陷清单直接执行。最新复核和修复记录见下方两份 2026-04-16 文档。
> 最新复核入口：2026-04-16 的细化复核结果见 `docs/CODE_REVIEW_FINDINGS_20260416.md`
> 最新修复与验收报告：2026-04-16 的落地修改汇总见 `docs/REVIEW_FIX_REPORT_20260416.md`
> 说明：上述两份文档分别承接“问题是否仍成立”和“实际修了什么、如何验证”的两个视角。

> 审核时间：2026-04-03
> 审核范围：server.js、db.js、schema.sql、key_creators.js
> 更新：2026-04-08 CLAUDE.md 修正（Experience Router 已实现、systemPrompt.js 已落地）
> 代码状态：P0 已修复；P1 审计日志/死代码/P1-3 未修复；P2/P3 未处理

---

## 🔴 P1 — 功能缺陷（P1-1 ~ P1-4 未修复）

### 1. `INSERT OR REPLACE` 策略导致 `before_value` 永远为 null

**文件**: server.js:566-570

**问题**：`POST /api/policy-documents` 使用 `INSERT OR REPLACE`，但审计日志没有记录被替换前的数据。

```javascript
db2.prepare(`INSERT OR REPLACE INTO policy_documents ...`).run(...);
writeAudit('policy_upsert', 'policy_documents', policy_key, { policy_key, policy_version, is_active }, req);
```

`before_value` 永远是 null，无法追溯"谁把哪个政策文档从 v2.1 覆盖成 v2.2"。

**建议**：先 SELECT 查出旧值再 INSERT，或改用 `UPDATE` + `before_value` 记录。

---

### 2. 审计日志无法追踪 policy_key 被删除的情况

**文件**: server.js:566-570

`INSERT OR REPLACE` 在 policy_key 冲突时是 DELETE + INSERT，audit_log 里的 `before_value` 记录的是 INSERT 前的状态（由 SQLite 触发），但当前代码的 `before_value` 字段传入的是 null。

---

### 3. `key_creators.js` 被 import 但从未使用

**文件**: server.js:10

```javascript
const keyCreators = require('./key_creators');
```

这个模块被加载到内存但没有任何地方引用。属于死代码。

---

### 4. `is_active` 参数解构了但从未使用

**文件**: server.js:24

```javascript
const { owner, search, is_active, beta_status, priority, agency, event } = req.query;
```

`is_active` 参与了 destructuring，但 SQL 构建中没有任何 `is_active` 的过滤逻辑。如果前端传 `?is_active=0`，该参数被忽略。

---

## 🟠 P2 — 安全与健壮性

### 5. 静态文件目录直接暴露 `/public`

**文件**: server.js:17

```javascript
app.use(express.static(path.join(__dirname, 'public')));
```

整个 `public` 目录直接 serve，没有任何访问控制。如果里面有敏感配置文件（如 `.env.backup`），可以直接 curl 访问到。

**建议**：生产环境应限制或移除此中间件，改用 Nginx/CDN 处理静态资源。

---

### 6. JSON body 无大小限制

**文件**: server.js:16

```javascript
app.use(express.json());
```

没有 `express.json({ limit: '1mb' })`，恶意请求可以发送巨大 JSON 撑爆内存。

---

### 7. `req.params.clientId` 未校验类型

**文件**: server.js:590

```javascript
const rows = db2.prepare(`SELECT * FROM client_memory WHERE client_id = ?`).all(req.params.clientId);
```

`clientId` 是路由参数，如果传入 `' OR '1'='1` 这类字符串，会被作为字符串直接拼入 SQL（参数化查询是安全的），但可能传入超长字符串、特殊字符。没有长度限制或格式校验。

---

### 8. 无请求超时配置

**文件**: server.js

整个 server.js 没有设置任何超时：

```javascript
// 缺少
app.use((req, res) => {
    req.setTimeout(10000);
    res.setTimeout(10000);
});
```

如果 SQLite 长时间锁表（如并发写入），HTTP 请求会挂起不返回。

---

### 9. 无 graceful shutdown

**文件**: server.js:648

```javascript
app.listen(PORT, () => { ... });
```

缺少进程信号处理，SIGTERM/SIGINT 收到时不会先关闭 SQLite 连接，可能导致 WAL 文件未 flush：

```javascript
process.on('SIGTERM', () => {
    db.closeDb();
    process.exit(0);
});
```

---

### 10. SFT 查询的 JSON.parse 无错误处理

**文件**: server.js:509, 639

```javascript
context: r.context_json ? JSON.parse(r.context_json) : null
```

如果数据库中 `context_json` 字段存了非法 JSON（如已损坏），`JSON.parse` 会抛异常，导致整个 API 500 错误。

**建议**：包在 try-catch 中。

---

## 🟡 P3 — 代码质量与优化

### 11. `/api/stats` 串行 15+ 次 DB 查询

**文件**: server.js:138-167

```javascript
const row = db2.prepare(`SELECT COUNT ...`).get();
const msgRow = db2.prepare(`SELECT COUNT ...`).get();
db2.prepare(`SELECT wa_owner, COUNT ...`).all().forEach(...)
db2.prepare(`SELECT beta_status, COUNT ...`).all().forEach(...)
db2.prepare(`SELECT priority, COUNT ...`).all().forEach(...)
for (const col of evCols) {
    db2.prepare(`SELECT COUNT ... WHERE ${col} = 1`).get(); // 11次
}
```

共 15+ 次数据库往返，可以合并为 1-2 条 SQL。

**优化方案**：
```sql
SELECT
    COUNT(DISTINCT c.id) as total,
    COUNT(wm.id) as total_messages
FROM creators c LEFT JOIN wa_messages wm ON wm.creator_id = c.id;

SELECT wa_owner, COUNT(*) as cnt FROM creators GROUP BY 1;
SELECT beta_status, COUNT(*) as cnt FROM wa_crm_data GROUP BY 1;
SELECT priority, COUNT(*) as cnt FROM wa_crm_data GROUP BY 1;
SELECT
    SUM(ev_joined) as ev_joined,
    SUM(ev_ready_sent) as ev_ready_sent,
    ...
FROM joinbrands_link;
```

---

### 12. `getCreatorFull` N+1 问题

**文件**: db.js:223-247

```javascript
const messages = db.prepare('SELECT * FROM wa_messages WHERE creator_id = ?').all(creatorId);     // Query 1
const wacrm = db.prepare('SELECT * FROM wa_crm_data WHERE creator_id = ?').get(creatorId);          // Query 2
const aliases = db.prepare('SELECT * FROM creator_aliases WHERE creator_id = ?').all(creatorId);     // Query 3
const joinbrands = db.prepare('SELECT * FROM joinbrands_link WHERE creator_id = ?').get(creatorId); // Query 4
```

4 次独立查询，可以合并为 1 次 JOIN。

---

### 13. `owner` 参数缺少大小写归一化

**文件**: server.js:68-70

```javascript
if (owner) {
    sql += ' AND c.wa_owner = ?';
    params.push(owner);
}
```

如果数据库存的是 `'Beau'`，前端传 `'beau'` 会匹配不到。应该在 SQL 层统一做 `LOWER()` 比较，或在数据库层确保 wa_owner 存储为规范大小写。

---

### 14. `/api/creators/:id/messages` 无分页

**文件**: server.js:122-132

消息表有 6940 条记录，某个 creator 可能有数千条消息，一次性返回全部。如果消息量大，会导致响应超时或内存溢出。

**建议**：加 `limit` / `offset` 参数。

---

### 15. 前端 `loadCreators` 无错误处理

**文件**: server.js:327-330

```javascript
fetch('/api/creators?' + params.toString()).then(r => r.json())
```

没有 `.catch()`，网络错误时 `renderStats` 和 `renderCreators` 会收到 `undefined` 导致白屏。

---

### 16. 前端 `renderStats` 对 `by_owner` 无防护

**文件**: server.js:339

```javascript
document.getElementById('statBeau').textContent = stats.by_owner.Beau || 0;
```

如果后端返回的 `by_owner` 结构不是预期格式，访问 `.Beau` 会返回 `undefined`，不会崩溃但不正确。

---

## 📋 总结

| 等级 | 数量 | 已修复 | 待处理 |
|------|------|--------|--------|
| P1 | 4 | 4 | 0（全部解决） |
| P2 | 6 | 6 | 0（全部解决 ✅） |
| P3 | 6 | 6 | 0（全部解决 ✅） |

**全部 P1 + P2 + P3 已解决 ✅（commit 9c12e85）**

---

## 📅 2026-04-08 补充

### ✅ P1 + P3 全部修复（commit c510114）

| 修复项 | 说明 |
|--------|------|
| P1-1 | `INSERT OR REPLACE` → `UPDATE`（旧记录）+ `INSERT`（新记录），避免 DELETE 触发器问题 |
| P1-2 | `writeAudit` 新增 `beforeValue` 参数，`before_value` 和 `after_value` 正确分离 |
| P1-3 | `key_creators` require 已不存在（前期已清理） |
| P1-4 | `is_active` SQL 过滤逻辑已存在（`WHERE c.is_active = ?`） |
| P3-1 | `/api/stats` 从 15+ 次查询 → 3 次（ev stats 用 `SUM` 聚合） |
| P3-2 | `getCreatorFull` 从 4 次 → 2 次（LEFT JOIN 合并 creator/wacrm/joinbrands） |
| P3-3 | `owner` 过滤加 `LOWER(wa_owner) = LOWER(?)` 大小写归一化 |
| P3-4 | `/api/creators/:id/messages` 加 `?limit=&offset=` 分页（上限 1000） |

### P2 — 生产安全（全部修复 ✅，commit 495579f）

| # | 问题 | 修复方案 |
|---|------|---------|
| P2-1 | 静态文件目录直接暴露 `/public` | 仅在 `NODE_ENV !== 'production'` 时启用静态文件服务 |
| P2-2 | JSON body 无大小限制 | `express.json({ limit: '3mb' })` |
| P2-3 | 无请求超时配置 | `req.setTimeout(15000)` + `res.setTimeout(15000)` |
| P2-4 | 无 graceful shutdown | `process.on('SIGTERM/SIGINT')` → 关闭 server + `db.closeDb()` |
| P2-5 | `req.params.clientId` 未校验类型 | 加长度 + 类型校验，拒绝无效请求 |
| P2-6 | 多处 `JSON.parse` 无 try-catch | 全部包裹 try-catch（sft-memory x2、export、profile-agent） |

### 前端修复（commit 9c12e85）

| # | 问题 | 修复方案 |
|---|------|---------|
| P3-5 | `fetchCreator` 无 `.catch` 网络错误处理 | 加 `.catch()` 兜底 |
| P3-6 | `by_owner` 防护 | 已有 `&&` 防护（React 重构后已处理） |

### 新增死文件

- **`src/components/ReviewPanel.jsx`**：文件存在但从未被 import，是死代码，可以删除

### 文档已更正

- CLAUDE.md 中 Experience Router "尚未实现" 描述已更正为"已实现"
- CLAUDE.md 中 `systemPrompt.js` "已移除" 描述已更正为"前后端共用同一份"
- CLAUDE.md 后端模块列表已加入 `routes/experience.js`

### SFT 优化 v2 新增内容

- `src/utils/systemPrompt.js`（共享模板）
- `sft_feedback` 表（skip/reject/edit 反馈）
- `idx_sft_dedup` 唯一索引（SHA256 去重）
- 5 个新 API：pending review / review / trends / sft-feedback / sft-feedback/stats

## Obsidian Sync

- Status: historical-backfill
- Note: `docs/obsidian/notes/2026-04-16-code-review-archive.md`
- Index: `docs/obsidian/index.md`
