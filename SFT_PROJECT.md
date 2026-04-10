# WA CRM v2 — SFT 语料训练项目

> 本文档供其他 AI Agent 阅读学习使用
> 更新时间：2026-04-10（画像标签提取升级：关键词→LLM + RLHF 修复 + Prompt 对齐）
> 前置文档：`CLAUDE.md`（项目入口）、`BOT_INTEGRATION.md`（API 速查）

---

## 项目概述

WA CRM v2 是一个面向 WhatsApp 达人（influencer）的 CRM 系统，同时也是一个 **SFT（Supervised Fine-Tuning）语料收集平台**。系统通过人工审核机制收集优质对话数据，用于训练 AI 自动回复模型。

---

## 项目路径

```
/Users/depp/wa-bot/wa-crm-v2/
```

---

## 版本历史

### v8 — 2026-04-10 client_memory 自动积累机制（方案设计）

**背景**：`client_memory` 表当前为空（0 条记录），Profile Agent 和 Experience Router 均读取该表，但在 AI 回复生成、SFT 语料选择、事件创建等关键节点均未自动写入记忆。

**目标**：在以下三个触发点自动提取对话内容写入 `client_memory`，形成客户画像积累：

| 触发点 | 时机 | 可提取内容 |
|--------|------|-----------|
| AI 回复生成后 | `generateViaExperienceRouter()` 成功时 | 客户偏好（preference）、决策（decision） |
| SFT 人工选择后 | 人工从 opt1/opt2/custom 中确认最终发送内容时 | 客户风格偏好（style）、回复偏好（preference） |
| 事件创建时 | `scripts/generate-events-from-chat.cjs` 分析出事件时 | 政策理解（policy）、决策状态（decision） |

**去重机制**：已有 `UNIQUE(client_id, memory_type, memory_key)` 唯一索引，同一客户的同类型同 key 记录不重复写入。

**实现路径详见下方「client_memory 自动积累机制」章节。**

### v7 — 2026-04-10 画像标签提取升级：关键词 → MiniMax LLM

**本次升级将客户画像标签提取从正则关键词替换为 MiniMax LLM 智能分类：**

| 改动项 | 说明 |
|--------|------|
| 提取方式 | 正则关键词 → MiniMax LLM 结构化标签 |
| 标签体系 | 8 大类（format/tone/urgency/engagement/intent/topic/preference/stage），覆盖 40+ 标签 |
| 标签结构 | `{ tag: "intent:purchase_intent", reason: "用户明确表示想购买", confidence: 2 }` |
| 降级策略 | LLM 调用失败时返回空标签数组，不阻断主流程 |
| 响应时间 | 15s timeout，非阻塞 |

**`extractTagsWithLLM(text)` 调用链：**
```
POST /api/profile-agent/event
    ↓
extractTagsWithLLM(text)
    ↓
MiniMax API（mini-max-typing，temperature=0.2）
    ↓
JSON.parse LLM 返回的 { tags: [...] } 结构
    ↓
INSERT IGNORE client_tags（confidence 从 LLM 响应获取，默认 2）
    ↓
scheduleProfileRefresh(client_id)  // 5s debounce → MiniMax summary
```

**新增文件：** 无（全部在 `server/routes/profile.js` 内实现）

### v6 — 2026-04-10 RLHF 问题修复 + Prompt 对齐

**本次修复解决 RLHF 训练数据与推理 Prompt 不对齐的核心问题：**

| 修复项 | 说明 |
|--------|------|
| Prompt 对齐（P0）| `WAMessageComposer` 改用 `POST /api/ai/system-prompt` 获取 `systemPromptBuilder.cjs` 构建的完整 prompt |
| 对话格式对齐（P0）| sft-export 与推理使用完全相同的 prompt 组装逻辑（前端上下文 + 后端 operator/policy） |
| Reply Style 统一（P0）| `REPLY_STYLE` 常量注入 `systemPromptBuilder.cjs`，训练/推理共用同一套风格规则 |
| Context 完整捕获（P0）| `sft_memory` 新增 `system_prompt_used` 列，`generateViaExperienceRouter` 返回实际 prompt 供存储，解决 sft-export 重新构建导致的 prompt 漂移 |
| Prompt 版本追踪（P1）| `system_prompt_version` 升级为 `'v2'`，动态从 `buildFullSystemPrompt` 返回 |
| 灰度路由（P1）| `POST /api/minimax` 实现 `USE_FINETUNED` + `AB_RATIO` 10% 灰度逻辑 |
| 后端 Experience Router（P2）| operator 检测从 `client_id` 下沉到 `buildFullSystemPrompt`（前端不再传 operator 字段） |
| 训练门槛检查（P3）| `GET /api/sft-training-status` 返回 approved/custom/scene 覆盖状态 + 下一步建议 |

### v5 — 2026-04-10 MySQL 迁移 + 模块化架构

本次重构完成数据库从 SQLite 到 MySQL 的完整迁移，以及后端模块化：

| 改动项 | 说明 |
|--------|------|
| 数据库 | SQLite → MySQL 9.x（`mysql2/promise` 异步封装） |
| 服务入口 | 单一 `server.js` → `server/index.cjs`（模块化） |
| 路由拆分 | 所有路由移至 `server/routes/` |
| SFT Service | 提取为 `server/services/sftService.js` |
| Profile Service | 异步画像刷新，提取为 `server/services/profileService.js` |
| WA Worker | WhatsApp 爬虫（实时监听 + 增量轮询），`server/waWorker.js` |
| WA Service | WhatsApp Client 管理，`server/services/waService.js` |
| 新增表 | `creator_aliases`、`manual_match`、`sync_log`、`event_periods`、`events_policy` |
| OpenAI 支持 | `USE_OPENAI=true` 时路由到 OpenAI |
| 事件系统 | `events.js` 完整实现（检测/判定/GMV核查/周期），修复 N+1 查询 |
| ev_replied | creators 列表通过 SQL 子查询计算（对方最后消息是否已回复） |

**新增文件**：
- `server/index.cjs` — Express 模块化入口
- `db.js` — MySQL ORM（`mysql2/promise`）
- `schema.sql` — MySQL schema（utf8mb4_unicode_ci）
- `server/waWorker.js` — WhatsApp 爬虫
- `server/services/waService.js` — WhatsApp Client
- `server/services/sftService.js` — SFT 数据访问封装
- `server/services/profileService.js` — 异步画像刷新
- `server/routes/` — 拆分后的所有路由
- `server/middleware/` — 中间件
- `server/constants/eventKeywords.js` — 事件关键词
- `server/utils/policyMatcher.js` — 事件策略匹配
- `src/components/WorkerStatusBar.jsx` — WA Worker 进度条

### v4 — 2026-04-09 RLHF 链路修复

本次修复打通了 RLHF 训练所需的数据闭环：

| 修复项 | 说明 |
|--------|------|
| Preference Pair | `sft_memory` 新增 `chosen_output`/`rejected_output` 字段，记录被选中/拒绝的回复内容 |
| 训练/推理 prompt 对齐 | 新增 `systemPromptBuilder.cjs`（CJS 共享模块），`experience.js` 推理和 server export 使用同一套 prompt 构建逻辑 |
| sft_feedback 增强 | `sft_feedback` 新增 `reject_reason` 字段，skip 时可记录拒绝原因 |
| 英文数据过滤 | `GET /api/sft-export` 新增 `?lang=en` 参数，只导出纯英文数据 |

**新增文件**：
- `systemPromptBuilder.cjs` — CJS 共享 prompt 构建器，experience.js 和 server export 共用

### v3 — 2026-04-09 文档修订

本次更新修正了与实际代码不符的内容：

| 修复项 | 说明 |
|--------|------|
| schema.sql | 补加 `client_id_hash` 列（ALTER TABLE），此前唯一索引 `idx_sft_dedup` 引用了未创建的列 |
| similarity 阈值 | 文档原写 50，纠正为 **85**，与 server.js 后端逻辑一致 |
| Scene 检测表格 | 完全重写，对齐 `WAMessageComposer.jsx` 实际 11 类场景（移除不存在的 `mcn_inquiry`、`unknown`，新增 `gmv_inquiry`、`follow_up`） |

### v2 — 2026-04-07 优化版本

本次更新完成了 5 项 SFT 语料质量优化（隐私脱敏除外）：

