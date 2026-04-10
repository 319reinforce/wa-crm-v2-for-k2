# WA CRM v2 项目问题分析报告

> 生成日期：2026-04-10
> 分析范围：全项目代码审查

---

## 🔴 P0 - 严重问题

### 安全问题

| 文件 | 位置 | 问题描述 | 建议修复 |
|------|------|----------|----------|
| `.env` | 1-37 | **真实 API 密钥和数据库密码明文存储** - 包含 OpenAI API Key、MiniMax API Key、MySQL 密码 | 立即删除或移动到安全的位置（已在 .gitignore，但仍需清理本地文件） |
| `.env` | 9 | **前端暴露 API 密钥** - `VITE_OPENAI_API_KEY` 和 `VITE_USE_OPENAI` 直接暴露给前端 | 使用后端代理模式，前端不应持有 API 密钥 |
| `.env` | 2 | **Git 历史泄露风险** - 即使现在 `.gitignore` 已忽略 `.env`，如果曾经提交过，密钥仍在 Git 历史中 | 检查 Git 历史并使用 `git filter-branch` 或 `BFG Repo-Cleaner` 清除历史 |

---

## 🟠 P1 - 重要问题

### SQL 注入风险

| 文件 | 位置 | 问题描述 | 建议修复 |
|------|------|----------|----------|
| `server/routes/messages.js` | 18 | **LIMIT/OFFSET 直接拼接 SQL** - `LIMIT ${limit} OFFSET ${offset}` 直接插入而非参数化 | 使用白名单验证 limit/offset 或使用字符串拼接后验证为整数 |
| `server/routes/events.js` | 39 | **LIMIT/OFFSET 直接拼接 SQL** - 同上 | 同上 |
| `server/routes/events.js` | 43 | **countSql 构建逻辑与 params 不一致** - `cond` 数组只包含第一个条件，但 SQL 可能包含多个条件 | 修复 countSql 的参数构建逻辑 |

### 合规问题 - wa_phone 泄露

| 文件 | 位置 | 问题描述 | 建议修复 |
|------|------|----------|----------|
| `server/services/waService.js` | 93 | **`console.log` 泄露 `phone`** - `console.log([WA Service] 发送成功 → ${phone}: ...)` | 移除 phone 或使用脱敏日志 |
| `server/waWorker.js` | 270 | **`console.log` 泄露 `phone`** - `[WA Worker] 📩 ${name}: ${msg.body}` | 移除 phone 或使用脱敏日志 |
| `server/waWorker.js` | 281 | **`client_id: phone`** 注释暴露 phone 是 client_id | 移除暴露性注释 |
| `index_v2.js` | 316,320,347 | **日志泄露 `phone`** - 多处 console.log 包含 phone | 使用脱敏日志或移除 |

### 前端错误处理缺失

| 文件 | 位置 | 问题描述 | 建议修复 |
|------|------|----------|----------|
| `src/App.jsx` | 175-176 | **fetch 缺少 .catch()** - `Promise.all([fetch(...).then(r => r.json()), fetch(...).then(r => r.json())])` 没有错误处理，网络失败时白屏 | 添加 `.catch()` 错误处理 |
| `src/App.jsx` | 182 | **fetch 缺少 .catch()** - `fetch(.../creators/${c.id})` 没有错误处理 | 添加 `.catch()` |
| `src/components/WAMessageComposer.jsx` | 762,803,841,845,858 | **多个 fetch 缺少 .catch()** | 添加 `.catch()` 错误处理 |
| `src/components/EventPanel.jsx` | 100 | **fetch 缺少 .catch()** | 添加 `.catch()` |

### 数据库已知问题

| 文件 | 位置 | 问题描述 | 建议修复 |
|------|------|----------|----------|
| CLAUDE.md 已记录 | - | **`joinbrands_link` 表为空** - 所有 115 位达人的 `ev_*` 事件标签均为 null | 执行数据迁移脚本填充数据 |

---

## 🟡 P2 - 建议问题

### console.log 残留（生产环境泄露风险）

