# wa-reply-diagnose (v1)

排查 WA CRM AI 回复生成失败问题。诊断消息编辑框点击"AI生成"后无响应或报错的原因。

## 诊断步骤

按顺序执行，任意一步失败继续下一步。

### 1. AI 服务健康检查

```bash
curl -s http://localhost:3000/api/ai/status 2>/dev/null
# 或直接测试生成
curl -s -X POST http://localhost:3000/api/ai/generate \
  -H "Content-Type: application/json" \
  -d '{"creator_id":1,"text":"hello"}' 2>/dev/null | head -c 300
```

**期望**: 返回 JSON 有 `ok: true` 或生成的文本
**失败** → 跳到步骤 2

### 2. API Key 配置检查

```bash
grep -E "MINIMAX_API_KEY|OPENAI_API_KEY|USE_OPENAI" /Users/depp/wa-bot/wa-crm-v2/.env
```

**期望**: `MINIMAX_API_KEY=sk-cp-...` 非 placeholder
**失败**: `.env` 中 key 为空或 placeholder → 需更新真实 key

### 3. 服务器日志最新错误

```bash
tail -30 /tmp/server.log 2>/dev/null || \
  ps aux | grep "node.*server" | grep -v grep | awk '{print $2}' | xargs -I{} ls /proc/{}/fd 2>/dev/null | head
```

**查找**: `MINIMAX`、`API`、`401`、`403`、`rate limit` 相关错误

### 4. 数据库连接（MySQL）

```bash
mysql -h 127.0.0.1 -u root wa_crm_v2 -e "SELECT 1 AS ok;" 2>&1
```

**失败** → MySQL 服务未启动或密码错误

### 5. AI Router 端点测试

```bash
# 测试 MiniMax 路由
curl -s http://localhost:3000/api/minimax \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"hi"}]}' 2>/dev/null | head -c 200

# 测试 OpenAI 路由（如果启用）
curl -s http://localhost:3000/api/openai \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"hi"}]}' 2>/dev/null | head -c 200
```

### 6. 达人会话历史检查

```bash
curl -s "http://localhost:3000/api/creators/1/messages?limit=5" 2>/dev/null | \
  python3 -m json.tool 2>/dev/null | head -30
```

**确认**: 达人有足够的历史消息可供 AI 生成上下文

### 7. 前端网络请求（可选）

打开浏览器 DevTools → Network，勾选"AI生成"按钮，观察：
- 请求 URL 和参数
- 响应状态码和 body
- 是否有 CORS 错误

## 输出格式

```markdown
## AI 回复生成诊断报告

| 检查项 | 状态 | 详情 |
|--------|------|------|
| AI 服务 | ✅/❌ | response... |
| API Key | ✅/❌ | key 已配置 / key 为空 |
| 服务器日志 | ✅/❌ | 最新错误... |
| MySQL 连接 | ✅/❌ | ok / error |
| MiniMax 路由 | ✅/❌ | response... |
| OpenAI 路由 | ✅/❌ | response... |
| 达人历史 | ✅/❌ | N 条消息 |

## 根因
- [最可能的故障点]

## 修复建议
- [具体命令或操作]
```

## 配合使用

- `.env` key 过期/错误 → 到 MiniMax/OpenAI 控制台获取新 key，更新 `.env` 后 `kill -9 <node_pid>` 重启
- API 限流 → 等待 1 分钟重试，或联系 API 提供商
- CORS 错误 → 检查 `server/index.cjs` 中 CORS 中间件配置
- 前端请求失败 → 打开浏览器 DevTools Network 标签页复现

## 何时使用

- 用户点击"AI生成"后无响应或报错
- AI 回复内容为空或乱码
- 消息发送成功但 AI 生成失败
- 定时检查 AI 服务健康状态

## 注意事项

- 默认检查本地 3000 端口，远程部署时需替换 HOST
- 传入 `--full` 参数可额外检查速率限制和历史记录条数
