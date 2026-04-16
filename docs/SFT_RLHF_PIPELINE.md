# SFT / RLHF Pipeline 说明文档

> 版本：2026-04-16（generation tracking 正式列迁移 + 新主链路 generate-candidates）
> 维护者：WA CRM v2 Backend
> 最后更新：2026-04-16

---

## 一、整体架构

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           RLHF 反馈循环                                  │
│                                                                         │
│  ┌──────────────┐     生成候选      ┌──────────────────┐              │
│  │   达 人      │ ────消息────────▶│  WAMessageComposer │              │
│  │  WhatsApp    │ ◀───回复────────│      .jsx         │              │
│  └──────────────┘                  └────────┬─────────┘              │
│                                              │                         │
│                              单次 AI 调用    │  operator 选择          │
│                                              ▼                         │
│  ┌──────────────────────────────────────────────────────────┐        │
│  │  POST /api/ai/generate-candidates（新主接口）             │        │
│  │  replyGenerationService.generateReplyCandidates()        │        │
│  │  ├── scope 校验                                          │        │
│  │  ├── buildFullSystemPrompt → retrieval_snapshot 写入     │        │
│  │  ├── provider 路由（finetuned/openai/minimax）           │        │
│  │  └── generation_log 写入                                 │        │
│  └──────────────────────────────────────────────────────────┘        │
│         │ 返回 opt1/opt2 + tracking IDs                               │
│         ▼                                                              │
│  ┌──────────────────────────────────────────────────────────┐        │
│  │  AIReplyPicker.jsx — human_selected                      │        │
│  └──────────────────────────────────────────────────────────┘        │
│         │ human_selected + tracking metadata                          │
│         ▼                                                              │
│  ┌──────────────┐   写入   ┌──────────────────┐  写入               │
│  │ sft_memory   │◀────────│  POST /sft-memory │                     │
│  │ 表（含追踪列）│         └───────────────────┘                      │
│  └──────┬───────┘                                                      │
│         │                                                               │
│         │ Skip/Reject   ┌──────────────────┐                         │
│         └──────────────▶│  POST /sft-feedback│                         │
│                         └───────────────────┘                         │
│                                    │                                    │
│                                    ▼                                    │
│                         ┌─────────────────────┐                        │
│                         │ GET /sft-export     │                        │
│                         │ (按月导出 approved) │                        │
│                         └──────────┬──────────┘                        │
│                                    │                                    │
│                                    ▼                                    │
│  ┌─────────────────────────────────────────────────────────────┐     │
│  │                  trainingWorker.js                          │     │
│  │  导出 JSONL → 写 training_log → 发飞书通知                  │     │
│  └─────────────────────────────────────────────────────────────┘     │
└─────────────────────────────────────────────────────────────────────────┘
```

> **兼容入口**：`POST /api/minimax` 和 `POST /api/experience/route` 仍可用，内部均委托给 `replyGenerationService`，不再保留独立实现。

---

## 二、数据表结构

### 2.1 `sft_memory` — SFT 训练语料主表

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | INT AUTO_INCREMENT | 主键 |
| `model_opt1` | TEXT | 温度 0.8 生成的候选回复 |
| `model_opt2` | TEXT | 温度 0.4 生成的候选回复 |
| `human_selected` | VARCHAR(16) | `opt1` / `opt2` / `custom` |
| `human_output` | TEXT | 最终人工选择/修改的回复 |
| `is_custom_input` | TINYINT | 是否为人工自定义（而非从 opt1/opt2 选） |
| `context_json` | JSON | 推理时上下文（client_id, scene, input_text，兼容写入追踪字段） |
| `message_history` | JSON | 前 10 轮对话历史 |
| `system_prompt_used` | TEXT | 推理时实际使用的完整 system prompt |
| `system_prompt_version` | VARCHAR(16) | prompt 版本，默认 `v2` |
| `status` | VARCHAR(32) | `approved` / `pending_review` / `rejected` |
| `reviewed_by` | VARCHAR(64) | `system` / `human_review` |
| `similarity` | INT | opt1/opt2 与 human_output 的相似度（0-100） |
| `scene` | VARCHAR(64) | 场景标签 |
| `chosen_output` | TEXT | RLHF Preference Pair — 被选中的回复 |
| `rejected_output` | TEXT | RLHF Preference Pair — 被拒绝的回复 |
| `client_id_hash` | VARCHAR(64) | SHA256(client_id)，用于去重 |
| `input_text_hash` | VARCHAR(64) | SHA256(input_text)，用于去重 |
| `human_output_hash` | VARCHAR(64) | SHA256(human_output)，用于去重 |
| `created_date` | DATE | YYYY-MM-DD，用于去重窗口 |
| `created_at` | DATETIME | 记录创建时间 |
| `retrieval_snapshot_id` | INT | **新增（2026-04-16）** 关联 `retrieval_snapshot.id` |
| `generation_log_id` | INT | **新增（2026-04-16）** 关联 `generation_log.id` |
| `provider` | VARCHAR(32) | **新增（2026-04-16）** AI 服务商（minimax/openai/finetuned） |
| `model` | VARCHAR(64) | **新增（2026-04-16）** 实际使用的模型名 |
| `scene_source` | VARCHAR(32) | **新增（2026-04-16）** 场景来源标识 |
| `pipeline_version` | VARCHAR(64) | **新增（2026-04-16）** 固定为 `reply_generation_v2` |

**去重唯一索引**：`idx_sft_dedup (client_id_hash, input_text_hash, human_output_hash, created_date)`

**新增索引（2026-04-16）**：
- `idx_sft_retrieval_snapshot (retrieval_snapshot_id)`
- `idx_sft_generation_log (generation_log_id)`
- `idx_sft_provider_model (provider, model)`

**兼容策略**：`sft_memory` 写入时优先写正式列；若目标库未迁移，追踪字段同时写入 `context_json`，避免老库报错。`GET /api/sft-export` 优先读正式列，回退读 `context_json`。

---

### 2.2 `sft_feedback` — Skip/Reject/Edit 反馈表

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | INT AUTO_INCREMENT | 主键 |
| `client_id` | VARCHAR(64) | 达人 phone |
| `feedback_type` | VARCHAR(16) | `skip` / `reject` / `edit` |
| `input_text` | TEXT | 用户原始输入 |
| `opt1` | TEXT | 候选 A |
| `opt2` | TEXT | 候选 B |
| `final_output` | TEXT | 最终发送的回复（edit 场景） |
| `scene` | VARCHAR(64) | 场景标签 |
| `reject_reason` | TEXT | 为什么两个候选都不够好 |
| `created_at` | DATETIME | 记录创建时间 |

---

### 2.3 `training_log` — 训练执行日志

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | INT AUTO_INCREMENT | 主键 |
| `month_label` | VARCHAR(16) | YYYY-MM 格式 |
| `record_count` | INT | 导出记录数 |
| `export_path` | VARCHAR(256) | JSONL 文件路径 |
| `status` | VARCHAR(16) | `success` / `failed` / `skipped` / `dry_run` |
| `detail` | TEXT | 详情描述 |
| `triggered_by` | VARCHAR(32) | `http_trigger` / `cli` / `dry_run` / `cron` |
| `created_at` | DATETIME | 记录创建时间 |

---

### 2.4 `operator_experiences` — Operator 专属话术配置

| 字段 | 类型 | 说明 |
|------|------|------|
| `operator` | VARCHAR(32) UNIQUE | `Beau` / `Yiyun` |
| `display_name` | VARCHAR(64) | 显示名称 |
| `description` | TEXT | 描述 |
| `system_prompt_base` | TEXT | 基础 prompt 模板（含 `[BASE_PROMPT]` 占位符） |
| `scene_config` | JSON | 场景 → prompt 片段映射 |
| `forbidden_rules` | JSON | 额外禁止规则数组 |
| `is_active` | TINYINT | 是否激活 |
| `priority` | INT | 路由优先级 |

---

## 三、Prompt 构建 — systemPromptBuilder.cjs

**核心原则：推理（experience.route）和训练导出（sft-export）共用同一套 `buildFullSystemPrompt()`。**

### 3.1 函数签名

```js
buildFullSystemPrompt(clientId, scene, messages = [], opts = {})
// opts: { operator, topicContext, richContext, conversationSummary, systemPromptVersion }
```

### 3.2 Prompt 组成（按顺序拼接）

```
[topicContext]           ← 前端注入的话题上下文（可选）
[richContext]            ← 前端注入的丰富上下文（可选）
[conversationSummary]    ← 前端注入的更早对话摘要（可选）
[operator 专属 core prompt]  ← compileSystemPrompt() 编译结果
```

### 3.3 compileSystemPrompt 组成

```
[BASE_PROMPT 展开]       ← 客户档案（姓名、operator、建联阶段、next_action）
【场景适配】             ← scene_config[scene] 片段
【客户历史偏好】         ← client_memory 格式化
【场景适用政策】         ← policy_documents 中 applicable_scenes 包含当前 scene 的文档
【输出禁止规则】         ← baseForbidden + operator.forbidden_rules
【回复风格】             ← REPLY_STYLE 常量（语气、长度、emoji、推进策略）
```

### 3.4 各端点调用情况（2026-04-10 修复后）

| 调用方 | 传入 messages | 传入 opts | 说明 |
|--------|--------------|-----------|------|
| `ai.js /ai/generate-candidates` | `messages` | 完整 4 参数 | **前端当前主链路**，单次完成 prompt 构建、追踪写入和候选生成 |
| `experience.route` | `messages` | 完整 4 参数 | 兼容入口，内部委托 `replyGenerationService` |
| `sft-export`（system_prompt_used=null 时） | `history` | 4 参数传空字符串 | 历史数据因无 `topicContext/richContext/conversationSummary` 丢失 |
| `ai.js /ai/system-prompt` | `[]` | 完整 4 参数 | 兼容 / 调试端点，不再是前端推荐主链 |

**关键保障**：前端 `WAMessageComposer.jsx` 在 AI 生成时通过 `POST /api/ai/generate-candidates` 获取候选与实际使用的 system prompt，并将 `system_prompt_used` 存入 `sft-memory` 表。sft-export 优先使用 `system_prompt_used`，确保推理与训练 prompt 完全一致。

---

## 四、API 清单

### 4.1 SFT 数据写入

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/sft-memory` | 创建/更新 SFT 语料记录 |
| GET | `/api/sft-memory` | 列表查询（分页）|
| GET | `/api/sft-memory/pending` | 待审核记录 |
| PATCH | `/api/sft-memory/:id/review` | 人工审核（approve/reject）|
| GET | `/api/sft-memory/stats` | 统计数据 |
| GET | `/api/sft-memory/trends` | 30 天趋势 |
| GET | `/api/sft-training-status` | 训练就绪状态检查 |

