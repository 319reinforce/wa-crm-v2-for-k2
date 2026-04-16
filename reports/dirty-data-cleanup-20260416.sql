-- WA CRM v2 dirty-data cleanup checklist
-- Generated on 2026-04-16
-- Target database: wa_crm_v2
-- Run section by section. Safe sections can be executed directly.
-- Optional sections change business-visible data and should be reviewed first.

USE wa_crm_v2;

-- ============================================================
-- 0. Baseline snapshot
-- ============================================================

SELECT 'creators_missing_wacrm' AS metric, COUNT(*) AS cnt
FROM creators c
LEFT JOIN wa_crm_data w ON w.creator_id = c.id
WHERE w.creator_id IS NULL
UNION ALL
SELECT 'active_with_messages_missing_wacrm', COUNT(*)
FROM creators c
JOIN (SELECT DISTINCT creator_id FROM wa_messages) m ON m.creator_id = c.id
LEFT JOIN wa_crm_data w ON w.creator_id = c.id
WHERE c.is_active = 1 AND w.creator_id IS NULL
UNION ALL
SELECT 'creators_missing_profile', COUNT(*)
FROM creators c
LEFT JOIN client_profiles p ON p.client_id = c.wa_phone
WHERE p.client_id IS NULL
UNION ALL
SELECT 'profiles_empty_summary', COUNT(*)
FROM client_profiles
WHERE summary IS NULL OR TRIM(summary) = ''
UNION ALL
SELECT 'client_tags_total', COUNT(*)
FROM client_tags
UNION ALL
SELECT 'profile_change_events_pending', COUNT(*)
FROM client_profile_change_events
WHERE status = 'pending'
UNION ALL
SELECT 'sft_missing_system_prompt', COUNT(*)
FROM sft_memory
WHERE system_prompt_used IS NULL OR TRIM(system_prompt_used) = ''
UNION ALL
SELECT 'wa_messages_empty_text', COUNT(*)
FROM wa_messages
WHERE text IS NULL OR TRIM(text) = ''
UNION ALL
SELECT 'wa_messages_null_operator', COUNT(*)
FROM wa_messages
WHERE operator IS NULL OR TRIM(operator) = ''
UNION ALL
SELECT 'manual_test_creators', COUNT(*)
FROM creators
WHERE source = 'manual_test'
UNION ALL
SELECT 'profile_analysis_state_orphans', COUNT(*)
FROM profile_analysis_state pas
LEFT JOIN creators c ON c.wa_phone = pas.client_id
WHERE c.id IS NULL;

-- ============================================================
-- 1. Safe cleanup: normalize blank identifiers
-- ============================================================

START TRANSACTION;

UPDATE creators
SET keeper_username = NULL,
    updated_at = CURRENT_TIMESTAMP
WHERE keeper_username IS NOT NULL
  AND TRIM(keeper_username) = '';

UPDATE keeper_link
SET keeper_username = NULL,
    last_synced = CURRENT_TIMESTAMP
WHERE keeper_username IS NOT NULL
  AND TRIM(keeper_username) = '';

UPDATE joinbrands_link
SET creator_name_jb = NULL,
    last_synced = CURRENT_TIMESTAMP
WHERE creator_name_jb IS NOT NULL
  AND TRIM(creator_name_jb) = '';

COMMIT;

-- ============================================================
-- 2. Safe cleanup: remove orphan profile-analysis state
-- ============================================================

START TRANSACTION;

DELETE pas
FROM profile_analysis_state pas
LEFT JOIN creators c ON c.wa_phone = pas.client_id
WHERE c.id IS NULL;

COMMIT;

-- ============================================================
-- 3. Safe cleanup: remove isolated manual_test creator
-- Strict condition: only delete fully isolated test rows.
-- ============================================================

START TRANSACTION;

