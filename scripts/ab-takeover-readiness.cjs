/**
 * AB 接管预检脚本
 *
 * 检查内容：
 * 1) SFT 训练数据门槛是否满足（approved/custom/scene）
 * 2) 线上 generation_log 稳定性（成功率、延迟）
 * 3) FINETUNED_BASE 可达性（是否能开始灰度）
 *
 * 用法：
 *   node scripts/ab-takeover-readiness.cjs
 */
require('dotenv').config();
const DB = require('../db');
const PING_TIMEOUT_MS = Math.max(parseInt(process.env.FINETUNED_PING_TIMEOUT_MS || '10000', 10) || 10000, 3000);

function parseHost(url) {
    try {
        const u = new URL(url);
        return { hostname: u.hostname, port: u.port || (u.protocol === 'https:' ? 443 : 80), path: u.pathname + u.search };
    } catch (_) {
        return null;
    }
}

function resolveFinetunedBase(baseUrl) {
    const input = String(baseUrl || '').trim();
    if (!input) return '';
    try {
        const url = new URL(input);
        if (url.hostname === 'api.openai.com' && /^\/v1\/?$/.test(url.pathname)) {
            return `${url.origin}/v1/chat/completions`;
        }
        return input;
    } catch (_) {
        return input;
    }
}

function resolveFinetunedModel(baseUrl) {
    const explicit = String(process.env.FINETUNED_MODEL || '').trim();
    if (explicit) return explicit;
    return '';
}

async function pingFinetuned(baseUrl) {
    const resolvedBase = resolveFinetunedBase(baseUrl);
    if (!resolvedBase) return { reachable: false, reason: 'FINETUNED_BASE is empty' };
    const model = resolveFinetunedModel(resolvedBase);
    if (!model) return { reachable: false, reason: 'FINETUNED_MODEL is empty' };
    const host = parseHost(resolvedBase);
    if (!host) return { reachable: false, reason: `invalid FINETUNED_BASE: ${resolvedBase}` };
    try {
        const apiKey = String(process.env.FINETUNED_API_KEY || '').trim();
        const headers = { 'Content-Type': 'application/json' };
        if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
        const probeBody = {
            model,
            messages: [{ role: 'user', content: 'health_check' }],
            max_tokens: 16,
            temperature: 0,
        };
        const res = await fetch(resolvedBase, {
            method: 'POST',
            headers,
            body: JSON.stringify(probeBody),
            signal: AbortSignal.timeout(PING_TIMEOUT_MS),
        });
        const reachable = res.status !== 404 && res.status < 500;
        return {
            reachable,
            status: res.status,
            method: 'POST',
            endpoint: resolvedBase,
            reason: reachable ? null : `HTTP ${res.status}`,
        };
    } catch (err) {
        return { reachable: false, reason: err.message };
    }
}

async function main() {
    const db = DB.getDb();

    const thresholds = { approved: 200, custom: 20, scenes: 3 };
    const approvedRow = await db.prepare("SELECT COUNT(*) c FROM sft_memory WHERE status='approved'").get();
    const customRow = await db.prepare("SELECT COUNT(*) c FROM sft_memory WHERE status='approved' AND human_selected='custom'").get();
    const sceneRow = await db.prepare("SELECT COUNT(DISTINCT scene) c FROM sft_memory WHERE status='approved' AND scene IS NOT NULL").get();

    const approved = Number(approvedRow?.c || 0);
    const custom = Number(customRow?.c || 0);
    const scenes = Number(sceneRow?.c || 0);
    const sftReady = approved >= thresholds.approved && custom >= thresholds.custom && scenes >= thresholds.scenes;

    const statsRow = await db.prepare(`
        SELECT
            COUNT(*) total,
            SUM(CASE WHEN status='success' THEN 1 ELSE 0 END) success_count,
            SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) failed_count,
            ROUND(AVG(CASE WHEN latency_ms IS NOT NULL THEN latency_ms END), 0) avg_latency_ms
        FROM generation_log
        WHERE created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
    `).get();

    const total = Number(statsRow?.total || 0);
    const successCount = Number(statsRow?.success_count || 0);
    const failedCount = Number(statsRow?.failed_count || 0);
    const successRate = total > 0 ? Number(((successCount / total) * 100).toFixed(2)) : 0;

    const byBucket = await db.prepare(`
        SELECT COALESCE(ab_bucket, 'null') ab_bucket, COUNT(*) c
        FROM generation_log
        WHERE created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
        GROUP BY COALESCE(ab_bucket, 'null')
        ORDER BY c DESC
    `).all();

    const finetunedBase = process.env.FINETUNED_BASE || '';
    const finetunedPing = await pingFinetuned(finetunedBase);

    const blockers = [];
    if (!sftReady) blockers.push('SFT training readiness not met');
    if (!String(process.env.FINETUNED_MODEL || '').trim()) blockers.push('FINETUNED_MODEL is not set');
    if (!finetunedPing.reachable) blockers.push(`FINETUNED_BASE unreachable: ${finetunedPing.reason}`);
    if (total === 0) blockers.push('generation_log has no recent traffic');

    const readyForCanary = sftReady && finetunedPing.reachable && total > 0;

    const report = {
        timestamp: new Date().toISOString(),
        env: {
            USE_FINETUNED: process.env.USE_FINETUNED || 'false',
            AB_RATIO: process.env.AB_RATIO || '0.1',
            FINETUNED_BASE: finetunedBase || null,
            FINETUNED_MODEL: process.env.FINETUNED_MODEL || null,
        },
        sft_readiness: {
            ready: sftReady,
            approved,
            custom,
            scenes,
            thresholds,
        },
        generation_30d: {
            total,
            success_count: successCount,
            failed_count: failedCount,
            success_rate_pct: successRate,
            avg_latency_ms: statsRow?.avg_latency_ms || null,
            by_bucket: byBucket,
        },
        finetuned_endpoint: finetunedPing,
        canary_ready: readyForCanary,
        blockers,
        recommendation: readyForCanary
            ? 'Can start finetuned canary with USE_FINETUNED=true and AB_RATIO=0.1'
            : 'Fix blockers first, then rerun this script',
    };

    console.log(JSON.stringify(report, null, 2));
    await DB.closeDb();
}

main().catch(async (err) => {
    console.error('[ab-takeover-readiness] fatal:', err.message);
    await DB.closeDb();
    process.exit(1);
});