### 4.2 SFT 反馈

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/sft-feedback` | 记录 skip/reject/edit 反馈 |
| GET | `/api/sft-feedback/stats` | 反馈统计 |

### 4.3 SFT 导出与训练

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/sft-export` | 导出 approved 记录（支持 JSON/JSONL）|
| POST | `/api/training/trigger` | 触发训练（需 Bearer Token）|
| GET | `/api/training/status` | 最近一次训练状态 |
| GET | `/api/training/logs` | 训练历史 |

### 4.4 AI 生成路由

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/ai/generate-candidates` | **新主接口（2026-04-16）** 统一生成候选，含追踪写入 |
| POST | `/api/minimax` | 兼容入口，内部委托 `replyGenerationService` |
| POST | `/api/ai/system-prompt` | 单独构建 system prompt |
| POST | `/api/translate` | 翻译（USE_OPENAI=true 走 OpenAI）|
| POST | `/api/ai/generate` | 独立 OpenAI 生成 |

### 4.5 Experience Router

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/experience/operators` | 所有 operator 列表 |
| GET | `/api/experience/:operator` | 单个 operator 配置 |
| GET | `/api/experience/:operator/clients` | 该 operator 负责的达人 |
| POST | `/api/experience/route` | 兼容入口，内部委托 `replyGenerationService` |
| GET | `/api/experience/:operator/system-prompt` | 获取该 operator 的 system prompt |