| 优化项 | 说明 |
|--------|------|
| 训练数据质量管控 | 后端自动分级，相似度 <85% 或人工输入 → `pending_review`，≥85% + opt1/opt2 → `approved` |
| 完整 Export 上下文 | 导出时使用与前端一致的 system prompt，包含前 10 轮对话历史 |
| SHA256 去重机制 | `(client_id_hash, input_text_hash, human_output_hash, created_date)` 唯一索引，防止重复语料 |
| Skip/Reject 反馈闭环 | `handleSkip` 时写 `sft_feedback` 表，`feedback_type=skip`，用于 RLHF |
| 模型能力追踪 | `/api/sft-memory/trends` 返回近 30 天 opt1/opt2/custom/skipped 采用率趋势 |

---

## 核心文件

### 后端（模块化）

| 文件 | 说明 |
|------|------|
| `server/index.cjs` | Express 服务器入口，端口 3000 |
| `db.js` | MySQL ORM（`mysql2/promise` 异步封装，对外接口与 better-sqlite3 一致） |
| `schema.sql` | MySQL 数据库 schema 定义 |
| `systemPromptBuilder.cjs` | CJS 共享 prompt 构建器（experience.js 和 export 共用） |

**路由（`server/routes/`）**

| 文件 | 说明 |
|------|------|
| `creators.js` | 达人 CRUD + wacrm 数据更新 |
| `messages.js` | 消息读写 |
| `stats.js` | 全局统计 + 健康检查 |
| `ai.js` | MiniMax/OpenAI API 代理 + 翻译接口 |
| `sft.js` | SFT 语料写入/查询/导出/反馈 |
| `policy.js` | 政策文档管理 |
| `audit.js` | 审计日志 + AB 评估数据 |
| `profile.js` | 客户画像 + 标签 + 记忆 |
| `events.js` | 事件系统（检测/判定/GMV核查/周期） |
| `experience.js` | Experience Router（AI 体验路由） |
| `wa.js` | WhatsApp 发送/状态查询 |

**中间件（`server/middleware/`）**

| 文件 | 说明 |
|------|------|
| `audit.js` | `writeAudit()` 审计日志写入 |

**服务（`server/services/`）**

| 文件 | 说明 |
|------|------|
| `waService.js` | WhatsApp 单账号 Client（LocalAuth + 扫码认证 + 重连） |
| `sftService.js` | SFT 语料与反馈数据访问封装 |
| `profileService.js` | 异步画像摘要刷新（debounced 5s） |

**Worker**

| 文件 | 说明 |
|------|------|
| `server/waWorker.js` | WhatsApp 爬虫（实时监听 + 增量轮询 5 分钟） |

### 前端（React + Vite + TailwindCSS）

| 文件 | 说明 |
|------|------|
| `src/App.jsx` | 主应用 — 三面板布局（flex + 拖拽调整宽度）+ 移动端响应式 |
| `src/components/WAMessageComposer.jsx` | 消息编辑器，含 Scene 检测 + AI 生成 + 移动端 UI |
| `src/components/SFTDashboard.jsx` | SFT 语料看板（含 records/review/trends/evaluation 四个子 Tab） |
| `src/components/EventPanel.jsx` | 事件管理面板（含列表、详情、创建、判定）|
| `src/components/WorkerStatusBar.jsx` | WA Worker 可视化进度条（可拖拽、展开/收缩）|
| `src/utils/systemPrompt.js` | **共享 system prompt 模板**，前后端共用同一份 |
| `src/utils/minimax.js` | MiniMax API Client |
| `src/utils/openai.js` | OpenAI API Client（`USE_OPENAI=true` 时使用） |

### 原始数据

```
data/*.json   # 120个达人的每日对话数据（JSON格式）
              文件名格式：{phone}_{name}_{date}.json
              例：16145639865_Jessica_614jessicam__2026-04-03.json
```

---

## 数据库 Schema

> **MySQL 9.x**（已从 SQLite 迁移），字符集 `utf8mb4_unicode_ci`，数据库名 `wa_crm_v2`

### sft_memory — SFT 训练语料表（核心）

```sql
CREATE TABLE sft_memory (
    id                      INT AUTO_INCREMENT PRIMARY KEY,
    model_opt1              TEXT,
    model_opt2              TEXT,
    human_selected          VARCHAR(16) NOT NULL,   -- 'opt1'|'opt2'|'custom'
    human_output            TEXT NOT NULL,
    model_predicted         VARCHAR(16),
    model_rejected          VARCHAR(16),
    is_custom_input         TINYINT(1) DEFAULT 0,
    human_reason            TEXT,
    context_json            JSON,
    status                  VARCHAR(32) DEFAULT 'approved',
    reviewed_by             VARCHAR(64),
    similarity              INT,
    scene                   VARCHAR(64),
    message_history         JSON,                   -- 前10轮对话历史
    system_prompt_version   VARCHAR(16) DEFAULT 'v1',
    client_id_hash          VARCHAR(64),            -- SHA256(client_id)
    input_text_hash         VARCHAR(64),            -- SHA256(input_text)
    human_output_hash       VARCHAR(64),            -- SHA256(human_output)
    created_date            DATE,                   -- YYYY-MM-DD
    chosen_output           TEXT,                   -- 被选中的回复（RLHF Preference Pair）
    rejected_output         TEXT,                   -- 被拒绝的回复（RLHF Preference Pair）
    system_prompt_used      TEXT,                   -- 推理时实际使用的完整 system prompt（解决训练/推理 prompt 漂移）
    created_at              DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX idx_sft_dedup ON sft_memory(
    client_id_hash, input_text_hash, human_output_hash, created_date
);
```

**状态流转：**

```
自动记录 → pending_review  (similarity < 85 或选择了 custom)
自动记录 → approved        (similarity ≥ 85 且选择了 opt1/opt2)
人工直接输入高风险 → needs_review
pending_review → approved  (人工审核通过)
pending_review → rejected  (人工审核拒绝)
needs_review → approved    (人工确认)
```

**训练数据格式说明：**

```
human_selected = 'opt1'  →  训练时 human_output 的标签 = model_opt1
human_selected = 'opt2'  →  训练时 human_output 的标签 = model_opt2
human_selected = 'custom' →  human_output 是人工写的，用于训练模型生成类似风格的回复
is_custom_input = 1      →  人工覆盖了模型结果，对模型改进更有价值
```

### client_memory — 客户单独记忆

```sql
CREATE TABLE client_memory (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id           TEXT NOT NULL,      -- wa_phone 或 keeper_username
  memory_type         TEXT NOT NULL,      -- 'preference' | 'decision' | 'style' | 'policy'
  memory_key          TEXT,               -- 记忆标签
  memory_value        TEXT,               -- 记忆内容
  source_record_id    INTEGER REFERENCES sft_memory(id),
  confidence          INTEGER DEFAULT 1,
  created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(client_id, memory_type, memory_key)
);
```

### sft_feedback — Skip/Reject/Edit 反馈记录

```sql
CREATE TABLE sft_feedback (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id       TEXT NOT NULL,              -- wa_phone（隔离标识）
  feedback_type   TEXT NOT NULL,              -- 'skip' | 'reject' | 'edit'
  input_text      TEXT,                       -- 用户输入
  opt1            TEXT,                       -- AI 候选 A
  opt2            TEXT,                       -- AI 候选 B
  final_output    TEXT,                       -- 最终发送内容（edit 时填）
  scene           TEXT,                        -- 场景标签
  detail          TEXT,                        -- 补充说明
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_feedback_type_scene ON sft_feedback(feedback_type, scene);
CREATE INDEX idx_feedback_client ON sft_feedback(client_id);
```

---

### policy_documents — 政策文档与输出底线

```sql
CREATE TABLE policy_documents (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  policy_key          TEXT UNIQUE NOT NULL,   -- 如 'mcn_policy_v2.3'
  policy_version      TEXT NOT NULL,
  policy_content      TEXT NOT NULL,           -- JSON 格式规则内容
  applicable_scenarios TEXT,                 -- JSON array: ['mcn_inquiry', '分成询问']
  is_active           INTEGER DEFAULT 1,
  created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at          DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

---

## REST API 端点

### SFT 语料相关

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/sft-memory` | 查询语料列表（支持 `?limit=50&offset=0`） |
| `POST` | `/api/sft-memory` | **写入单条语料**（后端自动判断 status） |
| `GET` | `/api/sft-memory/pending` | 待审核语料列表（status = pending_review/needs_review） |
| `PATCH` | `/api/sft-memory/:id/review` | 审核操作 `{ action: "approve" \| "reject", comment }` |
| `GET` | `/api/sft-memory/stats` | 语料统计（total/opt1/opt2/custom 分布 + pending_review 数量） |
| `GET` | `/api/sft-memory/trends` | 近 30 天采用率趋势 |
| `GET` | `/api/sft-export` | 导出 SFT 训练数据（支持 `?format=jsonl`，`?lang=en`） |
| `POST` | `/api/sft-feedback` | 写入 skip/reject/edit 反馈 |
| `GET` | `/api/sft-feedback/stats` | 反馈统计（按 type.scene 聚合） |
| `GET` | `/api/ab-evaluation` | A/B 评估数据（按场景 + 负责人分布） |
| `GET` | `/api/client-memory/:clientId` | 查询客户记忆 |
| `POST` | `/api/client-memory` | 更新客户记忆（UPSERT） |

