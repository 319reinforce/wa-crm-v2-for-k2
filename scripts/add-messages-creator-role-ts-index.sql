-- Phase 1-D: add index for wa_messages role/timestamp aggregations
CREATE INDEX idx_messages_creator_role_ts
  ON wa_messages(creator_id, role, timestamp);

-- Rollback:
-- DROP INDEX idx_messages_creator_role_ts ON wa_messages;
