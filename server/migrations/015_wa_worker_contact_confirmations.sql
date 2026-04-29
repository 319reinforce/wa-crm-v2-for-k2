-- WA worker per-contact crawl confirmation state.
-- confirmed_through_ts stores the newest WA message timestamp the operator has reviewed.

CREATE TABLE IF NOT EXISTS wa_worker_contact_confirmations (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    creator_id INT NOT NULL,
    owner VARCHAR(32) NOT NULL,
    confirmed_through_ts BIGINT NOT NULL DEFAULT 0,
    confirmed_by VARCHAR(64) NULL,
    confirmed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_wwcc_creator_owner (creator_id, owner),
    KEY idx_wwcc_owner_confirmed (owner, confirmed_through_ts),
    CONSTRAINT fk_wwcc_creator FOREIGN KEY (creator_id) REFERENCES creators(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
