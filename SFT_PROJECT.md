# WA CRM v2 — SFT 语料训练项目

> 本文档供其他 AI Agent 阅读学习使用
> 更新时间：2026-04-08

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

### 后端

| 文件 | 说明 |
|------|------|
| `server.js` | Express 服务器，REST API 端口 3000 |
| `db.js` | SQLite ORM（better-sqlite3） |
| `schema.sql` | 数据库 schema 定义 |
| `crm.db` | SQLite 数据库文件 |
| `key_creators.js` | 达人身份映射表（跨系统关联） |
| `migrate.js` | 数据库迁移脚本 |

### 前端（React + Vite + TailwindCSS）

| 文件 | 说明 |
|------|------|
| `src/App.jsx` | 主应用 — 达人列表 + 详情 + SFT Tab |
| `src/components/SFTDashboard.jsx` | SFT 语料看板（含 records/review/trends/evaluation 四个子 Tab） |
| `src/components/WAMessageComposer.jsx` | 消息编辑器，handleSkip 触发 sft_feedback 写入 |
| `src/utils/systemPrompt.js` | **共享 system prompt 模板**，前后端共用同一份 |
| `src/utils/minimax.js` | MiniMax API Client，AI 生成时调用共享模板 |

### 原始数据

```
data/*.json   # 120个达人的每日对话数据（JSON格式）
              文件名格式：{phone}_{name}_{date}.json
              例：16145639865_Jessica_614jessicam__2026-04-03.json
```

---

## 数据库 Schema

### sft_memory — SFT 训练语料表（核心）

```sql
CREATE TABLE sft_memory (
  id                      INTEGER PRIMARY KEY AUTOINCREMENT,
  model_opt1              TEXT,                              -- 模型生成的候选回复 A
  model_opt2              TEXT,                              -- 模型生成的候选回复 B
  human_selected          TEXT NOT NULL,                     -- 'opt1' | 'opt2' | 'custom'
  human_output            TEXT NOT NULL,                     -- 最终实际使用的输出（训练标签）
  model_predicted         TEXT,                              -- 模型预测值（与 human_selected 对比）
  model_rejected          TEXT,                              -- 模型被拒绝的值
  is_custom_input         INTEGER DEFAULT 0,                 -- 是否人工自行输入（非模型生成）
  human_reason            TEXT,                              -- 人工选择理由（可选）
  context_json            TEXT,                              -- 客户上下文 JSON（含 input_text, client_id, scene 等）
  status                  TEXT DEFAULT 'approved',            -- approved | pending_review | needs_review | rejected
  reviewed_by             TEXT,                              -- 审核人（人工审核后写入）

  -- v2 新增字段
  input_text_hash         TEXT,                              -- SHA256(input_text)，用于去重
  human_output_hash       TEXT,                              -- SHA256(human_output)，用于去重
  created_date            TEXT,                              -- DATE(created_at)，存储为 YYYY-MM-DD 字符串
  client_id_hash          TEXT,                              -- SHA256(client_id)，用于去重和隐私
  similarity              INTEGER,                           -- AI 候选相似度（0-100）
  scene                  TEXT,                              -- 场景标签（建联阶段/事件类型）
  message_history         TEXT,                              -- JSON，前10轮对话历史
  system_prompt_version   TEXT DEFAULT 'v1',                 -- 使用的 system prompt 版本

  created_at              DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 去重唯一索引
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
| `GET` | `/api/sft-memory/stats` | 语料统计（total/opt1/opt2/custom 分布 + pending_review 数量） |
| `GET` | `/api/sft-memory/pending` | 待审核语料列表（status = pending_review） |
| `PATCH` | `/api/sft-memory/:id/review` | 审核操作 `{ action: "approve" \| "reject" }` |
| `GET` | `/api/sft-memory/trends` | 近 30 天采用率趋势（opt1/opt2/custom/skipped rate + volume） |
| `GET` | `/api/sft-export` | 导出 SFT 训练数据（支持 `?format=jsonl`） |
| `POST` | `/api/sft-feedback` | 写入 skip/reject/edit 反馈（v2 新增） |
| `GET` | `/api/sft-feedback/stats` | 反馈统计（按 type.scene 聚合） |
| `GET` | `/api/ab-evaluation` | A/B 评估数据（按场景 + 负责人分布） |
| `GET` | `/api/client-memory/:clientId` | 查询某客户的记忆 |
| `POST` | `/api/client-memory` | 更新客户记忆 |

### Policy 相关

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/policy-documents` | 获取所有政策文档 |
| `POST` | `/api/policy-documents` | 创建/更新政策文档（UPSERT） |

### 达人数据相关

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/creators` | 达人列表（支持 `owner/search/beta_status/priority/agency/event` 过滤） |
| `GET` | `/api/creators/:id` | 达人完整信息 |
| `GET` | `/api/creators/:id/messages` | 达人消息历史 |
| `GET` | `/api/stats` | 全局统计数据 |

### 审计日志

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/audit-log` | 查询审计日志（支持 `?action=&limit=50`） |

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
| SFT 语料数据库 | `/Users/depp/wa-bot/wa-crm-v2/crm.db` |
| SFT Dashboard 组件 | `/Users/depp/wa-bot/wa-crm-v2/src/components/SFTDashboard.jsx` |
| 共享 System Prompt | `/Users/depp/wa-bot/wa-crm-v2/src/utils/systemPrompt.js` |
| AI 生成（MiniMax） | `/Users/depp/wa-bot/wa-crm-v2/src/utils/minimax.js` |
| 消息编辑器 | `/Users/depp/wa-bot/wa-crm-v2/src/components/WAMessageComposer.jsx` |
| 后端 API（server.js） | `/Users/depp/wa-bot/wa-crm-v2/server.js` |
| 数据库 Schema | `/Users/depp/wa-bot/wa-crm-v2/schema.sql` |
| 原始对话数据 | `/Users/depp/wa-bot/wa-crm-v2/data/*.json` |
| Profile Agent | `/Users/depp/wa-bot/wa-crm-v2/agents/profile-agent.js` |

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

#### 1. ai_extracted — 从 WA 消息正则提取

触发时机：客户发消息后，由 `POST /api/profile-agent/event` 调用 `extractTagsFromMessage()`。

**提取规则（`agents/profile-agent.js`）：**

| 匹配条件 | 标签 | 置信度 |
|---------|------|--------|
| 出现 "prefer/更喜欢" + "video" | `format:video` | 2 |
| 出现 "prefer/更喜欢" + "text" | `format:text` | 2 |
| 出现 "prefer/更喜欢" + "voice/call" | `format:voice` | 2 |
| 出现 "don't like/dislike/不喜欢" | `preference:cautious` | 1 |
| 出现 "please/would/could/kindly" | `tone:formal` | 2 |
| 出现 "hey/great/awesome/cool/yeah/thanks" | `tone:casual` | 2 |
| 运营回复中出现 "decided/chose/选择了" | `decision_made:true` | 3 |
| 出现 "trial/7-day/7day/free try" | `stage:trial_intro` | 2 |
| 出现 "monthly/month/card/membership" | `stage:monthly_inquiry` | 2 |
| 出现 "commission/分成/提成" | `stage:commission_query` | 2 |
| 出现 "mcn/agency/经纪" | `stage:mcn_inquiry` | 2 |
| 用户消息超过 50 字 | `engagement:detailed_response` | 1 |

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
| `wa_message` | 客户发消息后 | tone/format/preference/stage 标签 |
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
