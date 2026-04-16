# 事件系统需求梳理

> **实施进度**：Phase 1 ✅ 已完成（2026-04-08）
> 数据库定义以 `schema.sql` 为准（历史 SQLite 迁移脚本已清理）
> 新建表：`events`、`event_periods`、`events_policy`

---

## 实施进度

| Phase | 任务 | 状态 |
|-------|------|------|
| Phase 1 | 创建 events + event_periods 表 | ✅ 完成 |
| Phase 2 | 后端 API（CRUD + 语义触发 + Bonus 判定）| ✅ 完成（2026-04-08）|
| Phase 3 | 前端 UI（事件面板 + 达人详情事件 Tab）| ✅ 完成（2026-04-08）|

---

---

## 一、核心数据结构

### 1.1 事件表 `events`（新建）

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | INTEGER | 主键 |
| `creator_id` | INTEGER | 关联达人 |
| `event_key` | TEXT | 事件唯一标识，如 `trial_7day`、`monthly_challenge`、`agency_bound` |
| `event_type` | TEXT | 事件大类：`challenge`、`gmv`、`referral`、`incentive_task` |
| `owner` | TEXT | 所属负责人（Beau / Yiyun）|
| `status` | TEXT | `active` / `completed` / `cancelled` |
| `trigger_source` | TEXT | `semantic_auto` / `manual` / `gmv_crosscheck` |
| `trigger_text` | TEXT | 触发时的原始语义文本 |
| `start_at` | DATETIME | 事件开始时间 |
| `end_at` | DATETIME | 事件结束时间（null=进行中）|
| `meta` | JSON | 事件特定数据，如 `{"weekly_video_target": 35, "bonus_per_video": 5}` |
| `created_at` | DATETIME | 记录创建时间 |

### 1.2 事件类型枚举

```javascript
EVENT_TYPES = {
  CHALLENGE: 'challenge',       // 挑战类（7日、月度）
  GMV: 'gmv',                   // GMV里程碑类
  REFERRAL: 'referral',         // 推荐新用户类
  INCENTIVE_TASK: 'incentive_task', // 单次激励任务（评论、视频、访谈）
  AGENCY: 'agency'              // Agency绑定（独立于挑战，可并行）
}
```

---

## 二、事件路由逻辑（按负责人分流）

### 2.1 路由核心原则

> **同一事件类型 + 不同负责人 = 不同判定逻辑 + 不同奖励规则**

每个负责人有独立的策略配置，系统根据 `creator.wa_owner` 路由到对应的策略处理器。

### 2.2 路由表结构

```javascript
const EVENT_ROUTER = {
  'Beau': {
    trial_7day: { ...BeauSpecific7DayRules },
    monthly_challenge: { ...BeauSpecificMonthlyRules },
    agency_bound: { ...BeauAgencyRules },
  },
  'Yiyun': {
    trial_7day: { ...YiyunSpecific7DayRules },
    monthly_challenge: { ...YiyunSpecificMonthlyRules },
    agency_bound: { ...YiyunAgencyRules },
  }
}
```

---

## 三、各事件详细逻辑

### 3.1 7日挑战（trial_7day / 7日挑战）

**触发语义关键词（中英双语）：**
- `trial`, `7day`, `7-day`, `free challenge`, `7天挑战`, `试用挑战`, `加入挑战`
- 识别到后 **自动创建** 事件记录（`trigger_source: 'semantic_auto'`），同时需要 **手动确认**（运营点击确认后 status 变为 `active`）

**核心判定逻辑（以周为周期）：**

| 发布条数 | Bonus |
|----------|-------|
| ≥ 35 条/周 | Bonus = 条数 × 单价（单价由负责人配置）|
| < 35 条/周 | 无 Bonus |

**事件结束条件：**
- 手动标记结束
- 超过规定周期未达成

**跨平台核对：**
- 语义识别到"发了X条"时，尝试从 TikTok/Instagram 等平台交叉核对实际发布数

---

### 3.2 月度挑战（monthly_challenge / 月度挑战）

**触发语义关键词：**
- `monthly challenge`, `monthly`, `月度挑战`, `包月任务`, `每月挑战`

**核心判定逻辑（以周为周期，和7日逻辑基本一致，但周期不同）：**

| 发布条数 | Bonus |
|----------|-------|
| ≥ 目标条数/周 | Bonus = 条数 × 单价 |
| < 目标条数/周 | 无 Bonus |

**跨平台核对：** 同 7 日挑战

---

### 3.3 Agency 绑定（agency_bound）

**触发语义关键词：**
- `agency`, `bound`, `signed`, `contract`, `签约`, `绑定机构`, `mcn`, `代理`

