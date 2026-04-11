# WA CRM RAG 知识源标准（供 Agent 统一读取）

本标准用于约束所有写入 `docs/rag/sources/` 的政策/SOP/FAQ 文档，确保其他 Agent 可稳定解析、清洗、入库并检索。

## 1. 目录与命名

- 原始知识文件统一放在：`docs/rag/sources/`
- 元数据清单统一放在：`docs/rag/knowledge-manifest.json`
- 文件名统一小写 kebab-case，并带版本号：
  - `policy-trial-pack-v1.md`
  - `sop-payment-followup-v2.md`
  - `faq-gmv-milestone-v1.md`

## 2. 允许文档类型

- `policy`：规则/边界/硬约束（优先级最高）
- `sop`：操作流程与执行步骤
- `faq`：高频问答
- `playbook`：话术和策略集合
- `pricing`：价格与计费规则
- `compliance`：合规限制

## 3. 必填元数据（manifest）

每条 `sources[]` 必须包含以下字段：

- `id`：唯一 ID，格式建议 `<type>-<topic>-vN`
- `title`：标题
- `type`：见上方允许类型
- `format`：`md|txt|pdf|docx`
- `path`：相对路径（指向 `docs/rag/sources` 下文件）
- `scene`：数组，至少 1 个场景
- `status`：`approved|draft|deprecated`
- `updated_at`：`YYYY-MM-DD`

建议字段：

- `priority`：1~5（1 最高）
- `sensitivity`：`internal|public`
- `effective_from`：规则生效时间（`YYYY-MM-DD`）
- `rule_version`：规则版本号（如 `2026-04-15`）

## 4. 文档内容结构模板

每份知识文档建议按以下顺序：

1. `Title`：文档主题（1 行）
2. `Scope`：适用场景与对象（2-5 行）
3. `Rules`：强约束规则（清晰可执行）
4. `Do / Don’t`：允许与禁止项
5. `Examples`：正反例各 1-3 条
6. `Version Log`：版本和更新时间

可直接复用模板：

- `docs/rag/templates/POLICY_TEMPLATE.md`
- `docs/rag/templates/SOP_TEMPLATE.md`

## 5. 质量门槛（入库前自检）

- 权威：来源已确认（负责人或正式政策）
- 可执行：不是“讨论稿/脑暴稿”
- 可检索：关键术语明确，避免模糊词堆叠
- 可追溯：能定位版本与更新时间
- 安全：不得包含 `wa_phone`、PII、内部敏感备注

## 6. Agent 执行规范

当其他 Agent 处理 RAG 知识源时，必须：

1. 先读取本文件，再读取 `docs/rag/knowledge-manifest.json`
2. 只同步 `status=approved`（除非明确要求包含 draft）
3. 发现冲突时，以 `policy` 高于 `sop`，`sop` 高于 `faq`
4. 发现过期文档，标记为 `deprecated`，不直接删除
5. 同步前必须运行：
   - `npm run rag:manifest:check`
   - `npm run rag:sync -- --dry-run`

## 7. 推荐协作流程

1. 新增/更新文档到 `docs/rag/sources/`
2. 更新 `knowledge-manifest.json`
3. 运行 manifest 校验
4. dry-run 同步，检查变更
5. 正式同步到 OpenAI Vector Store

## 8. SFT 对齐建议（规则切换日）

当政策在某个日期切换（例如 2026-04-15）时，建议执行：

1. 先写入 `effective_from` 和 `rule_version` 到 manifest
2. 运行 `npm run sft:align:rules -- --dry-run`
3. 审核预览结果后再 `npm run sft:align:rules -- --apply`
4. 对齐后再触发训练，避免旧规则样本直接进入新轮训练
