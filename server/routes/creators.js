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
const { buildLifecycle } = require('../services/lifecycleService');
const {
    DEFAULT_POLICY_KEY: LIFECYCLE_POLICY_KEY,
    buildDefaultPayload: buildDefaultLifecyclePayload,
    extractPayloadFromRow: extractLifecyclePayloadFromRow,
} = require('../services/lifecycleConfigService');
const {
    TABLE: ROSTER_TABLE,
    applyAssignmentToCreator,
    getAssignmentByCreatorId,
    getSessionIdForOperator,
    hasRosterAssignments,
} = require('../services/operatorRosterService');
const {
    getLifecycleSnapshotByCreatorId,
    rebuildReplyStrategyForCreator,
} = require('../services/replyStrategyService');

function normalizeManualPhone(value) {
    return String(value || '').replace(/\D/g, '').trim();
}

async function findPhoneConflictRows(dbConn, normalizedPhone) {
    if (!normalizedPhone) return [];
    return await dbConn.prepare(`
        SELECT id, primary_name, wa_phone, wa_owner, created_at
        FROM creators
        WHERE wa_phone = ?
           OR REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(wa_phone, '+', ''), ' ', ''), '-', ''), '(', ''), ')', '') = ?
        ORDER BY id DESC
        LIMIT 10
    `).all(normalizedPhone, normalizedPhone);
}

async function findNameConflictRows(dbConn, normalizedName) {
    if (!normalizedName) return [];
    return await dbConn.prepare(`
        SELECT id, primary_name, wa_phone, wa_owner, created_at
        FROM creators
        WHERE LOWER(TRIM(primary_name)) = LOWER(TRIM(?))
           OR LOWER(primary_name) LIKE LOWER(?)
        ORDER BY id DESC
        LIMIT 10
    `).all(normalizedName, `%${normalizedName}%`);
}

function normalizeCreatorIds(input = []) {
    return [...new Set(
        (input || [])
            .map((item) => parseInt(item, 10))
            .filter((item) => Number.isFinite(item) && item > 0)
    )];
}

async function getLifecycleRuntimeOptions(dbConn) {
    const fallback = buildDefaultLifecyclePayload();
    try {
        const row = await dbConn.prepare(
            'SELECT policy_key, policy_version, policy_content, applicable_scenarios, is_active, updated_at FROM policy_documents WHERE policy_key = ? LIMIT 1'
        ).get(LIFECYCLE_POLICY_KEY);
        const payload = extractLifecyclePayloadFromRow(row);
        const config = payload?.is_active === 0 ? fallback.config : (payload?.config || fallback.config);
        const thresholdRaw = Number(config?.revenue_gmv_threshold);
        return {
            strictRevenueGmv: config?.revenue_requires_gmv === true,
            revenueGmvThreshold: Number.isFinite(thresholdRaw) ? thresholdRaw : fallback.config.revenue_gmv_threshold,
            agencyBoundMainline: config?.agency_bound_mainline !== false,
        };
    } catch (err) {
        console.warn('[lifecycle] load config failed, fallback to defaults:', err.message);
        return {
            strictRevenueGmv: fallback.config.revenue_requires_gmv === true,
            revenueGmvThreshold: fallback.config.revenue_gmv_threshold,
            agencyBoundMainline: fallback.config.agency_bound_mainline !== false,
        };
    }
}

