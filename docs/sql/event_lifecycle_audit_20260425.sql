-- WA CRM v2 event/lifecycle production audit
-- Date: 2026-04-25
-- Purpose: read-only checks before migrating events into the canonical fact/evidence model.
-- Safe to run on MySQL 8.x. No writes.

SET @tz := '+08:00';
SET @yesterday := DATE(CONVERT_TZ(DATE_SUB(UTC_TIMESTAMP(), INTERVAL 1 DAY), '+00:00', @tz));

-- 1. Event volume by key/type/status/source.
SELECT
  e.event_key,
  e.event_type,
  e.status,
  e.trigger_source,
  COUNT(*) AS row_count,
  MIN(e.created_at) AS first_created_at,
  MAX(e.created_at) AS last_created_at
FROM events e
GROUP BY e.event_key, e.event_type, e.status, e.trigger_source
ORDER BY row_count DESC, e.event_key ASC;

-- 2. Canonical vs generated event shape.
SELECT
  CASE
    WHEN e.event_key IN (
      'trial_7day', 'monthly_challenge', 'agency_bound', 'gmv_milestone',
      'referral', 'recall_pending', 'second_touch',
      'churned', 'do_not_contact', 'opt_out'
    ) THEN 'canonical'
    WHEN e.event_key REGEXP '^(jb_touchpoint_|violation_)'
      OR e.event_key REGEXP '_unknown$'
      OR e.event_key REGEXP '^gmv_milestone_[0-9]+'
    THEN 'generated_or_dynamic'
    ELSE 'other_noncanonical'
  END AS event_shape,
  e.status,
  COUNT(*) AS row_count
FROM events e
GROUP BY event_shape, e.status
ORDER BY event_shape, e.status;

-- 3. Evidence tier and verification coverage.
SELECT evidence_tier, source_kind, review_status, lifecycle_effect, COUNT(*) AS row_count
FROM (
  SELECT
    COALESCE(CAST(e.evidence_tier AS CHAR), JSON_UNQUOTE(JSON_EXTRACT(e.meta, '$.evidence_contract.evidence_tier')), 'missing') AS evidence_tier,
    COALESCE(e.source_kind, JSON_UNQUOTE(JSON_EXTRACT(e.meta, '$.evidence_contract.source_kind')), 'missing') AS source_kind,
    COALESCE(e.review_state, JSON_UNQUOTE(JSON_EXTRACT(e.meta, '$.verification.review_status')), 'missing') AS review_status,
    COALESCE(e.lifecycle_effect, 'missing') AS lifecycle_effect
  FROM events e
) t
GROUP BY evidence_tier, source_kind, review_status, lifecycle_effect
ORDER BY row_count DESC;

-- 4. Active/completed canonical rows with weak or missing verification.
SELECT
  e.id,
  e.creator_id,
  c.primary_name,
  c.wa_owner,
  e.event_key,
  e.event_type,
  e.status,
  e.trigger_source,
  COALESCE(CAST(e.evidence_tier AS CHAR), JSON_UNQUOTE(JSON_EXTRACT(e.meta, '$.evidence_contract.evidence_tier')), 'missing') AS evidence_tier,
  COALESCE(e.review_state, JSON_UNQUOTE(JSON_EXTRACT(e.meta, '$.verification.review_status')), 'missing') AS review_status,
  COALESCE(e.lifecycle_effect, 'missing') AS lifecycle_effect,
  e.created_at,
  e.start_at
FROM events e
JOIN creators c ON c.id = e.creator_id
WHERE e.status IN ('active', 'completed')
  AND e.event_key IN (
    'trial_7day', 'monthly_challenge', 'agency_bound', 'gmv_milestone',
    'referral', 'recall_pending', 'second_touch',
    'churned', 'do_not_contact', 'opt_out'
  )
  AND (
    COALESCE(e.evidence_tier, CAST(JSON_UNQUOTE(JSON_EXTRACT(e.meta, '$.evidence_contract.evidence_tier')) AS UNSIGNED), 0) < 2
    OR COALESCE(e.lifecycle_effect, '') = 'none'
  )
ORDER BY e.created_at DESC, e.id DESC
LIMIT 200;

-- 5. Generated rows that are active/completed and must not drive lifecycle.
SELECT
  e.id,
  e.creator_id,
  c.primary_name,
  c.wa_owner,
  e.event_key,
  e.event_type,
  e.status,
  e.trigger_source,
  e.created_at
FROM events e
JOIN creators c ON c.id = e.creator_id
WHERE e.status IN ('active', 'completed')
  AND (
    e.event_key REGEXP '^(jb_touchpoint_|violation_)'
    OR e.event_key REGEXP '_unknown$'
    OR e.event_key REGEXP '^gmv_milestone_[0-9]+'
  )
ORDER BY e.created_at DESC, e.id DESC
LIMIT 200;

-- 6. Challenge events missing period settlement evidence.
SELECT
  e.id,
  e.creator_id,
  c.primary_name,
  c.wa_owner,
  e.event_key,
  e.status,
  e.start_at,
  e.end_at,
  e.created_at,
  COUNT(ep.id) AS period_count
FROM events e
JOIN creators c ON c.id = e.creator_id
LEFT JOIN event_periods ep ON ep.event_id = e.id
WHERE e.event_key IN ('trial_7day', 'monthly_challenge')
  AND e.status IN ('active', 'completed')
