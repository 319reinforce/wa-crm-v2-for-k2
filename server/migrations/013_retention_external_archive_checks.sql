-- External archive verification gate for retention hard deletes.
-- WA message purges must have a verified external archive check covering the purge cutoff.

CREATE TABLE IF NOT EXISTS data_retention_external_archive_checks (
    id                BIGINT AUTO_INCREMENT PRIMARY KEY,
    policy_key        VARCHAR(64) NOT NULL,
    table_name        VARCHAR(64) NOT NULL,
    archive_uri       VARCHAR(1024) NOT NULL,
    manifest_sha256   VARCHAR(128) NULL,
    covered_before    DATETIME NOT NULL,
    record_count      BIGINT NOT NULL DEFAULT 0,
    status            VARCHAR(32) NOT NULL DEFAULT 'verified',
    checked_by        VARCHAR(128) NULL,
    checked_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at        DATETIME NULL,
    meta_json         JSON NULL,
    CONSTRAINT fk_retention_external_archive_policy
        FOREIGN KEY (policy_key) REFERENCES data_retention_policies(policy_key) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET @has_idx_retention_external_archive_policy := (
    SELECT COUNT(*) FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'data_retention_external_archive_checks'
      AND index_name = 'idx_retention_external_archive_policy'
);
SET @sql_stmt := IF(
    @has_idx_retention_external_archive_policy = 0,
    'CREATE INDEX idx_retention_external_archive_policy ON data_retention_external_archive_checks(policy_key, table_name, status)',
    'SELECT ''idx_retention_external_archive_policy exists'' AS status'
);
PREPARE stmt FROM @sql_stmt;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_idx_retention_external_archive_covered := (
    SELECT COUNT(*) FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'data_retention_external_archive_checks'
      AND index_name = 'idx_retention_external_archive_covered'
);
SET @sql_stmt := IF(
    @has_idx_retention_external_archive_covered = 0,
    'CREATE INDEX idx_retention_external_archive_covered ON data_retention_external_archive_checks(table_name, covered_before)',
    'SELECT ''idx_retention_external_archive_covered exists'' AS status'
);
PREPARE stmt FROM @sql_stmt;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_idx_retention_external_archive_expires := (
    SELECT COUNT(*) FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'data_retention_external_archive_checks'
      AND index_name = 'idx_retention_external_archive_expires'
);
SET @sql_stmt := IF(
    @has_idx_retention_external_archive_expires = 0,
    'CREATE INDEX idx_retention_external_archive_expires ON data_retention_external_archive_checks(expires_at)',
    'SELECT ''idx_retention_external_archive_expires exists'' AS status'
);
PREPARE stmt FROM @sql_stmt;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

UPDATE data_retention_policies
SET config_json = JSON_SET(
        COALESCE(config_json, JSON_OBJECT()),
        '$.hard_delete_requires_external_archive', true,
        '$.external_archive_verification_table', 'data_retention_external_archive_checks'
    ),
    updated_at = CURRENT_TIMESTAMP
WHERE policy_key IN ('wa_messages_365d', 'wa_group_messages_180d');