async function getLifecycleEventsMap(dbConn, creatorIds, options = {}) {
    const normalizedIds = normalizeCreatorIds(creatorIds);
    if (normalizedIds.length === 0) return new Map();

    const includeMeta = options.includeMeta !== false;
    const placeholders = normalizedIds.map(() => '?').join(', ');
    const selectFields = includeMeta
        ? 'id, creator_id, event_key, event_type, owner, status, trigger_source, start_at, end_at, created_at, updated_at, meta'
        : 'id, creator_id, event_key, event_type, owner, status, trigger_source, start_at, end_at, created_at, updated_at';
    const rows = await dbConn.prepare(`
        SELECT ${selectFields}
        FROM events
        WHERE creator_id IN (${placeholders})
          AND status IN ('active', 'completed')
        ORDER BY created_at DESC, id DESC
    `).all(...normalizedIds);

    const map = new Map(normalizedIds.map((id) => [id, []]));
    for (const row of rows) {
        const creatorId = Number(row.creator_id);
        const list = map.get(creatorId) || [];
        let normalizedRow = {
            ...row,
            creator_id: creatorId,
        };
        if (includeMeta) {
            let meta = null;
            if (row.meta && typeof row.meta === 'object') meta = row.meta;
            else if (typeof row.meta === 'string' && row.meta.trim()) {
                try {
                    meta = JSON.parse(row.meta);
                } catch (_) {
                    meta = null;
                }
            }
            normalizedRow = {
                ...normalizedRow,
                meta,
            };
        }
        list.push(normalizedRow);
        map.set(creatorId, list);
    }
    return map;
}

function buildLifecycleInput(source = {}, events = []) {
    return {
        ...source,
        wacrm: source.wacrm || {
            priority: source.priority,
            beta_status: source.beta_status,
            beta_program_type: source.beta_program_type,
            monthly_fee_status: source.monthly_fee_status,
            monthly_fee_deducted: source.monthly_fee_deducted,
            agency_bound: source.agency_bound,
            next_action: source.next_action,
            video_count: source.video_count,
            video_target: source.video_target,
        },
        joinbrands: source.joinbrands || {
            ev_joined: source.ev_joined,
            ev_ready_sent: source.ev_ready_sent,
            ev_trial_7day: source.ev_trial_7day,
            ev_trial_active: source.ev_trial_active,
            ev_monthly_invited: source.ev_monthly_invited,
            ev_monthly_started: source.ev_monthly_started,
            ev_monthly_joined: source.ev_monthly_joined,
            ev_whatsapp_shared: source.ev_whatsapp_shared,
            ev_gmv_1k: source.ev_gmv_1k,
            ev_gmv_2k: source.ev_gmv_2k,
            ev_gmv_5k: source.ev_gmv_5k,
            ev_gmv_10k: source.ev_gmv_10k,
            ev_agency_bound: source.ev_agency_bound,
            ev_churned: source.ev_churned,
        },
        keeper: source.keeper || {
            keeper_gmv: source.keeper_gmv,
            keeper_gmv30: source.keeper_gmv30,
            keeper_orders: source.keeper_orders,
        },
        events,
    };
}

function attachLifecycle(source = {}, events = [], lifecycleOptions = {}, attachOptions = {}) {
    const activeEvents = (events || []).filter((item) => item.status === 'active');
    const completedEvents = (events || []).filter((item) => item.status === 'completed');
    const withLifecycle = {
        ...source,
        lifecycle: buildLifecycle(buildLifecycleInput(source, events), lifecycleOptions),
    };
    if (attachOptions.includeEventLists === false) {
        return withLifecycle;
    }
    return {
        ...withLifecycle,
        active_events: activeEvents,
        completed_events: completedEvents,
    };
}

async function fetchCreatorsForBatchNextAction(dbConn, creatorIds) {
    const normalizedIds = normalizeCreatorIds(creatorIds);
    if (normalizedIds.length === 0) return [];
    const placeholders = normalizedIds.map(() => '?').join(', ');
    return await dbConn.prepare(`
        SELECT
            c.id,
            c.primary_name,
            c.wa_phone,
            c.keeper_username,
            c.wa_owner,
            c.source,
            c.is_active,
            c.created_at,
            c.updated_at,
            k.keeper_gmv,
            k.keeper_gmv30,
            k.keeper_orders,
            wc.priority,
            wc.beta_status,
            wc.beta_program_type,
            wc.monthly_fee_status,
            wc.monthly_fee_deducted,
            wc.agency_bound,
            wc.next_action,
            wc.video_count,
            wc.video_target,
            j.ev_joined,
            j.ev_ready_sent,
            j.ev_trial_7day,
            j.ev_trial_active,
            j.ev_monthly_invited,
            j.ev_monthly_started,
            j.ev_monthly_joined,
            j.ev_whatsapp_shared,
            j.ev_gmv_1k,
            j.ev_gmv_2k,
            j.ev_gmv_5k,
            j.ev_gmv_10k,
            j.ev_agency_bound,
            j.ev_churned
        FROM creators c
        LEFT JOIN keeper_link k ON k.creator_id = c.id
        LEFT JOIN wa_crm_data wc ON wc.creator_id = c.id
        LEFT JOIN joinbrands_link j ON j.creator_id = c.id
        WHERE c.id IN (${placeholders})
    `).all(...normalizedIds);
}

