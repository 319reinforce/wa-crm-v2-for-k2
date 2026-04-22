#!/usr/bin/env node
/**
 * Driver compare report — compares wwebjs vs baileys metrics over last N days.
 *
 * Reads JSON Lines from stdin or from pm2 logs:
 *   node scripts/driver-compare-report.mjs --days 7 < /path/to/pm2/logs/xxx.log
 *   node scripts/driver-compare-report.mjs --days 7 --file /path/to/log
 *
 * Outputs a comparison table.
 */
'use strict';
const fs = require('fs');
const readline = require('readline');

const DEFAULT_DAYS = parseInt(process.argv.includes('--days=7') ? 7
    : (process.argv.find(a => a.startsWith('--days=')) || '').replace('--days=', '') || 7, 10);
const LOG_FILE = process.argv.find(a => a.startsWith('--file='))?.replace('--file=', '');

const cutoff = Date.now() - DEFAULT_DAYS * 24 * 3600 * 1000;

const stats = { wwebjs: null, baileys: null };

function emptyStats() {
    return {
        messages_received: 0,
        messages_sent_success: 0,
        messages_sent_fail: 0,
        disconnects: {},
        send_latencies: [],
    };
}

function pct(arr, p) {
    if (!arr.length) return 0;
    const sorted = [...arr].sort((a, b) => a - b);
    const idx = Math.floor((p / 100) * sorted.length);
    return sorted[Math.min(idx, sorted.length - 1)];
}

async function readLines() {
    const rl = readline.createInterface({
        input: LOG_FILE ? fs.createReadStream(LOG_FILE) : process.stdin,
        output: process.stdout,
        terminal: false,
    });
    for await (const line of rl) {
        try {
            const entry = JSON.parse(line);
            if (entry.wa_metric && entry.ts >= cutoff) {
                const d = entry.driver;
                if (!stats.wwebjs && d === 'wwebjs') stats.wwebjs = emptyStats();
                if (!stats.baileys && d === 'baileys') stats.baileys = emptyStats();

                const s = entry.driver === 'wwebjs' ? stats.wwebjs : stats.baileys;
                if (!s) continue;

                if (entry.event === 'message_received') s.messages_received++;
                if (entry.event === 'message_sent' && entry.result === 'success') s.messages_sent_success++;
                if (entry.event === 'message_sent' && entry.result === 'fail') s.messages_sent_fail++;
                if (entry.event === 'driver_disconnect') {
                    s.disconnects[entry.reason || 'unknown'] = (s.disconnects[entry.reason || 'unknown'] || 0) + 1;
                }
                if (entry.event === 'send_latency' && entry.latency_ms) s.send_latencies.push(entry.latency_ms);
            }
        } catch (_) {}
    }
}

async function main() {
    await readLines();

    const w = stats.wwebjs || emptyStats();
    const b = stats.baileys || emptyStats();

    const totalSent = (s) => s.messages_sent_success + s.messages_sent_fail;
    const failRate = (s) => totalSent(s) > 0 ? (s.messages_sent_fail / totalSent(s) * 100).toFixed(1) + '%' : 'N/A';
    const p50 = (s) => s.send_latencies.length ? pct(s.send_latencies, 50) + 'ms' : 'N/A';
    const p95 = (s) => s.send_latencies.length ? pct(s.send_latencies, 95) + 'ms' : 'N/A';
    const disconnectCount = (s) => Object.values(s.disconnects).reduce((a, b) => a + b, 0);

    console.log('=== WhatsApp Driver Compare Report ===');
    console.log(`Period: last ${DEFAULT_DAYS} days (cutoff: ${new Date(cutoff).toISOString()})`);
    console.log('');
    console.log(`| Metric               | wwebjs         | baileys        |`);
    console.log(`|----------------------|----------------|----------------|`);
    console.log(`| Messages received    | ${String(w.messages_received).padEnd(14)} | ${String(b.messages_received).padEnd(14)} |`);
    console.log(`| Sent success          | ${String(w.messages_sent_success).padEnd(14)} | ${String(b.messages_sent_success).padEnd(14)} |`);
    console.log(`| Sent fail             | ${String(w.messages_sent_fail).padEnd(14)} | ${String(b.messages_sent_fail).padEnd(14)} |`);
    console.log(`| Fail rate             | ${failRate(w).padEnd(14)} | ${failRate(b).padEnd(14)} |`);
    console.log(`| Send latency p50      | ${p50(w).padEnd(14)} | ${p50(b).padEnd(14)} |`);
    console.log(`| Send latency p95      | ${p95(w).padEnd(14)} | ${p95(b).padEnd(14)} |`);
    console.log(`| Total disconnects     | ${String(disconnectCount(w)).padEnd(14)} | ${String(disconnectCount(b)).padEnd(14)} |`);

    if (Object.keys(w.disconnects).length) {
        console.log('');
        console.log('** wwebjs disconnect reasons:', JSON.stringify(w.disconnects));
    }
    if (Object.keys(b.disconnects).length) {
        console.log('');
        console.log('** baileys disconnect reasons:', JSON.stringify(b.disconnects));
    }
}

main().catch(console.error);