# 代码审核路由

| Task Type | Agent | When to Use |
|-----------|-------|-------------|
| minimax review | minimax-reviewer | 快速审核、日常审查 |
| gpt review | gpt-reviewer | 深度审核、复杂逻辑、安全检查 |

## 使用方式

- `"用 minimax-reviewer 帮我审核这段代码"` → MiniMax 快速审核
- `"用 gpt-reviewer 深度审核这段代码"` → GPT-4 深度审核
- `"帮我检查这段代码有没有安全问题"` → 路由到 GPT-4 安全检查