### Experience Router

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/experience/operators` | 列出所有 operator 体验配置 |
| `GET` | `/api/experience/:operator` | 获取单个 operator 完整体验 |
| `GET` | `/api/experience/:operator/clients` | 获取该 operator 下的所有客户 |
| `POST` | `/api/experience/route` | **核心路由**：生成 AI 候选回复 |
| `GET` | `/api/experience/:operator/system-prompt` | 编译后的完整 system prompt（调试用） |

### 事件系统

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/events` | 查询事件列表（支持 `?status=&owner=&creator_id=&event_key=`） |
| `GET` | `/api/events/:id` | 事件详情（含 periods + policy） |
| `POST` | `/api/events` | 创建事件 |
| `PATCH` | `/api/events/:id` | 更新事件状态/结束时间 |
| `DELETE` | `/api/events/:id` | 删除事件（仅 pending 状态） |
| `POST` | `/api/events/detect` | 语义检测事件 |
| `GET` | `/api/events/:id/periods` | 获取事件周期列表 |
| `POST` | `/api/events/:id/judge` | 判定周期（计算 bonus） |
| `POST` | `/api/events/gmv-check` | GMV 里程碑批量核查（修复 N+1） |
| `GET` | `/api/events/summary/:creatorId` | 达人事件汇总 |
| `GET` | `/api/events/policy/:owner/:eventKey` | 获取事件策略配置 |

### 客户画像

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/client-profile/:clientId` | 获取完整客户画像 |
| `PUT` | `/api/client-profile/:clientId` | 更新画像 summary |
| `PUT` | `/api/client-profiles/:clientId/tags` | 手工标签管理 |
| `POST` | `/api/client-profiles/:clientId/memory` | 添加客户记忆 |
| `DELETE` | `/api/client-profiles/:clientId/memory` | 删除客户记忆 |
| `POST` | `/api/profile-agent/event` | 触发画像更新（自动提取标签） |

### 达人数据

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/creators` | 达人列表（支持 `owner/search/is_active/beta_status/priority/agency/event` 过滤） |
| `GET` | `/api/creators/:id` | 达人完整信息 |
| `PUT` | `/api/creators/:id` | 更新达人基本信息 |
| `PUT` | `/api/creators/:id/wacrm` | 更新 WA CRM 数据（含级联逻辑） |
| `GET` | `/api/creators/:id/messages` | 达人消息历史 |
| `POST` | `/api/creators/:id/messages` | 写入消息 |

### AI / 翻译

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/api/minimax` | MiniMax API 代理（并发两个温度生成 opt1/opt2） |
| `POST` | `/api/translate` | 翻译接口（支持单条和批量） |
| `POST` | `/api/ai/generate` | 独立 OpenAI 生成接口（需 `USE_OPENAI=true`） |

### WhatsApp

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/api/wa/send` | 发送 WA 消息 |
| `GET` | `/api/wa/status` | 查询 WA 连接状态 |
| `GET` | `/api/wa/qr` | 二维码状态（提示去终端扫码） |
| `GET` | `/api/wa-worker/status` | WA Worker 同步进度 |

### 审计与统计

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/audit-log` | 查询审计日志（支持 `?action=&limit=50`） |
| `GET` | `/api/stats` | 全局统计数据 |
| `GET` | `/api/health` | 健康检查 |

### Policy

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/policy-documents` | 获取所有政策文档（`?active_only=true`） |
| `POST` | `/api/policy-documents` | 创建/更新政策文档（UPSERT） |

---

## 语料生成流程

### 写入时自动分级（v2）

```
用户发消息
    ↓
AI 生成 A/B 两个候选回复
    ↓
用户选择 A/B/Custom 或跳过
    ↓
POST /api/sft-memory 写入语料
    ↓
后端自动判断 status：
  similarity ≥ 85 + 选择 opt1/opt2  → approved
  similarity < 85 或选择 custom    → pending_review
    ↓
pending_review → 人工审核 → approved / rejected
```

### 写入数据结构（v2，前端传 raw 数据，后端判断 status）

```javascript
POST /api/sft-memory
{
  "model_candidates": {
    "opt1": "Hi! Thanks for your interest. Our 7-day trial is...",
    "opt2": "Hello! Great to hear from you. Let me share our..."
  },
  "human_selected": "custom",        // 选择了人工输入
  "human_output": "Hi Jessica! Welcome — your 7-day free trial starts now.",
  "diff_analysis": {
    "model_predicted": "opt2",
    "model_rejected": "opt1",
    "is_custom": true,
    "similarity": 72                 // v2 新增，后端据此判断 status
  },
  "context": {
    "client_id": "16145639865",
    "client_name": "Jessica",
    "wa_owner": "Beau",
    "scene": "trial_intro",
    "input_text": "Hi! I'd like to know about your trial program"
  },
  "messages": [...]                  // v2 新增，前10轮对话历史
}
```

### 导出数据结构（v2，完整 prompt + 对话历史）

```javascript
GET /api/sft-export?limit=1
{
  "messages": [
    { "role": "system", "content": "你是一个专业的达人运营助手..." },  // 完整 system prompt
    { "role": "user", "content": "Hi! I'd like to know about your trial" },  // 第N轮输入
    { "role": "assistant", "content": "human_output 字段的值" }
  ],
  "metadata": {
    "scene": "trial_intro",
    "human_selected": "opt2",
    "similarity": 92,
    "is_custom_input": 0,
    "system_prompt_version": "v1"
  }
}
```

### 语料统计

```
GET /api/sft-memory/stats
{
  "total": 45,
  "opt1_selected": 20,
  "opt2_selected": 15,
  "custom_input": 8,
  "pending_review": 2,
  "opt1_rate": "44.4%",
  "opt2_rate": "33.3%",
  "custom_rate": "17.8%",
  "model_override_rate": "17.8%"
}
```

### 趋势数据结构

```
GET /api/sft-memory/trends
{
  "dates": ["2026-03-10", "2026-03-11", ...],  // 近30天
  "opt1_rate": [45.2, 43.8, ...],              // 每日 opt1 采用率
  "opt2_rate": [30.1, 31.2, ...],
  "custom_rate": [24.7, 25.0, ...],
  "skip_rate": [8.5, 9.2, ...],                 // 来自 sft_feedback
  "volume": [42, 38, ...]                       // 每日记录数
}
```

---

## 原始对话数据格式（data/*.json）

```json
{
  "phone": "16145639865",
  "name": "Jessica",
  "keeper_username": "614jessicam",
  "wa_owner": "Beau",
  "messages": [
    {
      "role": "user",          // 客户发来的消息
      "text": "Hi! I'd like to know about your trial program",
      "timestamp": 1744060800000
    },
    {
      "role": "me",            // 运营人员回复
      "text": "Hi Jessica! Great to hear from you...",
      "timestamp": 1744060900000
    }
  ]
}
```

---

## 审计日志（audit_log）

所有数据写入操作都会记录审计日志：

```sql
CREATE TABLE audit_log (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  action          TEXT NOT NULL,          -- sft_create | policy_update | client_memory_update | ...
  table_name      TEXT,
  record_id       INTEGER,
  operator        TEXT DEFAULT 'system',
  before_value    TEXT,                   -- 变更前的值（JSON）
  after_value     TEXT,                   -- 变更后的值（JSON）
  ip_address      TEXT,
  user_agent      TEXT,
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

---

## 客服角色说明

| 角色 | 系统名 | 说明 |
|------|--------|------|
| Beau | Beau | 负责人 |
| Yiyun | YanYiYun | 负责人 |
| YouKe | WangYouKe | 负责人（不在 operators.json 中） |

---

## 如何使用本项目语料训练

### 步骤 1：读取语料

```javascript
// 通过 API（推荐，已包含完整上下文）
const records = await fetch('http://localhost:3000/api/sft-export?limit=1000&status=approved').then(r => r.json());

