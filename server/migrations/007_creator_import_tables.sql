-- Creator import and owner welcome template tables.
-- Adds explicit migration coverage for tables already present in schema.sql.

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
    id                BIGINT PRIMARY KEY AUTO_INCREMENT,
    batch_id          BIGINT NOT NULL,
    row_index         INT NOT NULL,
    creator_id        INT DEFAULT NULL,
    owner             VARCHAR(64) NOT NULL,
    input_name        VARCHAR(255) DEFAULT NULL,
    input_phone       VARCHAR(64) DEFAULT NULL,
    normalized_name   VARCHAR(255) DEFAULT NULL,
    normalized_phone  VARCHAR(32) DEFAULT NULL,
    import_status     VARCHAR(32) NOT NULL DEFAULT 'pending',
    send_status       VARCHAR(32) NOT NULL DEFAULT 'not_requested',
    error             TEXT DEFAULT NULL,
    wa_message_id     VARCHAR(255) DEFAULT NULL,
    routed_session_id VARCHAR(64) DEFAULT NULL,
    routed_operator   VARCHAR(64) DEFAULT NULL,
    attempt_count     INT NOT NULL DEFAULT 0,
    last_attempt_at   DATETIME DEFAULT NULL,
    sent_at           DATETIME DEFAULT NULL,
    created_at        DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at        DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_creator_import_item_batch_row (batch_id, row_index),
    KEY idx_creator_import_items_batch (batch_id),
    KEY idx_creator_import_items_creator (creator_id),
    KEY idx_creator_import_items_send_status (send_status),
    CONSTRAINT fk_creator_import_items_batch
        FOREIGN KEY (batch_id) REFERENCES creator_import_batches(id) ON DELETE CASCADE,
    CONSTRAINT fk_creator_import_items_creator
        FOREIGN KEY (creator_id) REFERENCES creators(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
