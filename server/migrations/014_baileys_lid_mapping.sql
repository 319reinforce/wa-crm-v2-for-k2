-- Baileys persistent LID -> phone-number JID mapping.
-- Keeps @lid aliases resolvable across process restarts and supports sync diagnostics.

CREATE TABLE IF NOT EXISTS wa_lid_mappings (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    session_id VARCHAR(64) NOT NULL,
    operator VARCHAR(32) NULL,
    lid_jid VARCHAR(128) NOT NULL,
    pn_jid VARCHAR(128) NOT NULL,
    phone VARCHAR(32) NULL,
    source VARCHAR(64) NULL,
    confidence TINYINT NOT NULL DEFAULT 2,
    meta_json TEXT NULL,
    first_seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    hit_count INT NOT NULL DEFAULT 1,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_wa_lid_session_lid (session_id, lid_jid),
    KEY idx_wa_lid_phone (phone),
    KEY idx_wa_lid_pn (pn_jid),
    KEY idx_wa_lid_last_seen (last_seen_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
