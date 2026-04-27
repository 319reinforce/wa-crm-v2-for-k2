-- AI/profile creator_id linkage migration.
-- Adds nullable creators.id pointers and backfills them from client_id/wa_phone.

SET @has_client_memory_creator_id := (
    SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'client_memory'
      AND column_name = 'creator_id'
);
SET @sql_stmt := IF(
    @has_client_memory_creator_id = 0,
    'ALTER TABLE client_memory ADD COLUMN creator_id INT NULL COMMENT ''Nullable resolved creators.id for phone/client_id joins'' AFTER id',
    'SELECT ''client_memory.creator_id exists'' AS status'
);
PREPARE stmt FROM @sql_stmt;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_client_profiles_creator_id := (
    SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'client_profiles'
      AND column_name = 'creator_id'
);
SET @sql_stmt := IF(
    @has_client_profiles_creator_id = 0,
    'ALTER TABLE client_profiles ADD COLUMN creator_id INT NULL COMMENT ''Nullable resolved creators.id for phone/client_id joins'' AFTER id',
    'SELECT ''client_profiles.creator_id exists'' AS status'
);
PREPARE stmt FROM @sql_stmt;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_client_tags_creator_id := (
    SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'client_tags'
      AND column_name = 'creator_id'
);
SET @sql_stmt := IF(
    @has_client_tags_creator_id = 0,
    'ALTER TABLE client_tags ADD COLUMN creator_id INT NULL COMMENT ''Nullable resolved creators.id for phone/client_id joins'' AFTER id',
    'SELECT ''client_tags.creator_id exists'' AS status'
);
PREPARE stmt FROM @sql_stmt;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_profile_analysis_creator_id := (
    SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'profile_analysis_state'
      AND column_name = 'creator_id'
);
SET @sql_stmt := IF(
    @has_profile_analysis_creator_id = 0,
    'ALTER TABLE profile_analysis_state ADD COLUMN creator_id INT NULL COMMENT ''Nullable resolved creators.id for phone/client_id joins'' AFTER id',
    'SELECT ''profile_analysis_state.creator_id exists'' AS status'
);
PREPARE stmt FROM @sql_stmt;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_profile_snapshots_creator_id := (
    SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'client_profile_snapshots'
      AND column_name = 'creator_id'
);
SET @sql_stmt := IF(
    @has_profile_snapshots_creator_id = 0,
    'ALTER TABLE client_profile_snapshots ADD COLUMN creator_id INT NULL COMMENT ''Nullable resolved creators.id for phone/client_id joins'' AFTER id',
    'SELECT ''client_profile_snapshots.creator_id exists'' AS status'
);
PREPARE stmt FROM @sql_stmt;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_profile_change_events_creator_id := (
    SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'client_profile_change_events'
      AND column_name = 'creator_id'
);
SET @sql_stmt := IF(
    @has_profile_change_events_creator_id = 0,
    'ALTER TABLE client_profile_change_events ADD COLUMN creator_id INT NULL COMMENT ''Nullable resolved creators.id for phone/client_id joins'' AFTER id',
    'SELECT ''client_profile_change_events.creator_id exists'' AS status'
);
PREPARE stmt FROM @sql_stmt;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_retrieval_snapshot_creator_id := (
    SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'retrieval_snapshot'
      AND column_name = 'creator_id'
);
SET @sql_stmt := IF(
    @has_retrieval_snapshot_creator_id = 0,
    'ALTER TABLE retrieval_snapshot ADD COLUMN creator_id INT NULL COMMENT ''Nullable resolved creators.id for phone/client_id joins'' AFTER id',
    'SELECT ''retrieval_snapshot.creator_id exists'' AS status'
);
PREPARE stmt FROM @sql_stmt;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_generation_log_creator_id := (
    SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'generation_log'
      AND column_name = 'creator_id'
);
SET @sql_stmt := IF(
    @has_generation_log_creator_id = 0,
    'ALTER TABLE generation_log ADD COLUMN creator_id INT NULL COMMENT ''Nullable resolved creators.id for phone/client_id joins'' AFTER id',
    'SELECT ''generation_log.creator_id exists'' AS status'
);
PREPARE stmt FROM @sql_stmt;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_sft_feedback_creator_id := (
    SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'sft_feedback'
      AND column_name = 'creator_id'
);
SET @sql_stmt := IF(
    @has_sft_feedback_creator_id = 0,
    'ALTER TABLE sft_feedback ADD COLUMN creator_id INT NULL COMMENT ''Nullable resolved creators.id for phone/client_id joins'' AFTER id',
    'SELECT ''sft_feedback.creator_id exists'' AS status'
);
PREPARE stmt FROM @sql_stmt;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

UPDATE client_memory t
JOIN creators c ON c.wa_phone = t.client_id
SET t.creator_id = c.id
WHERE t.creator_id IS NULL;

UPDATE client_profiles t
JOIN creators c ON c.wa_phone = t.client_id
SET t.creator_id = c.id
WHERE t.creator_id IS NULL;

