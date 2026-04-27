# MySQL 优化上线 Handoff：历史重算与线上 Schema 应用确认

Date: 2026-04-27
Branch: `codex/mysqloptimize-autorecompute-events`
Status: 上线前交接说明

## 标题

MySQL 优化上线 Handoff：历史重算与线上 Schema 应用确认

## 描述

本文用于交接 `codex/mysqloptimize-autorecompute-events` 分支上线前后的数据库行为，重点回答三个问题：

1. 线上服务上线并重启后，是否会对历史事件派生数据做 rebuild。
2. 线上数据库结构是否会被本次修改自动应用，还是需要单独执行 migration。
3. 如果使用容器镜像重启，如何自动执行 managed migrations。

结论先写在这里：容器镜像启动会先自动执行 managed migrations，再启动 API；随后 API 会自动尝试重算历史派生状态。migration 本身保持幂等、additive/backfill/upsert，不包含 drop、truncate、delete，不会触发 retention purge 或 WA 消息硬删除。

## 1. 线上上线后是否会对历史 rebuild

会，但这里的 rebuild 是“派生状态重算”，不是“重新扫描历史聊天并重新抽取事件”。

服务启动后，`server/index.cjs` 会调用 `startStartupEventDerivedDataRecompute(db.getDb())`。默认情况下，只要没有设置 `STARTUP_EVENT_RECOMPUTE_ENABLED=0/false/no/off`，启动任务会异步执行。

启动 rebuild 会做这些事：

- 检查事件、生命周期、兼容快照相关表和关键列是否存在。
- 按 `creators.id` 分批遍历历史达人。
- 基于现有 `events` 表里的 active/completed canonical events 重建 `creator_event_snapshot`。
- 重新评估并写入 `creator_lifecycle_snapshot`。
- 读取新的 operational facts 表，包括 `event_billing_facts`、`event_progress_facts`、`event_deadline_facts`，用于金额、进度、deadline 的归属投影。
- `writeTransition=false`，因此启动重算不会批量写入 lifecycle transition 历史噪音。

启动 rebuild 不会做这些事：

- 不会自动执行 SQL migration。
- 不会创建缺失表或缺失列。
- 不会把所有历史 WA 消息重新跑一遍 AI/Minimax 事件抽取。
- 不会自动硬删除或归档历史消息。
- 不会修改旧 `joinbrands_link.ev_*` 或 `wa_crm_data` deprecated lifecycle 字段作为新的写入来源。

如果目标库 schema 尚未准备好，服务会跳过 rebuild 并继续启动，预期日志形态是：

```text
[Startup][EventDerivedData] skip recompute: schema missing <missing tables/columns>; run lifecycle migration plus SQL migrations 004-010 first
```

如果目标库 schema 已准备好，API 重启后预期日志形态是：

```text
[Startup][EventDerivedData] recompute done: processed=<n>, snapshots=<n>, lifecycles=<n>, duration_ms=<ms>
```

可选控制项：

- `STARTUP_EVENT_RECOMPUTE_ENABLED=false`：临时关闭启动 rebuild。
- `STARTUP_EVENT_RECOMPUTE_BATCH_SIZE=<n>`：调整分批大小，默认 50，最大 500。
- `STARTUP_EVENT_RECOMPUTE_MAX_CREATORS=<n>`：限制本次启动最多处理多少达人，可用于 staging/prod canary。

如果需要“重新从历史聊天内容抽取 canonical events”，那是单独的 backfill/AI 抽取任务，不属于本次 API 启动 rebuild。当前 package 里保留的相关入口是 `npm run events:recompute:minimax`，上线时不应把它误认为默认启动任务。

## 2. 线上数据库结构是否会应用修改

容器部署会自动应用。`schema.sql` 是主 schema/source of truth，适合新环境或完整初始化；已有 staging/prod 数据库通过镜像 entrypoint 自动执行 managed migrations，拿到这次表、列、索引和种子策略更新。

本分支新增了容器启动 migration runner：

- `scripts/docker-entrypoint.sh`
- `scripts/run-startup-migrations.cjs`
- `npm run db:migrate:startup`

默认 `DB_MIGRATE_ON_STARTUP=true`，容器每次启动会先执行 migration，再 `exec node server/index.cjs`。如果需要临时跳过，显式设置：

```bash
DB_MIGRATE_ON_STARTUP=false
```

本分支涉及的目标环境 migration 顺序是：

