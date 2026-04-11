/**
 * Finetuned Canary Rollout Orchestrator
 *
 * 执行顺序：
 * 1) 运行 ab-takeover-readiness 预检
 * 2) 运行 finetuned-canary-smoke 烟测
 * 3) 输出通过/阻断结论
 *
 * 用法：
 *   node scripts/run-finetuned-canary-rollout.cjs
 *   node scripts/run-finetuned-canary-rollout.cjs --api-base=http://localhost:3001 --requests=10
 */
require('dotenv').config();
const { execFileSync } = require('child_process');

const args = process.argv.slice(2);
const apiBaseArg = args.find((item) => item.startsWith('--api-base='));
const requestsArg = args.find((item) => item.startsWith('--requests='));
const apiBase = apiBaseArg ? apiBaseArg.split('=')[1] : (process.env.CANARY_API_BASE || 'http://localhost:3001');
const requests = Math.max(parseInt(requestsArg ? requestsArg.split('=')[1] : '8', 10) || 8, 1);

function runNode(scriptPath, scriptArgs = [], extraEnv = {}) {
    const text = execFileSync('node', [scriptPath, ...scriptArgs], {
        encoding: 'utf8',
        env: { ...process.env, ...extraEnv },
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    return JSON.parse(text);
}

function main() {
    const proxyToken = process.env.AI_PROXY_TOKEN || process.env.WA_ADMIN_TOKEN || '';
    const blockers = [];
    if (!proxyToken) blockers.push('AI_PROXY_TOKEN (or WA_ADMIN_TOKEN) is missing');
    if (process.env.USE_FINETUNED !***REMOVED*** 'true') blockers.push('USE_FINETUNED is not true');
    if (!String(process.env.FINETUNED_MODEL || '').trim()) blockers.push('FINETUNED_MODEL is not set');

    const readiness = runNode('/Users/depp/wa-bot/wa-crm-v2/scripts/ab-takeover-readiness.cjs');
    if (!readiness.canary_ready) blockers.push(...(readiness.blockers || []));

    let smoke = null;
    if (blockers.length ***REMOVED***= 0) {
        smoke = runNode(
            '/Users/depp/wa-bot/wa-crm-v2/scripts/finetuned-canary-smoke.cjs',
            [`--api-base=${apiBase}`, `--requests=${requests}`],
            {}
        );
        const failedRequests = (smoke.sent || []).filter((item) => !item.ok).length;
        if (failedRequests > 0) blockers.push(`smoke requests failed: ${failedRequests}/${requests}`);
        if (!smoke.finetuned_seen) blockers.push('no finetuned rows observed in generation_log');
    }

    const passed = blockers.length ***REMOVED***= 0;
    const result = {
        timestamp: new Date().toISOString(),
        input: {
            api_base: apiBase,
            requests,
            use_finetuned: process.env.USE_FINETUNED || 'false',
            ab_ratio: process.env.AB_RATIO || '0.1',
            finetuned_base: process.env.FINETUNED_BASE || null,
            finetuned_model: process.env.FINETUNED_MODEL || null,
        },
        readiness,
        smoke,
        passed,
        blockers,
        recommendation: passed
            ? 'Can proceed with canary monitoring window (observe generation_log stats and business KPIs).'
            : 'Fix blockers and rerun this rollout script.',
    };

    console.log(JSON.stringify(result, null, 2));
    process.exit(passed ? 0 : 2);
}

try {
    main();
} catch (err) {
    console.error('[run-finetuned-canary-rollout] fatal:', err.message);
    process.exit(1);
}
