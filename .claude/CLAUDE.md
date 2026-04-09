# WA CRM v2 — Claude Agent 模式入口

> 本文件是 Claude Code Agent 的编排入口，定义了多 Agent 团队协作架构。

## 项目基本信息

| 项目 | 值 |
|------|-----|
| 名称 | WA CRM v2 |
| 路径 | `/Users/depp/wa-bot/wa-crm-v2/` |
| 技术栈 | Node.js (CJS), Express, better-sqlite3, React |
| 后端端口 | `3000` |
| 数据库 | SQLite → `crm.db` |
| GitHub | 319reinforce/wa-crm-v2-for-k2 |

## Agent 团队

**你（读取本文件的 Claude session）是 orchestrator / tech lead。** 你分析任务、拆解、委托给 specialist agents，并确保质量。你不需要单独的 tech-lead agent——本文件就是你的编排指南。

### 路由表

| 任务类型 | Agent | 适用场景 |
|---------|-------|---------|
| Express 路由、API endpoints、中间件 | backend-agent | 新增/修改 REST endpoints、认证、验证 |
| server.js、db.js、schema 迁移 | backend-agent | 核心后端改动、schema 迁移 |
| React 组件、SFT Dashboard、Event Panel | frontend-agent | UI 改动、React 组件、看板 |
| SQLite 查询、sft_memory、sft_feedback | data-agent | 数据操作、导出、查询 |
| Schema 改动、表迁移 | data-agent | 数据库 schema、迁移 |
| Code review、CLAUDE.md 合规检查 | review-agent | 所有代码改动完成前 |
| 复杂多步骤任务 | (你) | 拆解后最多委托 2 个 agent 并行 |

### 编排协议

1. **你是路由权威**。复杂任务到达时，分析并委托给合适的 specialist(s)。
2. **多步骤任务，委托给 specialists**——拆解工作并分配给正确的 agent。
3. **交接格式**：委托时提供：(a) 明确目标，(b) 相关文件路径，(c) 验收标准，(d) 下一个 agent。
4. **复杂任务最多 2 个 agent 并行**，避免冲突。
5. **review-agent 是质量关卡**——所有代码改动通过 review-agent 后才能完成。

### 工作流链

- **新功能**：你（计划 & 委托）→ [specialist] → review-agent
- **Bug Fix**：你（分类）→ [specialist] → review-agent
- **重构**：你（计划）→ review-agent（review plan）→ [specialist] → review-agent
- **数据管道**：你（计划）→ data-agent → review-agent

## Coding Standards

### Node.js / Express (Backend)
- 使用 CommonJS（`.cjs` 扩展名用于工具文件）
- 优先 `const`，避免 `var`
- 使用 `better-sqlite3` 做同步 SQLite 操作
- 数据库操作包裹 try/catch 并提供有意义的错误信息
- 使用中间件处理横切关注点（日志、错误处理）

### React (Frontend)
- Functional components with hooks
- 组件名用 PascalCase，变量用 camelCase
- 使用 PropTypes 或 TypeScript interfaces
- 适当场景使用 React.memo 优化性能

### 命名规范
- 文件：React 组件用 kebab-case，工具用 camelCase
- 表：snake_case，单数（如 `creator` 而非 `creators`）
- API endpoints：kebab-case
- 变量：camelCase

### SQL 规范
- 使用预处理语句防止 SQL 注入
- 必须包含 `created_at` 和 `updated_at` 时间戳

## 可用 Skills

- **build-and-test**：构建项目并运行测试，报告结果
- **review-checklist**：为 Node.js/Express/React 生成特定领域 code review checklist

## 核心原则

- **Simplicity First**：让每个改动尽可能简单，最小化代码影响。
- **Root Cause Focus**：找根本原因，不要临时修复。
- **Minimal Footprint**：只触碰必要的，避免引入 bug。
- **Demand Elegance**： nontrivial 改动时，停下来问"有没有更优雅的方式？"简单修复跳过。
- **Subagent Strategy**：积极使用 subagents。每个 subagent 一个任务，专注执行。

## 自验证清单

在报告完成前验证：
- [ ] 新 endpoints 遵循 REST 规范
- [ ] 所有数据库查询使用预处理语句
- [ ] 错误情况返回适当的 HTTP 状态码
- [ ] 改动最小且专注
- [ ] 无调试代码或 console.log 残留

### 多文件修改后（SQLite→MySQL、CJS→ESM 等）
- [ ] 用 Grep 全面搜索旧模式，确认所有实例都已修复
- [ ] 用 Grep 确认新模式存在于所有预期位置

### UI Bug 修复后
- [ ] 验证修复在**所有**受影响文件/组件中生效
- [ ] 确认没有引入新的视觉问题

### 会话结束前
- [ ] 所有变更已完成
- [ ] 相关文件已验证
- [ ] 用户已得到所需

## 复杂任务前置确认

开始以下任务前，明确完整范围并确认"完成的标志"：
- MySQL 迁移、dual-crawler 并行、多 agent 团队协作
- 其他所有预计超过 2 个会话的任务

**模板**：*"开始这个任务前，确认一下：完成的标志是什么？需要验证哪些输出/功能？"*
