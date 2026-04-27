-- Event/lifecycle fact model additive migration.
-- This migration is intentionally additive and backward compatible.

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

SET @has_events_canonical_event_key := (
    SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'events'
      AND column_name = 'canonical_event_key'
);
SET @sql_stmt := IF(
    @has_events_canonical_event_key = 0,
    'ALTER TABLE events ADD COLUMN canonical_event_key VARCHAR(64) NULL AFTER event_key',
    'SELECT ''events.canonical_event_key exists'' AS status'
);
PREPARE stmt FROM @sql_stmt;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_events_event_state := (
    SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'events'
      AND column_name = 'event_state'
);
SET @sql_stmt := IF(
    @has_events_event_state = 0,
    'ALTER TABLE events ADD COLUMN event_state VARCHAR(24) NULL AFTER status',
    'SELECT ''events.event_state exists'' AS status'
);
PREPARE stmt FROM @sql_stmt;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_events_review_state := (
    SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'events'
      AND column_name = 'review_state'
);
SET @sql_stmt := IF(
    @has_events_review_state = 0,
    'ALTER TABLE events ADD COLUMN review_state VARCHAR(24) NULL AFTER event_state',
    'SELECT ''events.review_state exists'' AS status'
);
PREPARE stmt FROM @sql_stmt;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_events_evidence_tier := (
    SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'events'
      AND column_name = 'evidence_tier'
);
SET @sql_stmt := IF(
    @has_events_evidence_tier = 0,
    'ALTER TABLE events ADD COLUMN evidence_tier TINYINT NULL AFTER review_state',
    'SELECT ''events.evidence_tier exists'' AS status'
);
PREPARE stmt FROM @sql_stmt;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_events_source_kind := (
    SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'events'
      AND column_name = 'source_kind'
);
SET @sql_stmt := IF(
    @has_events_source_kind = 0,
    'ALTER TABLE events ADD COLUMN source_kind VARCHAR(32) NULL AFTER evidence_tier',
    'SELECT ''events.source_kind exists'' AS status'
);
PREPARE stmt FROM @sql_stmt;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_events_source_event_at := (
    SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'events'
      AND column_name = 'source_event_at'
);
SET @sql_stmt := IF(
    @has_events_source_event_at = 0,
    'ALTER TABLE events ADD COLUMN source_event_at DATETIME NULL AFTER source_kind',
    'SELECT ''events.source_event_at exists'' AS status'
);
PREPARE stmt FROM @sql_stmt;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_events_detected_at := (
    SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'events'
      AND column_name = 'detected_at'
);
SET @sql_stmt := IF(
    @has_events_detected_at = 0,
    'ALTER TABLE events ADD COLUMN detected_at DATETIME NULL AFTER source_event_at',
    'SELECT ''events.detected_at exists'' AS status'
);
PREPARE stmt FROM @sql_stmt;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_events_verified_at := (
    SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'events'
      AND column_name = 'verified_at'
);
SET @sql_stmt := IF(
    @has_events_verified_at = 0,
    'ALTER TABLE events ADD COLUMN verified_at DATETIME NULL AFTER detected_at',
    'SELECT ''events.verified_at exists'' AS status'
);
PREPARE stmt FROM @sql_stmt;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_events_verified_by := (
    SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'events'
      AND column_name = 'verified_by'
);
SET @sql_stmt := IF(
    @has_events_verified_by = 0,
    'ALTER TABLE events ADD COLUMN verified_by VARCHAR(64) NULL AFTER verified_at',
    'SELECT ''events.verified_by exists'' AS status'
);
PREPARE stmt FROM @sql_stmt;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_events_idempotency_key := (
    SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'events'
      AND column_name = 'idempotency_key'
);
SET @sql_stmt := IF(
    @has_events_idempotency_key = 0,
    'ALTER TABLE events ADD COLUMN idempotency_key VARCHAR(128) NULL AFTER verified_by',
    'SELECT ''events.idempotency_key exists'' AS status'
);
PREPARE stmt FROM @sql_stmt;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_events_lifecycle_effect := (
    SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'events'
      AND column_name = 'lifecycle_effect'
);
SET @sql_stmt := IF(
    @has_events_lifecycle_effect = 0,
    'ALTER TABLE events ADD COLUMN lifecycle_effect VARCHAR(32) NULL AFTER idempotency_key',
    'SELECT ''events.lifecycle_effect exists'' AS status'
);
PREPARE stmt FROM @sql_stmt;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_events_expires_at := (
    SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'events'
      AND column_name = 'expires_at'
);
SET @sql_stmt := IF(
    @has_events_expires_at = 0,
    'ALTER TABLE events ADD COLUMN expires_at DATETIME NULL AFTER lifecycle_effect',
    'SELECT ''events.expires_at exists'' AS status'
);
PREPARE stmt FROM @sql_stmt;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_idx_events_canonical_state := (
    SELECT COUNT(*) FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'events'
      AND index_name = 'idx_events_canonical_state'
);
SET @sql_stmt := IF(
    @has_idx_events_canonical_state = 0,
    'CREATE INDEX idx_events_canonical_state ON events(canonical_event_key, event_state)',
    'SELECT ''idx_events_canonical_state exists'' AS status'
);
PREPARE stmt FROM @sql_stmt;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_idx_events_source_event_at := (
    SELECT COUNT(*) FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'events'
      AND index_name = 'idx_events_source_event_at'
);
SET @sql_stmt := IF(
    @has_idx_events_source_event_at = 0,
    'CREATE INDEX idx_events_source_event_at ON events(source_event_at)',
    'SELECT ''idx_events_source_event_at exists'' AS status'
);
PREPARE stmt FROM @sql_stmt;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_idx_events_idempotency := (
    SELECT COUNT(*) FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'events'
      AND index_name = 'idx_events_idempotency'
);
SET @sql_stmt := IF(
    @has_idx_events_idempotency = 0,
    'CREATE UNIQUE INDEX idx_events_idempotency ON events(idempotency_key)',
    'SELECT ''idx_events_idempotency exists'' AS status'
);
PREPARE stmt FROM @sql_stmt;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

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

