# WA CRM v2 — RLHF 训练接入指令

> 本文档供其他 AI Agent 阅读，作为 RLHF 链路工作的入口
> 项目路径：`/Users/depp/wa-bot/wa-crm-v2/`
> 后端端口：`3000`，数据库：MySQL（`schema.sql` 为准）

---

## 快速开始

```bash
cd /Users/depp/wa-bot/wa-crm-v2
npm start             # 启动服务（实际入口: server/index.cjs）
```

---

## 一、项目结构

```
wa-crm-v2/
├── server/index.cjs             # Express REST API（端口 3000）
├── db.js                        # MySQL 兼容数据库封装
├── schema.sql                   # 数据库 schema（含所有表定义）
├── systemPromptBuilder.cjs       # 【核心】CJS 共享 prompt 构建器
│                               #   → experience.js（推理）和 export 流程共用
├── server/routes/experience.js  # Experience Router（Beau/Yiyun AI 体验路由）
├── server/routes/profile.js     # Profile 路由（画像 + 标签提取）
├── src/utils/systemPrompt.js    # 【前端专用】ESM 共享 system prompt 模板
└── src/components/
    ├── SFTDashboard.jsx          # SFT 语料看板（records/review/trends）
    ├── EventPanel.jsx            # 事件管理面板
    └── WAMessageComposer.jsx    # 消息编辑器（含 Scene 检测 + AI 生成）

必读文档（按顺序）：
1. CLAUDE.md → 项目全貌、核心模块、禁止事项
2. BOT_INTEGRATION.md → API 端点速查、数据库表
3. SFT_PROJECT.md → SFT 语料系统、Experience Router、Scene 11 类
4. docs/EVENT_SYSTEM.md → 事件系统（挑战/Bonus/GMV 里程碑）
```

---

## 二、RLHF 数据现状（2026-04-09）

### 核心数据表

**`sft_memory`** — SFT 训练语料

| 字段 | 说明 |
|------|------|
| `human_selected` | 'opt1' / 'opt2' / 'custom' |
| `human_output` | 最终发送内容（训练标签） |
| `chosen_output` | **被选中的回复**（RLHF Preference Pair） |
| `rejected_output` | **被拒绝的回复**（RLHF Preference Pair） |
| `model_opt1` / `model_opt2` | AI 生成的候选回复 |
| `similarity` | Jaccard 相似度（阈值 85，≥85 = approved） |
| `scene` | 场景标签（11 类） |
| `message_history` | JSON，前 10 轮对话历史 |
| `status` | 'approved' / 'pending_review' / 'needs_review' / 'rejected' |

**`sft_feedback`** — Skip/Reject/Edit 反馈

| 字段 | 说明 |
|------|------|
| `feedback_type` | 'skip' / 'reject' / 'edit' |
| `reject_reason` | **skip/reject 时填写**，为什么两个候选都不够好 |
| `scene` | 场景标签 |
| `opt1` / `opt2` | 被跳过的候选内容 |

### Status 流转

```
自动记录 → pending_review  (similarity < 85 或选择了 custom)
自动记录 → approved        (similarity ≥ 85 且选择了 opt1/opt2)
pending_review → approved  (人工审核通过)
pending_review → rejected  (人工审核拒绝)
```

---

## 三、RLHF 训练导出

### API 端点

```bash
# 导出已审核语料（用于 SFT 训练）
GET /api/sft-export?status=approved&limit=1000&lang=en&format=jsonl

# 导出格式参数：format=json（JSON 数组）或 format=jsonl（每行一条）
# lang=en：只导出英文数据（避免中文污染英文模型）
```

### 导出数据结构

```json
{
  "messages": [
    { "role": "system", "content": "<完整system prompt>" },
    { "role": "user", "content": "<input_text 或前10轮对话拼接>" },
    { "role": "assistant", "content": "<human_output>" }
  ],
  "metadata": {
    "human_selected": "opt1",
    "chosen_output": "被选中的回复文本",
    "rejected_output": "被拒绝的回复文本",
    "scene": "trial_intro",
    "similarity": 92,
    "is_custom_input": 0
  }
}
```

**注意**：`system` prompt 内容与 `experience.js` 推理时完全一致（共用 `systemPromptBuilder.cjs`）。

### 语言过滤

```javascript
// 英文检测正则（server/routes/sft.js 导出逻辑内部）
const isEnglish = (text) => /^[a-zA-Z\s.,!?]+$/.test((text || '').slice(0, 100));
// 传入 lang=en 时：input_text 和 human_output 都不是纯英文 → 该记录跳过
```

---

## 四、训练/推理 Prompt 对齐

### 架构