**核心逻辑：**
- **独立于挑战，可并行存在**
- 通常在 7 日挑战之后触发
- 绑定后解锁 **GMV 激励任务** 和 **推荐激励任务**

---

### 3.4 GMV 里程碑事件（gmv_milestone）

**触发方式：** 以 `keeper_link` 表的 GMV 数据为准，非语义触发（`trigger_source: 'gmv_crosscheck'`）

**Beau 规则（GMV 阶梯奖励）：**

| GMV 里程碑 | 奖励 |
|------------|------|
| ≥ $1,000 | 解锁额外 50% 佣金（需满足 35 video/week 条件）|
| ≥ $5,000 | $100 现金 |
| ≥ $10,000 | 额外 $120 |
| ≥ $20,000 | 额外 $200 |

**incentive_tasks（GMV 达到后解锁的单次任务）：**

| 任务 | 奖励 | 触发条件 |
|------|------|---------|
| 发布 35 条视频/周 | 解锁额外 50% 佣金 | GMV < $1K 时持续有效 |
| 达到 $5,000 GMV | $100 现金 | 达到即解锁 |
| 达到 $10,000 GMV | $120 现金 | 累积 |
| 达到 $20,000 GMV | $200 现金 | 累积 |

**Yiyun 规则：** 待补充（按负责人配置）

---

### 3.5 推荐新用户事件（referral）

**触发语义关键词：**
- `invite`, `refer`, `推荐`, `介绍`, `新人`, `creator joined`

**奖励规则（Monthly Incentive Tasks for Agency Users）：**

| 推荐人数 | 每人奖励 |
|----------|---------|
| 1 – 10 人 | $10/人 |
| 11 人及以上 | $15/人 |

**附加激励：**
- 每个 Moras App Store 评价 → $5
- 提交 1 分钟 Moras 产品推荐视频（申请制）→ $100
- 深度访谈（产品迭代方向，申请制）→ $100

---

## 四、语义自动识别流程

```
用户发送消息
       ↓
  inferScene() 场景判断
       ↓
  检测到事件关键词？
       ↓
  是 → 自动创建事件草稿（status: pending_confirmation）
       ↓
  运营在事件管理面板确认 → status: active
       ↓
  每周/月自动判定 Bonus
```

**自动识别优先级：**
1. 挑战加入意图 → 创建 `trial_7day` / `monthly_challenge` 待确认事件
2. 绑定意图 → 创建 `agency_bound` 待确认事件
3. GMV 达到 → 自动创建 `gmv_milestone`（无需确认，直接激活）
4. 推荐意图 → 创建 `referral` 待确认事件

---

## 五、负责人策略配置结构

```javascript
const OWNER_POLICY = {
  Beau: {
    challenges: {
      trial_7day: {
        weekly_target: 35,
        bonus_per_video: 5,       // $5/条
        currency: 'USD',
        crosscheck_platforms: ['tiktok', 'instagram']
      },
      monthly: {
        weekly_target: 35,
        bonus_per_video: 5,
      }
    },
    gmv_milestones: [
      { threshold: 1000, reward_type: 'commission_boost', value: 0.5, condition: 'weekly_video >= 35' },
      { threshold: 5000, reward_type: 'cash', value: 100 },
      { threshold: 10000, reward_type: 'cash', value: 120 },
      { threshold: 20000, reward_type: 'cash', value: 200 },
    ],
    referral_tiers: [
      { min: 1, max: 10, reward: 10 },
      { min: 11, max: Infinity, reward: 15 },
    ],
    incentive_tasks: {
      app_review: 5,
      video_referral: 100,
      interview: 100,
    }
  },
  Yiyun: {
    // 同上结构，参数待定
  }
}
```

---

## 六、数据流总览

```
语义输入（消息）
      ↓
┌─────────────────────────────────┐
│  事件语义识别引擎（inferScene）   │
│  → 识别事件类型 + 负责人路由      │
└─────────────────────────────────┘
      ↓
  事件草稿（pending）
      ↓
  运营确认（active）
      ↓
┌─────────────────────────────────┐
│  事件判定引擎（按负责人策略）      │
│  → 周期待计算 + Bonus 计算       │
└─────────────────────────────────┘
      ↓
  事件状态更新（completed）
      ↓
  触发奖励发放记录
```

---

## 七、后续扩展方向

1. **跨平台自动核对**：接入 TikTok/Instagram API，语义识别到"发了视频"时自动对比实际发布数
2. **事件自动收尾**：周期结束自动判定结果，运营一键确认
3. **事件历史追溯**：每条事件记录可查看完整的触发文本、确认时间、Bonus 判定结果

---

## 八、已实施内容（2026-04-08）

### Phase 1 ✅ 完成

