/**
 * SFT Service — 训练语料与反馈数据访问封装
 * 提取自 server/routes/sft.js
 */
const db = require('../../db');
const { sha256 } = require('../utils/crypto');

// ========== 验证规则 ==========

const EMOJI_ONLY_REGEX = /^[🔶✅❌👍👎💬📋✨🎉🙏👏🎊⭐️🎯💡🔔📌📎🎬🗣️👀✅☑️✔️❤️🧡💛💚💙💜🤎🖤🤍]+$/;
const PUNCT_ONLY_REGEX = /^[.,!?。，！?、：:;；\-—_=+*#]+$/;

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

async function listSftMemory({ limit = 50, offset = 0 } = {}) {
    const db2 = db.getDb();
    const rows = await db2.prepare(`
        SELECT * FROM sft_memory
        ORDER BY created_at DESC
        LIMIT ${limit} OFFSET ${offset}
    `).all();
    return rows.map(r => ({
        ...r,
        context: parseJsonSafe(r.context_json),
        message_history: parseJsonSafe(r.message_history),
    }));
}

async function listPendingSftMemory() {
    const db2 = db.getDb();
    const rows = await db2.prepare(`
        SELECT * FROM sft_memory
        WHERE status IN ('pending_review', 'needs_review')
        ORDER BY created_at DESC
        LIMIT 100
    `).all();
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
    reviewed_by = 'system',
}) {
    const validation = validateHumanOutput(human_output);
    if (!validation.valid) {
        const err = new Error(validation.error);
        err.status = 400;
        throw err;
    }

    const db2 = db.getDb();
    const context_json = context ? JSON.stringify(context) : null;
    const ctx = context || {};
    const client_id = ctx.client_id || '';
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
        SELECT id FROM sft_memory
        WHERE client_id_hash = ? AND input_text_hash = ? AND human_output_hash = ? AND created_date = ?
    `).get(client_id_hash, input_text_hash, human_output_hash, created_date);

    if (existing) {
        const newStatus = status === 'approved' ? existing.status || status : status;
        await db2.prepare(`
            UPDATE sft_memory SET
                human_output = ?,
                status = CASE WHEN ? = 'approved' THEN ? ELSE ? END,
                similarity = ?,
                chosen_output = ?,
                rejected_output = ?
            WHERE id = ?
        `).run(human_output, status, newStatus, status, similarity, chosen_output, rejected_output, existing.id);
        return { ok: true, id: existing.id, updated: true };
    }

    const result = await db2.prepare(`
        INSERT INTO sft_memory
        (model_opt1, model_opt2, human_selected, human_output,
         model_predicted, model_rejected, is_custom_input, human_reason,
         context_json, status, reviewed_by,
         similarity, scene, message_history,
         client_id_hash, input_text_hash, human_output_hash, created_date,
         chosen_output, rejected_output)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        opt1, opt2, human_selected, human_output,
        diff_analysis?.model_predicted || null,
        diff_analysis?.model_rejected || null,
        diff_analysis?.is_custom ? 1 : 0,
        diff_analysis?.human_reason || null,
        context_json, status, reviewed_by,
        similarity, scene, message_history_json,
        client_id_hash, input_text_hash, human_output_hash, created_date,
        chosen_output, rejected_output
    );

    return { ok: true, id: result.lastInsertRowid };
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

