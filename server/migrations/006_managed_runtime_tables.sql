-- Managed runtime tables schema migration.
-- Moves formerly runtime-created active tables into the canonical schema/migration path.

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

CREATE TABLE IF NOT EXISTS profile_analysis_state (
    id                         INT AUTO_INCREMENT PRIMARY KEY,
    client_id                  VARCHAR(64) NOT NULL UNIQUE,
    pending_unanalyzed_count   INT DEFAULT 0,
    last_profile_analyzed_at   DATETIME NULL,
    last_analyzed_message_ts   BIGINT NULL,
    updated_at                 DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    created_at                 DATETIME DEFAULT CURRENT_TIMESTAMP,
    KEY idx_pas_pending (pending_unanalyzed_count),
    KEY idx_pas_last_analyzed (last_profile_analyzed_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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
    created_at           DATETIME DEFAULT CURRENT_TIMESTAMP,
    KEY idx_cps_client (client_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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
    updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    KEY idx_cpce_client_status (client_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
