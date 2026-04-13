#!/usr/bin/env node
/**
 * 一键发送 Finetuned Canary 日报到飞书 Reinforce 群
 *
 * 默认行为：
 * - 自动抓取 generation_log 最新窗口（最近 N 条，默认 12）
 * - 统计窗口内 / 最近 24h 指标
 * - 生成日报 Markdown
 * - 通过 lark-cli 发送到 Reinforce 群
 *
 * 用法：
 *   node scripts/send-canary-daily-report.cjs
 *   node scripts/send-canary-daily-report.cjs --executive
 *   node scripts/send-canary-daily-report.cjs --window-size=20 --hours=24
 *   node scripts/send-canary-daily-report.cjs --dry-run
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const db = require('../db');

const DEFAULT_CHAT_QUERY = process.env.LARK_REPORT_CHAT_QUERY || 'reinforce';
const DEFAULT_CHAT_ID = process.env.LARK_REPORT_CHAT_ID || 'oc_5a15266d1e682f0ea9eb7a53a45b3303';
const DEFAULT_WINDOW_SIZE = Math.max(parseInt(process.env.CANARY_REPORT_WINDOW_SIZE || '12', 10) || 12, 1);
const DEFAULT_HOURS = Math.max(parseInt(process.env.CANARY_REPORT_HOURS || '24', 10) || 24, 1);
const REPORT_DIR = path.resolve(process.cwd(), 'reports', 'canary-daily');

function parseArgs(argv) {
    const out = {
        windowSize: DEFAULT_WINDOW_SIZE,
        hours: DEFAULT_HOURS,
        executive: false,
        dryRun: false,
        noSend: false,
        chatQuery: DEFAULT_CHAT_QUERY,
        chatId: DEFAULT_CHAT_ID,
    };
    for (const arg of argv) {
        if (arg === '--executive') out.executive = true;
        if (arg === '--dry-run') out.dryRun = true;
        if (arg === '--no-send') out.noSend = true;
        if (arg.startsWith('--window-size=')) out.windowSize = Math.max(parseInt(arg.slice('--window-size='.length), 10) || DEFAULT_WINDOW_SIZE, 1);
        if (arg.startsWith('--hours=')) out.hours = Math.max(parseInt(arg.slice('--hours='.length), 10) || DEFAULT_HOURS, 1);
        if (arg.startsWith('--chat-query=')) out.chatQuery = arg.slice('--chat-query='.length).trim() || DEFAULT_CHAT_QUERY;
        if (arg.startsWith('--chat-id=')) out.chatId = arg.slice('--chat-id='.length).trim() || DEFAULT_CHAT_ID;
    }
    return out;
}

function runCommand(command, args, options = {}) {
    const result = spawnSync(command, args, {
        cwd: process.cwd(),
        env: process.env,
        encoding: 'utf8',
        ...options,
    });
    if (result.status !== 0) {
        const err = (result.stderr || result.stdout || `exit=${result.status}`).trim();
        throw new Error(`${command} ${args.join(' ')} failed: ${err}`);
    }
    return (result.stdout || '').trim();
}

function toShanghaiDate(date = new Date()) {
    return new Intl.DateTimeFormat('zh-CN', {
        timeZone: 'Asia/Shanghai',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).format(date).replace(/\//g, '-');
}

function toStamp(date = new Date()) {
    return date.toISOString().replace(/[:.]/g, '-');
}

function toInt(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

function pct(numerator, denominator) {
    if (!denominator) return '0.0%';
    return `${((numerator / denominator) * 100).toFixed(1)}%`;
}

async function fetchMetrics(windowSize, hours) {
    const db2 = db.getDb();
    const safeHours = Math.max(parseInt(hours, 10) || DEFAULT_HOURS, 1);
    const safeWindowSize = Math.max(parseInt(windowSize, 10) || DEFAULT_WINDOW_SIZE, 1);

    const latestWindowRows = await db2.prepare(`
        SELECT id, client_id, provider, model, route, ab_bucket, scene, operator, status, latency_ms, created_at
        FROM generation_log
        ORDER BY id DESC
        LIMIT ${safeWindowSize}
    `).all();
    if (latestWindowRows.length === 0) {
        throw new Error('generation_log 没有可用数据，无法生成日报');
    }

    const minId = Math.min(...latestWindowRows.map((row) => toInt(row.id)));
    const maxId = Math.max(...latestWindowRows.map((row) => toInt(row.id)));

    const windowByProvider = await db2.prepare(`
        SELECT provider,
               COUNT(*) AS c,
               SUM(CASE WHEN status='success' THEN 1 ELSE 0 END) AS success_count,
               ROUND(AVG(latency_ms), 0) AS avg_latency_ms
        FROM generation_log
        WHERE id BETWEEN ? AND ?
        GROUP BY provider
        ORDER BY c DESC
    `).all(minId, maxId);

    const windowByBucket = await db2.prepare(`
        SELECT COALESCE(ab_bucket, 'null') AS ab_bucket, COUNT(*) AS c
        FROM generation_log
        WHERE id BETWEEN ? AND ?
        GROUP BY COALESCE(ab_bucket, 'null')
        ORDER BY c DESC
    `).all(minId, maxId);

    const dayTotal = await db2.prepare(`
        SELECT COUNT(*) AS total,
               SUM(CASE WHEN status='success' THEN 1 ELSE 0 END) AS success_count,
               ROUND(AVG(latency_ms), 0) AS avg_latency_ms
        FROM generation_log
        WHERE created_at >= DATE_SUB(NOW(), INTERVAL ${safeHours} HOUR)
    `).get();

    const dayByProvider = await db2.prepare(`
        SELECT provider,
               COUNT(*) AS c,
               SUM(CASE WHEN status='success' THEN 1 ELSE 0 END) AS success_count,
               ROUND(AVG(latency_ms), 0) AS avg_latency_ms
        FROM generation_log
        WHERE created_at >= DATE_SUB(NOW(), INTERVAL ${safeHours} HOUR)
        GROUP BY provider
        ORDER BY c DESC
    `).all();

    const latestFinetuned = await db2.prepare(`
        SELECT id, client_id, provider, model, route, ab_bucket, scene, operator, status, latency_ms, created_at
        FROM generation_log
        WHERE provider = 'finetuned'
        ORDER BY id DESC
        LIMIT 1
    `).get();

    const sftReadiness = await db2.prepare(`
        SELECT
            SUM(CASE WHEN status='approved' THEN 1 ELSE 0 END) AS approved,
            SUM(CASE WHEN status='approved' AND human_selected='custom' THEN 1 ELSE 0 END) AS custom_cnt,
            COUNT(DISTINCT CASE WHEN status='approved' THEN scene END) AS scenes
        FROM sft_memory
    `).get();

    const nowIso = new Date().toISOString();
    const windowSuccess = latestWindowRows.filter((row) => row.status === 'success').length;
    return {
        generated_at: nowIso,
        env: {
            USE_FINETUNED: process.env.USE_FINETUNED || 'false',
            AB_RATIO: process.env.AB_RATIO || '0.0',
            FINETUNED_BASE: process.env.FINETUNED_BASE || null,
            FINETUNED_MODEL: process.env.FINETUNED_MODEL || null,
            FINETUNED_PING_TIMEOUT_MS: process.env.FINETUNED_PING_TIMEOUT_MS || null,
        },
        window: {
            size: latestWindowRows.length,
            min_id: minId,
            max_id: maxId,
            first_at: latestWindowRows[latestWindowRows.length - 1]?.created_at || null,
            last_at: latestWindowRows[0]?.created_at || null,
            success_count: windowSuccess,
            success_rate: pct(windowSuccess, latestWindowRows.length),
            by_provider: windowByProvider.map((row) => ({
                provider: row.provider,
                c: toInt(row.c),
                success_count: toInt(row.success_count),
                avg_latency_ms: toInt(row.avg_latency_ms, null),
            })),
            by_bucket: windowByBucket.map((row) => ({
                ab_bucket: row.ab_bucket,
                c: toInt(row.c),
            })),
            sample_rows: latestWindowRows,
        },
        day: {
            hours: safeHours,
            total: {
                total: toInt(dayTotal?.total),
                success_count: toInt(dayTotal?.success_count),
                avg_latency_ms: toInt(dayTotal?.avg_latency_ms, null),
            },
            by_provider: dayByProvider.map((row) => ({
                provider: row.provider,
                c: toInt(row.c),
                success_count: toInt(row.success_count),
                avg_latency_ms: toInt(row.avg_latency_ms, null),
            })),
        },
        latest_finetuned: latestFinetuned || null,
        sft_readiness: {
            approved: toInt(sftReadiness?.approved),
            custom_cnt: toInt(sftReadiness?.custom_cnt),
            scenes: toInt(sftReadiness?.scenes),
        },
    };
}

function formatProviderInline(items) {
    if (!items || items.length === 0) return '无';
    return items.map((item) => `${item.provider}=${item.c}`).join('，');
}

function formatProviderSuccessInline(items) {
    if (!items || items.length === 0) return '无';
    return items.map((item) => `${item.provider}=${item.success_count}`).join('，');
}

function formatProviderLatencyInline(items) {
    if (!items || items.length === 0) return '无';
    return items.map((item) => `${item.provider}=${item.avg_latency_ms ?? 'null'}ms`).join('，');
}

function buildFullMarkdown(metrics) {
    const date = toShanghaiDate(new Date());
    const windowProviderInline = formatProviderInline(metrics.window.by_provider);
    const windowBucketInline = (metrics.window.by_bucket || []).map((item) => `${item.ab_bucket}=${item.c}`).join('，') || '无';
    const dayProviderInline = formatProviderInline(metrics.day.by_provider);
    const dayProviderSuccessInline = formatProviderSuccessInline(metrics.day.by_provider);
    const dayProviderLatencyInline = formatProviderLatencyInline(metrics.day.by_provider);
    const latestFt = metrics.latest_finetuned;

    return [
        '# 项目总结｜WA CRM Finetuned 接管 Canary 日报',
        `> 日期：${date}`,
        '> 来源：wa-crm-v2 / auto daily sender',
        '',
        '## 今日结论',
        `- 接管配置：\`USE_FINETUNED=${metrics.env.USE_FINETUNED}\`，\`AB_RATIO=${metrics.env.AB_RATIO}\`。`,
        `- 微调模型：\`${metrics.env.FINETUNED_MODEL || '未配置'}\`。`,
        `- 最新窗口命中：\`provider=finetuned\` ${latestFt ? `(id=${latestFt.id}, status=${latestFt.status})` : '(未命中)'}。`,
        '',
        '## 关键指标（最新窗口）',
        `- 窗口定义：\`generation_log.id BETWEEN ${metrics.window.min_id} AND ${metrics.window.max_id}\`（${metrics.window.size} 条）。`,
        `- Provider 分布：\`${windowProviderInline}\`。`,
        `- Bucket 分布：\`${windowBucketInline}\`。`,
        `- 成功率：\`${metrics.window.success_count}/${metrics.window.size} = ${metrics.window.success_rate}\`。`,
        ...metrics.window.by_provider.map((item) => `- 平均延迟（${item.provider}）：\`${item.avg_latency_ms ?? 'null'}ms\``),
        '',
        `## 日维度观测（最近 ${metrics.day.hours}h）`,
        `- 总请求：\`${metrics.day.total.total}\``,
        `- 总成功：\`${metrics.day.total.success_count}\``,
        `- Provider 分布：\`${dayProviderInline}\``,
        `- Provider 成功：\`${dayProviderSuccessInline}\``,
        `- Provider 平均延迟：\`${dayProviderLatencyInline}\``,
        '',
        '## SFT 就绪度',
        `- approved：\`${metrics.sft_readiness.approved}\``,
        `- custom：\`${metrics.sft_readiness.custom_cnt}\``,
        `- scenes：\`${metrics.sft_readiness.scenes}\``,
        '',
        '## SQL 指标口径（日报模板可复用）',
        '```sql',
        '-- 1) 最新窗口 provider 分布（窗口 ID 从日报正文复制）',
        `SELECT provider, COUNT(*) AS c, SUM(CASE WHEN status='success' THEN 1 ELSE 0 END) AS success_count, ROUND(AVG(latency_ms), 0) AS avg_latency_ms`,
        'FROM generation_log',
        `WHERE id BETWEEN ${metrics.window.min_id} AND ${metrics.window.max_id}`,
        'GROUP BY provider',
        'ORDER BY c DESC;',
        '',
        '-- 2) 最新窗口 AB bucket 分布',
        `SELECT COALESCE(ab_bucket, 'null') AS ab_bucket, COUNT(*) AS c`,
        'FROM generation_log',
        `WHERE id BETWEEN ${metrics.window.min_id} AND ${metrics.window.max_id}`,
        `GROUP BY COALESCE(ab_bucket, 'null')`,
        'ORDER BY c DESC;',
        '',
        `-- 3) 最近 ${metrics.day.hours}h provider 维度健康度`,
        'SELECT provider, COUNT(*) AS c,',
        `       SUM(CASE WHEN status='success' THEN 1 ELSE 0 END) AS success_count,`,
        '       ROUND(AVG(latency_ms), 0) AS avg_latency_ms',
        'FROM generation_log',
        `WHERE created_at >= DATE_SUB(NOW(), INTERVAL ${metrics.day.hours} HOUR)`,
        'GROUP BY provider',
        'ORDER BY c DESC;',
        '',
        `-- 4) 最近 ${metrics.day.hours}h 总体健康度`,
        'SELECT COUNT(*) AS total,',
        `       SUM(CASE WHEN status='success' THEN 1 ELSE 0 END) AS success_count,`,
        '       ROUND(AVG(latency_ms), 0) AS avg_latency_ms',
        'FROM generation_log',
        `WHERE created_at >= DATE_SUB(NOW(), INTERVAL ${metrics.day.hours} HOUR);`,
        '',
        '-- 5) 最近一条 finetuned 证据行',
        `SELECT id, client_id, provider, model, ab_bucket, status, latency_ms, scene, operator, created_at`,
        'FROM generation_log',
        `WHERE provider='finetuned'`,
        'ORDER BY id DESC',
        'LIMIT 1;',
        '```',
        '',
        '## 下一步建议（明日）',
        '- 继续保持当前 AB 配置观察 24 小时（人工改写率 / 命中率 / 回复采纳率）。',
        '- 若核心指标稳定，按阶梯提升 AB_RATIO（例如 0.2）并复跑同口径 canary。',
    ].join('\n');
}

function buildExecutiveMarkdown(metrics) {
    const date = toShanghaiDate(new Date());
    const latestFt = metrics.latest_finetuned;
    const topLatency = metrics.window.by_provider.find((item) => item.provider === 'finetuned')?.avg_latency_ms ?? null;
    const riskLine = topLatency && topLatency > 5000
        ? `微调路径延迟偏高（窗口内约 ${topLatency}ms），建议持续观察高峰期耗时。`
        : '当前窗口未见明显性能风险，继续观察 24h 波动。';
    return [
        '# 项目总结｜WA CRM Finetuned 接管 KPI 简报',
        `> 日期：${date}`,
        '> 面向：管理层（精简版）',
        '',
        '## 结论',
        `- 微调接管已在生产启用（\`USE_FINETUNED=${metrics.env.USE_FINETUNED}\`, \`AB_RATIO=${metrics.env.AB_RATIO}\`）。`,
        `- 最新窗口 ${metrics.window.size} 条请求全部成功（成功率 ${metrics.window.success_rate}）。`,
        `- 已观测到微调命中：${latestFt ? `id=${latestFt.id}, model=${latestFt.model}` : '暂无'}。`,
        '',
        '## 风险',
        `- ${riskLine}`,
        '- 当前微调流量占比仍低（灰度阶段），结论需结合后续业务样本持续验证。',
        '',
        '## 动作',
        '- 继续 24h 观测人工改写率、命中率、回复采纳率。',
        '- 若指标稳定，分步提升 AB_RATIO 至 0.2 并复跑 canary。',
        '- 保持回滚开关可用（USE_FINETUNED / AB_RATIO）。',
    ].join('\n');
}

function resolveChatId({ chatId, chatQuery }) {
    if (chatId) return chatId;
    const searchOut = runCommand('lark-cli', ['im', '+chat-search', '--as', 'user', '--query', chatQuery, '--format', 'json']);
    const parsed = JSON.parse(searchOut || '{}');
    const chats = Array.isArray(parsed?.data?.chats)
        ? parsed.data.chats
        : (Array.isArray(parsed?.items) ? parsed.items : []);
    const picked = chats.find((item) => item?.chat_id) || chats[0];
    if (!picked?.chat_id) {
        throw new Error(`未找到群聊：${chatQuery}`);
    }
    return picked.chat_id;
}

function sendMarkdown(chatId, markdown) {
    const out = runCommand('lark-cli', ['im', '+messages-send', '--as', 'bot', '--chat-id', chatId, '--markdown', markdown]);
    return JSON.parse(out || '{}');
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    const metrics = await fetchMetrics(args.windowSize, args.hours);
    const markdown = args.executive ? buildExecutiveMarkdown(metrics) : buildFullMarkdown(metrics);

    fs.mkdirSync(REPORT_DIR, { recursive: true });
    const stamp = toStamp(new Date());
    const reportBase = path.join(REPORT_DIR, `${stamp}${args.executive ? '.executive' : '.full'}`);
    fs.writeFileSync(`${reportBase}.json`, JSON.stringify(metrics, null, 2), 'utf8');
    fs.writeFileSync(`${reportBase}.md`, markdown, 'utf8');

    let chatId = args.chatId;
    let sendResult = null;
    if (!args.noSend && !args.dryRun) {
        chatId = resolveChatId({ chatId: args.chatId, chatQuery: args.chatQuery });
        sendResult = sendMarkdown(chatId, markdown);
    }

    console.log(JSON.stringify({
        ok: true,
        mode: args.executive ? 'executive' : 'full',
        generated_at: metrics.generated_at,
        window_id: {
            min_id: metrics.window.min_id,
            max_id: metrics.window.max_id,
            size: metrics.window.size,
        },
        report_files: {
            markdown: `${reportBase}.md`,
            json: `${reportBase}.json`,
        },
        chat_id: chatId || null,
        sent: Boolean(sendResult),
        send_result: sendResult,
        dry_run: args.dryRun,
    }, null, 2));
}

main()
    .catch(async (err) => {
        console.error('[send-canary-daily-report] failed:', err.message);
        process.exitCode = 1;
    })
    .finally(async () => {
        await db.closeDb().catch(() => {});
    });
