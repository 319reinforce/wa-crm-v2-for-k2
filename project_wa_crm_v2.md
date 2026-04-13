# WA CRM v2 — 项目变更记录

> 按时间倒序记录，每次重要修改后追加
> 文档路径：`/Users/depp/wa-bot/wa-crm-v2/project_wa_crm_v2.md`

---

## 2026-04-08 — P2-5/P2-6 + P3-5/P3-6 全部修复（commit 9c12e85）

### P2 — 剩余问题修复 ✅

| # | 问题 | 修复方案 | 文件 |
|---|------|---------|------|
| P2-5 | `clientId` 参数未校验 | 加长度 + 类型校验，拒绝无效 clientId | `server.js` |
| P2-6 | JSON.parse 无 try-catch | 4处全部包裹（sft-memory x2、exportRecord、profile-agent） | `server.js` / `agents/profile-agent.js` |

### 前端修复 ✅

| # | 问题 | 修复方案 | 文件 |
|---|------|---------|------|
| P3-5 | `fetchCreator` fetch 无 .catch | 加 `.catch()` 兜底 | `src/App.jsx` |
| P3-6 | by_owner 无防护 | 已有 `&&` 防护（React 重构后已处理） | — |

---

## 2026-04-08 — P2 生产安全修复（commit 495579f）

| # | 问题 | 修复方案 | 文件 |
|---|------|---------|------|
| P2-1 | 静态文件直接暴露 `/public` | 仅 `NODE_ENV !== 'production'` 时启用 | `server.js` |
| P2-2 | JSON body 无大小限制 | `express.json({ limit: '3mb' })` | `server.js` |
| P2-3 | 无请求超时 | `req/res.setTimeout(15000)` | `server.js` |
| P2-4 | 无 graceful shutdown | `SIGTERM/SIGINT` → `server.close()` + `db.closeDb()` | `server.js` |

---

## 2026-04-08 — P1 功能缺陷 + P3 性能优化（commit c510114）

### P1 — 功能缺陷（全部修复 ✅）

| # | 问题 | 修复方案 | 文件 |
|---|------|---------|------|
| P1-1 | `INSERT OR REPLACE` 导致审计 before_value 为 null | 改用 `UPDATE`（旧记录）+ `INSERT`（新记录） | `server.js` |
| P1-2 | `writeAudit` 不写 before_value 列 | 新增 `beforeValue` 参数，`before_value` 和 `after_value` 正确分离 | `server.js` |
| P1-3 | `key_creators.js` 被 require 但从未使用 | 此前已清理 | — |
| P1-4 | `is_active` 参数从未使用 | 实际上 SQL 过滤已存在（line 90-93），无需修改 | `server.js` |

### P3 — 性能与代码质量（全部修复 ✅）

| # | 问题 | 修复方案 | 文件 |
|---|------|---------|------|
| P3-1 | `/api/stats` 串行 15+ 次 DB 查询 | 合并为 3 次（ev stats 用 `SUM` 聚合单次查询） | `server.js` |
| P3-2 | `getCreatorFull` N+1（4次查询） | LEFT JOIN 合并 creator + wacrm + joinbrands → 2次 | `db.js` |
| P3-3 | `owner` 参数大小写敏感 | `LOWER(wa_owner) = LOWER(?)` 归一化 | `server.js` |
| P3-4 | `/api/creators/:id/messages` 无分页 | 加 `?limit=&offset=` 参数，上限 1000 | `server.js` |

---

## 2026-04-08 — SFT 优化 v2 完成 + Git 版本管理上线

### SFT 语料质量优化 v2（5 项，隐私脱敏除外）

**1. 训练数据质量管控**
- 后端自动判断 status：相似度 ≥85% + 选择 opt1/opt2 → `approved`；否则 → `pending_review`
- 前端不再传 `status`，只传 raw 数据（similarity / is_custom / messages）

**2. SFT Export 上下文完整**
- 导出时使用与前端一致的 system prompt（从共享模板 `src/utils/systemPrompt.js` 读取）
- 包含前 10 轮对话历史（`message_history` 字段）
- metadata 包含 scene / similarity / human_selected / is_custom_input

**3. SHA256 去重机制**
- `sft_memory` 新增唯一索引：`idx_sft_dedup(client_id_hash, input_text_hash, human_output_hash, created_date)`
- 同一客户、同一输入、同一输出、同一天去重，写入时 UPDATE 而非 INSERT