// 或直接读数据库
const db = require('better-sqlite3')('./crm.db');
const rows = db.prepare('SELECT * FROM sft_memory WHERE status = "approved"').all();
```

### 步骤 2：构造训练数据（v2）

导出的每条记录已包含完整 messages 结构：

```json
{
  "messages": [
    { "role": "system", "content": "你是一个专业的达人运营助手..." },
    { "role": "user", "content": "Hi! I'd like to know about your trial" },
    { "role": "assistant", "content": "human_output 字段的值" }
  ],
  "metadata": {
    "scene": "trial_intro",
    "similarity": 92,
    "human_selected": "opt2",
    "is_custom_input": 0
  }
}
```

`human_selected` 告诉训练流程最终选择了哪个答案：
- `'opt1'` / `'opt2'` → 从模型生成的候选中选择
- `'custom'` → 人工自行编写，是最有价值的训练数据

### 步骤 3：过滤高价值语料

```sql
-- 优先使用人工覆盖数据（is_custom_input = 1）
SELECT * FROM sft_memory WHERE is_custom_input = 1 AND status = 'approved';

-- 按场景过滤
SELECT * FROM sft_memory WHERE scene = 'trial_intro' AND status = 'approved';

-- 过滤低相似度（AI 表现差的记录）
SELECT * FROM sft_memory WHERE similarity >= 85 AND status = 'approved';

-- 查看跳过率高的场景（需结合 sft_feedback）
SELECT scene, COUNT(*) as total,
       SUM(CASE WHEN feedback_type = 'skip' THEN 1 ELSE 0 END) as skips
