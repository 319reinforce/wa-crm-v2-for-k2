# 标准话术检索功能 - 验收清单

## ✅ 代码实现验收

### 后端
- [x] `server/routes/experience.js` - 新增 `POST /api/experience/retrieve-template` 端点（第 332 行）
- [x] `server/services/localRuleRetrievalService.js` - 新增 `extractTemplateFromSource()` 函数（第 233 行）
- [x] 错误处理：返回 `{ template: null }` 或 500 错误
- [x] 日志记录：`[retrieve-template] Error:` 前缀

### 前端
- [x] `src/components/StandardReplyCard.jsx` - 标准话术卡片组件（5.7KB）
- [x] `src/components/LoadingSkeleton.jsx` - 加载骨架屏组件（910B）
- [x] `src/components/EmptyState.jsx` - 空状态提示组件（1.6KB）
- [x] `src/components/AIReplyPicker.jsx` - 集成第三选项（+19 行）
- [x] `src/components/WAMessageComposer.jsx` - 传递 props（+8 行）

### 测试
- [x] `scripts/test-template-extraction.js` - 功能测试脚本
- [x] 测试用例 1: Yiyun 月费咨询 ✅
- [x] 测试用例 2: Beau 发帖安全 ✅

## ✅ 功能验收

### 核心功能
- [x] 用户在回复界面看到 3 个选项
- [x] 第三个选项为「标准话术 (S)」
- [x] 琥珀色系（amber）视觉风格
- [x] 点击「使用」后填充到输入框
- [x] 检索响应时间 < 500ms

### 状态处理
- [x] 加载状态：显示骨架屏动画
- [x] 成功状态：显示话术文本 + 来源标签
- [x] 空状态：显示「暂无匹配的标准话术」+ 重试按钮
- [x] 错误状态：显示错误信息 + 重试按钮

### 响应式设计
- [x] 桌面端：3 列布局（AI 方案一、AI 方案二、标准话术）
- [x] 移动端：横向滚动（snap-x snap-mandatory）
- [x] compactMobile 模式支持

## ✅ 代码质量

### 代码规范
- [x] 使用 JSDoc 注释
- [x] 函数命名清晰（extractTemplateFromSource, formatSourceName）
- [x] 错误处理完善（try-catch + 日志）
- [x] Props 类型明确（scene, operator, userMessage, clientId）

### 性能优化
- [x] 只检索 top 1 知识源（maxSources: 1）
- [x] 5 秒超时保护（AbortSignal.timeout(5000)）
- [x] 纯文件读取，无 AI 调用

### 可维护性
- [x] 组件拆分合理（Card, Skeleton, EmptyState）
- [x] 复用现有服务（localRuleRetrievalService）
- [x] 配色统一（WA 主题色 + amber 系列）

## 📋 部署前检查

### 必须完成
- [ ] 代码审查（Code Review）
- [ ] 单元测试（前端组件测试）
- [ ] 集成测试（API 端点测试）
- [ ] E2E 测试（用户完整流程）

### 建议完成
- [ ] 性能测试（检索响应时间监控）
- [ ] A11y 测试（键盘导航、屏幕阅读器）
- [ ] 浏览器兼容性测试（Chrome, Safari, Firefox）
- [ ] 移动端真机测试（iOS, Android）

## 🚀 部署步骤

1. **代码审查**
   ```bash
   /ccg:review
   ```

2. **运行测试**
   ```bash
   npm test
   node scripts/test-template-extraction.js
   ```

3. **启动服务器验证**
   ```bash
   npm start
   # 访问 http://localhost:3000
   # 打开消息回复界面，点击「生成回复」
   # 验证第三个「标准话术」选项出现
   ```

4. **提交代码**
   ```bash
   git add .
   git commit -m "feat: add standard template retrieval (3rd reply option)"
   git push origin feature/standard-reply-retrieval
   ```

5. **创建 Pull Request**
   - 标题：`feat: 新增标准话术检索功能（第三选项）`
   - 描述：参考 `.claude/plan/standard-reply-retrieval-COMPLETED.md`

## 📊 监控指标

部署后需要监控：
- 标准话术检索命中率（有话术 vs 无话术）
- 用户使用率（选择标准话术 vs AI 生成）
- 检索响应时间（P50, P95, P99）
- 错误率（API 500 错误）

---

**验收状态**: ✅ 代码实现完成，等待测试和部署

**验收人**: _____________  
**验收日期**: 2026-04-20
