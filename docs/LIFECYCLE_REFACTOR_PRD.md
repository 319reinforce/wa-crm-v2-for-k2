# 生命周期重构 PRD

副标题：别让 `beta_status` 一人分饰三角

## 1. 文档信息

- 文档名称：WA CRM v2 生命周期重构 PRD
- 目标系统：`wa-crm-v2`
- 输出用途：统一 v2 生命周期内核、前端口径、AI 动作语义，并为 v1 驾驶舱重构提供稳定接口
- 当前状态：可研发开工版本
- 文档日期：2026-04-14

---

## 2. 一句话结论

本次重构的目标不是“再加一个生命周期字段”，而是把三件事彻底拆开：

- 事实层：发生了什么
- 状态层：达人现在处在哪个主阶段
- 动作层：运营下一步该做什么

重构完成后：

- 全局主阶段只认 `lifecycle.stage_key`
- `beta_status` 回归 Beta 子流程字段
- `referral` 改为平行徽章，不再抢主阶段
- 生命周期历史不再靠 `audit_log` 猜，而是有显式快照和迁移表
- 前端、AI、Option0、批量动作全部使用同一套生命周期结果

---

## 3. 背景与现状

当前 v2 已经具备生命周期相关能力：

- 后端已有生命周期计算器：`server/services/lifecycleService.js`
- 前端已有生命周期标签与筛选：`src/App.jsx`、`src/mobile/MobileListScreen.jsx`
- 事件 CRUD 会触发生命周期重算：`server/routes/events.js`
- 达人资料更新会触发生命周期重算：`server/routes/creators.js`
- 生命周期配置面板已存在：`src/components/LifecycleConfigPanel.jsx`

但当前实现仍然处于“多主语并存”的状态：

- `beta_status` 和 `lifecycle.stage_key` 同时承担阶段语义
- `referral` 被设计成主阶段，和 `revenue` 主线冲突
- 生命周期配置项里存在“看起来可配、实际上不生效”的规则
- 生命周期历史仍主要依赖 `audit_log` 反推
- 事件事实、兼容快照字段、运营状态字段仍互相反写

结果是：

- 运营会误以为 `beta_status` 和生命周期是同一件事
- 列表筛选、移动端筛选、详情页展示口径不一致
- AI prompt 里还会把 `beta_status` 当成 `conversion_stage`
- 后续做漏斗、复盘、SLA、冲突告警会越来越脆

---

## 4. 当前最关键的 5 个问题

### 4.1 `beta_status` 和 `lifecycle.stage_key` 双主语并存

问题：

- 前端仍保留两套筛选语义
- `beta_status` 看起来像“阶段”
- `lifecycle.stage_key` 又被当成新的“阶段”

影响：

- 运营误以为两者等价
- 列表和移动端展示不统一
- v1 适配层无法建立唯一主语

当前涉及位置：

- `src/App.jsx`
- `src/mobile/MobileListScreen.jsx`

### 4.2 `agency_bound_mainline` 是假配置

问题：

- 配置层和前端面板都暴露了 `agency_bound_mainline`
- 但生命周期主判定链路没有真正消费这个配置
- 结果 `rule_flags.agency_bound_mainline` 仍被写死成 `true`

影响：

- 运营会以为自己改了规则
- 实际生命周期不变
- 配置面板失去可信度

当前涉及位置：

- `server/services/lifecycleConfigService.js`
- `src/components/LifecycleConfigPanel.jsx`
- `server/services/lifecycleService.js`

### 4.3 `referral` 被错误建模为主阶段

问题：

- 推荐行为是横切能力，不是主线关系阶段
- 一个已进入 `revenue` 的达人可能同时具备 referral 行为

影响：

- 会出现“Revenue 被 Referral 覆盖”的语义错误
- 运营会误判达人当前主线位置

当前涉及位置：

- `server/services/lifecycleService.js`
- `src/App.jsx`
- `src/mobile/MobileListScreen.jsx`

### 4.4 生命周期历史靠 `audit_log` 反推

问题：

- 当前详情历史主要是从 `audit_log` 推断生命周期变化
- `audit_log` 适合审计，不适合产品主视图

影响：

- 难以做漏斗统计
- 难以做迁移复盘
- 难以做“为什么变化”的稳定解释

当前涉及位置：

- `server/routes/creators.js`

### 4.5 事实层和状态层还在硬耦合

问题：

- 例如 `ev_churned` 会反写 `beta_status='churned'`
- 说明“事实字段”和“业务状态字段”没有彻底拆开

影响：

- 历史数据语义漂移
- 未来回溯时无法分清“真实发生了什么”和“系统后来怎么算的”

当前涉及位置：

- `server/routes/creators.js`

---

## 5. 重构目标

### 5.1 目标

1. 建立唯一生命周期主模型，统一前后端口径
2. 让 `beta_status` 回归 Beta 子流程字段，不再承担全局生命周期语义
3. 让事件系统成为生命周期的标准事实输入
4. 让 `Option0`、AI 策略、next action、看板筛选都基于同一个生命周期结果
5. 建立显式生命周期快照和迁移表，支持回溯、复盘和漏斗统计
6. 为 v1 驾驶舱提供稳定、可长期复用的接口输出

### 5.2 非目标

1. 本期不重写全部 AI 回复系统
2. 本期不重构整个画像标签体系
3. 本期不删除所有旧字段
4. 本期不强制一次性废弃 `ev_*`

---

## 6. 设计原则

1. 唯一主语：全局主阶段只认 `lifecycle.stage_key`
2. 事实先行：事件、GMV、月费、Agency、Referral 都是事实，不直接等于阶段
3. 先拆语义，再做 UI：先定义清楚字段职责，再谈页面展示
4. 可追溯：每次阶段变化都必须能解释“为何变化”
5. 渐进迁移：保留兼容字段，但不再让它们承担主语角色
6. 配置真实生效：任何出现在后台面板中的规则，必须真正进入判定主链路；否则不展示

---

## 7. 生命周期目标架构

生命周期系统统一拆成三层：

### 7.1 事实层 Facts

事实层只回答“发生了什么”：

- `events`
- `wa_crm_data` 中的 Beta / 月费 / Agency 事实字段
- `joinbrands_link.ev_*` 快照字段
- `keeper_link` 中的 GMV / order / video 等业务事实
- 推荐来源与推荐行为事实

事实层禁止直接承担“主阶段”含义。

### 7.2 状态层 Lifecycle

状态层只回答：

- 当前达人属于哪个主阶段
- 是因为什么信号进入该阶段
- 当前阶段的运营目标是什么
- 当前阶段默认动作模板是什么
- 当前是否存在平行徽章和冲突告警