// GET /api/creators — 获取所有达人
router.get('/', async (req, res) => {
    try {
        const { owner, search, is_active, include_inactive, beta_status, priority, agency, event } = req.query;
        const rosterOnly = req.query.roster === 'all' ? false : await hasRosterAssignments();
        const dbConn = db.getDb();

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
                wc.beta_program_type,
                wc.monthly_fee_status,
                wc.monthly_fee_deducted,
                wc.agency_bound,
                wc.next_action,
                wc.video_count,
                wc.video_target,
                j.ev_joined,
                j.ev_ready_sent,
                j.ev_trial_7day,
                j.ev_trial_active,
                j.ev_monthly_invited,
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
        if (agency === 'yes') {
            sql += ' AND wc.agency_bound = 1';
        } else if (agency === 'no') {
            sql += ' AND (wc.agency_bound = 0 OR wc.agency_bound IS NULL)';
        }
        if (is_active !== undefined && is_active !== '') {
            sql += ' AND c.is_active = ?';
            params.push(is_active == '1' ? 1 : 0);
        } else if (include_inactive !== '1') {
            sql += ' AND c.is_active = 1';
        }
        if (event) {
            const VALID_EVENTS = ['joined','ready_sent','trial_7day','monthly_invited','monthly_joined','whatsapp_shared','gmv_1k','gmv_2k','gmv_5k','gmv_10k','agency_bound','churned'];
            if (event === 'replied') {
                sql += ` AND EXISTS (SELECT 1 FROM wa_messages WHERE creator_id = c.id AND role = 'me' AND timestamp >= (SELECT MAX(timestamp) FROM wa_messages WHERE creator_id = c.id AND role = 'user'))`;
            } else if (VALID_EVENTS.includes(event)) {
                sql += ` AND j.ev_${event} = 1`;
            }
        }

        sql += rosterOnly
            ? ' GROUP BY c.id, ocr.operator, ocr.session_id ORDER BY last_active DESC, msg_count DESC, c.id DESC'
            : ' GROUP BY c.id ORDER BY last_active DESC, msg_count DESC, c.id DESC';

        const creators = await dbConn.prepare(sql).all(...params);
        const creatorIds = creators.map((item) => item.id);
        const [eventsMap, lifecycleOptions] = await Promise.all([
            getLifecycleEventsMap(dbConn, creatorIds, { includeMeta: false }),
            getLifecycleRuntimeOptions(dbConn),
        ]);

        res.json(creators.map((item) => {
            const normalized = {
                ...item,
                wa_owner: normalizeOperatorName(item.roster_operator, item.roster_operator) || item.wa_owner,
                session_id: item.session_id || getSessionIdForOperator(item.roster_operator || item.wa_owner),
            };
            return attachLifecycle(normalized, eventsMap.get(Number(item.id)) || [], lifecycleOptions, {
                includeEventLists: false,
            });
        }));
    } catch (err) {
        console.error('Error fetching creators:', err);
        res.status(500).json({ error: err.message });
    }
});

