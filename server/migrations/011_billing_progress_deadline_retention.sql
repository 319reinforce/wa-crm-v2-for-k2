-- Billing/progress/deadline ownership + retention/archive job tables.
-- Moves remaining lifecycle-adjacent operational fields out of wa_crm_data.

CREATE TABLE IF NOT EXISTS event_billing_facts (
    id                  BIGINT AUTO_INCREMENT PRIMARY KEY,
    creator_id          INT NOT NULL,
    event_id            INT NULL,
    event_key           VARCHAR(64) NOT NULL DEFAULT 'monthly_challenge',
    billing_key         VARCHAR(64) NOT NULL DEFAULT 'monthly_fee',
    amount              DECIMAL(12,2) NULL,
    currency            VARCHAR(8) NOT NULL DEFAULT 'USD',
    billing_status      VARCHAR(32) NULL,
    effective_at        DATETIME NULL,
    source_kind         VARCHAR(32) NOT NULL DEFAULT 'operator',
    source_record_id    VARCHAR(128) NULL,
    meta_json           JSON NULL,
    created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_event_billing_fact_creator FOREIGN KEY (creator_id) REFERENCES creators(id) ON DELETE CASCADE,
    CONSTRAINT fk_event_billing_fact_event FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE SET NULL,
    KEY idx_event_billing_creator_key (creator_id, billing_key, created_at),
    KEY idx_event_billing_event (event_id),
    KEY idx_event_billing_effective (effective_at),
    KEY idx_event_billing_source (source_kind, source_record_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS event_progress_facts (
    id                  BIGINT AUTO_INCREMENT PRIMARY KEY,
    creator_id          INT NOT NULL,
    event_id            INT NULL,
    event_key           VARCHAR(64) NOT NULL DEFAULT 'monthly_challenge',
    progress_key        VARCHAR(64) NOT NULL DEFAULT 'video_progress',
    period_start        DATETIME NULL,
    period_end          DATETIME NULL,
    video_count         INT NULL,
    video_target        INT NULL,
    last_checked_at     DATETIME NULL,
    observed_at         DATETIME NULL,
    source_kind         VARCHAR(32) NOT NULL DEFAULT 'operator',
    source_record_id    VARCHAR(128) NULL,
    meta_json           JSON NULL,
    created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_event_progress_fact_creator FOREIGN KEY (creator_id) REFERENCES creators(id) ON DELETE CASCADE,
    CONSTRAINT fk_event_progress_fact_event FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE SET NULL,
    KEY idx_event_progress_creator_key (creator_id, progress_key, created_at),
    KEY idx_event_progress_event (event_id),
    KEY idx_event_progress_observed (observed_at),
    KEY idx_event_progress_source (source_kind, source_record_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS event_deadline_facts (
    id                  BIGINT AUTO_INCREMENT PRIMARY KEY,
    creator_id          INT NOT NULL,
    event_id            INT NULL,
    event_key           VARCHAR(64) NOT NULL DEFAULT 'agency_bound',
    deadline_key        VARCHAR(64) NOT NULL DEFAULT 'agency_deadline',
    deadline_at         DATETIME NULL,
    status              VARCHAR(24) NOT NULL DEFAULT 'active',
    source_kind         VARCHAR(32) NOT NULL DEFAULT 'operator',
    source_record_id    VARCHAR(128) NULL,
    meta_json           JSON NULL,
    created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_event_deadline_fact_creator FOREIGN KEY (creator_id) REFERENCES creators(id) ON DELETE CASCADE,
    CONSTRAINT fk_event_deadline_fact_event FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE SET NULL,
    KEY idx_event_deadline_creator_key (creator_id, deadline_key, created_at),
    KEY idx_event_deadline_event (event_id),
    KEY idx_event_deadline_at (deadline_at),
    KEY idx_event_deadline_source (source_kind, source_record_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO event_billing_facts (
    creator_id, event_id, event_key, billing_key, amount, currency,
    billing_status, effective_at, source_kind, source_record_id, meta_json
)
SELECT
    wc.creator_id,
    ev.id AS event_id,
    'monthly_challenge',
    'monthly_fee',
    wc.monthly_fee_amount,
    'USD',
    NULLIF(wc.monthly_fee_status, ''),
    CURRENT_TIMESTAMP,
    'migration',
    CAST(wc.creator_id AS CHAR),
    JSON_OBJECT(
        'migration_source', '011_billing_progress_deadline_retention',
        'source_table', 'wa_crm_data',
        'requested_fields', JSON_ARRAY('wa_crm_data.monthly_fee_amount')
    )
FROM wa_crm_data wc
LEFT JOIN (
    SELECT creator_id, MAX(id) AS id
    FROM events
    WHERE event_key = 'monthly_challenge'
      AND status IN ('active', 'completed', 'draft')
    GROUP BY creator_id
) ev ON ev.creator_id = wc.creator_id
WHERE wc.monthly_fee_amount IS NOT NULL
  AND NOT EXISTS (
      SELECT 1
      FROM event_billing_facts existing
      WHERE existing.creator_id = wc.creator_id
        AND existing.billing_key = 'monthly_fee'
        AND existing.source_kind = 'migration'
        AND CAST(existing.source_record_id AS UNSIGNED) = wc.creator_id
  );

INSERT INTO event_progress_facts (
    creator_id, event_id, event_key, progress_key, video_count,
    video_target, last_checked_at, observed_at, source_kind,
    source_record_id, meta_json
)
SELECT
    wc.creator_id,
    ev.id AS event_id,
    'monthly_challenge',
    'video_progress',
    wc.video_count,
    wc.video_target,
    CASE
        WHEN wc.video_last_checked IS NULL OR wc.video_last_checked = 0 THEN NULL
        WHEN wc.video_last_checked > 1000000000000 THEN FROM_UNIXTIME(wc.video_last_checked / 1000)
        WHEN wc.video_last_checked > 1000000000 THEN FROM_UNIXTIME(wc.video_last_checked)
        ELSE NULL
    END AS last_checked_at,
    COALESCE(
        CASE
            WHEN wc.video_last_checked IS NULL OR wc.video_last_checked = 0 THEN NULL
            WHEN wc.video_last_checked > 1000000000000 THEN FROM_UNIXTIME(wc.video_last_checked / 1000)
            WHEN wc.video_last_checked > 1000000000 THEN FROM_UNIXTIME(wc.video_last_checked)
            ELSE NULL
        END,
        CURRENT_TIMESTAMP
    ) AS observed_at,
    'migration',
    CAST(wc.creator_id AS CHAR),
    JSON_OBJECT(
        'migration_source', '011_billing_progress_deadline_retention',
        'source_table', 'wa_crm_data',
        'requested_fields', JSON_ARRAY('wa_crm_data.video_count', 'wa_crm_data.video_target', 'wa_crm_data.video_last_checked')
    )
FROM wa_crm_data wc
LEFT JOIN (
    SELECT creator_id, MAX(id) AS id
    FROM events
    WHERE event_key = 'monthly_challenge'
      AND status IN ('active', 'completed', 'draft')
    GROUP BY creator_id
) ev ON ev.creator_id = wc.creator_id
WHERE (wc.video_count IS NOT NULL OR wc.video_target IS NOT NULL OR wc.video_last_checked IS NOT NULL)
  AND NOT EXISTS (
      SELECT 1
      FROM event_progress_facts existing
      WHERE existing.creator_id = wc.creator_id
        AND existing.progress_key = 'video_progress'
        AND existing.source_kind = 'migration'
        AND CAST(existing.source_record_id AS UNSIGNED) = wc.creator_id
  );

INSERT INTO event_deadline_facts (
    creator_id, event_id, event_key, deadline_key, deadline_at,
    status, source_kind, source_record_id, meta_json
)
SELECT
    wc.creator_id,
    ev.id AS event_id,
    'agency_bound',
    'agency_deadline',
    CASE
        WHEN wc.agency_deadline IS NULL OR wc.agency_deadline = 0 THEN NULL
        WHEN wc.agency_deadline > 1000000000000 THEN FROM_UNIXTIME(wc.agency_deadline / 1000)
        WHEN wc.agency_deadline > 1000000000 THEN FROM_UNIXTIME(wc.agency_deadline)
        ELSE NULL
    END AS deadline_at,
    CASE WHEN wc.agency_deadline IS NULL OR wc.agency_deadline = 0 THEN 'cleared' ELSE 'active' END,
    'migration',
    CAST(wc.creator_id AS CHAR),
    JSON_OBJECT(
        'migration_source', '011_billing_progress_deadline_retention',
        'source_table', 'wa_crm_data',
        'requested_fields', JSON_ARRAY('wa_crm_data.agency_deadline')
    )
FROM wa_crm_data wc
LEFT JOIN (
    SELECT creator_id, MAX(id) AS id
    FROM events
    WHERE event_key = 'agency_bound'
      AND status IN ('active', 'completed', 'draft')
    GROUP BY creator_id
) ev ON ev.creator_id = wc.creator_id
WHERE wc.agency_deadline IS NOT NULL
  AND NOT EXISTS (
      SELECT 1
      FROM event_deadline_facts existing
      WHERE existing.creator_id = wc.creator_id
        AND existing.deadline_key = 'agency_deadline'
        AND existing.source_kind = 'migration'
        AND CAST(existing.source_record_id AS UNSIGNED) = wc.creator_id
  );

CREATE TABLE IF NOT EXISTS data_retention_policies (
    policy_key          VARCHAR(64) PRIMARY KEY,
    table_name          VARCHAR(64) NOT NULL,
    date_column         VARCHAR(64) NOT NULL DEFAULT 'created_at',
    hot_window_days     INT NOT NULL,
    archive_after_days  INT NOT NULL,
    purge_after_days    INT NULL,
    archive_mode        VARCHAR(32) NOT NULL DEFAULT 'reference_only',
    batch_size          INT NOT NULL DEFAULT 500,
    enabled             TINYINT(1) NOT NULL DEFAULT 1,
    config_json         JSON NULL,
    created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    KEY idx_retention_policy_table (table_name),
    KEY idx_retention_policy_enabled (enabled)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS data_retention_runs (
    id                  BIGINT AUTO_INCREMENT PRIMARY KEY,
    policy_key          VARCHAR(64) NOT NULL,
    status              VARCHAR(24) NOT NULL DEFAULT 'running',
    dry_run             TINYINT(1) NOT NULL DEFAULT 1,
    scanned_count       INT NOT NULL DEFAULT 0,
    archived_count      INT NOT NULL DEFAULT 0,
    purged_count         INT NOT NULL DEFAULT 0,
    skipped_count        INT NOT NULL DEFAULT 0,
    error_count          INT NOT NULL DEFAULT 0,
    error_message        TEXT NULL,
    started_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at        DATETIME NULL,
    triggered_by        VARCHAR(64) NOT NULL DEFAULT 'system',
    meta_json           JSON NULL,
    KEY idx_retention_runs_policy_time (policy_key, started_at),
    KEY idx_retention_runs_status (status),
    CONSTRAINT fk_retention_run_policy FOREIGN KEY (policy_key) REFERENCES data_retention_policies(policy_key) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS data_retention_archive_refs (
    id                  BIGINT AUTO_INCREMENT PRIMARY KEY,
    policy_key          VARCHAR(64) NOT NULL,
    run_id              BIGINT NULL,
    table_name          VARCHAR(64) NOT NULL,
    record_id           VARCHAR(128) NOT NULL,
    action              VARCHAR(32) NOT NULL DEFAULT 'archive_mark',
    record_created_at   DATETIME NULL,
    archived_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    meta_json           JSON NULL,
    UNIQUE KEY uk_retention_archive_ref (policy_key, table_name, record_id, action),
    KEY idx_retention_archive_run (run_id),
    KEY idx_retention_archive_table_time (table_name, archived_at),
    CONSTRAINT fk_retention_archive_policy FOREIGN KEY (policy_key) REFERENCES data_retention_policies(policy_key) ON DELETE RESTRICT,
    CONSTRAINT fk_retention_archive_run FOREIGN KEY (run_id) REFERENCES data_retention_runs(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO data_retention_policies (
    policy_key, table_name, date_column, hot_window_days, archive_after_days, purge_after_days, archive_mode, batch_size, enabled, config_json
) VALUES
('generation_log_90d', 'generation_log', 'created_at', 90, 90, NULL, 'reference_only', 500, 1, JSON_OBJECT('keep_if_linked_table', 'sft_memory', 'keep_if_linked_column', 'generation_log_id')),
('retrieval_snapshot_90d', 'retrieval_snapshot', 'created_at', 90, 90, NULL, 'reference_only', 500, 1, JSON_OBJECT('keep_if_linked_table', 'sft_memory', 'keep_if_linked_column', 'retrieval_snapshot_id')),
('ai_usage_logs_180d', 'ai_usage_logs', 'created_at', 180, 180, NULL, 'daily_rollup_then_reference', 1000, 1, JSON_OBJECT('rollup_table', 'ai_usage_daily')),
('audit_log_365d', 'audit_log', 'created_at', 365, 365, NULL, 'monthly_archive_reference', 500, 1, JSON_OBJECT('no_delete', true)),
('wa_messages_365d', 'wa_messages', 'created_at', 365, 365, NULL, 'creator_month_reference', 500, 1, JSON_OBJECT('keep_event_evidence', true)),
('wa_group_messages_180d', 'wa_group_messages', 'created_at', 180, 180, NULL, 'group_month_reference', 500, 1, JSON_OBJECT('keep_creator_evidence', true)),
('media_assets_30d', 'media_assets', 'created_at', 30, 30, NULL, 'media_tier_cold', 250, 1, JSON_OBJECT('respect_cleanup_exemptions', true))
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