状态层统一输出：

- `lifecycle.stage_key`
- `lifecycle.stage_label`
- `lifecycle.entry_reason`
- `lifecycle.entry_signals`
- `lifecycle.option0`
- `lifecycle.flags`
- `lifecycle.conflicts`
- `lifecycle.snapshot_version`

### 7.3 动作层 Actions

动作层只消费状态层：

- `next_action`
- `Option0` 批量回填
- AI 回复策略
- 驾驶舱排序和提醒
- 超 SLA 推进提醒

---

## 8. 生命周期目标模型

### 8.1 主阶段

主阶段固定为 5 个：

1. `acquisition`：获取
2. `activation`：激活
3. `retention`：留存
4. `revenue`：收入
5. `terminated`：终止池

### 8.2 平行徽章

以下不再作为主阶段，而是平行维度：

- `referral_active`
- `agency_bound`
- `trial_active`
- `monthly_active`
- `gmv_tier`
- `churn_risk`
- `beta_visible`

### 8.3 本期业务口径

本期先采用以下业务收敛规则：

- `agency_bound` 是最核心主线信号
- `Revenue` 默认只要求 `agency_bound=true`
- `GMV > 2k` 先保留为增强信号和冲突检测条件
- 待业务后续统一录入 GMV 数据后，再启用严格门槛

因此本期默认配置为：

- `revenue_requires_gmv = false`
- `revenue_gmv_threshold = 2000`

---

## 9. 字段职责重定义

### 9.1 `lifecycle.stage_key`

定义：

- 达人当前唯一主生命周期阶段

规则：

- 列表、详情、移动端、AI、驾驶舱、批量 Option0 全部只认它
- 禁止前端再用 `beta_status + ev_*` 自己推生命周期

### 9.2 `wa_crm_data.beta_status`

定义：

- Beta 子流程进度字段，不再代表全局生命周期

建议枚举：

- `not_introduced`
- `introduced`
- `started`
- `joined`
- `churned`

使用范围：

- Beta 子流程筛选
- 生命周期输入信号之一
- Beta 子流程看板

禁止用途：

- 禁止直接映射为主生命周期阶段
- 禁止作为 AI 的主阶段字段

### 9.3 `wa_crm_data.agency_bound`

定义：

- Agency 绑定业务事实

使用范围：

- Revenue 主线核心输入
- Agency 子流程筛选
- 驾驶舱冲突校验

### 9.4 `wa_crm_data.monthly_fee_status`

定义：

- 月费支付事实

建议枚举：

- `pending`
- `paid`
- `overdue`
- `waived`

使用范围：

- Activation 辅助信号
- 财务/执行子流程筛选

### 9.5 `joinbrands_link.ev_*`

定义：

- 事实快照字段和兼容字段

本期策略：

- 保留用于兼容与列表徽章
- 长期由事件系统派生
- 不再直接承担主状态语义

### 9.6 `audit_log`

定义：

- 审计日志

使用范围：

- 操作追溯
- 问题排查

禁止用途：

- 不再作为生命周期历史的主数据源

---

## 10. 生命周期判定规则

### 10.1 输入事实

生命周期判定统一读取以下输入：

- `wa_crm_data.beta_status`
- `wa_crm_data.monthly_fee_status`
- `wa_crm_data.monthly_fee_deducted`
- `wa_crm_data.agency_bound`
- `wa_crm_data.next_action`
- `joinbrands_link.ev_trial_active`
- `joinbrands_link.ev_monthly_started`
- `joinbrands_link.ev_monthly_joined`
- `joinbrands_link.ev_agency_bound`
- `joinbrands_link.ev_churned`
- `joinbrands_link.ev_gmv_2k`
- `keeper_link.keeper_gmv`
- `events` 中 `active/completed` 的事实事件

### 10.2 判定优先级

主阶段采用固定优先级：

1. `terminated`
2. `revenue`
3. `retention`
4. `activation`
5. `acquisition`

`referral` 不参与主阶段优先级。

### 10.3 主阶段规则

#### `terminated`

命中任一：

- `ev_churned = true`
- `beta_status = churned`
- 存在 `events.event_key in ('churned', 'do_not_contact', 'opt_out')`
- `next_action` 明确表达“不继续联系”

#### `revenue`

命中：

- `agency_bound = true`
- 或 `ev_agency_bound = true`
- 或存在 `agency_bound` 的 `active/completed` 事件

并且：

- 当 `revenue_requires_gmv = false` 时，直接进入 `revenue`
- 当 `revenue_requires_gmv = true` 时，需要 `keeper_gmv >= revenue_gmv_threshold` 或等价 GMV 事件

说明：

- 本期默认采用宽松规则：`agency_bound` 即可进入 `revenue`

#### `retention`

命中任一持续执行信号：

- `ev_monthly_started = true`
- `ev_monthly_joined = true`
- `ev_gmv_2k = true`
- `keeper_gmv >= 2000`
- 存在 `monthly_challenge` 的 `active/completed` 事件

且未命中更高优先级阶段。

#### `activation`

命中首次价值动作：

- `ev_trial_active = true`
- `monthly_fee_status = paid`
- `monthly_fee_deducted = true`
- `beta_status in ('started', 'joined')`
- 存在 `trial_7day` 或 `monthly_challenge` 的 `active/completed` 事件

且未命中更高优先级阶段。

#### `acquisition`

其余默认进入：

- 已建联但未出现首次价值动作
- `beta_status in ('not_introduced', 'introduced')`

### 10.4 平行 flags

生命周期输出必须增加以下 flags：

- `flags.referral_active`
- `flags.agency_bound`
- `flags.trial_active`
- `flags.monthly_active`
- `flags.gmv_tier`
- `flags.churn_risk`
- `flags.beta_status`

### 10.5 冲突诊断

生命周期输出必须增加 `conflicts`，至少支持以下规则：

- `agency_bound=true` 但 `stage_key != revenue`
- `keeper_gmv >= threshold` 但 `stage_key in ('acquisition', 'activation')`
- `ev_churned=true` 但 `stage_key != terminated`
- `referral_active=true` 且主线仍停留 `acquisition`

---

## 11. `agency_bound_mainline` 处理原则

这是当前实现最容易误导运营的一项，必须收口。

本期方案：

- 产品口径上，`agency_bound` 固定为主线核心事实
- 不再允许“UI 可改、内核不生效”的假配置出现

建议落地方式二选一：

### 方案 A：本期固定为硬规则

- `agency_bound_mainline = true` 固定写入生命周期内核
- 配置面板不再展示这个开关
- 如未来需要实验，再恢复为内部开关

### 方案 B：保留为真实配置

