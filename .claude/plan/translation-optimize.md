# 翻译模块优化规划

> 分支：`translationoptimize`
> 目标：① 调研 DeepL 替换可行性  ② 输入框翻译与"生成回复"解耦

---

## 1. 现状梳理

### 1.1 后端

| 文件 | 关键位置 | 职责 |
|------|---------|------|
| `server/routes/ai.js:137-155` | `POST /api/translate` | 单条 `{text, mode}` 或批量 `{texts, mode}` 翻译入口 |
| `server/services/aiService.js:35-320` | `translateText` / `translateBatch` | **走 MiniMax LLM**（不是专用翻译 API）|

**关键事实：**
- 使用专用 env：`MINIMAX_TRANSLATION_API_KEY` / `MINIMAX_TRANSLATION_API_BASE`（默认 `https://minimax.a7m.com.cn`），可独立于主 MiniMax key 配置
- 批量翻译用 system prompt 要求模型严格吐 JSON 数组，解析失败回退原文
- 自动方向检测：`hanCount vs latinCount`（`aiService.js:136-142`），决定 `to_zh` 还是 `to_en`
- 限流：顺序执行 zh/en 两组批量，避免 529

### 1.2 前端（翻译相关入口共 2 处）

| 入口 | 触发位置 | 行为 | 耦合问题 |
|------|---------|------|---------|
| **A. 对话气泡翻译** | `WAMessageComposer.jsx:2020` 顶部 🌐 按钮 | 批量翻译最近 20 条消息，译文显示在气泡下方（`translationMap`） | 与生成无关，独立工作 |
| **B. 草稿/候选翻译** | `AIReplyPicker.jsx:148-152` 内 "翻译"按钮 | 调 `runCustomTool('translate')`（`WAMessageComposer.jsx:1235-1272`），把 `pickerCustom` 文本原地翻译 | **❗ 只有生成候选后 `AIReplyPicker` 出现才能用** |

**用户痛点的根因**（`WAMessageComposer.jsx:2328-2340`）：
```jsx
{activePicker && (
    <AIReplyPicker ... onTranslateCustom={handleTranslateCustom} ... />
)}
```
`AIReplyPicker` 受 `activePicker` 门控，而 `activePicker` 只有在 `handleManualGenerate` 执行后才被 set。因此**必须先生成才能翻译输入框文本**。

### 1.3 主输入框现状

`WAMessageComposer.jsx:2562-2585` 的 `<textarea value={inputText}>` 是主输入框，目前**只有 Emoji / 图片 / 新话题按钮**，没有翻译入口。右下角只有 🤖 生成候选 + ➤ 直接发送两个动作按钮。

---

## 2. DeepL 替换可行性分析

### 2.1 对比矩阵

| 维度 | 当前（MiniMax LLM） | DeepL API Pro | 结论 |
|------|---------------------|---------------|------|
| **质量（中⇄英）** | LLM 翻译，质量不错但受 prompt/JSON 解析稳定性拖累 | 专业翻译模型，中英对 edit-distance 更低；支持 next-gen LLM 模型 | 📈 DeepL 稳定性更好 |
| **延迟** | LLM 调用 2-10s；批量 20 条单次调用 | 专用翻译 API，单句近实时；批量 50 条/请求 | 📈 DeepL 快 3-5× |
| **成本** | MiniMax 内部渠道（已用专用 key） | **$5.49/月 + $25/百万字符**；Free plan 50 万字符/月免费 | ⚠️ DeepL 按量计费，需评估当前翻译量 |
| **速率** | MiniMax 文档未明，实测顺序串行避 529 | Pro 无月度上限，单秒并发约 1200 req/s | 📈 DeepL 宽松 |
| **SDK** | 手写 fetch + JSON 解析 | 官方 `deepl-node`（维护活跃，v1.22+） | 📈 DeepL 大幅简化 |
| **功能** | 纯翻译 | 翻译 + **glossary**（术语表）+ formality（正式度）+ context（上下文参考） | 📈 DeepL 有术语表，可锁定"Beau/Yiyun/DRIFTO/GMV" 不被翻错 |
| **语种** | 任意（LLM 通用） | 33 种稳定语言，覆盖中/英/日/韩 | ✅ 满足当前需求 |
| **客服场景短板** | LLM 可按 system prompt 调风格 | DeepL formality 对 `zh` 支持有限；**俚语/表情驱动的非正式文本**不如 LLM | ⚠️ 需权衡 |

### 2.2 推荐策略：**混合路由**（不是全量替换）