async function getSftMemoryStats() {
    const db2 = db.getDb();
    const [totalRow, opt1Row, opt2Row, customRow, pendingRow, approvedRow] = await Promise.all([
        db2.prepare('SELECT COUNT(*) as count FROM sft_memory').get(),
        db2.prepare("SELECT COUNT(*) as count FROM sft_memory WHERE human_selected = 'opt1'").get(),
        db2.prepare("SELECT COUNT(*) as count FROM sft_memory WHERE human_selected = 'opt2'").get(),
        db2.prepare("SELECT COUNT(*) as count FROM sft_memory WHERE human_selected = 'custom'").get(),
        db2.prepare("SELECT COUNT(*) as count FROM sft_memory WHERE status IN ('pending_review','needs_review')").get(),
        db2.prepare("SELECT COUNT(*) as count FROM sft_memory WHERE status = 'approved'").get(),
    ]);
    const total = totalRow?.count || 0;
    const opt1 = opt1Row?.count || 0;
    const opt2 = opt2Row?.count || 0;
    const custom = customRow?.count || 0;
    const pending = pendingRow?.count || 0;
    const approved = approvedRow?.count || 0;
    return {
        total,
        opt1_selected: opt1,
        opt2_selected: opt2,
        custom_input: custom,
        pending_review: pending,
        approved,
        model_override_rate: total > 0 ? ((custom / total) * 100).toFixed(1) + '%' : '0%',
    };
}

async function getSftMemoryTrends(days = 30) {
    const db2 = db.getDb();
    const rows = await db2.prepare(`
        SELECT
            DATE(created_at) as date,
            COUNT(*) as total,
            SUM(CASE WHEN human_selected = 'opt1' THEN 1 ELSE 0 END) as opt1_cnt,
            SUM(CASE WHEN human_selected = 'opt2' THEN 1 ELSE 0 END) as opt2_cnt,
            SUM(CASE WHEN human_selected = 'custom' THEN 1 ELSE 0 END) as custom_cnt,
            SUM(CASE WHEN status = 'pending_review' THEN 1 ELSE 0 END) as pending_cnt
        FROM sft_memory
        WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL ${days} DAY)
        GROUP BY DATE(created_at)
        ORDER BY date ASC
    `).all();

    const dates = rows.map(r => r.date);
    const volumes = rows.map(r => r.total);
    const opt1_rate = rows.map(r => r.total > 0 ? +(r.opt1_cnt / r.total * 100).toFixed(1) : 0);
    const opt2_rate = rows.map(r => r.total > 0 ? +(r.opt2_cnt / r.total * 100).toFixed(1) : 0);
    const custom_rate = rows.map(r => r.total > 0 ? +(r.custom_cnt / r.total * 100).toFixed(1) : 0);

    const skipRows = await db2.prepare(`
        SELECT DATE(created_at) as date, COUNT(*) as skip_cnt
        FROM sft_feedback
        WHERE feedback_type = 'skip' AND created_at >= DATE_SUB(CURDATE(), INTERVAL ${days} DAY)
        GROUP BY DATE(created_at)
    `).all();
    const skipMap = {};
    skipRows.forEach(r => { skipMap[r.date] = r.skip_cnt; });
    const skip_rate = rows.map(r => {
        const skip = skipMap[r.date] || 0;
        return r.total > 0 ? +(skip / (r.total + skip) * 100).toFixed(1) : 0;
    });

    return { dates, volumes, opt1_rate, opt2_rate, custom_rate, skip_rate };
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

async function getSftFeedbackStats() {
    const db2 = db.getDb();
    const totalRow = await db2.prepare('SELECT COUNT(*) as count FROM sft_feedback').get();
    const total = totalRow?.count || 0;
    const byTypeRows = await db2.prepare('SELECT feedback_type, COUNT(*) as count FROM sft_feedback GROUP BY feedback_type').all();
    const byType = {};
    byTypeRows.forEach(r => {
        byType[r.feedback_type] = r.count;
    });
    const bySceneRows = await db2.prepare(`
        SELECT scene, feedback_type, COUNT(*) as count
        FROM sft_feedback WHERE scene IS NOT NULL
        GROUP BY scene, feedback_type
    `).all();
    const sceneMap = {};
    bySceneRows.forEach(r => {
        if (!sceneMap[r.scene]) sceneMap[r.scene] = { skip: 0, reject: 0, edit: 0 };
        sceneMap[r.scene][r.feedback_type] = r.count;
    });
    return { total, by_type: byType, by_scene: sceneMap };
}

module.exports = {
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