- `buildLifecycle()` 必须显式消费 `agency_bound_mainline`
- `rule_flags.agency_bound_mainline` 必须返回真实生效值
- 配置面板文案必须解释该开关会如何影响 `revenue`

本 PRD 推荐：

- 采用方案 A

原因：

- 当前业务已明确 Agency 是主线核心，不适合作为运营侧即时开关
- 可以减少一个高风险假配置点

---

## 12. Referral 模型重定义

### 12.1 目标语义

`Referral` 不再是主阶段，而是平行能力和运营机会。

正确表达应为：

- `stage_key = revenue`
- `flags.referral_active = true`

而不是：

- `stage_key = referral`

### 12.2 对产品的影响

- 列表主阶段筛选不再出现“传播”
- 列表和详情页增加“推荐中”徽章
- 驾驶舱可提供“Revenue + Referral”交叉视图

### 12.3 对 Option0 的影响

- `referral` 不再有独立主阶段 Option0
- Referral 相关动作改为辅助建议模板，挂在 `flags.referral_active` 维度

---

## 13. 事件系统重构要求

### 13.1 当前问题

当前现实是：

- `/api/events/detect` 只做候选检测
- `/api/events` 直接创建 `active`
- 生命周期实际上已经在消费事件，但事件并未完成标准状态机

### 13.2 目标状态机

事件统一状态为：

- `draft`
- `active`
- `completed`
- `cancelled`

### 13.3 目标流程

1. 消息触发 `/api/events/detect`
2. 系统输出候选事件
3. 运营确认后创建 `draft`
4. 运营点击生效，进入 `active`
5. 目标达成后进入 `completed`
6. 误判或作废进入 `cancelled`

### 13.4 生命周期消费规则

生命周期只消费：

- `active`
- `completed`

生命周期不消费：

- `draft`
- `cancelled`

### 13.5 `ev_*` 与事件关系

短期策略：

- `ev_*` 保留为缓存与兼容快照
- 事件状态变化时允许同步刷新 `ev_*`

长期策略：

- `events` 成为主事实源
- `ev_*` 仅作为读优化和兼容字段

### 13.6 重要约束

- 事实层可以生成状态层
- 状态层禁止反写事实层语义
- 禁止再出现 `ev_churned -> beta_status='churned'` 这类逆向污染

---

## 14. 数据模型设计

### 14.1 新增表：`creator_lifecycle_snapshot`

用途：

- 保存当前达人生命周期当前态

建议字段：

| 字段 | 类型 | 说明 |
|------|------|------|
| `creator_id` | INTEGER UNIQUE | 达人 ID |
| `stage_key` | TEXT | 当前主阶段 |
| `stage_label` | TEXT | 当前主阶段文案 |
| `entry_reason` | TEXT | 当前阶段进入原因 |
| `entry_signals_json` | TEXT/JSON | 当前阶段触发信号 |
| `flags_json` | TEXT/JSON | 平行 flags |
| `conflicts_json` | TEXT/JSON | 冲突诊断结果 |
| `option0_key` | TEXT | 当前默认动作模板 key |
| `option0_label` | TEXT | 当前默认动作模板名 |
| `option0_next_action` | TEXT | 当前默认 next action 模板 |
| `snapshot_version` | TEXT | 当前判定器版本 |
| `trigger_type` | TEXT | 本次快照触发源 |
| `trigger_id` | TEXT | 触发记录 ID |
| `evaluated_at` | DATETIME | 最近评估时间 |
| `created_at` | DATETIME | 创建时间 |
| `updated_at` | DATETIME | 更新时间 |

### 14.2 新增表：`creator_lifecycle_transition`

用途：

- 显式记录阶段迁移历史

建议字段：

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | INTEGER PK | 主键 |
| `creator_id` | INTEGER | 达人 ID |
| `from_stage` | TEXT | 原阶段 |
| `to_stage` | TEXT | 新阶段 |
| `trigger_type` | TEXT | 触发类型，例如 `event_update` |
| `trigger_id` | TEXT | 触发记录 ID |
| `trigger_source` | TEXT | 来源，例如 `events` / `creators` / `cron_rebuild` |
| `reason` | TEXT | 阶段变化说明 |
| `signals_json` | TEXT/JSON | 命中的关键事实 |
| `flags_json` | TEXT/JSON | 当时 flags |
| `operator` | TEXT | 操作人或系统 |
| `created_at` | DATETIME | 迁移时间 |

### 14.3 现有表字段调整建议

#### `events`

建议调整：

- `status` 枚举补齐为 `draft/active/completed/cancelled`
- 保留现有结构，不本期大改表

#### `wa_crm_data`

建议调整：

- 明确保留 `beta_status`
- 明确保留 `agency_bound`
- 明确保留 `monthly_fee_status`
- 不再把这些字段作为主生命周期输出

#### `joinbrands_link`

建议调整：

- `ev_*` 保留
- 标注为事实快照字段
- 长期由事件系统派生

### 14.4 为什么不能继续依赖 `audit_log`

`audit_log` 只适合做审计，不适合做生命周期主数据，因为：

- 语义过宽
- before/after 结构不稳定
- 查询成本高
- 很难直接用于漏斗统计和产品看板

---

## 15. 接口变更清单

本节是研发可直接对照开发的接口清单。

### 15.1 `GET /api/creators`

现状：

- 已返回部分生命周期结果
- 同时仍允许用 `beta_status` 作为主筛选语义

改造后：

- 主阶段筛选只允许 `lifecycle_stage`
- `beta_status` 作为子流程筛选保留
- 返回结构标准化为：

```json
{
  "id": 123,
  "primary_name": "Creator A",
  "wacrm": {
    "beta_status": "introduced",
    "monthly_fee_status": "pending",
    "agency_bound": false,
    "next_action": "..."
  },
  "joinbrands": {
    "ev_trial_active": false,
    "ev_monthly_started": false,
    "ev_agency_bound": false,
    "ev_churned": false
  },
  "keeper": {
    "keeper_gmv": 0
  },
  "lifecycle": {
    "stage_key": "acquisition",
    "stage_label": "Acquisition（获取）",
    "entry_reason": "已建联但尚未进入首次价值动作。",
    "entry_signals": ["beta_status:introduced"],
    "flags": {
      "referral_active": false,
      "agency_bound": false,
      "trial_active": false,
      "monthly_active": false,
      "gmv_tier": "lt_2k"
    },
    "conflicts": [],
    "option0": {
      "key": "option0_acquisition",
      "label": "Option0｜7日体验引导",
      "next_action_template": "..."
    }
  },
  "events_badges": ["trial_7day"]
}
```

新增查询参数：