// GET /api/creators/manual-check — 手动录入前去重检查（同号/重名）
router.get('/manual-check', async (req, res) => {
    try {
        const dbConn = db.getDb();
        const rawName = String(req.query.name || '').trim();
        const rawPhone = String(req.query.phone || '').trim();
        const normalizedPhone = normalizeManualPhone(rawPhone);
        const normalizedName = rawName.replace(/\s+/g, ' ').trim();
        const operator = normalizeOperatorName(req.query.owner, req.query.owner || 'Yiyun');

        const [samePhone, sameName] = await Promise.all([
            findPhoneConflictRows(dbConn, normalizedPhone),
            findNameConflictRows(dbConn, normalizedName),
        ]);

        const dedupById = new Map();
        for (const row of [...samePhone, ...sameName]) dedupById.set(row.id, row);
        const suggestions = [...dedupById.values()].slice(0, 10);

        res.json({
            ok: true,
            normalized: {
                phone: normalizedPhone,
                name: normalizedName,
                owner: operator,
            },
            conflicts: {
                same_phone_count: samePhone.length,
                same_name_count: sameName.length,
                same_phone: samePhone,
                same_name: sameName,
            },
            suggestions,
            can_create: normalizedPhone.length > 0 && samePhone.length === 0,
        });
    } catch (err) {
        console.error('GET /api/creators/manual-check error:', err);
        res.status(500).json({ ok: false, error: err.message });
    }
});

// POST /api/creators/manual — 手动录入达人（同号自动复用）
router.post('/manual', async (req, res) => {
    try {
        const dbConn = db.getDb();
        const rawName = String(req.body?.primary_name || req.body?.name || '').trim();
        const rawPhone = String(req.body?.wa_phone || req.body?.phone || '').trim();
        const operator = normalizeOperatorName(req.body?.wa_owner || req.body?.owner, 'Yiyun');
        const source = String(req.body?.source || 'manual').trim() || 'manual';
        const normalizedPhone = normalizeManualPhone(rawPhone);
        const normalizedName = rawName.replace(/\s+/g, ' ').trim();

        if (!normalizedName) {
            return res.status(400).json({ ok: false, error: 'primary_name required' });
        }
        if (!normalizedPhone) {
            return res.status(400).json({ ok: false, error: 'wa_phone required' });
        }

        const samePhoneRows = await findPhoneConflictRows(dbConn, normalizedPhone);
        const sameNameRows = await findNameConflictRows(dbConn, normalizedName);
        const reused = samePhoneRows.length > 0;

        const resultPayload = await dbConn.transaction(async (txDb) => {
            const upsertCreator = await txDb.prepare(`
                INSERT INTO creators (primary_name, wa_phone, wa_owner, source)
                VALUES (?, ?, ?, ?)
                ON DUPLICATE KEY UPDATE
                    id = LAST_INSERT_ID(id),
                    primary_name = VALUES(primary_name),
                    wa_owner = VALUES(wa_owner),
                    source = VALUES(source),
                    updated_at = CURRENT_TIMESTAMP
            `).run(normalizedName, normalizedPhone, operator, source);
            const creatorId = Number(upsertCreator.lastInsertRowid || 0);
            const sessionId = getSessionIdForOperator(operator) || String(operator || '').toLowerCase();

            await txDb.prepare(`
                INSERT INTO ${ROSTER_TABLE}
                    (creator_id, operator, session_id, source_file, raw_name, match_strategy, score, is_primary)
                VALUES (?, ?, ?, ?, ?, ?, ?, 1)
                ON DUPLICATE KEY UPDATE
                    operator = VALUES(operator),
                    session_id = VALUES(session_id),
                    source_file = VALUES(source_file),
                    raw_name = VALUES(raw_name),
                    match_strategy = VALUES(match_strategy),
                    score = VALUES(score),
                    is_primary = 1,
                    updated_at = CURRENT_TIMESTAMP
            `).run(creatorId, operator, sessionId, 'manual', normalizedName, 'manual', 100);

            await txDb.prepare('INSERT IGNORE INTO wa_crm_data (creator_id) VALUES (?)').run(creatorId);

            const creator = await txDb.prepare(`
                SELECT id, primary_name, wa_phone, wa_owner, source, is_active, created_at, updated_at
                FROM creators
                WHERE id = ?
                LIMIT 1
            `).get(creatorId);

            await writeAudit('creator_manual_upsert', 'creators', creatorId, null, {
                action: reused ? 'reuse_existing_by_phone' : 'create_new',
                primary_name: normalizedName,
                wa_phone: normalizedPhone,
                wa_owner: operator,
                source,
                same_phone_count: samePhoneRows.length,
                same_name_count: sameNameRows.length,
            }, req);

            return {
                ok: true,
                reused,
                creator,
                dedup: {
                    same_phone_count: samePhoneRows.length,
                    same_name_count: sameNameRows.length,
                    same_phone: samePhoneRows,
                    same_name: sameNameRows,
                },
            };
        });
        res.json(resultPayload);
    } catch (err) {
        console.error('POST /api/creators/manual error:', err);
        res.status(500).json({ ok: false, error: err.message });
    }
});

