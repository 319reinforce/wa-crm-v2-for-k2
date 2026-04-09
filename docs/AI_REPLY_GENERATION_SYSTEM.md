# AI 回复生成系统技术文档

> 版本：2026-04-09
> 负责模块：`src/components/WAMessageComposer.jsx`

---

## 一、系统架构总览

```
用户点击机器人图标（或定时轮询触发）
    ↓
generateForIncoming → generateViaExperienceRouter → POST /api/minimax
    ↓
MiniMax/OpenAI 返回 → extractText() → pushPicker({ opt1, opt2 })
```

### 核心调用链路

1. `checkNewMessages()` — 定时轮询（每5秒），拉取最新消息
2. `generateForIncoming(latestMsg)` — 为最新达人消息生成候选回复
3. `generateViaExperienceRouter({ conversation, scene, client_id, richCtx })` — Experience Router 核心
4. `buildSystemPrompt()` — 组装 System Prompt（双模式 + 回复风格）
5. `buildTopicContext()` — 话题上下文（差异化结构）
6. `buildRichContextParagraph()` — 丰富上下文注入
7. `buildConversationSummary()` — 早期消息摘要
8. `POST /api/minimax` — 发送至 AI 服务商（USE_OPENAI 自动路由）

---

## 二、会调用哪些数据源

### 2.1 消息数据（messages）

- **来源**：`GET /api/creators/{creatorId}/messages`
- **字段**：`{ id, creator_id, role, text, timestamp, created_at }`
- **role 取值**：`'me'`（运营发出）| `'user'`（达人发出）
- **处理逻辑**：
  - 最多取最近 20 条：`slice(-20)`
  - 转换为 conversation 格式：`{ role: 'assistant'|'user', content: text }`
  - 同一话题时（manual/auto）：最近 10 条直接传，更早的 11-20 条做摘要注入 Prompt

### 2.2 达人档案数据（client / creator）

- **来源**：父组件传入的 props
- **关键字段**：
  - `client.phone` — 用于 API 调用标识
  - `client.name` — 用于称呼客户
  - `client.wa_owner` — 负责人（Beau / Yiyun）
  - `client.conversion_stage` — 建联阶段
  - `creator._full.wacrm` — WA CRM 数据（beta_status, priority, agency_bound 等）
  - `creator._full.keeper` — Keeper Link 数据（keeper_gmv 等）
  - `creator._full.joinbrands` — JoinBrands 数据（ev_trial_7day, ev_monthly_joined 等）

### 2.3 活跃事件数据（activeEvents）

- **来源**：`GET /api/events/summary/{creatorId}` — 过滤 `status='active'`
- **事件类型**：
  - `trial_7day` — 7天挑战
  - `monthly_challenge` — 月度挑战
  - `agency_bound` — Agency 签约
  - `gmv_milestone` — GMV 里程碑
  - `referral` — 推荐新用户
- **处理逻辑**：过滤出 `status='active'` 的事件，按 `event_key` 映射到话题标签

### 2.4 策略文档数据（policyDocs）

- **来源**：`GET /api/policy-documents?active_only=true`
- **用途**：根据 scene 匹配 `applicable_scenarios`，提取 `policy_tags` 注入 Prompt

### 2.5 客户记忆数据（clientMemory）

- **来源**：`GET /api/client-memory/{phone}`
- **数据结构**：`{ memory_type, memory_key, memory_value }[]`
- **用途**：提取客户偏好（preference）注入 `richContextParagraph`

### 2.6 话题状态（currentTopic / autoDetectedTopic）

- **来源**：组件内部 state
- `currentTopic` — 手动或自动触发的话题（触发 Prompt 生成）
- `autoDetectedTopic` — 自动检测到的话题（仅用于 UI 显示）

---

## 三、会提取哪些信息

### 3.1 从消息中提取

- 关键词（通过 `extractKeywords()` 分词，去除长度 ≤ 2 的词）
- Jaccard 相似度（用于话题切换判断）
- 最后一条消息的发送者角色（决定双模式）
- 消息数量、时间戳（用于 48 小时检测）

