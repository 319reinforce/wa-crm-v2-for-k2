#!/usr/bin/env node
require('dotenv').config();

const fs = require('fs');
const path = require('path');

const db = require('../db');
const {
    analyzeCreatorEligibility,
    getMessageText,
    getRelevanceSignals,
    hasChinese,
} = require('../server/services/creatorEligibilityService');

const DAY_MS = 24 * 60 * 60 * 1000;
const REVIEW_WINDOW_DAYS = parseInt(process.env.INVALID_CHAT_REVIEW_DAYS || '7', 10);
const STRICT_MAX_MESSAGES = parseInt(process.env.INVALID_CHAT_STRICT_MAX_MESSAGES || '4', 10);
const REPORT_ROOT = process.argv.includes('--out-dir')
    ? process.argv[process.argv.indexOf('--out-dir') + 1]
    : path.join(process.cwd(), 'reports');
const INCLUDE_ROSTER = process.argv.includes('--include-roster');

function ensureDir(dir) {
    fs.mkdirSync(dir, { recursive: true });
}

function formatTimestamp(ts) {
    const date = new Date(Number(ts || 0));
    return Number.isFinite(date.getTime()) ? date.toISOString() : '';
}

function csvEscape(value) {
    const text = value == null ? '' : String(value);
    if (/[",\n]/.test(text)) {
        return `"${text.replace(/"/g, '""')}"`;
    }
    return text;
}

function toCsv(rows, headers) {
    const lines = [headers.join(',')];
    for (const row of rows) {
        lines.push(headers.map((header) => csvEscape(row[header])).join(','));
    }
    return lines.join('\n');
}

function normalizeMessages(messages = []) {
    return messages.map((message) => ({
        role: message.role,
        text: getMessageText(message),
        timestamp: Number(message.timestamp || 0),
    }));
}

function buildSnippets(messages = [], limit = 3) {
    return messages
        .slice(-limit)
        .map((message) => {
            const text = (getMessageText(message) || '').replace(/\s+/g, ' ').trim();
            return `[${message.role}] ${text.slice(0, 120)}`;
        })
        .join(' | ');
}

function classifyCandidate(candidate, messages, nowMs) {
    const normalizedMessages = normalizeMessages(messages);
    const eligibility = analyzeCreatorEligibility(
        candidate.wa_phone,
        candidate.primary_name,
        normalizedMessages,
        { mode: 'cleanup' }
    );

    const messageCount = normalizedMessages.length;
    const chineseCount = normalizedMessages.filter((message) => hasChinese(getMessageText(message))).length;
    const chineseRatio = messageCount > 0 ? chineseCount / messageCount : 0;
    const relevanceHits = getRelevanceSignals(normalizedMessages);
    const lastTsMs = normalizedMessages.length > 0
        ? Number(normalizedMessages[normalizedMessages.length - 1].timestamp || 0)
        : 0;
    const staleDays = lastTsMs > 0 ? Math.floor((nowMs - lastTsMs) / DAY_MS) : null;
    const allMessagesIrrelevant = messageCount > 0 && relevanceHits === 0;
    const mostlyChinese = messageCount > 0 && chineseRatio >= 0.5;
    const staleOverWeek = lastTsMs > 0 && (nowMs - lastTsMs) >= REVIEW_WINDOW_DAYS * DAY_MS;
    const lowMessageCount = messageCount > 0 && messageCount <= STRICT_MAX_MESSAGES;

    const definiteInvalid =
        lowMessageCount &&
        staleOverWeek &&
        mostlyChinese &&
        allMessagesIrrelevant;

    const reviewScore =
        (lowMessageCount ? 30 : 0) +
        (allMessagesIrrelevant ? 30 : 0) +
        (mostlyChinese ? 25 : 0) +
        (staleOverWeek ? 15 : 0) +
        (!candidate.in_roster ? 10 : 0) +
        (eligibility.reasons.length * 5);

    const reviewReasons = [];
    if (!candidate.in_roster) reviewReasons.push('non_roster_with_messages');
    if (lowMessageCount) reviewReasons.push('low_message_count');
    if (allMessagesIrrelevant) reviewReasons.push('all_messages_irrelevant');
    if (mostlyChinese) reviewReasons.push('mostly_chinese');
    if (staleOverWeek) reviewReasons.push('stale_over_week');
    reviewReasons.push(...eligibility.reasons);

    const needsManualReview = !definiteInvalid && (
        lowMessageCount ||
        allMessagesIrrelevant ||
        mostlyChinese ||
        staleOverWeek ||
        eligibility.reasons.length > 0 ||
        !candidate.in_roster
    );

    return {
        eligibility,
        messageCount,
        chineseCount,
        chineseRatio,
        relevanceHits,
        lastTsMs,
        staleDays,
        allMessagesIrrelevant,
        mostlyChinese,
        staleOverWeek,
        lowMessageCount,
        definiteInvalid,
        needsManualReview,
        reviewScore,
        reviewReasons,
    };
}

async function main() {
    const db2 = db.getDb();
    const nowMs = Date.now();
    const runStamp = new Date(nowMs).toISOString().replace(/[:.]/g, '-');
    const reportDir = path.join(REPORT_ROOT, `invalid-chat-review-${runStamp}`);
    ensureDir(reportDir);

    const creators = await db2.prepare(`
        SELECT
            c.id,
            c.primary_name,
            c.wa_phone,
            c.wa_owner,
            c.source,
            c.is_active,
            r.creator_id AS in_roster,
            r.operator AS roster_operator,
            r.session_id AS roster_session_id
        FROM creators c
        LEFT JOIN operator_creator_roster r ON r.creator_id = c.id AND r.is_primary = 1
        WHERE c.is_active = 1
          ${INCLUDE_ROSTER ? '' : 'AND r.creator_id IS NULL'}
        ORDER BY c.wa_owner ASC, c.id ASC
    `).all();

    const definiteRows = [];
    const manualRows = [];
    const stats = {
        scanned_creators: creators.length,
        with_messages: 0,
        definite_invalid: 0,
        manual_review: 0,
        non_roster_only: !INCLUDE_ROSTER,
        rules: {
            strict_max_messages: STRICT_MAX_MESSAGES,
            review_window_days: REVIEW_WINDOW_DAYS,
            definite_invalid_rule: 'all_messages_irrelevant && mostly_chinese && stale_over_week && message_count <= strict_max_messages',
        },
        by_operator: {},
    };

    const headers = [
        'review_bucket',
        'creator_id',
        'primary_name',
        'wa_phone',
        'wa_owner',
        'source',
        'in_roster',
        'roster_operator',
        'roster_session_id',
        'review_score',
        'review_reasons',
        'message_count',
        'chinese_count',
        'chinese_ratio',
        'relevance_hits',
        'all_messages_irrelevant',
        'mostly_chinese',
        'stale_over_week',
        'stale_days',
        'low_message_count',
        'last_message_at',
        'eligibility_reasons',
        'recent_message_snippets',
    ];

    for (const creator of creators) {
        const messages = await db2.prepare(`
            SELECT role, text, timestamp
            FROM wa_messages
            WHERE creator_id = ?
            ORDER BY timestamp ASC
        `).all(creator.id);

        if (!messages.length) continue;
        stats.with_messages += 1;

        const classification = classifyCandidate(creator, messages, nowMs);
        const row = {
            review_bucket: classification.definiteInvalid ? 'definite_invalid' : 'manual_review',
            creator_id: creator.id,
            primary_name: creator.primary_name || '',
            wa_phone: creator.wa_phone || '',
            wa_owner: creator.wa_owner || '',
            source: creator.source || '',
            in_roster: creator.in_roster ? 'yes' : 'no',
            roster_operator: creator.roster_operator || '',
            roster_session_id: creator.roster_session_id || '',
            review_score: classification.reviewScore,
            review_reasons: classification.reviewReasons.join('|'),
            message_count: classification.messageCount,
            chinese_count: classification.chineseCount,
            chinese_ratio: classification.chineseRatio.toFixed(3),
            relevance_hits: classification.relevanceHits,
            all_messages_irrelevant: classification.allMessagesIrrelevant ? 'yes' : 'no',
            mostly_chinese: classification.mostlyChinese ? 'yes' : 'no',
            stale_over_week: classification.staleOverWeek ? 'yes' : 'no',
            stale_days: classification.staleDays == null ? '' : classification.staleDays,
            low_message_count: classification.lowMessageCount ? 'yes' : 'no',
            last_message_at: formatTimestamp(classification.lastTsMs),
            eligibility_reasons: classification.eligibility.reasons.join('|'),
            recent_message_snippets: buildSnippets(messages),
        };

        const operatorKey = creator.wa_owner || 'UNKNOWN';
        if (!stats.by_operator[operatorKey]) {
            stats.by_operator[operatorKey] = { with_messages: 0, definite_invalid: 0, manual_review: 0 };
        }
        stats.by_operator[operatorKey].with_messages += 1;

        if (classification.definiteInvalid) {
            definiteRows.push(row);
            stats.definite_invalid += 1;
            stats.by_operator[operatorKey].definite_invalid += 1;
        } else if (classification.needsManualReview) {
            manualRows.push(row);
            stats.manual_review += 1;
            stats.by_operator[operatorKey].manual_review += 1;
        }
    }

    definiteRows.sort((a, b) =>
        Number(b.review_score) - Number(a.review_score) ||
        Number(b.stale_days || 0) - Number(a.stale_days || 0) ||
        Number(a.creator_id) - Number(b.creator_id));

    manualRows.sort((a, b) =>
        Number(b.review_score) - Number(a.review_score) ||
        Number(b.stale_days || 0) - Number(a.stale_days || 0) ||
        Number(a.message_count) - Number(b.message_count) ||
        Number(a.creator_id) - Number(b.creator_id));

    const definitePath = path.join(reportDir, 'definite-invalid.csv');
    const manualPath = path.join(reportDir, 'manual-review.csv');
    const summaryPath = path.join(reportDir, 'summary.json');

    fs.writeFileSync(definitePath, toCsv(definiteRows, headers));
    fs.writeFileSync(manualPath, toCsv(manualRows, headers));
    fs.writeFileSync(summaryPath, JSON.stringify({
        ...stats,
        files: {
            definite_invalid_csv: definitePath,
            manual_review_csv: manualPath,
            summary_json: summaryPath,
        },
    }, null, 2));

    console.log(JSON.stringify({
        ok: true,
        ...stats,
        files: {
            definite_invalid_csv: definitePath,
            manual_review_csv: manualPath,
            summary_json: summaryPath,
        },
        sample_manual_review: manualRows.slice(0, 10),
    }, null, 2));
}

main()
    .catch(async (error) => {
        console.error(JSON.stringify({ ok: false, error: error.message }, null, 2));
        process.exitCode = 1;
    })
    .finally(async () => {
        await db.closeDb();
    });
