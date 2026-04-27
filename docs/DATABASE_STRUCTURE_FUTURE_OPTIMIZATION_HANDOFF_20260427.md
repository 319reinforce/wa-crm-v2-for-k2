# 数据结构后续优化 Handoff

Date: 2026-04-27
Branch: `codex/mysqloptimize-autorecompute-events`
Status: 后续开发路线图
Scope: WA CRM v2 MySQL schema、字段归属、兼容字段收敛、归档保留、表数量治理

## 标题

数据结构后续优化 Handoff：从兼容迁移到可治理 schema

## 描述

本文给后续 PR 使用，目标是把当前数据库从“能安全上线的 60 表目标 schema”继续推进到“字段归属清晰、旧表兼容层可删除、日志可归档、表数量可治理”的长期结构。

当前分支已经完成的基础：

- `schema.sql` 目标 schema 为 60 张表。
- 本地 MySQL 已验证 60 expected / 60 actual，无表、列、索引漂移。
- 容器启动默认执行 migration 004-013。
- 启动后会重建 `creator_event_snapshot` 和 `creator_lifecycle_snapshot`。
- `joinbrands_link.ev_*` 和 `wa_crm_data` lifecycle 字段已从主写入路径降级为 deprecated compatibility fallback。
- 金额、进度、deadline 已有 canonical owner：`event_billing_facts`、`event_progress_facts`、`event_deadline_facts`。
- retention/archive 基础表已落地，WA 消息硬删除被外部归档验证 gate 拦住。

后续优化不是单纯减少表数。真正目标是减少“同一个业务事实被多处写入、多处解释、多处漂移”的情况。表可以多，但必须有明确角色；旧表可以暂留，但不能继续作为新事实写入点。

## 1. 当前数据库状态

### 1.1 目标表数

当前 `schema.sql` 定义 60 张表。按角色划分：

| 角色 | 表数方向 | 说明 |
| --- | ---: | --- |
| Identity / operator / auth | 8 | 达人、别名、operator、用户与 session。 |
| WA message / group / sync | 5 | 原始消息与同步状态。 |
| Legacy CRM compatibility | 3 | `wa_crm_data`、`joinbrands_link`、`keeper_link`，其中前两者含 deprecated 字段。 |
| Event / lifecycle / detection | 11 | canonical event、证据、状态转移、快照、检测 cursor/run。 |
| Operational facts | 3 | 金额、进度、deadline。 |
| AI / SFT / profile / memory | 13 | 训练、画像、记忆、生成、检索、AI 用量。 |
| Media / template / import / training jobs | 9 | 素材、清理、模板、导入批次、训练日志。 |
| Retention / archive / audit | 8 | retention policy/run/ref、外部归档校验、audit/sync/rollup。 |

表数本身可以接受；当前问题集中在 deprecated 字段、兼容读取路径、日志增长和旧导出脚本。

### 1.2 当前主线事实归属

| 业务事实 | 当前 canonical owner | Deprecated / fallback |
| --- | --- | --- |
| 事件状态 | `events` + `event_evidence` | `joinbrands_link.ev_*` |
| 事件当前快照 | `creator_event_snapshot` | list/detail 里的旧字段兼容输出 |
| lifecycle 当前状态 | `creator_lifecycle_snapshot` | `wa_crm_data.beta_*` / `agency_*` 等 |
| 金额 | `event_billing_facts` | `wa_crm_data.monthly_fee_amount` |
| 视频进度 | `event_progress_facts` | `wa_crm_data.video_count` / `video_target` / `video_last_checked` |
| agency deadline | `event_deadline_facts` | `wa_crm_data.agency_deadline` |
| Profile/AI 归属 | `creator_id` + scoped external id | 纯 `client_id` join |
| WA 消息归档 | `message_archive_monthly_rollups` + archive refs/checks | 无明确历史归档结构 |

## 2. 优化原则

1. 每个字段只能有一个主写入 owner。
2. Derived snapshot 必须可重建，不能成为新事实来源。
3. Compatibility 字段可以读，但不能再被新业务写入。
4. migration 必须幂等，容器启动可以重复执行。
5. 数据保留策略先归档、再验证、最后才允许硬删除。
6. 所有内部 join 优先 `creator_id`，外部 id 只作为 scoped/hash/兼容键。
7. 表删除必须等到读取依赖、导出依赖、运营验收窗口都结束。