FROM sft_feedback
GROUP BY scene
ORDER BY skips DESC;
```

### 去重机制（v2）

同一客户、同一输入、同一输出、同一天只会有一条记录。通过 `idx_sft_dedup` 唯一索引保证，写入时会 UPDATE 而非 INSERT。

### 导出格式

```
GET /api/sft-export?format=jsonl&limit=1000  →  每行一条 JSON，适用大规模导出
GET /api/sft-export?format=json&limit=1000   →  JSON 数组，适用小规模调试
```

---

## 政策文档（Policy Documents）

系统中的政策文档用于约束 AI 输出底线，在生成回复前必须参考：

```javascript
GET /api/policy-documents?active_only=true
[
  {
    "policy_key": "mcn_policy_v2.3",
    "policy_version": "2.3",
    "policy_content": "...",
    "applicable_scenarios": ["mcn_inquiry", "commission_query"]
  }
]
```

---

## 相关文件位置速查

| 资源 | 路径 |
|------|------|
| SFT 语料数据库 | MySQL `wa_crm_v2`（`crm.db` 已弃用） |
| Schema | `/Users/depp/wa-bot/wa-crm-v2/schema.sql` |
| Server 入口 | `/Users/depp/wa-bot/wa-crm-v2/server/index.cjs` |
| DB ORM | `/Users/depp/wa-bot/wa-crm-v2/db.js` |
| System Prompt Builder | `/Users/depp/wa-bot/wa-crm-v2/systemPromptBuilder.cjs` |
| SFT Dashboard | `/Users/depp/wa-bot/wa-crm-v2/src/components/SFTDashboard.jsx` |
| 消息编辑器 | `/Users/depp/wa-bot/wa-crm-v2/src/components/WAMessageComposer.jsx` |
| 事件面板 | `/Users/depp/wa-bot/wa-crm-v2/src/components/EventPanel.jsx` |
| WA Worker 进度条 | `/Users/depp/wa-bot/wa-crm-v2/src/components/WorkerStatusBar.jsx` |
| 共享 System Prompt | `/Users/depp/wa-bot/wa-crm-v2/src/utils/systemPrompt.js` |
| AI 生成（MiniMax） | `/Users/depp/wa-bot/wa-crm-v2/src/utils/minimax.js` |
| OpenAI 生成 | `/Users/depp/wa-bot/wa-crm-v2/src/utils/openai.js` |
| Experience Router | `/Users/depp/wa-bot/wa-crm-v2/server/routes/experience.js` |
| SFT Routes | `/Users/depp/wa-bot/wa-crm-v2/server/routes/sft.js` |
| Events Routes | `/Users/depp/wa-bot/wa-crm-v2/server/routes/events.js` |
| WA Worker | `/Users/depp/wa-bot/wa-crm-v2/server/waWorker.js` |
| WA Service | `/Users/depp/wa-bot/wa-crm-v2/server/services/waService.js` |
| Profile Service | `/Users/depp/wa-bot/wa-crm-v2/server/services/profileService.js` |
| SFT Service | `/Users/depp/wa-bot/wa-crm-v2/server/services/sftService.js` |
| Event Keywords | `/Users/depp/wa-bot/wa-crm-v2/server/constants/eventKeywords.js` |
| Policy Matcher | `/Users/depp/wa-bot/wa-crm-v2/server/utils/policyMatcher.js` |
| 原始对话数据 | `/Users/depp/wa-bot/wa-crm-v2/data/*.json` |

---

## 事件标签体系

### 事件标签（EVENT_BADGES）

事件标签存储在 `joinbrands_link` 表，由 JoinBrands 系统同步或运营手动更新，用于 Kanban 看板自动分组：

| 字段 | 标签名 | 颜色 | 含义 |
|------|--------|------|------|
| `ev_trial_7day` | 7天试用 | 蓝 | 进入试用阶段 |
| `ev_monthly_invited` | 月卡邀请 | 紫 | 已发送月卡邀请 |
| `ev_monthly_joined` | 月卡加入 | 绿 | 已加入月卡 |
| `ev_whatsapp_shared` | WA已发 | 青 | WhatsApp 已分享 |
| `ev_gmv_1k` | GMV>1K | 橙 | JoinBrands GMV 超 1k |
| `ev_gmv_3k` | GMV>3K | 深橙 | JoinBrands GMV 超 3k |
| `ev_gmv_10k` | GMV>10K | 红 | JoinBrands GMV 超 10k |
| `ev_churned` | 已流失 | 红 | 已确认流失 |

**Kanban 看板分组逻辑：**

```javascript
const KANBAN_COLUMNS = [
  { key: 'new',      label: '🆕 新建',  filter: c => !c.msg_count },           // 从未发过消息
  { key: 'active',   label: '🔥 活跃',  filter: c => c.msg_count > 5 },        // 消息数 > 5
  { key: 'trial',    label: '⏳ 试用中', filter: c => c.ev_trial_7day },       // 试用中
  { key: 'monthly',  label: '💎 月卡',   filter: c => c.ev_monthly_joined },   // 月卡用户
  { key: 'churned',  label: '⚠️ 流失',  filter: c => c.ev_churned },          // 已流失
]
```

---

## 动态标签体系（client_tags）

`client_tags` 表记录多来源打标，同一客户同一标签可来自多个来源，置信度取最高值：

```sql
CREATE TABLE client_tags (
  client_id   TEXT NOT NULL,          -- wa_phone（隔离标识）
  tag         TEXT NOT NULL,          -- 标签名，如 "tone:formal"
  source      TEXT NOT NULL,          -- ai_extracted | sft_feedback | keeper_update | manual
  confidence  INTEGER DEFAULT 1,       -- 1-3 置信度，值越大越可信
  UNIQUE(client_id, tag, source)       -- 同来源同标签不会重复
);
```

### 标签来源详解

#### 1. ai_extracted — 从 WA 消息 MiniMax LLM 提取（v7 升级）

触发时机：客户发消息后，由 `POST /api/profile-agent/event` 调用 `extractTagsWithLLM()`。

**提取方式：** MiniMax LLM（`mini-max-typing`，temperature=0.2）结构化 JSON 输出，包含标签 + 理由 + 置信度。

**标签体系（8 大类）：**

| 类别 | 标签示例 | 说明 |
|------|---------|------|
| `format` | `video`, `text`, `voice`, `image`, `carousel` | 内容格式偏好 |
| `tone` | `formal`, `casual`, `aggressive`, `friendly`, `hesitant` | 对话语气 |
| `urgency` | `high`, `medium`, `low` | 紧迫程度 |
| `engagement` | `high`, `medium`, `low`, `passive` | 参与度 |
| `intent` | `purchase_intent`, `info_seeking`, `complaint`, `renewal`, `upgrade`, `churn_risk`, `referral` | 意图分类 |
| `topic` | `pricing`, `demo`, `tutorial`, `contract`, `trial`, `commission`, `payment`, `gmv`, `mcn`, `content`, `violation` | 话题分类 |
| `preference` | `video_preferred`, `text_preferred`, `async_communication`, `detailed_response`, `brief_response` | 偏好特征 |
| `stage` | `first_contact`, `trial_intro`, `trial_active`, `monthly_inquiry`, `mcn_joined`, `churned`, `loyal` | 客户阶段 |

**LLM 输出格式：**
```json
{
  "tags": [
    { "tag": "intent:purchase_intent", "reason": "用户明确表示想购买产品", "confidence": 3 },
    { "tag": "tone:formal", "reason": "使用了please和would等礼貌用语", "confidence": 2 },
    { "tag": "engagement:high", "reason": "用户主动询问多个问题", "confidence": 2 }
  ]
}
```

**降级处理：** LLM 调用超时（15s）或失败时返回空数组，不阻断 `scheduleProfileRefresh` 主流程。

**代码位置：** `server/routes/profile.js` → `extractTagsWithLLM()`

#### 2. sft_feedback — 从 SFT 记录学习

触发时机：SFT 记录写入后。

| 条件 | 标签 |
|------|------|
| 任何 SFT 记录 | `scene:{scene}` |
| human_selected = 'custom'（模型被覆盖） | `scene:{scene}:ai_weak`（该场景 AI 弱） |
| human_selected = 'opt1' 或 'opt2'（模型被采纳） | `scene:{scene}:ai_strong`（该场景 AI 强） |

#### 3. keeper_update — 从 Keeper TikTok 数据提取

触发时机：Keeper 数据同步后。

| 条件 | 标签 |
|------|------|
| GMV ≥ 3000 | `gmv_tier:high` |
| GMV ≥ 1000 | `gmv_tier:medium` |
| GMV < 1000 | `gmv_tier:low` |
| 视频数 ≥ 20 | `content_active:high` |
| 视频数 ≥ 5 | `content_active:medium` |
| 视频数 < 5 | `content_active:low` |

#### 4. manual — 运营手工标注

触发时机：运营人员在 UI 手动打标，调用 `PUT /api/client-profiles/:id/tags`。

---

## 客户画像 Agent（Profile Agent）

### 事件类型

| event_type | 触发时机 | 提取内容 |
|------------|---------|---------|
| `wa_message` | 客户发消息后 | MiniMax LLM 8类标签（intent/tone/format/urgency/engagement/topic/preference/stage） |
| `sft_record` | SFT 记录写入后 | 场景 AI 表现（强/弱）标签 |
| `keeper_update` | Keeper 数据同步后 | GMV tier / content_active 标签 |
| `manual_tag` | 运营人员手工标注 | 自定义标签 |

### API 端点

```
POST /api/profile-agent/event   — 触发画像更新
GET  /api/client-profile/:id   — 获取完整画像
PUT  /api/client-profiles/:id/tags — 手工标签管理
```

### 画像输出格式

```javascript
{
  "client_id": "16145639865",
  "name": "Jessica",
  "wa_owner": "Beau",
  "summary": "Jessica，美妆达人，主攻视频内容，转化阶段试用中",
  "tags": [
    { "tag": "format:video", "source": "ai_extracted", "confidence": 2 },
    { "tag": "tone:casual", "source": "ai_extracted", "confidence": 2 },
    { "tag": "scene:trial_intro", "source": "ai_extracted", "confidence": 2 }
  ],
  "tiktok_data": { "keeper_gmv": 3200, "keeper_videos": 28 },
  "stage": "trial_intro",
  "memory": [
    { "type": "preference", "key": "format", "value": "video" }
  ]
}
```

### 隔离规则

- 所有标签按 `client_id` 隔离
- AI 调用 `/api/client-profile/:id` 时只能拿到当前客户的画像
- Summary 生成后异步更新，不阻塞响应

### Debounce 防重复刷新

`scheduleProfileRefresh(clientId)` 通过 Map 实现 5 秒内同一 client 的去重刷新：

```javascript
// 同一 client 5 秒内的重复调用会被忽略
const _pendingRefresh = new Map();
function scheduleProfileRefresh(clientId) {
    if (_pendingRefresh.has(clientId)) return;
    const handle = setImmediate(async () => {
        _pendingRefresh.delete(clientId);
        await refreshProfileSummary(clientId);
    });
    _pendingRefresh.set(clientId, handle);
    setTimeout(() => _pendingRefresh.delete(clientId), 5000);
}
```

---

## Experience Router（按负责人路由 AI 体验）

> **核心原则**：同一事件类型 + 不同负责人 = 不同判定逻辑 + 不同奖励规则
> 不同 operator（Beau / Yiyun）使用不同的 AI 体验（话术体系、政策约束、场景处理）

### operator_experiences 表

```sql
CREATE TABLE operator_experiences (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  operator            TEXT UNIQUE NOT NULL,   -- 'Beau' | 'Yiyun' | 'WangYouKe'
  display_name        TEXT NOT NULL,
  description        TEXT,
  system_prompt_base  TEXT NOT NULL,           -- 基础 system prompt 模板
  scene_config        TEXT,                    -- JSON: scene → prompt fragment 映射
  forbidden_rules     TEXT,                    -- JSON array: 额外禁止规则
  is_active           INTEGER DEFAULT 1,
  priority            INTEGER DEFAULT 0,       -- 路由优先级
  created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at          DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

**预置数据：**

| operator | display_name | 核心差异 |
|----------|-------------|---------|
| Beau | Beau 的运营体验 | 20天Beta计划，$200激励，DRIFTO MCN，$10/天 |
| Yiyun | Yiyun 的运营体验 | 7天试用，$20月费，一问一答，保守回复 |

### scene_config 结构示例（Beau）

```json
{
  "trial_intro": "重点介绍20天Beta计划，$200激励",
  "beta_cycle": "结算时明确起始日期+激励金额",
  "violation": "提供申诉模板，承诺$10补偿",
  "mcn_binding": "解释DRIFTO结构，透明佣金流程",
  "gmv_milestone": "祝贺+$5k/$10k数据刺激",
  "content_request": "5个/天最佳，超6个TikTok降权"
}
```

### forbidden_rules 示例（Yiyun）

```json
[
  "不提Beta program",
  "不说guarantee/definitely",
  "不攻击其他MCN",
  "不发超过3条连续消息",
  "不在北京时间23:00后主动联系"
]
```

### Experience Router API Endpoints

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/experience/operators` | 列出所有 operator 体验配置 |
| `GET` | `/api/experience/:operator` | 获取单个 operator 完整体验（含 scene_config / forbidden_rules） |
| `GET` | `/api/experience/:operator/clients` | 获取该 operator 下的所有客户 |
| `POST` | `/api/experience/route` | **核心路由**：输入 client_id/message，返回 AI 候选回复 |
| `GET` | `/api/experience/:operator/system-prompt` | 编译后的完整 system prompt（调试用） |

### POST /api/experience/route

**请求体：**

```javascript
{
  "client_id": "18459534090",          // 二选一：优先用 client_id 查 wa_owner
  "operator": "Beau",                  // 或直接指定 operator
  "messages": [{"role": "user", "text": "Hi"}],  // 最近10轮对话
  "scene": "first_contact"             // 当前场景
}
```

**响应：**

```javascript
{
  "success": true,
  "operator": "Beau",
  "experience_config": {
    "display_name": "Beau 的运营体验",
    "description": "Beau 专属话术体系，20天Beta计划，$200激励，DRIFTO MCN",
    "scene_config": { ... }
  },
  "system_prompt": "你是一个专业的达人运营助手...",  // 编译后的完整 prompt
  "candidates": {
    "opt1": "Hi Beau! ...",    // temperature=0.8
    "opt2": "Hey! ..."         // temperature=0.4
  }
}
```

### 路由匹配逻辑

```
route(client_id, messages, scene)
  ├─ 根据 client_id 查 wa_owner
  ├─ 若无 client_id：根据 messages/operator 直接匹配
  ├─ 加载对应 operator_experiences 配置
  ├─ 合并 [BASE_PROMPT] + operator_base + scene_fragment
  ├─ 过滤适用政策（按 scene + operator）
  ├─ 生成 2 个候选回复（不同 temperature）
  └─ 返回 { operator, experience_config, candidates }
```

### compileSystemPrompt 组装顺序

```
1. system_prompt_base（替换 [BASE_PROMPT] 标记）
      ↓
2. 客户档案（姓名、负责人、建联阶段）
      ↓
3. 场景适配片段（scene_config[scene]）
      ↓
4. 客户历史偏好（client_memory）
      ↓
5. 场景适用政策（policy_documents.applicable_scenarios 匹配）
      ↓
6. 禁止规则（base 规则 + operator 特有规则）
      ↓
7. 回复要求：简洁专业、100字以内、推动下一步
```

### 路由模块位置

| 文件 | 说明 |
|------|------|
| `routes/experience.js` | Experience Router 核心逻辑 |
| `server.js` | 注册路由 `require('./routes/experience')` at `/api/experience` |
| `migrate-experience.js` | 初始化 operator 体验数据 |
| `src/components/WAMessageComposer.jsx` | 前端调用 `generateViaExperienceRouter()` |

---

## Scene 检测系统（11 类）

`inferScene(text, wacrm, messageCount)` 根据消息内容 + 客户档案判断当前场景（按代码中 if-else 顺序排列，即优先级从高到低）：

| scene 键 | 中文名称 | 英文关键词 | 中文关键词 | 判定条件 |
|----------|---------|-----------|-----------|---------|
| `trial_intro` | 试用介绍 | trial, 7day, 7-day, free challenge, 7天挑战, 试用挑战, 加入挑战 | trial, 7day, 7天, 免费挑战 | 含 trial/7day |
| `monthly_inquiry` | 月卡咨询 | monthly, month, membership, 月费, 包月 | monthly, 会员, 月卡 | 含 monthly/membership |
| `commission_query` | 分成询问 | commission, 分成, 提成, revenue, 佣金, income, earnings | commission | 含 commission/revenue |
| `mcn_binding` | MCN 绑定/签约 | mcn, agency, 经经, 代理, 绑定, contract, 签约 | agency | 含 mcn/agency/签约/绑定 |
| `video_not_loading` | 视频问题 | video not loading, can't upload, 上传不了, 视频不行, video 生成/加载/显示不了 | video | 含 video + loading 相关 |
| `content_request` | 内容请求 | video, 内容, content, 创作, post, 发帖, 发布 | — | 含 video/content/post 且不是 video_not_loading |
| `gmv_inquiry` | GMV 询问 | gmv, sales, 订单, 销售, earnings | — | 含 gmv/sales/earnings |
| `payment_issue` | 付款问题 | payment, paypal, 付款, 收款, 转账, 没收到, 没到账 | — | 含 payment/paypal/付款相关 |
| `violation_appeal` | 违规申诉 | violation, appeal, 申诉, 违规, flagged, strike, 封号, banned, suspended | — | 含 violation/appeal/封号 |
| `follow_up` | 跟进 | — | — | beta_status='introduced' 且 messageCount > 3 |
| `first_contact` | 首次建联 | — | — | messageCount ≤ 1（兜底） |

**优先级规则（代码 if-else 顺序）：**
1. 越靠上优先级越高：trial_intro > monthly_inquiry > commission_query > mcn_binding > video_not_loading > content_request > gmv_inquiry > payment_issue > violation_appeal
2. `follow_up`：beta 已引入且有多轮对话（messageCount > 3）
3. `first_contact`：兜底，新客户或刚建联（messageCount ≤ 1）

---

## 候选回复相似度评分（Jaccard）

### Word-Level Jaccard Similarity

替代原来的字符位置比较，使用 word-level Jaccard 系数：

```javascript
function computeSimilarity(text1, text2) {
    if (!text1 || !text2) return 0;
    const words1 = new Set(text1.toLowerCase().split(/\s+/));
    const words2 = new Set(text2.toLowerCase().split(/\s+/));
    const intersection = new Set([...words1].filter(w => words2.has(w)));
    const union = new Set([...words1, ...words2]);
    return union.size > 0 ? (intersection.size / union.size) * 100 : 0;
}
```

**判定规则（server.js 后端）：**

| 条件 | 结果 |
|------|------|
| similarity < 85 | 触发人工审核（pending_review） |
| similarity ≥ 85 + 选 opt1/opt2 | 自动 approved |
| similarity ≥ 85 + 选 custom | pending_review（需人工审核 custom 内容）|

> 前端 WAMessageComposer 也使用同样逻辑，similarity < 85 时展示黄色警告标签

---

## RLHF 闭环（部分实现 — 2026-04-10）

> **当前状态**：`chosen_output`/`rejected_output` 字段已实现（v4），模型微调/灰度 AB 测未实现。
> **目标**：将 `sft_memory` 中 approved 数据真正用于模型优化，形成"收集→训练→上线→效果追踪"的完整闭环。

### 完整 RLHF 闭环流程

```
┌─────────────────────────────────────────────────────────────────┐
│  第1阶段：数据准备                                               │
│  sft_memory (status=approved) ──→ 导出格式化 ──→ 训练数据集    │
│                                         ↓                        │
│  第2阶段：模型微调                                               │
│  训练数据集 ──→ SFT/LoRA 微调 ──→ 新模型权重                   │
│                                         ↓                        │
│  第3阶段：灰度上线                                               │
│  新模型权重 ──→ 10% 流量 AB测 ──→ 验证提升率                   │
│                         ↓                                       │
│  第4阶段：全量切换 + 效果追踪                                   │
│  全量上线 ──→ 监控 opt1/opt2 采用率 ──→ 对比基线              │
│                         ↓                                       │
│  第5阶段：持续迭代                                              │
│  新数据积累 ──→ 下一轮微调（月粒度）                          │
└─────────────────────────────────────────────────────────────────┘
```

### 第1阶段：数据导出与格式化

**目标**：将 `sft_memory` 中的 approved 记录转换为模型可训练的格式。

**API 已就绪**：`GET /api/sft-export?status=approved&limit=500`

导出的每条记录格式：
```json
{
  "messages": [
    { "role": "system", "content": "<完整system prompt>" },
    { "role": "user", "content": "<input_text 或前10轮对话拼接>" },
    { "role": "assistant", "content": "<human_output>" }
  ],
  "metadata": {
    "scene": "trial_intro",
    "similarity": 92,
    "human_selected": "opt1",
    "is_custom_input": 0,
    "created_date": "2026-04-07"
  }
}
```

**质量过滤**（训练前）：
```sql
-- 优先使用高相似度 + custom 覆盖的数据
SELECT * FROM sft_memory
WHERE status = 'approved'
  AND scene IS NOT NULL
  AND similarity >= 70        -- 去除相似度极低的异常记录
  AND human_selected = 'custom'  -- 人工手写最有价值
ORDER BY similarity DESC;

-- 次选：opt1/opt2 高采纳率数据
SELECT * FROM sft_memory
WHERE status = 'approved'
  AND scene IS NOT NULL
  AND human_selected IN ('opt1', 'opt2')
  AND similarity >= 85;
```

---

### 第2阶段：模型微调

**推荐方案：LoRA 微调**（成本低、速度快，适合小规模数据）

**基础模型选择**：
| 模型 | 规格 | 适用场景 |
|------|------|---------|
| `Qwen2.5-7B-Instruct` | 7B 参数 | 推荐首选，部署成本低，效果好 |
| `Qwen2.5-14B-Instruct` | 14B 参数 | 效果更好，需 24GB+ 显存 |
| `MiniMax-Text-01` | 专家混合 | 需确认供应商是否支持微调 |

**工具链**：
```bash
# 使用 Axolotl（推荐）或 LLaMA-Factory
pip install axolotl

# 训练配置示例（axolotl / qwen2_5_lora.yaml）
base_model: Qwen/Qwen2.5-7B-Instruct
model_type: Qwen2ForCausalLM

dataset:
  path: /path/to/exported/sft_data.jsonl
  type: chatml.interactive

lora:
  r: 8
  lora_alpha: 16
  target_modules: [q_proj, k_proj, v_proj, o_proj]

trainer:
  steps: 1000          # 小数据集 500-1000 步即可
  batch_size: 4
  learning_rate: 0.0002
  scheduler: cosine
  warmup_steps: 50
```

**分场景微调策略**（可选进阶）：
- `trial_intro` / `monthly_inquiry` → 高质量数据单独训练一个 adapter
- `commission_query` / `payment_issue` → 高安全要求，单独训练
- 每类场景 ≥ 50 条 approved 记录才单独训练

---

### 第3阶段：模型服务部署

**自部署（推荐）**：
```bash
# 使用 vLLM 部署 LoRA adapter
python -m vllm.entrypoints.openai.api_server \
  --model Qwen/Qwen2.5-7B-Instruct \
  --lora-prefix ./lora_weights/wacrm_v1 \
  --host 0.0.0.0 --port 8000

# 替换 server.js 中的 MiniMax 调用
# 旧：https://api.minimaxi.com/anthropic
# 新：http://localhost:8000/v1/messages
```

**MiniMax 托管微调**（如果支持）：
- 部分 LLM as Service 平台支持上传 SFT 数据直接微调
- 需确认 MiniMax 是否提供 fine-tuning API

**API 兼容层**（server.js 改动）：
```javascript
// server.js 或 routes/experience.js
const USE_FINETUNED = process.env.USE_FINETUNED ***REMOVED***= 'true';
const FINETUNED_BASE = process.env.FINETUNED_BASE || 'http://localhost:8000/v1/messages';

async function generateResponse(messages, temperature) {
    const body = JSON.stringify({
        model: USE_FINETUNED ? 'qwen-7b-wacrm' : 'mini-max-typing',
        messages,
        max_tokens: 500,
        temperature,
    });

    const response = await fetch(USE_FINETUNED ? FINETUNED_BASE : `${API_BASE}/v1/messages`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${USE_FINETUNED ? 'EMPTY' : API_KEY}`,
        },
        body,
    });
    // ... parse response
}
```

---

### 第4阶段：灰度 AB 测

**灰度策略**：
```
10% 流量：新模型（finetuned）
50% 流量：新模型
40% 流量：原 MiniMax（基线）
```

**效果验证指标**：
| 指标 | 定义 | 目标 |
|------|------|------|
| `opt1_rate` | 用户选择 opt1 的比例 | 提升 ≥ 5% |
| `custom_rate` | 用户自写的比例 | 下降（说明 AI 变强）|
| `skip_rate` | 跳过候选的比例 | 下降 ≥ 10% |
| `p99_latency` | 响应延迟 | < 3s |

**AB 测配置**（server.js）：
```javascript
const AB_CONFIG = {
    finetuned_ratio: 0.1,           // 10% 流量走新模型
    min_samples_for_eval: 100,       // 至少 100 条才做评估
    eval_window_days: 7,             // 评估周期 7 天
};

// 路由时根据随机数决定走哪个模型
function shouldUseFinetuned() {
    return Math.random() < AB_CONFIG.finetuned_ratio;
}
```

---

### 第5阶段：持续迭代

**月度微调节奏**：
```
每月1日：
1. 汇总上月 approved 语料（≥ 200 条才触发微调）
2. 执行新轮 SFT/LoRA 训练
3. 灰度 10% → 全量
4. 记录本月 opt1_rate 相对基线的提升
```

**数据质量门控**：
```sql
-- 触发新训练的数据量门控
SELECT
    COUNT(*) as total_approved,
    SUM(CASE WHEN human_selected = 'custom' THEN 1 ELSE 0 END) as custom_count,
    COUNT(DISTINCT scene) as scene_count
FROM sft_memory
WHERE status = 'approved'
  AND created_at >= DATE('now', '-30 days');

-- 触发条件：total_approved >= 200 AND custom_count >= 20
```

---

### 关键文件清单

| 文件 | 改动 |
|------|------|
| `scripts/export-for-training.js` | 新增：将 approved 记录导出为训练格式 |
| `scripts/train-lora.sh` | 新增：LoRA 训练脚本（axolotl） |
| `scripts/deploy-finetuned.sh` | 新增：vLLM 部署 + 健康检查 |
| `server.js` | 新增 `USE_FINETUNED` 环境变量路由 + AB 测逻辑 |
| `.env.example` | 新增 `USE_FINETUNED`, `FINETUNED_BASE`, `AB_RATIO` 配置 |

---

## 事件系统（EVENT_SYSTEM）

> **状态**：代码已完整实现
>
> - 事件检测：`POST /api/events/detect`（语义关键词匹配 + GMV 交叉核对）
> - 事件判定：`POST /api/events/:id/judge`（按策略计算 bonus）
> - GMV 核查：`POST /api/events/gmv-check`（批量查询，修复 N+1）
> - 事件周期：`event_periods` 表记录每个周期的视频数和 bonus
> - 事件策略：`events_policy` 表存储 per-owner/per-eventKey 的策略配置

### events 表

```sql
CREATE TABLE events (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    creator_id      INT NOT NULL,
    event_key       VARCHAR(64) NOT NULL,  -- 'trial_7day'|'monthly_challenge'|'agency_bound'|'gmv_milestone'
    event_type      VARCHAR(32) NOT NULL,   -- 'challenge'|'gmv'|'referral'|'incentive_task'|'agency'
    owner           VARCHAR(32) NOT NULL,   -- 'Beau'|'Yiyun'
    status          VARCHAR(16) DEFAULT 'active',  -- 'pending'|'active'|'completed'|'cancelled'
    trigger_source  VARCHAR(32) DEFAULT 'semantic_auto',  -- 'semantic_auto'|'manual'|'gmv_crosscheck'
    trigger_text    TEXT,
    start_at        DATETIME,
    end_at          DATETIME,
    meta            JSON,
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (creator_id) REFERENCES creators(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX idx_events_unique_active ON events(
    creator_id, event_key, status, (IF(status='active',0,1))
);
```

### 事件类型枚举

| event_type | 说明 | 触发方式 |
|------------|------|---------|
| `challenge` | 挑战类（7日、月度） | 语义识别 + 手动确认 |
| `gmv` | GMV 里程碑 | keeper_link 数据交叉核对 |
| `referral` | 推荐新用户 | 语义识别 + 手动确认 |
| `incentive_task` | 单次激励任务 | GMV 达标后解锁 |
| `agency` | Agency 绑定 | 语义识别 + 手动确认 |

### EVENT_KEYWORDS（语义触发）

| event_key | 关键词 |
|-----------|--------|
| `trial_7day` | trial, 7day, 7-day, free challenge, 7天挑战, 试用挑战, 加入挑战 |
| `monthly_challenge` | monthly challenge, monthly, 月度挑战, 包月任务, 每月挑战 |
| `agency_bound` | agency, bound, signed, contract, 签约, 绑定机构, mcn, 代理 |
| `referral` | invite, refer, 推荐, 介绍, 新人, creator joined |

### Beau GMV 阶梯奖励

| GMV 里程碑 | 奖励 |
|------------|------|
| ≥ $1,000 | 解锁额外 50% 佣金（需满足 35 video/week 条件）|
| ≥ $5,000 | $100 现金 |
| ≥ $10,000 | $120 现金 |
| ≥ $20,000 | $200 现金 |

---

## RLHF 阶段路径现状（2026-04-10）

### 阶段状态总览

| 阶段 | 状态 | 说明 |
|------|------|------|
| 阶段0 数据积累 | ⚠️ 数据量=0 | 代码基建完整，运营使用是唯一 blocker |
| 阶段1 模型训练 | 🟡 导出就绪，脚本未写 | `GET /api/sft-export` + `GET /api/sft-training-status` 可用 |
| 阶段2 灰度部署 | ✅ 已实现 | `USE_FINETUNED` + `AB_RATIO` 10% 灰度路由（`POST /api/minimax` 内部） |
| 阶段3 持续迭代 | 🟡 门槛检查就绪 | `GET /api/sft-training-status` 提供下一步建议，自动化触发待接入 Modal |

### RLHF 训练门槛

| 条件 | 门槛 | 当前状态 |
|------|------|---------|
| approved 语料 | ≥ 200 条 | 0 条 |
| custom 高质量数据 | ≥ 20 条 | 未知 |
| 场景覆盖 | ≥ 3 类 | 未知 |
| 英文数据比例 | - | 未知 |

**门槛检查 API：** `GET /api/sft-training-status` 返回 ready 状态、各项指标 vs 门槛、blockers 列表、下一步建议 + 导出链接。

### 推荐技术栈（不变）

| 组件 | 推荐 |
|------|------|
| 训练平台 | Modal（$10-15/次） |
| 训练框架 | Axolotl |
| Base 模型 | Mistral-7B-Instruct |
| 推理托管 | 硅基流动 / Together AI / Modal |

### 环境变量（RLHF 相关）

```bash
# 灰度路由
USE_FINETUNED=true                    # true = 开启微调模型灰度
FINETUNED_BASE=https://your-endpoint.com/v1/messages  # 微调模型 endpoint
FINETUNED_API_KEY=your-key            # 微调模型 API key
AB_RATIO=0.1                          # 灰度比例（10% 流量）

# AI 提供商
USE_OPENAI=true                       # true = 使用 OpenAI（GPT-4o）
MINIMAX_API_KEY=your-key             # MiniMax API key（默认）

---

## client_memory 自动积累机制（Implementation Plan）

> 状态：方案设计阶段，待实现
> 更新日期：2026-04-10

### 1. 现状分析

**问题**：`client_memory` 表（0 条）完全为空，以下读取方均无法获得记忆：

| 读取方 | 文件 | 用途 |
|--------|------|------|
| Experience Router | `server/routes/experience.js` | 组装 system prompt 时注入客户偏好 |
| Profile Agent | `agents/profile-agent.js` | 生成 summary 时参考历史偏好 |
| Profile Service | `server/services/profileService.js` | 刷新画像时聚合偏好标签 |

**现有写入 API**（均需手动调用）：
- `POST /api/profile/memory` — 手动写入单条记忆
- `PUT /api/profile/:id/memory` — 手动更新记忆

**无任何自动写入机制**。

---

### 2. 触发点设计

#### 触发点 A：AI 回复生成成功后（主触发点）

**Hook 位置**：`server/routes/experience.js` — `generateViaExperienceRouter()` 函数内部，AI 回复成功返回后。

**提取逻辑**：对刚生成的两个候选回复（opt1/opt2）和对话上下文做 LLM 分析，提取记忆条目。

#### 触发点 B：SFT 人工选择确认后

**Hook 位置**：前端 `WAMessageComposer.jsx` — 人工选择 `opt1`/`opt2`/`custom` 并发送后，调用 `POST /api/sft/export` 时。

**或 Hook 位置**：`server/routes/sft.js` — `POST /api/sft/export` 写入 `sft_memory` 后立即触发。

**提取逻辑**：基于最终选中内容（human_selected）和对话上下文，提取记忆。

#### 触发点 C：事件语义分析完成后

**Hook 位置**：`scripts/generate-events-from-chat.cjs` — `insertEvent()` 成功插入后。

**提取逻辑**：从已检测的事件类型和 trigger_text 中提取 policy 相关记忆（如"已签约 DRIFTO MCN"）。

---

### 3. LLM 提取 Prompt 设计

```javascript
/**
 * 从对话上下文和 AI 回复中提取客户记忆
 * @param {object} params
 * @param {Array}  params.messages   — 最近 10 条对话 {role, text, timestamp}
 * @param {string} params.client_id  — wa_phone
 * @param {string} params.owner      — 'Beau' | 'Yiyun'
 * @param {string} params.trigger_type — 'ai_generate' | 'sft_select' | 'event_create'
 * @returns {Array<{memory_type, memory_key, memory_value, confidence}>}
 */
