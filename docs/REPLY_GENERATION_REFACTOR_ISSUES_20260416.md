# Reply Generation Refactor Issues

更新日期：2026-04-16

## 背景

本问题文档用于记录对 `docs/REPLY_GENERATION_REFACTOR_MEMORY_20260416.md` 所述完成情况的复核结果。

复核范围包括：

- 回复生成主链是否已切换到 `POST /api/ai/generate-candidates`
- 兼容入口 `/api/minimax` / `/api/experience/route` 是否已统一委托
- `sft_memory` generation tracking 字段是否已落 schema / MySQL / UI
- 当前文档、测试、联查体验是否与 handoff 描述一致

## 结论摘要

本轮重构主体已经落地，不是“只补了 memory 文档”。

已确认完成的部分：

- 前端主链已切到 `POST /api/ai/generate-candidates`
- `POST /api/minimax` 与 `POST /api/experience/route` 已委托到 `replyGenerationService`
- `POST /api/sft-memory` 已支持 generation tracking metadata 落库与兼容回退
- `SFTDashboard` 已展示 tracking 字段与 generation 聚合统计
- MySQL 中 `sft_memory` 的 tracking 列与索引已存在

但 handoff 文档中对“未完成项”的描述已部分过时，且当前仍存在 3 类实质性问题：

1. 联查体验前后端未闭环
2. 文档同步不一致，存在新旧链路并存
3. 测试覆盖仍偏浅，缺少针对本轮重构主路径的专项断言

## 问题清单

### P1. SFTDashboard 联查详情前端已写，后端接口未落地

当前 `SFTDashboard` 已支持点击 trace chip 后请求详情：

- `GET /api/generation-log/:id`
- `GET /api/retrieval-snapshot/:id`

但后端实际只提供了：

- `GET /api/generation-log/stats`
- `GET /api/generation-log/recent`
- `GET /api/generation-log/rag-sources`
- `GET /api/generation-log/rag-observation`

没有提供单条详情接口，因此当前联查体验会落到“加载失败或记录不存在”。

### 影响

- UI 表面上像“已经支持 drill-down”
- 实际点击后无法完成追踪闭环
- handoff 中“联查入口还没做”也不再准确，真实状态是“前端半完成，后端缺口未补”

### 证据

- `src/components/SFTDashboard.jsx`
- `server/routes/audit.js`

---

### P2. handoff 对文档同步状态的描述已经过时

handoff memory 中写明以下文档“还没同步”：

- `docs/AI_REPLY_GENERATION_SYSTEM.md`
- `SFT_PROJECT.md`
- `docs/SFT_RLHF_PIPELINE.md`

但复核发现：

- `docs/AI_REPLY_GENERATION_SYSTEM.md` 已经改成新主链描述
- `SFT_PROJECT.md` 已经写入 2026-04-16 的 v9 更新
- `docs/SFT_RLHF_PIPELINE.md` 虽然已有新内容，但仍保留旧链路描述，属于“部分同步”

### 实际问题

当前不是“文档都没同步”，而是“文档同步进度不一致”：

- 有些文档已更新
- 有些文档同时存在新旧链路描述
- 有些段落已变成重复内容，增加交接噪音

### 具体表现

- `docs/SFT_RLHF_PIPELINE.md` 仍写前端通过 `/api/ai/system-prompt` 构建 prompt 再送 `/api/minimax`
- `SFT_PROJECT.md` 顶部出现重复的 `v9 — 2026-04-16` 段落

### 影响

- 后续接手的人容易误判当前推荐主链
- memory 文档中的“下一步先补文档”优先级仍成立，但描述需要改写得更准确

---

### P2. 测试已比 handoff 描述更完整，但仍不足以覆盖这次重构主链

handoff 中写“项目 smoke 和 unit test 已通过，但没有新增专门覆盖”。

复核后确认：

- 这句不算全错，但也不够准确
- 当前项目已经补了两组与本轮重构直接相关的基础单测：
  - `tests/replyGenerationService.test.mjs`
  - `tests/sftService.test.mjs`

这些测试覆盖了：

- message normalization
- candidate text extraction
- pipeline version 常量
- generation metadata merge / fallback / truncation
- context 写回逻辑

但仍缺以下关键断言：

- `replyGenerationService.generateReplyCandidates()` 编排结果
- `POST /api/ai/generate-candidates` 返回结构
- `/api/minimax` 委托后的兼容响应
- `POST /api/sft-memory` 对正式列与 `context_json` 回退写入
- `SFTDashboard` tracking 字段展示与点击联查行为

### 影响

- 当前测试能保住工具函数
- 但保不住本轮真正最重要的 route/service/UI 集成路径

---

### P3. legacy 区已缩小，但尚未完全收口

当前主链已经不是 `/api/ai/system-prompt + /api/minimax` 双请求。

但仓库内仍存在以下 legacy 残留：

- `src/utils/legacy/minimax.js`
- 文档中对旧双请求链路的描述
- `/api/ai/system-prompt` 兼容端点仍保留

### 影响

- 新同学或新 agent 仍可能被旧入口误导
- 后续如果继续迭代生成链路，维护成本会被兼容层放大

## 已确认完成的事实

为避免后续重复审计，以下事项已确认真实完成：

### 1. 回复生成主链已收口

- 前端：`src/components/WAMessageComposer/ai/experienceRouter.js`
- 后端入口：`server/routes/ai.js`
- 统一编排：`server/services/replyGenerationService.js`

### 2. SFT tracking 已进入正式链路

字段包括：

- `retrieval_snapshot_id`
- `generation_log_id`
- `provider`
- `model`
- `scene_source`
- `pipeline_version`

写入位置包括：

- `POST /api/sft-memory`
- `context_json` 兼容回退
- `GET /api/sft-export` 正式列优先读取

### 3. Dashboard 可见性已不是“待做”

`SFTDashboard` 已可见：

- 单条记录的 provider / model / pipeline version
- retrieval / generation trace chip
- generation stats / provider 分布 / route 分布 / recent generation logs

### 4. MySQL migration 已真实执行

已复核本地 MySQL 中存在：

- 6 个 generation tracking 正式列
- `idx_sft_retrieval_snapshot`
- `idx_sft_generation_log`
- `idx_sft_provider_model`

## 建议修复顺序

### 第一优先级：补齐联查闭环

补以下后端接口：

- `GET /api/generation-log/:id`
- `GET /api/retrieval-snapshot/:id`

若短期不做，应先把前端 trace chip 改为不可点击，避免假功能。

### 第二优先级：统一文档口径

重点修正：

- `docs/SFT_RLHF_PIPELINE.md` 中旧双请求链路描述
- `SFT_PROJECT.md` 中重复 v9 段落
- handoff memory 中“文档尚未同步”的说法

### 第三优先级：补专项测试

建议新增：

- route 级：`/api/ai/generate-candidates`
- route 级：`/api/minimax`
- route/service 级：`/api/sft-memory` tracking metadata 落库
- UI 级：`SFTDashboard` trace 展示和联查行为

## 一句话判断

当前状态最准确的描述不是“这轮还没真正交接完”，而是：

“主链已经打通，文档与联查体验存在偏差，测试仍需补到主路径级别。”
