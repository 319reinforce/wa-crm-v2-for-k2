/**
 * SFT Service — 训练语料与反馈数据访问封装
 * 提取自 server/routes/sft.js
 */
const db = require('../../db');
const { sha256 } = require('../utils/crypto');
const { extractAndSaveMemories } = require('./memoryExtractionService');

// ========== 验证规则 ==========

const EMOJI_ONLY_REGEX = /^[🔶✅❌👍👎💬📋✨🎉🙏👏🎊⭐️🎯💡🔔📌📎🎬🗣️👀✅☑️✔️❤️🧡💛💚💙💜🤎🖤🤍]+$/;
const PUNCT_ONLY_REGEX = /^[.,!?。，！?、：:;；\-—_=+*#]+$/;
const SFT_STRUCTURED_METADATA_FIELDS = [
    'retrieval_snapshot_id',
    'generation_log_id',
    'provider',
    'model',
    'scene_source',
    'pipeline_version',
];

let sftMemoryColumnSetPromise = null;

function validateHumanOutput(humanOutput) {
    const trimmed = (humanOutput || '').trim();
    if (trimmed.length < 3) return { valid: false, error: 'human_output too short (< 3 chars)' };
    if (EMOJI_ONLY_REGEX.test(trimmed)) return { valid: false, error: 'human_output is pure emoji, rejected' };
    if (PUNCT_ONLY_REGEX.test(trimmed)) return { valid: false, error: 'human_output is pure punctuation, rejected' };
    return { valid: true };
}

// ========== SFT Memory ==========

function parseJsonSafe(jsonStr, fallback = null) {
    try { return jsonStr ? JSON.parse(jsonStr) : fallback; } catch (_) { return fallback; }
}

function normalizeOptionalString(value, maxLength = 255) {
    const normalized = String(value || '').trim();
    if (!normalized) return null;
    return normalized.slice(0, maxLength);
}

function normalizeOptionalId(value) {
    if (value === null || value === undefined || value === '') return null;
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return null;
    return Math.trunc(parsed);
}

function buildSftGenerationMetadata(primary = {}, fallback = {}) {
    return {
        retrieval_snapshot_id: normalizeOptionalId(
            primary.retrieval_snapshot_id ?? primary.retrievalSnapshotId
            ?? fallback.retrieval_snapshot_id ?? fallback.retrievalSnapshotId
        ),
        generation_log_id: normalizeOptionalId(
            primary.generation_log_id ?? primary.generationLogId
            ?? fallback.generation_log_id ?? fallback.generationLogId
        ),
        provider: normalizeOptionalString(primary.provider ?? fallback.provider, 32),
        model: normalizeOptionalString(primary.model ?? fallback.model, 64),
        scene_source: normalizeOptionalString(
            primary.scene_source ?? primary.sceneSource ?? fallback.scene_source ?? fallback.sceneSource,
            32
        ),
        pipeline_version: normalizeOptionalString(
            primary.pipeline_version ?? primary.pipelineVersion ?? fallback.pipeline_version ?? fallback.pipelineVersion,
            64
        ),
    };
}

function buildSftContextWithGenerationMetadata(context = null, metadata = {}) {
    const next = context && typeof context === 'object' && !Array.isArray(context)
        ? { ...context }
        : {};

    for (const field of SFT_STRUCTURED_METADATA_FIELDS) {
        if (metadata[field] !== null && metadata[field] !== undefined && metadata[field] !== '') {
            next[field] = metadata[field];
        }
    }

    return next;
}

async function getSftMemoryColumnSet(force = false) {
    if (!force && sftMemoryColumnSetPromise) {
        return await sftMemoryColumnSetPromise;
    }

    sftMemoryColumnSetPromise = (async () => {
        try {
            const rows = await db.getDb().prepare(`
                SELECT COLUMN_NAME
                FROM INFORMATION_SCHEMA.COLUMNS
                WHERE TABLE_SCHEMA = DATABASE()
                  AND TABLE_NAME = 'sft_memory'
            `).all();
            return new Set(rows.map((row) => row.COLUMN_NAME));
        } catch (err) {
            console.warn('[sftService] failed to load sft_memory columns:', err.message);
            return new Set();
        }
    })();

    return await sftMemoryColumnSetPromise;
}

function buildSftStructuredMetadataFragments(metadata = {}, availableColumns = new Set()) {
    const columns = [];
    const placeholders = [];
    const values = [];
    const updateAssignments = [];
    const updateValues = [];

    for (const field of SFT_STRUCTURED_METADATA_FIELDS) {
        if (!availableColumns.has(field)) continue;
        columns.push(field);
        placeholders.push('?');
        values.push(metadata[field] ?? null);
        updateAssignments.push(`${field} = COALESCE(?, ${field})`);
        updateValues.push(metadata[field] ?? null);
    }

    return {
        columns,
        placeholders,
        values,
        updateAssignments,
        updateValues,
    };
}

async function listSftMemory({ limit = 50, offset = 0, owner = null } = {}) {
    const db2 = db.getDb();
    const normalizedOwner = normalizeOptionalString(owner, 64);
    const rows = await db2.prepare(`
        SELECT sm.*, c.wa_owner AS owner
        FROM sft_memory sm
        LEFT JOIN creators c
          ON c.wa_phone = JSON_UNQUOTE(JSON_EXTRACT(sm.context_json, '$.client_id'))
        ${normalizedOwner ? 'WHERE c.wa_owner = ?' : ''}
        ORDER BY created_at DESC
        LIMIT ? OFFSET ?
    `).all(...(normalizedOwner ? [normalizedOwner] : []), limit, offset);
    return rows.map(r => ({
        ...r,
        context: parseJsonSafe(r.context_json),
        message_history: parseJsonSafe(r.message_history),
    }));
}

async function listPendingSftMemory({ owner = null, limit = 100 } = {}) {
    const db2 = db.getDb();
    const normalizedOwner = normalizeOptionalString(owner, 64);
    const rows = await db2.prepare(`
        SELECT sm.*, c.wa_owner AS owner
        FROM sft_memory sm
        LEFT JOIN creators c
          ON c.wa_phone = JSON_UNQUOTE(JSON_EXTRACT(sm.context_json, '$.client_id'))
        WHERE status IN ('pending_review', 'needs_review')
        ${normalizedOwner ? 'AND c.wa_owner = ?' : ''}
        ORDER BY created_at DESC
        LIMIT ?
    `).all(...(normalizedOwner ? [normalizedOwner] : []), limit);
    return rows.map(r => ({
        ...r,
        context: parseJsonSafe(r.context_json),
        message_history: parseJsonSafe(r.message_history),
    }));
}

async function createSftMemory({
    model_candidates,
    human_selected,
    human_output,
    diff_analysis,
    context,
    messages = [],
    system_prompt_used = null,
    system_prompt_version = 'v2',
    retrieval_snapshot_id = null,
    generation_log_id = null,
    provider = null,
    model = null,
    scene_source = null,
    pipeline_version = null,
    reviewed_by = 'system',
    owner = null,
}) {
    const validation = validateHumanOutput(human_output);
    if (!validation.valid) {
        const err = new Error(validation.error);
        err.status = 400;
        throw err;
    }

    const db2 = db.getDb();
    const generationMetadata = buildSftGenerationMetadata({
        retrieval_snapshot_id,
        generation_log_id,
        provider,
        model,
        scene_source,
        pipeline_version,
    }, context || {});
    const effectiveContext = buildSftContextWithGenerationMetadata(context, generationMetadata);
    const context_json = effectiveContext ? JSON.stringify(effectiveContext) : null;
    const ctx = effectiveContext || {};
    const client_id = ctx.client_id || '';
    const normalizedOwner = normalizeOptionalString(owner, 64);
    const input_text = ctx.input_text || '';
    const scene = ctx.scene || 'unknown';
    const similarity = diff_analysis?.similarity ?? null;

    let status = 'approved';
    if (diff_analysis?.is_custom) {
        status = similarity >= 85 ? 'approved' : 'pending_review';
    } else if (similarity !== null && similarity < 85) {
        status = 'pending_review';
    }

    const client_id_hash = sha256(client_id);
    const input_text_hash = sha256(input_text);
    const human_output_hash = sha256(human_output);
    const created_date = new Date().toISOString().split('T')[0];
    const message_history_json = messages.length > 0 ? JSON.stringify(messages.slice(-10)) : null;

    const opt1 = model_candidates?.opt1 || null;
    const opt2 = model_candidates?.opt2 || null;
    let chosen_output = null;
    let rejected_output = null;
    if (human_selected === 'opt1') {
        chosen_output = opt1; rejected_output = opt2;
    } else if (human_selected === 'opt2') {
        chosen_output = opt2; rejected_output = opt1;
    } else if (human_selected === 'custom') {
        chosen_output = human_output; rejected_output = opt1;
    }

    const existing = await db2.prepare(`
        SELECT id, status FROM sft_memory
        WHERE client_id_hash = ? AND input_text_hash = ? AND human_output_hash = ? AND created_date = ?
    `).get(client_id_hash, input_text_hash, human_output_hash, created_date);

    const availableColumns = await getSftMemoryColumnSet();
    const structuredMetadata = buildSftStructuredMetadataFragments(generationMetadata, availableColumns);

    if (existing) {
        const newStatus = status === 'approved' ? existing.status || status : status;
        const updateAssignments = [
            'human_output = ?',
            "status = CASE WHEN ? = 'approved' THEN ? ELSE ? END",
            'similarity = ?',
            'chosen_output = ?',
            'rejected_output = ?',
            'context_json = COALESCE(?, context_json)',
            'system_prompt_used = COALESCE(?, system_prompt_used)',
            'system_prompt_version = COALESCE(?, system_prompt_version)',
            ...structuredMetadata.updateAssignments,
        ];
        const updateValues = [
            human_output,
            status,
            newStatus,
            status,
            similarity,
            chosen_output,
            rejected_output,
            context_json,
            system_prompt_used,
            system_prompt_version,
            ...structuredMetadata.updateValues,
            existing.id,
        ];
        await db2.prepare(`
            UPDATE sft_memory SET
                ${updateAssignments.join(',\n                ')}
            WHERE id = ?
        `).run(...updateValues);
        if (normalizedOwner && client_id && messages.length > 0) {
            setImmediate(() => {
                extractAndSaveMemories({
                    client_id,
                    owner: normalizedOwner,
                    messages: messages.slice(-10),
                    trigger_type: 'sft_select',
                    source_record_id: existing.id,
                }).catch((err) => console.error('[memoryExtraction] sftService update hook error:', err.message));
            });
        }
        return { ok: true, id: existing.id, updated: true, status: newStatus, client_id };
    }

    const insertColumns = [
        'model_opt1', 'model_opt2', 'human_selected', 'human_output',
        'model_predicted', 'model_rejected', 'is_custom_input', 'human_reason',
        'context_json', 'status', 'reviewed_by',
        'similarity', 'scene', 'message_history',
        'client_id_hash', 'input_text_hash', 'human_output_hash', 'created_date',
        'chosen_output', 'rejected_output', 'system_prompt_used', 'system_prompt_version',
        ...structuredMetadata.columns,
    ];
    const insertValues = [
        opt1, opt2, human_selected, human_output,
        diff_analysis?.model_predicted || null,
        diff_analysis?.model_rejected || null,
        diff_analysis?.is_custom ? 1 : 0,
        diff_analysis?.human_reason || null,
        context_json, status, reviewed_by,
        similarity, scene, message_history_json,
        client_id_hash, input_text_hash, human_output_hash, created_date,
        chosen_output, rejected_output, system_prompt_used, system_prompt_version,
        ...structuredMetadata.values,
    ];
    const result = await db2.prepare(`
        INSERT INTO sft_memory
        (${insertColumns.join(', ')})
        VALUES (${insertColumns.map(() => '?').join(', ')})
    `).run(...insertValues);

    if (normalizedOwner && client_id && messages.length > 0) {
        setImmediate(() => {
            extractAndSaveMemories({
                client_id,
                owner: normalizedOwner,
                messages: messages.slice(-10),
                trigger_type: 'sft_select',
                source_record_id: result.lastInsertRowid,
            }).catch((err) => console.error('[memoryExtraction] sftService insert hook error:', err.message));
        });
    }

    return { ok: true, id: result.lastInsertRowid, updated: false, status, client_id };
}

async function reviewSftMemory(id, action, comment = null) {
    const db2 = db.getDb();
    if (!['approve', 'reject'].includes(action)) {
        const err = new Error('action must be approve or reject');
        err.status = 400;
        throw err;
    }
    const newStatus = action === 'approve' ? 'approved' : 'rejected';
    const result = await db2.prepare(`
        UPDATE sft_memory SET status = ?, reviewed_by = ?, human_reason = COALESCE(?, human_reason)
        WHERE id = ?
    `).run(newStatus, 'human_review', comment, parseInt(id));
    if (result.changes === 0) {
        const err = new Error('Record not found');
        err.status = 404;
        throw err;
    }
    return { ok: true, status: newStatus };
}

async function getSftMemoryStats(owner = null) {
    const db2 = db.getDb();
    const normalizedOwner = normalizeOptionalString(owner, 64);
    const stats = await db2.prepare(`
        SELECT
            COUNT(*) as total,
            SUM(CASE WHEN sm.human_selected = 'opt1' THEN 1 ELSE 0 END) as opt1,
            SUM(CASE WHEN sm.human_selected = 'opt2' THEN 1 ELSE 0 END) as opt2,
            SUM(CASE WHEN sm.human_selected = 'custom' THEN 1 ELSE 0 END) as custom_count,
            SUM(CASE WHEN sm.status IN ('pending_review','needs_review') THEN 1 ELSE 0 END) as pending_count,
            SUM(CASE WHEN sm.status = 'approved' THEN 1 ELSE 0 END) as approved_count
        FROM sft_memory sm
        LEFT JOIN creators c
          ON c.wa_phone = JSON_UNQUOTE(JSON_EXTRACT(sm.context_json, '$.client_id'))
        ${normalizedOwner ? 'WHERE c.wa_owner = ?' : ''}
    `).get(...(normalizedOwner ? [normalizedOwner] : []));
    const total = stats?.total || 0;
    const opt1 = stats?.opt1 || 0;
    const opt2 = stats?.opt2 || 0;
    const custom = stats?.custom_count || 0;
    const pending = stats?.pending_count || 0;
    const approved = stats?.approved_count || 0;
    return {
        owner: normalizedOwner || null,
        total,
        opt1_selected: opt1,
        opt2_selected: opt2,
        custom_input: custom,
        pending_review: pending,
        approved,
        model_override_rate: total > 0 ? ((custom / total) * 100).toFixed(1) + '%' : '0%',
    };
}

async function getSftMemoryTrends(owner = null, days = 30) {
    const db2 = db.getDb();
    const normalizedOwner = normalizeOptionalString(owner, 64);
    const safeDays = Math.min(Math.max(parseInt(days, 10) || 30, 1), 365);
    const rows = await db2.prepare(`
        SELECT
            DATE(sm.created_at) as date,
            COUNT(*) as total,
            SUM(CASE WHEN sm.human_selected = 'opt1' THEN 1 ELSE 0 END) as opt1_cnt,
            SUM(CASE WHEN sm.human_selected = 'opt2' THEN 1 ELSE 0 END) as opt2_cnt,
            SUM(CASE WHEN sm.human_selected = 'custom' THEN 1 ELSE 0 END) as custom_cnt,
            SUM(CASE WHEN sm.status = 'pending_review' THEN 1 ELSE 0 END) as pending_cnt
        FROM sft_memory sm
        LEFT JOIN creators c
          ON c.wa_phone = JSON_UNQUOTE(JSON_EXTRACT(sm.context_json, '$.client_id'))
        WHERE sm.created_at >= DATE_SUB(CURDATE(), INTERVAL ${safeDays} DAY)
        ${normalizedOwner ? 'AND c.wa_owner = ?' : ''}
        GROUP BY DATE(sm.created_at)
        ORDER BY date ASC
    `).all(...(normalizedOwner ? [normalizedOwner] : []));

    const dates = rows.map(r => r.date);
    const volumes = rows.map(r => r.total);
    const opt1_rate = rows.map(r => r.total > 0 ? +(r.opt1_cnt / r.total * 100).toFixed(1) : 0);
    const opt2_rate = rows.map(r => r.total > 0 ? +(r.opt2_cnt / r.total * 100).toFixed(1) : 0);
    const custom_rate = rows.map(r => r.total > 0 ? +(r.custom_cnt / r.total * 100).toFixed(1) : 0);

    const skipRows = await db2.prepare(`
        SELECT DATE(sf.created_at) as date, COUNT(*) as skip_cnt
        FROM sft_feedback sf
        LEFT JOIN creators c ON c.wa_phone = sf.client_id
        WHERE sf.feedback_type = 'skip' AND sf.created_at >= DATE_SUB(CURDATE(), INTERVAL ${safeDays} DAY)
        ${normalizedOwner ? 'AND c.wa_owner = ?' : ''}
        GROUP BY DATE(sf.created_at)
    `).all(...(normalizedOwner ? [normalizedOwner] : []));
    const skipMap = {};
    skipRows.forEach(r => { skipMap[r.date] = r.skip_cnt; });
    const skip_rate = rows.map(r => {
        const skip = skipMap[r.date] || 0;
        return r.total > 0 ? +(skip / (r.total + skip) * 100).toFixed(1) : 0;
    });

    return { owner: normalizedOwner || null, dates, volumes, opt1_rate, opt2_rate, custom_rate, skip_rate };
}

// ========== SFT Feedback ==========

async function createSftFeedback({ client_id, feedback_type, input_text, opt1, opt2, final_output, scene, detail, reject_reason }) {
    if (!['skip', 'reject', 'edit'].includes(feedback_type)) {
        const err = new Error('feedback_type must be skip, reject, or edit');
        err.status = 400;
        throw err;
    }
    const db2 = db.getDb();
    const result = await db2.prepare(`
        INSERT INTO sft_feedback (client_id, feedback_type, input_text, opt1, opt2, final_output, scene, detail, reject_reason)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(client_id || null, feedback_type, input_text || null, opt1 || null, opt2 || null, final_output || null, scene || null, detail || null, reject_reason || null);
    return { ok: true, id: result.lastInsertRowid };
}

async function getSftFeedbackStats(owner = null) {
    const db2 = db.getDb();
    const normalizedOwner = normalizeOptionalString(owner, 64);
    const totalRow = await db2.prepare(`
        SELECT COUNT(*) as count
        FROM sft_feedback sf
        LEFT JOIN creators c ON c.wa_phone = sf.client_id
        ${normalizedOwner ? 'WHERE c.wa_owner = ?' : ''}
    `).get(...(normalizedOwner ? [normalizedOwner] : []));
    const total = totalRow?.count || 0;
    const byTypeRows = await db2.prepare(`
        SELECT sf.feedback_type, COUNT(*) as count
        FROM sft_feedback sf
        LEFT JOIN creators c ON c.wa_phone = sf.client_id
        ${normalizedOwner ? 'WHERE c.wa_owner = ?' : ''}
        GROUP BY sf.feedback_type
    `).all(...(normalizedOwner ? [normalizedOwner] : []));
    const byType = {};
    byTypeRows.forEach(r => {
        byType[r.feedback_type] = r.count;
    });
    const bySceneRows = await db2.prepare(`
        SELECT sf.scene, sf.feedback_type, COUNT(*) as count
        FROM sft_feedback sf
        LEFT JOIN creators c ON c.wa_phone = sf.client_id
        WHERE sf.scene IS NOT NULL
        ${normalizedOwner ? 'AND c.wa_owner = ?' : ''}
        GROUP BY sf.scene, sf.feedback_type
    `).all(...(normalizedOwner ? [normalizedOwner] : []));
    const sceneMap = {};
    bySceneRows.forEach(r => {
        if (!sceneMap[r.scene]) sceneMap[r.scene] = { skip: 0, reject: 0, edit: 0 };
        sceneMap[r.scene][r.feedback_type] = r.count;
    });
    return { owner: normalizedOwner || null, total, by_type: byType, by_scene: sceneMap };
}

module.exports = {
    buildSftContextWithGenerationMetadata,
    buildSftGenerationMetadata,
    buildSftStructuredMetadataFragments,
    getSftMemoryColumnSet,
    parseJsonSafe,
    validateHumanOutput,
    listSftMemory,
    listPendingSftMemory,
    createSftMemory,
    reviewSftMemory,
    getSftMemoryStats,
    getSftMemoryTrends,
    createSftFeedback,
    getSftFeedbackStats,
};
