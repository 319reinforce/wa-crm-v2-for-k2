/**
 * Creators routes
 * GET /api/creators, GET /api/creators/:id, PUT /api/creators/:id, PUT /api/creators/:id/wacrm
 */
const express = require('express');
const router = express.Router();
const db = require('../../db');
const { getCreatorFull } = require('../../db');
const { writeAudit } = require('../middleware/audit');
const { normalizeOperatorName } = require('../utils/operator');
const {
    TABLE: ROSTER_TABLE,
    applyAssignmentToCreator,
    getAssignmentByCreatorId,
    getSessionIdForOperator,
    hasRosterAssignments,
} = require('../services/operatorRosterService');

// GET /api/creators — 获取所有达人
router.get('/', async (req, res) => {
    try {
        const { owner, search, is_active, include_inactive, beta_status, priority, agency, event } = req.query;
        const rosterOnly = req.query.roster ***REMOVED***= 'all' ? false : await hasRosterAssignments();

        let sql = `
            SELECT
                c.id,
                c.primary_name,
                c.wa_phone,
                c.keeper_username,
                c.wa_owner,
                ${rosterOnly ? 'ocr.operator AS roster_operator,' : 'NULL AS roster_operator,'}
                ${rosterOnly ? 'ocr.session_id AS session_id,' : 'NULL AS session_id,'}
                c.source,
                c.is_active,
                c.created_at,
                c.updated_at,
                COUNT(wm.id) as msg_count,
                MAX(wm.timestamp) as last_active,
                k.keeper_gmv,
                k.keeper_gmv30,
                k.keeper_orders,
                wc.priority,
                wc.beta_status,
                wc.monthly_fee_status,
                wc.agency_bound,
                wc.video_count,
                wc.video_target,
                j.ev_joined,
                j.ev_ready_sent,
                j.ev_trial_active,
                j.ev_monthly_started,
                j.ev_monthly_joined,
                j.ev_whatsapp_shared,
                j.ev_gmv_1k,
                j.ev_gmv_2k,
                j.ev_gmv_5k,
                j.ev_gmv_10k,
                j.ev_agency_bound,
                j.ev_churned,
                (
                    SELECT CASE
                        WHEN MAX(CASE WHEN role='user' THEN timestamp END) IS NULL THEN 1
                        WHEN MAX(CASE WHEN role='me' THEN timestamp END) >= MAX(CASE WHEN role='user' THEN timestamp END) THEN 1
                        ELSE 0
                    END
                    FROM wa_messages WHERE creator_id = c.id
                ) AS ev_replied,
                j.days_since_msg
            FROM creators c
            ${rosterOnly ? `INNER JOIN ${ROSTER_TABLE} ocr ON ocr.creator_id = c.id AND ocr.is_primary = 1` : ''}
            LEFT JOIN wa_messages wm ON wm.creator_id = c.id
            LEFT JOIN keeper_link k ON k.creator_id = c.id
            LEFT JOIN wa_crm_data wc ON wc.creator_id = c.id
            LEFT JOIN joinbrands_link j ON j.creator_id = c.id
            WHERE 1=1
        `;
        const params = [];

        if (owner) {
            if (rosterOnly) {
                sql += ' AND LOWER(ocr.operator) = LOWER(?)';
            } else {
                sql += ' AND LOWER(c.wa_owner) = LOWER(?)';
            }
            params.push(owner);
        }
        if (search) {
            sql += ' AND (c.primary_name LIKE ? OR c.wa_phone LIKE ? OR c.keeper_username LIKE ?)';
            const s = `%${search}%`;
            params.push(s, s, s);
        }
        if (beta_status) {
            sql += ' AND wc.beta_status = ?';
            params.push(beta_status);
        }
        if (priority) {
            sql += ' AND wc.priority = ?';
            params.push(priority);
        }
        if (agency ***REMOVED***= 'yes') {
            sql += ' AND wc.agency_bound = 1';
        } else if (agency ***REMOVED***= 'no') {
            sql += ' AND (wc.agency_bound = 0 OR wc.agency_bound IS NULL)';
        }
        if (is_active !***REMOVED*** undefined && is_active !***REMOVED*** '') {
            sql += ' AND c.is_active = ?';
            params.push(is_active ***REMOVED*** '1' ? 1 : 0);
        } else if (include_inactive !***REMOVED*** '1') {
            sql += ' AND c.is_active = 1';
        }
        if (event) {
            const VALID_EVENTS = ['joined','ready_sent','trial_7day','monthly_invited','monthly_joined','whatsapp_shared','gmv_1k','gmv_2k','gmv_5k','gmv_10k','agency_bound','churned'];
            if (event ***REMOVED***= 'replied') {
                sql += ` AND EXISTS (SELECT 1 FROM wa_messages WHERE creator_id = c.id AND role = 'me' AND timestamp >= (SELECT MAX(timestamp) FROM wa_messages WHERE creator_id = c.id AND role = 'user'))`;
            } else if (VALID_EVENTS.includes(event)) {
                sql += ` AND j.ev_${event} = 1`;
            }
        }

        sql += rosterOnly
            ? ' GROUP BY c.id, ocr.operator, ocr.session_id ORDER BY last_active DESC, msg_count DESC, c.id DESC'
            : ' GROUP BY c.id ORDER BY last_active DESC, msg_count DESC, c.id DESC';

        const creators = await db.getDb().prepare(sql).all(...params);
        res.json(creators.map((item) => ({
            ...item,
            wa_owner: normalizeOperatorName(item.roster_operator, item.roster_operator) || item.wa_owner,
            session_id: item.session_id || getSessionIdForOperator(item.roster_operator || item.wa_owner),
        })));
    } catch (err) {
        console.error('Error fetching creators:', err);
        res.status(500).json({ error: err.message });
    }
});