SET @has_idx_event_evidence_event := (
    SELECT COUNT(*) FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'event_evidence'
      AND index_name = 'idx_event_evidence_event'
);
SET @sql_stmt := IF(
    @has_idx_event_evidence_event = 0,
    'CREATE INDEX idx_event_evidence_event ON event_evidence(event_id)',
    'SELECT ''idx_event_evidence_event exists'' AS status'
);
PREPARE stmt FROM @sql_stmt;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_idx_event_evidence_message := (
    SELECT COUNT(*) FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'event_evidence'
      AND index_name = 'idx_event_evidence_message'
);
SET @sql_stmt := IF(
    @has_idx_event_evidence_message = 0,
    'CREATE INDEX idx_event_evidence_message ON event_evidence(source_message_id)',
    'SELECT ''idx_event_evidence_message exists'' AS status'
);
PREPARE stmt FROM @sql_stmt;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

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

SET @has_idx_event_state_transition_event_time := (
    SELECT COUNT(*) FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'event_state_transitions'
      AND index_name = 'idx_event_state_transition_event_time'
);
SET @sql_stmt := IF(
    @has_idx_event_state_transition_event_time = 0,
    'CREATE INDEX idx_event_state_transition_event_time ON event_state_transitions(event_id, created_at DESC)',
    'SELECT ''idx_event_state_transition_event_time exists'' AS status'
);
PREPARE stmt FROM @sql_stmt;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

CREATE TABLE IF NOT EXISTS creator_event_snapshot (
    creator_id             INT PRIMARY KEY,
    active_event_keys_json JSON,
    overlay_flags_json     JSON,
    compat_ev_flags_json   JSON,
    latest_event_at        DATETIME,
    rebuilt_at             DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_creator_event_snapshot_creator FOREIGN KEY (creator_id) REFERENCES creators(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