### 3.2 从话题系统提取

- 话题标签（`topic_key`）
- 触发方式（`trigger`: manual / auto / keyword / time）
- 话题阶段（`phase`）
- 活跃事件映射

### 3.3 从事件系统提取

- `event_key` → 话题标签映射
- `status='active'` 事件 → 进行中文本
- `meta` 数据（weekly_target, bonus_per_video, phase）

---

## 四、System Prompt 完整结构

### 4.1 同一话题模式（manual / auto 触发）

当 `effectiveTopic.trigger` 为 `'manual'` 或 `'auto'` 时，使用以下结构：

```
【当前话题】
{话题标签}（{触发方式}）| {事件阶段}
（← 简短版，一行说完，不重复强调）

【进行中事件】
{trial_7day}（Yiyun负责）目标35条/周·进行中·剩余5天
（或无进行中事件：暂无进行中事件）

【当前对话上下文】
- 场景: {sceneLabel}（中文场景标签）
- 客户语气: {friendly/formal/casual/neutral}
- 语言: {中文/英文}
- 总消息: {N}条 | 上次互动: {今天/昨天/N天前}
- 时间: 周{day_of_week}{工作时间/非工作时间}
- 客户偏好: {key: value}（如有）
- 匹配策略: {policy_tags}（如有）

【更早对话摘要（共{olderCount}条）】← 仅当总消息>10条时
[达人]: {text...}
[运营]: {text...}
...

【客户档案】
- 姓名: {clientName}
- 负责人: {owner}
- 建联阶段: {stage}

【输出禁止规则 — 严格遵守】
1. 禁止提及具体GMV数字、收入数据
2. 禁止提及其他达人姓名、状态、优先级
3. 禁止提及公司内部备注、合同条款
4. 禁止将客户与其他人做对比

【回复风格 — 严格遵守】
- 语气自然亲切，像朋友间发消息，不要生硬刻板
- 句子要短，每条不超过80字
- 用换行分隔要点，避免一大段文字
- 主动推进下一步行动，不要只停留在当前问题
- 称呼客户名字，显得更personal
- 句尾可以有"~"或"!"体现热情

【各场景 emoji 参考】
- 试用/邀请：🎉 ✨ 🙌
- 月卡/付费：💎 💳 📅
- GMV/业绩：📈 💰 🔥
- 视频/内容：📹 🎬 ✨
- 付款问题：💳 ⚠️ 🔔
- 申诉/违规：🔒 📋 🆘
- 建联/开场：👋 😊 ✨
- 推荐用户：🤝 🎁 🙌

【双模式回复要求】
模式一（推进模式）：上一条是运营发的
→ 在回复末尾适当推进事件进展
模式二（响应模式）：上一条是达人发的
→ 直接回答客户问题
```

### 4.2 新话题模式（keyword / time 触发）

当 `effectiveTopic.trigger` 为 `'keyword'` 或 `'time'` 时，使用以下结构：

```
【当前话题】
- 话题: {topicLabel}
- 开始: {detectedAt}（{triggerLabel}）
- 用户阶段: {stage}（{owner}负责）

【进行中事件】
详细完整版（包含 meta.weekly_target、bonus_per_video、phase 描述）

【当前对话上下文】— 同上

【客户档案】— 同上

【输出禁止规则】— 同上

【回复风格】— 同上

【各场景 emoji 参考】— 同上

【双模式回复要求】— 同上
```

---

## 五、三触发机制（话题检测）

### 触发A：48小时无互动

- **条件**：`Date.now() - lastActivityRef > 48 * 3600 * 1000`
- **实现**：
  - `lastActivityRef` 每次 `checkNewMessages` 获取到消息时更新为 `Date.now()`
  - `setInterval(check48h, 5分钟)` 独立定时检测
  - 触发时自动开启新话题，`trigger: 'time'`

### 触发B：关键词Jaccard相似度 < 0.3

- **条件**：`computeJaccardSimilarity(currentTopic.keywords, newKeywords) < 0.3`
- **实现**：
  - `extractKeywords()` 分词，去除长度 ≤ 2 的词
  - `Jaccard = intersection / union`
  - 触发时自动切换话题，`trigger: 'keyword'`

