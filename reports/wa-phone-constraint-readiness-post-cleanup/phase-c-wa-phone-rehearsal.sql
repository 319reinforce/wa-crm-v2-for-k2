-- Prepared only. Do not execute blindly.
-- Phase C rehearsal for tightening creators.wa_phone to NOT NULL UNIQUE.

-- 1) Verify all primary roster creators already have wa_phone
SELECT COUNT(*) AS roster_null_phone FROM operator_creator_roster o JOIN creators c ON c.id = o.creator_id WHERE o.is_primary = 1 AND (c.wa_phone IS NULL OR TRIM(c.wa_phone) = '');

-- 2) Measure remaining null-phone historical creators
SELECT COUNT(*) AS null_phone_creators FROM creators WHERE wa_phone IS NULL OR TRIM(wa_phone) = '';

-- 3) Inspect pure shells (safest deletion/archive candidates)
SELECT c.id, c.primary_name, c.wa_owner, c.source, c.created_at FROM creators c LEFT JOIN creator_aliases a ON a.creator_id = c.id LEFT JOIN wa_crm_data w ON w.creator_id = c.id LEFT JOIN keeper_link k ON k.creator_id = c.id LEFT JOIN joinbrands_link j ON j.creator_id = c.id LEFT JOIN events e ON e.creator_id = c.id LEFT JOIN wa_messages wm ON wm.creator_id = c.id WHERE c.wa_phone IS NULL OR TRIM(c.wa_phone) = '' GROUP BY c.id, c.primary_name, c.wa_owner, c.source, c.created_at HAVING COUNT(a.id)=0 AND COUNT(w.creator_id)=0 AND COUNT(k.creator_id)=0 AND COUNT(j.creator_id)=0 AND COUNT(e.id)=0 AND COUNT(wm.id)=0;

-- 4) Only after cleanup/archive, enforce NOT NULL on creators.wa_phone
-- ALTER TABLE creators MODIFY wa_phone VARCHAR(32) NOT NULL COMMENT 'WhatsApp电话（唯一标识）';