DELETE FROM creators
WHERE id IN (
    SELECT creator_id
    FROM (
        SELECT c.id AS creator_id
        FROM creators c
        LEFT JOIN wa_messages wm ON wm.creator_id = c.id
        LEFT JOIN wa_crm_data w ON w.creator_id = c.id
        LEFT JOIN keeper_link k ON k.creator_id = c.id
        LEFT JOIN joinbrands_link j ON j.creator_id = c.id
        LEFT JOIN creator_aliases a ON a.creator_id = c.id
        LEFT JOIN events e ON e.creator_id = c.id
        LEFT JOIN operator_creator_roster r ON r.creator_id = c.id
        LEFT JOIN client_profiles cp ON cp.client_id = c.wa_phone
        LEFT JOIN client_memory cm ON cm.client_id = c.wa_phone
        LEFT JOIN client_tags ct ON ct.client_id = c.wa_phone
        LEFT JOIN profile_analysis_state pas ON pas.client_id = c.wa_phone
        WHERE c.source = 'manual_test'
        GROUP BY c.id
        HAVING COUNT(DISTINCT wm.id) = 0
           AND COUNT(DISTINCT a.id) = 0
           AND COUNT(DISTINCT e.id) = 0
           AND COUNT(DISTINCT r.id) = 0
           AND MAX(CASE WHEN w.creator_id IS NULL THEN 0 ELSE 1 END) = 0
           AND MAX(CASE WHEN k.creator_id IS NULL THEN 0 ELSE 1 END) = 0
           AND MAX(CASE WHEN j.creator_id IS NULL THEN 0 ELSE 1 END) = 0
           AND MAX(CASE WHEN cp.client_id IS NULL THEN 0 ELSE 1 END) = 0
           AND MAX(CASE WHEN cm.client_id IS NULL THEN 0 ELSE 1 END) = 0
           AND MAX(CASE WHEN ct.client_id IS NULL THEN 0 ELSE 1 END) = 0
           AND MAX(CASE WHEN pas.client_id IS NULL THEN 0 ELSE 1 END) = 0
    ) isolated_manual_test
);

COMMIT;

-- ============================================================
-- 4. Safe cleanup: remove placeholder external-link rows
-- Strict condition: no key fields and all metrics/flags still default.
-- ============================================================

START TRANSACTION;

DELETE k
FROM keeper_link k
WHERE (k.keeper_username IS NULL OR TRIM(k.keeper_username) = '')
  AND COALESCE(k.keeper_gmv, 0) = 0
  AND COALESCE(k.keeper_gmv30, 0) = 0
  AND COALESCE(k.keeper_orders, 0) = 0
  AND COALESCE(k.keeper_videos, 0) = 0
  AND COALESCE(k.keeper_videos_posted, 0) = 0
  AND COALESCE(k.keeper_videos_sold, 0) = 0
  AND COALESCE(TRIM(k.keeper_card_rate), '') = ''
  AND COALESCE(TRIM(k.keeper_order_rate), '') = '';

DELETE j
FROM joinbrands_link j
WHERE (j.creator_name_jb IS NULL OR TRIM(j.creator_name_jb) = '')
  AND COALESCE(j.jb_gmv, 0) = 0
  AND COALESCE(TRIM(j.jb_status), 'unknown') = 'unknown'
  AND COALESCE(TRIM(j.jb_priority), '') = ''
  AND COALESCE(TRIM(j.jb_next_action), '') = ''
  AND COALESCE(j.last_message, 0) = 0
  AND COALESCE(j.days_since_msg, 999) = 999
  AND COALESCE(TRIM(j.invite_code_jb), '') = ''
  AND COALESCE(j.ev_joined, 0) = 0
  AND COALESCE(j.ev_ready_sent, 0) = 0
  AND COALESCE(j.ev_trial_7day, 0) = 0
  AND COALESCE(j.ev_trial_active, 0) = 0
  AND COALESCE(j.ev_monthly_started, 0) = 0
  AND COALESCE(j.ev_monthly_invited, 0) = 0
  AND COALESCE(j.ev_monthly_joined, 0) = 0
  AND COALESCE(j.ev_whatsapp_shared, 0) = 0
  AND COALESCE(j.ev_gmv_1k, 0) = 0
  AND COALESCE(j.ev_gmv_2k, 0) = 0
  AND COALESCE(j.ev_gmv_5k, 0) = 0
  AND COALESCE(j.ev_gmv_10k, 0) = 0
  AND COALESCE(j.ev_agency_bound, 0) = 0
  AND COALESCE(j.ev_churned, 0) = 0;

