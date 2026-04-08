# Frontend Layout Refactor — 三面板可拖拽布局

> 状态：已完成
> 日期：2026-04-07
> 负责人：Claude Code

---

## 改动背景

原布局为两栏结构：左侧联系人列表（固定宽度 320px）+ 右侧主面板（剩余空间）。点击达人后，`CreatorDetail` 以 `fixed` 全屏遮罩 modal 形式展开，信息和聊天都在同一个 overlay 内。

**问题：**
- 信息面板和聊天区域在同一个 overlay 内，无法独立调整宽度
- 达人详情和对话在同一个视图，切换不方便
- 联系人列表宽度固定，视觉利用率低

---

## 改动方案

引入 `react-resizable-panels`，将桌面端布局重构为**三个可拖拽调整宽度的面板**：

```
┌────────────┬──────────────┬──────────────────────────┐
│  联系人列表  │   达人信息    │        聊天区域           │
│  Panel 1   │   Panel 2    │       Panel 3            │
│  20%       │   30%        │        50%                │
│  min 15%   │   min 20%    │        min 30%            │
└────────────┴──────────────┴──────────────────────────┘
      ↕              ↕               ↕
  拖拽分隔线     拖拽分隔线      拖拽分隔线
```

### 面板说明

| 面板 | 默认占比 | 最小占比 | 内容 |
|------|---------|---------|------|
| Panel 1 | 20% | 15% | 联系人列表（搜索、筛选、视图切换） |
| Panel 2 | 30% | 20% | 达人详情信息（基础信息、事件标签、操作） |
| Panel 3 | 50% | 30% | 聊天对话（WAMessageComposer） |

### 拖拽分隔线

`PanelResizeHandle` 样式：宽 4px，透明背景，hover 时变为浅灰色，鼠标变为 `col-resize` 指针。

---

## 改动文件

### `src/App.jsx`

**1. 新增 import**
```javascript
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels'
```

**2. 主布局 return 分支（桌面端）**

原结构：
```jsx
<div className="flex h-screen overflow-hidden">
  <div className="w-80 ..."> {/* 联系人列表 */} </div>
  <div className="flex-1 ...">
    {selectedCreator ? <CreatorDetail ... /> : <EmptyState />}
  </div>
</div>
```

新结构：
```jsx
<PanelGroup direction="horizontal" className="hidden md:flex h-screen">
  {/* Panel 1: 联系人列表 — 保持原内容不变 */}
  <Panel defaultSize={20} minSize={15}>...</Panel>

  <PanelResizeHandle />

  {/* Panel 2: 达人信息 */}
  <Panel defaultSize={30} minSize={20}>
    {selectedCreator ? <CreatorDetail asPanel /> : <EmptyState />}
  </Panel>

  <PanelResizeHandle />

  {/* Panel 3: 聊天 */}
  <Panel defaultSize={50} minSize={30}>
    {selectedCreator ? <WAMessageComposer ... /> : <EmptyState />}
  </Panel>
</PanelGroup>
```

**3. `CreatorDetail` 组件新增 `asPanel` prop**

- `asPanel=true`：渲染为普通面板（无 fixed overlay，无内部 WAMessageComposer）
- `asPanel=false`/undefined：保持原有 fixed modal 行为（桌面端全屏遮罩，移动端仅有聊天区）

```jsx
function CreatorDetail({ creatorId, creatorName, onClose, asPanel }) {
  // ...
  if (asPanel) {
    // 渲染为普通 panel，无 overlay，无 chat composer
    return (
      <div className="flex flex-col h-full" style={{ background: WA.white }}>
        <div className="flex items-center gap-3 px-5 py-4" style={{ background: WA.darkHeader }}>
          <button onClick={onClose}>←</button>
          {/* ...头像、姓名、电话 */}
        </div>
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* ...所有 InfoSection */}
        </div>
      </div>
    )
  }
  // 原有 fixed overlay 逻辑保持不变
}
```

**4. 移动端布局**

移动端（`md:hidden`）保持原有 overlay 行为不变：点击达人后，联系人列表以 drawer 形式覆盖，聊天区域单独显示。

---

## 依赖变更

**新增依赖：**
```bash
npm install react-resizable-panels
```

---

## 构建验证

```bash
npm run build  # ✓ 成功，无错误
```

---

## 运行验证

```bash
node server.js  # 端口 3000
```

访问 `http://localhost:3000`，桌面端应看到三个并排面板，拖拽分隔线可调整各区域宽度。

---

## 移动端响应式适配

> 日期：2026-04-07
> 状态：已完成

### 目标

在不改变桌面端体验的前提下，为移动端（< 768px）提供可用的触屏操作界面。

### 核心原则

- 桌面端（≥ 768px）：完全保持原有三面板可拖拽布局不变
- 移动端（< 768px）：侧边栏收起为抽屉（drawer），聊天全屏，AI picker 纵向堆叠

### 布局结构对比

**桌面端（≥ 768px）**

```
┌────────────┬──────────────┬──────────────────────────┐
│  联系人列表  │   达人信息    │        聊天区域           │
│  Panel 1   │   Panel 2    │       Panel 3            │
└────────────┴──────────────┴──────────────────────────┘
```

**移动端（< 768px）**

