/**
 * Finetuned Canary Smoke Test
 *
 * 前置条件：
 * - 目标后端进程已启动（建议 USE_FINETUNED=true）
 * - FINETUNED_BASE 可达
 *
 * 用法：
 *   node scripts/finetuned-canary-smoke.cjs
 *   node scripts/finetuned-canary-smoke.cjs --api-base=http://localhost:3001 --requests=5
 */
require('dotenv').config();
const DB = require('../db');

const args = process.argv.slice(2);
const apiBaseArg = args.find((item) => item.startsWith('--api-base='));
const requestsArg = args.find((item) => item.startsWith('--requests='));
const apiBase = apiBaseArg ? apiBaseArg.split('=')[1] : (process.env.CANARY_API_BASE || 'http://localhost:3001');
const requestCount = Math.max(parseInt(requestsArg ? requestsArg.split('=')[1] : '3', 10) || 3, 1);

const REQUEST_TIMEOUT_MS = Math.max(
    parseInt(process.env.FINETUNED_CANARY_TIMEOUT_MS || '15000', 10) || 15000,
    3000
);

async function postJson(url, payload) {
    const proxyToken = process.env.AI_PROXY_TOKEN || process.env.WA_ADMIN_TOKEN || '';
    const headers = { 'Content-Type': 'application/json' };
    if (proxyToken) headers.authorization = `Bearer ${proxyToken}`;
    const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const text = await res.text();
    let body = text;
    try { body = JSON.parse(text); } catch (_) {}
    return { ok: res.ok, status: res.status, body };
}

async function main() {
    const db = DB.getDb();
    const before = await db.prepare('SELECT COALESCE(MAX(id), 0) max_id FROM generation_log').get();
    const beforeId = Number(before?.max_id || 0);

    const creators = await db.prepare(`
        SELECT wa_phone, wa_owner
        FROM creators
        WHERE wa_phone IS NOT NULL AND wa_phone != ''
        ORDER BY id DESC
        LIMIT ${Math.max(requestCount, 3)}
    `).all();
    if (!creators.length) {
        throw new Error('no creators with wa_phone found');
    }

    const sends = [];
    for (let i = 0; i < requestCount; i++) {
        const c = creators[i % creators.length];
        const payload = {
            messages: [{ role: 'user', content: `canary smoke ${Date.now()} #${i + 1}` }],
            model: process.env.OPENAI_MODEL || 'gpt-4o',
            max_tokens: 120,
            temperature: 0.4,
            client_id: c.wa_phone,
            scene: i % 2 === 0 ? 'follow_up' : 'content_request',
            operator: c.wa_owner || 'Beau',
            prompt_version: 'v2',
        };
        const res = await postJson(`${apiBase}/api/minimax`, payload);
        sends.push({
            index: i + 1,
            client_id: c.wa_phone,
            operator: c.wa_owner,
            status: res.status,
            ok: res.ok,
            model: res.body?.model || null,
            error: res.ok ? null : (res.body?.error || String(res.body)),
        });
    }

    const rows = await db.prepare(`
        SELECT id, client_id, provider, model, route, ab_bucket, scene, operator, latency_ms, status, created_at
        FROM generation_log
        WHERE id > ?
        ORDER BY id ASC
    `).all(beforeId);

    const byBucket = {};
    const byProvider = {};
    rows.forEach((r) => {
        const b = r.ab_bucket || 'null';
        byBucket[b] = (byBucket[b] || 0) + 1;
        const p = r.provider || 'unknown';
        byProvider[p] = (byProvider[p] || 0) + 1;
    });

    const report = {
        api_base: apiBase,
        request_count: requestCount,
        sent: sends,
        new_generation_rows: rows.length,
        by_bucket: byBucket,
        by_provider: byProvider,
        finetuned_seen: Boolean((byBucket.finetuned || 0) > 0),
        sample_rows: rows.slice(-6),
    };

    console.log(JSON.stringify(report, null, 2));
    await DB.closeDb();
}

main().catch(async (err) => {
    console.error('[finetuned-canary-smoke] fatal:', err.message);
    await DB.closeDb();
    process.exit(1);
});