// GET /api/creators/:id — 获取单个达人完整信息
router.get('/:id', async (req, res) => {
    try {
        const creator = await getCreatorFull(parseInt(req.params.id, 10));
        if (!creator) {
            return res.status(404).json({ error: 'Creator not found' });
        }
        const assignment = await getAssignmentByCreatorId(creator.id);
        res.json(applyAssignmentToCreator(creator, assignment));
    } catch (err) {
        console.error('Error fetching creator:', err);
        res.status(500).json({ error: err.message });
    }
});

// PUT /api/creators/:id — 更新达人基本信息
router.put('/:id', async (req, res) => {
    try {
        const db2 = db.getDb();
        const { primary_name, wa_phone, wa_owner, keeper_username } = req.body;
        const id = parseInt(req.params.id);

        if (wa_phone !***REMOVED*** undefined && (wa_phone ***REMOVED***= null || String(wa_phone).trim() ***REMOVED***= '')) {
            return res.status(400).json({ error: 'wa_phone cannot be empty' });
        }

        const fields = [];
        const values = [];
        if (primary_name !***REMOVED*** undefined) { fields.push('primary_name = ?'); values.push(primary_name); }
        if (wa_phone !***REMOVED*** undefined) { fields.push('wa_phone = ?'); values.push(wa_phone); }
        if (wa_owner !***REMOVED*** undefined) { fields.push('wa_owner = ?'); values.push(normalizeOperatorName(wa_owner, wa_owner)); }
        if (keeper_username !***REMOVED*** undefined) { fields.push('keeper_username = ?'); values.push(keeper_username); }

        if (fields.length ***REMOVED***= 0) return res.status(400).json({ error: 'No fields to update' });

        fields.push('updated_at = CURRENT_TIMESTAMP');
        values.push(id);
        await db2.prepare(`UPDATE creators SET ${fields.join(', ')} WHERE id = ?`).run(...values);

        await writeAudit('creator_update', 'creators', id, null, req.body, req);
        res.json({ ok: true });
    } catch (err) {
        console.error('PUT /api/creators/:id error:', err);
        res.status(500).json({ error: err.message });
    }
});