## 3. 后续完整路径

### Phase 0：上线确认和基线冻结

目标：确认当前 004-013 startup migration 在 staging/prod 能稳定执行，并冻结一份可比较基线。

工作项：

- 合并 PR #90 后重启 staging/prod 镜像。
- 确认 startup migration 日志包含 004-013。
- 确认 `[Startup][EventDerivedData] recompute done`。
- 在目标环境跑 `node scripts/analyze-schema-state.js`。
- 跑 `node scripts/run-retention-archive-jobs.cjs --dry-run`。
- 保存一份 schema analyzer 输出作为 rollout 基线。

验收：

- expected/actual table count 均为 60。
- `missing_tables`、`extra_tables`、`column_diffs`、`index_diffs` 均为空。
- EventPanel、CreatorDetail、stats、V1 board、reporting 页面无明显回退。

### Phase 1：旧 lifecycle 读取依赖继续收缩

目标：让业务读取从 snapshot/facts 优先变成 snapshot/facts only，旧字段只剩极少数 export/debug fallback。

优先文件和模块：

- `server/routes/creators.js`
- `server/services/replyStrategyService.js`
- `server/services/retrievalService.js`
- `server/routes/profile.js`
- `server/services/profileFallbackService.js`
- `server/services/creatorMessageFactsService.js`
- 历史导出脚本，如 SFT 和 roster/export 类脚本。
- 前端筛选与详情字段，如 `src/App.jsx` 中仍依赖旧 beta/agency 字段的路径。

策略：

- 所有 list/detail/read API 先加载 `creator_event_snapshot`。
- 所有金额/进度/deadline API 先加载 operational facts。
- 未映射的旧字段必须标注 fallback-only，不允许悄悄写回。
- 每移除一组读取依赖，都加 grep 证明。

验收：

```bash
rg -n "ev_trial|ev_monthly|ev_gmv|monthly_fee_amount|agency_deadline|video_count|video_target" server src scripts
```

剩余命中必须能解释为 migration/backfill、schema definition、compatibility projection、deprecated fallback 或 test fixture。

### Phase 2：`wa_crm_data` 拆分为 work state 与 facts

目标：把 `wa_crm_data` 从“大杂烩 CRM 表”变成纯 operator work state，业务事实迁出。

建议目标表：

| 新 owner | 字段 |
| --- | --- |
| `creator_work_state` 或保留瘦身后的 `wa_crm_data` | `priority`、`next_action`、`urgency_level`、operator note 类工作状态。 |
| `event_billing_facts` | `monthly_fee_amount`、`monthly_fee_status`、currency、effective_at。 |
| `event_progress_facts` | `video_count`、`video_target`、`video_last_checked`、period。 |
| `event_deadline_facts` | `agency_deadline`、deadline status。 |
| `events` / `event_periods` | beta、trial、monthly challenge、agency lifecycle 状态。 |

PR 切片：

1. 给 `wa_crm_data` 现有字段补 read/write audit 日志或 metric。
2. 所有写入口改到 facts/events。
3. 所有读入口改 facts/events/snapshot。
4. 给旧字段加 deprecation comment 和 dashboard。
5. 验证窗口结束后，将旧字段从 API response 中移到 `_deprecated` 或 debug-only。
6. 最后再考虑 drop column migration。

验收：

- `PUT /api/creators/:id/wacrm` 不再直接写 lifecycle/amount/progress/deadline 旧字段。
- CreatorDetail 所有编辑都走 event/action/fact API。
- 旧字段连续一个验证窗口无新写入。

### Phase 3：`joinbrands_link` 拆分 external profile 与 event flags

目标：`joinbrands_link` 只保留 JoinBrands 外部属性，不再承载生命周期 flag。

建议路径：

- 保留 JoinBrands 外部 id、username、profile、campaign 属性。
- `ev_*` 完全由 `creator_event_snapshot.compat_ev_flags_json` 输出。
- 前端筛选从旧 `ev_*` 改为 canonical event key / snapshot flag。
- reporting/export 从 snapshot 读取，不读 `joinbrands_link.ev_*`。

