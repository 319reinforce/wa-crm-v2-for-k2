# OpenAI 托管 RAG 快速落地（无本地训练机）

本方案目标：最快在 WA CRM v2 跑通 OpenAI 托管 RAG + API 生成。

## 你需要手动完成的步骤（最小集）

1. 在部署环境配置并保存以下变量：
   - `OPENAI_API_KEY`
   - `USE_OPENAI=true`
   - `AI_PROXY_TOKEN`（或 `WA_ADMIN_TOKEN`）
2. 若启用 OpenAI 托管检索，再补：
   - `OPENAI_RAG_ENABLED=true`
   - `OPENAI_VECTOR_STORE_ID=vs_xxx`
   - `OPENAI_RAG_TOP_K=8`（可选）
3. 重启服务使变量生效。

可用命令检查：

```bash
npm run rag:env:check
```

知识源标准文档（给其他 Agent 读取）：

- `docs/rag/KNOWLEDGE_SOURCE_STANDARD.md`
- `docs/OBSIDIAN_MEMORY_STANDARD.md`

## 知识源清单标准（什么文档才能进 RAG）

每份知识源必须满足以下标准：

- 权威性：来源于正式政策/SOP/业务负责人确认文本。
- 可执行性：包含明确规则、阈值、动作，不是纯讨论稿。
- 新鲜度：有更新时间；过期文档要标 `deprecated`。
- 原子性：尽量一份文档聚焦一个主题，避免“超大杂烩”。
- 可路由：必须标注适用 `scene`，便于按场景检索。
- 安全性：不含 `wa_phone`、隐私字段、内部敏感备注。

推荐单文档长度：300~3000 字（过长请拆分章节）。

## 知识源放置位置（建议固定）

- 清单文件：`docs/rag/knowledge-manifest.json`
- 原文档目录：`docs/rag/sources/`
- 校验脚本：`scripts/validate-knowledge-manifest.cjs`

校验命令：

```bash
npm run rag:manifest:check
```

## manifest 字段约定

每条 `source` 推荐包含：

- `id`: 唯一 ID（如 `policy-trial-pack-v1`）
- `title`: 文档标题
- `type`: `policy|sop|faq|playbook|pricing|compliance`
- `format`: `md|pdf|docx|txt` 等
- `path`: 仓库相对路径（指向原文档）
- `scene`: 场景数组（例如 `["trial_intro","payment_followup"]`）
- `priority`: 优先级（1 最高）
- `sensitivity`: `internal|public`
- `status`: `approved|draft|deprecated`
- `updated_at`: `YYYY-MM-DD`
- `effective_from`: `YYYY-MM-DD`（规则生效日）
- `rule_version`: 例如 `2026-04-15`

## 推荐流程

1. 将原文档放入 `docs/rag/sources/`
2. 在 `docs/rag/knowledge-manifest.json` 新增元数据
3. 跑 `npm run rag:manifest:check`
4. Dry-run 同步：`npm run rag:sync -- --dry-run`
5. 正式同步：`npm run rag:sync`
6. 检索验证：`npm run rag:query -- "trial package rules"`

## 24h 观测（人工改写率 / 命中率 / 采纳率）

启动观测窗口：

```bash
npm run rag:obs:start
```

结束并导出报告：

```bash
npm run rag:obs:finish
# 可选：按负责人
npm run rag:obs:finish -- --owner=Beau
```

报告输出目录：

- `docs/rag/observation-reports/`

## 正式上线统计（从上线日起算）

如果你希望从正式上线日开始统计（例如 2026-04-12）：

```bash
# 设置上线统计起点（默认明天 00:00 +08:00）
npm run metrics:launch:start -- --at=2026-04-12

# 后续按“上线起点”出报告
npm run metrics:launch:report
```

如需先做 4/15 规则对齐再训练：

```bash
npm run sft:align:rules -- --dry-run
npm run sft:align:rules -- --apply
```

## Obsidian Sync

- Status: synced
- Note: `docs/obsidian/notes/2026-04-25-obsidian-memory-standard.md`
- Index: `docs/obsidian/index.md`
