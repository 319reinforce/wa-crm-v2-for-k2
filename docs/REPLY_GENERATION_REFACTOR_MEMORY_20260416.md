# Reply Generation Refactor Memory

更新日期：2026-04-16

## 背景

本轮工作围绕 WA CRM v2 当前“AI 回复生成 + SFT 语料回流”主链路做分阶段重构，目标是把原本前端分散拼装、后端多入口重复实现的逻辑收口成可追踪、可扩展的一条主链。

同时，本记录作为当前 session 的落袋 memory 文档，用于后续继续开发、排查和验收。

## 当前状态快照

- 回复生成主链当前基线：
  - 前端主流程已改为单次调用 `POST /api/ai/generate-candidates`
  - 兼容接口 `POST /api/minimax` 与 `POST /api/experience/route` 已统一委托到 `replyGenerationService`
- SFT 回流主链当前基线：
  - `POST /api/sft-memory` 已接入 generation tracking metadata
  - `GET /api/sft-export` 已能带出 generation tracking metadata
- 数据库当前基线：
  - `sft_memory` 正式列已完成迁移
  - 新增索引已完成创建
- 可视化当前基线：
  - `SFTDashboard` 记录卡能看到单条 SFT 的生成追踪字段
  - `SFTDashboard` 评估页能看到 generation log 的聚合与最近日志
- 本文档当前是这轮工作的权威 handoff 记录
  - 由于共享 MetaMemory CLI 不可用，仓库内文档是当前唯一可靠落袋点

## 本轮已完成

### 1. 当前真实主链路分析已完成

- 已确认生产主链路此前为：
  - 前端计算 `scene/topic/richContext/conversationSummary`
  - `POST /api/ai/system-prompt`
  - `POST /api/minimax`
  - 运营选择候选
  - `POST /api/sft-memory`
- 已确认：
  - `POST /api/experience/route` 之前不是 UI 主路径
  - 当前默认生成仍走 MiniMax 主链
  - `.env` 中 `AB_RATIO=1.5` 在 `USE_FINETUNED=false` 时无影响，但一旦开启微调会变成几乎全量流量

### 2. Phase 1 已完成：发送成功后后端统一落 CRM 消息

- 已新增统一持久化服务：
  - `server/services/directMessagePersistenceService.js`
- 已让以下发送接口在 WA 发送成功后由后端持久化 `wa_messages`：
  - `POST /api/wa/send`
  - `POST /api/wa/send-media`
- 前端 `WAMessageComposer.jsx` 已优先消费后端返回的 `crm_message`
- 对真实 outbound send 的后端持久化，已明确关闭：
  - 短时间重复去重
  - group conflict guard

### 3. Phase 2 已完成：回复生成已统一成单一后端服务

- 已新增统一编排服务：
  - `server/services/replyGenerationService.js`
- 统一服务现已负责：
  - owner/client scope 校验
  - 完整 system prompt 构建
  - retrieval snapshot 写入
  - provider/model 路由
  - generation log 写入
  - 标准候选返回
- 已新增新主接口：
  - `POST /api/ai/generate-candidates`
- 已把前端主链路切换为单次请求：
  - `src/components/WAMessageComposer/ai/experienceRouter.js`
- 已把兼容入口收口到同一 service：
  - `POST /api/experience/route`
  - `POST /api/minimax`
- 当前 `/api/minimax` 已不再保留一整套独立生成实现，而是委托 `replyGenerationService`

### 4. Phase 3 已完成：SFT 记录已接上生成追踪字段

- `POST /api/sft-memory` 现在支持并落库/回退保存以下追踪字段：
  - `retrieval_snapshot_id`
  - `generation_log_id`
  - `provider`
  - `model`
  - `scene_source`
  - `pipeline_version`
- 兼容策略：
  - 如果 `sft_memory` 已有正式列，优先写正式列
  - 如果目标库未迁移，仍会写入 `context_json`，避免老库直接报错
- `GET /api/sft-export` 已改为：
  - 优先读正式列
  - 回退读 `context_json`

### 5. SFTDashboard / 审计视图已补可见性

- `src/components/SFTDashboard.jsx` 现在已展示单条语料的生成追踪信息：
  - `provider`
  - `model`
  - `pipeline_version`
  - `retrieval_snapshot_id`
  - `generation_log_id`
- 评估页已新增生成审计视图：
  - 近 7 天 generation stats
  - provider 分布
  - route 分布
  - 最近 generation log 列表

### 6. MySQL 表结构迁移已执行完成

- 已新增迁移脚本：
  - `migrate-sft-generation-columns.js`
- 已实际执行迁移，`sft_memory` 已补齐：
  - `retrieval_snapshot_id`
  - `generation_log_id`
  - `provider`
  - `model`
  - `scene_source`
  - `pipeline_version`
- 已新增索引：
  - `idx_sft_retrieval_snapshot`
  - `idx_sft_generation_log`
  - `idx_sft_provider_model`

## 本轮涉及的关键文件

### 回复生成主链

