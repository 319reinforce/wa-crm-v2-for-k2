const db = require('../../db');
const creatorCache = require('./creatorCache');
const { buildLifecycle } = require('./lifecycleService');
const {
    DEFAULT_POLICY_KEY: LIFECYCLE_POLICY_KEY,
    buildDefaultPayload: buildDefaultLifecyclePayload,
    extractPayloadFromRow: extractLifecyclePayloadFromRow,
    toRuntimeOptions,
} = require('./lifecycleConfigService');
const {
    DEFAULT_POLICY_KEY: STRATEGY_POLICY_KEY,
    buildDefaultPayload: buildDefaultStrategyPayload,
    extractPayloadFromRow: extractStrategyPayloadFromRow,
} = require('./strategyConfigService');

const AUTO_STRATEGY_VERSION = 'auto_reply_strategy_v2';
const LIFECYCLE_STAGE_KEYS = ['acquisition', 'activation', 'retention', 'revenue', 'terminated'];

function parseJsonSafe(value, fallback) {
    if (value === null || value === undefined) return fallback;
    if (typeof value === 'object') return value;
    try {
        return JSON.parse(value);
    } catch (_) {
        return fallback;
    }
}

function toNumber(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

function toText(value) {
    return String(value || '').trim();
}

function normalizeOwnerLabel(value) {
    const text = toText(value);
    if (!text) return '';
    const lower = text.toLowerCase();
    if (lower === 'beau') return 'Beau';
    if (lower === 'yiyun') return 'Yiyun';
    if (lower === 'jiawen') return 'Jiawen';
    return text;
}

function normalizeConfidence(value) {
    const n = Math.max(1, Math.min(3, toNumber(value, 1)));
    return Number.isFinite(n) ? n : 1;
}

function normalizeEvidence(value) {
    const text = toText(value).replace(/\s+/g, ' ');
    return text.slice(0, 140);
}

function normalizeProfileLevel(raw, allowed = []) {
    const text = toText(raw).toLowerCase();
    return allowed.includes(text) ? text : null;
}

function classifyStrategyRole(strategy = {}) {
    const haystack = [
        strategy.id,
        strategy.name,
        strategy.name_en,
        strategy.memory_key,
        ...(Array.isArray(strategy.aliases) ? strategy.aliases : []),
    ].join(' ').toLowerCase();

    if (/recall|召回|回收|reengage|re-?engage/.test(haystack)) return 'recall_pending';
    if (/secondary|二次|触达|follow[_\s-]?up|followup/.test(haystack)) return 'secondary_reach';
    return 'generic';
}

function pickByRole(strategies = [], role, fallback = null) {
    const list = Array.isArray(strategies) ? strategies : [];
    const matched = list.find((item) => classifyStrategyRole(item) === role);
    if (matched) return matched;
    if (list.length === 0) return fallback;
    const sorted = [...list].sort((a, b) => toNumber(a.priority) - toNumber(b.priority));
    if (role === 'recall_pending') return sorted[sorted.length - 1] || fallback;
    return sorted[0] || fallback;
}

function toLifecycleInput(source = {}, events = []) {
    return {
        ...source,
        wacrm: {
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
        joinbrands: {
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
        keeper: {
            keeper_gmv: source.keeper_gmv,
            keeper_gmv30: source.keeper_gmv30,
            keeper_orders: source.keeper_orders,
        },
        events,
    };
}

async function getLifecycleRuntimeOptions(dbConn) {
    const fallback = buildDefaultLifecyclePayload();
    try {
        const row = await dbConn.prepare(
            'SELECT policy_key, policy_version, policy_content, applicable_scenarios, is_active, updated_at FROM policy_documents WHERE policy_key = ? LIMIT 1'
        ).get(LIFECYCLE_POLICY_KEY);
        const payload = extractLifecyclePayloadFromRow(row);
        const config = payload?.is_active === 0 ? fallback.config : (payload?.config || fallback.config);
        return toRuntimeOptions(config);
    } catch (_) {
        return toRuntimeOptions(fallback.config);
    }
}

async function getStrategyRuntime(dbConn) {
    const fallback = buildDefaultStrategyPayload();
    const row = await dbConn.prepare(
        'SELECT policy_key, policy_version, policy_content, applicable_scenarios, is_active, updated_at FROM policy_documents WHERE policy_key = ? LIMIT 1'
    ).get(STRATEGY_POLICY_KEY);
    const payload = extractStrategyPayloadFromRow(row);
    const enabled = row ? !!row.is_active : true;
    const strategies = Array.isArray(payload?.strategies) && payload.strategies.length > 0
        ? payload.strategies
        : fallback.strategies;
    return { enabled, strategies };
}

async function fetchCreatorCore(dbConn, creatorId) {
    return await dbConn.prepare(`
        SELECT
            c.id,
            c.primary_name,
            c.wa_phone,
            c.wa_owner,
            c.is_active,
            wc.priority,
            wc.beta_status,
            wc.beta_program_type,
            wc.monthly_fee_status,
            wc.monthly_fee_deducted,
            wc.agency_bound,
            wc.next_action,
            wc.video_count,
            wc.video_target,
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
            k.keeper_gmv,
            k.keeper_gmv30,
            k.keeper_orders
        FROM creators c
        LEFT JOIN wa_crm_data wc ON wc.creator_id = c.id
        LEFT JOIN joinbrands_link j ON j.creator_id = c.id
        LEFT JOIN keeper_link k ON k.creator_id = c.id
        WHERE c.id = ?
        LIMIT 1
    `).get(creatorId);
}

async function fetchLifecycleEvents(dbConn, creatorId) {
    const rows = await dbConn.prepare(`
        SELECT id, creator_id, event_key, event_type, status, trigger_source, start_at, end_at, meta
        FROM events
        WHERE creator_id = ?
          AND status IN ('active', 'completed')
        ORDER BY created_at DESC, id DESC
    `).all(creatorId);
    return rows.map((row) => ({
        ...row,
        meta: parseJsonSafe(row.meta, null),
    }));
}

async function getLifecycleSnapshotByCreatorId(creatorId) {
    const dbConn = db.getDb();
    const creator = await fetchCreatorCore(dbConn, creatorId);
    if (!creator || !creator.wa_phone) return null;

    const [events, lifecycleOptions] = await Promise.all([
        fetchLifecycleEvents(dbConn, creatorId),
        getLifecycleRuntimeOptions(dbConn),
    ]);
    const lifecycle = buildLifecycle(toLifecycleInput(creator, events), lifecycleOptions);
    return {
        creator_id: Number(creator.id),
        client_id: creator.wa_phone,
        stage_key: lifecycle.stage_key,
        stage_label: lifecycle.stage_label,
        lifecycle,
        creator,
    };
}

async function getLatestProfileSnapshot(dbConn, clientId) {
    try {
        return await dbConn.prepare(
            'SELECT * FROM client_profile_snapshots WHERE client_id = ? ORDER BY id DESC LIMIT 1'
        ).get(clientId);
    } catch (_) {
        return null;
    }
}

function mapProfileSnapshot(row) {
    if (!row) return null;
    return {
        frequency: {
            value: normalizeProfileLevel(row.frequency_level, ['high', 'medium', 'low']),
            confidence: normalizeConfidence(row.frequency_conf),
            evidence: normalizeEvidence(row.frequency_evidence),
        },
        difficulty: {
            value: normalizeProfileLevel(row.difficulty_level, ['high', 'medium', 'low']),
            confidence: normalizeConfidence(row.difficulty_conf),
            evidence: normalizeEvidence(row.difficulty_evidence),
        },
        intent: {
            value: normalizeProfileLevel(row.intent_level, ['strong', 'medium', 'weak']),
            confidence: normalizeConfidence(row.intent_conf),
            evidence: normalizeEvidence(row.intent_evidence),
        },
        emotion: {
            value: normalizeProfileLevel(row.emotion_level, ['positive', 'neutral', 'negative']),
            confidence: normalizeConfidence(row.emotion_conf),
            evidence: normalizeEvidence(row.emotion_evidence),
        },
        motivation_positive: {
            value: parseJsonSafe(row.motivation_positive, []),
            confidence: normalizeConfidence(row.motivation_conf),
            evidence: normalizeEvidence(row.motivation_evidence),
        },
        pain_points: {
            value: parseJsonSafe(row.pain_points, []),
            confidence: normalizeConfidence(row.pain_conf),
            evidence: normalizeEvidence(row.pain_evidence),
        },
        summary: toText(row.summary),
    };
}

function parseAutoStrategyMeta(memoryValue) {
    const text = String(memoryValue || '');
    const lines = text.split('\n').map((line) => line.trim()).filter(Boolean);
    const meta = {
        is_auto: false,
        version: null,
        trigger: null,
        lifecycle: null,
        profile_signals: [],
        focus: null,
    };
    for (const line of lines) {
        const versionMatch = line.match(/^\[AUTO_REPLY_STRATEGY:(.+)\]$/i);
        if (versionMatch) {
            meta.is_auto = true;
            meta.version = toText(versionMatch[1]) || null;
            continue;
        }
        if (line.toLowerCase().startsWith('trigger:')) {
            meta.trigger = toText(line.slice('trigger:'.length)) || null;
            continue;
        }
        if (line.toLowerCase().startsWith('lifecycle:')) {
            meta.lifecycle = toText(line.slice('lifecycle:'.length)) || null;
            continue;
        }
        if (/^(frequency|difficulty|intent|emotion):/i.test(line)) {
            meta.profile_signals.push(line);
            continue;
        }
        if (line.toLowerCase().startsWith('focus:')) {
            meta.focus = toText(line.slice('focus:'.length)) || null;
            continue;
        }
    }
    return meta;
}

function scoreByLifecycleAndProfile({ lifecycle, profile }) {
    let secondary = 0;
    let recall = 0;
    const reasons = [];

    const stage = lifecycle?.stage_key || '';
    if (stage === 'revenue') {
        recall += 3;
        reasons.push('生命周期=Revenue，优先待召回推进落地。');
    } else if (stage === 'retention') {
        recall += 2;
        reasons.push('生命周期=Retention，优先待召回推进稳定执行。');
    } else if (stage === 'activation') {
        recall += 1;
        secondary += 1;
        reasons.push('生命周期=Activation，兼顾推进与低压触达。');
    } else if (stage === 'terminated') {
        secondary += 4;
        reasons.push('生命周期=Terminated，倾向二次触达/低压维护。');
    } else {
        secondary += 2;
        reasons.push('生命周期偏前期，先走二次触达。');
    }

    if (profile?.intent?.value === 'strong') {
        recall += profile.intent.confidence >= 2 ? 3 : 2;
        reasons.push('画像意愿强，适合待召回推进。');
    } else if (profile?.intent?.value === 'medium') {
        recall += 1;
        secondary += 1;
        reasons.push('画像意愿中等，保持稳态推进。');
    } else if (profile?.intent?.value === 'weak') {
        secondary += profile.intent.confidence >= 2 ? 3 : 2;
        reasons.push('画像意愿弱，先二次触达建立态度。');
    }

    if (profile?.frequency?.value === 'high') {
        recall += 2;
        reasons.push('沟通频次高，可推进待召回动作。');
    } else if (profile?.frequency?.value === 'low') {
        secondary += 2;
        reasons.push('沟通频次低，避免强推。');
    }

    if (profile?.emotion?.value === 'positive') {
        recall += 1;
        reasons.push('情绪正向，可提高推进力度。');
    } else if (profile?.emotion?.value === 'negative') {
        secondary += 2;
        reasons.push('情绪负向，先降压沟通。');
    }

    if (profile?.difficulty?.value === 'high') {
        secondary += 1;
        reasons.push('沟通难度高，先做低门槛动作。');
    } else if (profile?.difficulty?.value === 'low') {
        recall += 1;
        reasons.push('沟通难度低，可直接推进下一步。');
    }

    if (Array.isArray(profile?.pain_points?.value) && profile.pain_points.value.length > 0) {
        secondary += 1;
    }
    if (Array.isArray(profile?.motivation_positive?.value) && profile.motivation_positive.value.length > 0) {
        recall += 1;
    }

    return { secondary, recall, reasons };
}

async function getCurrentConfiguredStrategyMemory(dbConn, clientId, strategies = []) {
    const keys = strategies
        .map((item) => toText(item.memory_key))
        .filter(Boolean);
    if (keys.length === 0) return null;
    const placeholders = keys.map(() => '?').join(', ');
    return await dbConn.prepare(`
        SELECT memory_key, memory_value, confidence, updated_at
        FROM client_memory
        WHERE client_id = ?
          AND memory_type = 'strategy'
          AND memory_key IN (${placeholders})
        ORDER BY updated_at DESC, id DESC
        LIMIT 1
    `).get(clientId, ...keys);
}

function formatProfileSignal(label, field) {
    if (!field || !field.value) return null;
    const conf = normalizeConfidence(field.confidence);
    const evidence = normalizeEvidence(field.evidence);
    return evidence
        ? `${label}: ${field.value} (c${conf}) | ${evidence}`
        : `${label}: ${field.value} (c${conf})`;
}

function buildPersonalizedMemoryValue({ strategy, lifecycle, profile, trigger }) {
    const lines = [];
    lines.push(toText(strategy.memory_value));
    lines.push('');
    lines.push(`[AUTO_REPLY_STRATEGY:${AUTO_STRATEGY_VERSION}]`);
    lines.push(`trigger: ${toText(trigger) || 'manual'}`);
    if (lifecycle?.stage_label) {
        lines.push(`lifecycle: ${lifecycle.stage_label}`);
    }
    const profileLines = [
        formatProfileSignal('frequency', profile?.frequency),
        formatProfileSignal('difficulty', profile?.difficulty),
        formatProfileSignal('intent', profile?.intent),
        formatProfileSignal('emotion', profile?.emotion),
    ].filter(Boolean);
    if (profileLines.length > 0) {
        lines.push(...profileLines);
    } else {
        lines.push('profile: no_snapshot');
    }
    if (Array.isArray(profile?.pain_points?.value) && profile.pain_points.value.length > 0) {
        lines.push(`pain_points: ${profile.pain_points.value.slice(0, 4).join(', ')}`);
    }
    if (Array.isArray(profile?.motivation_positive?.value) && profile.motivation_positive.value.length > 0) {
        lines.push(`motivation_positive: ${profile.motivation_positive.value.slice(0, 4).join(', ')}`);
    }
    if (strategy.prompt_hint) {
        lines.push(`focus: ${strategy.prompt_hint}`);
    }
    return lines.join('\n');
}

async function applyStrategyMemory({ dbConn, clientId, selectedStrategy, strategies, memoryValue, confidence }) {
    const allKeys = strategies
        .map((item) => toText(item.memory_key))
        .filter(Boolean);
    const keysToDelete = allKeys.filter((key) => key !== selectedStrategy.memory_key);
    if (keysToDelete.length > 0) {
        const placeholders = keysToDelete.map(() => '?').join(', ');
        await dbConn.prepare(`
            DELETE FROM client_memory
            WHERE client_id = ?
              AND memory_type = 'strategy'
              AND memory_key IN (${placeholders})
        `).run(clientId, ...keysToDelete);
    }

    await dbConn.prepare(`
        INSERT INTO client_memory (client_id, memory_type, memory_key, memory_value, confidence)
        VALUES (?, 'strategy', ?, ?, ?)
        ON DUPLICATE KEY UPDATE
            memory_value = VALUES(memory_value),
            confidence = VALUES(confidence),
            updated_at = NOW()
    `).run(
        clientId,
        selectedStrategy.memory_key,
        memoryValue,
        normalizeConfidence(confidence)
    );
}

function chooseStrategy({
    strategies,
    lifecycle,
    profile,
    currentMemory,
    trigger = 'manual',
    force = false,
    allowSoftAdjust = false,
}) {
    const secondaryStrategy = pickByRole(strategies, 'secondary_reach', strategies[0] || null);
    const recallStrategy = pickByRole(strategies, 'recall_pending', strategies[strategies.length - 1] || null);
    if (!secondaryStrategy || !recallStrategy) {
        return { strategy: strategies[0] || null, reasons: ['策略配置不足，回退首条。'], scores: { secondary: 0, recall: 0 }, kept_existing: false };
    }
    if (String(lifecycle?.stage_key || '').toLowerCase() === 'acquisition') {
        return {
            strategy: secondaryStrategy,
            reasons: ['生命周期=Acquisition，统一使用二次触达完成首轮破冰与意向确认。'],
            scores: { secondary: 999, recall: 0 },
            kept_existing: false,
            trigger,
        };
    }

    const scores = scoreByLifecycleAndProfile({ lifecycle, profile });
    let selected = scores.recall > scores.secondary ? recallStrategy : secondaryStrategy;
    let keptExisting = false;

    if (!force && allowSoftAdjust && currentMemory?.memory_key && currentMemory.memory_key !== selected.memory_key) {
        const delta = Math.abs(scores.recall - scores.secondary);
        if (delta <= 1) {
            const byCurrentKey = strategies.find((item) => item.memory_key === currentMemory.memory_key);
            if (byCurrentKey) {
                selected = byCurrentKey;
                keptExisting = true;
                scores.reasons.push(`画像触发为软调整，分差 ${delta}，保持原策略以降低抖动。`);
            }
        }
    }

    return {
        strategy: selected,
        reasons: scores.reasons,
        scores: { secondary: scores.secondary, recall: scores.recall },
        kept_existing: keptExisting,
        trigger,
    };
}

function estimateStrategyConfidence({ lifecycle, profile, selectedStrategy, scores }) {
    let confidence = 2;
    if (lifecycle?.stage_key === 'revenue' || lifecycle?.stage_key === 'retention') confidence = 3;
    if (profile?.intent?.value === 'strong' && selectedStrategy?.id && classifyStrategyRole(selectedStrategy) === 'recall_pending') confidence = 3;
    if (Math.abs(toNumber(scores?.recall) - toNumber(scores?.secondary)) >= 3) confidence = 3;
    return Math.max(1, Math.min(3, confidence));
}

function mapCurrentMemoryToStrategy(currentMemory, strategies) {
    if (!currentMemory) return null;
    const matched = (strategies || []).find((item) => item.memory_key === currentMemory.memory_key) || null;
    return {
        id: matched?.id || null,
        name: matched?.name || null,
        memory_key: currentMemory.memory_key || null,
        confidence: normalizeConfidence(currentMemory.confidence),
        updated_at: currentMemory.updated_at || null,
        auto_meta: parseAutoStrategyMeta(currentMemory.memory_value || ''),
    };
}

function buildProfileSignalView(profile) {
    return {
        frequency: profile?.frequency || null,
        difficulty: profile?.difficulty || null,
        intent: profile?.intent || null,
        emotion: profile?.emotion || null,
    };
}

async function inspectReplyStrategyForCreator({
    creatorId,
    trigger = 'insight',
    allowSoftAdjust = true,
} = {}) {
    const safeCreatorId = Number(creatorId);
    if (!Number.isFinite(safeCreatorId) || safeCreatorId <= 0) {
        return { ok: false, reason: 'invalid_creator_id' };
    }

    const dbConn = db.getDb();
    const lifecycleSnapshot = await getLifecycleSnapshotByCreatorId(safeCreatorId);
    if (!lifecycleSnapshot || !lifecycleSnapshot.client_id) {
        return { ok: false, reason: 'creator_not_found' };
    }
    const clientId = lifecycleSnapshot.client_id;
    const strategyRuntime = await getStrategyRuntime(dbConn);
    const [profileRow, currentMemory] = await Promise.all([
        getLatestProfileSnapshot(dbConn, clientId),
        getCurrentConfiguredStrategyMemory(dbConn, clientId, strategyRuntime.strategies || []),
    ]);
    const profile = mapProfileSnapshot(profileRow);

    if (!strategyRuntime.enabled) {
        return {
            ok: true,
            creator_id: safeCreatorId,
            client_id: clientId,
            owner: lifecycleSnapshot?.creator?.wa_owner || null,
            lifecycle_stage: lifecycleSnapshot.stage_key,
            lifecycle_label: lifecycleSnapshot.stage_label,
            strategy_enabled: false,
            missing: !currentMemory,
            current_strategy: mapCurrentMemoryToStrategy(currentMemory, strategyRuntime.strategies || []),
            recommended_strategy: null,
            scores: { secondary: 0, recall: 0 },
            reasons: ['策略配置已关闭。'],
            profile_signals: buildProfileSignalView(profile),
            stage_supported: true,
        };
    }

    const stageSupported = LIFECYCLE_STAGE_KEYS.includes(String(lifecycleSnapshot.stage_key || '').toLowerCase());
    const selected = chooseStrategy({
        strategies: strategyRuntime.strategies,
        lifecycle: lifecycleSnapshot.lifecycle,
        profile,
        currentMemory,
        trigger,
        force: false,
        allowSoftAdjust,
    });
    const currentMapped = mapCurrentMemoryToStrategy(currentMemory, strategyRuntime.strategies || []);
    const recommendedId = selected?.strategy?.id || null;
    const aligned = !!(currentMapped?.id && recommendedId && currentMapped.id === recommendedId);

    return {
        ok: true,
        creator_id: safeCreatorId,
        client_id: clientId,
        owner: lifecycleSnapshot?.creator?.wa_owner || null,
        lifecycle_stage: lifecycleSnapshot.stage_key,
        lifecycle_label: lifecycleSnapshot.stage_label,
        strategy_enabled: true,
        stage_supported: stageSupported,
        missing: !currentMemory,
        aligned,
        current_strategy: currentMapped,
        recommended_strategy: selected?.strategy
            ? {
                id: selected.strategy.id,
                name: selected.strategy.name,
                memory_key: selected.strategy.memory_key,
            }
            : null,
        scores: selected?.scores || { secondary: 0, recall: 0 },
        reasons: Array.isArray(selected?.reasons) ? selected.reasons : [],
        profile_signals: buildProfileSignalView(profile),
    };
}

async function rebuildReplyStrategyForCreator({
    creatorId,
    trigger = 'manual',
    force = false,
    allowSoftAdjust = false,
} = {}) {
    const safeCreatorId = Number(creatorId);
    if (!Number.isFinite(safeCreatorId) || safeCreatorId <= 0) {
        return { ok: false, reason: 'invalid_creator_id' };
    }

    const dbConn = db.getDb();
    const lifecycleSnapshot = await getLifecycleSnapshotByCreatorId(safeCreatorId);
    if (!lifecycleSnapshot || !lifecycleSnapshot.client_id) {
        return { ok: false, reason: 'creator_not_found' };
    }
    const clientId = lifecycleSnapshot.client_id;

    const strategyRuntime = await getStrategyRuntime(dbConn);
    if (!strategyRuntime.enabled) {
        return { ok: true, skipped: true, reason: 'strategy_disabled', creator_id: safeCreatorId, client_id: clientId };
    }
    if (!Array.isArray(strategyRuntime.strategies) || strategyRuntime.strategies.length === 0) {
        return { ok: true, skipped: true, reason: 'empty_strategy_config', creator_id: safeCreatorId, client_id: clientId };
    }

    const [profileRow, currentMemory] = await Promise.all([
        getLatestProfileSnapshot(dbConn, clientId),
        getCurrentConfiguredStrategyMemory(dbConn, clientId, strategyRuntime.strategies),
    ]);
    const profile = mapProfileSnapshot(profileRow);
    const selected = chooseStrategy({
        strategies: strategyRuntime.strategies,
        lifecycle: lifecycleSnapshot.lifecycle,
        profile,
        currentMemory,
        trigger,
        force,
        allowSoftAdjust,
    });
    if (!selected.strategy) {
        return { ok: false, reason: 'strategy_not_selected', creator_id: safeCreatorId, client_id: clientId };
    }

    const memoryValue = buildPersonalizedMemoryValue({
        strategy: selected.strategy,
        lifecycle: lifecycleSnapshot.lifecycle,
        profile,
        trigger,
    });
    const confidence = estimateStrategyConfidence({
        lifecycle: lifecycleSnapshot.lifecycle,
        profile,
        selectedStrategy: selected.strategy,
        scores: selected.scores,
    });

    await applyStrategyMemory({
        dbConn,
        clientId,
        selectedStrategy: selected.strategy,
        strategies: strategyRuntime.strategies,
        memoryValue,
        confidence,
    });

    return {
        ok: true,
        creator_id: safeCreatorId,
        client_id: clientId,
        lifecycle_stage: lifecycleSnapshot.stage_key,
        selected_strategy: {
            id: selected.strategy.id,
            name: selected.strategy.name,
            memory_key: selected.strategy.memory_key,
        },
        kept_existing: selected.kept_existing === true,
        trigger,
        scores: selected.scores,
        reasons: selected.reasons,
    };
}

async function rebuildReplyStrategyForClient({
    clientId,
    trigger = 'profile_change',
    force = false,
    allowSoftAdjust = true,
} = {}) {
    const safeClientId = toText(clientId);
    if (!safeClientId) return { ok: false, reason: 'invalid_client_id' };
    const dbConn = db.getDb();
    const creator = await creatorCache.getCreatorByPhone(dbConn, safeClientId, 'id');
    if (!creator) return { ok: false, reason: 'creator_not_found' };

    return await rebuildReplyStrategyForCreator({
        creatorId: creator.id,
        trigger,
        force,
        allowSoftAdjust,
    });
}

async function rebuildReplyStrategiesForAll({
    owner = '',
    trigger = 'manual_all',
    force = false,
    allowSoftAdjust = false,
    limit = 0,
} = {}) {
    const dbConn = db.getDb();
    const ownerText = toText(owner);
    const limitNum = Math.max(0, Number(limit) || 0);

    let rows = [];
    if (ownerText) {
        rows = await dbConn.prepare(`
            SELECT id, wa_phone, primary_name, wa_owner
            FROM creators
            WHERE wa_phone IS NOT NULL
              AND wa_phone <> ''
              AND LOWER(wa_owner) = LOWER(?)
            ORDER BY id ASC
        `).all(ownerText);
    } else {
        rows = await dbConn.prepare(`
            SELECT id, wa_phone, primary_name, wa_owner
            FROM creators
            WHERE wa_phone IS NOT NULL
              AND wa_phone <> ''
            ORDER BY id ASC
        `).all();
    }

    const targetRows = limitNum > 0 ? rows.slice(0, limitNum) : rows;
    const result = {
        ok: true,
        total: targetRows.length,
        success: 0,
        failed: 0,
        skipped: 0,
        owner: ownerText || null,
        trigger,
        items: [],
    };

    for (const row of targetRows) {
        try {
            const ret = await rebuildReplyStrategyForCreator({
                creatorId: row.id,
                trigger,
                force,
                allowSoftAdjust,
            });
            if (!ret?.ok) {
                result.failed++;
                result.items.push({ creator_id: row.id, client_id: row.wa_phone, ok: false, reason: ret?.reason || 'unknown' });
                continue;
            }
            if (ret.skipped) {
                result.skipped++;
            } else {
                result.success++;
            }
            result.items.push({
                creator_id: row.id,
                client_id: row.wa_phone,
                ok: true,
                skipped: !!ret.skipped,
                lifecycle_stage: ret.lifecycle_stage || null,
                selected_strategy_id: ret.selected_strategy?.id || null,
                kept_existing: ret.kept_existing === true,
            });
        } catch (err) {
            result.failed++;
            result.items.push({
                creator_id: row.id,
                client_id: row.wa_phone,
                ok: false,
                reason: err.message,
            });
        }
    }
    return result;
}

async function rebuildMissingReplyStrategies({
    owner = '',
    stage = '',
    trigger = 'manual_rebuild_missing',
    allowSoftAdjust = false,
    limit = 0,
} = {}) {
    const dbConn = db.getDb();
    const ownerText = toText(owner);
    const stageFilter = toText(stage).toLowerCase();
    const limitNum = Math.max(0, Number(limit) || 0);
    if (stageFilter && !LIFECYCLE_STAGE_KEYS.includes(stageFilter)) {
        return { ok: false, reason: 'invalid_stage_filter' };
    }

    let creatorRows = [];
    if (ownerText) {
        creatorRows = await dbConn.prepare(`
            SELECT id, wa_phone, primary_name, wa_owner
            FROM creators
            WHERE wa_phone IS NOT NULL
              AND wa_phone <> ''
              AND LOWER(wa_owner) = LOWER(?)
            ORDER BY id ASC
        `).all(ownerText);
    } else {
        creatorRows = await dbConn.prepare(`
            SELECT id, wa_phone, primary_name, wa_owner
            FROM creators
            WHERE wa_phone IS NOT NULL
              AND wa_phone <> ''
            ORDER BY id ASC
        `).all();
    }

    const result = {
        ok: true,
        owner: ownerText || null,
        stage: stageFilter || null,
        trigger,
        total_candidates: creatorRows.length,
        scoped_total: 0,
        existing: 0,
        missing: 0,
        rebuilt: 0,
        failed: 0,
        limit: limitNum,
        breakdown: {},
        items: [],
    };

    const pushBreakdown = (ownerName, stageKey, key) => {
        const safeOwner = normalizeOwnerLabel(ownerName) || 'Unknown';
        const safeStage = toText(stageKey) || 'unknown';
        const mapKey = `${safeOwner}|${safeStage}`;
        if (!result.breakdown[mapKey]) {
            result.breakdown[mapKey] = {
                owner: safeOwner,
                stage: safeStage,
                scoped_total: 0,
                existing: 0,
                missing: 0,
                rebuilt: 0,
                failed: 0,
            };
        }
        result.breakdown[mapKey][key] += 1;
        return mapKey;
    };

    for (const row of creatorRows) {
        let insight = null;
        try {
            insight = await inspectReplyStrategyForCreator({
                creatorId: row.id,
                trigger,
                allowSoftAdjust,
            });
        } catch (err) {
            result.failed++;
            result.items.push({
                creator_id: row.id,
                client_id: row.wa_phone,
                ok: false,
                reason: err.message,
            });
            continue;
        }
        if (!insight?.ok) {
            result.failed++;
            result.items.push({
                creator_id: row.id,
                client_id: row.wa_phone,
                ok: false,
                reason: insight?.reason || 'inspect_failed',
            });
            continue;
        }

        if (stageFilter && insight.lifecycle_stage !== stageFilter) {
            continue;
        }

        result.scoped_total++;
        const mapKey = pushBreakdown(insight.owner, insight.lifecycle_stage, 'scoped_total');

        if (!insight.missing) {
            result.existing++;
            result.breakdown[mapKey].existing += 1;
            continue;
        }

        result.missing++;
        result.breakdown[mapKey].missing += 1;

        if (limitNum > 0 && result.rebuilt >= limitNum) {
            result.items.push({
                creator_id: row.id,
                client_id: row.wa_phone,
                ok: true,
                skipped: true,
                reason: 'limit_reached',
                lifecycle_stage: insight.lifecycle_stage,
                owner: insight.owner,
            });
            continue;
        }

        try {
            const rebuildRet = await rebuildReplyStrategyForCreator({
                creatorId: row.id,
                trigger,
                force: false,
                allowSoftAdjust,
            });
            if (!rebuildRet?.ok) {
                result.failed++;
                result.breakdown[mapKey].failed += 1;
                result.items.push({
                    creator_id: row.id,
                    client_id: row.wa_phone,
                    ok: false,
                    reason: rebuildRet?.reason || 'rebuild_failed',
                    lifecycle_stage: insight.lifecycle_stage,
                    owner: insight.owner,
                });
                continue;
            }
            result.rebuilt++;
            result.breakdown[mapKey].rebuilt += 1;
            result.items.push({
                creator_id: row.id,
                client_id: row.wa_phone,
                ok: true,
                lifecycle_stage: rebuildRet.lifecycle_stage || insight.lifecycle_stage,
                owner: insight.owner,
                selected_strategy_id: rebuildRet.selected_strategy?.id || null,
            });
        } catch (err) {
            result.failed++;
            result.breakdown[mapKey].failed += 1;
            result.items.push({
                creator_id: row.id,
                client_id: row.wa_phone,
                ok: false,
                reason: err.message,
                lifecycle_stage: insight.lifecycle_stage,
                owner: insight.owner,
            });
        }
    }

    return result;
}

module.exports = {
    AUTO_STRATEGY_VERSION,
    getLifecycleSnapshotByCreatorId,
    rebuildReplyStrategyForCreator,
    rebuildReplyStrategyForClient,
    rebuildReplyStrategiesForAll,
    rebuildMissingReplyStrategies,
    inspectReplyStrategyForCreator,
    _private: {
        classifyStrategyRole,
        chooseStrategy,
        mapProfileSnapshot,
        parseAutoStrategyMeta,
        scoreByLifecycleAndProfile,
    },
};