```bash
node scripts/apply-sql-migrations.cjs --allow-remote \
  server/migrations/004_event_lifecycle_fact_model.sql \
  server/migrations/005_active_event_detection_queue.sql \
  server/migrations/006_managed_runtime_tables.sql \
  server/migrations/007_creator_import_tables.sql \
  server/migrations/008_template_media_training_tables.sql \
  server/migrations/009_ai_profile_creator_id_backfill.sql \
  server/migrations/010_schema_index_backfill.sql \
  server/migrations/011_billing_progress_deadline_retention.sql \
  server/migrations/012_retention_rollups_and_purge_windows.sql \
  server/migrations/013_retention_external_archive_checks.sql
```

容器启动 runner 会直接以 startup migration 身份调用 `scripts/apply-sql-migrations.cjs --allow-remote`，因此不再要求额外设置 `CONFIRM_REMOTE_MIGRATION=1`。

容器环境默认包含 004 event/lifecycle 基础 migration：

```bash
DB_MIGRATION_INCLUDE_004=true
```

只有确认不需要重复执行 004 时，才显式设置 `DB_MIGRATION_INCLUDE_004=false`。

为避免多副本同时启动产生 DDL 竞争，runner 会在执行 SQL 前获取 MySQL named lock：`wa_crm_v2_schema_migrations:<DB_NAME>`。`013_retention_external_archive_checks.sql` 的索引创建也已经改成 information_schema guard，支持每次重启重复执行。

我这里没有、也不会要求你提供 staging/prod 数据库凭据。因此当前仓库内能确认的是：

- 本地 MySQL 已验证 migration 004-013。
- 本地 schema analyzer 已验证期望表、实际表、列、索引一致。
- staging/prod 容器重启时会在目标 DB env 下执行 migration。
- 只有 migration 执行成功后，Node API 才会启动并处理线上历史达人派生状态 rebuild。

## 3. 推荐上线顺序

1. 在 staging/prod 执行数据库备份或确认回滚点。
2. 加载目标环境 DB env。
3. 重启容器镜像，让 entrypoint 自动执行 migration 004-013。
4. 执行 `node scripts/analyze-schema-state.js`，期望无 missing table、extra table、column diff、index diff。
5. 执行 `node scripts/run-retention-archive-jobs.cjs --dry-run`，只看归档/清理预览，不做 apply。
6. 部署本分支代码。
7. 重启 API 服务，观察 `[Startup][EventDerivedData] recompute done` 或 schema skip 日志。
8. 验证 CreatorDetail、EventPanel、stats、V1 board、reporting 的旧字段读取依赖是否仍能通过 snapshot/facts fallback 正常展示。

## 4. 本次上线后应该看到的行为

- 正向事件创建继续走 canonical `events`。
- 取消/清除事件状态走 canonical event cancel API，不再写旧 lifecycle 字段。
- 金额、进度、deadline 写入 `event_billing_facts`、`event_progress_facts`、`event_deadline_facts`。
- 列表、详情、stats、V1 board、reporting、lifecycle persistence、merge service 更优先读 `creator_event_snapshot` 和 operational facts。
- WA 1:1/group messages 的硬删除被外部归档校验 gate 阻止，直到 `data_retention_external_archive_checks` 存在 verified 且覆盖 cutoff 的记录。

## 5. 风险和回滚边界

- 如果 migration 未执行，API 可以启动，但启动 rebuild 会跳过，依赖新表的写入接口可能返回 schema readiness 错误。
- 如果 `DB_MIGRATE_ON_STARTUP=true` 且 migration 失败，entrypoint 会阻止 Node 服务启动，避免半迁移状态继续对外服务。
- 如果启动 rebuild 对线上压力过大，可以先设置 `STARTUP_EVENT_RECOMPUTE_MAX_CREATORS` 做 canary，或设置 `STARTUP_EVENT_RECOMPUTE_ENABLED=false` 临时关闭。
- 旧 deprecated 字段仍保留为兼容读 fallback，不建议在验证窗口结束前删除列。
- WA 消息硬删除必须先完成外部归档校验；没有 manifest sha256 和覆盖 cutoff 的 verified 记录时，不应执行 `--apply --purge`。

## 6. 仍需继续的工作

1. staging/prod 真实执行 migration 004-013。
2. migration 后在 staging/prod 跑 schema analyzer。
3. 重启 API 并确认启动 rebuild 日志。
4. 完成验证窗口后，继续缩小旧 `joinbrands_link.ev_*` 和 `wa_crm_data` deprecated 字段读取依赖。
5. 对历史聊天重新抽取 canonical events 如确实需要，应单独设计 backfill 窗口、成本控制和人工抽样校验。

## Obsidian Sync

- Status: synced
- Note: `docs/obsidian/notes/2026-04-27-mysql-optimize-prod-rollout-handoff.md`
- Index: `docs/obsidian/index.md`