```
默认状态：
┌──────────────────────────┐
│  ☰ CRM        SFT │ ← 顶部栏
├──────────────────────────┤
│                          │
│    联系人列表（全宽）      │
│                          │
└──────────────────────────┘

点开达人后：
┌──────────────────────────┐
│ ☰ 头像 名称    电话  ✕ │ ← 顶部栏（来自 App.jsx）
├──────────────────────────┤
│ 7天试用 │ 月卡 │ GMV>1K │ ← 悬浮事件 bar（横向滚动）
├──────────────────────────┤
│                          │
│    聊天记录（占据全屏）    │
│                          │
├──────────────────────────┤
│  [AI 回复 picker]        │ ← 输入框上方
├──────────────────────────┤
│ 😊  [输入框]         🤖  │ ← 底部输入区
└──────────────────────────┘
```

### 改动点

#### 1. viewport meta
`public/index.html`：
```html
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
```

#### 2. App.jsx 根布局 — 移动端抽屉侧边栏
- 新增 `mobileSidebarOpen` state（boolean）
- 移动端：点击联系人后，侧边栏以 `fixed inset-0 z-50` 蒙层 + `absolute left-0` 抽屉形式覆盖全屏
- 抽屉内包含：顶部栏（标题+关闭）+ 搜索框 + 负责人 tab + 联系人列表
- 点击蒙层或选中达人后自动关闭抽屉
- 桌面端：`hidden md:flex` 隐藏抽屉，保持原有三面板布局

```jsx
{mobileSidebarOpen && (
  <div className="fixed inset-0 z-50 md:hidden">
    <div className="absolute inset-0 bg-black/40" onClick={() => setMobileSidebarOpen(false)} />
    <div className="absolute left-0 top-0 bottom-0 w-[280px] flex flex-col shadow-2xl">
      {/* 抽屉内容：头部+搜索+tab+联系人列表 */}
    </div>
  </div>
)}
```

#### 3. App.jsx 主面板 — 移动端顶部栏
- 桌面端不显示（`hidden md:flex`）
- 移动端（`flex md:hidden`）：选中的达人顶部栏
  - 左侧：☰ 汉堡按钮（打开抽屉）
  - 中间：头像 + 名称 + 电话
  - 右侧：✕ 关闭按钮

```jsx
{selectedCreator && (
  <div className="flex md:hidden items-center gap-3 px-4 py-3" style={{ background: WA.darkHeader }}>
    <button onClick={() => setMobileSidebarOpen(true)}>☰</button>
    <div className="w-9 h-9 rounded-full ...">{(name)[0]}</div>
    <div className="flex-1 ..."><div className="text-sm truncate">{name}</div><div className="text-xs opacity-50">{phone}</div></div>
    <button onClick={() => setSelectedCreator(null)}>✕</button>
  </div>
)}
```

#### 4. CreatorDetail — 桌面侧信息栏 / 移动端隐藏
- 桌面端（`hidden md:flex`）：原有 fixed overlay + 信息侧边栏 + 聊天composer
- 移动端（`flex-1 md:hidden`）：只渲染聊天 composer，信息侧边栏隐藏

#### 5. WAMessageComposer — 悬浮事件 bar
- 桌面端不显示（`hidden md:flex`）
- 移动端（`flex md:hidden`）：事件 bar 横向滚动显示
  - 数据来源：`creator.joinbrands`（joinbrands_link 表）
  - 事件标签：7天试用 / 月卡邀请 / 月卡加入 / WA已发 / GMV>1K / GMV>3K / GMV>10K / 已流失

```jsx
<div className="flex md:hidden overflow-x-auto px-4 py-2 gap-2" style={{ background: WA.white }}>
  {creator.joinbrands.ev_trial_7day && <EventPill label="7天试用" color="#3b82f6" />}
  {creator.joinbrands.ev_monthly_joined && <EventPill label="月卡加入" color="#10b981" />}
  {/* ... */}
</div>
```

#### 6. AI Reply Picker — 编辑/发送双按钮
- 每个候选方案（A/B）从"只发送"改为"编辑 + 发送"两个按钮
- 移动端：卡片纵向堆叠（文字在上，按钮横排在下），触摸友好

```jsx
<div className="flex flex-col sm:flex-row gap-2">
  <div className="flex-1 ..."> {/* A/B 方案内容 */} </div>
  <div className="flex sm:flex-col gap-2 shrink-0">
    <button onClick={() => onEditCandidate(text)} className="...">编辑</button>
    <button onClick={() => onSelect('opt1')} className="...">发送</button>
  </div>
</div>
```

#### 7. handleEditCandidate — 填充到输入框
点击"编辑"时，将 AI 候选内容填充到输入框，关闭 picker：

```jsx
const handleEditCandidate = (text) => {
  if (!text) return;
  setInputText(text);
  setActivePicker(null);
  setPendingCandidates([]);
  setPickerCustom('');
};
```

### 屏幕尺寸断点

| 断点 | 行为 |
|------|------|
| < 768px | 移动端：抽屉导航 + 全屏聊天 |
| ≥ 768px | 桌面端：三面板可拖拽布局 |

### 依赖变更

无新增依赖（纯 CSS + JS 实现）。

### 构建验证

```bash
npm run build  # ✓ 成功，无错误
```

---

## 待优化项（建议后续处理）

1. **Panel 尺寸记忆**：用户调整后的宽度比例可存储到 `localStorage`，下次访问自动恢复
2. **Panel 2 空状态**：当前当未选达人时 Panel 2 显示空占位符，可考虑显示最近对话或全局统计
3. **分隔线样式**：当前 hover 样式较简单，可考虑加入视觉引导（如小圆点）
4. **CreatorDetail 编辑功能**：编辑按钮目前依赖 `showEdit` 弹窗，在 Panel 模式下可考虑改为内联编辑
5. **键盘联动**：移动端输入框固定在底部，键盘弹出时需通过 `window.visualViewport` 动态调整位置避免被遮挡