### 4.6 评估与审计

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/ab-evaluation` | A/B 评估数据（by scene/owner/day）|
| GET | `/api/audit-log` | 操作审计日志 |

---

## 五、RLHF 偏好对构建

`chosen_output` / `rejected_output` 在 `sft-memory` 写入时按如下规则填充：

| human_selected | chosen_output | rejected_output |
|----------------|--------------|----------------|
| `opt1` | model_opt1 | model_opt2 |
| `opt2` | model_opt2 | model_opt1 |
| `custom` | human_output | model_opt1（近似为最难拒绝的候选）|

这构成了 RLHF 中的 Preference Pair，可用于 Reward Model 训练。

---

## 六、AI 灰度路由（USE_FINETUNED）

```
请求 ──▶ shouldUseFinetuned()
             │
             ├── USE_FINETUNED ≠ 'true' ──▶ OpenAI / MiniMax
             │
             └── Math.random() < AB_RATIO (默认 0.1)
                        │
                        ├── 命中 10% ──▶ Finetuned 模型
                        │              (localhost:8000)
                        │              超时 15s，失败自动 fallback 到 OpenAI
                        │
                        └── 未命中 90% ──▶ OpenAI / MiniMax
```

**Fallback 逻辑**：Finetuned 失败（包括超时 15s）且 `USE_OPENAI != 'true'` 时才返回 502，否则静默降级到 OpenAI。

---

## 七、训练导出流程（trainingWorker.js）

```
每月触发 POST /api/training/trigger
    │
    ▼