GROUP BY e.id, e.creator_id, c.primary_name, c.wa_owner, e.event_key, e.status, e.start_at, e.end_at, e.created_at
HAVING period_count = 0
ORDER BY e.created_at DESC, e.id DESC
LIMIT 200;

-- 7. JoinBrands compatibility flags without matching canonical events.
SELECT
  c.id AS creator_id,
  c.primary_name,
  c.wa_owner,
  j.ev_trial_active,
  j.ev_monthly_started,
  j.ev_monthly_joined,
  j.ev_agency_bound,
  j.ev_churned,
  j.ev_gmv_2k,
  SUM(CASE WHEN e.event_key = 'trial_7day' AND e.status IN ('active','completed') THEN 1 ELSE 0 END) AS trial_events,
  SUM(CASE WHEN e.event_key = 'monthly_challenge' AND e.status IN ('active','completed') THEN 1 ELSE 0 END) AS monthly_events,
  SUM(CASE WHEN e.event_key = 'agency_bound' AND e.status IN ('active','completed') THEN 1 ELSE 0 END) AS agency_events,
  SUM(CASE WHEN e.event_key = 'churned' AND e.status IN ('active','completed') THEN 1 ELSE 0 END) AS churn_events,
  SUM(CASE WHEN e.event_key = 'gmv_milestone' AND e.status IN ('active','completed') THEN 1 ELSE 0 END) AS gmv_events
FROM creators c
JOIN joinbrands_link j ON j.creator_id = c.id
LEFT JOIN events e ON e.creator_id = c.id
WHERE c.is_active = 1
  AND (
    j.ev_trial_active = 1
    OR j.ev_monthly_started = 1
    OR j.ev_monthly_joined = 1
    OR j.ev_agency_bound = 1
    OR j.ev_churned = 1
    OR j.ev_gmv_2k = 1
  )
GROUP BY c.id, c.primary_name, c.wa_owner, j.ev_trial_active, j.ev_monthly_started, j.ev_monthly_joined, j.ev_agency_bound, j.ev_churned, j.ev_gmv_2k
HAVING
  (j.ev_trial_active = 1 AND trial_events = 0)
  OR ((j.ev_monthly_started = 1 OR j.ev_monthly_joined = 1) AND monthly_events = 0)
  OR (j.ev_agency_bound = 1 AND agency_events = 0)
  OR (j.ev_churned = 1 AND churn_events = 0)
  OR (j.ev_gmv_2k = 1 AND gmv_events = 0)
ORDER BY c.wa_owner, c.id
LIMIT 200;

-- 8. Lifecycle snapshot conflicts currently stored.
SELECT
  cls.creator_id,
  c.primary_name,
  c.wa_owner,
  cls.stage_key,
  cls.stage_label,
  cls.entry_reason,
  cls.conflicts_json,
  cls.evaluated_at
FROM creator_lifecycle_snapshot cls
JOIN creators c ON c.id = cls.creator_id
WHERE JSON_LENGTH(cls.conflicts_json) > 0
ORDER BY cls.evaluated_at DESC, cls.creator_id DESC
LIMIT 200;

-- 9. Yesterday metrics by explicit basis.
SELECT
  COUNT(*) AS total_events,
  SUM(CASE
    WHEN e.event_key IN (
      'trial_7day', 'monthly_challenge', 'agency_bound', 'gmv_milestone',
      'referral', 'recall_pending', 'second_touch',
      'churned', 'do_not_contact', 'opt_out'
    ) THEN 1 ELSE 0 END) AS total_canonical_events,
  SUM(CASE
    WHEN DATE(CONVERT_TZ(e.created_at, '+00:00', @tz)) = @yesterday
    THEN 1 ELSE 0 END) AS yesterday_detected_events,
  SUM(CASE
    WHEN e.status IN ('active', 'completed')
      AND e.event_key IN (
        'trial_7day', 'monthly_challenge', 'agency_bound', 'gmv_milestone',
        'referral', 'recall_pending', 'second_touch',
        'churned', 'do_not_contact', 'opt_out'
      )
      AND COALESCE(e.evidence_tier, 0) >= 2
      AND COALESCE(e.lifecycle_effect, '') <> 'none'
      AND DATE(CONVERT_TZ(COALESCE(e.source_event_at, e.start_at, e.created_at), '+00:00', @tz)) = @yesterday
    THEN 1 ELSE 0 END) AS yesterday_business_events,
  SUM(CASE
    WHEN COALESCE(e.review_state, JSON_UNQUOTE(JSON_EXTRACT(e.meta, '$.verification.review_status')), '') = 'confirmed'
      AND DATE(CONVERT_TZ(COALESCE(
        e.verified_at,
        JSON_UNQUOTE(JSON_EXTRACT(e.meta, '$.verification.verified_at')),
        e.updated_at
      ), '+00:00', @tz)) = @yesterday
    THEN 1 ELSE 0 END) AS yesterday_confirmed_events
FROM events e;

-- 10. Candidate rows older than 7 days that need review or expiry.
SELECT
  e.id,
  e.creator_id,
  c.primary_name,
  c.wa_owner,
  e.event_key,
  e.status,
  e.trigger_source,
  COALESCE(JSON_UNQUOTE(JSON_EXTRACT(e.meta, '$.verification.review_status')), 'missing') AS review_status,
  e.created_at
FROM events e
JOIN creators c ON c.id = e.creator_id
WHERE e.status = 'draft'
  AND e.created_at < DATE_SUB(UTC_TIMESTAMP(), INTERVAL 7 DAY)
ORDER BY e.created_at ASC, e.id ASC
LIMIT 200;
