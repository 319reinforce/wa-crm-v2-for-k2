/**
 * GET /api/operator-roster — 返回 canonical operator 列表,供 UsersPanel 下拉使用
 * 所有已认证用户都可读(DB admin/operator + env token 都可见,信息不敏感)
 *
 * 数据源(全部 union 去重):
 *   1. users.operator_name        — 管理员绑定过的 owner
 *   2. creators.wa_owner          — 达人身上实际在用的 owner
 *   3. wa_sessions.owner          — WhatsApp 账号绑定的 owner
 *
 * server/config/operatorRoster.js 只用于补充静态成员的展示信息/别名归一化,
 * 不再把本地固定名单当作前端 owner 默认选项。
 */
const express = require('express');
const db = require('../../db');
const { getOperatorRoster, sortOperatorNames } = require('../config/operatorRoster');
const { requireHumanAdmin } = require('../middleware/appAuth');
const { writeAudit } = require('../middleware/audit');
const creatorCache = require('../services/creatorCache');
const {
    TABLE: ROSTER_TABLE,
    getSessionIdForOperator,
    hasRosterAssignments,
    _invalidateRosterFlagCache,
} = require('../services/operatorRosterService');
const { normalizeOperatorName, ownersEqual } = require('../utils/operator');

const router = express.Router();

async function fetchDistinctNames(sql, label) {
    try {
        const rows = await db.getDb().prepare(sql).all();
        return (rows || [])
            .map((row) => {
                const v = row && (row.name ?? Object.values(row)[0]);
                return typeof v === 'string' ? v.trim() : '';
            })
            .filter(Boolean);
    } catch (err) {
        console.error(`GET /api/operator-roster ${label} failed:`, err.message);
        return [];
    }
}

function normalizeTransferOwner(raw) {
    const owner = normalizeOperatorName(raw, null);
    return owner && String(owner).trim() ? String(owner).trim() : null;
}

async function getTransferPreview(fromOwner, toOwner) {
    const dbConn = db.getDb();
    const useRosterAssignments = await hasRosterAssignments();
    const [creatorRow, rosterRow, activeCreatorRow, existingTargetRosterRow, eventRow] = useRosterAssignments
        ? await Promise.all([
            dbConn.prepare(`
                SELECT COUNT(DISTINCT c.id) AS c
                  FROM ${ROSTER_TABLE} r
                  JOIN creators c ON c.id = r.creator_id
                 WHERE r.operator = ?
                   AND r.is_primary = 1
            `).get(fromOwner),
            dbConn.prepare(`
                SELECT COUNT(*) AS c
                  FROM ${ROSTER_TABLE}
                 WHERE operator = ?
                   AND is_primary = 1
            `).get(fromOwner),
            dbConn.prepare(`
                SELECT COUNT(DISTINCT c.id) AS c
                  FROM ${ROSTER_TABLE} r
                  JOIN creators c ON c.id = r.creator_id
                 WHERE r.operator = ?
                   AND r.is_primary = 1
                   AND COALESCE(c.is_active, 1) = 1
            `).get(fromOwner),
            dbConn.prepare(`
                SELECT COUNT(*) AS c
                  FROM ${ROSTER_TABLE}
                 WHERE operator = ?
                   AND is_primary = 1
            `).get(toOwner),
            dbConn.prepare(`
                SELECT COUNT(*) AS c
                  FROM events e
                  JOIN ${ROSTER_TABLE} r ON r.creator_id = e.creator_id
                 WHERE r.operator = ?
                   AND r.is_primary = 1
                   AND e.owner = ?
            `).get(fromOwner, fromOwner),
        ])
        : await Promise.all([
            dbConn.prepare('SELECT COUNT(*) AS c FROM creators WHERE wa_owner = ?').get(fromOwner),
            dbConn.prepare(`SELECT COUNT(*) AS c FROM ${ROSTER_TABLE} WHERE operator = ?`).get(fromOwner),
            dbConn.prepare('SELECT COUNT(*) AS c FROM creators WHERE wa_owner = ? AND COALESCE(is_active, 1) = 1').get(fromOwner),
            dbConn.prepare(`SELECT COUNT(*) AS c FROM ${ROSTER_TABLE} WHERE operator = ?`).get(toOwner),
            dbConn.prepare(`
                SELECT COUNT(*) AS c
                  FROM events e
                  JOIN creators c ON c.id = e.creator_id
                 WHERE c.wa_owner = ?
                   AND e.owner = ?
            `).get(fromOwner, fromOwner),
        ]);
    return {
        from_owner: fromOwner,
        to_owner: toOwner,
        assignment_source: useRosterAssignments ? 'roster' : 'creators',
        creator_count: Number(creatorRow?.c || 0),
        active_creator_count: Number(activeCreatorRow?.c || 0),
        roster_count: Number(rosterRow?.c || 0),
        event_count: Number(eventRow?.c || 0),
        target_existing_roster_count: Number(existingTargetRosterRow?.c || 0),
        target_session_id: getSessionIdForOperator(toOwner) || String(toOwner || '').toLowerCase(),
    };
}