### 触发C：话题类型发生变化

- **条件**：`inferTopicKey(newText) !***REMOVED*** currentTopic.topic_key && newKey !***REMOVED*** 'general'`
- **实现**：正则匹配关键词，映射到 `topic_key`
- **触发时**：自动切换话题，`trigger: 'keyword'`

### 触发D：手动标记

- **触发方式**：用户点击工具栏 📌 新话题按钮，从下拉菜单选择话题
- **处理**：立即设置 `currentTopic`，`trigger: 'manual'`

### 触发E：自动检测（仅用于UI显示）

- **触发方式**：`messages` 变化时自动调用 `inferAutoTopic()`
- **用途**：自动检测标签显示在 Desktop/Mobile Header，不自动注入 Prompt

### Fallback

`currentTopic` 为空时，`autoDetectedTopic` 自动提升为 `effectiveTopic`，`trigger: 'auto'`

---

## 六、自动检测函数 `inferAutoTopic()`

基于 **EVENT 关键词** + **最新20条消息** + **活跃事件** 打分

- **输入**：`{ messages, activeEvents }`
- **输出**：`{ topic_key, label, confidence, score }`

### 打分规则

- 每命中一个关键词 +1分
- 该达人有对应活跃事件 +3分
- 取最高分，默认 `'general'`（<1分时）

### 置信度

- `high`：score ≥ 4
- `medium`：score 2-3
- `low`：score = 1

### 话题标签映射（12个）

`trial_intro` / `monthly_inquiry` / `gmv_inquiry` / `mcn_binding` / `commission_query` / `content_request` / `payment_issue` / `violation_appeal` / `referral` / `general` / `follow_up` / `first_contact`

---

## 七、事件阶段判断逻辑

### 各事件推进文案

**trial_7day / monthly_challenge**：
- phase1: "你已经成功加入【7天挑战】！本周目标35条，完成后可得 $5/条 Bonus~"
- phase2: "本周你已发布X条，目标35条。继续加油，有问题随时告诉我~"
- phase3: "挑战即将结束！本周你已发X条，差Y条达成目标，加油冲刺！"

**agency_bound**: "你已经完成Agency签约！接下来可以解锁GMV激励任务和推荐奖励~"

**gmv_milestone**: "恭喜你的GMV达到里程碑！相关奖励会尽快发放，继续保持💪"

**referral**: "每推荐一位新达人，可获得 $10-$15 奖励。推荐成功记得告诉我哦~"

---

## 八、双模式 Prompt 逻辑

### 触发条件：最后一条消息的发送者 role

**模式一：推进模式（`lastMsgRole ***REMOVED***= 'assistant'`）**
- 基础 system prompt + 【当前进行中事件】段落 + 【推进规则】
- 在回复末尾追加推进语句

**模式二：响应模式（`lastMsgRole ***REMOVED***= 'user'`）**
- 基础 system prompt + 回复要求
- 直接回答客户问题

---

## 九、AI 服务商路由

### 环境变量：`USE_OPENAI=true` → OpenAI；`false` → MiniMax

### MiniMax（`USE_OPENAI=false`）

- 并发两路请求（`Promise.all`）：temp 0.8 vs temp 0.4
- 返回格式：`{ content: [{type:'text', text:opt1}], content_opt2: [{type:'text', text:opt2}] }`

### OpenAI（`USE_OPENAI=true`）

- 调用 `generateCandidates()`：并发生成两个候选
- 返回格式：`{ content_opt1, content_opt2 }`

### 前端统一

从 `content_opt1` / `content_opt2` 字段提取

---

## 十、相关文件

| 文件 | 路径 |
|------|------|
| 消息编辑器组件 | `src/components/WAMessageComposer.jsx` |
| AI 服务路由 | `server/routes/ai.js` |
| Experience Router | `server/routes/experience.js` |
| 共享 Prompt 构建器 | `systemPromptBuilder.cjs` |
| SFT Service | `server/services/sftService.js` |
| 数据库 Schema | `schema.sql` |