- `lifecycle_stage`
- `beta_status`
- `monthly_fee_status`
- `agency_bound`
- `event_key`
- `has_conflict`
- `referral_active`

约束：

- `beta_status` 不得再驱动主阶段 badge

### 15.2 `GET /api/creators/:id`

改造后要求：

- 返回完整 `lifecycle`
- 返回 `active_events`
- 返回 `completed_events`
- 返回 `lifecycle_snapshot`
- 返回 `lifecycle_conflicts`

### 15.3 新增 `GET /api/creators/:id/lifecycle`

用途：

- 读取当前达人生命周期快照

返回：

- 当前阶段
- 进入原因
- 平行 flags
- 当前 Option0
- 冲突告警
- 最近评估时间

### 15.4 `GET /api/creators/:id/lifecycle-history`

现状：

- 主要依赖 `audit_log`

改造后：

- 优先读取 `creator_lifecycle_transition`
- 若历史表尚未上线，可临时 fallback，但返回中必须标记 `source`

返回结构建议：

```json
{
  "source": "transition_table",
  "current_stage": "retention",
  "transitions": [
    {
      "id": 1,
      "from_stage": "activation",
      "to_stage": "retention",
      "trigger_type": "event_update",
      "trigger_id": 998,
      "reason": "monthly_challenge completed",
      "created_at": "2026-04-14T10:00:00Z"
    }
  ]
}
```

### 15.5 `GET /api/lifecycle-config`

改造后要求：

- 只返回真实生效的规则
- 若 `agency_bound_mainline` 本期固定为 true，则不再作为运营可编辑项暴露

### 15.6 `PUT /api/lifecycle-config`

改造后要求：

- 只允许编辑真实可生效项
- 本期建议仅保留：
  - `revenue_requires_gmv`
  - `revenue_gmv_threshold`

### 15.7 `POST /api/events/detect`

改造后要求：

- 仅返回候选事件，不落正式主状态
- 输出需包含：
  - `event_key`
  - `confidence`
  - `suggested_status=draft`
  - `reason`

### 15.8 `POST /api/events`

改造后要求：

- 支持 `status = draft`
- 支持 `status = active`
- 若来源于语义检测，默认写 `draft`
- 若为手工强建，可允许直接写 `active`

### 15.9 `PATCH /api/events/:id`

改造后要求：

- 支持状态流转：
  - `draft -> active`
  - `active -> completed`
  - `draft -> cancelled`
  - `active -> cancelled`

限制：

- 生命周期仅在进入 `active/completed/cancelled` 时重算

### 15.10 新增 `POST /api/lifecycle/rebuild`

用途：

- 对单人或全量达人执行生命周期重算

入参建议：

- `creator_ids`
- `dry_run`
- `write_snapshot`
- `write_transition`
- `reason`

### 15.11 新增 `GET /api/lifecycle/dashboard`

用途：

- 为“生命周期驾驶舱”提供聚合数据

返回建议：

- 各主阶段人数
- 各阶段卡点 Top N
- 冲突告警列表
- 超 SLA 列表
- Revenue + Referral 交叉分布

---

## 16. 前端筛选交互稿

本节定义新看板和现有列表页的统一交互语义。

### 16.1 总体原则

- 主阶段筛选和子流程筛选彻底分开
- 主阶段只单选
- 子流程和事实徽章允许多选
- 筛选语义对桌面端和移动端完全一致

### 16.2 列表页顶部筛选区

第一行：主阶段筛选

- 全部
- 获取
- 激活
- 留存
- 收入
- 终止池

规则：

- 单选
- 只对应 `lifecycle.stage_key`

第二行：子流程筛选

- Beta：`not_introduced / introduced / started / joined / churned`
- 月费：`pending / paid / overdue / waived`
- Agency：`bound / unbound`

规则：

- 同组内多选 OR
- 组与组之间 AND

第三行：平行徽章与事件筛选

- 推荐中
- 已绑定 Agency
- Trial 进行中
- Monthly 进行中
- GMV 2k+
- 流失风险
- 有冲突

规则：

- 多选 OR
- 与主阶段筛选 AND

### 16.3 列表项展示规则

每个达人列表项展示顺序：

1. 主阶段 badge
2. 平行 flags badge
3. 关键冲突 badge
4. Beta 子流程信息
5. 当前 Option0 摘要

示例：

- `Revenue`
- `推荐中`
- `已绑定 Agency`
- `Beta: joined`
- `冲突: GMV>2k 但未进入 Revenue`

### 16.4 详情页展示规则

详情页拆成四块：

1. 当前生命周期卡片
2. 平行 flags 与事实摘要
3. 生命周期历史时间线
4. 当前阶段默认动作和手工 next_action

当前生命周期卡片需要显示：

- 当前阶段
- 进入原因
- 触发信号
- 当前 Option0
- 是否有冲突

### 16.5 移动端筛选规则

移动端和桌面端保持同语义，不再单独创造“Beta 即阶段”的轻量逻辑。

移动端筛选面板分三组：

1. 主阶段
2. 子流程
3. 徽章与告警

### 16.6 生命周期驾驶舱页面草稿

新 tab 名称建议：

- 生命周期驾驶舱

页面模块：

1. 阶段人数总览
2. 各阶段卡住原因 Top N
3. 超 SLA 未推进列表
4. 冲突告警列表
5. `Revenue + Referral` 交叉分布
6. `Agency bound but not revenue` 异常池

---

## 17. AI、Option0 与 next_action 规则

### 17.1 `Option0` 的角色

`Option0` 成为阶段默认动作模板，不再由 `beta_status` 决定。

### 17.2 `next_action` 优先级

优先级固定为：

1. 人工明确填写的 `next_action`
2. 当前 `lifecycle.option0`
3. AI 辅助生成建议

### 17.3 AI prompt 规则

AI 构建 prompt 时只读：

- `lifecycle.stage_key`
- `lifecycle.stage_label`
- `lifecycle.flags`
- `active/completed events`
- `wacrm.beta_status` 作为 Beta 子流程补充语义

AI 不再允许：

- 把 `beta_status` 填进 `conversion_stage`
- 用 `referral` 代替主阶段

### 17.4 Referral 动作模板

Referral 不再对应单独主阶段 Option0。

推荐动作应作为：

- `flags.referral_active=true` 时的辅助模板
- 或驾驶舱中的推荐任务建议

---

## 18. v1 驾驶舱适配要求

v1 重构后只消费以下稳定字段：

- `lifecycle.stage_key`
- `lifecycle.stage_label`
- `lifecycle.entry_reason`
- `lifecycle.option0`
- `lifecycle.flags`
- `lifecycle.conflicts`
- `wacrm.beta_status`
- `wacrm.monthly_fee_status`
- `wacrm.agency_bound`
- `events_badges`