- `server/services/replyGenerationService.js`
- `server/routes/ai.js`
- `server/routes/experience.js`
- `src/components/WAMessageComposer/ai/experienceRouter.js`

### SFT 记录与导出

- `server/services/sftService.js`
- `server/routes/sft.js`
- `src/components/WAMessageComposer.jsx`
- `schema.sql`
- `migrate-sft-generation-columns.js`

### 可视化与审计

- `src/components/SFTDashboard.jsx`
- `server/routes/audit.js`

## 已完成验证

- `node --check server/routes/ai.js`
- `node --check server/routes/experience.js`
- `node --check server/routes/sft.js`
- `node --check server/routes/audit.js`
- `node --check server/services/replyGenerationService.js`
- `node --check server/services/sftService.js`
- `node --check migrate-sft-generation-columns.js`
- `npm run build`
- `npm test`
- migration script 实际执行成功

## 当前未完成

### 1. 文档同步还没补齐

以下文档还没把本次重构后的主链更新进去：

- `docs/AI_REPLY_GENERATION_SYSTEM.md`
- `SFT_PROJECT.md`
- `docs/SFT_RLHF_PIPELINE.md`

### 2. 旧兼容代码还没有继续清理

虽然 `/api/minimax` 已经收口到新 service，但下面这些仍属于 legacy/兼容区，后续还可以再整理：

- `src/utils/legacy/minimax.js`
- 旧文档里对 `/api/ai/system-prompt + /api/minimax` 双请求链路的描述

### 3. 更细的追踪分析视图还没做

当前 UI 已经能看到追踪字段，但还没有：

- 按 `pipeline_version` 做聚合统计
- 从单条 SFT 记录跳转到对应 `generation_log`
- 从单条 SFT 记录跳转到对应 `retrieval_snapshot`

### 4. API/UI integration test 还没补新增断言

项目 smoke 和 unit test 已通过，但没有新增专门覆盖：

- `POST /api/ai/generate-candidates`
- `/api/minimax` 委托后兼容返回结构
- `POST /api/sft-memory` 对 generation metadata 的落库
- `SFTDashboard` 的新展示字段

## 下一步准备做的工作

如果继续本条线，建议直接按下面顺序推进：

### 1. 先补文档对齐

目标：把“代码已经完成、文档仍描述旧链路”的偏差消掉。

优先更新：

- `docs/AI_REPLY_GENERATION_SYSTEM.md`
- `SFT_PROJECT.md`
- `docs/SFT_RLHF_PIPELINE.md`

需要同步的核心内容：

- 前端主链路已从双请求改为 `/api/ai/generate-candidates`
- `/api/minimax` 已降级为兼容入口，不再是推荐主链路
- `sft_memory` 已新增 generation tracking 正式列
- `SFTDashboard` 已可见 generation tracking 信息

### 2. 再补专项测试

目标：让这次重构不只靠 smoke/build，而有明确的回归保护。

优先测试点：

- `replyGenerationService.generateReplyCandidates()`
- `/api/ai/generate-candidates` 返回字段完整性
- `/api/minimax` 委托后的兼容返回结构
- `/api/sft-memory` 对 generation metadata 的正式列/回退写入
- `GET /api/sft-export` 的正式列优先读取逻辑

### 3. 最后做更深的追踪联查体验

目标：从“能看到字段”升级到“能顺着字段追下去”。

建议增强：

- `SFTDashboard` 单条记录增加跳转或展开：
  - `generation_log`
  - `retrieval_snapshot`
- `audit` 页增加按 `pipeline_version`、`provider`、`model` 的组合筛选
- 增加“某个 generation_log 对应的 SFT 采纳结果”联查视图

## 已知风险 / 注意事项

- 当前 worktree 很脏，本轮没有清理或回滚任何无关改动。
- 共享 MetaMemory CLI `mm` 当前环境不可用，因此本次 memory 采用仓库内文档落袋，而不是写入共享 memory server。
- `USE_FINETUNED=true` 时仍需特别留意 `.env` 里的 `AB_RATIO`，避免误变成超预期放量。

## 后续建议顺序

1. 先补文档：
   - 更新架构文档，避免代码已变、文档仍旧描述旧链路
2. 再补测试：
   - 至少补 route/service 级断言，覆盖 generation metadata 落库
3. 最后再做 UI 深化：
   - 增加从 SFT 到 generation log / retrieval snapshot 的联查入口

## 一句话结论

当前“回复生成 -> 候选返回 -> SFT 记录 -> 追踪字段 -> Dashboard 可见 -> MySQL 正式列”这条链已经打通，可以作为后续继续增强的稳定基线。

## 交接说明

如果后续由其他 agent 或下一个 session 接手，建议先读：

1. 本文档
2. `server/services/replyGenerationService.js`
3. `server/routes/sft.js`
4. `src/components/WAMessageComposer.jsx`
5. `src/components/SFTDashboard.jsx`

这样可以最快恢复对“生成主链 + SFT 回流 + 追踪字段 + 展示层”的完整上下文。