**4. Skip/Reject 反馈闭环**
- `WAMessageComposer.handleSkip` 改为 async，POST 到 `/api/sft-feedback`
- `feedback_type=skip`，记录 input_text / opt1 / opt2 / scene / client_id
- `sft_feedback` 表新增字段：client_id / input_text / opt1 / opt2 / scene / detail

**5. 模型能力追踪**
- 新增 `GET /api/sft-memory/trends` 返回近 30 天 opt1/opt2/custom/skipped 采用率趋势
- SFTDashboard 新增 `TrendsPanel`，用原生 SVG 渲染折线图

### 新增文件

| 文件 | 说明 |
|------|------|
| `src/utils/systemPrompt.js` | 共享 system prompt 模板，前后端共用同一份 |
| `.gitignore` | 忽略 node_modules / crm.db / data/*.json 等 |

### 数据库变更（sft_memory）

```sql
ALTER TABLE sft_memory ADD COLUMN input_text_hash TEXT;
ALTER TABLE sft_memory ADD COLUMN human_output_hash TEXT;
ALTER TABLE sft_memory ADD COLUMN created_date TEXT;
ALTER TABLE sft_memory ADD COLUMN client_id_hash TEXT;
ALTER TABLE sft_memory ADD COLUMN similarity INTEGER;
ALTER TABLE sft_memory ADD COLUMN scene TEXT;
ALTER TABLE sft_memory ADD COLUMN message_history TEXT;
ALTER TABLE sft_memory ADD COLUMN system_prompt_version TEXT DEFAULT 'v1';

CREATE UNIQUE INDEX idx_sft_dedup ON sft_memory(
  client_id_hash, input_text_hash, human_output_hash, created_date
);
```

### 数据库变更（sft_feedback 新表）

```sql
CREATE TABLE sft_feedback (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id       TEXT NOT NULL,
  feedback_type   TEXT NOT NULL,   -- 'skip' | 'reject' | 'edit'
  input_text      TEXT,
  opt1            TEXT,
  opt2            TEXT,
  final_output    TEXT,
  scene           TEXT,
  detail          TEXT,
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_feedback_type_scene ON sft_feedback(feedback_type, scene);
CREATE INDEX idx_feedback_client ON sft_feedback(client_id);
```

### 新增 API 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/sft-memory/pending` | 待审核语料列表 |
| `PATCH` | `/api/sft-memory/:id/review` | 审核操作（approve/reject） |
| `GET` | `/api/sft-memory/trends` | 30 天采用率趋势 |
| `POST` | `/api/sft-feedback` | 写入 skip/reject/edit 反馈 |
| `GET` | `/api/sft-feedback/stats` | 反馈统计（按 type.scene 聚合） |

### 前端变更

- `SFTDashboard.jsx` 新增 `review` / `trends` / `evaluation` Tab
- `ReviewPanel`：展示待审核记录，approve/reject 按钮
- `TrendsPanel`：SVG 折线图展示 opt1/opt2/custom/skipped 采用率趋势
- `StatCard` 新增 `red` 颜色映射（待审核统计卡片）
- `legacy/minimax.js` 改用共享 `systemPrompt.js` 模板（legacy 参考实现）

### Git 版本管理

- 初始化 git 仓库（`git init`）
- `.gitignore` 排除：node_modules / crm.db* / data/*.json / .wwebjs_auth / .env
- 首次提交：`23ff621 feat: initial commit - WA CRM v2`
- 远程仓库：`git@git.k2lab.ai:lets-ai/whatsapp-mgr.git`

---

## 2026-04-07 — 初始版本（git commit 前状态）

项目基础结构，包含：
- Express + SQLite CRM（端口 3000）
- React + Vite + TailwindCSS 前端
- Experience Router（Beau / Yiyun 专属 AI 体验）
- Scene 检测 11 类
- Jaccard 相似度
- Profile Agent（多源标签提取）
- SFT 语料收集（SFTDashboard + WAMessageComposer）
- JoinBrands / Keeper 数据同步
- `operator_experiences` 表（Beau/Yiyun 话术配置）
- `client_tags` 表（ai_extracted / sft_feedback / keeper_update / manual 四源打标）