UPDATE client_tags t
JOIN creators c ON c.wa_phone = t.client_id
SET t.creator_id = c.id
WHERE t.creator_id IS NULL;

UPDATE profile_analysis_state t
JOIN creators c ON c.wa_phone = t.client_id
SET t.creator_id = c.id
WHERE t.creator_id IS NULL;

UPDATE client_profile_snapshots t
JOIN creators c ON c.wa_phone = t.client_id
SET t.creator_id = c.id
WHERE t.creator_id IS NULL;

UPDATE client_profile_change_events t
JOIN creators c ON c.wa_phone = t.client_id
SET t.creator_id = c.id
WHERE t.creator_id IS NULL;

UPDATE retrieval_snapshot t
JOIN creators c ON c.wa_phone = t.client_id
SET t.creator_id = c.id
WHERE t.creator_id IS NULL;

UPDATE generation_log t
JOIN creators c ON c.wa_phone = t.client_id
SET t.creator_id = c.id
WHERE t.creator_id IS NULL;

UPDATE sft_feedback t
JOIN creators c ON c.wa_phone = t.client_id
SET t.creator_id = c.id
WHERE t.creator_id IS NULL;

SET @has_idx_cm_creator := (
    SELECT COUNT(*) FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'client_memory'
      AND index_name = 'idx_cm_creator'
);
SET @sql_stmt := IF(@has_idx_cm_creator = 0, 'CREATE INDEX idx_cm_creator ON client_memory(creator_id)', 'SELECT ''idx_cm_creator exists'' AS status');
PREPARE stmt FROM @sql_stmt;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_idx_cp_creator := (
    SELECT COUNT(*) FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'client_profiles'
      AND index_name = 'idx_cp_creator'
);
SET @sql_stmt := IF(@has_idx_cp_creator = 0, 'CREATE INDEX idx_cp_creator ON client_profiles(creator_id)', 'SELECT ''idx_cp_creator exists'' AS status');
PREPARE stmt FROM @sql_stmt;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_idx_ct_creator := (
    SELECT COUNT(*) FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'client_tags'
      AND index_name = 'idx_ct_creator'
);
SET @sql_stmt := IF(@has_idx_ct_creator = 0, 'CREATE INDEX idx_ct_creator ON client_tags(creator_id)', 'SELECT ''idx_ct_creator exists'' AS status');
PREPARE stmt FROM @sql_stmt;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_idx_pas_creator := (
    SELECT COUNT(*) FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'profile_analysis_state'
      AND index_name = 'idx_pas_creator'
);
SET @sql_stmt := IF(@has_idx_pas_creator = 0, 'CREATE INDEX idx_pas_creator ON profile_analysis_state(creator_id)', 'SELECT ''idx_pas_creator exists'' AS status');
PREPARE stmt FROM @sql_stmt;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_idx_cps_creator := (
    SELECT COUNT(*) FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'client_profile_snapshots'
      AND index_name = 'idx_cps_creator'
);
SET @sql_stmt := IF(@has_idx_cps_creator = 0, 'CREATE INDEX idx_cps_creator ON client_profile_snapshots(creator_id)', 'SELECT ''idx_cps_creator exists'' AS status');
PREPARE stmt FROM @sql_stmt;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_idx_cpce_creator_status := (
    SELECT COUNT(*) FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'client_profile_change_events'
      AND index_name = 'idx_cpce_creator_status'
);
SET @sql_stmt := IF(@has_idx_cpce_creator_status = 0, 'CREATE INDEX idx_cpce_creator_status ON client_profile_change_events(creator_id, status)', 'SELECT ''idx_cpce_creator_status exists'' AS status');
PREPARE stmt FROM @sql_stmt;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_idx_rs_creator_created := (
    SELECT COUNT(*) FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'retrieval_snapshot'
      AND index_name = 'idx_rs_creator_created'
);
SET @sql_stmt := IF(@has_idx_rs_creator_created = 0, 'CREATE INDEX idx_rs_creator_created ON retrieval_snapshot(creator_id, created_at)', 'SELECT ''idx_rs_creator_created exists'' AS status');
PREPARE stmt FROM @sql_stmt;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_idx_gl_creator_created := (
    SELECT COUNT(*) FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'generation_log'
      AND index_name = 'idx_gl_creator_created'
);
SET @sql_stmt := IF(@has_idx_gl_creator_created = 0, 'CREATE INDEX idx_gl_creator_created ON generation_log(creator_id, created_at)', 'SELECT ''idx_gl_creator_created exists'' AS status');
PREPARE stmt FROM @sql_stmt;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_idx_feedback_creator := (
    SELECT COUNT(*) FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'sft_feedback'
      AND index_name = 'idx_feedback_creator'
);
SET @sql_stmt := IF(@has_idx_feedback_creator = 0, 'CREATE INDEX idx_feedback_creator ON sft_feedback(creator_id)', 'SELECT ''idx_feedback_creator exists'' AS status');
PREPARE stmt FROM @sql_stmt;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
