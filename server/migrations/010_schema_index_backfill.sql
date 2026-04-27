-- Schema index backfill migration.
-- Adds index names present in schema.sql but missing from older live databases.

SET @has_idx_audit_table_record := (
    SELECT COUNT(*) FROM information_schema.statistics
    WHERE table_schema = DATABASE() AND table_name = 'audit_log' AND index_name = 'idx_audit_table_record'
);
SET @sql_stmt := IF(@has_idx_audit_table_record = 0, 'CREATE INDEX idx_audit_table_record ON audit_log(table_name, record_id)', 'SELECT ''idx_audit_table_record exists'' AS status');
PREPARE stmt FROM @sql_stmt; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_idx_cm_memory_type := (
    SELECT COUNT(*) FROM information_schema.statistics
    WHERE table_schema = DATABASE() AND table_name = 'client_memory' AND index_name = 'idx_cm_memory_type'
);
SET @sql_stmt := IF(@has_idx_cm_memory_type = 0, 'CREATE INDEX idx_cm_memory_type ON client_memory(memory_type)', 'SELECT ''idx_cm_memory_type exists'' AS status');
PREPARE stmt FROM @sql_stmt; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_idx_cp_stage := (
    SELECT COUNT(*) FROM information_schema.statistics
    WHERE table_schema = DATABASE() AND table_name = 'client_profiles' AND index_name = 'idx_cp_stage'
);
SET @sql_stmt := IF(@has_idx_cp_stage = 0, 'CREATE INDEX idx_cp_stage ON client_profiles(stage)', 'SELECT ''idx_cp_stage exists'' AS status');
PREPARE stmt FROM @sql_stmt; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_idx_ct_source := (
    SELECT COUNT(*) FROM information_schema.statistics
    WHERE table_schema = DATABASE() AND table_name = 'client_tags' AND index_name = 'idx_ct_source'
);
SET @sql_stmt := IF(@has_idx_ct_source = 0, 'CREATE INDEX idx_ct_source ON client_tags(source)', 'SELECT ''idx_ct_source exists'' AS status');
PREPARE stmt FROM @sql_stmt; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_idx_creators_is_active := (
    SELECT COUNT(*) FROM information_schema.statistics
    WHERE table_schema = DATABASE() AND table_name = 'creators' AND index_name = 'idx_creators_is_active'
);
SET @sql_stmt := IF(@has_idx_creators_is_active = 0, 'CREATE INDEX idx_creators_is_active ON creators(is_active)', 'SELECT ''idx_creators_is_active exists'' AS status');
PREPARE stmt FROM @sql_stmt; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_idx_creators_created_at := (
    SELECT COUNT(*) FROM information_schema.statistics
    WHERE table_schema = DATABASE() AND table_name = 'creators' AND index_name = 'idx_creators_created_at'
);
SET @sql_stmt := IF(@has_idx_creators_created_at = 0, 'CREATE INDEX idx_creators_created_at ON creators(created_at)', 'SELECT ''idx_creators_created_at exists'' AS status');
PREPARE stmt FROM @sql_stmt; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_idx_creators_owner_active := (
    SELECT COUNT(*) FROM information_schema.statistics
    WHERE table_schema = DATABASE() AND table_name = 'creators' AND index_name = 'idx_creators_owner_active'
);
SET @sql_stmt := IF(@has_idx_creators_owner_active = 0, 'CREATE INDEX idx_creators_owner_active ON creators(wa_owner, is_active)', 'SELECT ''idx_creators_owner_active exists'' AS status');
PREPARE stmt FROM @sql_stmt; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_idx_periods_status := (
    SELECT COUNT(*) FROM information_schema.statistics
    WHERE table_schema = DATABASE() AND table_name = 'event_periods' AND index_name = 'idx_periods_status'
);
SET @sql_stmt := IF(@has_idx_periods_status = 0, 'CREATE INDEX idx_periods_status ON event_periods(status)', 'SELECT ''idx_periods_status exists'' AS status');
PREPARE stmt FROM @sql_stmt; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_idx_events_event_type := (
    SELECT COUNT(*) FROM information_schema.statistics
    WHERE table_schema = DATABASE() AND table_name = 'events' AND index_name = 'idx_events_event_type'
);
SET @sql_stmt := IF(@has_idx_events_event_type = 0, 'CREATE INDEX idx_events_event_type ON events(event_type)', 'SELECT ''idx_events_event_type exists'' AS status');
PREPARE stmt FROM @sql_stmt; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_idx_jb_ev_joined := (
    SELECT COUNT(*) FROM information_schema.statistics
    WHERE table_schema = DATABASE() AND table_name = 'joinbrands_link' AND index_name = 'idx_jb_ev_joined'
);
SET @sql_stmt := IF(@has_idx_jb_ev_joined = 0, 'CREATE INDEX idx_jb_ev_joined ON joinbrands_link(ev_joined)', 'SELECT ''idx_jb_ev_joined exists'' AS status');
PREPARE stmt FROM @sql_stmt; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_idx_jb_ev_churned := (
    SELECT COUNT(*) FROM information_schema.statistics
    WHERE table_schema = DATABASE() AND table_name = 'joinbrands_link' AND index_name = 'idx_jb_ev_churned'
);
SET @sql_stmt := IF(@has_idx_jb_ev_churned = 0, 'CREATE INDEX idx_jb_ev_churned ON joinbrands_link(ev_churned)', 'SELECT ''idx_jb_ev_churned exists'' AS status');
PREPARE stmt FROM @sql_stmt; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_idx_feedback_created := (
    SELECT COUNT(*) FROM information_schema.statistics
    WHERE table_schema = DATABASE() AND table_name = 'sft_feedback' AND index_name = 'idx_feedback_created'
);
SET @sql_stmt := IF(@has_idx_feedback_created = 0, 'CREATE INDEX idx_feedback_created ON sft_feedback(created_at)', 'SELECT ''idx_feedback_created exists'' AS status');
PREPARE stmt FROM @sql_stmt; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_idx_sft_scene := (
    SELECT COUNT(*) FROM information_schema.statistics
    WHERE table_schema = DATABASE() AND table_name = 'sft_memory' AND index_name = 'idx_sft_scene'
);
SET @sql_stmt := IF(@has_idx_sft_scene = 0, 'CREATE INDEX idx_sft_scene ON sft_memory(scene)', 'SELECT ''idx_sft_scene exists'' AS status');
PREPARE stmt FROM @sql_stmt; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_idx_sft_client_hash := (
    SELECT COUNT(*) FROM information_schema.statistics
    WHERE table_schema = DATABASE() AND table_name = 'sft_memory' AND index_name = 'idx_sft_client_hash'
);
SET @sql_stmt := IF(@has_idx_sft_client_hash = 0, 'CREATE INDEX idx_sft_client_hash ON sft_memory(client_id_hash)', 'SELECT ''idx_sft_client_hash exists'' AS status');
PREPARE stmt FROM @sql_stmt; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_idx_sync_bot := (
    SELECT COUNT(*) FROM information_schema.statistics
    WHERE table_schema = DATABASE() AND table_name = 'sync_log' AND index_name = 'idx_sync_bot'
);
SET @sql_stmt := IF(@has_idx_sync_bot = 0, 'CREATE INDEX idx_sync_bot ON sync_log(bot_name)', 'SELECT ''idx_sync_bot exists'' AS status');
PREPARE stmt FROM @sql_stmt; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_idx_sync_status := (
    SELECT COUNT(*) FROM information_schema.statistics
    WHERE table_schema = DATABASE() AND table_name = 'sync_log' AND index_name = 'idx_sync_status'
);
SET @sql_stmt := IF(@has_idx_sync_status = 0, 'CREATE INDEX idx_sync_status ON sync_log(status)', 'SELECT ''idx_sync_status exists'' AS status');
PREPARE stmt FROM @sql_stmt; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_idx_crm_priority := (
    SELECT COUNT(*) FROM information_schema.statistics
    WHERE table_schema = DATABASE() AND table_name = 'wa_crm_data' AND index_name = 'idx_crm_priority'
);
SET @sql_stmt := IF(@has_idx_crm_priority = 0, 'CREATE INDEX idx_crm_priority ON wa_crm_data(priority)', 'SELECT ''idx_crm_priority exists'' AS status');
PREPARE stmt FROM @sql_stmt; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_idx_crm_urgency := (
    SELECT COUNT(*) FROM information_schema.statistics
    WHERE table_schema = DATABASE() AND table_name = 'wa_crm_data' AND index_name = 'idx_crm_urgency'
);
SET @sql_stmt := IF(@has_idx_crm_urgency = 0, 'CREATE INDEX idx_crm_urgency ON wa_crm_data(urgency_level)', 'SELECT ''idx_crm_urgency exists'' AS status');
PREPARE stmt FROM @sql_stmt; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_idx_messages_creator_timestamp := (
    SELECT COUNT(*) FROM information_schema.statistics
    WHERE table_schema = DATABASE() AND table_name = 'wa_messages' AND index_name = 'idx_messages_creator_timestamp'
);
SET @sql_stmt := IF(@has_idx_messages_creator_timestamp = 0, 'CREATE INDEX idx_messages_creator_timestamp ON wa_messages(creator_id, timestamp DESC)', 'SELECT ''idx_messages_creator_timestamp exists'' AS status');
PREPARE stmt FROM @sql_stmt; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_idx_messages_creator_role_ts := (
    SELECT COUNT(*) FROM information_schema.statistics
    WHERE table_schema = DATABASE() AND table_name = 'wa_messages' AND index_name = 'idx_messages_creator_role_ts'
);
SET @sql_stmt := IF(@has_idx_messages_creator_role_ts = 0, 'CREATE INDEX idx_messages_creator_role_ts ON wa_messages(creator_id, role, timestamp)', 'SELECT ''idx_messages_creator_role_ts exists'' AS status');
PREPARE stmt FROM @sql_stmt; EXECUTE stmt; DEALLOCATE PREPARE stmt;