// POST /api/creators/batch-next-action — 批量回填 next_action（支持按生命周期 Option0）
router.post('/batch-next-action', async (req, res) => {
    try {
        const creatorIds = normalizeCreatorIds(req.body?.creator_ids);
        const mode = String(req.body?.mode || 'lifecycle_option0').trim() || 'lifecycle_option0';
        const customText = String(req.body?.text || '').trim();

        if (creatorIds.length === 0) {
            return res.status(400).json({ ok: false, error: 'creator_ids required' });
        }
        if (mode !== 'lifecycle_option0' && !customText) {
            return res.status(400).json({ ok: false, error: 'text required for custom mode' });
        }

        const dbConn = db.getDb();
        const [rows, eventsMap, lifecycleOptions] = await Promise.all([
            fetchCreatorsForBatchNextAction(dbConn, creatorIds),
            getLifecycleEventsMap(dbConn, creatorIds, { includeMeta: false }),
            getLifecycleRuntimeOptions(dbConn),
        ]);
        const rowMap = new Map(rows.map((row) => [Number(row.id), row]));
        const results = [];

        await dbConn.transaction(async (txDb) => {
            for (const creatorId of creatorIds) {
                const row = rowMap.get(creatorId);
                if (!row) continue;
                const lifecycle = buildLifecycle(buildLifecycleInput(row, eventsMap.get(creatorId) || []), lifecycleOptions);
                const nextActionText = mode === 'lifecycle_option0'
                    ? String(lifecycle.option0?.next_action_template || '').trim()
                    : customText;
                if (!nextActionText) continue;

                await txDb.prepare('INSERT IGNORE INTO wa_crm_data (creator_id) VALUES (?)').run(creatorId);
                await txDb.prepare(`
                    UPDATE wa_crm_data
                    SET next_action = ?, updated_at = CURRENT_TIMESTAMP
                    WHERE creator_id = ?
                `).run(nextActionText, creatorId);

                results.push({
                    creator_id: creatorId,
                    primary_name: row.primary_name,
                    lifecycle_stage: lifecycle.stage_key,
                    lifecycle_label: lifecycle.stage_label,
                    option0_label: lifecycle.option0?.label || null,
                    next_action: nextActionText,
                    next_action_en: lifecycle.option0?.next_action_template_en || null,
                });
            }
        });

        await writeAudit('creator_batch_next_action', 'wa_crm_data', null, null, {
            mode,
            requested_count: creatorIds.length,
            updated_count: results.length,
            creator_ids: creatorIds,
            results,
        }, req);

        res.json({
            ok: true,
            mode,
            requested_count: creatorIds.length,
            updated_count: results.length,
            results,
        });
    } catch (err) {
        console.error('POST /api/creators/batch-next-action error:', err);
        res.status(500).json({ ok: false, error: err.message });
    }
});