router.get('/', async (req, res) => {
    try {
        const staticByLower = new Map(
            getOperatorRoster().map((item) => [String(item.operator || '').toLowerCase(), item])
        );

        const [userNames, creatorOwners, sessionOwners] = await Promise.all([
            fetchDistinctNames(
                `SELECT DISTINCT operator_name AS name
                   FROM users
                  WHERE operator_name IS NOT NULL AND operator_name <> ''`,
                'users.operator_name',
            ),
            fetchDistinctNames(
                `SELECT DISTINCT wa_owner AS name
                   FROM creators
                  WHERE wa_owner IS NOT NULL AND wa_owner <> ''`,
                'creators.wa_owner',
            ),
            fetchDistinctNames(
                `SELECT DISTINCT owner AS name
                   FROM wa_sessions
                  WHERE owner IS NOT NULL AND owner <> ''`,
                'wa_sessions.owner',
            ),
        ]);

        // case-insensitive 去重，避免 DB 里混进 'jiawei' / 'Jiawei' 时前端
        // 看到两个 operator 选项。key 用 lowercase，value 保留首次见到的原始
        // 大小写（display_name），merge 所有 sources。
        const dynamicMap = new Map(); // lowercase key -> { display, sources:Set }
        for (const [list, src] of [
            [userNames, 'users'],
            [creatorOwners, 'creators'],
            [sessionOwners, 'sessions'],
        ]) {
            for (const name of list) {
                const key = String(name).toLowerCase();
                const existing = dynamicMap.get(key);
                if (existing) {
                    existing.sources.add(src);
                } else {
                    dynamicMap.set(key, { display: name, sources: new Set([src]) });
                }
            }
        }

        const dynamicItems = [...dynamicMap.values()]
            .map(({ display, sources }) => {
                const staticMeta = staticByLower.get(String(display).toLowerCase()) || {};
                return {
                    operator: staticMeta.operator || display,
                    real_name: staticMeta.real_name || null,
                    wa_note: staticMeta.wa_note || null,
                    source: 'dynamic',
                    seen_in: [...sources],
                };
            })
            .sort((a, b) => sortOperatorNames(a.operator, b.operator));

        res.json({ ok: true, data: dynamicItems });
    } catch (err) {
        console.error('GET /api/operator-roster error:', err);
        res.status(500).json({ error: err.message });
    }
});

// GET /api/operator-roster/transfer-preview?from=Jiawen&to=Yiyun
router.get('/transfer-preview', requireHumanAdmin, async (req, res) => {
    try {
        const fromOwner = normalizeTransferOwner(req.query?.from || req.query?.from_owner);
        const toOwner = normalizeTransferOwner(req.query?.to || req.query?.to_owner);
        if (!fromOwner || !toOwner) {
            return res.status(400).json({ ok: false, error: 'from and to owner are required' });
        }
        if (ownersEqual(fromOwner, toOwner)) {
            return res.status(400).json({ ok: false, error: 'from and to owner must be different' });
        }
        res.json({ ok: true, data: await getTransferPreview(fromOwner, toOwner) });
    } catch (err) {
        console.error('GET /api/operator-roster/transfer-preview error:', err);
        res.status(500).json({ ok: false, error: err.message });
    }
});

