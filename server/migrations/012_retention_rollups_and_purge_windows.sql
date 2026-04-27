-- Retention rollups + explicit purge windows.
-- Keeps destructive deletes gated behind service-level --purge support.

CREATE TABLE IF NOT EXISTS message_archive_monthly_rollups (
    id                       BIGINT AUTO_INCREMENT PRIMARY KEY,
    table_name               VARCHAR(64) NOT NULL,
    archive_month            DATE NOT NULL,
    creator_id               INT NOT NULL DEFAULT 0,
    group_chat_id            BIGINT NOT NULL DEFAULT 0,
    operator                 VARCHAR(32) NOT NULL DEFAULT '',
    message_count            INT NOT NULL DEFAULT 0,
    user_message_count       INT NOT NULL DEFAULT 0,
    me_message_count         INT NOT NULL DEFAULT 0,
    assistant_message_count  INT NOT NULL DEFAULT 0,
    media_message_count      INT NOT NULL DEFAULT 0,
    first_message_timestamp  BIGINT NULL,
    last_message_timestamp   BIGINT NULL,
    record_created_min       DATETIME NULL,
    record_created_max       DATETIME NULL,
    archive_after_days       INT NOT NULL,
    run_id                   BIGINT NULL,
    created_at               DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at               DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_message_archive_monthly (table_name, archive_month, creator_id, group_chat_id, operator),
    KEY idx_message_archive_month (archive_month),
    KEY idx_message_archive_creator (creator_id),
    KEY idx_message_archive_group (group_chat_id),
    CONSTRAINT fk_message_archive_rollup_run FOREIGN KEY (run_id) REFERENCES data_retention_runs(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO data_retention_policies (
    policy_key, table_name, date_column, hot_window_days, archive_after_days, purge_after_days, archive_mode, batch_size, enabled, config_json
) VALUES
('generation_log_90d', 'generation_log', 'created_at', 90, 90, 365, 'reference_only', 500, 1, JSON_OBJECT('keep_if_linked_table', 'sft_memory', 'keep_if_linked_column', 'generation_log_id')),
('retrieval_snapshot_90d', 'retrieval_snapshot', 'created_at', 90, 90, 365, 'reference_only', 500, 1, JSON_OBJECT('keep_if_linked_table', 'sft_memory', 'keep_if_linked_column', 'retrieval_snapshot_id')),
('ai_usage_logs_180d', 'ai_usage_logs', 'created_at', 180, 180, 730, 'daily_rollup_then_reference', 1000, 1, JSON_OBJECT('rollup_table', 'ai_usage_daily')),
('audit_log_365d', 'audit_log', 'created_at', 365, 365, NULL, 'monthly_archive_reference', 500, 1, JSON_OBJECT('no_delete', true)),
('wa_messages_365d', 'wa_messages', 'created_at', 365, 365, 1095, 'creator_month_reference', 500, 1, JSON_OBJECT('keep_event_evidence', true, 'rollup_table', 'message_archive_monthly_rollups', 'hard_delete_requires_external_archive', true)),
('wa_group_messages_180d', 'wa_group_messages', 'created_at', 180, 180, 730, 'group_month_reference', 500, 1, JSON_OBJECT('keep_creator_evidence', true, 'rollup_table', 'message_archive_monthly_rollups', 'hard_delete_requires_external_archive', true)),
('media_assets_30d', 'media_assets', 'created_at', 30, 30, 90, 'media_tier_cold', 250, 1, JSON_OBJECT('respect_cleanup_exemptions', true, 'hard_delete_owned_by_media_cleanup_service', true))
ON DUPLICATE KEY UPDATE
    table_name = VALUES(table_name),
    date_column = VALUES(date_column),
    hot_window_days = VALUES(hot_window_days),
    archive_after_days = VALUES(archive_after_days),
    purge_after_days = VALUES(purge_after_days),
    archive_mode = VALUES(archive_mode),
    batch_size = VALUES(batch_size),
    enabled = VALUES(enabled),
    config_json = VALUES(config_json),
    updated_at = CURRENT_TIMESTAMP;