// PUT /api/creators/:id/wacrm — 更新 WA CRM 数据
router.put('/:id/wacrm', async (req, res) => {
    try {
        const {
            beta_status, priority, agency_bound, video_count, video_target,
            monthly_fee_status, monthly_fee_amount, next_action,
            ev_trial_active, ev_monthly_started,
            ev_gmv_1k, ev_gmv_2k, ev_gmv_5k, ev_gmv_10k,
            ev_agency_bound, ev_churned,
            keeper_gmv, keeper_gmv30, keeper_orders,
            keeper_videos, keeper_videos_posted, keeper_videos_sold,
            keeper_card_rate, keeper_order_rate,
            keeper_reg_time, keeper_activate_time,
        } = req.body;
        const creatorId = parseInt(req.params.id);
        const { updatedFields } = await db.getDb().transaction(async (txDb) => {
            const nextUpdatedFields = [];

            const wacrmFields = [];
            const wacrmValues = [];
            if (beta_status !***REMOVED*** undefined) { wacrmFields.push('beta_status = ?'); wacrmValues.push(beta_status); }
            if (priority !***REMOVED*** undefined) { wacrmFields.push('priority = ?'); wacrmValues.push(priority); }
            if (agency_bound !***REMOVED*** undefined) { wacrmFields.push('agency_bound = ?'); wacrmValues.push(agency_bound); }
            if (video_count !***REMOVED*** undefined) { wacrmFields.push('video_count = ?'); wacrmValues.push(video_count); }
            if (video_target !***REMOVED*** undefined) { wacrmFields.push('video_target = ?'); wacrmValues.push(video_target); }
            if (monthly_fee_status !***REMOVED*** undefined) { wacrmFields.push('monthly_fee_status = ?'); wacrmValues.push(monthly_fee_status); }
            if (monthly_fee_amount !***REMOVED*** undefined) { wacrmFields.push('monthly_fee_amount = ?'); wacrmValues.push(monthly_fee_amount); }
            if (next_action !***REMOVED*** undefined) { wacrmFields.push('next_action = ?'); wacrmValues.push(next_action); }

            if (wacrmFields.length > 0) {
                wacrmFields.push('updated_at = CURRENT_TIMESTAMP');
                wacrmValues.push(creatorId);
                const existing = await txDb.prepare('SELECT id FROM wa_crm_data WHERE creator_id = ?').get(creatorId);
                if (!existing) {
                    await txDb.prepare('INSERT INTO wa_crm_data (creator_id) VALUES (?)').run(creatorId);
                }
                await txDb.prepare(`UPDATE wa_crm_data SET ${wacrmFields.join(', ')} WHERE creator_id = ?`).run(...wacrmValues);
                nextUpdatedFields.push(...wacrmFields.filter(f => f !***REMOVED*** 'updated_at = CURRENT_TIMESTAMP').map(f => 'wacrm.' + f.split(' = ')[0]));
            }

            const jbFields = [];
            const jbValues = [];
            if (ev_trial_active !***REMOVED*** undefined) {
                const activeValue = ev_trial_active ? 1 : 0;
                jbFields.push('ev_trial_7day = ?', 'ev_trial_active = ?');
                jbValues.push(activeValue, activeValue);
            }
            if (ev_monthly_started !***REMOVED*** undefined) { jbFields.push('ev_monthly_started = ?'); jbValues.push(ev_monthly_started ? 1 : 0); }
            if (ev_gmv_1k !***REMOVED*** undefined) { jbFields.push('ev_gmv_1k = ?'); jbValues.push(ev_gmv_1k ? 1 : 0); }
            if (ev_gmv_2k !***REMOVED*** undefined) { jbFields.push('ev_gmv_2k = ?'); jbValues.push(ev_gmv_2k ? 1 : 0); }
            if (ev_gmv_5k !***REMOVED*** undefined) { jbFields.push('ev_gmv_5k = ?'); jbValues.push(ev_gmv_5k ? 1 : 0); }
            if (ev_gmv_10k !***REMOVED*** undefined) { jbFields.push('ev_gmv_10k = ?'); jbValues.push(ev_gmv_10k ? 1 : 0); }
            if (ev_agency_bound !***REMOVED*** undefined) { jbFields.push('ev_agency_bound = ?'); jbValues.push(ev_agency_bound ? 1 : 0); }
            if (ev_churned !***REMOVED*** undefined) { jbFields.push('ev_churned = ?'); jbValues.push(ev_churned ? 1 : 0); }

            if (jbFields.length > 0) {
                const jbColumns = jbFields.map(f => f.split(' = ')[0]);
                await txDb.prepare(`INSERT INTO joinbrands_link (creator_id, ${jbColumns.join(', ')}) VALUES (?, ${jbFields.map(() => '?').join(', ')}) ON DUPLICATE KEY UPDATE ${jbFields.join(', ')}`).run(
                    creatorId,
                    ...jbValues,
                    ...jbValues,
                );
                nextUpdatedFields.push(...jbFields.map(f => 'jb.' + f.split(' = ')[0]));
            }

            const kFields = [];
            const kValues = [];
            if (keeper_gmv !***REMOVED*** undefined) { kFields.push('keeper_gmv = ?'); kValues.push(keeper_gmv); }
            if (keeper_gmv30 !***REMOVED*** undefined) { kFields.push('keeper_gmv30 = ?'); kValues.push(keeper_gmv30); }
            if (keeper_orders !***REMOVED*** undefined) { kFields.push('keeper_orders = ?'); kValues.push(keeper_orders); }
            if (keeper_videos !***REMOVED*** undefined) { kFields.push('keeper_videos = ?'); kValues.push(keeper_videos); }
            if (keeper_videos_posted !***REMOVED*** undefined) { kFields.push('keeper_videos_posted = ?'); kValues.push(keeper_videos_posted); }
            if (keeper_videos_sold !***REMOVED*** undefined) { kFields.push('keeper_videos_sold = ?'); kValues.push(keeper_videos_sold); }
            if (keeper_card_rate !***REMOVED*** undefined) { kFields.push('keeper_card_rate = ?'); kValues.push(keeper_card_rate); }
            if (keeper_order_rate !***REMOVED*** undefined) { kFields.push('keeper_order_rate = ?'); kValues.push(keeper_order_rate); }
            if (keeper_reg_time !***REMOVED*** undefined) { kFields.push('keeper_reg_time = ?'); kValues.push(keeper_reg_time); }
            if (keeper_activate_time !***REMOVED*** undefined) { kFields.push('keeper_activate_time = ?'); kValues.push(keeper_activate_time); }

            if (kFields.length > 0) {
                const kColumns = kFields.map(f => f.split(' = ')[0]);
                await txDb.prepare(`INSERT INTO keeper_link (creator_id, ${kColumns.join(', ')}) VALUES (?, ${kFields.map(() => '?').join(', ')}) ON DUPLICATE KEY UPDATE ${kFields.join(', ')}`).run(
                    creatorId,
                    ...kValues,
                    ...kValues,
                );
                nextUpdatedFields.push(...kFields.map(f => 'k.' + f.split(' = ')[0]));
            }

            if (ev_churned) {
                await txDb.prepare(`UPDATE wa_crm_data SET beta_status = 'churned' WHERE creator_id = ?`).run(creatorId);
                nextUpdatedFields.push('wacrm.beta_status→churned');
            }

            const creatorPhone = await txDb.prepare('SELECT wa_phone FROM creators WHERE id = ?').get(creatorId);
            if (creatorPhone) {
                if (ev_trial_active) {
                    await txDb.prepare(`INSERT IGNORE INTO client_tags (client_id, tag, source, confidence) VALUES (?, 'stage:trial', 'system', 3)`).run(creatorPhone.wa_phone);
                }
                if (ev_monthly_started) {
                    await txDb.prepare(`INSERT IGNORE INTO client_tags (client_id, tag, source, confidence) VALUES (?, 'stage:monthly', 'system', 3)`).run(creatorPhone.wa_phone);
                }
                if (ev_gmv_1k) {
                    await txDb.prepare(`INSERT IGNORE INTO client_tags (client_id, tag, source, confidence) VALUES (?, 'gmv_tier:1k', 'system', 3)`).run(creatorPhone.wa_phone);
                }
                if (ev_gmv_5k) {
                    await txDb.prepare(`INSERT IGNORE INTO client_tags (client_id, tag, source, confidence) VALUES (?, 'gmv_tier:5k', 'system', 3)`).run(creatorPhone.wa_phone);
                }
                if (ev_gmv_10k) {
                    await txDb.prepare(`INSERT IGNORE INTO client_tags (client_id, tag, source, confidence) VALUES (?, 'gmv_tier:10k', 'system', 3)`).run(creatorPhone.wa_phone);
                }
            }

            return { updatedFields: nextUpdatedFields };
        });

        if (updatedFields.length ***REMOVED***= 0) {
            return res.status(400).json({ error: 'No fields to update' });
        }

        await writeAudit('creator_profile_update', 'multi', creatorId, null, { ...req.body, updated: updatedFields }, req);
        res.json({ ok: true, updated: updatedFields });
    } catch (err) {
        console.error('PUT /api/creators/:id/wacrm error:', err);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