**落地方式**：表结构已并入 `schema.sql`

**新建表**：

#### `events` 表
存储每个达人的事件实例。

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | INTEGER | 主键 |
| `creator_id` | INTEGER FK | 关联达人 |
| `event_key` | TEXT | 事件标识（trial_7day / monthly_challenge / agency_bound）|
| `event_type` | TEXT | 事件大类（challenge / gmv / referral / incentive_task / agency）|
| `owner` | TEXT | Beau / Yiyun |
| `status` | TEXT | pending / active / completed / cancelled |
| `trigger_source` | TEXT | semantic_auto / manual / gmv_crosscheck |
| `trigger_text` | TEXT | 触发时的原始语义文本 |
| `start_at` | DATETIME | 事件开始时间 |
| `end_at` | DATETIME | 事件结束时间 |
| `meta` | TEXT | JSON，事件特定配置 |
| `created_at` | DATETIME | 创建时间 |
| `updated_at` | DATETIME | 更新时间 |

**索引**：
- `idx_events_creator`：按 creator_id 查询
- `idx_events_status`：按 status 筛选
- `idx_events_owner`：按负责人分流
- `idx_events_unique_active`：同一达人同一事件只能有一个 active（唯一约束）

#### `event_periods` 表
存储每个事件的周期判定记录（每周 Bonus 计算结果）。

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | INTEGER | 主键 |
| `event_id` | INTEGER FK | 关联事件 |
| `period_start` | DATETIME | 周期开始 |
| `period_end` | DATETIME | 周期结束 |
| `video_count` | INTEGER | 实际发布数 |
| `bonus_earned` | REAL | 本周期奖励金额 |
| `status` | TEXT | pending / settled |
| `meta` | TEXT | JSON，跨平台核对结果等 |
| `created_at` | DATETIME | 创建时间 |
| `updated_at` | DATETIME | 更新时间 |

#### `events_policy` 表
存储每个负责人的事件策略配置。

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | INTEGER | 主键 |
| `owner` | TEXT | Beau / Yiyun |
| `event_key` | TEXT | 事件标识 |
| `policy_json` | TEXT | JSON 配置 |
| `created_at` | DATETIME | 创建时间 |
| `updated_at` | DATETIME | 更新时间 |

**已写入 Beau 策略**：
- `trial_7day`：`weekly_target: 35`, `bonus_per_video: $5`, `max_periods: 4`
- `monthly_challenge`：`weekly_target: 35`, `bonus_per_video: $5`, `max_periods: 12`
- `agency_bound`：`parallel_with_challenge: true`（可与挑战并行）

### Phase 2 ✅ 完成（2026-04-08）

**`server/index.cjs` 注册端点（实现位于 `server/routes/events.js`）：**

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/events` | 事件列表（支持 status/owner/creator_id/event_key 筛选）|
| `GET` | `/api/events/:id` | 事件详情（含策略 + 周期记录）|
| `POST` | `/api/events` | 创建事件（自动拒绝重复 active）|
| `PATCH` | `/api/events/:id` | 更新事件状态/结束时间/meta |
| `DELETE` | `/api/events/:id` | 删除事件（仅 pending）|
| `POST` | `/api/events/detect` | 语义自动检测（关键词匹配 + GMV 识别）|
| `GET` | `/api/events/:id/periods` | 获取周期记录 |
| `POST` | `/api/events/:id/judge` | Bonus 周期判定（按周计算）|
| `POST` | `/api/events/gmv-check` | GMV 里程碑批量核对 |
| `GET` | `/api/events/summary/:creatorId` | 达人事件汇总 |
| `GET` | `/api/events/policy/:owner/:eventKey` | 读取策略配置 |

### Phase 3 ✅ 完成（2026-04-08）

**前端新增组件：**

| 组件 | 路径 | 说明 |
|------|------|------|
| `EventPanel` | `src/components/EventPanel.jsx` | 事件管理面板，含列表筛选 + 详情侧栏 + 创建弹窗 + Bonus 判定 |

**集成位置：**

| 位置 | 说明 |
|------|------|
| `App.jsx` 桌面顶部栏 | 新增「事件」Tab，切换到 EventPanel |
| `App.jsx` CreatorDetail | 新增 `CreatorEventsSection`，展示达人事件汇总 |

**EventPanel 功能：**
- 事件列表（status/owner/event_key 多条件筛选）
- 事件详情侧栏（含策略、周期记录、判定结果）
- 新建事件弹窗（选择达人/事件类型/负责人/时间）
- 状态操作（pending→active/completed/cancelled）
- Bonus 快速判定（输入视频数→即时显示结果）

**待后续实现：**
- 语义触发 toast 提示
- 跨平台发布数自动核对