禁止：

- v1 前端自行用 `beta_status + ev_*` 再推生命周期

---

## 19. 迁移方案

### Phase 1：口径冻结

产出：

- 冻结主阶段枚举
- 冻结字段职责
- 冻结前端展示口径

实施项：

- 明确 `beta_status` 是子流程字段
- 明确 `referral` 改为 flag
- 明确 `agency_bound` 是 Revenue 主线核心事实

### Phase 2：生命周期内核收口

产出：

- 新版 `buildLifecycle()`
- 冲突诊断输出
- 新版 `lifecycle.flags`

实施项：

- 去掉 `referral` 主阶段
- 统一主阶段优先级
- 清理 `rule_flags` 假配置
- 调整 `Option0` 输出语义

### Phase 3：前端语义统一

产出：

- 列表、详情、移动端统一生命周期展示

实施项：

- 主筛选只认 `lifecycle.stage_key`
- `beta_status` 移入子流程筛选
- Referral 改为徽章
- 增加冲突告警展示

### Phase 4：生命周期持久化

产出：

- `creator_lifecycle_snapshot`
- `creator_lifecycle_transition`

实施项：

- 生命周期重算时写快照
- 阶段变化时写迁移表
- 历史接口改读迁移表

### Phase 5：事件状态机补全

产出：

- 标准事件状态机

实施项：

- 补齐 `draft/active/completed/cancelled`
- 规范检测到激活的人工确认流
- 生命周期仅消费 `active/completed`

### Phase 6：存量数据重算与运营迁移

产出：

- 一次性重算脚本
- 冲突清单
- 运营口径迁移文档

实施项：

- 全量补 lifecycle snapshot
- 标记高风险异常达人
- 对齐运营培训文案

---

## 20. 给研发直接开工的任务拆解列表

本节按研发实施顺序拆成可执行任务。

### 20.1 后端内核

任务 1：

- 重构 `server/services/lifecycleService.js`
- 移除 `referral` 主阶段
- 输出 `flags` 和 `conflicts`
- 明确 `revenue_requires_gmv` 的真实生效逻辑

任务 2：

- 收口 `agency_bound_mainline`
- 若采用固定方案，则移出配置面板并从配置服务中降级
- 若采用真实配置方案，则完整接入判定主链路

任务 3：

- 统一 `buildLifecycle()` 的输入映射
- 只消费 `active/completed` 事件
- 禁止状态反写事实

### 20.2 生命周期持久化

任务 4：

- 增加 `creator_lifecycle_snapshot` 表
- 增加 `creator_lifecycle_transition` 表

任务 5：

- 在事件更新、达人资料更新、批量重算时写 snapshot
- 若主阶段变化，写 transition

任务 6：

- 新增生命周期重算服务
- 支持单人重算和全量重算

### 20.3 API 改造

任务 7：

- 改造 `GET /api/creators`
- 增加标准化 `lifecycle` 输出
- 主筛选改为 `lifecycle_stage`

任务 8：

- 新增 `GET /api/creators/:id/lifecycle`
- 改造 `GET /api/creators/:id/lifecycle-history`

任务 9：

- 新增 `GET /api/lifecycle/dashboard`

任务 10：

- 改造 `POST /api/events`
- 改造 `PATCH /api/events/:id`
- 补齐 `draft/active/completed/cancelled`

### 20.4 前端改造

任务 11：

- 改造 `src/App.jsx`
- 主阶段筛选只看 `lifecycle.stage_key`
- `beta_status` 移到子流程筛选

任务 12：

- 改造 `src/mobile/MobileListScreen.jsx`
- 与桌面端统一筛选语义

任务 13：

- 改造详情页生命周期卡片
- 新增冲突告警块
- 新增生命周期历史时间线

任务 14：

- 新增生命周期驾驶舱页面

### 20.5 AI 与动作链路

任务 15：

- 替换所有将 `beta_status` 当 `conversion_stage` 的 prompt 构建逻辑
- 统一 AI 读取 `lifecycle.stage_key`

任务 16：

- 重构 `Option0` 模板映射
- Referral 从主阶段模板降为辅助模板

### 20.6 数据治理

任务 17：

- 编写一次性重算脚本
- 输出冲突达人清单

任务 18：

- 编写数据核对脚本
- 检查以下异常：
  - `agency_bound=true && stage_key!=revenue`
  - `ev_churned=true && stage_key!=terminated`
  - `GMV>=2k && stage_key in acquisition/activation`

### 20.7 测试

任务 19：

- 单元测试覆盖新版 `buildLifecycle()`

任务 20：

- 接口测试覆盖 lifecycle snapshot / history / dashboard

任务 21：

- 前端交互测试覆盖桌面端与移动端筛选一致性

任务 22：

- 回归测试覆盖：
  - 事件状态流转
  - Batch Option0
  - AI prompt 上下文

---

## 21. 逐模块开发方案

本节补齐“到底改哪些文件、每个模块怎么改、改完要输出什么”。

### 21.1 后端文件改造矩阵

| 文件 | 当前问题 | 改造目标 | 产出 |
|------|------|------|------|
| `server/services/lifecycleService.js` | `referral` 仍是主阶段；`agency_bound_mainline` 未真实生效；缺少 `conflicts` | 收口为唯一生命周期判定器 | 新版 `buildLifecycle()` |
| `server/services/lifecycleConfigService.js` | 暴露假配置 | 只保留真实可生效配置 | 收敛后的 config payload |
| `server/routes/lifecycle.js` | 配置接口还会返回误导项 | 返回真实规则；限制可写字段 | 新版 config API |
| `server/routes/creators.js` | 列表/详情/历史口径混合；历史依赖 `audit_log` | 接入 snapshot/transition；统一筛选与返回结构 | creators 主接口升级 |
| `server/routes/events.js` | 事件默认直接 `active`；缺少标准状态机 | 事件状态机补齐 | draft/active/completed/cancelled |
| `server/services/replyStrategyService.js` | 生命周期来源分散 | 统一读取 lifecycle snapshot | 稳定策略输入 |
| `server/services/retrievalService.js` | 仍把 `beta_status` 当 `conversion_stage` | 改为 `lifecycle.stage_key` | 检索上下文一致化 |
| `server/services/profileService.js` | 画像摘要仍读旧阶段 | 改为主阶段 + Beta 子流程双字段 | 画像文案一致化 |
| `server/routes/experience.js` | prompt 仍引用 `conversion_stage=beta_status` | 改为 lifecycle 主阶段 | Experience Router 对齐 |
| `server/routes/stats.js` | 目前统计偏 Beta 维度 | 增加 lifecycle 统计 | 驾驶舱基础聚合 |
| `db.js` | 尚无 lifecycle 专属读写接口 | 增加 snapshot/transition DAO | 生命周期持久化基础 |
| `schema.sql` | 尚无 lifecycle 两张表 | 增补 schema | 可迁移数据库结构 |

