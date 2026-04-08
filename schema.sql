-- WA CRM v2 SQLite Schema
-- 达人统一身份存储

-- ============================================================
-- 达人主表（唯一数据源）
-- ============================================================
CREATE TABLE IF NOT EXISTS creators (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    primary_name    TEXT,                    -- 主要展示名
    wa_phone        TEXT UNIQUE,             -- WhatsApp电话（唯一标识）
    keeper_username TEXT UNIQUE,             -- Keeper用户名
    wa_owner        TEXT DEFAULT 'Beau',     -- 负责人 Beau/Yiyun
    source          TEXT DEFAULT 'unknown',  -- 数据来源 wa/keeper/joinbrands/manual
    is_active       INTEGER DEFAULT 1,       -- 是否活跃
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_creators_phone ON creators(wa_phone);
CREATE INDEX IF NOT EXISTS idx_creators_keeper ON creators(keeper_username);
CREATE INDEX IF NOT EXISTS idx_creators_owner ON creators(wa_owner);

-- ============================================================
-- 别名映射表（支持同一达人多身份查询）
-- ============================================================
CREATE TABLE IF NOT EXISTS creator_aliases (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    creator_id   INTEGER REFERENCES creators(id) ON DELETE CASCADE,
    alias_type   TEXT NOT NULL,  -- wa_phone | wa_name | keeper_user | tiktok | jb_name | email
    alias_value  TEXT NOT NULL,
    is_verified  INTEGER DEFAULT 0,  -- 是否已人工确认
    matched_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(alias_type, alias_value)
);

CREATE INDEX IF NOT EXISTS idx_aliases_creator ON creator_aliases(creator_id);
CREATE INDEX IF NOT EXISTS idx_aliases_lookup ON creator_aliases(alias_type, alias_value);

-- ============================================================
-- WA 消息表
-- ============================================================
CREATE TABLE IF NOT EXISTS wa_messages (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    creator_id  INTEGER REFERENCES creators(id) ON DELETE CASCADE,
    role        TEXT NOT NULL,               -- 'me' | 'user'
    text        TEXT,
    timestamp   INTEGER,                      -- Unix timestamp (ms)
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_messages_creator ON wa_messages(creator_id);
CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON wa_messages(timestamp);

-- ============================================================
-- WA CRM 扩展数据（事件状态）
-- ============================================================
CREATE TABLE IF NOT EXISTS wa_crm_data (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    creator_id          INTEGER UNIQUE REFERENCES creators(id) ON DELETE CASCADE,

    -- 事件状态
    priority            TEXT DEFAULT 'low',
    next_action        TEXT,

    -- 评分
    event_score         REAL DEFAULT 0,
    urgency_level       INTEGER DEFAULT 5,

    -- 月费状态
    monthly_fee_status  TEXT DEFAULT 'pending',
    monthly_fee_amount REAL DEFAULT 20,
    monthly_fee_deducted INTEGER DEFAULT 0,

    -- Beta状态
    beta_status         TEXT DEFAULT 'not_introduced',
    beta_cycle_start    INTEGER,
    beta_program_type   TEXT DEFAULT '20_day_beta',

    -- Agency绑定
    agency_bound        INTEGER DEFAULT 0,
    agency_bound_at     INTEGER,
    agency_deadline     INTEGER,

    -- 视频数
    video_count         INTEGER DEFAULT 0,
    video_target        INTEGER DEFAULT 35,
    video_last_checked  INTEGER,

    created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at          DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_crm_creator ON wa_crm_data(creator_id);

-- ============================================================
-- Keeper 系统关联
-- ============================================================
CREATE TABLE IF NOT EXISTS keeper_link (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    creator_id      INTEGER UNIQUE REFERENCES creators(id) ON DELETE CASCADE,

    keeper_username TEXT UNIQUE,
    keeper_gmv      REAL DEFAULT 0,
    keeper_gmv30    REAL DEFAULT 0,
    keeper_orders   INTEGER DEFAULT 0,
    keeper_videos   INTEGER DEFAULT 0,
    keeper_videos_posted INTEGER DEFAULT 0,
    keeper_videos_sold   INTEGER DEFAULT 0,
    keeper_card_rate     TEXT,
    keeper_order_rate    TEXT,

    keeper_reg_time      INTEGER,
    keeper_activate_time INTEGER,

    last_synced     DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_keeper_creator ON keeper_link(creator_id);
CREATE INDEX IF NOT EXISTS idx_keeper_username ON keeper_link(keeper_username);

-- ============================================================
-- JoinBrands 系统关联
-- ============================================================
CREATE TABLE IF NOT EXISTS joinbrands_link (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    creator_id      INTEGER UNIQUE REFERENCES creators(id) ON DELETE CASCADE,

    creator_name_jb TEXT,
    jb_gmv          REAL DEFAULT 0,
    jb_status       TEXT DEFAULT 'unknown',
    jb_priority     TEXT,
    jb_next_action  TEXT,
    last_message    INTEGER,
    days_since_msg  INTEGER DEFAULT 999,
    invite_code_jb  TEXT,

    -- 事件状态
    ev_joined          INTEGER DEFAULT 0,
    ev_ready_sent      INTEGER DEFAULT 0,
    ev_trial_7day      INTEGER DEFAULT 0,
    ev_monthly_invited INTEGER DEFAULT 0,
    ev_monthly_joined  INTEGER DEFAULT 0,
    ev_whatsapp_shared INTEGER DEFAULT 0,
    ev_gmv_1k          INTEGER DEFAULT 0,
    ev_gmv_3k          INTEGER DEFAULT 0,
    ev_gmv_10k         INTEGER DEFAULT 0,
    ev_agency_bound    INTEGER DEFAULT 0,
    ev_churned         INTEGER DEFAULT 0,

    last_synced     DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_jb_creator ON joinbrands_link(creator_id);

-- ============================================================
-- 手工匹配记录（优先级最高）
-- ============================================================
CREATE TABLE IF NOT EXISTS manual_match (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    creator_id      INTEGER REFERENCES creators(id) ON DELETE CASCADE,

    keeper_username TEXT,
    joinbrands_name TEXT,
    wa_phone        TEXT,

    matched_by      TEXT DEFAULT 'manual',
    matched_at      DATETIME DEFAULT CURRENT_TIMESTAMP,

    UNIQUE(keeper_username, joinbrands_name, wa_phone)
);

-- ============================================================
-- SFT Memory — 后置强化训练语料
-- ============================================================
CREATE TABLE IF NOT EXISTS sft_memory (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    model_opt1          TEXT,
    model_opt2          TEXT,
    human_selected      TEXT NOT NULL,
    human_output        TEXT NOT NULL,
    model_predicted     TEXT,
    model_rejected      TEXT,
    is_custom_input     INTEGER DEFAULT 0,
    human_reason        TEXT,
    context_json        TEXT,
    status              TEXT DEFAULT 'approved',
    created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
    reviewed_by         TEXT
);

CREATE INDEX IF NOT EXISTS idx_sft_created ON sft_memory(created_at);
CREATE INDEX IF NOT EXISTS idx_sft_status ON sft_memory(status);

-- SFT 去重字段（由应用层计算写入）
ALTER TABLE sft_memory ADD COLUMN input_text_hash TEXT;
ALTER TABLE sft_memory ADD COLUMN human_output_hash TEXT;
ALTER TABLE sft_memory ADD COLUMN created_date TEXT;  -- DATE(created_at)，存储为 YYYY-MM-DD 字符串

-- SFT 新增字段
ALTER TABLE sft_memory ADD COLUMN similarity INTEGER;
ALTER TABLE sft_memory ADD COLUMN scene TEXT;
ALTER TABLE sft_memory ADD COLUMN message_history TEXT;  -- JSON，前10轮对话
ALTER TABLE sft_memory ADD COLUMN system_prompt_version TEXT DEFAULT 'v1';

CREATE UNIQUE INDEX IF NOT EXISTS idx_sft_dedup ON sft_memory(
    client_id_hash,
    input_text_hash,
    human_output_hash,
    created_date
);

-- ============================================================
-- SFT Feedback — Skip/Reject/Edit 反馈记录
-- ============================================================
CREATE TABLE IF NOT EXISTS sft_feedback (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id      TEXT NOT NULL,
    feedback_type   TEXT NOT NULL,   -- 'skip' | 'reject' | 'edit'
    input_text     TEXT,
    opt1           TEXT,
    opt2           TEXT,
    final_output   TEXT,
    scene          TEXT,
    detail         TEXT,
    created_at     DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_feedback_type_scene ON sft_feedback(feedback_type, scene);
CREATE INDEX IF NOT EXISTS idx_feedback_client ON sft_feedback(client_id);

-- ============================================================
-- Client Memory — 客户单独记忆管理
-- ============================================================
CREATE TABLE IF NOT EXISTS client_memory (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id           TEXT NOT NULL,
    memory_type         TEXT NOT NULL,
    memory_key          TEXT,
    memory_value        TEXT,
    source_record_id    INTEGER,
    confidence          INTEGER DEFAULT 1,
    created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(client_id, memory_type, memory_key)
);

CREATE INDEX IF NOT EXISTS idx_cm_client ON client_memory(client_id);

-- ============================================================
-- Policy Documents — 政策文档与输出底线
-- ============================================================
CREATE TABLE IF NOT EXISTS policy_documents (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    policy_key          TEXT UNIQUE NOT NULL,
    policy_version      TEXT NOT NULL,
    policy_content      TEXT NOT NULL,
    applicable_scenarios TEXT,
    is_active           INTEGER DEFAULT 1,
    created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at          DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- 同步日志
-- ============================================================
CREATE TABLE IF NOT EXISTS sync_log (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    bot_name        TEXT NOT NULL,
    record_count    INTEGER,
    synced_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
    status          TEXT DEFAULT 'success',
    note            TEXT
);

-- ============================================================
-- 审计日志
-- ============================================================
CREATE TABLE IF NOT EXISTS audit_log (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    action          TEXT NOT NULL,              -- sft_create | policy_create | client_memory_update | etc.
    table_name      TEXT,
    record_id       INTEGER,
    operator        TEXT DEFAULT 'system',
    before_value    TEXT,
    after_value     TEXT,
    ip_address      TEXT,
    user_agent       TEXT,
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_log(action);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at);

-- ============================================================
-- Client Profiles — 客户独立画像（AI 调用时使用）
-- ============================================================
CREATE TABLE IF NOT EXISTS client_profiles (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id           TEXT UNIQUE NOT NULL,   -- wa_phone（隔离标识）
    summary             TEXT,                    -- AI 生成的画像简介
    tags                TEXT,                    -- JSON array: ["美妆", "高价值", "视频偏好"]
    tiktok_data        TEXT,                    -- JSON: {followers, avg_views, gmv}
    stage              TEXT,                    -- 当前阶段
    last_interaction   DATETIME,
    last_updated       DATETIME DEFAULT CURRENT_TIMESTAMP,
    created_at         DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_cp_client ON client_profiles(client_id);

-- ============================================================
-- Client Tags — 动态标签（多源标注）
-- ============================================================
CREATE TABLE IF NOT EXISTS client_tags (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id       TEXT NOT NULL,             -- wa_phone（隔离标识）
    tag             TEXT NOT NULL,             -- 标签名，如 "tone:formal"
    source          TEXT NOT NULL,             -- ai_extracted | sft_feedback | keeper_update | manual
    confidence      INTEGER DEFAULT 1,          -- 1-3 置信度
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(client_id, tag, source)
);

CREATE INDEX IF NOT EXISTS idx_ct_client ON client_tags(client_id);
CREATE INDEX IF NOT EXISTS idx_ct_tag ON client_tags(tag);

-- ============================================================
-- Operator Experiences — 不同 operator 的 AI 体验配置
-- ============================================================
CREATE TABLE IF NOT EXISTS operator_experiences (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    operator            TEXT UNIQUE NOT NULL,   -- 'Beau' | 'Yiyun' | 'WangYouKe'
    display_name        TEXT NOT NULL,
    description         TEXT,
    system_prompt_base  TEXT NOT NULL,           -- 基础 system prompt 模板
    scene_config        TEXT,                    -- JSON: scene → prompt fragment 映射
    forbidden_rules     TEXT,                    -- JSON array: 额外禁止规则
    is_active           INTEGER DEFAULT 1,
    priority            INTEGER DEFAULT 0,       -- 路由优先级
    created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at          DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_oe_operator ON operator_experiences(operator);

-- 预置 Beau/Yiyun 体验记录
INSERT OR IGNORE INTO operator_experiences (operator, display_name, description, system_prompt_base, scene_config, forbidden_rules, priority) VALUES
('Beau', 'Beau 的运营体验', 'Beau 专属话术体系，20天Beta计划，$200激励，DRIFTO MCN',
 '[BASE_PROMPT]

【Beau 专属规则】
- Monthly Beta Program：20天周期，$200激励，$10/天
- GMV里程碑庆祝：$5k / $10k GMV
- 违规$10补偿承诺
- 透明成本：$3/视频，$2100/月/人
- 多账号管理（Trial / Referral）
- DRIFTO MCN 解释：100%佣金先到 agency 再 PayPal 返还
- 签约期仅2个月，到期自动解除',
 '{"trial_intro":"重点介绍20天Beta计划，$200激励","beta_cycle_start":"结算时明确起始日期+激励金额","violation_appeal":"提供申诉模板，承诺$10补偿","mcn_binding":"解释DRIFTO结构，透明佣金流程","gmv_milestone":"祝贺+$5k/$10k数据刺激","content_request":"5个/天最佳，超6个TikTok降权"}',
 '["不提Yiyun的话术","不承诺Beta永久持续(around May正式发布)","不在MCN犹豫时给压力"]',
 1);

INSERT OR IGNORE INTO operator_experiences (operator, display_name, description, system_prompt_base, scene_config, forbidden_rules, priority) VALUES
('Yiyun', 'Yiyun 的运营体验', 'Yiyun 专属话术体系，7天试用，$20月费，保守回复策略',
 '[BASE_PROMPT]

【Yiyun 专属规则】
- 7天试用任务包，20 AI generations/day
- $20月费：从视频补贴扣除，当周不足$20则不扣除
- 付款周期：每周一结算
- 一问一答，不过度展开，不主动延伸
- 保守回复策略：不承诺具体日期，不说100%保证',
 '{"onboarding_invite":"发送邀请码+下载指引，强调无需拍摄/买样品","monthly_inquiry":"明确从补贴扣除，不预付","video_not_loading":"先道歉，给tech反馈","mcn_binding":"愿签发DRIFTO链接，保留20条/天+100%返还；不愿签只3条/天","payment_issue":"确认PayPal信息，告知周一~周三周期"}',
 '["不提Beta program","不说guarantee/definitely","不攻击其他MCN","不发超过3条连续消息","不在北京时间23:00后主动联系"]',
 2);

-- ============================================================
-- 视图: 达人完整信息
-- ============================================================
CREATE VIEW IF NOT EXISTS v_creator_full AS
SELECT
    c.id,
    c.primary_name,
    c.wa_phone,
    c.keeper_username,
    c.wa_owner,
    c.source,
    c.is_active,
    c.created_at,

    w.msg_count,
    w.last_active,
    w.last_message_text,

    k.keeper_gmv,
    k.keeper_gmv30,

    j.jb_status,
    j.jb_gmv,

    wc.priority,
    wc.next_action,
    wc.event_score,
    wc.urgency_level,
    wc.beta_status,
    wc.agency_bound

FROM creators c
LEFT JOIN (
    SELECT creator_id,
           COUNT(*) as msg_count,
           MAX(timestamp) as last_active,
           MAX(CASE WHEN role = 'user' THEN text END) as last_message_text
    FROM wa_messages
    GROUP BY creator_id
) w ON w.creator_id = c.id
LEFT JOIN keeper_link k ON k.creator_id = c.id
LEFT JOIN joinbrands_link j ON j.creator_id = c.id
LEFT JOIN wa_crm_data wc ON wc.creator_id = c.id;
