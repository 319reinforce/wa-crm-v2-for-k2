/**
 * Stats routes
 * GET /api/stats
 */
const express = require('express');
const router = express.Router();
const db = require('../../db');
const { getLockedOwner } = require('../middleware/appAuth');
const {
    TABLE: ROSTER_TABLE,
    hasRosterAssignments,
} = require('../services/operatorRosterService');

// GET /api/stats — 统计接口
router.get('/stats', async (req, res) => {
    try {
        const db2 = db.getDb();
        const lockedOwner = getLockedOwner(req);
        const rosterOnly = req.query.roster === 'all' ? false : await hasRosterAssignments();
        const rosterJoin = rosterOnly
            ? `INNER JOIN ${ROSTER_TABLE} ocr ON ocr.creator_id = c.id AND ocr.is_primary = 1`
            : '';
        const rosterJoinForMessages = rosterOnly
            ? `INNER JOIN ${ROSTER_TABLE} ocr2 ON ocr2.creator_id = c2.id AND ocr2.is_primary = 1`
            : '';
        const rosterJoinForSft = rosterOnly
            ? `INNER JOIN ${ROSTER_TABLE} ocr3 ON ocr3.creator_id = c3.id AND ocr3.is_primary = 1`
            : '';
        const rosterOwnerField = rosterOnly ? `COALESCE(ocr.operator, 'Unknown')` : `COALESCE(c.wa_owner, 'Unknown')`;
        const scopeWhere = lockedOwner
            ? ` AND LOWER(${rosterOnly ? 'ocr.operator' : 'c.wa_owner'}) = LOWER(?)`
            : '';
        const scopeWhereMessages = lockedOwner
            ? ` AND LOWER(${rosterOnly ? 'ocr2.operator' : 'c2.wa_owner'}) = LOWER(?)`
            : '';
        const scopeWhereSft = lockedOwner
            ? ` AND LOWER(${rosterOnly ? 'ocr3.operator' : 'c3.wa_owner'}) = LOWER(?)`
            : '';
        const scopeParams = lockedOwner ? [lockedOwner] : [];

        const [totalsRow, byOwnerRows, byBetaRows, byPriorityRows, evRow, eventStatsRow, replyHitRow] = await Promise.all([
            db2.prepare(`
                SELECT COUNT(DISTINCT c.id) as total_creators,
                       (
                           SELECT COUNT(*)
                           FROM wa_messages wm
                           INNER JOIN creators c2 ON c2.id = wm.creator_id
                           ${rosterJoinForMessages}
                           WHERE c2.is_active = 1
                           ${scopeWhereMessages}
                       ) as total_messages
                FROM creators c
                ${rosterJoin}
                WHERE c.is_active = 1
                ${scopeWhere}
            `).get(...scopeParams, ...scopeParams),
            db2.prepare(`
                SELECT ${rosterOwnerField} as wa_owner, COUNT(*) as count
                FROM creators c
                ${rosterJoin}
                WHERE c.is_active = 1
                ${scopeWhere}
                GROUP BY ${rosterOnly ? 'ocr.operator' : 'c.wa_owner'}
            `).all(...scopeParams),
            db2.prepare(`
                SELECT COALESCE(wc.beta_status, 'unknown') as beta_status, COUNT(*) as count
                FROM wa_crm_data wc
                INNER JOIN creators c ON c.id = wc.creator_id
                ${rosterJoin}
                WHERE c.is_active = 1
                ${scopeWhere}
                GROUP BY wc.beta_status
            `).all(...scopeParams),
            db2.prepare(`
                SELECT COALESCE(wc.priority, 'unknown') as priority, COUNT(*) as count
                FROM wa_crm_data wc
                INNER JOIN creators c ON c.id = wc.creator_id
                ${rosterJoin}
                WHERE c.is_active = 1
                ${scopeWhere}
                GROUP BY wc.priority
            `).all(...scopeParams),
            db2.prepare(`
                SELECT
                    SUM(j.ev_joined) as ev_joined,
                    SUM(j.ev_ready_sent) as ev_ready_sent,
                    SUM(j.ev_trial_7day) as ev_trial_7day,
                    SUM(j.ev_monthly_started) as ev_monthly_started,
                    SUM(j.ev_monthly_joined) as ev_monthly_joined,
                    SUM(j.ev_whatsapp_shared) as ev_whatsapp_shared,
                    SUM(j.ev_gmv_1k) as ev_gmv_1k,
                    SUM(j.ev_gmv_2k) as ev_gmv_2k,
                    SUM(j.ev_gmv_5k) as ev_gmv_5k,
                    SUM(j.ev_gmv_10k) as ev_gmv_10k,
                    SUM(j.ev_agency_bound) as ev_agency_bound,
                    SUM(j.ev_churned) as ev_churned
                FROM joinbrands_link j
                INNER JOIN creators c ON c.id = j.creator_id
                ${rosterJoin}
                WHERE c.is_active = 1
                ${scopeWhere}
            `).get(...scopeParams),
            db2.prepare(`
                SELECT
                    COUNT(*) as total_events,
                    SUM(
                        CASE
                            WHEN DATE(CONVERT_TZ(e.created_at, '+00:00', '+08:00')) = DATE(CONVERT_TZ(DATE_SUB(UTC_TIMESTAMP(), INTERVAL 1 DAY), '+00:00', '+08:00'))
                            THEN 1
                            ELSE 0
                        END
                    ) as yesterday_new_events
                FROM events e
                INNER JOIN creators c ON c.id = e.creator_id
                ${rosterJoin}
                WHERE c.is_active = 1
                ${scopeWhere}
            `).get(...scopeParams),
            db2.prepare(`
                SELECT
                    COUNT(*) as approved_total,
                    SUM(CASE WHEN human_selected IN ('opt1', 'opt2') THEN 1 ELSE 0 END) as adopted_total
                FROM sft_memory sm
                LEFT JOIN creators c3
                  ON c3.wa_phone = JSON_UNQUOTE(JSON_EXTRACT(sm.context_json, '$.client_id'))
                ${rosterJoinForSft}
                WHERE status = 'approved'
                ${scopeWhereSft}
            `).get(...scopeParams),
        ]);

        const byOwner = {};
        byOwnerRows.forEach(r => { byOwner[r.wa_owner] = r.count; });

        const byBeta = {};
        byBetaRows.forEach(r => { byBeta[r.beta_status] = r.count; });

        const byPriority = {};
        byPriorityRows.forEach(r => { byPriority[r.priority] = r.count; });

        const approvedTotal = Number(replyHitRow?.approved_total || 0);
        const adoptedTotal = Number(replyHitRow?.adopted_total || 0);
        const replyHitRate = approvedTotal > 0
            ? Math.round((adoptedTotal / approvedTotal) * 1000) / 10
            : 0;

        res.json({
            total_creators: totalsRow.total_creators || 0,
            by_owner: byOwner,
            total_messages: totalsRow.total_messages || 0,
            by_beta: byBeta,
            by_priority: byPriority,
            events: evRow,
            total_events: Number(eventStatsRow?.total_events || 0),
            yesterday_new_events: Number(eventStatsRow?.yesterday_new_events || 0),
            generation_reply_hit_rate: replyHitRate,
            });
    } catch (err) {
        console.error('Error fetching stats:', err);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