### 21.2 前端文件改造矩阵

| 文件 | 当前问题 | 改造目标 | 产出 |
|------|------|------|------|
| `src/App.jsx` | 主阶段筛选与 Beta 筛选并列；AI 入参仍塞 `conversion_stage=beta_status` | 主筛选只认 lifecycle；Beta 降级为子流程；AI 改读 lifecycle | 主列表统一口径 |
| `src/mobile/MobileListScreen.jsx` | 移动端仍同时保留 Beta 和 lifecycle 的轻量混合逻辑 | 与桌面端完全同语义 | 移动端统一筛选 |
| `src/components/CreatorDetail.jsx` | 生命周期展示信息不完整 | 展示主阶段、flags、冲突、历史、Option0 | 详情页生命周期卡 |
| `src/components/LifecycleConfigPanel.jsx` | 目前会展示假配置 | 收口为真实规则面板 | 可信配置面板 |
| `src/mobile/MobileChatScreen.jsx` | 仍传 `conversion_stage` | 改传 lifecycle 主阶段 | 移动聊天 AI 对齐 |
| `src/mobile/useApi.js` | detail 映射还以 Beta 为中心 | 标准化 lifecycle 字段 | 前端数据模型对齐 |

### 21.3 新增后端模块建议

建议新增以下服务，避免逻辑继续堆在路由文件：

#### `server/services/lifecycleRuntimeService.js`

职责：

- 读取 facts
- 调用 `buildLifecycle()`
- 统一组装 lifecycle payload

核心方法建议：

- `evaluateCreatorLifecycle({ creatorId, triggerType, triggerId, operator })`
- `evaluateLifecycleFromFacts(facts, options)`
- `collectLifecycleFacts(creatorId)`

#### `server/services/lifecyclePersistenceService.js`

职责：

- 写 `creator_lifecycle_snapshot`
- 写 `creator_lifecycle_transition`
- 判断是否发生阶段变化

核心方法建议：

- `upsertLifecycleSnapshot(payload)`
- `appendLifecycleTransition(payload)`
- `persistLifecycleEvaluation(result)`

#### `server/services/lifecycleDashboardService.js`

职责：

- 聚合驾驶舱指标
- 返回阶段分布、卡点、SLA、冲突

核心方法建议：

- `getLifecycleStageSummary(filters)`
- `getLifecycleConflictList(filters)`
- `getLifecycleSlaBacklog(filters)`

### 21.4 `lifecycleService.js` 详细改造方案

目标：

- 成为唯一生命周期状态机

具体改造：

1. 删除 `referral` 主阶段分支
2. 将 `referral` 改为 `flags.referral_active`
3. `buildLifecycle()` 增加输出：
   - `flags`
   - `conflicts`
   - `snapshot_version`
   - `primary_facts`
4. `rule_flags.agency_bound_mainline` 改为真实值，或直接删除该输出
5. `Option0` 模板只保留 5 个主阶段
6. 新增辅助方法：
   - `buildLifecycleFlags(signals, options)`
   - `buildLifecycleConflicts(signals, stageKey, options)`
   - `shouldEnterRevenue(signals, options)`

建议输出结构：

```json
{
  "stage_key": "revenue",
  "stage_label": "Revenue（收入）",
  "entry_reason": "已绑定 Agency，按当前规则进入收入阶段。",
  "entry_signals": ["agency_bound"],
  "flags": {
    "referral_active": true,
    "agency_bound": true,
    "trial_active": false,
    "monthly_active": true,
    "gmv_tier": "lt_2k",
    "beta_status": "joined"
  },
  "conflicts": [],
  "option0": { "...": "..." },
  "snapshot_version": "lifecycle_v2"
}
```

### 21.5 `creators.js` 详细改造方案

目标：

- creators 成为 lifecycle 的标准读取出口

具体改造：

1. 列表接口主筛选参数改为 `lifecycle_stage`
2. `beta_status` 保留，但仅用于子流程筛选
3. 详情接口增加：
   - `lifecycle_snapshot`
   - `lifecycle_history`
   - `lifecycle_conflicts`
4. `listLifecycleHistoryForCreator()` 改为：
   - 优先查 `creator_lifecycle_transition`
   - fallback `audit_log`
5. 删除或隔离所有“事实反写状态”逻辑
6. `batch-next-action` 继续保留，但只基于 `lifecycle.option0`

必须移除的旧逻辑：

- `ev_churned -> beta_status='churned'`

### 21.6 `events.js` 详细改造方案

目标：

- 从“事件 CRUD”升级为“事件状态机”

具体改造：

1. `POST /api/events` 支持传入 `status`
2. 若来源是 detect 结果，则默认创建 `draft`
3. `PATCH /api/events/:id` 校验合法状态流转
4. 事件流转后触发 lifecycle 重算与 snapshot 持久化
5. `DELETE /api/events/:id` 只允许 `draft`
6. 详情页与列表只消费 `active/completed`

建议增加状态流转校验表：

| from | to |
|------|------|
| `draft` | `active` |
| `draft` | `cancelled` |
| `active` | `completed` |
| `active` | `cancelled` |

### 21.7 AI 与策略链路详细改造方案

目标：

- 所有 AI 链路统一读取 lifecycle 主阶段

需要改造的链路：

1. `src/App.jsx`
2. `src/mobile/MobileChatScreen.jsx`
3. `server/routes/experience.js`
4. `server/services/retrievalService.js`
5. `server/services/profileService.js`
6. `server/services/replyStrategyService.js`

统一替换原则：

- 旧字段：
  - `conversion_stage`
  - `wc.beta_status as conversion_stage`
- 新字段：
  - `lifecycle_stage`
  - `lifecycle_label`
  - `beta_status` 仅作为补充上下文

AI prompt 标准上下文建议：

```json
{
  "creator_name": "Creator A",
  "lifecycle_stage": "activation",
  "lifecycle_label": "Activation（激活）",
  "beta_status": "started",
  "agency_bound": false,
  "lifecycle_flags": {
    "trial_active": true,
    "monthly_active": false,
    "referral_active": false
  },
  "next_action": "..."
}
```

### 21.8 驾驶舱详细开发方案

建议单独新增生命周期驾驶舱页面，而不是继续堆在现有字段统计页里。

后端：

- 新增 `GET /api/lifecycle/dashboard`
- 支持 owner、operator、stage、date_range 过滤

