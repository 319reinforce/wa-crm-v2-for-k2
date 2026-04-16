# RAG / 回复链运行态对齐记录 — 2026-04-16

更新日期：2026-04-16

## 背景

本记录用于沉淀 2026-04-16 这轮与 RAG、灰度回复链、PM2 活实例相关的实际运行态调整结果。

目标不是重复通用 runbook，而是给后续接手人一个“当前线上到底跑成什么样”的 dated handoff。

## 本轮最终保留的运行配置

以仓库根目录 `.env` 的当前值为准，已确认当前保留的关键开关如下：

- `OPENAI_API_BASE=https://chintao.cn/v1`
- `OPENAI_MODEL=gemini-2.5-flash`
- `USE_OPENAI=true`
- `OPENAI_RAG_ENABLED=true`
- `OPENAI_VECTOR_STORE_ID` 已配置
- `USE_FINETUNED=true`
- `AB_RATIO=0.1`

说明：

- 当前环境是“OpenAI 兼容网关 + Gemini 模型”组合，不是官方 `api.openai.com + gpt-4.1-mini`
- 灰度比例已收敛到 `0.1`，不再是此前高风险的 `1.5`
- `vector store` 检索能力本轮不继续强行修复，按后续事项处理

## 活实例状态

本轮复核时，活实例由 PM2 托管：

- app name: `wa-crm-api`
- PM2 script: `server/index.cjs`
- ecosystem file: `ecosystem.api.config.cjs`
- runtime cwd: `/Users/depp/wa-bot/wa-crm-v2`
- 复核时在线实例：`pm2 id=9`

补充说明：

- 早先口头结论里曾出现 `pm2 id=8`
- 复核时 `id=8` 已不存在，当前有效实例已切换为 `id=9`
- 因此后续排查应以“当前 app name / 当前 pid”为准，不要只依赖旧的 PM2 id

## 已确认通过的运行项

### 1. 服务存活

- `GET /api/health` 返回 `200`
- PM2 中 `wa-crm-api` 状态为 `online`

### 2. 回复主链可生成

对 `POST /api/ai/generate-candidates` 的实际调用已返回 `200`。

本轮至少确认过一次命中：

- `provider=finetuned`
- `model=ft:gpt-4.1-mini-2025-04-14:personal:wa-crm-beau-802269:DUN3ZW6F`

这说明：

- 当前“灰度模型输出回复”不是纸面配置，主链路确实能命中微调模型
- `AB_RATIO=0.1` 下至少已有实测命中，不是完全只走 fallback

### 3. 事件 verify 有过成功样本

已有一次 verify 冒烟结果显示：

- `verdict=reject`
- `confidence=1`
- 能准确引用 `finished the 7-day trial`
- `context_window=10`

这说明 verify 链在某些请求上可正常给出结构化判断。

## 当前仍然存在的问题

### 1. RAG 检索未真正跑通

虽然当前配置里：

- `USE_OPENAI=true`
- `OPENAI_RAG_ENABLED=true`
- `OPENAI_VECTOR_STORE_ID` 已存在

但单独执行向量检索时，仍出现：

- `Invalid URL (POST /v1/vector_stores/...)`

同时，本轮最新一条回复请求对应的 `retrieval_snapshot` 已确认：

- `rag_enabled=true`
- `rag_hit_count=0`

这表示当前状态是：

- 主回复链可以继续生成
- RAG 检索失败后会静默降级
- “回复能出结果”不等于“RAG 已经生效”

### 2. verify 不能视为完全稳定

日志中仍出现过：

- `401 invalid_api_key`
- `429 insufficient_quota`

因此“verify 冒烟通过”更准确的表述应是：

- verify 链具备可用样本
- 但当前网关 / key / 配额稳定性还不足以视作彻底收敛

### 3. Profile Agent 辅助链仍有噪音

日志中仍出现以下问题：

- extraction timeout
- LLM response has no JSON
- JSON parse error

这不一定阻断主回复链，但说明基于 LLM 的旁路能力仍存在稳定性问题。

## 结论摘要

截至 2026-04-16，本项目当前运行态更准确的结论是：

- API 服务：在线
- 灰度回复链：可用，且已实测命中过 `finetuned`
- verify：有成功样本，但并非完全稳定
- RAG 检索：当前未真正打通，处于“开关已开但检索静默失败”的状态

因此，不建议把“verify 冒烟通过”表述成“整条 RAG / 回复系统全部完全通了”。

## 后续事项

### 1. `vector store` 检索能力

按当前决定，`vector store` 检索能力由后续单独对齐，本轮不继续追。

后续对齐完成后，建议至少复跑：

```bash
node scripts/query-openai-vector-store.cjs "trial package rules"
```

以及：

```bash
POST /api/ai/generate-candidates
```

复核点：

- `retrieval_snapshot.grounding_json.rag.hit_count > 0`
- system prompt 中出现外部知识片段
- 生成结果不再只靠 policy / operator rules 支撑

### 2. verify 稳定性

后续如继续收敛 verify，请优先分离三类问题：

- 网关兼容性
- API key / 配额问题
- 模型返回格式稳定性

## 给后续接手人的一句话

当前线上状态可以描述为：

“服务在线，灰度模型回复已可用；RAG 开关已打开，但向量检索还没真正生效，这部分后续再对齐。” 