COMMIT;

-- ============================================================
-- 5. Safe cleanup: backfill missing wa_crm_data shells
-- This prevents creator rows created by worker/import paths from staying half-empty.
-- ============================================================

START TRANSACTION;

INSERT IGNORE INTO wa_crm_data (creator_id)
SELECT c.id
FROM creators c
LEFT JOIN wa_crm_data w ON w.creator_id = c.id
WHERE w.creator_id IS NULL;

COMMIT;

-- ============================================================
-- 6. Optional repair: backfill system tags from existing JoinBrands flags
-- Run only if you want to materialize current stage/GMV tags into client_tags.
-- ============================================================

START TRANSACTION;

INSERT IGNORE INTO client_tags (client_id, tag, source, confidence, created_at)
SELECT c.wa_phone, 'stage:trial', 'system', 3, NOW()
FROM creators c
JOIN joinbrands_link j ON j.creator_id = c.id
WHERE c.wa_phone IS NOT NULL
  AND c.wa_phone <> ''
  AND COALESCE(j.ev_trial_active, 0) = 1;

INSERT IGNORE INTO client_tags (client_id, tag, source, confidence, created_at)
SELECT c.wa_phone, 'stage:monthly', 'system', 3, NOW()
FROM creators c
JOIN joinbrands_link j ON j.creator_id = c.id
WHERE c.wa_phone IS NOT NULL
  AND c.wa_phone <> ''
  AND COALESCE(j.ev_monthly_started, 0) = 1;

INSERT IGNORE INTO client_tags (client_id, tag, source, confidence, created_at)
SELECT c.wa_phone, 'gmv_tier:1k', 'system', 3, NOW()
FROM creators c
JOIN joinbrands_link j ON j.creator_id = c.id
WHERE c.wa_phone IS NOT NULL
  AND c.wa_phone <> ''
  AND COALESCE(j.ev_gmv_1k, 0) = 1;

INSERT IGNORE INTO client_tags (client_id, tag, source, confidence, created_at)
SELECT c.wa_phone, 'gmv_tier:5k', 'system', 3, NOW()
FROM creators c
JOIN joinbrands_link j ON j.creator_id = c.id
WHERE c.wa_phone IS NOT NULL
  AND c.wa_phone <> ''
  AND COALESCE(j.ev_gmv_5k, 0) = 1;

INSERT IGNORE INTO client_tags (client_id, tag, source, confidence, created_at)
SELECT c.wa_phone, 'gmv_tier:10k', 'system', 3, NOW()
FROM creators c
JOIN joinbrands_link j ON j.creator_id = c.id
WHERE c.wa_phone IS NOT NULL
  AND c.wa_phone <> ''
  AND COALESCE(j.ev_gmv_10k, 0) = 1;

COMMIT;

-- ============================================================
-- 7. Optional repair: hydrate client_profiles.summary from latest snapshot
-- Run only if you accept latest system snapshot as current truth even though
-- client_profile_change_events are still pending review.
-- ============================================================

START TRANSACTION;

INSERT INTO client_profiles (client_id, summary, created_at, last_updated)
SELECT latest.client_id, latest.summary, NOW(), NOW()
FROM (
    SELECT s1.client_id, s1.summary
    FROM client_profile_snapshots s1
    JOIN (
        SELECT client_id, MAX(id) AS max_id
        FROM client_profile_snapshots
        GROUP BY client_id
    ) s2
      ON s2.client_id = s1.client_id
     AND s2.max_id = s1.id
    WHERE s1.summary IS NOT NULL
      AND TRIM(s1.summary) <> ''
) latest
LEFT JOIN client_profiles p ON p.client_id = latest.client_id
WHERE p.client_id IS NULL;

