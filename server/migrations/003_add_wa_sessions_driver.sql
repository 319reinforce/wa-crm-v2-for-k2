-- Migration: add driver column to wa_sessions
-- Idempotent: safe to run multiple times on MySQL 5.7+
-- Adds: driver VARCHAR(16) NOT NULL DEFAULT 'wwebjs'
--       driver_meta JSON NULL
--       INDEX idx_driver (driver)

-- Detect if column already exists
SET @has_driver := (
    SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'wa_sessions'
      AND column_name = 'driver'
);
SET @sql_stmt := IF(
    @has_driver = 0,
    'ALTER TABLE wa_sessions
       ADD COLUMN driver VARCHAR(16) NOT NULL DEFAULT ''wwebjs''
         AFTER aliases,
       ADD COLUMN driver_meta JSON NULL
         AFTER driver,
       ADD INDEX idx_driver (driver)',
    'SELECT ''driver column already exists, skipping'' AS status'
);
PREPARE stmt FROM @sql_stmt;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Verify
SELECT column_name, data_type, column_default, is_nullable
FROM information_schema.columns
WHERE table_schema = DATABASE()
  AND table_name = 'wa_sessions'
  AND column_name IN ('driver', 'driver_meta')
ORDER BY ordinal_position;