| 场景 | 引擎 | 理由 |
|------|------|------|
| 输入框/候选文本的常规中英互译 | **DeepL Pro** | 低延迟、低成本、质量稳定 |
| 消息气泡批量翻译（最近 20 条） | **DeepL Pro** | 50 条/批，单请求完成 |
| 含业务术语（DRIFTO/GMV/Beta 计划等） | DeepL + 预置 glossary | 保证术语不被翻飞 |
| 需要"润色 + 翻译"的复合任务（如 emoji 润色） | 保留 MiniMax | 纯 LLM 的长处 |

### 2.3 实施风险 & 降级

- **风险 1：DeepL 在中文 WhatsApp 客服场景俚语效果未验证** → 先做 A/B（保留 `translationProvider` env 开关，默认 DeepL，fallback MiniMax）
- **风险 2：按量计费失控** → 后端 `TRANSLATION_MAX_CHARS_PER_DAY` 限额 + 用量日志（复用已有 `ai_usage_logs` 表）
- **风险 3：术语表维护** → glossary 版本 id 放 env / DB 配置表，运维可热更

---

## 3. 输入框内嵌翻译（核心需求）

### 3.1 目标

> 用户在主输入框打字后，**不必先点 🤖 生成**，即可直接翻译当前输入框内容。译文直接替换/展示在输入框，方便编辑后发送。

### 3.2 UX 方案（三选一，需要确认）

#### 方案 A：输入框旁独立按钮 🌐（**推荐**）

```
[😀] [🖼] [📌新话题] [ 🌐 ] [═══ textarea ═══] [🤖] [➤]
```

- 点一下 = 自动方向翻译（`auto` 模式），把 `inputText` 原地替换为译文
- 再点一下 = 撤回到上一次原文（保留一层 undo stack）
- 长按/右键菜单 = 强制中→英 / 英→中
- 加载态：按钮内转圈 + 输入框禁用

**优点**：视觉直观、一键可达、和气泡翻译按钮视觉统一（都用 🌐）

#### 方案 B：输入框内行内提示条

```
[═══ textarea ═══]
🌐 译文：Hello, I'm interested...  [采用][关闭]
```

- 打字停顿 800ms 后自动尝试翻译（防抖）
- 底部横条显示译文，点"采用"替换 inputText

**优点**：看到原文+译文对照；**缺点**：有自动调用开销、打断感强

#### 方案 C：快捷键 + 按钮

- `Cmd/Ctrl+T` 触发翻译（主力）
- 附带一个小按钮做可发现性
- 译文替换后保留一次 undo（Cmd+Z 回滚）

**优点**：高频用户爽；**缺点**：新人发现性差

### 3.3 状态管理

新增 state（平铺在 `WAMessageComposer`）：
```js
const [translatingInput, setTranslatingInput] = useState(false);
const [lastInputBeforeTranslate, setLastInputBeforeTranslate] = useState(null); // undo stack
```

新函数：
```js
const handleTranslateInput = async (forceDirection = 'auto') => {
  const src = inputText.trim();
  if (!src) return;
  setTranslatingInput(true);
  setLastInputBeforeTranslate(inputText);  // undo
  try {
    const res = await fetchAppAuth(`${API_BASE}/translate`, { ... body: { text: src, mode: forceDirection } });
    const data = await res.json();
    if (res.ok && data.translation) setInputText(data.translation);
  } finally {
    setTranslatingInput(false);
  }
};
```

### 3.4 AIReplyPicker 内的翻译按钮处理

- **保留**（因为 picker 文本编辑后还需要翻译能力，别让用户"复制回输入框再翻译"）
- `runCustomTool('translate')` 复用不变，只是不再是唯一入口

---

## 4. 技术方案（后端）

### 4.1 新增 provider 抽象

`server/services/translationService.js`（新文件）：

```js
// provider = 'deepl' | 'minimax'
async function translate(text, { mode, provider }) { ... }
async function translateBatch(texts, { mode, provider }) { ... }
```

- 保留原 `aiService.translateText` / `translateBatch` 作为 `minimax` 分支实现
- 新增 `deeplProvider.js`：用 `deepl-node` SDK（`npm i deepl-node`）
- `/api/translate` 根据 `process.env.TRANSLATION_PROVIDER`（默认 `deepl`）路由

### 4.2 Env 新增