UPDATE client_profiles p
JOIN (
    SELECT s1.client_id, s1.summary
    FROM client_profile_snapshots s1
    JOIN (
        SELECT client_id, MAX(id) AS max_id
        FROM client_profile_snapshots
        GROUP BY client_id
    ) s2
      ON s2.client_id = s1.client_id
     AND s2.max_id = s1.id
    WHERE s1.summary IS NOT NULL
      AND TRIM(s1.summary) <> ''
) latest
  ON latest.client_id = p.client_id
SET p.summary = latest.summary,
    p.last_updated = NOW()
WHERE p.summary IS NULL
   OR TRIM(p.summary) = '';

COMMIT;

-- ============================================================
-- 8. Optional config repair: seed Jiawen/WangYouKe operator experiences
-- This is configuration repair, not pure data cleanup. Review content before use.
-- ============================================================

START TRANSACTION;

INSERT INTO operator_experiences
    (operator, display_name, description, system_prompt_base, scene_config, forbidden_rules, is_active, priority, created_at, updated_at)
SELECT
    'Jiawen',
    'Jiawen 的运营体验',
    CONCAT('Seeded from ', operator, ' on 2026-04-16'),
    system_prompt_base,
    scene_config,
    forbidden_rules,
    1,
    3,
    NOW(),
    NOW()
FROM operator_experiences
WHERE operator = 'Yiyun'
  AND NOT EXISTS (
      SELECT 1 FROM operator_experiences existing WHERE existing.operator = 'Jiawen'
  );

INSERT INTO operator_experiences
    (operator, display_name, description, system_prompt_base, scene_config, forbidden_rules, is_active, priority, created_at, updated_at)
SELECT
    'WangYouKe',
    'WangYouKe 的运营体验',
    CONCAT('Seeded from ', operator, ' on 2026-04-16'),
    system_prompt_base,
    scene_config,
    forbidden_rules,
    1,
    4,
    NOW(),
    NOW()
FROM operator_experiences
WHERE operator = 'Beau'
  AND NOT EXISTS (
      SELECT 1 FROM operator_experiences existing WHERE existing.operator = 'WangYouKe'
  );

COMMIT;

-- ============================================================
-- 9. Post-check
-- ============================================================

SELECT 'creators_missing_wacrm' AS metric, COUNT(*) AS cnt
FROM creators c
LEFT JOIN wa_crm_data w ON w.creator_id = c.id
WHERE w.creator_id IS NULL
UNION ALL
SELECT 'creators_missing_profile', COUNT(*)
FROM creators c
LEFT JOIN client_profiles p ON p.client_id = c.wa_phone
WHERE p.client_id IS NULL
UNION ALL
SELECT 'profiles_empty_summary', COUNT(*)
FROM client_profiles
WHERE summary IS NULL OR TRIM(summary) = ''
UNION ALL
SELECT 'client_tags_total', COUNT(*)
FROM client_tags
UNION ALL
SELECT 'profile_change_events_pending', COUNT(*)
FROM client_profile_change_events
WHERE status = 'pending'
UNION ALL
SELECT 'wa_messages_empty_text', COUNT(*)
FROM wa_messages
WHERE text IS NULL OR TRIM(text) = ''
UNION ALL
SELECT 'wa_messages_null_operator', COUNT(*)
FROM wa_messages
WHERE operator IS NULL OR TRIM(operator) = ''
UNION ALL
SELECT 'manual_test_creators', COUNT(*)
FROM creators
WHERE source = 'manual_test'
UNION ALL
SELECT 'profile_analysis_state_orphans', COUNT(*)
FROM profile_analysis_state pas
LEFT JOIN creators c ON c.wa_phone = pas.client_id
WHERE c.id IS NULL;
