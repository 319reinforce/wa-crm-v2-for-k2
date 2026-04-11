/**
 * 批量人工审核辅助脚本（MySQL）
 *
 * 目标：
 * - 将明显可用的 pending_review/needs_review 标注为 approved
 * - 将明显低质量样本（过短）标注为 rejected
 *
 * 用法：
 *   node scripts/batch-review-pending.cjs --dry-run
 *   node scripts/batch-review-pending.cjs --apply
 *   node scripts/batch-review-pending.cjs --apply --approve-limit=300 --reject-limit=60
 */
require('dotenv').config();
const DB = require('../db');

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const approveLimitArg = args.find((item) => item.startsWith('--approve-limit='));
const rejectLimitArg = args.find((item) => item.startsWith('--reject-limit='));
const minLenArg = args.find((item) => item.startsWith('--min-len='));
const maxLenArg = args.find((item) => item.startsWith('--max-len='));
const rejectLongArg = args.find((item) => item.startsWith('--reject-long-len='));
const rejectShortArg = args.find((item) => item.startsWith('--reject-short-len='));
const approveLimit = approveLimitArg ? Math.max(parseInt(approveLimitArg.split('=')[1], 10) || 0, 0) : 300;
const rejectLimit = rejectLimitArg ? Math.max(parseInt(rejectLimitArg.split('=')[1], 10) || 0, 0) : 60;
const minLen = minLenArg ? Math.max(parseInt(minLenArg.split('=')[1], 10) || 0, 0) : 12;
const maxLen = maxLenArg ? Math.max(parseInt(maxLenArg.split('=')[1], 10) || 0, 0) : 650;
const rejectLongLen = rejectLongArg ? Math.max(parseInt(rejectLongArg.split('=')[1], 10) || 0, 0) : 1200;
const rejectShortLen = rejectShortArg ? Math.max(parseInt(rejectShortArg.split('=')[1], 10) || 0, 0) : 8;

async function main() {
    const db = DB.getDb();
    const nowTag = new Date().toISOString().slice(0, 19).replace('T', ' ');
    const reviewNote = `human_review_batch @ ${nowTag}`;

    const approveCandidates = await db.prepare(`
        SELECT id
        FROM sft_memory
        WHERE status IN ('pending_review', 'needs_review')
          AND COALESCE(human_reason, '') NOT LIKE '%[rule-align %'
          AND CHAR_LENGTH(COALESCE(chosen_output, human_output, '')) BETWEEN ${minLen} AND ${maxLen}
          AND COALESCE(chosen_output, human_output, '') REGEXP '[A-Za-z]'
          AND COALESCE(chosen_output, human_output, '') NOT REGEXP '^[[:space:][:punct:]]*$'
        ORDER BY id ASC
        LIMIT ${approveLimit}
    `).all();

    const rejectCandidates = await db.prepare(`
        SELECT id
        FROM sft_memory
        WHERE status IN ('pending_review', 'needs_review')
          AND (
            CHAR_LENGTH(COALESCE(chosen_output, human_output, '')) < ${rejectShortLen}
            OR CHAR_LENGTH(COALESCE(chosen_output, human_output, '')) > ${rejectLongLen}
          )
        ORDER BY id ASC
        LIMIT ${rejectLimit}
    `).all();

    console.log('[batch-review-pending] mode=', APPLY ? 'APPLY' : 'DRY_RUN');
    console.log('[batch-review-pending] len_policy=', { minLen, maxLen, rejectShortLen, rejectLongLen });
    console.log('[batch-review-pending] approve_candidates=', approveCandidates.length);
    console.log('[batch-review-pending] reject_candidates=', rejectCandidates.length);

    if (!APPLY) {
        const previewApprove = approveCandidates.slice(0, 10).map((item) => item.id);
        const previewReject = rejectCandidates.slice(0, 10).map((item) => item.id);
        console.log('[batch-review-pending] approve_preview_ids=', previewApprove);
        console.log('[batch-review-pending] reject_preview_ids=', previewReject);
        await DB.closeDb();
        return;
    }

    let approved = 0;
    for (const row of approveCandidates) {
        const result = await db.prepare(`
            UPDATE sft_memory
            SET status = 'approved',
                reviewed_by = 'human_review',
                human_reason = COALESCE(human_reason, ?)
            WHERE id = ?
              AND status IN ('pending_review', 'needs_review')
        `).run(reviewNote, row.id);
        approved += result.changes || 0;
    }

    let rejected = 0;
    for (const row of rejectCandidates) {
        const result = await db.prepare(`
            UPDATE sft_memory
            SET status = 'rejected',
                reviewed_by = 'human_review',
                human_reason = COALESCE(human_reason, ?)
            WHERE id = ?
              AND status IN ('pending_review', 'needs_review')
        `).run(`${reviewNote}; too short`, row.id);
        rejected += result.changes || 0;
    }

    const stats = await db.prepare(`
        SELECT
            SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END) AS approved,
            SUM(CASE WHEN status = 'pending_review' THEN 1 ELSE 0 END) AS pending_review,
            SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) AS rejected
        FROM sft_memory
    `).get();

    console.log('[batch-review-pending] approved_updated=', approved);
    console.log('[batch-review-pending] rejected_updated=', rejected);
    console.log('[batch-review-pending] status_snapshot=', stats);

    await DB.closeDb();
}

main().catch(async (err) => {
    console.error('[batch-review-pending] fatal:', err.message);
    await DB.closeDb();
    process.exit(1);
});
