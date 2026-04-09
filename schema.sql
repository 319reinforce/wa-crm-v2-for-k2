-- WA CRM v2 MySQL Schema
-- 从 SQLite 迁移至 MySQL 9.x
-- 字符集：utf8mb4_unicode_ci

CREATE DATABASE IF NOT EXISTS wa_crm_v2 CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE wa_crm_v2;

-- ***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED***
-- 达人主表
-- ***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED***
CREATE TABLE IF NOT EXISTS creators (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    primary_name    TEXT,
    wa_phone        VARCHAR(32) NOT NULL UNIQUE COMMENT 'WhatsApp电话（唯一标识）',
    keeper_username VARCHAR(64) UNIQUE COMMENT 'Keeper用户名',
    wa_owner        VARCHAR(32) DEFAULT 'Beau' COMMENT '负责人 Beau/Yiyun',
    source          VARCHAR(32) DEFAULT 'unknown' COMMENT '数据来源',
    is_active       TINYINT(1) DEFAULT 1 COMMENT '是否活跃',
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX idx_creators_phone ON creators(wa_phone);
CREATE INDEX idx_creators_keeper ON creators(keeper_username);
CREATE INDEX idx_creators_owner ON creators(wa_owner);
CREATE INDEX idx_creators_is_active ON creators(is_active);
CREATE INDEX idx_creators_created_at ON creators(created_at);
CREATE INDEX idx_creators_owner_active ON creators(wa_owner, is_active);

-- ***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED***
-- 别名映射表
-- ***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED***
CREATE TABLE IF NOT EXISTS creator_aliases (
    id           INT AUTO_INCREMENT PRIMARY KEY,
    creator_id   INT NOT NULL,
    alias_type   VARCHAR(32) NOT NULL COMMENT 'wa_phone|wa_name|keeper_user|tiktok|jb_name|email',
    alias_value  VARCHAR(128) NOT NULL,
    is_verified  TINYINT(1) DEFAULT 0,
    matched_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uk_alias (alias_type, alias_value),
    FOREIGN KEY (creator_id) REFERENCES creators(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX idx_aliases_creator ON creator_aliases(creator_id);

-- ***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED***
-- WA 消息表
-- ***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED***
CREATE TABLE IF NOT EXISTS wa_messages (
    id          BIGINT AUTO_INCREMENT PRIMARY KEY,
    creator_id  INT NOT NULL,
    role        VARCHAR(16) NOT NULL COMMENT "'me'|'user'|'assistant'",
    operator    VARCHAR(32) DEFAULT NULL COMMENT "'Beau'|'Yiyun'|'WangYouKe'等",
    text        TEXT,
    timestamp   BIGINT COMMENT 'Unix timestamp (ms)',
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (creator_id) REFERENCES creators(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX idx_messages_creator ON wa_messages(creator_id);
CREATE INDEX idx_messages_timestamp ON wa_messages(timestamp);
CREATE UNIQUE INDEX idx_messages_dedup ON wa_messages(creator_id, timestamp);
CREATE INDEX idx_messages_creator_timestamp ON wa_messages(creator_id, timestamp DESC);

-- ***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED***
-- WA CRM 扩展数据
-- ***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED***
CREATE TABLE IF NOT EXISTS wa_crm_data (
    id                  INT AUTO_INCREMENT PRIMARY KEY,
    creator_id          INT NOT NULL UNIQUE,
    priority            VARCHAR(16) DEFAULT 'low',
    next_action         TEXT,
    event_score         DOUBLE DEFAULT 0,
    urgency_level       INT DEFAULT 5,
    monthly_fee_status  VARCHAR(32) DEFAULT 'pending',
    monthly_fee_amount  DOUBLE DEFAULT 20,
    monthly_fee_deducted INT DEFAULT 0,
    beta_status         VARCHAR(32) DEFAULT 'not_introduced',
    beta_cycle_start    BIGINT,
    beta_program_type   VARCHAR(32) DEFAULT '20_day_beta',
    agency_bound        TINYINT(1) DEFAULT 0,
    agency_bound_at     BIGINT,
    agency_deadline     BIGINT,
    video_count         INT DEFAULT 0,
    video_target        INT DEFAULT 35,
    video_last_checked  BIGINT,
    created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at          DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (creator_id) REFERENCES creators(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX idx_crm_creator ON wa_crm_data(creator_id);
CREATE INDEX idx_crm_priority ON wa_crm_data(priority);
CREATE INDEX idx_crm_urgency ON wa_crm_data(urgency_level);

-- ***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED***
-- Keeper 系统关联
-- ***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED***
CREATE TABLE IF NOT EXISTS keeper_link (
    id                  INT AUTO_INCREMENT PRIMARY KEY,
    creator_id          INT NOT NULL UNIQUE,
    keeper_username     VARCHAR(64) UNIQUE,
    keeper_gmv          DOUBLE DEFAULT 0,
    keeper_gmv30        DOUBLE DEFAULT 0,
    keeper_orders       INT DEFAULT 0,
    keeper_videos       INT DEFAULT 0,
    keeper_videos_posted INT DEFAULT 0,
    keeper_videos_sold  INT DEFAULT 0,
    keeper_card_rate    VARCHAR(16),
    keeper_order_rate   VARCHAR(16),
    keeper_reg_time     BIGINT,
    keeper_activate_time BIGINT,
    last_synced         DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (creator_id) REFERENCES creators(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX idx_keeper_creator ON keeper_link(creator_id);
CREATE INDEX idx_keeper_username ON keeper_link(keeper_username);

-- ***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED***
-- JoinBrands 系统关联
-- ***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED***
CREATE TABLE IF NOT EXISTS joinbrands_link (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    creator_id      INT NOT NULL UNIQUE,
    creator_name_jb VARCHAR(128),
    jb_gmv          DOUBLE DEFAULT 0,
    jb_status       VARCHAR(32) DEFAULT 'unknown',
    jb_priority     VARCHAR(32),
    jb_next_action  TEXT,
    last_message    BIGINT,
    days_since_msg  INT DEFAULT 999,
    invite_code_jb  VARCHAR(64),
    ev_joined       TINYINT(1) DEFAULT 0,
    ev_ready_sent   TINYINT(1) DEFAULT 0,
    ev_trial_7day   TINYINT(1) DEFAULT 0 COMMENT '旧字段，兼容',
    ev_trial_active TINYINT(1) DEFAULT 0,
    ev_monthly_started TINYINT(1) DEFAULT 0,
    ev_monthly_invited TINYINT(1) DEFAULT 0,
    ev_monthly_joined  TINYINT(1) DEFAULT 0,
    ev_whatsapp_shared TINYINT(1) DEFAULT 0,
    ev_gmv_1k       TINYINT(1) DEFAULT 0,
    ev_gmv_2k       TINYINT(1) DEFAULT 0,
    ev_gmv_5k       TINYINT(1) DEFAULT 0,
    ev_gmv_10k      TINYINT(1) DEFAULT 0,
    ev_agency_bound TINYINT(1) DEFAULT 0,
    ev_churned      TINYINT(1) DEFAULT 0,
    last_synced     DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (creator_id) REFERENCES creators(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX idx_jb_creator ON joinbrands_link(creator_id);
CREATE INDEX idx_jb_ev_joined ON joinbrands_link(ev_joined);
CREATE INDEX idx_jb_ev_churned ON joinbrands_link(ev_churned);

-- ***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED***
-- 手工匹配记录
-- ***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED***
CREATE TABLE IF NOT EXISTS manual_match (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    creator_id      INT,
    keeper_username VARCHAR(64),
    joinbrands_name VARCHAR(128),
    wa_phone        VARCHAR(32),
    matched_by      VARCHAR(32) DEFAULT 'manual',
    matched_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uk_match (keeper_username, joinbrands_name, wa_phone),
    FOREIGN KEY (creator_id) REFERENCES creators(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED***
-- SFT Memory — SFT 训练语料
-- ***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED***
CREATE TABLE IF NOT EXISTS sft_memory (
    id                  INT AUTO_INCREMENT PRIMARY KEY,
    model_opt1          TEXT,
    model_opt2          TEXT,
    human_selected      VARCHAR(16) NOT NULL COMMENT "'opt1'|'opt2'|'custom'",
    human_output        TEXT NOT NULL,
    model_predicted     VARCHAR(16),
    model_rejected      VARCHAR(16),
    is_custom_input     TINYINT(1) DEFAULT 0,
    human_reason        TEXT,
    context_json        JSON,
    status              VARCHAR(32) DEFAULT 'approved',
    reviewed_by         VARCHAR(64),
    similarity          INT,
    scene               VARCHAR(64),
    message_history     JSON COMMENT '前10轮对话历史',
    system_prompt_version VARCHAR(16) DEFAULT 'v1',
    client_id_hash      VARCHAR(64) COMMENT 'SHA256(client_id)',
    input_text_hash     VARCHAR(64) COMMENT 'SHA256(input_text)',
    human_output_hash   VARCHAR(64) COMMENT 'SHA256(human_output)',
    created_date        DATE COMMENT 'YYYY-MM-DD',
    chosen_output       TEXT COMMENT '被选中的回复（RLHF Preference Pair）',
    rejected_output     TEXT COMMENT '被拒绝的回复（RLHF Preference Pair）',
    created_at          DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX idx_sft_created ON sft_memory(created_at);
CREATE INDEX idx_sft_status ON sft_memory(status);
CREATE UNIQUE INDEX idx_sft_dedup ON sft_memory(client_id_hash, input_text_hash, human_output_hash, created_date);
CREATE INDEX idx_sft_scene ON sft_memory(scene);
CREATE INDEX idx_sft_client_hash ON sft_memory(client_id_hash);

-- ***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED***
-- SFT Feedback — Skip/Reject/Edit 反馈记录
-- ***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED***
CREATE TABLE IF NOT EXISTS sft_feedback (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    client_id       VARCHAR(64) NOT NULL,
    feedback_type   VARCHAR(16) NOT NULL COMMENT "'skip'|'reject'|'edit'",
    input_text      TEXT,
    opt1            TEXT,
    opt2            TEXT,
    final_output    TEXT,
    scene           VARCHAR(64),
    detail          TEXT,
    reject_reason   TEXT COMMENT 'skip/reject 时：为什么两个候选都不够好',
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX idx_feedback_type_scene ON sft_feedback(feedback_type, scene);
CREATE INDEX idx_feedback_client ON sft_feedback(client_id);
CREATE INDEX idx_feedback_created ON sft_feedback(created_at);

-- ***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED***
-- Client Memory — 客户单独记忆
-- ***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED***
CREATE TABLE IF NOT EXISTS client_memory (
    id                  INT AUTO_INCREMENT PRIMARY KEY,
    client_id           VARCHAR(64) NOT NULL,
    memory_type         VARCHAR(32) NOT NULL COMMENT "'preference'|'decision'|'style'|'policy'",
    memory_key          VARCHAR(64),
    memory_value        TEXT,
    source_record_id    INT,
    confidence          INT DEFAULT 1,
    created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at          DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_client_mem (client_id, memory_type, memory_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX idx_cm_client ON client_memory(client_id);
CREATE INDEX idx_cm_memory_type ON client_memory(memory_type);

-- ***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED***
-- Policy Documents — 政策文档
-- ***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED***
CREATE TABLE IF NOT EXISTS policy_documents (
    id                  INT AUTO_INCREMENT PRIMARY KEY,
    policy_key          VARCHAR(128) NOT NULL UNIQUE,
    policy_version      VARCHAR(32) NOT NULL,
    policy_content      JSON NOT NULL,
    applicable_scenarios JSON COMMENT 'JSON array',
    is_active           TINYINT(1) DEFAULT 1,
    created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at          DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED***
-- Sync Log — 同步日志
-- ***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED***
CREATE TABLE IF NOT EXISTS sync_log (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    bot_name        VARCHAR(32) NOT NULL,
    record_count    INT,
    synced_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
    status          VARCHAR(16) DEFAULT 'success',
    note            TEXT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX idx_sync_bot ON sync_log(bot_name);
CREATE INDEX idx_sync_status ON sync_log(status);

-- ***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED***
-- Audit Log — 审计日志
-- ***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED***
CREATE TABLE IF NOT EXISTS audit_log (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    action          VARCHAR(64) NOT NULL,
    table_name      VARCHAR(64),
    record_id       INT,
    operator        VARCHAR(64) DEFAULT 'system',
    before_value    JSON,
    after_value     JSON,
    ip_address      VARCHAR(45),
    user_agent      TEXT,
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX idx_audit_action ON audit_log(action);
CREATE INDEX idx_audit_created ON audit_log(created_at);
CREATE INDEX idx_audit_table_record ON audit_log(table_name, record_id);

-- ***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED***
-- Client Profiles — 客户独立画像
-- ***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED***
CREATE TABLE IF NOT EXISTS client_profiles (
    id                  INT AUTO_INCREMENT PRIMARY KEY,
    client_id           VARCHAR(64) NOT NULL UNIQUE,
    summary             TEXT,
    tags                JSON COMMENT 'JSON array',
    tiktok_data         JSON COMMENT '{followers, avg_views, gmv}',
    stage               VARCHAR(32),
    last_interaction    DATETIME,
    last_updated        DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    created_at          DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX idx_cp_client ON client_profiles(client_id);
CREATE INDEX idx_cp_stage ON client_profiles(stage);

-- ***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED***
-- Client Tags — 动态标签
-- ***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED***
CREATE TABLE IF NOT EXISTS client_tags (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    client_id       VARCHAR(64) NOT NULL,
    tag             VARCHAR(64) NOT NULL COMMENT '如 "tone:formal"',
    source          VARCHAR(32) NOT NULL COMMENT "'ai_extracted'|'sft_feedback'|'keeper_update'|'manual'",
    confidence      INT DEFAULT 1 COMMENT '1-3 置信度',
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uk_tag (client_id, tag, source)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX idx_ct_client ON client_tags(client_id);
CREATE INDEX idx_ct_tag ON client_tags(tag);
CREATE INDEX idx_ct_source ON client_tags(source);

-- ***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED***
-- Operator Experiences — AI 体验配置
-- ***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED***
CREATE TABLE IF NOT EXISTS operator_experiences (
    id                  INT AUTO_INCREMENT PRIMARY KEY,
    operator            VARCHAR(32) NOT NULL UNIQUE,
    display_name        VARCHAR(64) NOT NULL,
    description         TEXT,
    system_prompt_base  TEXT NOT NULL,
    scene_config        JSON COMMENT 'scene → prompt fragment',
    forbidden_rules     JSON COMMENT 'JSON array',
    is_active           TINYINT(1) DEFAULT 1,
    priority            INT DEFAULT 0,
    created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at          DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX idx_oe_operator ON operator_experiences(operator);

INSERT IGNORE INTO operator_experiences (operator, display_name, description, system_prompt_base, scene_config, forbidden_rules, priority) VALUES
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

INSERT IGNORE INTO operator_experiences (operator, display_name, description, system_prompt_base, scene_config, forbidden_rules, priority) VALUES
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

-- ***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED***
-- Events — 事件表
-- ***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED***
CREATE TABLE IF NOT EXISTS events (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    creator_id      INT NOT NULL,
    event_key       VARCHAR(64) NOT NULL COMMENT "'trial_7day'|'monthly_challenge'|'agency_bound'",
    event_type      VARCHAR(32) NOT NULL COMMENT "'challenge'|'gmv'|'referral'|'incentive_task'|'agency'",
    owner           VARCHAR(32) NOT NULL COMMENT "'Beau'|'Yiyun'",
    status          VARCHAR(16) DEFAULT 'active' COMMENT "'pending'|'active'|'completed'|'cancelled'",
    trigger_source  VARCHAR(32) DEFAULT 'semantic_auto' COMMENT "'semantic_auto'|'manual'|'gmv_crosscheck'",
    trigger_text    TEXT,
    start_at        DATETIME,
    end_at          DATETIME,
    meta            JSON COMMENT '事件特定数据',
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (creator_id) REFERENCES creators(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX idx_events_creator ON events(creator_id);
CREATE INDEX idx_events_status ON events(status);
CREATE INDEX idx_events_owner ON events(owner);
CREATE INDEX idx_events_event_type ON events(event_type);
CREATE UNIQUE INDEX idx_events_unique_active ON events(creator_id, event_key, status, (IF(status='active',0,1)));

-- ***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED***
-- Event Periods — 事件周期记录
-- ***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED***
CREATE TABLE IF NOT EXISTS event_periods (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    event_id        INT NOT NULL,
    period_start    DATETIME NOT NULL,
    period_end      DATETIME NOT NULL,
    video_count     INT DEFAULT 0,
    bonus_earned    DOUBLE DEFAULT 0,
    status          VARCHAR(16) DEFAULT 'pending' COMMENT "'pending'|'settled'",
    meta            JSON,
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX idx_periods_event ON event_periods(event_id);
CREATE INDEX idx_periods_status ON event_periods(status);

-- ***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED***
-- Events Policy — 事件策略配置
-- ***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED***
CREATE TABLE IF NOT EXISTS events_policy (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    owner           VARCHAR(32) NOT NULL,
    event_key       VARCHAR(64) NOT NULL,
    policy_json     JSON NOT NULL,
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_policy (owner, event_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
