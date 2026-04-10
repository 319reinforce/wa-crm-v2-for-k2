/**
 * Stats routes
 * GET /api/stats, GET /api/health
 */
const express = require('express');
const router = express.Router();
const db = require('../../db');

// GET /api/stats — 统计接口
router.get('/stats', async (req, res) => {
    try {
        const db2 = db.getDb();

        const [totalsRow, byOwnerRows, byBetaRows, byPriorityRows, evRow] = await Promise.all([
            db2.prepare(`
                SELECT COUNT(DISTINCT c.id) as total_creators,
                       (
                           SELECT COUNT(*)
                           FROM wa_messages wm
                           INNER JOIN creators c2 ON c2.id = wm.creator_id
                           WHERE c2.is_active = 1
                       ) as total_messages
                FROM creators c
                WHERE c.is_active = 1
            `).get(),
            db2.prepare(`
                SELECT COALESCE(c.wa_owner, 'Unknown') as wa_owner, COUNT(*) as count
                FROM creators c
                WHERE c.is_active = 1
                GROUP BY c.wa_owner
            `).all(),
            db2.prepare(`
                SELECT COALESCE(wc.beta_status, 'unknown') as beta_status, COUNT(*) as count
                FROM wa_crm_data wc
                INNER JOIN creators c ON c.id = wc.creator_id
                WHERE c.is_active = 1
                GROUP BY wc.beta_status
            `).all(),
            db2.prepare(`
                SELECT COALESCE(wc.priority, 'unknown') as priority, COUNT(*) as count
                FROM wa_crm_data wc
                INNER JOIN creators c ON c.id = wc.creator_id
                WHERE c.is_active = 1
                GROUP BY wc.priority
            `).all(),
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
                WHERE c.is_active = 1
            `).get(),
        ]);

        const byOwner = {};
        byOwnerRows.forEach(r => { byOwner[r.wa_owner] = r.count; });

        const byBeta = {};
        byBetaRows.forEach(r => { byBeta[r.beta_status] = r.count; });

        const byPriority = {};
        byPriorityRows.forEach(r => { byPriority[r.priority] = r.count; });

        res.json({
            total_creators: totalsRow.total_creators || 0,
            by_owner: byOwner,
            total_messages: totalsRow.total_messages || 0,
            by_beta: byBeta,
            by_priority: byPriority,
            events: evRow,
        });
    } catch (err) {
        console.error('Error fetching stats:', err);
        res.status(500).json({ error: err.message });
    }
});

// GET /api/health — 健康检查
router.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

module.exports = router;
