-- Managed template/media/training tables schema migration.
-- Moves remaining service-time DDL into the explicit migration path.

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
    UNIQUE KEY uk_custom_topic_owner_label (owner_scope, label),
    KEY idx_ctt_active_updated (is_active, updated_at),
    KEY idx_ctt_owner (owner_scope)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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
    FOREIGN KEY (creator_id) REFERENCES creators(id) ON DELETE SET NULL,
    KEY idx_media_assets_creator (creator_id),
    KEY idx_media_assets_status (status),
    KEY idx_media_assets_hash (sha256_hash),
    KEY idx_media_assets_storage_tier (storage_tier),
    KEY idx_media_assets_deleted_at (deleted_at),
    KEY idx_media_assets_cleanup_job (cleanup_job_id),
    KEY idx_media_assets_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS cleanup_jobs (
    id                  BIGINT AUTO_INCREMENT PRIMARY KEY,
    job_type            VARCHAR(32) NOT NULL COMMENT "'retention'|'manual'|'purge'",
    retention_days      INT NULL COMMENT '保留天数（retention 类型）',
    status              VARCHAR(16) NOT NULL DEFAULT 'running' COMMENT 'running|completed|failed',
    total_candidates    INT NOT NULL DEFAULT 0,
    candidates_checked  INT NOT NULL DEFAULT 0,
    candidates_deleted  INT NOT NULL DEFAULT 0,
    candidates_skipped  INT NOT NULL DEFAULT 0,
    started_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at        DATETIME NULL,
    triggered_by        VARCHAR(64) NOT NULL DEFAULT 'system' COMMENT "'system'|'cron'|'manual'|'script'",
    triggered_by_user   VARCHAR(64) NULL,
    note                TEXT NULL,
    error_message       TEXT NULL,
    KEY idx_cleanup_jobs_status (status),
    KEY idx_cleanup_jobs_started (started_at DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS cleanup_exemptions (
    id                  BIGINT AUTO_INCREMENT PRIMARY KEY,
    media_asset_id      BIGINT NOT NULL,
    exempted_by         VARCHAR(64) NOT NULL,
    exemption_reason    VARCHAR(255) NOT NULL,
    exempted_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at          DATETIME NULL COMMENT 'NULL = 永久豁免',
    created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (media_asset_id) REFERENCES media_assets(id) ON DELETE CASCADE,
    UNIQUE KEY idx_exemptions_asset (media_asset_id),
    KEY idx_exemptions_expiry (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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
    FOREIGN KEY (creator_id) REFERENCES creators(id) ON DELETE SET NULL,
    KEY idx_media_send_creator_created (creator_id, created_at),
    KEY idx_media_send_status_created (status, created_at),
    KEY idx_media_send_asset (media_asset_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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

-- Backward-compatible column coverage for environments where these tables
-- were first created by older service-time DDL.
SET @has_custom_media_items_json := (
    SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'custom_topic_templates'
      AND column_name = 'media_items_json'
);
SET @sql_stmt := IF(
    @has_custom_media_items_json = 0,
    'ALTER TABLE custom_topic_templates ADD COLUMN media_items_json TEXT NULL AFTER template_text',
    'SELECT ''custom_topic_templates.media_items_json exists'' AS status'
);
PREPARE stmt FROM @sql_stmt;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_media_storage_tier := (
    SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'media_assets'
      AND column_name = 'storage_tier'
);
SET @sql_stmt := IF(
    @has_media_storage_tier = 0,
    'ALTER TABLE media_assets ADD COLUMN storage_tier VARCHAR(16) NOT NULL DEFAULT ''hot'' COMMENT ''hot|warm|cold|deleted'' AFTER status',
    'SELECT ''media_assets.storage_tier exists'' AS status'
);
PREPARE stmt FROM @sql_stmt;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_media_original_size := (
    SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'media_assets'
      AND column_name = 'original_size'
);
SET @sql_stmt := IF(
    @has_media_original_size = 0,
    'ALTER TABLE media_assets ADD COLUMN original_size BIGINT NULL COMMENT ''压缩前原始大小'' AFTER storage_tier',
    'SELECT ''media_assets.original_size exists'' AS status'
);
PREPARE stmt FROM @sql_stmt;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_media_compressed_at := (
    SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'media_assets'
      AND column_name = 'compressed_at'
);
SET @sql_stmt := IF(
    @has_media_compressed_at = 0,
    'ALTER TABLE media_assets ADD COLUMN compressed_at DATETIME NULL COMMENT ''压缩完成时间'' AFTER original_size',
    'SELECT ''media_assets.compressed_at exists'' AS status'
);
PREPARE stmt FROM @sql_stmt;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_media_deleted_at := (
    SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'media_assets'
      AND column_name = 'deleted_at'
);
SET @sql_stmt := IF(
    @has_media_deleted_at = 0,
    'ALTER TABLE media_assets ADD COLUMN deleted_at DATETIME NULL COMMENT ''软删除时间'' AFTER compressed_at',
    'SELECT ''media_assets.deleted_at exists'' AS status'
);
PREPARE stmt FROM @sql_stmt;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_media_cleanup_job_id := (
    SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'media_assets'
      AND column_name = 'cleanup_job_id'
);
SET @sql_stmt := IF(
    @has_media_cleanup_job_id = 0,
    'ALTER TABLE media_assets ADD COLUMN cleanup_job_id BIGINT NULL COMMENT ''FK to cleanup_jobs.id'' AFTER deleted_at',
    'SELECT ''media_assets.cleanup_job_id exists'' AS status'
);
PREPARE stmt FROM @sql_stmt;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
