/**
 * waMetrics — WhatsApp dual-driver observability
 *
 * Records driver-level metrics for Prometheus scraping and log analysis.
 * All metrics are in-process counters/gauges — no external dep.
 *
 * 日志格式: {"wa_metric":true,"type":"...","driver":"...","session_id":"...","value":...,"ts":...}
 * 配合 pm2 logrotate 和 jq 聚合分析。
 *
 * HTTP 暴露: GET /metrics/wa (line-format Prometheus)
 */
'use strict';

// ---- Metric Registry ----

const gauges = new Map();   // name → { session_id, driver } → value
const counters = new Map(); // name → { session_id, driver, label } → value
const histograms = new Map(); // name → { driver } → { count, sum, buckets }

function labelKey(labels) {
    return Object.keys(labels).sort().map(k => `${k}=${labels[k]}`).join(',');
}

// ---- Gauges ----

function gaugeSet(name, labels, value) {
    if (!gauges.has(name)) gauges.set(name, new Map());
    gauges.get(name).set(labelKey(labels), value);
}

function gaugeIncr(name, labels, delta = 1) {
    const cur = parseFloat((gauges.get(name)?.get(labelKey(labels))) || 0);
    gaugeSet(name, labels, cur + delta);
}

// ---- Counters ----

function counterIncr(name, labels) {
    if (!counters.has(name)) counters.set(name, new Map());
    const m = counters.get(name);
    const k = labelKey(labels);
    m.set(k, (m.get(k) || 0) + 1);
}

// ---- Histograms ----

const BUCKETS = [100, 250, 500, 1000, 2500, 5000, 10000];

function histogramObserve(name, labels, value) {
    if (!histograms.has(name)) histograms.set(name, new Map());
    const m = histograms.get(name);
    const k = labelKey(labels);
    if (!m.has(k)) m.set(k, { count: 0, sum: 0, buckets: Object.fromEntries(BUCKETS.map(b => [b, 0])) });
    const h = m.get(k);
    h.count++;
    h.sum += value;
    // bucket
    for (const b of BUCKETS) { if (value <= b) h.buckets[b]++; }
}

// ---- Logging ----

const WA_METRIC_ENABLED = String(process.env.WA_METRICS_ENABLED || 'true').toLowerCase() === 'true';

function waLog(event, labels, extra = {}) {
    if (!WA_METRIC_ENABLED) return;
    const entry = {
        wa_metric: true,
        event,
        ts: Date.now(),
        ...labels,
        ...extra,
    };
    try { process.stdout.write(JSON.stringify(entry) + '\n'); } catch (_) {}
}

// ---- Public API ----

/**
 * @param {'wwebjs'|'baileys'} driver
 * @param {string} sessionId
 * @param {'disconnected'|'connecting'|'ready'} status
 */
function recordDriverStatus(driver, sessionId, status) {
    const numStatus = { disconnected: 0, connecting: 1, ready: 2 }[status] ?? 0;
    gaugeSet('wa_driver_status', { driver, session_id: sessionId }, numStatus);
    waLog('driver_status', { driver, session_id: sessionId }, { status, value: numStatus });
}

function recordMessageReceived(sessionId, driver, isGroup = false) {
    counterIncr('wa_messages_received_total', { driver, session_id: sessionId, is_group: String(isGroup) });
    waLog('message_received', { driver, session_id: sessionId }, { is_group: isGroup });
}

function recordMessageSent(sessionId, driver, result = 'success') {
    counterIncr('wa_messages_sent_total', { driver, session_id: sessionId, result });
    waLog('message_sent', { driver, session_id: sessionId }, { result });
}

function recordSendLatency(driver, latencyMs) {
    histogramObserve('wa_send_latency_ms', { driver }, latencyMs);
    waLog('send_latency', { driver }, { latency_ms: latencyMs });
}

function recordDisconnect(sessionId, driver, reason = '') {
    counterIncr('wa_disconnect_total', { driver, session_id: sessionId, reason });
    waLog('driver_disconnect', { driver, session_id: sessionId }, { reason });
}

function recordMediaIngest(sessionId, driver, category = 'unknown', result = 'success') {
    counterIncr('wa_media_ingest_total', { driver, session_id: sessionId, category, result });
    waLog('media_ingest', { driver, session_id: sessionId }, { category, result });
}

// ---- Prometheus exposition format ----

function prometheusText() {
    const lines = [];
    for (const [name, m] of gauges) {
        for (const [labels, value] of m) {
            lines.push(`# HELP ${name} ${name}`);
            lines.push(`# TYPE ${name} gauge`);
            lines.push(`${name}{${labels}} ${value}`);
        }
    }
    for (const [name, m] of counters) {
        for (const [labels, value] of m) {
            lines.push(`# HELP ${name} ${name}`);
            lines.push(`# TYPE ${name} counter`);
            lines.push(`${name}{${labels}} ${value}`);
        }
    }
    for (const [name, m] of histograms) {
        for (const [labels, h] of m) {
            lines.push(`# HELP ${name} ${name}`);
            lines.push(`# TYPE ${name} histogram`);
            for (const [bucket, count] of Object.entries(h.buckets)) {
                lines.push(`${name}_bucket{${labels},le="${bucket}"} ${count}`);
            }
            lines.push(`${name}_bucket{${labels},le="+Inf"} ${h.count}`);
            lines.push(`${name}_sum{${labels}} ${h.sum}`);
            lines.push(`${name}_count{${labels}} ${h.count}`);
        }
    }
    return lines.join('\n');
}

module.exports = {
    recordDriverStatus,
    recordMessageReceived,
    recordMessageSent,
    recordSendLatency,
    recordDisconnect,
    recordMediaIngest,
    prometheusText,
};