#!/usr/bin/env node
/**
 * 结束并导出 RAG 观测报告
 *
 * 用法:
 *   npm run rag:obs:finish
 *   npm run rag:obs:finish -- --owner=Beau
 *   npm run rag:obs:finish -- --hours=24
 *   npm run metrics:launch:report
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const db = require('../db');

const MARKER_PATH = process.env.RAG_OBS_MARKER_PATH || 'docs/rag/observation-window.json';
const REPORT_DIR = process.env.RAG_OBS_REPORT_DIR || 'docs/rag/observation-reports';
const FORMAL_LAUNCH_MARKER_PATH = process.env.FORMAL_LAUNCH_MARKER_PATH || 'docs/rag/formal-launch-window.json';

function parseArgs() {
    const args = process.argv.slice(2);
    const out = {
        owner: null,
        hours: null,
        fromLaunch: false,
    };
    for (const arg of args) {
        if (arg.startsWith('--owner=')) out.owner = arg.slice('--owner='.length);
        if (arg.startsWith('--hours=')) out.hours = parseInt(arg.slice('--hours='.length), 10);
        if (arg === '--from-launch') out.fromLaunch = true;
    }
    return out;
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

function pct(n, d) {
    if (!d) return '0.0%';
    return `${((n / d) * 100).toFixed(1)}%`;
}

function toMysqlDateTime(date) {
    return date.toISOString().slice(0, 19).replace('T', ' ');
}

function ensureDir(dirPath) {
    fs.mkdirSync(dirPath, { recursive: true });
}

function aggregateTopSources(generationRows) {
    const map = new Map();
    generationRows.forEach((row) => {
        const hits = row?.rag?.hits || [];
        hits.forEach((hit) => {
            const key = `${hit.source_id || hit.filename || 'unknown'}|${hit.source_type || 'unknown'}`;
            if (!map.has(key)) {
                map.set(key, {
                    source_id: hit.source_id || null,
                    source_type: hit.source_type || null,
                    filename: hit.filename || null,
                    hit_count: 0,
                });
            }
            map.get(key).hit_count += 1;
        });
    });
    return Array.from(map.values()).sort((a, b) => b.hit_count - a.hit_count).slice(0, 10);
}

async function fetchGenerationRows({ startAt, endAt, owner, minId = null }) {
    const db2 = db.getDb();
    const params = [];
    let ownerJoin = '';
    let ownerWhere = '';
    let timeWhere = '';
    if (Number.isFinite(minId)) {
        timeWhere = 'WHERE gl.id > ?';
        params.push(minId);
    } else {
        timeWhere = 'WHERE gl.created_at >= ? AND gl.created_at <= ?';
        params.push(startAt, endAt);
    }
    if (owner) {
        ownerJoin = 'LEFT JOIN creators c ON c.wa_phone = gl.client_id';
        ownerWhere = ' AND c.wa_owner = ?';
        params.push(owner);
    }
    const rows = await db2.prepare(`
        SELECT gl.id, gl.client_id, gl.retrieval_snapshot_id, gl.scene, gl.operator, gl.status, gl.latency_ms, gl.created_at,
               rs.grounding_json
        FROM generation_log gl
        ${ownerJoin}
        LEFT JOIN retrieval_snapshot rs ON rs.id = gl.retrieval_snapshot_id
        ${timeWhere}
        ${ownerWhere}
        ORDER BY gl.created_at DESC
    `).all(...params);

    return rows.map((row) => {
        const grounding = parseJsonSafe(row.grounding_json, {});
        const rag = grounding?.rag || {};
        return {
            ...row,
            rag: {
                enabled: !!rag?.enabled,
                hit_count: Number.isFinite(Number(rag?.hit_count)) ? Number(rag.hit_count) : 0,
                hits: Array.isArray(rag?.hits) ? rag.hits : [],
            },
        };
    });
}

async function fetchSftRows({ startAt, endAt, owner, minId = null }) {
    const db2 = db.getDb();
    const params = [];
    let joinClause = '';
    let ownerWhere = '';
    let timeWhere = '';
    if (Number.isFinite(minId)) {
        timeWhere = 'WHERE sm.id > ?';
        params.push(minId);
    } else {
        timeWhere = 'WHERE sm.created_at >= ? AND sm.created_at <= ?';
        params.push(startAt, endAt);
    }
    if (owner) {
        joinClause = 'LEFT JOIN creators c ON c.wa_phone = JSON_UNQUOTE(JSON_EXTRACT(sm.context_json, "$.client_id"))';
        ownerWhere = ' AND c.wa_owner = ?';
        params.push(owner);
    }
    return db2.prepare(`
        SELECT sm.id, sm.human_selected, sm.status, sm.context_json, sm.scene, sm.created_at
        FROM sft_memory sm
        ${joinClause}
        ${timeWhere}
        ${ownerWhere}
        ORDER BY sm.created_at DESC
    `).all(...params);
}

async function fetchSkipCount({ startAt, endAt, owner, minId = null }) {
    const db2 = db.getDb();
    const params = [];
    let joinClause = '';
    let ownerWhere = '';
    let timeWhere = '';
    if (Number.isFinite(minId)) {
        timeWhere = 'WHERE sf.id > ?';
        params.push(minId);
    } else {
        timeWhere = 'WHERE sf.created_at >= ? AND sf.created_at <= ?';
        params.push(startAt, endAt);
    }
    if (owner) {
        joinClause = 'LEFT JOIN creators c ON c.wa_phone = sf.client_id';
        ownerWhere = ' AND c.wa_owner = ?';
        params.push(owner);
    }
    const row = await db2.prepare(`
        SELECT COUNT(*) AS count
        FROM sft_feedback sf
        ${joinClause}
        ${timeWhere} AND sf.feedback_type = 'skip'
        ${ownerWhere}
    `).get(...params);
    return row?.count || 0;
}

async function main() {
    const { owner, hours, fromLaunch } = parseArgs();
    const markerPath = fromLaunch ? FORMAL_LAUNCH_MARKER_PATH : MARKER_PATH;
    const absMarker = path.resolve(process.cwd(), markerPath);
    if (!fs.existsSync(absMarker) && !hours) {
        const hint = fromLaunch
            ? `marker not found: ${markerPath}. run npm run metrics:launch:start first, or pass --hours`
            : `marker not found: ${markerPath}. run npm run rag:obs:start first, or pass --hours`;
        throw new Error(hint);
    }

    const marker = fs.existsSync(absMarker)
        ? parseJsonSafe(fs.readFileSync(absMarker, 'utf-8'), {})
        : {};
    const markerStartRaw = marker?.started_at || marker?.launch_at;
    const markerBaseline = marker?.baseline || {};
    const useIdWindow =
        !Number.isFinite(hours) &&
        Number.isFinite(Number(markerBaseline?.generation_log_max_id));

    const nowDate = new Date();
    const startDate = Number.isFinite(hours)
        ? new Date(Date.now() - hours * 60 * 60 * 1000)
        : new Date(markerStartRaw);
    if (!Number.isFinite(startDate.getTime())) {
        throw new Error('invalid observation start time');
    }
    const notStartedYet = startDate.getTime() > nowDate.getTime();
    const endDate = notStartedYet ? startDate : nowDate;

    const startAt = toMysqlDateTime(startDate);
    const endAt = toMysqlDateTime(endDate);
    const minGenerationId = useIdWindow ? Number(markerBaseline?.generation_log_max_id || 0) : null;
    const minSftId = useIdWindow ? Number(markerBaseline?.sft_memory_max_id || 0) : null;
    const minFeedbackId = useIdWindow ? Number(markerBaseline?.sft_feedback_max_id || 0) : null;

    const [generationRows, sftRows, skipCount] = await Promise.all([
        fetchGenerationRows({ startAt, endAt, owner, minId: minGenerationId }),
        fetchSftRows({ startAt, endAt, owner, minId: minSftId }),
        fetchSkipCount({ startAt, endAt, owner, minId: minFeedbackId }),
    ]);

    const generationTotal = generationRows.length;
    const generationSuccess = generationRows.filter((r) => r.status === 'success').length;
    const withSnapshot = generationRows.filter((r) => !!r.retrieval_snapshot_id);
    const ragHitRows = withSnapshot.filter((r) => (r.rag?.hit_count || 0) > 0);
    const avgRagHits = withSnapshot.length
        ? Number((withSnapshot.reduce((sum, row) => sum + (row.rag?.hit_count || 0), 0) / withSnapshot.length).toFixed(2))
        : 0;

    const sftTotal = sftRows.length;
    const rewriteCount = sftRows.filter((r) => r.human_selected === 'custom').length;
    const adoptedCount = sftRows.filter((r) => r.human_selected === 'opt1' || r.human_selected === 'opt2').length;
    const retrievalLinked = sftRows.filter((row) => {
        const ctx = parseJsonSafe(row.context_json, {});
        return !!ctx?.retrieval_snapshot_id;
    }).length;

    const report = {
        window: {
            start_at: startDate.toISOString(),
            end_at: endDate.toISOString(),
            owner: owner || null,
            mode: useIdWindow ? 'marker_id_window' : 'time_window',
            source: fromLaunch ? 'formal_launch' : 'rag_observation',
            not_started_yet: notStartedYet,
        },
        generation: {
            total: generationTotal,
            success_count: generationSuccess,
            success_rate: pct(generationSuccess, generationTotal),
            with_snapshot_count: withSnapshot.length,
            rag_hit_count: ragHitRows.length,
            rag_hit_rate: pct(ragHitRows.length, withSnapshot.length),
            avg_rag_hit_count: avgRagHits,
            top_sources: aggregateTopSources(generationRows),
        },
        sft: {
            total_records: sftTotal,
            rewrite_count: rewriteCount,
            rewrite_rate: pct(rewriteCount, sftTotal),
            adopted_count: adoptedCount,
            adoption_rate: pct(adoptedCount, sftTotal),
            retrieval_linked_count: retrievalLinked,
            retrieval_linked_rate: pct(retrievalLinked, sftTotal),
            skip_count: skipCount,
        },
    };

    const ts = endDate.toISOString().replace(/[:.]/g, '-');
    const reportDir = path.resolve(process.cwd(), REPORT_DIR);
    ensureDir(reportDir);
    const reportPath = path.join(reportDir, `rag-observation-${ts}.json`);
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');

    console.log('[rag-observation] report generated');
    console.log(`- file: ${path.relative(process.cwd(), reportPath)}`);
    console.log(`- window: ${report.window.start_at} -> ${report.window.end_at}`);
    console.log(`- source: ${report.window.source}`);
    if (report.window.not_started_yet) {
        console.log('- note: launch window has not started yet');
    }
    console.log(`- generation total: ${report.generation.total}`);
    console.log(`- rag hit rate: ${report.generation.rag_hit_rate}`);
    console.log(`- rewrite rate: ${report.sft.rewrite_rate}`);
    console.log(`- adoption rate: ${report.sft.adoption_rate}`);
    await db.closeDb();
}

main().catch((err) => {
    console.error('[finish-rag-observation] fatal:', err.message);
    db.closeDb().catch(() => {});
    process.exit(1);
});