// POST /api/operator-roster/transfer — admin 批量转移联系人 owner 归属
router.post('/transfer', requireHumanAdmin, async (req, res) => {
    try {
        const fromOwner = normalizeTransferOwner(req.body?.from || req.body?.from_owner);
        const toOwner = normalizeTransferOwner(req.body?.to || req.body?.to_owner);
        const confirm = req.body?.confirm === true || req.body?.confirm === 'true';
        if (!fromOwner || !toOwner) {
            return res.status(400).json({ ok: false, error: 'from and to owner are required' });
        }
        if (ownersEqual(fromOwner, toOwner)) {
            return res.status(400).json({ ok: false, error: 'from and to owner must be different' });
        }

        const before = await getTransferPreview(fromOwner, toOwner);
        if (!confirm) {
            return res.json({ ok: true, dry_run: true, data: before });
        }

        const targetSessionId = before.target_session_id;
        const result = await db.getDb().transaction(async (txDb) => {
            const rows = before.assignment_source === 'roster'
                ? await txDb.prepare(`
                    SELECT DISTINCT c.id, c.wa_phone
                      FROM ${ROSTER_TABLE} r
                      JOIN creators c ON c.id = r.creator_id
                     WHERE r.operator = ?
                       AND r.is_primary = 1
                     ORDER BY c.id ASC
                `).all(fromOwner)
                : await txDb.prepare(`
                    SELECT id, wa_phone
                      FROM creators
                     WHERE wa_owner = ?
                     ORDER BY id ASC
                `).all(fromOwner);
            const creatorIds = rows.map((row) => Number(row.id)).filter(Boolean);

            let creatorsUpdated = 0;
            if (creatorIds.length > 0) {
                const placeholders = creatorIds.map(() => '?').join(', ');
                const creatorUpdate = await txDb.prepare(`
                    UPDATE creators
                       SET wa_owner = ?,
                           updated_at = CURRENT_TIMESTAMP
                     WHERE id IN (${placeholders})
                `).run(toOwner, ...creatorIds);
                creatorsUpdated = Number(creatorUpdate?.changes || 0);
            }

            const rosterUpdate = before.assignment_source === 'roster'
                ? await txDb.prepare(`
                    UPDATE ${ROSTER_TABLE}
                       SET operator = ?,
                           session_id = ?,
                           updated_at = CURRENT_TIMESTAMP
                     WHERE operator = ?
                       AND is_primary = 1
                `).run(toOwner, targetSessionId, fromOwner)
                : await txDb.prepare(`
                    UPDATE ${ROSTER_TABLE}
                       SET operator = ?,
                           session_id = ?,
                           updated_at = CURRENT_TIMESTAMP
                     WHERE operator = ?
                `).run(toOwner, targetSessionId, fromOwner);

            let eventsUpdated = 0;
            if (creatorIds.length > 0) {
                const placeholders = creatorIds.map(() => '?').join(', ');
                const eventUpdate = await txDb.prepare(`
                    UPDATE events
                       SET owner = ?,
                           updated_at = CURRENT_TIMESTAMP
                     WHERE owner = ?
                       AND creator_id IN (${placeholders})
                `).run(toOwner, fromOwner, ...creatorIds);
                eventsUpdated = Number(eventUpdate?.changes || 0);
            }

            return {
                creator_ids: creatorIds,
                creator_rows: rows,
                creators_updated: creatorsUpdated,
                roster_updated: Number(rosterUpdate?.changes || 0),
                events_updated: eventsUpdated,
            };
        });

        _invalidateRosterFlagCache();
        await Promise.all((result.creator_rows || []).map((row) => creatorCache.invalidateCreator(row.id, row.wa_phone)));

        const after = await getTransferPreview(fromOwner, toOwner);
        await writeAudit(
            'operator.transfer_contacts',
            'creators',
            null,
            before,
            {
                ...after,
                moved_from: fromOwner,
                moved_to: toOwner,
                creators_updated: result.creators_updated,
                roster_updated: result.roster_updated,
                events_updated: result.events_updated,
                creator_ids: result.creator_ids,
            },
            req
        );

        res.json({
            ok: true,
            data: {
                from_owner: fromOwner,
                to_owner: toOwner,
                creators_updated: result.creators_updated,
                roster_updated: result.roster_updated,
                events_updated: result.events_updated,
                target_session_id: targetSessionId,
                remaining_from_owner: after.creator_count,
            },
        });
    } catch (err) {
        console.error('POST /api/operator-roster/transfer error:', err);
        res.status(500).json({ ok: false, error: err.message });
    }
});

module.exports = router;
