#!/usr/bin/env node
/**
 * 对齐历史 SFT 数据到目标规则版本（默认 2026-04-15）
 *
 * 用法：
 *   node scripts/align-sft-rule-version.cjs --dry-run
 *   node scripts/align-sft-rule-version.cjs --apply
 *   node scripts/align-sft-rule-version.cjs --apply --owner=Beau --limit=400
 *   node scripts/align-sft-rule-version.cjs --apply --effective-date=2026-04-15 --target-rule=2026-04-15
 */
require('dotenv').config();
const fs = require('fs');
const DB = require('../db');

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const dryRunExplicit = args.includes('--dry-run');
const ownerArg = args.find((item) => item.startsWith('--owner='));
const limitArg = args.find((item) => item.startsWith('--limit='));
const effectiveArg = args.find((item) => item.startsWith('--effective-date='));
const targetRuleArg = args.find((item) => item.startsWith('--target-rule='));
const maxIssuesArg = args.find((item) => item.startsWith('--max-issues-preview='));

const owner = ownerArg ? ownerArg.split('=')[1] : null;
const limit = limitArg ? Math.max(parseInt(limitArg.split('=')[1], 10) || 0, 0) : 0;
const effectiveDate = effectiveArg ? effectiveArg.split('=')[1] : (process.env.SFT_RULE_EFFECTIVE_DATE || '2026-04-15');
const targetRule = targetRuleArg ? targetRuleArg.split('=')[1] : (process.env.SFT_RULE_VERSION || effectiveDate);
const maxIssuesPreview = maxIssuesArg ? Math.max(parseInt(maxIssuesArg.split('=')[1], 10) || 12, 1) : 12;
const DRY_RUN = dryRunExplicit || !APPLY;

function parseJsonSafe(value, fallback = null) {
    if (value ***REMOVED***= null || value ***REMOVED***= undefined) return fallback;
    if (typeof value ***REMOVED***= 'object') return value;
    try {
        return JSON.parse(value);
    } catch (_) {
        return fallback;
    }
}

function toIso(inputDate) {
    if (!inputDate || typeof inputDate !***REMOVED*** 'string') return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(inputDate)) {
        return new Date(`${inputDate}T00:00:00.000+08:00`).toISOString();
    }
    const d = new Date(inputDate);
    return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

function loadApprovedSourceIds() {
    const manifestPath = process.env.KNOWLEDGE_MANIFEST_PATH || 'docs/rag/knowledge-manifest.json';
    try {
        const payload = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        const sources = Array.isArray(payload?.sources) ? payload.sources : [];
        return {
            manifest_version: payload?.version || null,
            source_ids: sources.filter((s) => s?.status ***REMOVED***= 'approved').map((s) => s.id).filter(Boolean),
        };
    } catch (_) {
        return { manifest_version: null, source_ids: [] };
    }
}

function evaluateRuleAlignment(row) {
    const scene = String(row.scene || '').trim() || 'unknown';
    const text = String(row.chosen_output || row.human_output || '').trim();
    const textLower = text.toLowerCase();
    const issues = [];
    const sceneTrialOrPayment = ['trial_intro', 'trial_followup', 'payment_intro', 'payment_issue'].includes(scene);

    if (text.length < 10) issues.push('reply_too_short');
    if (text.length > 1400) issues.push('reply_too_long');
    if (/(guarantee|100%|no risk|risk[- ]?free|稳赚|保证收益|百分百|绝对不会)/i.test(text)) {
        issues.push('over_promise_or_zero_risk');
    }
    if (sceneTrialOrPayment && !/(\$?\s*20\b|20\/month|20 per month|month fee|月费.{0,3}20|20美金|20美元)/i.test(text)) {
        issues.push('missing_monthly_fee_disclosure');
    }
    if (scene ***REMOVED***= 'trial_intro' && !/(7[\s-]?day|7天|trial|试用)/i.test(textLower)) {
        issues.push('missing_trial_term_reference');
    }
    if (scene ***REMOVED***= 'payment_issue' && !/(appeal|violation|risk|申诉|违规|风控)/i.test(textLower)) {
        issues.push('weak_violation_risk_guidance');
    }

    return {
        scene,
        text_len: text.length,
        issues,
        shouldPendingReview: issues.length > 0,
    };
}