async function extractMemoriesFromConversation({ messages, client_id, owner, trigger_type }) {
  const systemPrompt = `You are a CRM memory extraction assistant. Your task is to analyze a WhatsApp conversation between a creator account manager (${owner}) and a creator (client), and extract notable facts, preferences, decisions, or style cues that should be remembered for future interactions.

Memory Types:
- preference: 客户表达的具体偏好（如：喜欢视频简短、不要发太多消息、喜欢中文回复）
- decision: 客户做出的决定（如：决定参加 beta program、决定签约 MCN、决定购买月费）
- style: 客户的沟通风格（如：喜欢问很多问题、回复简短、喜欢发语音）
- policy: 客户对政策的态度/理解（如：理解 20 天 beta 规则、理解月费扣除方式）

Rules:
1. Only extract facts that are EXPLICITLY stated or clearly implied in the conversation
2. Do NOT guess or infer beyond what is said
3. Each memory should be a single, specific fact (max 50 chars for key, 200 chars for value)
4. Confidence: 1 = 低置信（推测）, 2 = 中等置信（基本确认）, 3 = 高置信（明确表达）
5. Return an empty array if nothing notable is found
6. memory_key should be a short slug: "preference:reply_length", "decision:trial_signup", "style:uses_voice"

Response Format (return ONLY valid JSON):
{
  "memories": [
    {
      "memory_type": "preference|decision|style|policy",
      "memory_key": "short_slug_description",
      "memory_value": "具体内容（中文，200字以内）",
      "confidence": 1|2|3
    }
  ]
}`;

  const conversationText = messages.map(m => {
    const role = m.role ***REMOVED***= 'me' ? `${owner}` : 'Creator';
    return `[${role}]: ${m.text}`;
  }).join('\n');

  const userPrompt = `Extract CRM memories from this conversation (most recent last):

${conversationText}

Trigger type: ${trigger_type}`;

  // 调用 LLM（复用 existing callLLM logic）
  // ...
}
```

---

### 4. 去重与更新策略

**唯一索引**：`UNIQUE(client_id, memory_type, memory_key)`

| 场景 | 行为 |
|------|------|
| 同 client_id + memory_type + memory_key 已存在 | INSERT IGNORE（静默跳过）|
| 同一 memory_key 新内容且 confidence 更高 | 允许人工 review 后手动更新，或按 confidence 自动覆盖（confidence 高优先）|

**自动覆盖条件**（可选）：
- confidence >= 2 的新记录覆盖 confidence = 1 的旧记录
- decision 类型优先保留最新的（时间戳 newer 覆盖 older）

---

### 5. 代码改动清单

#### 5.1 新建 `server/services/memoryExtractionService.js`

```
职责：
- extractMemoriesFromConversation() LLM 提取函数
- upsertMemory() 写入 client_memory（含 INSERT IGNORE + 可选覆盖逻辑）
- 被 experience.js / sft routes / events script 调用
```

#### 5.2 修改 `server/routes/experience.js`

在 `generateViaExperienceRouter()` 成功返回 AI 回复后：
```javascript
// 生成成功后，异步提取记忆（不阻塞主流程）
if (!DRY_RUN && !error) {
  setImmediate(() => {
    extractMemoriesFromConversation({
      messages: recentMessages,
      client_id: creatorId,
      owner: operator,
      trigger_type: 'ai_generate'
    }).then(memories => {
      for (const mem of memories) {
        upsertMemory(mem).catch(console.error);
      }
    });
  });
}
```

#### 5.3 修改 `server/routes/sft.js`

在 `POST /api/sft/export` 写入 `sft_memory` 后：
```javascript
// 提取记忆（基于人工选择的内容和上下文）
extractMemoriesFromConversation({
  messages: recentMessages,
  client_id: client_id,
  owner: operator,
  trigger_type: 'sft_select'
}).then(memories => {
  for (const mem of memories) {
    upsertMemory(mem).catch(console.error);
  }
});
```

#### 5.4 修改 `scripts/generate-events-from-chat.cjs`

在 `insertEvent()` 返回 `{inserted: true}` 后：
```javascript
// 从事件 trigger_text 提取 policy/decision 记忆
if (result.inserted) {
  const meta = evt.meta || {};
  const memoryKey = `decision:${evt.event_key}`;
  await upsertMemory({
    memory_type: 'decision',
    memory_key: memoryKey,
    memory_value: evt.trigger_text,
    confidence: 2,
    source_record_id: null
  }, conn, creatorId);
}
```

#### 5.5 修改 `POST /api/profile/memory` 手动写入路径

确保手动写入也经过 upsertMemory 统一处理（保持一致性）。

---

### 6. 记忆类型与 key 命名规范

| memory_type | 用途 | key 命名规范 | 示例 |
|-------------|------|-------------|------|
| preference | 客户偏好 | `preference:<具体偏好>` | `preference:reply_length_short` |
| decision | 客户决策 | `decision:<事件key>` | `decision:trial_signup` |
| style | 沟通风格 | `style:<风格描述>` | `style:uses_voice_notes` |
| policy | 政策理解 | `policy:<政策key>` | `policy:beta_20day_understands` |

---

### 7. 验证清单

- [ ] `client_memory` 表有数据写入（非空）
- [ ] 同一 client_id + memory_type + memory_key 不会重复插入（UNIQUE 索引验证）
- [ ] 三种触发点均生效（ai_generate / sft_select / event_create）
- [ ] 记忆内容可在 Experience Router system prompt 中正确注入
- [ ] Profile Agent 读取记忆生成 summary 时有数据可用
- [ ] LLM 提取失败（如 timeout）不阻断主流程（降级策略：跳过本次提取）

---

### 8. 未来扩展方向

- **记忆时效性**：decision 类型记忆标注 `expires_at`（如 beta 计划结束日期）
- **记忆可信度 RLHF**：结合 SFT feedback（skip/reject）调整记忆 confidence
- **记忆可视化**：前端 `client_memory` 面板 — 查看/编辑/删除单条记忆
- **批量回填**：对历史 `sft_memory` 记录跑一遍提取，初始化 `client_memory` 基础数据
```
