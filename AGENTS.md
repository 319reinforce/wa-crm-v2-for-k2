# WA CRM v2 — AI Agent 接入指南

> 本文件供其他 AI Agent 阅读，作为项目入口

---

## 快速接入指令

当你需要在这个项目中工作时，按以下顺序阅读：

```
1. 先读 AGENTS.md（你在这里）→ 了解项目全貌
2. 再读 BOT_INTEGRATION.md → 了解 API 和集成方式
3. 最后读 SFT_PROJECT.md → 深入理解 SFT 训练和 Experience Router
```

---

## 项目基本信息

| 项目 | 值 |
|------|-----|
| 名称 | WA CRM v2 |
| 类型 | WhatsApp 达人 CRM + SFT 语料收集平台 |
| 路径 | `/Users/depp/wa-bot/wa-crm-v2/` |
| 后端端口 | `3000` |
| 前端端口 | `3000`（开发）|
| wa-ai-crm（旧版）| 端口 `2000` |
| 数据库 | MySQL（运行时） / `schema.sql` 为主 schema |

---

## 核心模块速查

### 后端

| 文件 | 作用 |
|------|------|
| `server/index.cjs` | Express 服务器主入口，REST API 端口 3000 |
| `db.js` | MySQL 兼容数据库封装（对外保持 SQLite 风格接口） |
| `schema.sql` | 数据库 schema 定义 |
| `server/routes/profile.js` | 客户画像路由：标签提取 + summary 生成 + 记忆写入 |
| `server/routes/experience.js` | Experience Router 核心逻辑 |

### 前端

| 文件 | 作用 |
|------|------|
| `src/App.jsx` | 主应用 — 三面板布局（flex 实现）+ 移动端响应式（抽屉导航 + 全屏聊天） |
| `src/components/WAMessageComposer.jsx` | 消息编辑器，含 Scene 检测 + AI 生成 + 移动端 UI |
| `src/components/SFTDashboard.jsx` | SFT 语料看板 |
| `src/components/EventPanel.jsx` | 事件管理面板（含列表、详情、创建、判定）|
| `src/utils/legacy/minimax.js` | MiniMax API Client（legacy，调用 `/api/minimax` 代理） |
| `src/utils/systemPrompt.js` | 共享 system prompt 模板（前后端共用同一份） |

---

## 数据库核心表

| 表名 | 用途 |
|------|------|
| `creators` | 达人主表（wa_phone 唯一标识） |
| `wa_messages` | WA 对话消息 |
| `sft_memory` | SFT 训练语料 |
| `sft_feedback` | Skip/Reject/Edit 反馈记录 |
| `client_memory` | 客户单独记忆 |
| `client_profiles` | 客户独立画像 |
| `client_tags` | 动态标签（多源标注） |
| `policy_documents` | 政策文档 |
| `operator_experiences` | **Experience Router**：operator 专属 AI 体验配置 |
| `audit_log` | 操作审计日志 |

---

## Experience Router（已实现）

> **现状**：`routes/experience.js` 已实现，`POST /api/experience/route` 根据 client_id/operator 自动路由到 Beau 或 Yiyun 的专属 AI 体验。

**路由逻辑：**
```
client_id / operator → 查 operator_experiences → 编译 system_prompt → 生成候选回复
```

**Beau 专属规则示例：**
- 20天Beta计划，$200激励，$10/天
- GMV里程碑庆祝：$5k / $10k GMV
- DRIFTO MCN 签约期仅2个月

**Yiyun 专属规则示例：**
- 7天试用任务包，20 AI generations/day
- $20月费：从视频补贴扣除
- 一问一答，不过度展开，不主动延伸

---

## 必读文档

| 文档 | 用途 |
|------|------|
| `BOT_INTEGRATION.md` | API 端点速查、数据库表、快速开始 |
| `SFT_PROJECT.md` | SFT 语料系统、Experience Router、Scene 检测、Profile Agent 完整说明 |
| `CODE_REVIEW.md` | 已知代码问题清单（P0/P1/P2） |
| `docs/EVENT_SYSTEM_REQUIREMENTS.md` | 事件系统需求梳理（代码未实现） |
| `docs/rag/KNOWLEDGE_SOURCE_STANDARD.md` | RAG 知识源标准（供 Agent 编写/审核/同步政策与 SOP） |
| `docs/rag/OPENAI_RAG_RUNBOOK.md` | OpenAI 托管 RAG 操作手册（环境、清单、同步、检索验证） |

---

## 禁止事项

1. **禁止**恢复或重新引入 `crm.db` / SQLite 历史链路
2. **禁止**在未调用 `GET /api/policy-documents` 的情况下输出涉及政策内容的回复
3. **禁止**将 `wa_phone` 泄露到日志或外部系统
4. **必须**使用参数化查询，禁止拼接 SQL
5. **禁止**在未确认 operator 身份前使用 Beau 或 Yiyun 的话术体系

## 当前已知数据问题

- **`joinbrands_link` 表为空**：所有 115 位达人的 `ev_*` 事件标签均为 null，数据未录入。
- **事件筛选**：筛选逻辑已修好（`c._full.joinbrands.ev_*`），但数据为空导致筛选无结果。

---

## 启动命令

```bash
cd /Users/depp/wa-bot/wa-crm-v2
npm start             # 启动服务（实际入口: server/index.cjs，端口 3000）
```

---

## 遇到问题？

1. 调用 `GET /api/health` 确认服务状态
2. 调用 `GET /api/audit-log?limit=5` 查看最近操作
3. 查 `CODE_REVIEW.md` 已知问题清单
4. 读 `SFT_PROJECT.md` 深入理解系统逻辑

---

## 文档同步规则

后续凡是以下类型的文档，只要在仓库内新增或更新，就**必须**同步一份摘要到 MetaBot / MetaMemory：

- 规范类（spec / standard / checklist）
- 设计类（design / architecture / technical plan）
- Runbook / 操作手册
- 配置决策 / 路由决策 / 灰度决策

执行要求：

1. 先完成仓库内 Markdown 文档
2. 再同步 MetaMemory 摘要，至少包含：
   - 标题
   - 日期标签
   - 仓库文件路径
   - 关键决策
   - 验证结果 / rollout 备注
3. 如果文档定义了新的 agent 级工作规则，还要额外同步一份到共享规则目录
4. Session 收尾时要明确说明“仓库文档已同步 / 未同步 MetaMemory”

MetaMemory 写入失败时，排查顺序必须是：

1. 先确认当前 agent 执行环境是否能连到 `localhost:8100`
2. 再确认 `mm` CLI 读取到的 `.env` 与正在运行的 memory server 是否是同一份配置
3. 最后才检查 token / 权限问题

禁止默认把 MetaMemory 写入失败直接归因为“缺少可写 token”。

---

## Session 收尾规则

每次 session 结束前（无论是否完成），必须：
1. 列出本次完成的三件事
2. 列出剩余未完成事项
3. 告诉用户："要继续吗？"

如果用户说"结束"或"够了"才停止。

---

## 多文件修改前规则

修复任何 bug 或迁移任何语法时：
1. 先 grep 全代码库找所有相似模式
2. 列出所有需要改动的文件
3. 一次性全部改完
4. grep 验证没有遗漏

不要只改一个文件就宣布完成。