```env
TRANSLATION_PROVIDER=deepl           # deepl | minimax
DEEPL_API_KEY=xxx
DEEPL_API_BASE=https://api.deepl.com # 或 api-free.deepl.com
DEEPL_GLOSSARY_ZH_EN=glossary_id_1   # 可选
DEEPL_GLOSSARY_EN_ZH=glossary_id_2   # 可选
TRANSLATION_MAX_CHARS_PER_DAY=500000 # 用量闸门
```

### 4.3 用量日志

复用现有 `ai_usage_logs`（参考 commit `aa240e3` 的 recordUsage 机制），新增 `purpose='translation'`，记录 `chars_in`、`provider`、`mode`。

---

## 5. 验收标准

### 功能
- [ ] 输入框内有独立翻译入口，不依赖"生成候选"
- [ ] 翻译后支持 undo（Cmd/Ctrl+Z 或再点一次按钮）
- [ ] `TRANSLATION_PROVIDER=deepl` 时走 DeepL；= `minimax` 时走原链路（向后兼容）
- [ ] DeepL 失败自动 fallback 到 MiniMax（带日志）
- [ ] AIReplyPicker 内的 翻译 按钮依然可用
- [ ] 气泡批量翻译（20 条）切到新 provider 后效果一致或更好

### 非功能
- [ ] 单条翻译 p95 延迟 < 1.5s（DeepL）
- [ ] 批量 20 条 p95 < 3s
- [ ] `ai_usage_logs` 可看到 translation 用量（daily）
- [ ] 超出每日限额返回 429 + 明确错误

### 回归
- [ ] 现有气泡翻译（🌐 顶部按钮）不坏
- [ ] `runCustomTool('translate')` 路径不坏

---

## 6. 实施分阶段（建议拆 3 个 commit）

| Commit | 范围 | 可独立验证 |
|--------|------|-----------|
| **C1** feat(translate): 抽象 provider 层 + DeepL 接入 | 后端 `translationService.js`、env、`/api/translate` 路由层 | 用 curl 跑 DeepL ok |
| **C2** feat(composer): 输入框独立翻译按钮 + undo | 仅 `WAMessageComposer.jsx` UI + 新 handler | 前端手测 |
| **C3** feat(translate): 用量日志 + 每日限额 | 复用 `ai_usage_logs` + 429 分支 | 打 usage 可见 |

---

## 7. 决策锁定（已与用户确认）

| # | 决策 | 选择 |
|---|------|------|
| 1 | 输入框 UX | **方案 A**：独立 🌐 按钮 + undo（再点回原文）|
| 2 | 顶部气泡批量翻译是否切 DeepL | **❌ 不切**，保留 MiniMax（最小改动范围，降低回归风险）|
| 3 | DeepL Plan | **直接 Pro**（$5.49/月 + $25/M 字符，无字符上限）|
| 4 | Glossary | **配置**：预置 DRIFTO / GMV / Beau / Yiyun / Beta 计划 等术语中英对照 |

### 由此修订的实施范围

- **后端**：新 provider 层只被 "输入框翻译" 和 "`runCustomTool('translate')`" 这两条路径使用；气泡批量翻译 (`translateBatch`) **保持原 MiniMax 路径不动**
- **路由**：`/api/translate` 增加可选 `provider` 参数（前端传 `deepl`），默认仍走 MiniMax；气泡不传则保持现状
- **Glossary**：项目启动时（或首次调用时）检查 / 创建 glossary，id 写回 env 或 `ai_providers` 配置表

### 修订后的 Commit 拆分

| Commit | 范围 |
|--------|------|
| **C1** feat(translate): 新增 DeepL provider + `/api/translate?provider=deepl` 分支 + glossary 管理 | 后端 |
| **C2** feat(composer): 主输入框加 🌐 翻译按钮 + undo + 走 DeepL provider | 前端 `WAMessageComposer.jsx` |
| **C3** feat(translate): AIReplyPicker 内 翻译 按钮切到 DeepL（`runCustomTool` 传 `provider=deepl`）| 前端 `WAMessageComposer.jsx:1235-1272` |
| **C4** chore(translate): translation 用量日志 + 每日限额 | 后端 + 复用 `ai_usage_logs` |

---

## 附录：参考资料

- [deepl-node 官方 SDK](https://github.com/DeepLcom/deepl-node)
- [DeepL API 定价](https://support.deepl.com/hc/en-us/articles/360020685720)
- [Translation API 2026 对比](https://intlpull.com/blog/best-translation-api-2026)
- [DeepL vs LLM 翻译对比](https://www.vincentschmalbach.com/deepl-vs-llms-for-translation/)
