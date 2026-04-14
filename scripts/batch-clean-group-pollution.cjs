#!/usr/bin/env node
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { getDb, closeDb } = require('../db');
const { createSessionCommand, waitForSessionCommandResult } = require('../server/services/waIpc');
const { replaceCreatorMessagesFromRaw } = require('../server/services/waMessageRepairService');

const DEFAULT_OWNERS = ['Beau', 'Jiawen', 'Yiyun'];
const DEFAULT_FETCH_LIMIT = 200;
const DEFAULT_RATIO = 1.3;
const DEFAULT_GAP = 5;
const DEFAULT_SLEEP_MS = 250;
const DEFAULT_TIMEOUT_MS = 30000;
const DEFAULT_MIN_EXISTING = 10;
const DEFAULT_MIN_RAW = 5;
const QUERY_PADDING_MS = 12 * 60 * 60 * 1000;

const SESSION_BY_OWNER = {
    beau: 'beau',
    jiawen: 'jiawen',
    yiyun: 'yiyun',
    youke: 'youke',
    wangyouke: 'youke',
};

function parseArgs(argv) {
    const out = {
        apply: false,
        owners: DEFAULT_OWNERS,
        fetchLimit: DEFAULT_FETCH_LIMIT,
        ratio: DEFAULT_RATIO,
        gap: DEFAULT_GAP,
        sleepMs: DEFAULT_SLEEP_MS,
        timeoutMs: DEFAULT_TIMEOUT_MS,
        maxPerOwner: 0,
        minExisting: DEFAULT_MIN_EXISTING,
        minRaw: DEFAULT_MIN_RAW,
    };
    for (const arg of argv) {
        if (arg === '--apply') out.apply = true;
        if (arg.startsWith('--owners=')) {
            const raw = arg.slice('--owners='.length);
            out.owners = raw.split(',').map((v) => v.trim()).filter(Boolean);
        }
        if (arg.startsWith('--fetch-limit=')) out.fetchLimit = Math.max(20, parseInt(arg.slice('--fetch-limit='.length), 10) || DEFAULT_FETCH_LIMIT);
        if (arg.startsWith('--ratio=')) out.ratio = Math.max(1, Number(arg.slice('--ratio='.length)) || DEFAULT_RATIO);
        if (arg.startsWith('--gap=')) out.gap = Math.max(1, parseInt(arg.slice('--gap='.length), 10) || DEFAULT_GAP);
        if (arg.startsWith('--sleep-ms=')) out.sleepMs = Math.max(0, parseInt(arg.slice('--sleep-ms='.length), 10) || DEFAULT_SLEEP_MS);
        if (arg.startsWith('--timeout-ms=')) out.timeoutMs = Math.max(5000, parseInt(arg.slice('--timeout-ms='.length), 10) || DEFAULT_TIMEOUT_MS);
        if (arg.startsWith('--max-per-owner=')) out.maxPerOwner = Math.max(0, parseInt(arg.slice('--max-per-owner='.length), 10) || 0);
        if (arg.startsWith('--min-existing=')) out.minExisting = Math.max(0, parseInt(arg.slice('--min-existing='.length), 10) || DEFAULT_MIN_EXISTING);
        if (arg.startsWith('--min-raw=')) out.minRaw = Math.max(1, parseInt(arg.slice('--min-raw='.length), 10) || DEFAULT_MIN_RAW);
    }
    return out;
}

function maskPhone(phone) {
    const digits = String(phone || '').replace(/\D/g, '');
    if (!digits) return '';
    const tail = digits.slice(-4);
    return `****${tail}`;
}

function toIsoForName(value = new Date()) {
    return value.toISOString().replace(/[:.]/g, '-');
}

function ensureDir(filePath) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function resolveSessionId(owner) {
    const key = String(owner || '').trim().toLowerCase();
    return SESSION_BY_OWNER[key] || key || 'beau';
}

async function fetchCreatorsByOwner(db, owner, maxPerOwner) {
    const rows = await db.prepare(`
        SELECT id, primary_name, wa_phone, wa_owner
        FROM creators
        WHERE wa_owner = ?
          AND is_active = 1
          AND wa_phone IS NOT NULL
          AND wa_phone <> '0'
        ORDER BY id ASC
    `).all(owner);
    if (!Array.isArray(rows)) return [];
    if (maxPerOwner > 0) return rows.slice(0, maxPerOwner);
    return rows;
}

