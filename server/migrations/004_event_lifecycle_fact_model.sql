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

ALTER TABLE events
    ADD COLUMN canonical_event_key VARCHAR(64) NULL AFTER event_key,
    ADD COLUMN event_state VARCHAR(24) NULL AFTER status,
    ADD COLUMN review_state VARCHAR(24) NULL AFTER event_state,
    ADD COLUMN evidence_tier TINYINT NULL AFTER review_state,
    ADD COLUMN source_kind VARCHAR(32) NULL AFTER evidence_tier,
    ADD COLUMN source_event_at DATETIME NULL AFTER source_kind,
    ADD COLUMN detected_at DATETIME NULL AFTER source_event_at,
    ADD COLUMN verified_at DATETIME NULL AFTER detected_at,
    ADD COLUMN verified_by VARCHAR(64) NULL AFTER verified_at,
    ADD COLUMN idempotency_key VARCHAR(128) NULL AFTER verified_by,
    ADD COLUMN lifecycle_effect VARCHAR(32) NULL AFTER idempotency_key,
    ADD COLUMN expires_at DATETIME NULL AFTER lifecycle_effect;

CREATE INDEX idx_events_canonical_state ON events(canonical_event_key, event_state);
CREATE INDEX idx_events_source_event_at ON events(source_event_at);
CREATE UNIQUE INDEX idx_events_idempotency ON events(idempotency_key);

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

CREATE TABLE IF NOT EXISTS creator_event_snapshot (
    creator_id             INT PRIMARY KEY,
    active_event_keys_json JSON,
    overlay_flags_json     JSON,
    compat_ev_flags_json   JSON,
    latest_event_at        DATETIME,
    rebuilt_at             DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_creator_event_snapshot_creator FOREIGN KEY (creator_id) REFERENCES creators(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
