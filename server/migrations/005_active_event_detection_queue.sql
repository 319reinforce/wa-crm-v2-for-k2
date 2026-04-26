-- Active event detection queue/cursor.
-- Additive and safe to run multiple times.

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