async function fetchExistingTotal(db, creatorId) {
    const row = await db.prepare(`
        SELECT COUNT(*) AS count
        FROM wa_messages
        WHERE creator_id = ?
    `).get(creatorId);
    return Number(row?.count) || 0;
}

async function fetchRawMessages(sessionId, phone, limit, timeoutMs) {
    const commandId = createSessionCommand(sessionId, {
        type: 'audit_recent_messages',
        payload: { phone, limit },
    });
    try {
        return await waitForSessionCommandResult(sessionId, commandId, timeoutMs);
    } catch (error) {
        return { ok: false, error: error.message || String(error) };
    }
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
    const options = parseArgs(process.argv.slice(2));
    const db = getDb();
    const report = {
        generated_at: new Date().toISOString(),
        apply: options.apply,
        owners: options.owners,
        fetch_limit: options.fetchLimit,
        ratio: options.ratio,
        gap: options.gap,
        timeout_ms: options.timeoutMs,
        max_per_owner: options.maxPerOwner,
        min_existing: options.minExisting,
        min_raw: options.minRaw,
        results: [],
    };

    console.log('[batch-clean-group-pollution] options=', {
        apply: options.apply,
        owners: options.owners,
        fetch_limit: options.fetchLimit,
        ratio: options.ratio,
        gap: options.gap,
        timeout_ms: options.timeoutMs,
        max_per_owner: options.maxPerOwner,
        min_existing: options.minExisting,
        min_raw: options.minRaw,
    });

    for (const owner of options.owners) {
        const sessionId = resolveSessionId(owner);
        const creators = await fetchCreatorsByOwner(db, owner, options.maxPerOwner);
        for (const creator of creators) {
            const maskedPhone = maskPhone(creator.wa_phone);
            const existingTotal = await fetchExistingTotal(db, creator.id);
            if (existingTotal < options.minExisting) {
                report.results.push({
                    owner,
                    session_id: sessionId,
                    creator_id: creator.id,
                    creator_name: creator.primary_name,
                    wa_phone_masked: maskedPhone,
                    raw_count: 0,
                    existing_total: existingTotal,
                    polluted: false,
                    skipped: true,
                    note: 'existing_total_below_threshold',
                });
                console.log('[batch-clean-group-pollution] skipped_low_existing', {
                    owner,
                    session_id: sessionId,
                    creator_id: creator.id,
                    creator_name: creator.primary_name,
                    wa_phone_masked: maskedPhone,
                    existing_total: existingTotal,
                });
                continue;
            }
            const rawResult = await fetchRawMessages(sessionId, creator.wa_phone, options.fetchLimit, options.timeoutMs);
            if (!rawResult?.ok) {
                report.results.push({
                    owner,
                    session_id: sessionId,
                    creator_id: creator.id,
                    creator_name: creator.primary_name,
                    wa_phone_masked: maskedPhone,
                    existing_total: existingTotal,
                    error: rawResult?.error || 'audit_failed',
                });
                console.log('[batch-clean-group-pollution] audit_failed', {
                    owner,
                    session_id: sessionId,
                    creator_id: creator.id,
                    creator_name: creator.primary_name,
                    wa_phone_masked: maskedPhone,
                    existing_total: existingTotal,
                    error: rawResult?.error || 'audit_failed',
                });
                if (options.sleepMs) await sleep(options.sleepMs);
                continue;
            }

            const rawMessages = Array.isArray(rawResult.messages) ? rawResult.messages : [];
            const rawCount = rawMessages.length;
            if (rawCount === 0) {
                report.results.push({
                    owner,
                    session_id: sessionId,
                    creator_id: creator.id,
                    creator_name: creator.primary_name,
                    wa_phone_masked: maskedPhone,
                    raw_count: 0,
                    existing_total: existingTotal,
                    existing_count: 0,
                    polluted: false,
                    skipped: true,
                    note: 'no raw messages',
                });
                console.log('[batch-clean-group-pollution] no_raw_messages', {
                    owner,
                    session_id: sessionId,
                    creator_id: creator.id,
                    creator_name: creator.primary_name,
                    wa_phone_masked: maskedPhone,
                });
                if (options.sleepMs) await sleep(options.sleepMs);
                continue;
            }

            const timestamps = rawMessages
                .map((message) => Number(message?.timestamp) || 0)
                .filter((ts) => ts > 0)
                .sort((a, b) => a - b);
            if (timestamps.length === 0) {
                report.results.push({
                    owner,
                    session_id: sessionId,
                    creator_id: creator.id,
                    creator_name: creator.primary_name,
                    wa_phone_masked: maskedPhone,
                    raw_count: rawCount,
                    existing_total: existingTotal,
                    existing_count: 0,
                    polluted: false,
                    skipped: true,
                    note: 'raw timestamps missing',
                });
                console.log('[batch-clean-group-pollution] raw_timestamps_missing', {
                    owner,
                    session_id: sessionId,
                    creator_id: creator.id,
                    creator_name: creator.primary_name,
                    wa_phone_masked: maskedPhone,
                });
                if (options.sleepMs) await sleep(options.sleepMs);
                continue;
            }

            const minTs = Math.max(0, timestamps[0] - QUERY_PADDING_MS);
            const maxTs = timestamps[timestamps.length - 1] + QUERY_PADDING_MS;
            const existingRow = await db.prepare(`
                SELECT COUNT(*) AS count
                FROM wa_messages
                WHERE creator_id = ?
                  AND timestamp BETWEEN ? AND ?
            `).get(creator.id, minTs, maxTs);
            const existingCount = Number(existingRow?.count) || 0;
            const polluted = existingCount >= Math.floor(rawCount * options.ratio)
                && (existingCount - rawCount) >= options.gap;

            let replacement = null;
            if (polluted && rawCount < options.minRaw) {
                report.results.push({
                    owner,
                    session_id: sessionId,
                    creator_id: creator.id,
                    creator_name: creator.primary_name,
                    wa_phone_masked: maskedPhone,
                    raw_count: rawCount,
                    existing_total: existingTotal,
                    existing_count: existingCount,
                    polluted: true,
                    replaced: false,
                    skipped: true,
                    note: 'raw_count_below_threshold',
                });
                console.log('[batch-clean-group-pollution] skipped_low_raw', {
                    owner,
                    session_id: sessionId,
                    creator_id: creator.id,
                    creator_name: creator.primary_name,
                    wa_phone_masked: maskedPhone,
                    raw_count: rawCount,
                    existing_total: existingTotal,
                    existing_count: existingCount,
                });
                if (options.sleepMs) await sleep(options.sleepMs);
                continue;
            }

            if (polluted && options.apply) {
                replacement = await replaceCreatorMessagesFromRaw({
                    creatorId: creator.id,
                    creatorName: creator.primary_name,
                    operator: owner,
                    rawMessages,
                    deleteAll: false,
                    dryRun: false,
                });
            }

            report.results.push({
                owner,
                session_id: sessionId,
                creator_id: creator.id,
                creator_name: creator.primary_name,
                wa_phone_masked: maskedPhone,
                raw_count: rawCount,
                existing_total: existingTotal,
                existing_count: existingCount,
                polluted,
                replaced: !!replacement,
                replacement_summary: replacement ? {
                    inserted_count: replacement.inserted_count,
                    deleted_count: replacement.deleted_count,
                    window_start: replacement.window_start,
                    window_end: replacement.window_end,
                } : null,
            });
            console.log('[batch-clean-group-pollution] checked', {
                owner,
                session_id: sessionId,
                creator_id: creator.id,
                creator_name: creator.primary_name,
                wa_phone_masked: maskedPhone,
                raw_count: rawCount,
                existing_total: existingTotal,
                existing_count: existingCount,
                polluted,
                replaced: !!replacement,
            });

            if (options.sleepMs) await sleep(options.sleepMs);
        }
    }

    const totals = report.results.reduce((acc, item) => {
        acc.checked += 1;
        if (item.polluted) acc.polluted += 1;
        if (item.replaced) acc.replaced += 1;
        if (item.error) acc.errors += 1;
        return acc;
    }, { checked: 0, polluted: 0, replaced: 0, errors: 0 });
    report.summary = totals;

    const reportPath = path.resolve(process.cwd(), 'reports', 'group-pollution-cleaner', `${toIsoForName()}.json`);
    ensureDir(reportPath);
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');

    console.log('[batch-clean-group-pollution] summary=', totals);
    console.log('[batch-clean-group-pollution] report_path=', reportPath);
    await closeDb();
}

main().catch(async (error) => {
    console.error('[batch-clean-group-pollution] fatal:', error.message);
    await closeDb();
    process.exit(1);
});
