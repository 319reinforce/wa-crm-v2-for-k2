# V1/V2 Layout Follow-up Handoff — 2026-04-25

## 背景

本次调整承接 `docs/V1_LAYOUT_HANDOFF_20260425.md` 后的二次视觉验收，目标是把 v2 聊天工作台顶部嵌入面板继续收紧，避免上下文信息挤压聊天与回复操作区。

## 本次落地改动

### v2 聊天工作台顶部

- `src/components/CreatorDetail.jsx`
  - 将生命周期轨迹从 tab 下方的大块区域迁移到 `Creator Context` 顶部中间空位。
  - compact 生命周期图高度缩小为轻量预览，只保留阶段、命中数和折线。
  - 点击 compact 生命周期图仍弹出放大弹窗，弹窗内保留完整轨迹图和阶段标签。
  - 顶部切换保留 `聊天 / 概览 / 事件 / 编辑达人 / 回复策略`，切换后内容继续占用原聊天区域，不再撑爆聊天上方空间。

### v2 回复与输入区

- `src/components/AIReplyPicker.jsx`
  - 删除 Reply Deck 底部灰色说明条。
- `src/components/WAMessageComposer.jsx`
  - 输入区工具按钮从底部对齐改为居中对齐，减少按钮与输入框之间的视觉错位。

### v2 编辑与策略面板

- `src/components/CreatorDetail.jsx`
  - 编辑达人表单从 9px 小字号提升到 12px 左右，输入框 padding 同步放大。
  - 回复策略面板的标题、按钮、原因列表、策略标签、打分行字号统一提升。
  - `InlineEditField` 默认字号同步提升；compact 模式仅保留给财务/Keeper 等窄面板。

## 验收 URL

本地服务启动后访问：

- v2 主入口：`http://localhost:3000/`

登录后选择达人，重点检查：

1. 生命周期轨迹位于顶部 `Creator Context` 与统计卡之间，不再独占一整行大区域。
2. 点击生命周期轨迹可弹出放大图。
3. Reply Deck 底部不再显示“需要人工改写 / 翻译 / 加 Emoji...”说明条。
4. 底部输入区工具按钮与输入框垂直居中对齐。
5. `编辑达人` 与 `回复策略` 面板字号和控件尺寸与其它面板一致。

## 已执行验证

- `npm run build` 通过。
- `git diff --check` 通过。
- grep 验证旧说明条文本已移除：
  - `需要人工改写`
  - `消息框旁的`

## 当前限制

- 真实登录态页面仍建议由人工再做一次截图验收，重点看不同窗口宽度下生命周期 compact 图是否仍在顶部空位内。
- 本次未修改数据库 schema。
- 本次未修改认证/权限策略。

## Rollout 备注

- 该调整仅影响前端布局和静态 bundle。
- 可通过回退 `src/components/CreatorDetail.jsx`、`src/components/AIReplyPicker.jsx`、`src/components/WAMessageComposer.jsx` 恢复旧布局。

## Obsidian Sync

- Status: synced
- Note: `docs/obsidian/notes/2026-04-25-v1-layout-handoff.md`
- Index: `docs/obsidian/index.md`