前端模块：

1. 阶段人数卡片
2. Stage 漏斗图
3. 卡点原因 Top N
4. 冲突告警列表
5. 超 SLA 待推进列表
6. Revenue + Referral 交叉矩阵

SLA 建议先写死在前端常量或后端默认配置：

- `acquisition > 3d 未推进`
- `activation > 2d 未推进`
- `retention > 7d 未推进`
- `revenue > 7d 未推进`

---

## 22. SQL Migration 草案

### 22.1 `creator_lifecycle_snapshot`

```sql
CREATE TABLE IF NOT EXISTS creator_lifecycle_snapshot (
    creator_id INTEGER PRIMARY KEY,
    stage_key TEXT NOT NULL,
    stage_label TEXT NOT NULL,
    entry_reason TEXT,
    entry_signals_json TEXT,
    flags_json TEXT,
    conflicts_json TEXT,
    option0_key TEXT,
    option0_label TEXT,
    option0_next_action TEXT,
    snapshot_version TEXT NOT NULL DEFAULT 'lifecycle_v2',
    trigger_type TEXT,
    trigger_id TEXT,
    evaluated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_lifecycle_snapshot_stage
ON creator_lifecycle_snapshot(stage_key);
```

### 22.2 `creator_lifecycle_transition`

```sql
CREATE TABLE IF NOT EXISTS creator_lifecycle_transition (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    creator_id INTEGER NOT NULL,
    from_stage TEXT,
    to_stage TEXT NOT NULL,
    trigger_type TEXT,
    trigger_id TEXT,
    trigger_source TEXT,
    reason TEXT,
    signals_json TEXT,
    flags_json TEXT,
    operator TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_lifecycle_transition_creator_time
ON creator_lifecycle_transition(creator_id, created_at DESC);
```

### 22.3 `events.status` 枚举收敛

如果当前库没有约束，可直接以应用层先收口；若已有约束，建议迁移为：

```sql
-- SQLite 场景下通常先做应用层校验，必要时通过 rebuild table 升级
-- 允许值：draft / active / completed / cancelled
```

### 22.4 回填脚本草案

建议新增脚本：

- `scripts/rebuild-lifecycle-snapshots.cjs`
- `scripts/check-lifecycle-conflicts.cjs`

`rebuild-lifecycle-snapshots.cjs` 功能：

1. 扫描所有 creator
2. 收集 facts
3. 计算 lifecycle
4. 写 snapshot
5. 若阶段变化则写 transition

---

## 23. 接口契约样例

### 23.1 `GET /api/creators?lifecycle_stage=revenue&referral_active=1`

响应样例：

```json
{
  "items": [
    {
      "id": 1082,
      "primary_name": "Angel",
      "wacrm": {
        "beta_status": "joined",
        "monthly_fee_status": "paid",
        "agency_bound": true,
        "next_action": "..."
      },
      "lifecycle": {
        "stage_key": "revenue",
        "stage_label": "Revenue（收入）",
        "entry_reason": "已绑定 Agency，按当前规则进入收入阶段。",
        "entry_signals": ["agency_bound"],
        "flags": {
          "referral_active": true,
          "agency_bound": true,
          "trial_active": false,
          "monthly_active": true,
          "gmv_tier": "lt_2k",
          "beta_status": "joined"
        },
        "conflicts": [],
        "option0": {
          "key": "option0_revenue",
          "label": "Option0｜绑定后变现推进",
          "next_action_template": "..."
        }
      }
    }
  ],
  "total": 1
}
```

### 23.2 `GET /api/creators/:id/lifecycle`

响应样例：

```json
{
  "creator_id": 1082,
  "snapshot_version": "lifecycle_v2",
  "stage_key": "revenue",
  "stage_label": "Revenue（收入）",
  "entry_reason": "已绑定 Agency，按当前规则进入收入阶段。",
  "entry_signals": ["agency_bound"],
  "flags": {
    "referral_active": true,
    "agency_bound": true,
    "trial_active": false,
    "monthly_active": true,
    "gmv_tier": "lt_2k",
    "beta_status": "joined"
  },
  "conflicts": [],
  "option0": {
    "key": "option0_revenue",
    "label": "Option0｜绑定后变现推进",
    "next_action_template": "..."
  },
  "evaluated_at": "2026-04-14T12:00:00Z"
}
```

### 23.3 `GET /api/creators/:id/lifecycle-history`

响应样例：

```json
{
  "source": "transition_table",
  "current_stage": "revenue",
  "current_label": "Revenue（收入）",
  "transitions": [
    {
      "id": 31,
      "from_stage": "activation",
      "to_stage": "retention",
      "trigger_type": "event_update",
      "trigger_id": "998",
      "trigger_source": "events",
      "reason": "monthly_challenge completed",
      "created_at": "2026-04-12T10:00:00Z"
    },
    {
      "id": 32,
      "from_stage": "retention",
      "to_stage": "revenue",
      "trigger_type": "creator_update",
      "trigger_id": "1082",
      "trigger_source": "creators",
      "reason": "agency_bound=true",
      "created_at": "2026-04-13T11:00:00Z"
    }
  ]
}
```

### 23.4 `POST /api/events`

请求样例：

```json
{
  "creator_id": 1082,
  "event_key": "trial_7day",
  "event_type": "trial",
  "owner": "Yiyun",
  "status": "draft",
  "trigger_source": "detect",
  "trigger_text": "I can try it this week"
}
```

### 23.5 `PATCH /api/events/:id`

请求样例：

```json
{
  "status": "active"
}
```

响应样例：

```json
{
  "ok": true,
  "event_status": "active",
  "lifecycle_before": "acquisition",
  "lifecycle_after": "activation",
  "lifecycle_changed": true
}
```

### 23.6 `POST /api/lifecycle/rebuild`

请求样例：

```json
{
  "creator_ids": [1082, 3317],
  "dry_run": false,
  "write_snapshot": true,
  "write_transition": true,
  "reason": "backfill_after_refactor"
}
```

---

## 24. 测试与验证方案

### 24.1 单元测试

新增或更新：

- `tests/lifecycleService.test.mjs`
- `tests/lifecycleConfigService.test.mjs`
- `tests/lifecyclePersistenceService.test.mjs`
- `tests/lifecycleDashboardService.test.mjs`

覆盖点：

1. `referral` 不再成为主阶段
2. `agency_bound` 可进入 `revenue`
3. `revenue_requires_gmv=true` 时严格生效
4. `draft` 事件不影响生命周期
5. `active/completed` 事件会推动生命周期
6. 冲突检测输出正确

### 24.2 接口测试

覆盖接口：

