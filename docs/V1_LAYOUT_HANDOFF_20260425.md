# V1/V2 Layout Handoff — 2026-04-25

## 背景

本次调整来自 2026-04-25 的前端布局验收需求：

- 删除 v2 顶栏里无用的 `切换 Token` 入口。
- 删除 v2 顶栏里重复展示的 `Owner Beau` 状态胶囊。
- 取消 v2 聊天工作台右侧详情栏，避免右侧栏堆叠和加载失败影响主聊天区。
- 将原右栏功能迁移回聊天看板内部。
- 将财务功能拆成与 WhatsApp/消息平级的单独 tab。
- 将 v1 中台入口放到原顶栏账号/token 信息位置。

## 已落地改动

### v2 顶栏

- `src/components/AuthSessionControls.jsx`
  - 移除 `切换 Token` 按钮和 prompt 输入逻辑。
  - 移除 token mask 展示。
  - 在原账号/token 胶囊位置新增 `V1 中台`链接。
- `src/App.jsx`
  - 移除顶栏 `Owner <当前负责人>` 胶囊。
  - 新增顶层 `财务` tab，位于 `消息` 后，与其他主工作区平级。

### v2 聊天工作台

- `src/App.jsx`
  - 移除桌面端第三列右侧 `CreatorDetail` 面板。
  - 选择达人后，聊天区顶部嵌入 `CreatorDetail embedded`，下方保留 `WAMessageComposer`。
- `src/components/CreatorDetail.jsx`
  - 新增 `embedded` 模式：只展示概览、事件、运营三个 tab，不再展示财务入口。
  - 新增 `financeOnly` 模式：作为顶层财务 tab 的内容容器，展示月费、GMV、30天 GMV、订单和 Keeper 指标。

### v1 看板

- `public/v1/index.html`
  - 新增顶层 `财务` tab。
  - 财务页包含：应收月费、已支付、逾期/待扣、Keeper GMV 汇总，以及达人级财务明细表。
  - 移除生命周期页左侧栏，将搜索、主阶段、负责人筛选和阶段索引移入主内容区。
- `server/routes/v1Board.js`
  - `/v1/api/users` 数据补齐财务/Keeper 字段，供 v1 财务 tab 使用。

### 静态构建

- `public/index.html`
  - 由 `npm run build` 自动更新，指向最新 Vite bundle。

## 验收 URL

本地服务启动后访问：

- v2 主入口：`http://localhost:3000/`
- v1 生命周期页：`http://localhost:3000/v1/?tab=lifecycle&source=v2`
- v1 财务页：`http://localhost:3000/v1/?tab=finance&source=v2`

## 验收清单

1. v2 顶栏不再显示 `切换 Token`。
2. v2 顶栏不再显示 `Owner Beau` / `Owner <负责人>` 胶囊。
3. v2 顶栏原账号/token 信息位置显示 `V1 中台`，点击打开 v1。
4. v2 顶层 tab 中显示 `财务`，并与 `消息` 平级。
5. v2 选择达人后不再出现独立右侧详情栏。
6. v2 聊天区顶部显示达人上下文，包含概览/事件/运营。
7. v2 财务 tab 选择达人后显示月费和 Keeper 指标。
8. v1 生命周期页不再有左侧栏，筛选和阶段索引在主内容区。
9. v1 顶栏显示 `财务` tab。
10. v1 财务页可按搜索、月费状态、负责人筛选。

## 已执行验证

- `npm run build` 通过。
- `node --check server/routes/v1Board.js` 通过。
- `git diff --check` 通过。
- 浏览器打开 `http://localhost:3000/v1/?tab=lifecycle&source=v2`：
  - 顶栏显示 `生命周期 / WhatsApp CRM / 财务`。
  - `Lifecycle Workspace` 旧侧栏文案已不再出现。
  - 主内容区可见生命周期搜索、主阶段、负责人筛选。
- 浏览器点击 v1 `财务` tab：
  - 财务页可打开。
  - 财务汇总卡和财务明细表结构已渲染。

## 当前限制

- 未登录时，v2 主入口停在登录页；v1 API 会返回 401，因此真实数据加载需要登录态后复验。
- 本次未修改数据库 schema。
- 本次未修改认证/权限策略，只移除了前端 `切换 Token` 手动入口。

## 后续建议

1. 登录后复验 v2 主界面，重点看聊天区顶部嵌入面板高度是否合适。
2. 对 v2 财务 tab 做一次真实达人数据验收，确认 Keeper 字段和月费字段口径满足运营使用。
3. 如 v1 财务 tab 后续要承担主财务看板职责，可补充导出、批量筛选和 owner 汇总。

## Obsidian Sync

- Status: synced
- Note: `docs/obsidian/notes/2026-04-25-v1-layout-handoff.md`
- Index: `docs/obsidian/index.md`