runTraining('http_trigger')
    │
    ├─ 1. exportSFTData(YYYY-MM)
    │       GET /api/sft-export?format=jsonl&status=approved&month=YYYY-MM&limit=5000
    │       → /tmp/sft-export-YYYY-MM.jsonl
    │
    ├─ 2. logTrainingRun()  [async]
    │       CREATE TABLE IF NOT EXISTS training_log
    │       INSERT training_log
    │
    ├─ 3. DRY_RUN=false 时
    │       execSync(node "TRAINING_SCRIPT" "exportPath")
    │       (超时 1 小时，无重试)
    │
    └─ 4. notify() — 飞书通知
            LARK_BOT_TOKEN 未配置则跳过
```

---

## 八、已知问题与修复状态（2026-04-10）

### P0 — 已修复

**✅ P0-1: `experience.route` 调用 `buildFullSystemPrompt` 缺少 `opts`**
- **文件**：`experience.js`
- **修复**：`buildFullSystemPrompt(client_id, scene, messages, { topicContext, richContext, conversationSummary, systemPromptVersion: 'v2' })`
- **辅助修复**：将 `getOperatorExperience`、`getAllOperatorExperiences`、`getOperatorByClientId` 改为 `async` + `await`（原为同步函数返回 Promise，导致所有调用拿到 `undefined`）
- **辅助修复**：在 `/:operator/system-prompt` 端点同样补齐 4 参数
- **辅助修复**：`ai.js /ai/system-prompt` 中 3 处 `db.getDb().prepare().get()` 缺少 `await`

**✅ P0-2: `sft-export` 重建 prompt 只传 3 个参数**
- **文件**：`sft.js`
- **修复**：`buildFullSystemPrompt(client_id, scene, history, { topicContext: '', richContext: '', conversationSummary: '', systemPromptVersion: 'v2' })`
- **注**：历史数据（`system_prompt_used` 为 null）仍缺少 `topicContext/richContext/conversationSummary`，因为这些字段未存入 `context_json`。新记录依赖 `system_prompt_used` 完整捕获，无此问题。

**✅ P0-3: `experience.js` 中 mysql2 JSON 列可能已 auto-parse 导致 `JSON.parse()` 报错**
- **文件**：`experience.js`
- **修复**：新增 `tryParseJson()` 辅助函数，统一处理 string/object 两种情况
- **影响位置**：`/:operator` 端点、`/:operator/system-prompt` 端点

### P1 — 建议处理

**1. 双重 `compileSystemPrompt` 存在于两处**
- `systemPromptBuilder.cjs:131` — sft-export 使用（正确路径）
- `experience.js:27` — 死代码，`experience.route` 实际调用 `buildFullSystemPrompt`

**2. `sft-training-status` 硬编码阈值**
- 应移至 `.env` 或数据库配置

**3. Finetuned 模型返回格式兼容性**
- `extractText` 假定 OpenAI 格式 `{ choices: [...] }`，若 Finetuned 返回 Anthropic 格式则返回空

**4. 训练脚本为空时静默跳过**
- `detail = 'success'` 但实际无训练，应改为 `skipped` 或 `pending`

**5. `message_history` 只存前 10 轮**
- 可能不足以还原复杂对话场景

**6. `/api/ab-evaluation` 使用 `JSON_EXTRACT` 效率低**
- 建议在 `sft_memory` 表加 `scene` 字符串冗余列

**7. `/api/sft-memory/trends` 字段名不一致**
- 后端返回 `volumes`，前端 `TrendsPanel` 用 `data.volume`，导致"日均条数"始终显示 `-`
- 不报错，但数据不展示

---

## 九、2026-04-10 全部改动汇总

### 9.1 改动文件清单

| 文件 | 改动类型 |
|------|---------|
| `server/routes/ai.js` | async/await 全面修复 + 响应字段 `systemPrompt`→`prompt` 修正 + Finetuned fallback 降级 + memoryExtraction hook |
| `server/routes/experience.js` | async/await 全面修复 + buildFullSystemPrompt 4参数 + tryParseJson 辅助函数 + memoryExtraction hook |
| `server/routes/sft.js` | buildFullSystemPrompt 4参数 + month 过滤 + buildConversationMessages 逻辑修正 + memoryExtraction hook |
| `server/workers/trainingWorker.js` | async/await 全面修复 + month 参数传递给 sft-export |
| `server/routes/training.js` | 死代码 `handleTrigger` 移除 + handleTrigger 未被使用 |
| `docs/SFT_RLHF_PIPELINE.md` | 新建完整说明文档 |

### 9.2 关键 bug 修复详情

**async/await 缺失**（影响范围最广）
```
原代码: getOperatorExperience(operator)          // 返回 Promise，未 await
修复后: const exp = await getOperatorExperience(operator)
```
影响：`experience.route`、`/experience/operators`、`/experience/:operator` 三个端点全部受影响。

**响应字段名不一致**
```
原代码: res.json({ systemPrompt: prompt, version });  // 前端期望 prompt
修复后: res.json({ prompt, version });
```
影响：`WAMessageComposer.jsx` 的 AI 生成流程，若不修复 system prompt 为 undefined。

**Finetuned 超时 60s 无降级**
```
原代码: AbortSignal.timeout(60000)  // 卡住 60s 才返回 502
修复后: AbortSignal.timeout(15000) + 失败自动 fallback 到 OpenAI
```

### 9.3 新增端点

| 端点 | 文件 | 说明 |
|------|------|------|
| `POST /api/training/trigger` | `training.js` | 外部 cron 触发训练，含 Bearer Token 校验 |
| `GET /api/training/status` | `training.js` | 最近一次训练状态 + 30 天运行次数 |
| `GET /api/training/logs` | `training.js` | 训练历史（最多 60 条）|
| `GET /api/sft-export?month=YYYY-MM` | `sft.js` | 支持按月份过滤导出 |

---

## 十、前端兼容性检查（2026-04-10）

### 10.1 检查结论：所有改动对前端无破坏性影响

| 端点 | 状态 | 说明 |
|------|------|------|
| `/api/ai/generate-candidates` | ✅ 当前主链 | 单次返回候选、tracking ids、provider/model、system prompt |
| `/api/ai/system-prompt` | ✅ 兼容保留 | 仍可单独构建 prompt，但不再是前端主链 |
| `/api/sft-memory` (GET) | ✅ 正常 | 返回 `context`（从 `context_json` parse）|
| `/api/sft-memory/stats` | ✅ 正常 | 字段名全对 |
| `/api/sft-memory/trends` | ⚠️ 既有小问题 | 后端返回 `volumes`，前端用 `data.volume`，"日均条数"显示 `-`（不报错）|
| `/api/sft-memory/pending` | ✅ 正常 | |
| `/api/sft-memory/:id/review` (PATCH) | ✅ 正常 | |
| `/api/ab-evaluation` | ✅ 正常 | |
| `/api/generation-log/stats` | ✅ 正常 | `SFTDashboard` 评估页聚合统计 |
| `/api/generation-log/recent` | ✅ 正常 | 最近生成日志列表 |
| `/api/generation-log/rag-observation` | ✅ 正常 | 24h 观测视图 |
| `/api/generation-log/rag-sources` | ✅ 正常 | RAG 命中来源视图 |
| `/api/experience/operators` | ✅ 正常 | |
| `/api/experience/:operator` | ✅ 正常 | |
| `/api/training/*` | ✅ 正常 | 前端不直接调用 |

### 10.2 关键修复确认

当前前端主链已经从 `POST /api/ai/system-prompt + POST /api/minimax` 双请求切换为 `POST /api/ai/generate-candidates` 单请求。`/api/ai/system-prompt` 仅作为兼容 / 调试端点保留。

### 10.3 前端对应文件

| 前端文件 | 调用的后端端点 |
|---------|--------------|
| `WAMessageComposer.jsx` | `/api/ai/generate-candidates`、`/api/sft-memory`、`/api/sft-feedback` |
| `SFTDashboard.jsx` | `/api/sft-memory`、`/api/sft-memory/stats`、`/api/sft-memory/trends`、`/api/sft-memory/pending`、`/api/ab-evaluation`、`/api/sft-export`、`/api/generation-log/*` |

---

## 十一、环境变量速查

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `USE_OPENAI` | `false` | AI 路由：OpenAI vs MiniMax |
| `OPENAI_API_KEY` | — | OpenAI API Key |
| `OPENAI_MODEL` | `gpt-4o` | OpenAI 模型 |
| `USE_FINETUNED` | `false` | 是否启用微调模型灰度 |
| `FINETUNED_BASE` | `http://localhost:8000/v1/messages` | 微调模型地址 |
| `FINETUNED_API_KEY` | `EMPTY` | 微调模型 Key |
| `AB_RATIO` | `0.1` | 灰度流量比例 |
| `TRAINING_TRIGGER_TOKEN` | `training-trigger-token` | 训练触发 Token |
| `TRAINING_DRY_RUN` | `true` | 是否 dry run |
| `TRAINING_EXPORT_LIMIT` | `5000` | 最大导出条数 |
| `TRAINING_SCRIPT` | （空）| 训练脚本路径 |
| `LARK_BOT_TOKEN` | （空）| 飞书通知 Token |
