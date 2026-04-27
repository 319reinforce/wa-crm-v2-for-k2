-- WA CRM v2 MySQL Schema
-- 从 SQLite 迁移至 MySQL 9.x
-- 字符集：utf8mb4_unicode_ci

CREATE DATABASE IF NOT EXISTS wa_crm_v2 CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE wa_crm_v2;

-- ============================================================
-- 达人主表
-- ============================================================
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

-- ============================================================
-- 别名映射表
-- ============================================================
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

-- ============================================================
-- WA 消息表
-- ============================================================
CREATE TABLE IF NOT EXISTS wa_messages (
    id            BIGINT AUTO_INCREMENT PRIMARY KEY,
    creator_id    INT NOT NULL,
    role          VARCHAR(16) NOT NULL COMMENT "'me'|'user'|'assistant'",
    operator      VARCHAR(32) DEFAULT NULL COMMENT "'Beau'|'Yiyun'|'WangYouKe'等",
    text          TEXT,
    timestamp     BIGINT COMMENT 'Unix timestamp (ms)',
    message_hash  VARCHAR(64) COMMENT 'SHA256(role|text|timestamp_ms) - legacy 兜底键',
    wa_message_id VARCHAR(128) DEFAULT NULL COMMENT 'WhatsApp 原生 message id (Message.id._serialized)',
    created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
    -- 媒体字段（incoming media via downloadMedia）
    media_asset_id         BIGINT NULL COMMENT 'FK to media_assets.id',
    media_type             VARCHAR(32) NULL COMMENT 'image|video|audio|document',
    media_mime             VARCHAR(64) NULL COMMENT 'e.g. image/jpeg',
    media_size             BIGINT NULL COMMENT 'file size in bytes',
    media_width            INT NULL COMMENT 'image width in px',
    media_height           INT NULL COMMENT 'image height in px',
    media_caption          TEXT NULL COMMENT 'caption text (for media with caption)',
    media_thumbnail        TEXT NULL COMMENT 'base64 thumbnail for quick preview',
    media_download_status  VARCHAR(16) NULL COMMENT 'pending|success|failed',
    -- Baileys proto 持久化（getMessage 回调需要跨重启读回原消息 proto）
    proto_bytes            LONGBLOB NULL COMMENT 'Baileys proto.IMessage 原始字节（仅 baileys driver）',
    proto_driver           VARCHAR(16) NULL COMMENT 'proto 来源 driver: baileys | NULL',
    updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (creator_id) REFERENCES creators(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX idx_messages_creator ON wa_messages(creator_id);
CREATE INDEX idx_messages_timestamp ON wa_messages(timestamp);
CREATE UNIQUE INDEX idx_messages_dedup_hash ON wa_messages(creator_id, message_hash);
-- 组合 UNIQUE：同一条 WA message id 允许在不同 creator 下各存一份。
-- 多 session（例如 test 账号是 lotus 手机 + jiawei 账号是对话对端）会同时观察到同一全局 message id，
-- 如果用全表 UNIQUE(wa_message_id) 会让后到的那条被 INSERT IGNORE 静默 drop。
CREATE UNIQUE INDEX uk_wa_message_id_creator ON wa_messages(wa_message_id, creator_id);
CREATE INDEX idx_messages_creator_timestamp ON wa_messages(creator_id, timestamp DESC);
CREATE INDEX idx_messages_creator_role_ts ON wa_messages(creator_id, role, timestamp);
-- 媒体索引
CREATE INDEX idx_messages_media_asset  ON wa_messages(media_asset_id);
CREATE INDEX idx_messages_media_status ON wa_messages(media_download_status);
CREATE INDEX idx_messages_media_type   ON wa_messages(media_type);
-- proto 索引（getMessage 回调读取时按 proto_driver 过滤）
CREATE INDEX idx_messages_proto_driver ON wa_messages(proto_driver);

-- ============================================================
-- WA 群聊表
-- ============================================================
CREATE TABLE IF NOT EXISTS wa_group_chats (
    id           BIGINT AUTO_INCREMENT PRIMARY KEY,
    session_id   VARCHAR(64) NOT NULL,
    operator     VARCHAR(32) DEFAULT NULL,
    chat_id      VARCHAR(128) NOT NULL,
    group_name   VARCHAR(255) DEFAULT NULL,
    last_active  BIGINT DEFAULT NULL,
    last_synced  DATETIME DEFAULT CURRENT_TIMESTAMP,
    created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at   DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_session_chat (session_id, chat_id),
    KEY idx_group_operator (operator),
    KEY idx_group_last_active (last_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS wa_group_messages (
    id                  BIGINT AUTO_INCREMENT PRIMARY KEY,
    group_chat_id       BIGINT NOT NULL,
    session_id          VARCHAR(64) NOT NULL,
    operator            VARCHAR(32) DEFAULT NULL,
    chat_id             VARCHAR(128) NOT NULL,
    role                VARCHAR(16) NOT NULL,
    author_jid          VARCHAR(128) DEFAULT NULL,
    author_phone        VARCHAR(64) DEFAULT NULL,
    author_name         VARCHAR(255) DEFAULT NULL,
    text                TEXT,
    timestamp           BIGINT NOT NULL,
    message_hash        VARCHAR(64) NOT NULL,
    message_fingerprint VARCHAR(64) NOT NULL,
    created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uk_group_message (group_chat_id, message_hash),
    KEY idx_group_messages_chat_ts (group_chat_id, timestamp DESC),
    KEY idx_group_messages_session_fp (session_id, message_fingerprint),
    KEY idx_group_messages_operator_fp (operator, message_fingerprint),
    CONSTRAINT fk_group_messages_chat
        FOREIGN KEY (group_chat_id) REFERENCES wa_group_chats(id)
        ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- WA CRM 扩展数据
-- ============================================================
CREATE TABLE IF NOT EXISTS wa_crm_data (
    id                  INT AUTO_INCREMENT PRIMARY KEY,
    creator_id          INT NOT NULL UNIQUE,
    priority            VARCHAR(16) DEFAULT 'low',
    next_action         TEXT,
    event_score         DOUBLE DEFAULT 0,
    urgency_level       INT DEFAULT 5,
    monthly_fee_status  VARCHAR(32) DEFAULT 'pending' COMMENT 'DEPRECATED lifecycle compatibility; write canonical facts to events',
    monthly_fee_amount  DOUBLE DEFAULT 20 COMMENT 'DEPRECATED lifecycle compatibility; write canonical facts to events',
    monthly_fee_deducted INT DEFAULT 0 COMMENT 'DEPRECATED lifecycle compatibility; write canonical facts to events',
    beta_status         VARCHAR(32) DEFAULT 'not_introduced' COMMENT 'DEPRECATED lifecycle compatibility; write canonical facts to events',
    beta_cycle_start    BIGINT COMMENT 'DEPRECATED lifecycle compatibility; write canonical facts to events',
    beta_program_type   VARCHAR(32) DEFAULT '20_day_beta' COMMENT 'DEPRECATED lifecycle compatibility; write canonical facts to events',
    agency_bound        TINYINT(1) DEFAULT 0 COMMENT 'DEPRECATED lifecycle compatibility; write canonical facts to events',
    agency_bound_at     BIGINT COMMENT 'DEPRECATED lifecycle compatibility; write canonical facts to events',
    agency_deadline     BIGINT COMMENT 'DEPRECATED lifecycle compatibility; write canonical facts to events',
    video_count         INT DEFAULT 0 COMMENT 'DEPRECATED lifecycle compatibility; write challenge progress to event_periods or external facts',
    video_target        INT DEFAULT 35 COMMENT 'DEPRECATED lifecycle compatibility; write challenge progress to event_periods or external facts',
    video_last_checked  BIGINT COMMENT 'DEPRECATED lifecycle compatibility; write challenge progress to event_periods or external facts',
    created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at          DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (creator_id) REFERENCES creators(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX idx_crm_creator ON wa_crm_data(creator_id);
CREATE INDEX idx_crm_priority ON wa_crm_data(priority);
CREATE INDEX idx_crm_urgency ON wa_crm_data(urgency_level);

-- ============================================================
-- Keeper 系统关联
-- ============================================================
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

-- ============================================================
-- JoinBrands 系统关联
-- ============================================================
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
    ev_joined       TINYINT(1) DEFAULT 0 COMMENT 'DEPRECATED compatibility cache; derive from events/snapshots',
    ev_ready_sent   TINYINT(1) DEFAULT 0 COMMENT 'DEPRECATED compatibility cache; derive from events/snapshots',
    ev_trial_7day   TINYINT(1) DEFAULT 0 COMMENT 'DEPRECATED compatibility cache; derive from events/snapshots',
    ev_trial_active TINYINT(1) DEFAULT 0 COMMENT 'DEPRECATED compatibility cache; derive from events/snapshots',
    ev_monthly_started TINYINT(1) DEFAULT 0 COMMENT 'DEPRECATED compatibility cache; derive from events/snapshots',
    ev_monthly_invited TINYINT(1) DEFAULT 0 COMMENT 'DEPRECATED compatibility cache; derive from events/snapshots',
    ev_monthly_joined  TINYINT(1) DEFAULT 0 COMMENT 'DEPRECATED compatibility cache; derive from events/snapshots',
    ev_whatsapp_shared TINYINT(1) DEFAULT 0 COMMENT 'DEPRECATED compatibility cache; derive from events/snapshots',
    ev_gmv_1k       TINYINT(1) DEFAULT 0 COMMENT 'DEPRECATED compatibility cache; derive from events/snapshots',
    ev_gmv_2k       TINYINT(1) DEFAULT 0 COMMENT 'DEPRECATED compatibility cache; derive from events/snapshots',
    ev_gmv_5k       TINYINT(1) DEFAULT 0 COMMENT 'DEPRECATED compatibility cache; derive from events/snapshots',
    ev_gmv_10k      TINYINT(1) DEFAULT 0 COMMENT 'DEPRECATED compatibility cache; derive from events/snapshots',
    ev_agency_bound TINYINT(1) DEFAULT 0 COMMENT 'DEPRECATED compatibility cache; derive from events/snapshots',
    ev_churned      TINYINT(1) DEFAULT 0 COMMENT 'DEPRECATED compatibility cache; derive from events/snapshots',
    last_synced     DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (creator_id) REFERENCES creators(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX idx_jb_creator ON joinbrands_link(creator_id);
CREATE INDEX idx_jb_ev_joined ON joinbrands_link(ev_joined);
CREATE INDEX idx_jb_ev_churned ON joinbrands_link(ev_churned);

-- ============================================================
-- 手工匹配记录
-- ============================================================
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

-- ============================================================
-- SFT Memory — SFT 训练语料
-- ============================================================
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
    retrieval_snapshot_id BIGINT NULL COMMENT '关联 retrieval_snapshot.id',
    generation_log_id   BIGINT NULL COMMENT '关联 generation_log.id',
    provider            VARCHAR(32) NULL COMMENT 'minimax|openai|finetuned',
    model               VARCHAR(64) NULL COMMENT '本次生成使用的模型',
    scene_source        VARCHAR(32) NULL COMMENT 'provided|detected|fallback',
    pipeline_version    VARCHAR(64) NULL COMMENT '回复生成链路版本',
    client_id_hash      VARCHAR(64) COMMENT 'SHA256(client_id)',
    input_text_hash     VARCHAR(64) COMMENT 'SHA256(input_text)',
    human_output_hash   VARCHAR(64) COMMENT 'SHA256(human_output)',
    created_date        DATE COMMENT 'YYYY-MM-DD',
    chosen_output       TEXT COMMENT '被选中的回复（RLHF Preference Pair）',
    rejected_output     TEXT COMMENT '被拒绝的回复（RLHF Preference Pair）',
    system_prompt_used  TEXT COMMENT '推理时实际使用的完整 system prompt',
    created_at          DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX idx_sft_created ON sft_memory(created_at);
CREATE INDEX idx_sft_status ON sft_memory(status);
CREATE UNIQUE INDEX idx_sft_dedup ON sft_memory(client_id_hash, input_text_hash, human_output_hash, created_date);
CREATE INDEX idx_sft_scene ON sft_memory(scene);
CREATE INDEX idx_sft_client_hash ON sft_memory(client_id_hash);
CREATE INDEX idx_sft_retrieval_snapshot ON sft_memory(retrieval_snapshot_id);
CREATE INDEX idx_sft_generation_log ON sft_memory(generation_log_id);
CREATE INDEX idx_sft_provider_model ON sft_memory(provider, model);

-- ============================================================
-- Retrieval Snapshot — 每次生成的检索上下文快照
-- ============================================================
CREATE TABLE IF NOT EXISTS retrieval_snapshot (
    id                  BIGINT AUTO_INCREMENT PRIMARY KEY,
    client_id           VARCHAR(64),
    operator            VARCHAR(32),
    scene               VARCHAR(64) DEFAULT 'unknown',
    system_prompt_version VARCHAR(32) DEFAULT 'v2',
    snapshot_hash       VARCHAR(64) NOT NULL,
    grounding_json      JSON NOT NULL,
    topic_context       TEXT,
    rich_context        TEXT,
    conversation_summary TEXT,
    created_at          DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX idx_rs_client_scene ON retrieval_snapshot(client_id, scene, created_at);
CREATE INDEX idx_rs_hash ON retrieval_snapshot(snapshot_hash);

-- ============================================================
-- Generation Log — 模型生成日志（用于AB评估与追溯）
-- ============================================================
CREATE TABLE IF NOT EXISTS generation_log (
    id                  BIGINT AUTO_INCREMENT PRIMARY KEY,
    client_id           VARCHAR(64),
    retrieval_snapshot_id BIGINT,
    provider            VARCHAR(32),
    model               VARCHAR(64),
    route               VARCHAR(32) DEFAULT 'minimax',
    ab_bucket           VARCHAR(32),
    scene               VARCHAR(64) DEFAULT 'unknown',
    operator            VARCHAR(32),
    temperature_json    JSON,
    message_count       INT DEFAULT 0,
    prompt_version      VARCHAR(32),
    latency_ms          INT,
    status              VARCHAR(16) DEFAULT 'success',
    error_message       TEXT,
    created_at          DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX idx_gl_client_created ON generation_log(client_id, created_at);
CREATE INDEX idx_gl_status_created ON generation_log(status, created_at);
CREATE INDEX idx_gl_snapshot ON generation_log(retrieval_snapshot_id);

-- ============================================================
-- Media Assets — 图片素材资产
-- ============================================================
CREATE TABLE IF NOT EXISTS media_assets (
    id                  BIGINT AUTO_INCREMENT PRIMARY KEY,
    creator_id          INT NULL,
    operator            VARCHAR(32) NULL,
    uploaded_by         VARCHAR(64) NULL,
    storage_provider    VARCHAR(16) NOT NULL DEFAULT 'local' COMMENT 'local|s3|r2|oss',
    storage_key         VARCHAR(255) NOT NULL COMMENT '对象存储 key 或逻辑 key',
    file_path           TEXT NULL COMMENT '本地路径（仅 local）',
    file_url            TEXT NULL COMMENT '可访问 URL（对象存储/CDN）',
    file_name           VARCHAR(255) NOT NULL,
    mime_type           VARCHAR(64) NOT NULL,
    file_size           BIGINT NOT NULL,
    sha256_hash         VARCHAR(64) NOT NULL,
    status              VARCHAR(16) NOT NULL DEFAULT 'active' COMMENT 'active|deleted|blocked',
    storage_tier        VARCHAR(16) NOT NULL DEFAULT 'hot' COMMENT 'hot|warm|cold|deleted',
    original_size       BIGINT NULL COMMENT '压缩前原始大小',
    compressed_at       DATETIME NULL COMMENT '压缩完成时间',
    deleted_at          DATETIME NULL COMMENT '软删除时间',
    cleanup_job_id      BIGINT NULL COMMENT 'FK to cleanup_jobs.id',
    meta_json           JSON NULL,
    created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at          DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (creator_id) REFERENCES creators(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX idx_media_assets_creator ON media_assets(creator_id);
CREATE INDEX idx_media_assets_status ON media_assets(status);
CREATE INDEX idx_media_assets_hash ON media_assets(sha256_hash);
CREATE INDEX idx_media_assets_storage_tier ON media_assets(storage_tier);
CREATE INDEX idx_media_assets_deleted_at ON media_assets(deleted_at);
CREATE INDEX idx_media_assets_cleanup_job ON media_assets(cleanup_job_id);
CREATE INDEX idx_media_assets_created_at ON media_assets(created_at);

-- ============================================================
-- Cleanup Jobs — 媒体清理任务
-- ============================================================
CREATE TABLE IF NOT EXISTS cleanup_jobs (
    id                  BIGINT AUTO_INCREMENT PRIMARY KEY,
    job_type            VARCHAR(32) NOT NULL COMMENT "'retention'|'manual'|'purge'",
    retention_days      INT NULL COMMENT '保留天数（retention 类型）',
    status              VARCHAR(16) NOT NULL DEFAULT 'running' COMMENT 'running|completed|failed',
    total_candidates    INT NOT NULL DEFAULT 0,
    candidates_checked  INT NOT NULL DEFAULT 0,
    candidates_deleted INT NOT NULL DEFAULT 0,
    candidates_skipped INT NOT NULL DEFAULT 0,
    started_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at       DATETIME NULL,
    triggered_by       VARCHAR(64) NOT NULL DEFAULT 'system' COMMENT "'system'|'cron'|'manual'|'script'",
    triggered_by_user  VARCHAR(64) NULL,
    note               TEXT NULL,
    error_message       TEXT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX idx_cleanup_jobs_status ON cleanup_jobs(status);
CREATE INDEX idx_cleanup_jobs_started ON cleanup_jobs(started_at DESC);

-- ============================================================
-- Cleanup Exemptions — 清理豁免记录（永久保留）
-- ============================================================
CREATE TABLE IF NOT EXISTS cleanup_exemptions (
    id                  BIGINT AUTO_INCREMENT PRIMARY KEY,
    media_asset_id      BIGINT NOT NULL,
    exempted_by         VARCHAR(64) NOT NULL,
    exemption_reason    VARCHAR(255) NOT NULL,
    exempted_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at          DATETIME NULL COMMENT 'NULL = 永久豁免',
    created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (media_asset_id) REFERENCES media_assets(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE UNIQUE INDEX idx_exemptions_asset ON cleanup_exemptions(media_asset_id);
CREATE INDEX idx_exemptions_expiry ON cleanup_exemptions(expires_at);

-- ============================================================
-- Media Send Log — 图片发送日志
-- ============================================================
CREATE TABLE IF NOT EXISTS media_send_log (
    id                  BIGINT AUTO_INCREMENT PRIMARY KEY,
    media_asset_id      BIGINT NOT NULL,
    creator_id          INT NULL,
    phone               VARCHAR(32) NOT NULL,
    session_id          VARCHAR(64) NULL,
    operator            VARCHAR(32) NULL,
    caption             TEXT NULL,
    status              VARCHAR(16) NOT NULL DEFAULT 'pending' COMMENT 'pending|success|failed',
    error_message       TEXT NULL,
    wa_message_id       VARCHAR(255) NULL,
    routed_session_id   VARCHAR(64) NULL,
    routed_operator     VARCHAR(32) NULL,
    sent_by             VARCHAR(64) NULL,
    created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
    sent_at             DATETIME NULL,
    FOREIGN KEY (media_asset_id) REFERENCES media_assets(id) ON DELETE RESTRICT,
    FOREIGN KEY (creator_id) REFERENCES creators(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX idx_media_send_creator_created ON media_send_log(creator_id, created_at);
CREATE INDEX idx_media_send_status_created ON media_send_log(status, created_at);
CREATE INDEX idx_media_send_asset ON media_send_log(media_asset_id);

-- ============================================================
-- SFT Feedback — Skip/Reject/Edit 反馈记录
-- ============================================================
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

-- ============================================================
-- Client Memory — 客户单独记忆
-- ============================================================
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

-- ============================================================
-- Policy Documents — 政策文档
-- ============================================================
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

-- ============================================================
-- Sync Log — 同步日志
-- ============================================================
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

-- ============================================================
-- Training Log — SFT 训练执行日志
-- ============================================================
CREATE TABLE IF NOT EXISTS training_log (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    month_label     VARCHAR(16) NOT NULL COMMENT 'YYYY-MM',
    record_count    INT NOT NULL,
    export_path     VARCHAR(256),
    status          VARCHAR(16) NOT NULL COMMENT "'success'|'failed'|'skipped'|'dry_run'",
    detail          TEXT,
    triggered_by    VARCHAR(32) DEFAULT 'manual' COMMENT "'manual'|'http_trigger'|'cli'|'dry_run'|'cron'",
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- Audit Log — 审计日志
-- ============================================================
CREATE TABLE IF NOT EXISTS audit_log (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    action          VARCHAR(64) NOT NULL,
    table_name      VARCHAR(64),
    record_id       VARCHAR(64),
    operator        VARCHAR(64) DEFAULT 'system',
    user_id         INT NULL,
    user_role       VARCHAR(16) NULL,
    auth_source     VARCHAR(8) NULL,
    token_principal VARCHAR(64) NULL,
    before_value    JSON,
    after_value     JSON,
    ip_address      VARCHAR(45),
    user_agent      TEXT,
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX idx_audit_action ON audit_log(action);
CREATE INDEX idx_audit_created ON audit_log(created_at);
CREATE INDEX idx_audit_table_record ON audit_log(table_name, record_id);
CREATE INDEX idx_audit_user ON audit_log(user_id);

-- ============================================================
-- Custom Topic Templates — 运营自定义话题模板
-- ============================================================
CREATE TABLE IF NOT EXISTS custom_topic_templates (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    label           VARCHAR(128) NOT NULL,
    topic_group     VARCHAR(64) NOT NULL DEFAULT 'custom_topic',
    intent_key      VARCHAR(64) NOT NULL DEFAULT 'custom_template',
    scene_key       VARCHAR(64) NOT NULL DEFAULT 'follow_up',
    template_text   TEXT NOT NULL,
    media_items_json TEXT NULL,
    owner_scope     VARCHAR(64) NOT NULL DEFAULT 'global',
    created_by      VARCHAR(64) NULL,
    is_active       TINYINT(1) DEFAULT 1,
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_custom_topic_owner_label (owner_scope, label)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX idx_ctt_active_updated ON custom_topic_templates(is_active, updated_at);
CREATE INDEX idx_ctt_owner ON custom_topic_templates(owner_scope);

-- ============================================================
-- Client Profiles — 客户独立画像
-- ============================================================
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

-- ============================================================
-- Profile Analysis State — 画像分析队列状态
-- ============================================================
CREATE TABLE IF NOT EXISTS profile_analysis_state (
    id                         INT AUTO_INCREMENT PRIMARY KEY,
    client_id                  VARCHAR(64) NOT NULL UNIQUE,
    pending_unanalyzed_count   INT DEFAULT 0,
    last_profile_analyzed_at   DATETIME NULL,
    last_analyzed_message_ts   BIGINT NULL,
    updated_at                 DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    created_at                 DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX idx_pas_pending ON profile_analysis_state(pending_unanalyzed_count);
CREATE INDEX idx_pas_last_analyzed ON profile_analysis_state(last_profile_analyzed_at);

-- ============================================================
-- Client Profile Snapshots — 画像历史快照
-- ============================================================
CREATE TABLE IF NOT EXISTS client_profile_snapshots (
    id                   INT AUTO_INCREMENT PRIMARY KEY,
    client_id            VARCHAR(64) NOT NULL,
    frequency_level      VARCHAR(16) NULL,
    frequency_conf       INT DEFAULT 1,
    frequency_evidence   TEXT,
    difficulty_level     VARCHAR(16) NULL,
    difficulty_conf      INT DEFAULT 1,
    difficulty_evidence  TEXT,
    intent_level         VARCHAR(16) NULL,
    intent_conf          INT DEFAULT 1,
    intent_evidence      TEXT,
    emotion_level        VARCHAR(16) NULL,
    emotion_conf         INT DEFAULT 1,
    emotion_evidence     TEXT,
    motivation_positive  JSON,
    motivation_conf      INT DEFAULT 1,
    motivation_evidence  TEXT,
    pain_points          JSON,
    pain_conf            INT DEFAULT 1,
    pain_evidence        TEXT,
    summary              TEXT,
    source               VARCHAR(32) DEFAULT 'system',
    created_at           DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX idx_cps_client ON client_profile_snapshots(client_id);

-- ============================================================
-- Client Profile Change Events — 画像变更审核事件
-- ============================================================
CREATE TABLE IF NOT EXISTS client_profile_change_events (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    client_id       VARCHAR(64) NOT NULL,
    old_snapshot_id INT NULL,
    new_snapshot_id INT NOT NULL,
    status          VARCHAR(16) DEFAULT 'pending',
    change_summary  JSON,
    trigger_type    VARCHAR(32),
    trigger_text    TEXT,
    reviewed_by     VARCHAR(64) NULL,
    reviewed_note   TEXT NULL,
    reviewed_at     DATETIME NULL,
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX idx_cpce_client_status ON client_profile_change_events(client_id, status);

-- ============================================================
-- Client Tags — 动态标签
-- ============================================================
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

-- ============================================================
-- Operator Experiences — AI 体验配置
-- ============================================================
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

-- ============================================================
-- Events — 事件表
-- ============================================================
CREATE TABLE IF NOT EXISTS events (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    creator_id      INT NOT NULL,
    event_key       VARCHAR(64) NOT NULL COMMENT "'trial_7day'|'monthly_challenge'|'agency_bound'",
    canonical_event_key VARCHAR(64) NULL COMMENT '标准化 canonical event key；非标准生成事件可为空',
    event_type      VARCHAR(32) NOT NULL COMMENT "'challenge'|'gmv'|'referral'|'incentive_task'|'agency'",
    owner           VARCHAR(32) NOT NULL COMMENT "'Beau'|'Yiyun'",
    status          VARCHAR(16) DEFAULT 'active' COMMENT "'draft'|'active'|'completed'|'cancelled'",
    event_state     VARCHAR(24) NULL COMMENT "'candidate'|'active'|'completed'|'cancelled'|'expired'",
    review_state    VARCHAR(24) NULL COMMENT "'unreviewed'|'confirmed'|'rejected'|'uncertain'",
    evidence_tier   TINYINT NULL COMMENT '0 keyword, 1 weak import/manual, 2 anchored/operator, 3 external verified',
    source_kind     VARCHAR(32) NULL COMMENT "'keyword'|'llm'|'operator'|'external_system'|'migration'",
    source_event_at DATETIME NULL COMMENT '业务事实发生时间',
    detected_at     DATETIME NULL COMMENT '系统识别/导入时间',
    verified_at     DATETIME NULL COMMENT '确认时间',
    verified_by     VARCHAR(64) NULL,
    idempotency_key VARCHAR(128) NULL,
    lifecycle_effect VARCHAR(32) NULL COMMENT "'none'|'overlay'|'stage_signal'",
    expires_at      DATETIME NULL,
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
CREATE INDEX idx_events_canonical_state ON events(canonical_event_key, event_state);
CREATE INDEX idx_events_source_event_at ON events(source_event_at);
CREATE UNIQUE INDEX idx_events_idempotency ON events(idempotency_key);
CREATE UNIQUE INDEX idx_events_unique_active ON events(creator_id, event_key, status, (IF(status='active',0,1)));

-- ============================================================
-- Event Definitions — 事件字典
-- ============================================================
CREATE TABLE IF NOT EXISTS event_definitions (
    event_key             VARCHAR(64) PRIMARY KEY,
    event_type            VARCHAR(32) NOT NULL,
    label                 VARCHAR(128) NOT NULL,
    lifecycle_effect      VARCHAR(32) NOT NULL DEFAULT 'none',
    is_periodic           TINYINT(1) NOT NULL DEFAULT 0,
    allow_parallel        TINYINT(1) NOT NULL DEFAULT 0,
    requires_verification TINYINT(1) NOT NULL DEFAULT 1,
    owner_scope_json      JSON,
    created_at            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- Event Evidence — 事件证据锚点
-- ============================================================
CREATE TABLE IF NOT EXISTS event_evidence (
    id                  BIGINT AUTO_INCREMENT PRIMARY KEY,
    event_id            INT NOT NULL,
    source_kind         VARCHAR(32) NOT NULL,
    source_table        VARCHAR(64),
    source_record_id    VARCHAR(128),
    source_message_id   BIGINT,
    source_message_hash VARCHAR(128),
    source_quote        TEXT,
    external_system     VARCHAR(64),
    raw_payload_hash    VARCHAR(128),
    created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_event_evidence_event FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX idx_event_evidence_event ON event_evidence(event_id);
CREATE INDEX idx_event_evidence_message ON event_evidence(source_message_id);

-- ============================================================
-- Event State Transitions — 事件状态流转
-- ============================================================
CREATE TABLE IF NOT EXISTS event_state_transitions (
    id            BIGINT AUTO_INCREMENT PRIMARY KEY,
    event_id      INT NOT NULL,
    from_state    VARCHAR(24),
    to_state      VARCHAR(24) NOT NULL,
    reason        TEXT,
    operator      VARCHAR(64),
    created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_event_state_transition_event FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX idx_event_state_transition_event_time ON event_state_transitions(event_id, created_at DESC);

-- ============================================================
-- Creator Event Snapshot — 事件派生快照/兼容层
-- ============================================================
CREATE TABLE IF NOT EXISTS creator_event_snapshot (
    creator_id             INT PRIMARY KEY,
    active_event_keys_json JSON,
    overlay_flags_json     JSON,
    compat_ev_flags_json   JSON,
    latest_event_at        DATETIME,
    rebuilt_at             DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_creator_event_snapshot_creator FOREIGN KEY (creator_id) REFERENCES creators(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- Active Event Detection Cursor — 主动事件识别队列/游标
-- ============================================================
CREATE TABLE IF NOT EXISTS event_detection_cursor (
    creator_id              INT PRIMARY KEY,
    status                  VARCHAR(24) NOT NULL DEFAULT 'idle',
    pending_reason          VARCHAR(64),
    pending_from_message_id BIGINT NULL,
    pending_from_timestamp  BIGINT NULL,
    last_message_id         BIGINT NULL,
    last_message_timestamp  BIGINT NULL,
    last_detected_at        DATETIME NULL,
    last_run_id             BIGINT NULL,
    attempt_count           INT NOT NULL DEFAULT 0,
    last_error              TEXT,
    updated_at              DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    created_at              DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_event_detection_cursor_creator FOREIGN KEY (creator_id) REFERENCES creators(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX idx_event_detection_cursor_status ON event_detection_cursor(status, updated_at);
CREATE INDEX idx_event_detection_cursor_pending_ts ON event_detection_cursor(pending_from_timestamp);

CREATE TABLE IF NOT EXISTS event_detection_runs (
    id                BIGINT AUTO_INCREMENT PRIMARY KEY,
    creator_id        INT NOT NULL,
    mode              VARCHAR(32) NOT NULL,
    provider          VARCHAR(32) NOT NULL,
    status            VARCHAR(24) NOT NULL DEFAULT 'running',
    dry_run           TINYINT(1) NOT NULL DEFAULT 1,
    from_message_id   BIGINT NULL,
    to_message_id     BIGINT NULL,
    from_timestamp    BIGINT NULL,
    to_timestamp      BIGINT NULL,
    scanned_messages  INT NOT NULL DEFAULT 0,
    candidate_count   INT NOT NULL DEFAULT 0,
    written_count     INT NOT NULL DEFAULT 0,
    skipped_count     INT NOT NULL DEFAULT 0,
    error_count       INT NOT NULL DEFAULT 0,
    error_message     TEXT,
    config_json       JSON,
    started_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at      DATETIME NULL,
    CONSTRAINT fk_event_detection_run_creator FOREIGN KEY (creator_id) REFERENCES creators(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX idx_event_detection_runs_creator_time ON event_detection_runs(creator_id, started_at);

-- ============================================================
-- Creator Lifecycle Snapshot — 生命周期当前态
-- ============================================================
CREATE TABLE IF NOT EXISTS creator_lifecycle_snapshot (
    creator_id           INT PRIMARY KEY,
    stage_key            VARCHAR(32) NOT NULL,
    stage_label          VARCHAR(64) NOT NULL,
    entry_reason         TEXT,
    entry_signals_json   JSON,
    flags_json           JSON,
    conflicts_json       JSON,
    option0_key          VARCHAR(64),
    option0_label        VARCHAR(128),
    option0_next_action  TEXT,
    snapshot_version     VARCHAR(32) NOT NULL DEFAULT 'lifecycle_v2',
    trigger_type         VARCHAR(64),
    trigger_id           VARCHAR(64),
    evaluated_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_at           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_lifecycle_snapshot_creator FOREIGN KEY (creator_id) REFERENCES creators(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX idx_lifecycle_snapshot_stage ON creator_lifecycle_snapshot(stage_key);
CREATE INDEX idx_lifecycle_snapshot_evaluated ON creator_lifecycle_snapshot(evaluated_at);

-- ============================================================
-- Creator Lifecycle Transition — 生命周期迁移历史
-- ============================================================
CREATE TABLE IF NOT EXISTS creator_lifecycle_transition (
    id                  INT AUTO_INCREMENT PRIMARY KEY,
    creator_id          INT NOT NULL,
    from_stage          VARCHAR(32),
    to_stage            VARCHAR(32) NOT NULL,
    trigger_type        VARCHAR(64),
    trigger_id          VARCHAR(64),
    trigger_source      VARCHAR(64),
    reason              TEXT,
    signals_json        JSON,
    flags_json          JSON,
    operator            VARCHAR(64),
    created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_lifecycle_transition_creator FOREIGN KEY (creator_id) REFERENCES creators(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX idx_lifecycle_transition_creator_time ON creator_lifecycle_transition(creator_id, created_at DESC);

-- ============================================================
-- Event Periods — 事件周期记录
-- ============================================================
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

-- ============================================================
-- Events Policy — 事件策略配置
-- ============================================================
CREATE TABLE IF NOT EXISTS events_policy (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    owner           VARCHAR(32) NOT NULL,
    event_key       VARCHAR(64) NOT NULL,
    policy_json     JSON NOT NULL,
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_policy (owner, event_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- Operator Creator Roster — 93 人精准归属表
-- ============================================================
CREATE TABLE IF NOT EXISTS operator_creator_roster (
    id                  INT AUTO_INCREMENT PRIMARY KEY,
    creator_id          INT NOT NULL,
    operator            VARCHAR(32) NOT NULL,
    session_id          VARCHAR(64) NOT NULL,
    source_file         VARCHAR(128) DEFAULT NULL,
    raw_poc             VARCHAR(64) DEFAULT NULL,
    raw_name            VARCHAR(255) DEFAULT NULL,
    raw_handle          VARCHAR(255) DEFAULT NULL,
    raw_keeper_name     VARCHAR(255) DEFAULT NULL,
    marketing_channel   VARCHAR(128) DEFAULT NULL,
    match_strategy      VARCHAR(64) DEFAULT NULL,
    score               INT DEFAULT 0,
    is_primary          TINYINT(1) DEFAULT 1,
    created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at          DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_ocr_creator (creator_id),
    UNIQUE KEY uk_ocr_operator_raw (operator, raw_name(96), raw_handle(96), raw_keeper_name(96)),
    KEY idx_ocr_operator (operator),
    KEY idx_ocr_session (session_id),
    CONSTRAINT fk_ocr_creator FOREIGN KEY (creator_id) REFERENCES creators(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- Operator Directory — v1 负责人名单与 TikTok 映射
-- ============================================================
CREATE TABLE IF NOT EXISTS operator_directory (
    id                  VARCHAR(32) PRIMARY KEY,
    name                VARCHAR(64) NOT NULL,
    session_id          VARCHAR(64) DEFAULT NULL,
    created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at          DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS operator_directory_members (
    id                  INT AUTO_INCREMENT PRIMARY KEY,
    operator_id         VARCHAR(32) NOT NULL,
    creator_name        VARCHAR(255) NOT NULL,
    tiktok_username     VARCHAR(255) DEFAULT NULL,
    created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at          DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_operator_directory_member_name (operator_id, creator_name),
    UNIQUE KEY uk_operator_directory_member_tiktok (operator_id, tiktok_username),
    KEY idx_operator_directory_members_operator (operator_id),
    CONSTRAINT fk_operator_directory_members_operator
        FOREIGN KEY (operator_id) REFERENCES operator_directory(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- WA Sessions — SessionRegistry 的 desired/runtime 状态持久化
-- k8s controller 风格:desired_state = 用户意图,runtime_state = Registry 观察值
-- ============================================================
CREATE TABLE IF NOT EXISTS wa_sessions (
    id                         BIGINT PRIMARY KEY AUTO_INCREMENT,
    session_id                 VARCHAR(64)  NOT NULL,
    owner                      VARCHAR(64)  NOT NULL,
    aliases                    JSON         DEFAULT NULL,
    driver                     VARCHAR(16)  NOT NULL DEFAULT 'wwebjs',
    driver_meta                JSON         DEFAULT NULL,

    desired_state              ENUM('running','stopped') NOT NULL DEFAULT 'running',
    desired_state_changed_at   DATETIME     DEFAULT CURRENT_TIMESTAMP,
    desired_state_changed_by   VARCHAR(64)  DEFAULT NULL,

    runtime_state              ENUM('pending','starting','ready','stale','crashed','stopped') NOT NULL DEFAULT 'pending',
    runtime_phase              VARCHAR(32)  DEFAULT NULL,
    runtime_pid                INT          DEFAULT NULL,
    last_heartbeat_at          DATETIME     DEFAULT NULL,
    last_ready_at              DATETIME     DEFAULT NULL,
    last_exit_code             INT          DEFAULT NULL,
    last_exit_signal           VARCHAR(16)  DEFAULT NULL,
    restart_count              INT          NOT NULL DEFAULT 0,
    last_restart_at            DATETIME     DEFAULT NULL,
    last_error                 TEXT         DEFAULT NULL,

    account_phone              VARCHAR(32)  DEFAULT NULL,
    account_pushname           VARCHAR(128) DEFAULT NULL,
    account_bound_at           DATETIME     DEFAULT NULL,

    created_at                 DATETIME     DEFAULT CURRENT_TIMESTAMP,
    created_by                 VARCHAR(64)  DEFAULT NULL,
    updated_at                 DATETIME     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    owner_if_running           VARCHAR(64) AS (
        CASE WHEN desired_state = 'running' THEN owner ELSE NULL END
    ) STORED,

    UNIQUE KEY uniq_session_id     (session_id),
    UNIQUE KEY uniq_owner_running  (owner_if_running),
    KEY        idx_desired         (desired_state),
    KEY        idx_runtime         (runtime_state),
    KEY        idx_owner           (owner),
    KEY        idx_driver          (driver)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ==========================================
-- Users + Sessions (admin/operator 双角色)
-- ==========================================
-- admin 看全部 owner,operator 只看自己绑定的 operator_name(复用 operatorRoster canonical 名)
-- viewer 跨 owner 只读 + 仅能给自己 operator_name 下的用户发消息(读全部,写限定自己)
-- operator_name 枚举校验放在应用层(参考 server/config/operatorRoster.js),不依赖 MySQL CHECK 约束

CREATE TABLE IF NOT EXISTS users (
    id                  INT AUTO_INCREMENT PRIMARY KEY,
    username            VARCHAR(64) NOT NULL,
    password_hash       VARCHAR(255) NOT NULL,
    role                ENUM('admin','operator','viewer') NOT NULL,
    operator_name       VARCHAR(32) NULL,
    disabled            TINYINT(1) NOT NULL DEFAULT 0,
    failed_login_count  INT NOT NULL DEFAULT 0,
    locked_until        DATETIME NULL,
    password_changed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_login_at       DATETIME NULL,
    created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uniq_users_username (username),
    KEY        idx_users_role_operator (role, operator_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS user_sessions (
    token         CHAR(64) NOT NULL PRIMARY KEY,
    user_id       INT NOT NULL,
    issued_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expires_at    DATETIME NOT NULL,
    last_seen_at  DATETIME NULL,
    revoked_at    DATETIME NULL,
    ip_address    VARCHAR(45) NULL,
    user_agent    VARCHAR(512) NULL,
    KEY idx_user_sessions_user    (user_id, revoked_at),
    KEY idx_user_sessions_expires (expires_at),
    CONSTRAINT fk_user_sessions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- Creator Import Batches — 批量建档 + owner 欢迎消息发送任务
-- ============================================================

CREATE TABLE IF NOT EXISTS operator_outreach_templates (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    owner           VARCHAR(64) NOT NULL,
    template_key    VARCHAR(64) NOT NULL DEFAULT 'welcome',
    label           VARCHAR(128) NOT NULL DEFAULT 'Welcome',
    body            TEXT NOT NULL,
    is_active       TINYINT(1) NOT NULL DEFAULT 1,
    created_by      VARCHAR(64) DEFAULT NULL,
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_outreach_template_owner_key (owner, template_key),
    KEY idx_outreach_template_owner_active (owner, is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS creator_import_batches (
    id                   BIGINT PRIMARY KEY AUTO_INCREMENT,
    owner                VARCHAR(64) NOT NULL,
    source               VARCHAR(64) NOT NULL DEFAULT 'csv-import',
    status               VARCHAR(32) NOT NULL DEFAULT 'queued',
    send_welcome         TINYINT(1) NOT NULL DEFAULT 0,
    welcome_template_id  BIGINT DEFAULT NULL,
    welcome_template_key VARCHAR(64) DEFAULT NULL,
    welcome_text         TEXT DEFAULT NULL,
    total_count          INT NOT NULL DEFAULT 0,
    created_count        INT NOT NULL DEFAULT 0,
    reused_count         INT NOT NULL DEFAULT 0,
    skipped_count        INT NOT NULL DEFAULT 0,
    error_count          INT NOT NULL DEFAULT 0,
    welcome_queued_count INT NOT NULL DEFAULT 0,
    welcome_sent_count   INT NOT NULL DEFAULT 0,
    welcome_failed_count INT NOT NULL DEFAULT 0,
    created_by           VARCHAR(64) DEFAULT NULL,
    started_at           DATETIME DEFAULT NULL,
    completed_at         DATETIME DEFAULT NULL,
    created_at           DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at           DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    KEY idx_creator_import_batches_owner (owner),
    KEY idx_creator_import_batches_status (status),
    KEY idx_creator_import_batches_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS creator_import_items (
    id               BIGINT PRIMARY KEY AUTO_INCREMENT,
    batch_id         BIGINT NOT NULL,
    row_index        INT NOT NULL,
    creator_id       INT DEFAULT NULL,
    owner            VARCHAR(64) NOT NULL,
    input_name       VARCHAR(255) DEFAULT NULL,
    input_phone      VARCHAR(64) DEFAULT NULL,
    normalized_name  VARCHAR(255) DEFAULT NULL,
    normalized_phone VARCHAR(32) DEFAULT NULL,
    import_status    VARCHAR(32) NOT NULL DEFAULT 'pending',
    send_status      VARCHAR(32) NOT NULL DEFAULT 'not_requested',
    error            TEXT DEFAULT NULL,
    wa_message_id    VARCHAR(255) DEFAULT NULL,
    routed_session_id VARCHAR(64) DEFAULT NULL,
    routed_operator  VARCHAR(64) DEFAULT NULL,
    attempt_count    INT NOT NULL DEFAULT 0,
    last_attempt_at  DATETIME DEFAULT NULL,
    sent_at          DATETIME DEFAULT NULL,
    created_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at       DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_creator_import_item_batch_row (batch_id, row_index),
    KEY idx_creator_import_items_batch (batch_id),
    KEY idx_creator_import_items_creator (creator_id),
    KEY idx_creator_import_items_send_status (send_status),
    CONSTRAINT fk_creator_import_items_batch
        FOREIGN KEY (batch_id) REFERENCES creator_import_batches(id) ON DELETE CASCADE,
    CONSTRAINT fk_creator_import_items_creator
        FOREIGN KEY (creator_id) REFERENCES creators(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- AI Provider Configs (Phase 0 Admin LLM Config)
-- ============================================================
-- 6 个 purpose 的 LLM 配置中心 + 使用流水 + 日聚合。
-- 阶段 0 只建表、种默认 env-default 行;openai.js 的改造在阶段 1。
-- is_active=1 的唯一性由 aiProviderConfigService 层保障(activate 时先置 0 后置 1)。

CREATE TABLE IF NOT EXISTS ai_provider_configs (
    id               INT AUTO_INCREMENT PRIMARY KEY,
    purpose          VARCHAR(64)  NOT NULL,
    name             VARCHAR(128) NOT NULL,
    model            VARCHAR(128) NOT NULL,
    base_url         VARCHAR(512) NOT NULL,
    api_key          TEXT         NOT NULL,
    extra_params     JSON         NULL,
    is_active        TINYINT(1)   NOT NULL DEFAULT 0,
    notes            TEXT         NULL,
    created_by       VARCHAR(128) NULL,
    created_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uniq_purpose_name (purpose, name),
    KEY idx_purpose_active (purpose, is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ai_usage_logs (
    id                  BIGINT AUTO_INCREMENT PRIMARY KEY,
    provider_config_id  INT          NULL,
    purpose             VARCHAR(64)  NOT NULL,
    model               VARCHAR(128) NOT NULL,
    tokens_prompt       INT          NOT NULL DEFAULT 0,
    tokens_completion   INT          NOT NULL DEFAULT 0,
    tokens_total        INT          NOT NULL DEFAULT 0,
    latency_ms          INT          NULL,
    status              VARCHAR(32)  NOT NULL DEFAULT 'ok',
    error_message       TEXT         NULL,
    source              VARCHAR(128) NULL,
    creator_id          INT          NULL,
    created_at          DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_purpose_time (purpose, created_at),
    KEY idx_config_time (provider_config_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ai_usage_daily (
    date                DATE         NOT NULL,
    purpose             VARCHAR(64)  NOT NULL,
    provider_config_id  INT          NOT NULL DEFAULT 0,
    model               VARCHAR(128) NOT NULL DEFAULT '',
    request_count       INT          NOT NULL DEFAULT 0,
    tokens_prompt       BIGINT       NOT NULL DEFAULT 0,
    tokens_completion   BIGINT       NOT NULL DEFAULT 0,
    tokens_total        BIGINT       NOT NULL DEFAULT 0,
    error_count         INT          NOT NULL DEFAULT 0,
    total_latency_ms    BIGINT       NOT NULL DEFAULT 0,
    PRIMARY KEY (date, purpose, provider_config_id),
    KEY idx_date (date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
