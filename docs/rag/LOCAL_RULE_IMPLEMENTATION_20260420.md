# Local Rule Retrieval Implementation - 2026-04-20

## 概述

本次实现完成了 Local Rule Retrieval Service，将 4 月版 SOP 文档拆分为可检索的知识源，并集成到 Experience Router 的 system prompt 构建流程中。

## 完成的工作

### 1. 更新 Yiyun Operator Config

**文件**: `operator_experiences` 表（MySQL）

**变更**:
- 更新了 Yiyun 的 `system_prompt_base`，基于 `docs/rag/operator-config/yiyun-apr-2026-draft.json`
- 更新了 `scene_config`，包含 5 个场景的专属规则
- 更新了 `forbidden_rules`，包含 4 条禁止规则

**验证**: 运行 `scripts/update-yiyun-config.js` 成功更新数据库

### 2. 实现 Local Rule Retrieval Service

**文件**: `server/services/localRuleRetrievalService.js`

**功能**:
- 从 `docs/rag/knowledge-manifest.json` 加载知识源清单
- 根据 `scene`、`operator`、`userMessage` 检索相关知识源
- 使用评分算法排序（scene 匹配 +10，operator 特定 +8，policy +5，关键词匹配 +1-3）
- 加载知识源内容并格式化为 prompt 注入文本

**核心函数**:
- `retrieveLocalRules(context)` - 检索相关知识源
- `buildLocalRulesText(sources)` - 构建注入文本
- `retrieveAndBuildLocalRules(context)` - 主入口

### 3. 集成到 System Prompt Builder

**文件**: `systemPromptBuilder.cjs`

**变更**:
- 在 `compileSystemPrompt` 函数中注入 local rules
- 位置：在 `clientMemory` 之后，`policyDocs` 之前
- 错误处理：失败时不阻断流程，继续使用旧的 policy_documents

### 4. 测试验证

**Shadow Case 测试**: `scripts/test-local-rule-retrieval.js`
- 7/7 测试通过
- 验证了检索算法能正确匹配预期的知识源

**端到端测试**: `scripts/test-local-rules-e2e.js`
- 3/3 测试通过
- 验证了 local rules 正确注入到 system prompt 中
- 验证了关键词出现在最终 prompt 中

## 知识源清单

当前已注册的知识源（`docs/rag/knowledge-manifest.json`）:

1. **policy-trial-pack-v1** - Trial Package Policy
2. **sop-creator-outreach-mar-2026-v1** - Creator Outreach SOP (March 2026)
3. **sop-violation-appeal-and-risk-control-v1** - Violation Appeal And Risk Control SOP
4. **sop-product-selection-and-posting-safety-v1** - Product Selection And Posting Safety SOP
5. **playbook-yiyun-onboarding-and-payment-apr-2026-v1** - Yiyun Playbook (April 2026) ✨ 新增
6. **faq-moras-product-mechanics-and-support-apr-2026-v1** - Moras FAQ (April 2026) ✨ 新增

## 检索算法

### 评分规则

| 匹配类型 | 分数 | 说明 |
|---------|------|------|
| Scene 匹配 | +10 | 知识源的 `scene` 数组包含当前 scene |
| Operator 特定 playbook | +8 | playbook 类型且标题包含 operator 名称 |
| Policy 类型 | +5 | 硬政策优先级最高 |
| SOP 类型 | +3 | 标准操作流程次之 |
| FAQ 类型 | +2 | 通用问题解答 |
| 关键词匹配 | +1 | 每个关键词匹配 +1 |
| 强关联匹配 | +3 | 特定关键词与源 ID 的强关联 |

### 强关联规则

- `safe` / `risk` / `violation` → `violation` SOP (+3)
- `product` / `recommend` → `product` / `faq` (+3)
- `post` / `cadence` / `spammy` → `posting` SOP (+3)

### 排序逻辑

1. 按分数降序
2. 分数相同时，按 `priority` 升序（priority 越小越优先）

## 使用示例

### 直接调用检索服务

```javascript
const { retrieveAndBuildLocalRules } = require('./server/services/localRuleRetrievalService');

const result = retrieveAndBuildLocalRules({
    scene: 'monthly_inquiry',
    operator: 'Yiyun',
    userMessage: 'Do I need to pay the $20 monthly fee upfront?',
    maxSources: 3
});

console.log(result.sources); // 匹配的知识源列表
console.log(result.text);    // 格式化的注入文本
```

### 通过 System Prompt Builder

```javascript
const { buildFullSystemPrompt } = require('./systemPromptBuilder.cjs');

const result = await buildFullSystemPrompt(
    clientId,
    'monthly_inquiry',
    [],
    { operator: 'Yiyun' }
);

console.log(result.prompt); // 包含 local rules 的完整 prompt
```

## 文件清单

### 新增文件

- `server/services/localRuleRetrievalService.js` - 检索服务核心实现
- `scripts/update-yiyun-config.js` - Yiyun 配置更新脚本
- `scripts/test-local-rule-retrieval.js` - Shadow case 测试
- `scripts/test-local-rules-e2e.js` - 端到端测试
- `docs/rag/sources/playbook-yiyun-onboarding-and-payment-apr-2026-v1.md` - Yiyun playbook
- `docs/rag/sources/faq-moras-product-mechanics-and-support-apr-2026-v1.md` - Moras FAQ
- `docs/rag/operator-config/yiyun-apr-2026-draft.json` - Yiyun 配置草案
- `docs/rag/APRIL_DOC_CONFIG_MAPPING_20260420.md` - 文档映射说明

### 修改文件

- `systemPromptBuilder.cjs` - 集成 local rules 检索
- `server/routes/experience.js` - 引入 localRuleRetrievalService（预留）
- `docs/rag/knowledge-manifest.json` - 新增 2 个知识源
- `docs/rag/shadow-cases/local-rule-shadow-cases.json` - 新增 2 个 shadow cases

## 下一步工作

### 可选优化

1. **用户消息上下文传递** - 当前 `compileSystemPrompt` 中 `userMessage` 为空，可以从 `messages` 数组中提取最后一条用户消息
2. **缓存机制** - 对于相同的 `scene + operator` 组合，可以缓存检索结果
3. **A/B 测试** - 对比使用 local rules 前后的回复质量
4. **监控指标** - 记录检索命中率、平均检索时间等

### 知识源扩展

1. 补充 Beau 专属 playbook（当前只有 Yiyun）
2. 补充更多场景的 SOP（如 `gmv_inquiry`、`content_request`）
3. 定期更新知识源内容，保持与最新 SOP 同步

## 验证清单

- [x] Yiyun operator_experiences 更新成功
- [x] Local rule retrieval service 实现完成
- [x] 集成到 systemPromptBuilder.cjs
- [x] Shadow case 测试 7/7 通过
- [x] 端到端测试 3/3 通过
- [x] 知识源清单更新
- [x] 文档编写完成

## 参考文档

- `docs/rag/LOCAL_RULE_RETRIEVAL_DESIGN.md` - 设计文档
- `docs/rag/APRIL_DOC_CONFIG_MAPPING_20260420.md` - 4 月文档映射
- `docs/AI_REPLY_GENERATION_SYSTEM.md` - 当前 AI 回复生成与策略入口
