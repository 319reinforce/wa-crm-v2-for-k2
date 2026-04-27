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
const { aggregateEventStats } = require('../services/eventLifecycleFacts');

function snapshotFlagExpr(field, fallbackExpr = '0') {
    const safeField = String(field || '').replace(/[^a-zA-Z0-9_]/g, '');
    const jsonPath = `$.${safeField}`;
    return `
        CASE
            WHEN ces.compat_ev_flags_json IS NOT NULL
             AND JSON_CONTAINS_PATH(ces.compat_ev_flags_json, 'one', '${jsonPath}') = 1
            THEN CASE
                WHEN JSON_UNQUOTE(JSON_EXTRACT(ces.compat_ev_flags_json, '${jsonPath}')) IN ('true', '1') THEN 1
                ELSE 0
            END
            ELSE COALESCE(${fallbackExpr}, 0)
        END
    `;
}

function eventCountExpr(field, fallbackExpr = null) {
    return `SUM(${snapshotFlagExpr(field, fallbackExpr || `j.${field}`)}) as ${field}`;
}

function betaStatusExpr() {
    return `
        CASE
            WHEN ${snapshotFlagExpr('ev_churned', '0')} = 1 THEN 'churned'
            WHEN ${snapshotFlagExpr('ev_monthly_joined', '0')} = 1
              OR ${snapshotFlagExpr('ev_trial_7day', '0')} = 1 THEN 'completed'
            WHEN ${snapshotFlagExpr('ev_monthly_started', '0')} = 1
              OR ${snapshotFlagExpr('ev_trial_active', '0')} = 1 THEN 'active'
            ELSE COALESCE(wc.beta_status, 'unknown')
        END
    `;
}

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

        const [totalsRow, byOwnerRows, byBetaRows, byPriorityRows, evRow, eventRows, replyHitRow] = await Promise.all([
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
                SELECT beta_status, COUNT(*) as count
                FROM (
                    SELECT c.id, ${betaStatusExpr()} as beta_status
                    FROM creators c
                    LEFT JOIN wa_crm_data wc ON wc.creator_id = c.id
                    LEFT JOIN creator_event_snapshot ces ON ces.creator_id = c.id
                    ${rosterJoin}
                    WHERE c.is_active = 1
                    ${scopeWhere}
                ) grouped_beta
                GROUP BY beta_status
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
                    SUM(COALESCE(j.ev_joined, 0)) as ev_joined,
                    SUM(COALESCE(j.ev_ready_sent, 0)) as ev_ready_sent,
                    ${eventCountExpr('ev_trial_7day')},
                    SUM(COALESCE(j.ev_monthly_invited, 0)) as ev_monthly_invited,
                    ${eventCountExpr('ev_monthly_started')},
                    ${eventCountExpr('ev_monthly_joined')},
                    SUM(COALESCE(j.ev_whatsapp_shared, 0)) as ev_whatsapp_shared,
                    ${eventCountExpr('ev_gmv_1k')},
                    ${eventCountExpr('ev_gmv_2k')},
                    ${eventCountExpr('ev_gmv_5k')},
                    ${eventCountExpr('ev_gmv_10k')},
                    ${eventCountExpr('ev_agency_bound')},
                    ${eventCountExpr('ev_churned')}
                FROM creators c
                LEFT JOIN joinbrands_link j ON j.creator_id = c.id
                LEFT JOIN creator_event_snapshot ces ON ces.creator_id = c.id
                ${rosterJoin}
                WHERE c.is_active = 1
                ${scopeWhere}
            `).get(...scopeParams),
            db2.prepare(`
                SELECT
                    e.*
                FROM events e
                INNER JOIN creators c ON c.id = e.creator_id
                ${rosterJoin}
                WHERE c.is_active = 1
                ${scopeWhere}
            `).all(...scopeParams),
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
        const eventStats = aggregateEventStats(eventRows || []);

        res.json({
            total_creators: totalsRow.total_creators || 0,
            by_owner: byOwner,
            total_messages: totalsRow.total_messages || 0,
            by_beta: byBeta,
            by_priority: byPriority,
            events: evRow,
            total_events: Number(eventStats.total_events || 0),
            total_canonical_events: Number(eventStats.total_canonical_events || 0),
            total_lifecycle_driving_events: Number(eventStats.total_lifecycle_driving_events || 0),
            yesterday_new_events: Number(eventStats.yesterday_detected_events || 0),
            yesterday_detected_events: Number(eventStats.yesterday_detected_events || 0),
            yesterday_business_events: Number(eventStats.yesterday_business_events || 0),
            yesterday_confirmed_events: Number(eventStats.yesterday_confirmed_events || 0),
            generation_reply_hit_rate: replyHitRate,
            });
    } catch (err) {
        console.error('Error fetching stats:', err);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