// GET /api/creators/:id — 获取单个达人完整信息
router.get('/:id', async (req, res) => {
    try {
        const creatorId = parseInt(req.params.id, 10);
        const dbConn = db.getDb();
        const creator = await getCreatorFull(creatorId);
        if (!creator) {
            return res.status(404).json({ error: 'Creator not found' });
        }
        const [assignment, eventsMap, lifecycleOptions] = await Promise.all([
            getAssignmentByCreatorId(creator.id),
            getLifecycleEventsMap(dbConn, [creator.id]),
            getLifecycleRuntimeOptions(dbConn),
        ]);
        const withAssignment = applyAssignmentToCreator(creator, assignment);
        res.json(attachLifecycle(withAssignment, eventsMap.get(creator.id) || [], lifecycleOptions));
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

        if (wa_phone !== undefined && (wa_phone === null || String(wa_phone).trim() === '')) {
            return res.status(400).json({ error: 'wa_phone cannot be empty' });
        }

        const fields = [];
        const values = [];
        if (primary_name !== undefined) { fields.push('primary_name = ?'); values.push(primary_name); }
        if (wa_phone !== undefined) { fields.push('wa_phone = ?'); values.push(wa_phone); }
        if (wa_owner !== undefined) { fields.push('wa_owner = ?'); values.push(normalizeOperatorName(wa_owner, wa_owner)); }
        if (keeper_username !== undefined) { fields.push('keeper_username = ?'); values.push(keeper_username); }

        if (fields.length === 0) return res.status(400).json({ error: 'No fields to update' });

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
        const beforeLifecycle = await getLifecycleSnapshotByCreatorId(creatorId).catch(() => null);
        const { updatedFields } = await db.getDb().transaction(async (txDb) => {
            const nextUpdatedFields = [];

            const wacrmFields = [];
            const wacrmValues = [];
            if (beta_status !== undefined) { wacrmFields.push('beta_status = ?'); wacrmValues.push(beta_status); }
            if (priority !== undefined) { wacrmFields.push('priority = ?'); wacrmValues.push(priority); }
            if (agency_bound !== undefined) { wacrmFields.push('agency_bound = ?'); wacrmValues.push(agency_bound); }
            if (video_count !== undefined) { wacrmFields.push('video_count = ?'); wacrmValues.push(video_count); }
            if (video_target !== undefined) { wacrmFields.push('video_target = ?'); wacrmValues.push(video_target); }
            if (monthly_fee_status !== undefined) { wacrmFields.push('monthly_fee_status = ?'); wacrmValues.push(monthly_fee_status); }
            if (monthly_fee_amount !== undefined) { wacrmFields.push('monthly_fee_amount = ?'); wacrmValues.push(monthly_fee_amount); }
            if (next_action !== undefined) { wacrmFields.push('next_action = ?'); wacrmValues.push(next_action); }

            if (wacrmFields.length > 0) {
                wacrmFields.push('updated_at = CURRENT_TIMESTAMP');
                wacrmValues.push(creatorId);
                const existing = await txDb.prepare('SELECT id FROM wa_crm_data WHERE creator_id = ?').get(creatorId);
                if (!existing) {
                    await txDb.prepare('INSERT INTO wa_crm_data (creator_id) VALUES (?)').run(creatorId);
                }
                await txDb.prepare(`UPDATE wa_crm_data SET ${wacrmFields.join(', ')} WHERE creator_id = ?`).run(...wacrmValues);
                nextUpdatedFields.push(...wacrmFields.filter(f => f !== 'updated_at = CURRENT_TIMESTAMP').map(f => 'wacrm.' + f.split(' = ')[0]));
            }

            const jbFields = [];
            const jbValues = [];
            if (ev_trial_active !== undefined) {
                const activeValue = ev_trial_active ? 1 : 0;
                jbFields.push('ev_trial_7day = ?', 'ev_trial_active = ?');
                jbValues.push(activeValue, activeValue);
            }
            if (ev_monthly_started !== undefined) { jbFields.push('ev_monthly_started = ?'); jbValues.push(ev_monthly_started ? 1 : 0); }
            if (ev_gmv_1k !== undefined) { jbFields.push('ev_gmv_1k = ?'); jbValues.push(ev_gmv_1k ? 1 : 0); }
            if (ev_gmv_2k !== undefined) { jbFields.push('ev_gmv_2k = ?'); jbValues.push(ev_gmv_2k ? 1 : 0); }
            if (ev_gmv_5k !== undefined) { jbFields.push('ev_gmv_5k = ?'); jbValues.push(ev_gmv_5k ? 1 : 0); }
            if (ev_gmv_10k !== undefined) { jbFields.push('ev_gmv_10k = ?'); jbValues.push(ev_gmv_10k ? 1 : 0); }
            if (ev_agency_bound !== undefined) { jbFields.push('ev_agency_bound = ?'); jbValues.push(ev_agency_bound ? 1 : 0); }
            if (ev_churned !== undefined) { jbFields.push('ev_churned = ?'); jbValues.push(ev_churned ? 1 : 0); }

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
            if (keeper_gmv !== undefined) { kFields.push('keeper_gmv = ?'); kValues.push(keeper_gmv); }
            if (keeper_gmv30 !== undefined) { kFields.push('keeper_gmv30 = ?'); kValues.push(keeper_gmv30); }
            if (keeper_orders !== undefined) { kFields.push('keeper_orders = ?'); kValues.push(keeper_orders); }
            if (keeper_videos !== undefined) { kFields.push('keeper_videos = ?'); kValues.push(keeper_videos); }
            if (keeper_videos_posted !== undefined) { kFields.push('keeper_videos_posted = ?'); kValues.push(keeper_videos_posted); }
            if (keeper_videos_sold !== undefined) { kFields.push('keeper_videos_sold = ?'); kValues.push(keeper_videos_sold); }
            if (keeper_card_rate !== undefined) { kFields.push('keeper_card_rate = ?'); kValues.push(keeper_card_rate); }
            if (keeper_order_rate !== undefined) { kFields.push('keeper_order_rate = ?'); kValues.push(keeper_order_rate); }
            if (keeper_reg_time !== undefined) { kFields.push('keeper_reg_time = ?'); kValues.push(keeper_reg_time); }
            if (keeper_activate_time !== undefined) { kFields.push('keeper_activate_time = ?'); kValues.push(keeper_activate_time); }

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

        if (updatedFields.length === 0) {
            return res.status(400).json({ error: 'No fields to update' });
        }

        const afterLifecycle = await getLifecycleSnapshotByCreatorId(creatorId).catch(() => null);
        const lifecycleChanged = !!(
            beforeLifecycle?.stage_key &&
            afterLifecycle?.stage_key &&
            beforeLifecycle.stage_key !== afterLifecycle.stage_key
        );

        let strategyRebuild = null;
        if (lifecycleChanged) {
            try {
                strategyRebuild = await rebuildReplyStrategyForCreator({
                    creatorId,
                    trigger: 'lifecycle_change_wacrm',
                    allowSoftAdjust: false,
                });
            } catch (e) {
                strategyRebuild = { ok: false, reason: e.message };
            }
        }

        await writeAudit('creator_profile_update', 'multi', creatorId, null, {
            ...req.body,
            updated: updatedFields,
            lifecycle_before: beforeLifecycle?.stage_key || null,
            lifecycle_after: afterLifecycle?.stage_key || null,
            lifecycle_changed: lifecycleChanged,
            reply_strategy: strategyRebuild,
        }, req);
        res.json({
            ok: true,
            updated: updatedFields,
            lifecycle_before: beforeLifecycle?.stage_key || null,
            lifecycle_after: afterLifecycle?.stage_key || null,
            lifecycle_changed: lifecycleChanged,
            reply_strategy: strategyRebuild,
        });
    } catch (err) {
        console.error('PUT /api/creators/:id/wacrm error:', err);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
