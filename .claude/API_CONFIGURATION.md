# API 配置说明

**配置日期**: 2026-04-20

---

## 翻译功能 - MiniMax 官方 API

### 环境变量
```bash
MINIMAX_TRANSLATION_API_KEY=sk-cp-A_5r2O7e-wDzIhHgqlRWiWNQgQBRaY41zuxM0ZZ9O2C-W2RYk7s4uJnkhTslO948oszM44i4eirp4cSRqqcPvvByqnicyD__x3MfS189wp-L86oe1iLHnkU
MINIMAX_TRANSLATION_API_BASE=https://api.minimaxi.com/anthropic
```

### 使用模块
- `server/services/aiService.js` - 核心翻译服务
- `server/services/profileService.js` - 客户画像生成
- `server/services/profileAnalysisService.js` - 画像分析
- `server/services/memoryExtractionService.js` - 记忆提取
- `server/routes/profile.js` - 画像路由
- `scripts/generate-sft-from-history.cjs` - SFT 语料生成
- `scripts/generate-events-from-chat.cjs` - 事件生成

### 测试
```bash
curl -X POST http://localhost:3000/api/translate \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer 8bcb8eb84c219b5c66e15ca85031ed410eef9d262a86f13f" \
  -d '{"text":"Hello","mode":"to_zh"}'
```

**状态**: ✅ 正常工作

---

## 回复生成功能 - Gemini via NewAPI

### 环境变量
```bash
MINIMAX_API_KEY=sk-6B16MnWLC0r0JCCtmx71hw2bqafD78BwoMwAv6AfdMQ86Jmd
MINIMAX_API_BASE=https://chintao.cn
MINIMAX_MODEL=gemini-2.5-flash
```

### 配置说明
- **类型**: NewAPI 中转站
- **上游模型**: Gemini 2.5 Flash
- **中转地址**: https://chintao.cn

### 使用模块
- `server/services/replyGenerationService.js` - 回复生成核心服务
- `server/routes/ai.js` - AI 生成路由

### 测试
```bash
curl -X POST http://localhost:3000/api/minimax \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer 8bcb8eb84c219b5c66e15ca85031ed410eef9d262a86f13f" \
  -d '{
    "messages": [
      {"role": "system", "content": "你是专业的客服助手"},
      {"role": "user", "content": "你好"}
    ],
    "max_tokens": 200
  }'
```

**状态**: ⚠️ 配置正确，可能遇到上游速率限制（临时性问题）

---

## 标准话术检索功能

### 端点
```
POST /api/experience/retrieve-template
```

### 测试
```bash
curl -X POST http://localhost:3000/api/experience/retrieve-template \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer 8bcb8eb84c219b5c66e15ca85031ed410eef9d262a86f13f" \
  -d '{"operator":"Yiyun","scene":"monthly_inquiry","user_message":"Do I need to pay?"}'
```

**状态**: ✅ 正常工作

---

## 代码修改记录

### 1. server/services/aiService.js
- 新增 `TRANSLATION_API_KEY` 和 `TRANSLATION_API_BASE` 变量
- 翻译功能使用独立的 API 配置
- 支持 fallback 到 `MINIMAX_API_KEY`

### 2. server/services/replyGenerationService.js
- 新增 `apiBase` 变量，从环境变量读取
- 新增 `defaultModel` 变量，从 `MINIMAX_MODEL` 读取
- 回复生成 URL 改为 `${apiBase}/v1/messages`

### 3. .env
- 新增 `MINIMAX_TRANSLATION_API_KEY` - 翻译专用 Key
- 新增 `MINIMAX_TRANSLATION_API_BASE` - 翻译专用 Base URL
- 修改 `MINIMAX_API_KEY` - 回复生成 Key
- 修改 `MINIMAX_API_BASE` - 回复生成 Base URL
- 新增 `MINIMAX_MODEL` - 默认模型配置
- 修改 `USE_OPENAI=false` - 禁用 OpenAI

---

## 故障排查

### 问题 1: 上游速率限制
**错误**: `Upstream rate limit exceeded, please retry later`

**原因**: NewAPI 中转站的上游 Gemini API 遇到速率限制

**解决**: 等待几分钟后自动恢复，或联系 NewAPI 管理员

### 问题 2: 模型不可用
**错误**: `分组 gemini-default 下模型 xxx 无可用渠道`

**原因**: NewAPI 中转站未配置该模型的渠道

**解决**: 在 NewAPI 管理后台配置模型映射，或使用支持的模型（如 `gemini-2.5-flash`）

---

## 服务启动

```bash
cd /Users/depp/wa-bot/wa-crm-v2
npm start
```

服务地址: http://localhost:3000