```
systemPromptBuilder.cjs（CommonJS，server/routes/experience.js 和 server/routes/sft.js 导出逻辑共用）
  ├─ buildFullSystemPrompt(clientId, scene, messages)
  │   ├─ 查询 creator 信息（wa_owner / beta_status）
  │   ├─ 查询 operator_experiences 配置
  │   ├─ 查询 client_memory（客户偏好）
  │   ├─ 查询 policy_documents（政策文档）
  │   └─ 编译完整 prompt（与推理时完全一致）
  │
  ├─ compileSystemPrompt() — 内部组装函数
  └─ buildBasePrompt() — operator 未知时的兜底版本
```

### Prompt 组装顺序

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

---

## 五、云端训练方案

### 推荐技术栈

| 组件 | 推荐配置 |
|------|---------|
| 训练平台 | **Modal**（按秒计费，A100 40GB ≈ $10-15/轮） |
| 训练框架 | **Axolotl**（QLORA，1 行命令启动） |
| Base 模型 | **mistralai/Mistral-7B-Instruct-v0.3**（英文最强开源 7B） |
| 推理托管 | 硅基流动 / Together AI / Modal |

**为什么不选 Gemini**：不支持 RLHF 训练（Reward Model + PPO），只能做 SFT 微调。

### 训练数据门槛

| 条件 | 说明 |
|------|------|
| 总 approved 语料 ≥ 200 条 | LoRA 微调最低数据量 |
| custom（人工手写）≥ 20 条 | 高质量训练数据 |
| 场景覆盖 ≥ 3 类 | 避免模型过拟合单一场景 |

### 训练数据质量过滤（建议）

```sql
-- 优先使用高相似度 + custom 覆盖的数据
SELECT * FROM sft_memory
WHERE status = 'approved'
  AND scene IS NOT NULL
  AND human_selected = 'custom'
ORDER BY similarity DESC;

-- 次选：高采纳率数据
SELECT * FROM sft_memory
WHERE status = 'approved'
  AND scene IS NOT NULL
  AND human_selected IN ('opt1', 'opt2')
  AND similarity >= 85;
```

### Axolotl 训练配置示例

```yaml
# axolotl qwen2_5_lora.yaml（同样适用于 Mistral）
base_model: mistralai/Mistral-7B-Instruct-v0.3
model_type: MistralForCausalLM

dataset:
  path: /path/to/train.jsonl
  type: chatml.interactive

lora:
  r: 8
  lora_alpha: 16
  target_modules: [q_proj, k_proj, v_proj, o_proj]

trainer:
  steps: 1000        # 小数据集 500-1000 步
  batch_size: 4
  learning_rate: 0.0002
  scheduler: cosine
  warmup_steps: 50
```

---

## 六、推理服务部署

### 环境变量配置

```bash
# 后端使用哪个模型
USE_FINETUNED=true                    # true = 使用微调后模型
FINETUNED_BASE=https://your-endpoint.com/v1  # 微调模型 API 地址
AB_RATIO=0.1                          # 灰度比例（10% 流量走新模型）
```

### 推理服务启动（Modal）

```python
# inference.py（Modal）
from modal import Image, Stub, web_endpoint
import modal

image = Image.debian_slim().pip_install("vllm")
stub = Stub()

@stub.function(image=image)
@web_endpoint(method="POST")
def infer(messages: list, temperature: float = 0.7):
    # vLLM + LoRA adapter 推理
    ...
```

---

## 七、相关文件路径

| 资源 | 路径 |
|------|------|
| SFT 语料数据库 | MySQL `wa_crm_v2`（运行时；schema 见 `/Users/depp/wa-bot/wa-crm-v2/schema.sql`） |
| SFT Dashboard | `/Users/depp/wa-bot/wa-crm-v2/src/components/SFTDashboard.jsx` |
| 共享 Prompt 构建器 | `/Users/depp/wa-bot/wa-crm-v2/systemPromptBuilder.cjs` |
| Experience Router | `/Users/depp/wa-bot/wa-crm-v2/server/routes/experience.js` |
| 后端 API | `/Users/depp/wa-bot/wa-crm-v2/server/index.cjs` |
| 数据库 Schema | `/Users/depp/wa-bot/wa-crm-v2/schema.sql` |
| SFT 项目文档 | `/Users/depp/wa-bot/wa-crm-v2/SFT_PROJECT.md` |

---

## 八、禁止事项

1. **禁止**恢复或重新引入 `crm.db` / SQLite 历史链路
2. **禁止**在未调用 `GET /api/policy-documents` 的情况下输出涉及政策内容的回复
3. **禁止**将 `wa_phone` 泄露到日志或外部系统
4. **禁止**使用非对应 operator 的话术体系（Beau / Yiyun 规则不同）
