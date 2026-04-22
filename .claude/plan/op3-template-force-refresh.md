# OP3 模板强刷功能规划

## 操作类型判断
我判断此次操作类型为：需求规划。

## 增强后的需求
目标：修复昨天新增的 OP3 话术筛选前端在实际使用中“模板经常不刷新”的问题。每次 OP3 需要展示模板时，都应基于**最新几条消息**重新识别当前话题（优先复用现有新话题判断/自动话题识别逻辑），再结合当前**事件阶段 / 生命周期阶段**，强制回到本地文档模板源中进行检索，并把匹配模板稳定呈现在 OP3 区域。

### 范围
- 前端：OP3 卡片刷新触发、消息上下文采集、topic/stage 透传、请求去重与显示状态
- 后端：`/api/experience/retrieve-template` 扩充检索上下文；local rule retrieval 从 scene-only 升级为 scene + topic + stage + recent_messages
- 数据：`docs/rag/knowledge-manifest.json` 为核心模板源补充 topic/stage 维度元数据

### 非目标
- 不改 AI A/B 候选生成主链路
- 不重写整套 topic detector，只复用/轻扩已有逻辑
- 不新增远端检索服务，仅用本地 docs/rag source

### 验收标准
1. 切换达人、收到新消息、手动重生成时，OP3 模板都会重新检索而不是沿用旧结果。
2. 检索使用最近消息窗口 + topic + 当前 stage，而不是只看 `scene/operator/userMessage`。
3. 当 topic 或 stage 变化时，OP3 卡片会刷新并显示新的模板或明确 empty reason。
4. 模板检索失败/无命中不会影响 AI 候选卡，只影响 OP3 卡片状态。
5. 返回结果中可定位命中来源（source/matchScore/可选 matched_by）。

## 代码现状摘要
- `src/components/StandardReplyCard.jsx` 当前仅依赖 `scene/operator/userMessage` 自动拉取模板，`useEffect` 依赖过弱。
- `src/components/AIReplyPicker.jsx` 当前只把 `incomingMsg.text` 传给 `StandardReplyCard`，没有传 topic/stage/recent messages。
- `src/components/WAMessageComposer.jsx` 已有：
  - `messages`
  - `currentTopic`
  - `autoDetectedTopic`
  - `activeEvents`
  - `inferAutoTopic({ messages, activeEvents })`
- `src/components/WAMessageComposer/ai/topicDetector.js` 已具备 topic 推断与切话题逻辑，可直接复用。
- `server/routes/experience.js` 的 `/api/experience/retrieve-template` 当前只接收 `client_id/operator/scene/user_message`。
- `server/services/localRuleRetrievalService.js` 当前只按 `scene/operator/userMessage` 打分，不支持 topic/stage/recent messages。
- `docs/rag/knowledge-manifest.json` 当前只有 `scene/type/priority`，缺 topic/stage 元数据。

## 实施方案

### 1. 前端：把 OP3 刷新从“卡片内部猜测”改为“聊天上下文驱动”
涉及文件：
- `src/components/WAMessageComposer.jsx`
- `src/components/AIReplyPicker.jsx`
- `src/components/StandardReplyCard.jsx`

#### 1.1 在 `WAMessageComposer.jsx` 产出模板检索上下文
新增一个稳定的 `templateQueryContext` / `templateRefreshKey`，来源包括：
- `clientId`
- `scene`
- `operator`
- 最近 5~10 条消息文本（或 hash）
- `currentTopic` / `autoDetectedTopic` 的最终 topicKey/topicLabel
- 当前 lifecycle stage
- 当前 active event stage（若有）
- 手动刷新 nonce/version

建议优先级：
- topic 以 `currentTopic` 为主，若为空则退回 `autoDetectedTopic`
- stage 以 lifecycle stage 为主，active event 作为辅助

#### 1.2 `AIReplyPicker.jsx` 透传完整上下文给 OP3
把当前仅传的：
- `scene`
- `operator`
- `incomingMsg?.text`
- `clientId`

扩展为：
- `topicKey`
- `topicLabel`
- `lifecycleStageKey`
- `lifecycleStageLabel`
- `eventStage`
- `recentMessages`
- `refreshReason`
- `refreshKey`
- `userMessage`（保留）

#### 1.3 `StandardReplyCard.jsx` 按 refreshKey 强制重取
把当前依赖：
- `[scene, operator, userMessage, autoFetch]`

升级为至少依赖：
- `[refreshKey, autoFetch]`

并增加：
- 请求竞态保护（requestVersion 或 AbortController）
- 四态展示：loading / success / empty / error
- 头部展示检索依据（topic/stage/source）
- “暂无模板”时展示更明确原因

### 2. 后端：扩展 `/api/experience/retrieve-template`
涉及文件：
- `server/routes/experience.js`

将接口入参从：
- `client_id`
- `operator`
- `scene`
- `user_message`

扩展为：
- `topic_key`
- `topic_label`
- `lifecycle_stage_key`
- `lifecycle_stage_label`
- `event_stage`
- `recent_messages`
- `refresh_reason`

并在响应中补充：
- `source`
- `matchScore`
- `matched_by`（可选）
- `resolved_topic`
- `resolved_stage`

### 3. 后端：增强 localRuleRetrieval 打分逻辑
涉及文件：
- `server/services/localRuleRetrievalService.js`

当前逻辑：scene > operator > type > userMessage keywords

升级为：
1. scene 命中保留高权重
2. topic_key 命中 source metadata 时加高权重
3. lifecycle/event stage 命中 source metadata 时加权
4. recent_messages 聚合关键词，不只看最后一句
5. operator playbook 继续加权
6. 若无精准命中，回退到 scene best-effort

### 4. 数据：给核心模板源补 metadata
涉及文件：
- `docs/rag/knowledge-manifest.json`

为高频模板源新增字段，例如：
- `topic`
- `lifecycle_stage`
- `event_stage`
- `keywords`

先补最核心的几个 source，避免一次性大规模重标注。

## 推荐落地顺序
1. `WAMessageComposer.jsx` 计算 `templateQueryContext` 和 `refreshKey`
2. `AIReplyPicker.jsx` 透传新上下文
3. `StandardReplyCard.jsx` 改用 `refreshKey` 触发 + 展示新状态
4. `server/routes/experience.js` 扩参
5. `server/services/localRuleRetrievalService.js` 增加 topic/stage/recent_messages 打分
6. `docs/rag/knowledge-manifest.json` 给核心 source 补 topic/stage metadata
7. 用真实聊天做回归验证

## 核心风险
- `knowledge-manifest.json` 现有 metadata 不足，若不补字段，topic/stage 强检索效果有限
- topic detector 目前偏关键词规则，误判时需要 fallback
- 刷新过于频繁可能导致重复请求，需要 `refreshKey + 去重`

## 验证清单
1. 切换不同 creator，OP3 模板必须变化或明确 empty。
2. 同一聊天收到新消息后，若 topic 或 recent window 改变，OP3 必须刷新。
3. 手动重生成时，即便 topic 相同，也会重新检索模板。
4. 修改事件阶段后重新进入聊天，OP3 会按新 stage 拉模板。
5. `/api/experience/retrieve-template` 返回的 source 与前端显示一致。

## 涉及文件
- `src/components/WAMessageComposer.jsx`
- `src/components/AIReplyPicker.jsx`
- `src/components/StandardReplyCard.jsx`
- `src/components/WAMessageComposer/ai/topicDetector.js`
- `server/routes/experience.js`
- `server/services/localRuleRetrievalService.js`
- `docs/rag/knowledge-manifest.json`
