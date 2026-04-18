/**
 * Creators routes
 * GET /api/creators, GET /api/creators/:id, PUT /api/creators/:id, PUT /api/creators/:id/wacrm
 */
const express = require('express');
const router = express.Router();
const db = require('../../db');
const { getCreatorFull } = require('../../db');
const { getLockedOwner, matchesOwnerScope, resolveScopedOwner, sendOwnerScopeForbidden } = require('../middleware/appAuth');
const { writeAudit } = require('../middleware/audit');
const { normalizeOperatorName } = require('../utils/operator');
const { buildLifecycle, STAGE_META } = require('../services/lifecycleService');
const { fetchCreatorMessageFactsMap } = require('../services/creatorMessageFactsService');
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
const {
    getLifecycleRuntimeOptions,
    evaluateCreatorLifecycle,
    getLifecycleSnapshotRecord,
    persistLifecycleForCreator,
    listLifecycleTransitions,
} = require('../services/lifecyclePersistenceService');

function normalizeManualPhone(value) {
    return String(value || '').replace(/\D/g, '').trim();
}

function parseRequestedCreatorFields(value) {
    return new Set(
        String(value || '')
            .split(',')
            .map((item) => item.trim().toLowerCase())
            .filter(Boolean)
    );
}

const CREATOR_UPDATE_AUDIT_FIELDS = ['primary_name', 'wa_phone', 'wa_owner', 'keeper_username'];
const CREATOR_WACRM_AUDIT_FIELDS = [
    'beta_status', 'priority', 'agency_bound', 'video_count', 'video_target',
    'monthly_fee_status', 'monthly_fee_amount', 'next_action',
    'ev_trial_active', 'ev_monthly_started',
    'ev_gmv_1k', 'ev_gmv_2k', 'ev_gmv_5k', 'ev_gmv_10k',
    'ev_agency_bound', 'ev_churned',
    'keeper_gmv', 'keeper_gmv30', 'keeper_orders',
    'keeper_videos', 'keeper_videos_posted', 'keeper_videos_sold',
    'keeper_card_rate', 'keeper_order_rate',
    'keeper_reg_time', 'keeper_activate_time',
];

function pickDefinedAuditFields(payload, allowedFields) {
    const source = payload && typeof payload === 'object' ? payload : {};
    return allowedFields.reduce((result, field) => {
        if (Object.prototype.hasOwnProperty.call(source, field) && source[field] !== undefined) {
            result[field] = source[field];
        }
        return result;
    }, {});
}

function shouldExposeCreatorListPhone(req, requestedFields) {
    const role = String(req?.auth?.role || '').trim().toLowerCase();
    const privileged = role === 'admin' || role === 'service';
    return privileged && requestedFields.has('wa_phone');
}

function buildCreatorUpdateAuditPayload(payload) {
    const auditPayload = pickDefinedAuditFields(payload, CREATOR_UPDATE_AUDIT_FIELDS);
    if (auditPayload.wa_owner !== undefined) {
        auditPayload.wa_owner = normalizeOperatorName(auditPayload.wa_owner, auditPayload.wa_owner);
    }
    return auditPayload;
}

function buildCreatorWacrmAuditPayload(payload, {
    updatedFields = [],
    beforeLifecycle = null,
    afterLifecycle = null,
    lifecycleChanged = false,
    replyStrategy = null,
} = {}) {
    return {
        changes: pickDefinedAuditFields(payload, CREATOR_WACRM_AUDIT_FIELDS),
        updated: Array.isArray(updatedFields) ? updatedFields : [],
        lifecycle_before: beforeLifecycle?.stage_key || null,
        lifecycle_after: afterLifecycle?.stage_key || null,
        lifecycle_changed: !!lifecycleChanged,
        reply_strategy: replyStrategy || null,
    };
}