最后处理：

- 把 `joinbrands_link.ev_*` 移入 `_deprecated` 输出。
- 如 30-60 天无读取依赖，再写 drop migration。

验收：

- `rg -n "joinbrands.*ev_|ev_gmv|ev_trial|ev_monthly" server src scripts` 只剩 schema/migration/test/deprecated projection。

### Phase 4：Event/lifecycle 模型固化

目标：让事件系统成为 lifecycle 唯一事实入口。

工作项：

- 完善 `event_definitions` seed 和版本管理。
- 为 cancel/clear/restore/override 增加统一 action API。
- 建立事件 evidence 的等级规则：message quote/hash、operator assertion、external system import。
- 给 EventPanel 增加 review state 批处理和冲突处理。
- 给 `creator_lifecycle_transition` 增加可审计 reason 与操作者来源。
- 明确 periodic event 与 event_periods 的关系，避免 monthly challenge 状态散落。

验收：

- 生命周期 stage 变化都能追溯到 event/evidence。
- 启动 rebuild 可重建 snapshot，无需旧 `wa_crm_data` lifecycle 字段。
- 冲突事件可在 EventPanel 处理，不需要手改 DB。

### Phase 5：AI/profile/memory 结构收敛

目标：所有 AI/profile 数据优先用 `creator_id`，旧 `client_id` 只作为外部兼容标识。

工作项：

- 检查并补齐这些表的 forward writes：`client_memory`、`client_profiles`、`client_tags`、`profile_analysis_state`、`client_profile_snapshots`、`client_profile_change_events`、`generation_log`、`retrieval_snapshot`、`sft_feedback`。
- `client_id` 读取逐步改为 `creator_id` + scoped external id fallback。
- profile snapshot/change event 的 reviewer/status 流程整理清楚。
- SFT 训练数据保留可复现的 prompt/version/provider/reference，不保留不必要原始隐私字段。

验收：

- 新增 AI/profile/SFT 行均有 `creator_id`，除非确实无法匹配。
- 画像和记忆查询不再依赖 raw phone 作为主 join。
- `creator_id IS NULL` 比例有监控或清理任务。

### Phase 6：Retention/archive 与冷热分层

目标：日志表和消息表不再无限增长。

当前已落地：

- `data_retention_policies`
- `data_retention_runs`
- `data_retention_archive_refs`
- `data_retention_external_archive_checks`
- `message_archive_monthly_rollups`
- `ai_usage_daily`

后续工作：

- AI 用量：`ai_usage_logs` 每日 rollup 后保留明细窗口。
- WA 消息：`wa_messages`、`wa_group_messages` 先月聚合，再外部归档验证，最后才允许硬删除。
- generation/retrieval：保留 SFT/audit 可追溯引用，其他进入 archive ref。
- audit_log：长期保留或只归档不删。
- media：`media_assets.storage_tier` 驱动 hot/warm/cold/deleted，实际文件删除由 media cleanup service 控制。

硬删除窗口建议：

| 表 | archive after | purge after | 前置条件 |
| --- | ---: | ---: | --- |
| `generation_log` | 90 天 | 365 天 | 不被 SFT/audit 引用。 |
| `retrieval_snapshot` | 90 天 | 365 天 | 不被 SFT/audit 引用。 |
| `ai_usage_logs` | 180 天 | 730 天 | `ai_usage_daily` 已汇总。 |
| `audit_log` | 365 天 | 不默认硬删 | 只做归档或长期保留。 |
| `wa_messages` | 365 天 | 1095 天 | 外部归档 verified，manifest 覆盖 cutoff。 |
| `wa_group_messages` | 180 天 | 730 天 | 外部归档 verified，manifest 覆盖 cutoff。 |
| `media_assets` | 30 天 | 90 天 | 无 exemption，文件归档/压缩完成。 |

验收：

- `--dry-run` 输出候选、rollup、blocked reason。
- 无 external archive verified record 时，WA 消息 purge 不枚举候选。
- 任意 `--apply --purge` 都有 run 记录和 archive ref。

### Phase 7：表数量治理和 drop/archive 候选

