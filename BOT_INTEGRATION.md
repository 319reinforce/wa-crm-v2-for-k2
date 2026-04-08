# WA CRM v2 — Bot 接入指令

> 快速接入指南 · 其他 AI Agent 请先阅读本文档

---

## 项目信息

| 项目 | 值 |
|------|-----|
| 名称 | WA CRM v2 |
| 类型 | WhatsApp 达人 CRM + SFT 语料收集平台 |
| 路径 | `/Users/depp/wa-bot/wa-crm-v2/` |
| 后端端口 | `3000` |
| 数据库 | `SQLite` → `crm.db` |
| 文档 | `SFT_PROJECT.md`（详细项目文档） |

---

## 快速开始

```bash
cd /Users/depp/wa-bot/wa-crm-v2
node server.js        # 启动服务
```

服务地址：`http://localhost:3000`

---

## 身份与权限

| 角色 | 标识 | 权限 |
|------|------|------|
| Beau | `Beau` | 负责人 |
| Yiyun | `YanYiYun` | 负责人 |
| YouKe | `WangYouKe` | 负责人 |

---

## 数据库连接

```javascript
const Database = require('better-sqlite3');
const DB_PATH = '/Users/depp/wa-bot/wa-crm-v2/crm.db';
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
```

---

## 核心 API 速查

### 读取达人列表
```
GET /api/creators?owner=Beau&search=Jessica&beta_status=introduced&priority=high
```

### 读取达人完整信息
```
GET /api/creators/:id
```

### 读取消息历史
```
GET /api/creators/:id/messages
```

### 全局统计
```
GET /api/stats
```

### 读取 SFT 语料（供训练用）
```
GET /api/sft-memory?limit=100
GET /api/sft-memory/stats
```

### 写入 SFT 语料（人工审核后调用）
```
POST /api/sft-memory
Content-Type: application/json

{
  "model_candidates": { "opt1": "...", "opt2": "..." },
  "human_selected": "opt2",
  "human_output": "实际发送的回复内容",
  "diff_analysis": {
    "model_predicted": "opt2",
    "is_custom": false,
    "human_reason": "理由"
  },
  "context": { "client_id": "16145639865", "scene": "trial_intro" },
  "status": "approved"
}
```

### 查询客户记忆
```
GET /api/client-memory/:clientId
```

### 更新客户记忆
```
POST /api/client-memory
{ "client_id": "...", "memory_type": "preference", "memory_key": "tone", "memory_value": "friendly" }
```

### 读取政策文档（AI 输出前必须参考）
```
GET /api/policy-documents?active_only=true
```

### 审计日志
```
GET /api/audit-log?action=policy_update&limit=50
```

### 客户画像（Profile Agent）
```
# 触发画像更新事件
POST /api/profile-agent/event
Content-Type: application/json
{
  "event_type": "wa_message | sft_record | keeper_update | manual_tag",
  "client_id": "16145639865",
  "data": { ... }
}

# 读取完整画像（AI 调用时使用）
GET /api/client-profile/:clientId

# 手工更新标签
PUT /api/client-profiles/:clientId/tags
{ "tag": "vip_level", "value": "high", "confidence": 3 }
```

---

## SFT 语料格式（训练用）

从数据库读取后，每条记录的格式：

```javascript
{
  "id": 1,
  "model_opt1": "候选回复A（模型生成）",
  "model_opt2": "候选回复B（模型生成）",
  "human_selected": "opt2",       // 人工选择了哪个
  "human_output": "最终发送的回复",  // 训练标签
  "is_custom_input": 0,           // 1=人工手写，0=从A/B选
  "human_reason": "为什么这样选",
  "context_json": "{\"client_id\":\"...\",\"scene\":\"...\"}",
  "status": "approved"
}
```

**训练构造方式：**
- `human_selected = 'opt1'` → `human_output` 对应 `model_opt1`
- `human_selected = 'opt2'` → `human_output` 对应 `model_opt2`
- `human_selected = 'custom'` → `human_output` 是人工手写，最有训练价值

---

## 政策文档参考流程

AI 生成回复前，必须：

1. 调用 `GET /api/policy-documents?active_only=true`
2. 根据 `applicable_scenarios` 匹配当前场景
3. 在 `policy_content` 中查找对应规则
4. 生成符合政策的回复

---

## 客户记忆使用流程

1. 调用 `GET /api/client-memory/:clientId`
2. 根据 `memory_type` 读取客户偏好（preference/style/decision/policy）
3. 生成回复时融入客户记忆（提升个性化）
4. Profile Agent 会自动从对话中提取并写入 client_memory

---

## 数据库表速查

| 表名 | 用途 |
|------|------|
| `creators` | 达人主表（wa_phone 唯一标识） |
| `creator_aliases` | 达人别名映射 |
| `wa_messages` | WA 对话消息 |
| `wa_crm_data` | 达人 CRM 扩展数据（事件状态） |
| `keeper_link` | Keeper 系统关联 |
| `joinbrands_link` | JoinBrands 系统关联 |
| `sft_memory` | SFT 训练语料 |
| `client_memory` | 客户单独记忆 |
| `client_profiles` | 客户独立画像（AI 调用时使用） |
| `client_tags` | 动态标签（多源标注） |
| `policy_documents` | 政策文档 |
| `audit_log` | 操作审计日志 |

---

## 审计日志 action 类型

| action | 说明 |
|---------|------|
| `sft_create` | SFT 语料创建 |
| `policy_upsert` | 政策文档更新 |
| `client_memory_update` | 客户记忆更新 |
| `policy_update` | 政策更新（含 before/after） |
| `policy_deactivate` | 政策停用 |

---

## 原始对话数据

```
路径：/Users/depp/wa-bot/wa-crm-v2/data/*.json
格式：{phone}_{name}_{date}.json
内容：{ phone, name, keeper_username, wa_owner, messages: [{role, text, timestamp}] }
```

---

## 禁止事项

1. **禁止**直接修改 `crm.db`（通过 audit_log 追溯变更）
2. **禁止**在未调用 `GET /api/policy-documents` 的情况下输出涉及政策内容的回复
3. **禁止**将 `wa_phone` 泄露到日志或外部系统
4. **必须**使用参数化查询，禁止拼接 SQL

---

## 遇到问题？

1. 先读 `SFT_PROJECT.md`（详细项目文档）
2. 查 `CODE_REVIEW.md`（已知问题清单）
3. 调用 `GET /api/health` 确认服务状态
4. 调用 `GET /api/audit-log?limit=5` 查看最近操作