async function ensureCreatorAccess(req, res, creatorId, fields = 'id, primary_name, wa_phone, wa_owner') {
    const dbConn = db.getDb();
    const row = await dbConn.prepare(
        `SELECT ${fields} FROM creators WHERE id = ? LIMIT 1`
    ).get(creatorId);
    if (!row) {
        res.status(404).json({ ok: false, error: 'Creator not found' });
        return null;
    }
    const lockedOwner = getLockedOwner(req);
    if (lockedOwner && !matchesOwnerScope(req, row.wa_owner)) {
        sendOwnerScopeForbidden(res, lockedOwner);
        return null;
    }
    return row;
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

function parseJsonSafe(value, fallback = null) {
    if (value === null || value === undefined) return fallback;
    if (typeof value === 'object') return value;
    try {
        return JSON.parse(value);
    } catch (_) {
        return fallback;
    }
}

function getLifecycleStageLabel(stageKey) {
    const key = String(stageKey || '').trim().toLowerCase();
    if (!key) return null;
    return STAGE_META[key]?.stage_label || key;
}

async function getLifecycleEventsMap(dbConn, creatorIds, options = {}) {
    const normalizedIds = normalizeCreatorIds(creatorIds);
    if (normalizedIds.length === 0) return new Map();

    const includeMeta = options.includeMeta !== false;
    const placeholders = normalizedIds.map(() => '?').join(', ');
    const selectFields = includeMeta
        ? 'id, creator_id, event_key, event_type, owner, status, trigger_source, trigger_text, start_at, end_at, created_at, updated_at, meta'
        : 'id, creator_id, event_key, event_type, owner, status, trigger_source, trigger_text, start_at, end_at, created_at, updated_at';
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
        message_facts: source.message_facts || source.messageFacts || null,
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
            COUNT(wm.id) AS msg_count,
            MAX(CASE WHEN wm.role = 'user' THEN wm.timestamp END) AS last_user_ts,
            MIN(CASE WHEN wm.role = 'user' THEN wm.timestamp END) AS first_user_ts,
            SUM(CASE WHEN wm.role = 'user' THEN 1 ELSE 0 END) AS user_message_count,
            SUM(CASE WHEN wm.role = 'user' AND wm.text IS NOT NULL AND TRIM(wm.text) <> '' THEN 1 ELSE 0 END) AS nonblank_user_message_count,
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
        LEFT JOIN wa_messages wm ON wm.creator_id = c.id
        LEFT JOIN keeper_link k ON k.creator_id = c.id
        LEFT JOIN wa_crm_data wc ON wc.creator_id = c.id
        LEFT JOIN joinbrands_link j ON j.creator_id = c.id
        WHERE c.id IN (${placeholders})
        GROUP BY c.id
    `).all(...normalizedIds);
}

async function fetchCreatorMessageAggregate(dbConn, creatorId) {
    return await dbConn.prepare(`
        SELECT
            COUNT(id) AS msg_count,
            MAX(CASE WHEN role = 'user' THEN timestamp END) AS last_user_ts,
            MIN(CASE WHEN role = 'user' THEN timestamp END) AS first_user_ts,
            SUM(CASE WHEN role = 'user' THEN 1 ELSE 0 END) AS user_message_count,
            SUM(CASE WHEN role = 'user' AND text IS NOT NULL AND TRIM(text) <> '' THEN 1 ELSE 0 END) AS nonblank_user_message_count
        FROM wa_messages
        WHERE creator_id = ?
    `).get(creatorId);
}

async function buildCurrentLifecycleForCreator(dbConn, creatorId) {
    const evaluated = await evaluateCreatorLifecycle(dbConn, creatorId);
    return evaluated?.lifecycle || null;
}

async function listLifecycleHistoryForCreator(dbConn, creatorId, limit = 30) {
    const transitionRows = await listLifecycleTransitions(dbConn, creatorId, limit);
    if (transitionRows.length > 0) {
        const currentLifecycle = await buildCurrentLifecycleForCreator(dbConn, creatorId);
        return {
            source: 'transition_table',
            current_stage: currentLifecycle?.stage_key || null,
            current_label: currentLifecycle?.stage_label || getLifecycleStageLabel(currentLifecycle?.stage_key || null),
            transitions: transitionRows
                .slice()
                .reverse()
                .map((row) => ({
                    id: row.id,
                    at: row.created_at,
                    action: 'transition',
                    trigger: row.trigger_type || null,
                    trigger_source: row.trigger_source || null,
                    reason: row.reason || null,
                    from_stage: row.from_stage || null,
                    from_label: getLifecycleStageLabel(row.from_stage),
                    to_stage: row.to_stage || null,
                    to_label: getLifecycleStageLabel(row.to_stage),
                })),
        };
    }

    const safeLimit = Math.max(1, Math.min(Number(limit) || 30, 120));
    const creatorIdText = String(creatorId);
    const rawRows = await dbConn.prepare(`
        SELECT id, action, table_name, record_id, before_value, after_value, created_at
        FROM audit_log
        WHERE (
            (action = 'lifecycle_stage_transition' AND table_name = 'creators' AND record_id = ?)
            OR
            (action = 'creator_profile_update' AND table_name = 'multi' AND record_id = ?)
        )
        ORDER BY created_at ASC, id ASC
    `).all(creatorIdText, creatorIdText);

    const points = [];
    for (const row of rawRows) {
        const beforeValue = parseJsonSafe(row.before_value, {});
        const afterValue = parseJsonSafe(row.after_value, {});
        const fromStage = String(
            afterValue?.lifecycle_before
            || beforeValue?.lifecycle_before
            || beforeValue?.stage
            || ''
        ).trim().toLowerCase() || null;
        const toStage = String(
            afterValue?.lifecycle_after
            || afterValue?.stage
            || ''
        ).trim().toLowerCase() || null;
        const changed = afterValue?.lifecycle_changed === undefined
            ? (fromStage && toStage ? fromStage !== toStage : true)
            : !!afterValue.lifecycle_changed;
        if (!changed && fromStage && toStage && fromStage === toStage) continue;
        if (!fromStage && !toStage) continue;

        points.push({
            id: row.id,
            at: row.created_at,
            action: row.action,
            trigger: afterValue?.trigger || null,
            from_stage: fromStage,
            from_label: getLifecycleStageLabel(fromStage),
            to_stage: toStage,
            to_label: getLifecycleStageLabel(toStage),
        });
    }

    const compact = [];
    for (const point of points) {
        const prev = compact[compact.length - 1];
        if (prev && prev.to_stage && point.to_stage && prev.to_stage === point.to_stage) {
            continue;
        }
        compact.push(point);
    }

    const currentLifecycle = await buildCurrentLifecycleForCreator(dbConn, creatorId);
    if (currentLifecycle?.stage_key) {
        const last = compact[compact.length - 1];
        if (!last || last.to_stage !== currentLifecycle.stage_key) {
            compact.push({
                id: `current_${creatorId}`,
                at: new Date().toISOString(),
                action: 'current_snapshot',
                trigger: 'current',
                from_stage: last?.to_stage || null,
                from_label: getLifecycleStageLabel(last?.to_stage || null),
                to_stage: currentLifecycle.stage_key,
                to_label: currentLifecycle.stage_label || getLifecycleStageLabel(currentLifecycle.stage_key),
            });
        }
    }

    return {
        source: 'audit_log',
        current_stage: currentLifecycle?.stage_key || null,
        current_label: currentLifecycle?.stage_label || getLifecycleStageLabel(currentLifecycle?.stage_key || null),
        transitions: compact.slice(-safeLimit),
    };
}

// GET /api/creators — 获取所有达人
router.get('/', async (req, res) => {
    const __perfEnabled = process.env.CREATORS_PERF_LOG === '1';
    const __perfMark = (label) => {
        if (!__perfEnabled) return null;
        return { label, start: process.hrtime.bigint() };
    };
    const __perfEnd = (mark) => {
        if (!mark) return;
        const elapsedMs = Number(process.hrtime.bigint() - mark.start) / 1e6;
        console.log(`[creators:perf] ${mark.label}=${elapsedMs.toFixed(1)}ms`);
    };
    const __perfTotal = __perfMark('total');
    const useNewSql = process.env.CREATORS_QUERY_V2 !== '0';
    try {
        const { owner, search, is_active, include_inactive, beta_status, priority, agency, event, lifecycle_stage, referral_active, has_conflict, monthly_fee_status } = req.query;
        const lockedOwner = getLockedOwner(req);
        const requestedOwner = normalizeOperatorName(owner, owner || null);
        const requestedFields = parseRequestedCreatorFields(req.query.fields);
        const includeWaPhone = shouldExposeCreatorListPhone(req, requestedFields);
        if (lockedOwner && requestedOwner && !matchesOwnerScope(req, requestedOwner)) {
            return sendOwnerScopeForbidden(res, lockedOwner);
        }
        const effectiveOwner = resolveScopedOwner(req, requestedOwner, null);
        const rosterOnly = req.query.roster === 'all' ? false : await hasRosterAssignments();
        const dbConn = db.getDb();
        const runtimeOptionsPromise = getLifecycleRuntimeOptions(dbConn);

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
                MAX(CASE WHEN wm.role = 'user' THEN wm.timestamp END) AS last_user_ts,
                MAX(CASE WHEN wm.role = 'me' THEN wm.timestamp END) AS last_me_ts,
                MIN(CASE WHEN wm.role = 'user' THEN wm.timestamp END) AS first_user_ts,
                SUM(CASE WHEN wm.role = 'user' THEN 1 ELSE 0 END) AS user_message_count,
                SUM(CASE WHEN wm.role = 'user' AND wm.text IS NOT NULL AND TRIM(wm.text) <> '' THEN 1 ELSE 0 END) AS nonblank_user_message_count,
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
                ${useNewSql
        ? `CASE
                    WHEN MAX(CASE WHEN wm.role = 'user' THEN wm.timestamp END) IS NULL THEN 1
                    WHEN MAX(CASE WHEN wm.role = 'me' THEN wm.timestamp END) >= MAX(CASE WHEN wm.role = 'user' THEN wm.timestamp END) THEN 1
                    ELSE 0
                END`
        : `(
                    SELECT
                        CASE
                            WHEN MAX(CASE WHEN role = 'user' THEN timestamp END) IS NULL THEN 1
                            WHEN MAX(CASE WHEN role = 'me' THEN timestamp END) >= MAX(CASE WHEN role = 'user' THEN timestamp END) THEN 1
                            ELSE 0
                        END
                    FROM wa_messages
                    WHERE creator_id = c.id
                )`} AS ev_replied,
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

        if (effectiveOwner) {
            if (rosterOnly) {
                sql += ' AND ocr.operator = ?';
            } else {
                sql += ' AND c.wa_owner = ?';
            }
            params.push(effectiveOwner);
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
        if (monthly_fee_status) {
            sql += ' AND wc.monthly_fee_status = ?';
            params.push(monthly_fee_status);
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
                if (!useNewSql) {
                    sql += `
                        AND EXISTS (
                            SELECT 1
                            FROM wa_messages wm_reply
                            WHERE wm_reply.creator_id = c.id
                              AND wm_reply.role = 'me'
                              AND wm_reply.timestamp >= (
                                SELECT MAX(wm_user.timestamp)
                                FROM wa_messages wm_user
                                WHERE wm_user.creator_id = c.id
                                  AND wm_user.role = 'user'
                              )
                        )
                    `;
                }
            } else if (VALID_EVENTS.includes(event)) {
                sql += ` AND j.ev_${event} = 1`;
            }
        }

        sql += rosterOnly
            ? ' GROUP BY c.id, ocr.operator, ocr.session_id'
            : ' GROUP BY c.id';
        if (useNewSql && event === 'replied') {
            sql += ' HAVING last_user_ts IS NOT NULL AND last_me_ts IS NOT NULL AND last_me_ts >= last_user_ts';
        }
        sql += ' ORDER BY last_active DESC, msg_count DESC, c.id DESC';

        const __perfSql = __perfMark('sql');
        const creators = await dbConn.prepare(sql).all(...params);
        __perfEnd(__perfSql);
        const creatorIds = creators.map((item) => item.id);
        const __perfFacts = __perfMark('messageFacts');
        const [eventsMap, lifecycleOptions, messageFactsMap] = await Promise.all([
            getLifecycleEventsMap(dbConn, creatorIds, { includeMeta: false }),
            runtimeOptionsPromise,
            fetchCreatorMessageFactsMap(dbConn, creators),
        ]);
        __perfEnd(__perfFacts);

        const __perfPost = __perfMark('postprocess');
        const mapped = creators.map((rawItem) => {
            const {
                last_user_ts,
                last_me_ts,
                first_user_ts,
                user_message_count,
                nonblank_user_message_count,
                ...item
            } = rawItem;
            const normalized = {
                ...item,
                wa_phone: includeWaPhone ? item.wa_phone : undefined,
                wa_owner: normalizeOperatorName(item.roster_operator, item.roster_operator) || item.wa_owner,
                session_id: item.session_id || getSessionIdForOperator(item.roster_operator || item.wa_owner),
                message_facts: messageFactsMap.get(Number(item.id)) || null,
            };
            return attachLifecycle(normalized, eventsMap.get(Number(item.id)) || [], lifecycleOptions, {
                includeEventLists: false,
            });
        }).filter((item) => {
            if (lifecycle_stage && item.lifecycle?.stage_key !== lifecycle_stage) return false;
            if (referral_active === '1' && !item.lifecycle?.flags?.referral_active) return false;
            if (referral_active === '0' && item.lifecycle?.flags?.referral_active) return false;
            if (has_conflict === '1' && !(item.lifecycle?.has_conflicts)) return false;
            if (has_conflict === '0' && item.lifecycle?.has_conflicts) return false;
            return true;
        });
        __perfEnd(__perfPost);

        res.json(mapped);
        __perfEnd(__perfTotal);
    } catch (err) {
        console.error('Error fetching creators:', err);
        res.status(500).json({ error: err.message });
    }
});

router._private = {
    parseRequestedCreatorFields,
    shouldExposeCreatorListPhone,
    buildCreatorUpdateAuditPayload,
    buildCreatorWacrmAuditPayload,
};

// GET /api/creators/manual-check — 手动录入前去重检查（同号/重名）
router.get('/manual-check', async (req, res) => {
    try {
        const dbConn = db.getDb();
        const rawName = String(req.query.name || '').trim();
        const rawPhone = String(req.query.phone || '').trim();
        const normalizedPhone = normalizeManualPhone(rawPhone);
        const normalizedName = rawName.replace(/\s+/g, ' ').trim();
        const lockedOwner = getLockedOwner(req);
        const requestedOwner = normalizeOperatorName(req.query.owner, req.query.owner || null);
        if (lockedOwner && requestedOwner && !matchesOwnerScope(req, requestedOwner)) {
            return sendOwnerScopeForbidden(res, lockedOwner);
        }
        const operator = resolveScopedOwner(req, requestedOwner, 'Yiyun');

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
        const lockedOwner = getLockedOwner(req);
        const requestedOwner = normalizeOperatorName(req.body?.wa_owner || req.body?.owner, null);
        if (lockedOwner && requestedOwner && !matchesOwnerScope(req, requestedOwner)) {
            return sendOwnerScopeForbidden(res, lockedOwner);
        }
        const operator = resolveScopedOwner(req, requestedOwner, 'Yiyun');
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
        if (lockedOwner && samePhoneRows.some((row) => !matchesOwnerScope(req, row.wa_owner))) {
            return res.status(403).json({
                ok: false,
                error: 'phone already belongs to another owner',
            });
        }
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
        const lockedOwner = getLockedOwner(req);

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
        if (lockedOwner) {
            const blockedRows = rows.filter((row) => !matchesOwnerScope(req, row.wa_owner));
            if (blockedRows.length > 0) {
                return res.status(403).json({
                    ok: false,
                    error: `creator_ids include other owners (locked to ${lockedOwner})`,
                    blocked_creator_ids: blockedRows.map((row) => row.id),
                });
            }
        }
        const messageFactsMap = await fetchCreatorMessageFactsMap(dbConn, rows);
        const rowMap = new Map(rows.map((row) => [Number(row.id), row]));
        const results = [];

        await dbConn.transaction(async (txDb) => {
            for (const creatorId of creatorIds) {
                const row = rowMap.get(creatorId);
                if (!row) continue;
                const lifecycle = buildLifecycle(buildLifecycleInput({
                    ...row,
                    message_facts: messageFactsMap.get(creatorId) || null,
                }, eventsMap.get(creatorId) || []), lifecycleOptions);
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
        const lockedOwner = getLockedOwner(req);
        if (lockedOwner && !matchesOwnerScope(req, creator.wa_owner)) {
            return sendOwnerScopeForbidden(res, lockedOwner);
        }
        const [assignment, eventsMap, lifecycleOptions, messageAggregate] = await Promise.all([
            getAssignmentByCreatorId(creator.id),
            getLifecycleEventsMap(dbConn, [creator.id]),
            getLifecycleRuntimeOptions(dbConn),
            fetchCreatorMessageAggregate(dbConn, creator.id),
        ]);
        const messageFactsMap = await fetchCreatorMessageFactsMap(dbConn, [{
            ...creator,
            ...messageAggregate,
        }]);
        const withAssignment = applyAssignmentToCreator(creator, assignment);
        const detail = attachLifecycle({
            ...withAssignment,
            message_facts: messageFactsMap.get(Number(creator.id)) || null,
        }, eventsMap.get(creator.id) || [], lifecycleOptions);
        const lifecycleSnapshot = await getLifecycleSnapshotRecord(dbConn, creator.id);
        res.json({
            ...detail,
            lifecycle_snapshot: lifecycleSnapshot,
            lifecycle_conflicts: detail.lifecycle?.conflicts || [],
        });
    } catch (err) {
        console.error('Error fetching creator:', err);
        res.status(500).json({ error: err.message });
    }
});

// GET /api/creators/:id/lifecycle — 当前生命周期快照
router.get('/:id/lifecycle', async (req, res) => {
    try {
        const creatorId = parseInt(req.params.id, 10);
        if (!Number.isFinite(creatorId) || creatorId <= 0) {
            return res.status(400).json({ ok: false, error: 'invalid creator id' });
        }
        const dbConn = db.getDb();
        const creator = await ensureCreatorAccess(req, res, creatorId, 'id, primary_name, wa_owner');
        if (!creator) return;

        const snapshot = await getLifecycleSnapshotRecord(dbConn, creatorId);
        const current = snapshot || (await buildCurrentLifecycleForCreator(dbConn, creatorId));
        res.json({
            ok: true,
            creator_id: creatorId,
            creator_name: creator.primary_name || null,
            wa_owner: creator.wa_owner || null,
            ...(snapshot || current || {}),
        });
    } catch (err) {
        console.error('GET /api/creators/:id/lifecycle error:', err);
        res.status(500).json({ ok: false, error: err.message });
    }
});

// GET /api/creators/:id/lifecycle-history — 生命周期迁移轨迹
router.get('/:id/lifecycle-history', async (req, res) => {
    try {
        const creatorId = parseInt(req.params.id, 10);
        if (!Number.isFinite(creatorId) || creatorId <= 0) {
            return res.status(400).json({ ok: false, error: 'invalid creator id' });
        }
        const dbConn = db.getDb();
        const creator = await ensureCreatorAccess(req, res, creatorId, 'id, primary_name, wa_phone, wa_owner');
        if (!creator) return;

        const history = await listLifecycleHistoryForCreator(dbConn, creatorId, req.query.limit || 30);
        res.json({
            ok: true,
            creator_id: creatorId,
            creator_name: creator.primary_name || null,
            wa_owner: creator.wa_owner || null,
            source: history.source || 'audit_log',
            current_stage: history.current_stage,
            current_label: history.current_label,
            transitions: history.transitions,
            count: history.transitions.length,
        });
    } catch (err) {
        console.error('GET /api/creators/:id/lifecycle-history error:', err);
        res.status(500).json({ ok: false, error: err.message });
    }
});

// PUT /api/creators/:id — 更新达人基本信息
router.put('/:id', async (req, res) => {
    try {
        const db2 = db.getDb();
        const { primary_name, wa_phone, wa_owner, keeper_username } = req.body;
        const id = parseInt(req.params.id);
        const lockedOwner = getLockedOwner(req);
        const creator = await ensureCreatorAccess(req, res, id, 'id, wa_owner');
        if (!creator) return;
        if (lockedOwner && wa_owner !== undefined && !matchesOwnerScope(req, wa_owner)) {
            return sendOwnerScopeForbidden(res, lockedOwner);
        }

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

        await writeAudit('creator_update', 'creators', id, null, buildCreatorUpdateAuditPayload(req.body), req);
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
        const creator = await ensureCreatorAccess(req, res, creatorId, 'id, wa_owner');
        if (!creator) return;
        const beforeLifecycle = await evaluateCreatorLifecycle(db.getDb(), creatorId)
            .then((ret) => ret?.lifecycle || null)
            .catch(() => null);
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

        const persistedLifecycle = await persistLifecycleForCreator(db.getDb(), creatorId, {
            triggerType: 'wacrm_update',
            triggerId: creatorId,
            triggerSource: 'creators',
        }).catch(() => null);
        const afterLifecycle = persistedLifecycle?.lifecycle || await getLifecycleSnapshotByCreatorId(creatorId).catch(() => null);
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
            await writeAudit('lifecycle_stage_transition', 'creators', creatorId, {
                stage: beforeLifecycle?.stage_key || null,
            }, {
                stage: afterLifecycle?.stage_key || null,
                lifecycle_before: beforeLifecycle?.stage_key || null,
                lifecycle_after: afterLifecycle?.stage_key || null,
                lifecycle_changed: true,
                trigger: 'wacrm_update',
            }, req);
        }

        await writeAudit('creator_profile_update', 'multi', creatorId, null, buildCreatorWacrmAuditPayload(req.body, {
            updatedFields,
            beforeLifecycle,
            afterLifecycle,
            lifecycleChanged,
            replyStrategy: strategyRebuild,
        }), req);
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