目标：在验证窗口结束后减少不再有 owner 的表/字段。

优先候选：

| 对象 | 动作 | 前置条件 |
| --- | --- | --- |
| `manual_match` | archive/drop | 确认 0 行或迁移到 alias audit。 |
| `joinbrands_link.ev_*` | drop columns | 读写依赖清零，snapshot 输出稳定。 |
| `wa_crm_data` lifecycle fields | drop columns | facts/events 读写稳定，前端无依赖。 |
| 旧一次性 backfill/export 脚本 | archive/remove | 当前流程不再引用。 |
| runtime DDL helper | remove | `rg "CREATE TABLE IF NOT EXISTS" server scripts` 只剩 migrations/setup。 |

不建议删除：

- `event_detection_cursor`
- `event_detection_runs`
- `creator_event_snapshot`
- `creator_lifecycle_snapshot`
- `data_retention_*`

这些是当前架构的一部分，不是垃圾表。

## 4. 推荐 PR 顺序

### PR A：上线后基线验证

- 只加目标环境 analyzer 输出和 runbook 更新。
- 不做 schema 变更。
- 产物：staging/prod 60/60 基线。

### PR B：Creator/API 旧字段读取收缩

- `server/routes/creators.js`
- CreatorDetail / EventPanel / filters。
- 目标：snapshot/facts 优先变成默认，旧字段 fallback 最小化。

### PR C：Prompt/report/export 旧字段读取收缩

- reply strategy、retrieval/profile prompt、reporting、export scripts。
- 目标：AI 和导出不再把旧 `ev_*` 当事实。

### PR D：`wa_crm_data` work state 拆分

- 新建或瘦身 work state owner。
- 旧 amount/progress/deadline 彻底只读。

### PR E：retention apply dry-run 到 apply

- 先对 `ai_usage_logs` 做日汇总 apply。
- 再对 WA message 做月聚合 apply。
- 不做 WA hard delete，直到外部 archive verified。

### PR F：drop/archive 第一批旧字段

- 只在 30-60 天验证窗口后做。
- 每个 drop migration 前必须有 grep 证明和备份/回滚说明。

## 5. 验证清单

每个数据库 PR 至少跑：

```bash
node --check <changed-js-files>
npm run test:unit
DB_MIGRATION_ANALYZE_AFTER=true node scripts/run-startup-migrations.cjs
node scripts/analyze-schema-state.js
git diff --check
```

涉及浏览器或前端：

- CreatorDetail lifecycle 编辑。
- EventPanel 筛选、取消/清除事件。
- stats / V1 board / reporting。
- 人工抽样至少覆盖 Beau、Jiawen、Yiyun、WangYouKe owner。

涉及 retention：

```bash
node scripts/run-retention-archive-jobs.cjs --dry-run
node scripts/run-retention-archive-jobs.cjs --dry-run --policy=wa_messages_365d --limit=5
node scripts/run-retention-archive-jobs.cjs --dry-run --policy=wa_group_messages_180d --limit=5
```

## 6. 不可破坏边界

- 不恢复 SQLite / `crm.db`。
- 不在 API 正常请求路径创建表。
- 不把 deprecated 字段重新变成写入目标。
- 不在没有 external archive verified record 的情况下硬删除 WA message。
- 不在没有 schema analyzer clean result 的情况下合并 drop migration。
- 不把 raw phone、message body、secret 写入外部日志或新文档。

## 7. 判断“字段整洁”的标准

字段不是“少”就整洁，而是满足以下条件：

1. 字段名能看出所属 domain。
2. 字段只有一个写入服务。
3. 字段对应的事实可以追溯 evidence 或 operator action。
4. 字段被缓存/快照时能从 canonical fact 重建。
5. 字段有保留策略或明确长期保留理由。
6. 字段在 API response 中不混淆 canonical 与 deprecated 来源。

当前状态：已从混乱状态进入可治理状态，但还没有进入最终瘦身状态。后续重点是减少 deprecated 读取依赖，而不是继续盲目加表。

## Obsidian Sync

- Status: synced
- Note: `docs/obsidian/notes/2026-04-27-database-structure-future-optimization-handoff.md`
- Index: `docs/obsidian/index.md`
