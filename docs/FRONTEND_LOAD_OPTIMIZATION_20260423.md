# 前端加载优化与行为修复 — 2026-04-23

分支：`front-optimize`（基于 `feat/viewer-role`）

## 背景

用户反馈前端加载慢，以及两个具体问题：

1. 右栏（CreatorDetail 画像面板）hover 即展开，容易误触；希望改为点击才展开。
2. 「生成回复」在反复轮询生成 —— 候选被 dismiss 后，5 秒轮询又会对同一条 incoming 消息重新生成候选，形成死循环。

## 改动一览

| 模块 | 问题 | 修复 |
|------|------|------|
| App.jsx 右栏 | hover 即展开 | 点击折叠条展开、点 pin 按钮折叠 |
| WAMessageComposer + useMessagePolling | polling 对同一条消息反复生成候选 | 新增 `lastGeneratedKeyRef`，按消息 key 去重 |

## 详情

### 1. 右栏改为点击触发

**文件**：[src/App.jsx](../src/App.jsx)

**变更**：

- 删除 `detailPanelExpanded` state 及其全部 setter 调用（5 处）
- 删除右栏容器的 `onMouseEnter` / `onMouseLeave`
- `isDetailPanelOpen = showDetailPanel && detailPanelPinned`（只由 pin 决定）
- `onTogglePin` 简化为 `setDetailPanelPinned(prev => !prev)`

**行为**：

| 操作 | 旧行为 | 新行为 |
|------|--------|--------|
| 鼠标悬停右栏 | 自动展开 | 无反应 |
| 点击折叠条 `‹` 按钮 | 临时展开 + pin | pin=true，展开并保持 |
| 点击「已固定」按钮 | unpin，但 hover 还能保持展开 | pin=false，立即折叠 |

### 2. 防止 polling 对同一条 incoming 反复生成

**文件**：
- [src/components/WAMessageComposer.jsx](../src/components/WAMessageComposer.jsx)
- [src/components/WAMessageComposer/hooks/useMessagePolling.js](../src/components/WAMessageComposer/hooks/useMessagePolling.js)

**根因**：

轮询每 5s 拉消息。若 `messages[last]` 是客户发来的消息（`role=user`）且当前 `activePicker === null && pendingCandidates === []`（用户 dismiss 了候选），原判断 `alreadyQueued` 返回 false → 调 `generateForIncoming` 重生成 → 用户再 dismiss → 循环。

**修复模式**：

引入 `lastGeneratedKeyRef`，记录"最近一次已为哪条 incoming 消息调用过生成"，不受候选是否被 dismiss 影响。

- **Composer 持有 ref**（L722），切换达人时重置为 `null`（L751）
- **切换时自动生成成功** → 写入 key（L797）
- **手动 🤖 点击成功** → 写入 key（L1132）
- **Polling 生成成功** → 写入 key（hook L88）
- **Polling 预检**：`if (lastGeneratedKeyRef?.current === latestKey) return`（hook L83）

另外从 hook 导出 `getMessageKey` 供 composer 复用，避免 key 生成规则不一致。

**行为**：

| 场景 | 旧 | 新 |
|------|-----|-----|
| 切换达人、对方最后一条是 incoming | 自动生成候选（1 次） | 自动生成候选（1 次）+ 打标 |
| 用户 dismiss 候选，5s 后 | **重新生成** ❌ | 不生成 ✅ |
| 对方发新 incoming | 自动生成 | 自动生成（新 key）+ 打标 |
| 用户点 🤖 强制重生成 | OK | OK，不受 ref 阻挡（`handleBotIconClick` 不检查 ref） |

## 受影响文件

```
src/App.jsx                                                    |  18 +++---
src/components/WAMessageComposer.jsx                           |  10 +++-
src/components/WAMessageComposer/hooks/useMessagePolling.js    |  13 +++-
```

## 验证

构建通过：`npx vite build` → `1,715.61 kB` bundle，无错误。

浏览器验证步骤：

1. **右栏点击行为**
   - 选中一个达人 → 右栏折叠
   - 悬停右栏 → 不展开（以前会展开）
   - 点击最右侧 `‹` 按钮 → 展开并保持
   - 点「已固定」→ 折叠

2. **候选不复生**
   - 切到一个最后消息是客户来的达人 → 出现 1 张候选
   - 关闭/dismiss 候选
   - 等待 30+ 秒 → **不应再弹出候选**
   - 让对方再发一条消息 → 应自动弹出新候选

3. **手动 🤖 不受影响**
   - 任意时刻点 🤖 按钮 → 总能生成/重生成

## 相关历史

本次改动前先做了一轮 P0/P1 优化尝试（切换时先渲染消息、副数据后台并行、CreatorDetail 折叠不发请求），提交后**全部被撤回**。当前 `front-optimize` 分支保留的只有本文档描述的两项：

- 右栏 hover→click（App.jsx）
- polling 去重（WAMessageComposer + useMessagePolling）

**已撤回未重做：**

- P0：切换达人时先渲染消息 / 副数据后台并行 / 移除切换时自动 AI 生成 — 用户撤回，未确认是否重做
- P1：CreatorDetail 折叠时不发 5 个副请求、不开 8s 轮询 — 已撤回

**未实施：**

- P2：非默认 Tab 的 `React.lazy` 代码分割
- P3：WAMessageComposer（2800 行）拆分 + `React.memo`