function mergeReason(oldReason, extra) {
    const base = String(oldReason || '').trim();
    if (!base) return extra;
    if (base.includes(extra)) return base;
    return `${base}; ${extra}`;
}

async function main() {
    const db = DB.getDb();
    const cutoffIso = toIso(effectiveDate);
    if (!cutoffIso) {
        throw new Error(`invalid --effective-date: ${effectiveDate}`);
    }
    const snapshot = loadApprovedSourceIds();

    let where = `
        WHERE sm.human_selected = 'custom'
          AND sm.created_at < ?
    `;
    const params = [cutoffIso];
    let joinClause = '';
    if (owner) {
        joinClause = 'LEFT JOIN creators c ON c.wa_phone = JSON_UNQUOTE(JSON_EXTRACT(sm.context_json, "$.client_id"))';
        where += ' AND c.wa_owner = ?';
        params.push(owner);
    }
    const limitSql = limit > 0 ? `LIMIT ${limit}` : '';

    const rows = await db.prepare(`
        SELECT sm.id, sm.status, sm.scene, sm.human_output, sm.chosen_output, sm.human_reason, sm.context_json, sm.created_at
        FROM sft_memory sm
        ${joinClause}
        ${where}
        ORDER BY sm.id ASC
        ${limitSql}
    `).all(...params);

    let processed = 0;
    let pendingMarked = 0;
    let alignedOnly = 0;
    const issueCounter = new Map();
    const issuePreview = [];

    for (const row of rows) {
        processed += 1;
        const evalResult = evaluateRuleAlignment(row);
        evalResult.issues.forEach((item) => issueCounter.set(item, (issueCounter.get(item) || 0) + 1));
        if (evalResult.issues.length > 0 && issuePreview.length < maxIssuesPreview) {
            issuePreview.push({ id: row.id, scene: evalResult.scene, issues: evalResult.issues, status: row.status });
        }

        if (DRY_RUN) continue;

        const ctx = parseJsonSafe(row.context_json, {}) || {};
        ctx.rule_alignment = {
            target_rule_version: targetRule,
            effective_date: effectiveDate,
            checked_at: new Date().toISOString(),
            status: evalResult.shouldPendingReview ? 'needs_review' : 'aligned',
            issues: evalResult.issues,
            knowledge_manifest_version: snapshot.manifest_version,
            knowledge_source_ids: snapshot.source_ids,
        };

        if (evalResult.shouldPendingReview && row.status ***REMOVED***= 'approved') {
            const reason = mergeReason(row.human_reason, `[rule-align ${targetRule}] ${evalResult.issues.join('|')}`);
            const res = await db.prepare(`
                UPDATE sft_memory
                SET status = 'pending_review',
                    reviewed_by = 'rule_alignment',
                    human_reason = ?,
                    context_json = ?
                WHERE id = ?
            `).run(reason, JSON.stringify(ctx), row.id);
            if (res.changes > 0) pendingMarked += 1;
        } else {
            const res = await db.prepare(`
                UPDATE sft_memory
                SET context_json = ?
                WHERE id = ?
            `).run(JSON.stringify(ctx), row.id);
            if (res.changes > 0) alignedOnly += 1;
        }
    }

    const issueSummary = Array.from(issueCounter.entries())
        .map(([issue, count]) => ({ issue, count }))
        .sort((a, b) => b.count - a.count);

    const statusSnapshot = await db.prepare(`
        SELECT status, COUNT(*) AS count
        FROM sft_memory
        GROUP BY status
        ORDER BY count DESC
    `).all();

    console.log(JSON.stringify({
        mode: DRY_RUN ? 'DRY_RUN' : 'APPLY',
        owner: owner || null,
        effective_date: effectiveDate,
        target_rule: targetRule,
        scanned_rows: rows.length,
        processed,
        pending_marked: pendingMarked,
        aligned_only_updated: alignedOnly,
        issue_summary: issueSummary,
        issue_preview: issuePreview,
        status_snapshot: statusSnapshot,
    }, null, 2));

    await DB.closeDb();
}

main().catch(async (err) => {
    console.error('[align-sft-rule-version] fatal:', err.message);
    await DB.closeDb();
    process.exit(1);
});