- `GET /api/creators`
- `GET /api/creators/:id`
- `GET /api/creators/:id/lifecycle`
- `GET /api/creators/:id/lifecycle-history`
- `GET /api/lifecycle-dashboard`
- `POST /api/events`
- `PATCH /api/events/:id`
- `POST /api/lifecycle/rebuild`

### 24.3 前端测试

桌面端：

1. 主筛选切换只影响 `lifecycle.stage_key`
2. `beta_status` 仅作用于子流程筛选
3. Referral 仅显示为 badge
4. 详情页能展示冲突和历史

移动端：

1. 与桌面端筛选逻辑一致
2. 生命周期 badge 与桌面端一致

### 24.4 真实数据冒烟

需要至少跑以下真实冒烟：

1. 手工创建 `draft event`
2. 将 `draft -> active`
3. 验证 lifecycle 是否按预期变化
4. 将 `active -> completed`
5. 验证 snapshot 与 transition 是否写入
6. 在列表、详情、移动端检查显示是否一致
7. 用真实 AI 生成验证 prompt 不再把 `beta_status` 当主阶段

### 24.5 数据校验脚本

建议在上线前和上线后都跑：

- `scripts/check-lifecycle-conflicts.cjs`
- `scripts/check-beta-vs-lifecycle-usage.cjs`

检查项：

- 是否仍有 `referral` 主阶段
- 是否存在 `agency_bound=true && stage_key!=revenue`
- 是否存在 prompt 上下文仍含 `conversion_stage=beta_status`

---

## 25. 上线方案与回滚方案

### 25.1 上线顺序

建议顺序：

1. 上数据库 migration
2. 上后端 lifecycle 内核
3. 回填 snapshot/transition
4. 上前端统一筛选与详情展示
5. 打开驾驶舱
6. 跑真实冒烟

### 25.2 灰度策略

建议分两段灰度：

第一段：

- 后端新 lifecycle 写 snapshot，但前端仍读旧展示

第二段：

- 前端切主阶段展示到新 lifecycle

### 25.3 回滚策略

如果新 lifecycle 出现大面积误判：

1. 前端先回退到旧展示逻辑
2. 保留新 snapshot/transition 表，不删数据
3. 后端将 lifecycle API 切回旧计算器
4. 用 `reason=rollback` 再跑一次修复重算

### 25.4 上线后观察指标

建议重点观察：

- lifecycle 为空的达人数量
- `agency_bound=true && stage_key!=revenue` 数量
- `referral` 主阶段数量，预期应为 0
- 生命周期冲突总数
- 批量 Option0 写入成功率
- AI 回复中主阶段字段错误率

---

## 26. 排期与依赖建议

### 26.1 推荐排期

建议拆成 4 个开发包：

包 1：生命周期内核与配置收口

- `lifecycleService`
- `lifecycleConfigService`
- `lifecycle.js`

包 2：持久化与事件状态机

- `schema.sql`
- `db.js`
- `events.js`
- `creators.js`

包 3：前端统一与驾驶舱

- `App.jsx`
- `MobileListScreen.jsx`
- `CreatorDetail.jsx`
- 驾驶舱新页面

包 4：AI 与动作链路

- `experience.js`
- `retrievalService.js`
- `profileService.js`
- `replyStrategyService.js`

### 26.2 依赖关系

强依赖顺序：

1. 先完成包 1
2. 再完成包 2
3. 然后做包 3
4. 最后做包 4

原因：

- 前端展示必须依赖稳定 lifecycle 输出
- AI 链路必须依赖稳定 lifecycle 字段契约

### 26.3 建议提交分组

建议最终按以下 commit 分组：

1. `feat: refactor lifecycle core and config semantics`
2. `feat: persist lifecycle snapshots and transitions`
3. `feat: align events state machine with lifecycle`
4. `feat: unify lifecycle filters across desktop and mobile`
5. `feat: align ai prompt context with lifecycle stage`
6. `test: cover lifecycle refactor flows`

---

## 27. 验收标准

### 21.1 数据一致性

1. 任一达人只会出现一个主阶段
2. `referral` 不再作为主阶段输出
3. 所有达人都可得到 `lifecycle.stage_key`
4. 能检测出关键事实和阶段的冲突

### 21.2 产品一致性

1. 桌面端和移动端主筛选一致
2. 主筛选只认 `lifecycle.stage_key`
3. `beta_status` 仅出现在子流程语义中
4. 详情页、列表页、驾驶舱展示同一生命周期口径

### 21.3 可追溯性

1. 可以查看当前阶段为什么成立
2. 可以查看阶段从哪变到哪
3. 可以查看触发来源是事件、资料更新还是系统重算

### 21.4 动作一致性

1. `Option0` 与当前主阶段一致
2. AI prompt 不再把 `beta_status` 当主阶段
3. Referral 只作为平行能力和辅助动作出现

---

## 28. 风险与注意事项

### 22.1 历史数据口径脏

已有数据可能存在：

- `beta_status=churned` 但没有 `ev_churned`
- `agency_bound=1` 但没有事件记录
- GMV 已达标但事件未补

应对方式：

- 必须提供全量重算脚本
- 必须产出冲突清单

### 22.2 运营习惯迁移

当前运营已经习惯把 `beta_status` 当“阶段”理解。

应对方式：

- 页面上明确分区显示“主阶段”和“Beta 子流程”
- 发布迁移说明

### 22.3 配置项误导风险

如果继续保留不生效配置，会让生命周期系统失去可信度。

应对方式：

- 任何 UI 可见开关，必须真实生效
- 否则直接移除

### 22.4 AI 链路兼容风险

当前不少 prompt 仍在用 `beta_status` 表达主阶段。

应对方式：

- 在重构阶段同步替换 prompt 上下文
- 通过真实生成样例做回归验证

---

## 29. 开放决策

1. `beta_status` 是否长期保留 `started` 和 `joined` 两个值，还是后续收敛
2. `agency_bound_mainline` 本期是否直接从配置面板移除
3. `churn_risk` 是否本期就作为正式 flag 上线
4. `ev_*` 长期是否完全由事件系统派生

---

## 30. 最终结论

这次生命周期重构的核心不是“做一个新字段”，而是重新规定：

- 谁是事实
- 谁是状态
- 谁是动作
- 谁是兼容字段

统一后系统应该满足：

- `beta_status` 下岗，回归 Beta 子流程字段
- `lifecycle.stage_key` 成为唯一主阶段
- `referral` 变成平行徽章
- 生命周期历史不再靠 `audit_log` 猜
- 驾驶舱不再是字段拼盘，而是状态机驾驶舱

一句话概括：

别让 `beta_status` 一人分饰三角。
