#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const db = require('../db');
const { normalizeOperatorName } = require('../server/utils/operator');
const { maskPhone, phoneHash } = require('../server/services/waLidMappingService');

function parseArgs(argv) {
    const args = {
        owner: null,
        limit: 200,
        output: null,
        includeOk: false,
    };
    for (const raw of argv) {
        if (raw === '--include-ok') {
            args.includeOk = true;
            continue;
        }
        const match = raw.match(/^--([^=]+)=(.*)$/);
        if (!match) continue;
        const [, key, value] = match;
        if (key === 'owner') args.owner = value;
        else if (key === 'limit') args.limit = Math.max(1, parseInt(value, 10) || args.limit);
        else if (key === 'output') args.output = value;
    }
    return args;
}

function normalizePhone(value) {
    const digits = String(value || '').replace(/\D/g, '');
    return digits || '';
}

function toTimestampMs(value) {
    const n = Number(value || 0);
    if (!Number.isFinite(n) || n <= 0) return 0;
    return n > 1e12 ? Math.floor(n) : Math.floor(n * 1000);
}

function timestampToIso(value) {
    const ts = toTimestampMs(value);
    return ts > 0 ? new Date(ts).toISOString() : null;
}

async function safeAll(sql, ...params) {
    try {
        return await db.getDb().prepare(sql).all(...params);
    } catch (err) {
        if (err?.code === 'ER_NO_SUCH_TABLE') return [];
        throw err;
    }
}

async function safeGet(sql, ...params) {
    try {
        return await db.getDb().prepare(sql).get(...params);
    } catch (err) {
        if (err?.code === 'ER_NO_SUCH_TABLE') return null;
        throw err;
    }
}

async function loadOwners(ownerArg) {
    if (ownerArg) {
        const owner = normalizeOperatorName(ownerArg, ownerArg);
        return owner ? [owner] : [];
    }
    const rows = await safeAll(`
        SELECT DISTINCT operator
        FROM operator_creator_roster
        WHERE is_primary = 1 AND operator IS NOT NULL AND operator <> ''
        ORDER BY operator ASC
    `);
    return rows.map((row) => normalizeOperatorName(row.operator, row.operator)).filter(Boolean);
}

async function loadAssignments(owner) {
    return await safeAll(`
        SELECT
            r.creator_id,
            r.operator,
            r.session_id,
            r.raw_name,
            r.raw_handle,
            c.primary_name,
            c.wa_phone
        FROM operator_creator_roster r
        JOIN creators c ON c.id = r.creator_id
        WHERE r.is_primary = 1 AND r.operator = ?
        ORDER BY c.id ASC
    `, owner);
}

async function latestRows(creatorId) {
    const lastAny = await safeGet(`
        SELECT id, timestamp, wa_message_id, proto_driver
        FROM wa_messages
        WHERE creator_id = ?
        ORDER BY timestamp DESC
        LIMIT 1
    `, creatorId);
    const lastAnchor = await safeGet(`
        SELECT id, timestamp, wa_message_id, proto_driver
        FROM wa_messages
        WHERE creator_id = ? AND proto_driver = ? AND wa_message_id IS NOT NULL
        ORDER BY timestamp DESC
        LIMIT 1
    `, creatorId, 'baileys');
    return { lastAny, lastAnchor };
}

async function loadMappingSummary() {
    const rows = await safeAll(`
        SELECT session_id, operator, COUNT(*) AS count, MAX(last_seen_at) AS last_seen_at
        FROM wa_lid_mappings
        GROUP BY session_id, operator
        ORDER BY count DESC
    `);
    return rows.map((row) => ({
        session_id: row.session_id,
        operator: row.operator,
        count: Number(row.count || 0),
        last_seen_at: row.last_seen_at || null,
    }));
}

async function buildReport(args) {
    const owners = await loadOwners(args.owner);
    const report = {
        generated_at: new Date().toISOString(),
        owners,
        include_ok: args.includeOk,
        limit: args.limit,
        summary: {
            roster_total: 0,
            with_baileys_anchor: 0,
            without_baileys_anchor: 0,
            no_messages: 0,
        },
        lid_mappings: await loadMappingSummary(),
        rows: [],
    };

    for (const owner of owners) {
        const assignments = await loadAssignments(owner);
        report.summary.roster_total += assignments.length;
        for (const assignment of assignments) {
            const phone = normalizePhone(assignment.wa_phone);
            const { lastAny, lastAnchor } = await latestRows(assignment.creator_id);
            const hasAnchor = !!lastAnchor?.wa_message_id;
            if (hasAnchor) report.summary.with_baileys_anchor++;
            else report.summary.without_baileys_anchor++;
            if (!lastAny) report.summary.no_messages++;

            if (hasAnchor && !args.includeOk) continue;
            if (report.rows.length >= args.limit) continue;

            report.rows.push({
                creator_id: assignment.creator_id,
                owner,
                session_id: assignment.session_id || null,
                name: assignment.primary_name || assignment.raw_name || null,
                handle: assignment.raw_handle || null,
                phone_masked: maskPhone(phone),
                phone_hash: phoneHash(phone),
                status: hasAnchor ? 'ready' : (lastAny ? 'no_baileys_anchor' : 'no_messages'),
                last_message_at: timestampToIso(lastAny?.timestamp),
                last_message_has_id: !!lastAny?.wa_message_id,
                last_proto_driver: lastAny?.proto_driver || null,
                last_anchor_at: timestampToIso(lastAnchor?.timestamp),
            });
        }
    }

    return report;
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    const report = await buildReport(args);
    const body = `${JSON.stringify(report, null, 2)}\n`;
    if (args.output) {
        const outputPath = path.resolve(args.output);
        fs.mkdirSync(path.dirname(outputPath), { recursive: true });
        fs.writeFileSync(outputPath, body);
        console.log(`Wrote ${outputPath}`);
    } else {
        process.stdout.write(body);
    }
}

main()
    .catch((err) => {
        console.error(`report-baileys-backfill-readiness failed: ${err.message}`);
        process.exitCode = 1;
    })
    .finally(async () => {
        await db.closeDb().catch(() => {});
    });