| 文件 | 位置 | 问题描述 |
|------|------|----------|
| `src/App.jsx` | 154,158,161,168,202 | 多处 console.log 泄露调试信息 |
| `src/components/WAMessageComposer.jsx` | 774,903,924,943,956,962,964,968,982,989,994,999,1001 | 大量调试日志 (14+ 处) |
| `server/waWorker.js` | 179,198,226,236,270,352,384 | WhatsApp Worker 日志 |
| `server/services/waService.js` | 27,43,45,46,47,50,52,58,65,93 | WA Service 日志 |

### 前端内存泄漏风险

| 文件 | 位置 | 问题描述 | 建议修复 |
|------|------|----------|----------|
| `src/App.jsx` | 144 | **setInterval 未在 cleanup 中清理** - `setInterval(loadData, 15000)` 但 useEffect cleanup 不完整 | 确保 cleanup 正确调用 `clearInterval` |
| `src/App.jsx` | 82 | **setInterval 未在 cleanup 中清理** - `setInterval(fetchWaStatus, 5000)` | 同上 |
| `src/components/WAMessageComposer.jsx` | 1015 | **pollingRef 可能泄露** - `setInterval(checkNewMessages, 5000)` 需确保 cleanup | 正确清理 interval |
| `src/components/WorkerStatusBar.jsx` | 77,102,109 | **多个 setInterval** | 确保组件卸载时清理 |

### API 路径不一致

| 文件 | 位置 | 问题描述 |
|------|------|----------|
| `src/App.jsx` | 849 | 使用 `/api/creators` 而非 `${API_BASE}/creators` |
| `src/App.jsx` | 876 | 使用 `/api/client-profile` 而非 `${API_BASE}/client-profile` |

### 前端 Re-render 潜在问题

| 文件 | 位置 | 问题描述 | 建议修复 |
|------|------|----------|----------|
| `src/App.jsx` | 216-232 | **filteredCreators 每次 render 都重新计算** - 无 useMemo 缓存 | 使用 `useMemo(() => filteredCreators, [creators, search, filterBeta, ...])` |

---

## ✅ CODE_REVIEW.md 问题验证

### 已修复

| 问题 | 状态 |
|------|------|
| P1-1 INSERT OR REPLACE 导致 before_value 为 null | ✅ 已修复 |
| P1-2 审计日志无法追踪 policy_key 删除 | ✅ 已修复 |
| P1-3 key_creators 未使用 | ✅ 已修复 |
| P1-4 is_active 参数未使用 | ✅ 已修复 |
| P2-1 静态文件暴露 public | ✅ 已修复 |
| P2-2 JSON body 无大小限制 | ✅ 已修复 |
| P2-3 无请求超时 | ✅ 已修复 |
| P2-4 无 graceful shutdown | ✅ 已修复 |
| P2-5 clientId 未校验类型 | ✅ 已修复 |
| P2-6 JSON.parse 无错误处理 | ✅ 已修复 |

### 仍存在

| 问题 | 文件 | 说明 |
|------|------|------|
| 死代码 ReviewPanel.jsx | `src/components/ReviewPanel.jsx` | ⚠️ 已不存在 - ReviewPanel 在 SFTDashboard.jsx 内部定义 |
| joinbrands_link 表为空 | 数据库 | ⚠️ 未修复 - 需执行数据迁移 |

---

## 📊 问题统计

| 等级 | 数量 | 说明 |
|------|------|------|
| P0 | 2 | API 密钥泄露（需立即处理） |
| P1 | 8 | SQL 注入风险、wa_phone 泄露、前端错误处理缺失 |
| P2 | 6+ | console.log 残留、内存泄漏风险、API 路径不一致 |

---

## 🚨 最紧急修复项（优先级排序）

1. **删除或安全存储 `.env` 中的真实密钥**
2. **移除前端暴露的 API 密钥**（改用后端代理）
3. **修复 SQL LIMIT/OFFSET 拼接问题**（messages.js:18, events.js:39）
4. **移除日志中的 wa_phone 泄露**（waService.js:93, waWorker.js:270,281）
5. **为前端 fetch 添加完整的错误处理**（App.jsx:175-176,182）

---

## 🔍 SFT 系统状态

| 问题 | 文件 | 建议 |
|------|------|------|
| SFT 语料质量依赖人工审核 | `server/routes/sft.js` | 当前已有相似度阈值 (85%) 和人工审核流程 |
| Experience Router 逻辑 | `server/routes/experience.js` | ✅ 已正确实现 operator 路由 |
