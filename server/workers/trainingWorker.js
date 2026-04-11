/**
 * Training Worker — 每月 SFT 训练触发器
 *
 * 两种触发方式：
 * 1. HTTP 触发（外部 cron）：POST /api/training/trigger
 * 2. 独立进程：node server/workers/trainingWorker.js
 *
 * 流程：
 * 1. 导出本月 approved 数据 → /tmp/sft-export-{YYYY-MM}.jsonl
 * 2. 记录训练元数据 → training_log 表
 * 3. 发送飞书通知（deepskill）
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

const DB = require('../../db');

// ***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED*** 配置 ***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED***
const EXPORT_LIMIT = parseInt(process.env.TRAINING_EXPORT_LIMIT || '5000');
const SERVER_HOST = process.env.SERVER_HOST || 'http://localhost:3000';
const DEEPSKILL_CHAT_ID = 'oc_5a15266d1e682f0ea9eb7a53a45b3303';
const DRY_RUN = process.env.TRAINING_DRY_RUN ***REMOVED***= 'true';
const INTERNAL_API_TOKEN = (
    process.env.API_AUTH_TOKEN ||
    process.env.AI_PROXY_TOKEN ||
    process.env.WA_ADMIN_TOKEN ||
    ''
).trim();
const INTERNAL_API_TIMEOUT_MS = Math.max(parseInt(process.env.TRAINING_API_TIMEOUT_MS || '30000', 10) || 30000, 3000);

// ***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED*** HTTP 辅助 ***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED***
function apiRequest(method, pathWithQuery, body) {
    return new Promise((resolve, reject) => {
        const url = new URL(pathWithQuery, SERVER_HOST);
        const headers = { 'Content-Type': 'application/json' };
        if (INTERNAL_API_TOKEN) {
            headers.Authorization = `Bearer ${INTERNAL_API_TOKEN}`;
        }
        const options = {
            hostname: url.hostname,
            port: url.port || (url.protocol ***REMOVED***= 'https:' ? 443 : 3000),
            path: `${url.pathname}${url.search}`,
            method,
            headers,
        };
        const req = (url.protocol ***REMOVED***= 'https:' ? https : http).request(options, (res) => {
            let data = '';
            res.on('data', d => data += d);
            res.on('end', () => {
                const contentType = String(res.headers['content-type'] || '').toLowerCase();
                if (contentType.includes('application/json')) {
                    try {
                        resolve({ status: res.statusCode, data: JSON.parse(data), raw: data });
                        return;
                    } catch (_) {}
                }
                try {
                    resolve({ status: res.statusCode, data: JSON.parse(data), raw: data });
                } catch (_) {
                    resolve({ status: res.statusCode, data, raw: data });
                }
            });
        });
        req.setTimeout(INTERNAL_API_TIMEOUT_MS, () => {
            req.destroy(new Error(`request timeout after ${INTERNAL_API_TIMEOUT_MS}ms`));
        });
        req.on('error', reject);
        if (body) req.write(JSON.stringify(body));
        req.end();
    });
}

// ***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED*** 飞书通知 ***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED***
async function notify(message) {
    try {
        const token = process.env.LARK_BOT_TOKEN;
        if (!token) {
            console.log('[Notify] No LARK_BOT_TOKEN, skipping:', message.slice(0, 80));
            return;
        }
        const body = {
            receive_id: DEEPSKILL_CHAT_ID,
            msg_type: 'text',
            content: JSON.stringify({ text: message }),
        };
        await fetch('https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=chat_id', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`,
            },
            body: JSON.stringify(body),
        });
    } catch (e) {
        console.error('[Notify] error:', e.message);
    }
}

// ***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED*** 导出 SFT 数据 ***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED***
async function exportSFTData(monthLabel) {
    const exportPath = `/tmp/sft-export-${monthLabel}.jsonl`;
    const countPath = `/tmp/sft-export-${monthLabel}.count`;

    console.log(`[Training] 导出 SFT 数据到 ${exportPath}...`);

    const res = await apiRequest('GET', `/api/sft-export?format=jsonl&status=approved&limit=${EXPORT_LIMIT}&month=${monthLabel}`, null);
    if (res.status !***REMOVED*** 200) {
        const detail = typeof res.data ***REMOVED***= 'string'
            ? res.data.slice(0, 240)
            : JSON.stringify(res.data || {}).slice(0, 240);
        throw new Error(`导出失败: HTTP ${res.status}; ${detail}`);
    }

    const records = typeof res.data ***REMOVED***= 'string'
        ? res.data.trim().split('\n').filter(Boolean).map(l => JSON.parse(l))
        : (Array.isArray(res.data) ? res.data : []);

    const count = records.length;
    console.log(`[Training] 导出 ${count} 条 approved 记录`);

    if (count ***REMOVED***= 0) {
        console.warn('[Training] 没有可导出的数据');
        return { count: 0, path: null };
    }

    const jsonl = records.map(r => JSON.stringify(r)).join('\n');
    fs.writeFileSync(exportPath, jsonl, 'utf8');
    fs.writeFileSync(countPath, String(count), 'utf8');
    console.log(`[Training] 已写入 ${exportPath}（${count} 条）`);

    return { count, path: exportPath, recordCount: count };
}

async function ensureTrainingLogTable() {
    const db2 = DB.getDb();
    await db2.prepare(`
        CREATE TABLE IF NOT EXISTS training_log (
            id INTEGER PRIMARY KEY AUTO_INCREMENT,
            month_label VARCHAR(16) NOT NULL,
            record_count INT NOT NULL,
            export_path VARCHAR(256),
            status VARCHAR(16) NOT NULL,
            detail TEXT,
            triggered_by VARCHAR(32) DEFAULT 'manual',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `).run();
}

// ***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED*** 记录训练元数据 ***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED***
async function logTrainingRun({ monthLabel, recordCount, exportPath, status, detail, triggeredBy }) {
    try {
        const db2 = DB.getDb();
        await ensureTrainingLogTable();

        await db2.prepare(`
            INSERT INTO training_log (month_label, record_count, export_path, status, detail, triggered_by)
            VALUES (?, ?, ?, ?, ?, ?)
        `).run(
            monthLabel,
            recordCount,
            exportPath || '',
            status,
            detail || '',
            DRY_RUN ? 'dry_run' : (triggeredBy || 'manual')
        );
        console.log('[Training] 训练记录已写入 training_log 表');
    } catch (e) {
        console.error('[Training] 写 training_log 失败:', e.message);
    }
}

// ***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED*** 核心流程 ***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED***
async function runTraining(triggeredBy = 'manual') {
    const now = new Date();
    const monthLabel = now.toISOString().slice(0, 7); // e.g. "2026-04"
    const timeStr = now.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });

    console.log('═'.repeat(60));
    console.log(`  SFT 训练触发器 | ${timeStr} | 触发源: ${triggeredBy}`);
    console.log('═'.repeat(60));

    if (DRY_RUN) {
        console.log('[Training] ⚠️ DRY_RUN=true，不执行实际训练');
    }

    let status = 'success';
    let detail = '';
    let exportPath = null;
    let recordCount = 0;

    try {
        // 1. 导出数据
        const exportResult = await exportSFTData(monthLabel);
        recordCount = exportResult.count;
        exportPath = exportResult.path;

        if (recordCount ***REMOVED***= 0) {
            detail = '无 approved 数据，跳过训练';
            status = 'skipped';
            console.warn(`[Training] ${detail}`);
        } else if (DRY_RUN) {
            detail = `DRY_RUN: 导出 ${recordCount} 条，待训练`;
            console.log(`[Training] ${detail}`);
        } else {
            // 2. 这里调用实际训练脚本（预留 hook）
            const trainingScript = process.env.TRAINING_SCRIPT;
            if (trainingScript && fs.existsSync(trainingScript)) {
                console.log(`[Training] 调用训练脚本: ${trainingScript}`);
                const { execSync } = require('child_process');
                const result = execSync(`node "${trainingScript}" "${exportPath}"`, { timeout: 3600 * 1000 });
                detail = `训练完成: ${result.toString().slice(0, 200)}`;
                console.log(`[Training] ${detail}`);
            } else {
                detail = `导出完成，待接入训练脚本（export: ${exportPath}）`;
                console.log(`[Training] ${detail}`);
            }
        }
    } catch (e) {
        status = 'failed';
        detail = e.message;
        console.error(`[Training] 失败: ${e.message}`);
    }

    // 3. 写数据库日志
    await logTrainingRun({ monthLabel, recordCount, exportPath, status, detail, triggeredBy });

    // 4. 飞书通知
    const emoji = { success: '✅', failed: '❌', skipped: '⏭', dry_run: '⚠️' }[status] || '❓';
    await notify(
        `${emoji} SFT 训练触发报告\n` +
        `时间: ${timeStr}\n` +
        `触发源: ${triggeredBy}\n` +
        `月份: ${monthLabel}\n` +
        `导出记录: ${recordCount} 条\n` +
        `状态: ${status}\n` +
        `详情: ${detail}`
    );

    return { status, detail, recordCount, exportPath };
}

// ***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED*** HTTP 触发端点（由外部 cron 调用） ***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED***
// 外部 cron 定时调用:
//   curl -X POST http://localhost:3000/api/training/trigger
async function handleTrigger(req, res) {
    const authHeader = (req.headers['authorization'] || '');
    const expectedToken = process.env.TRAINING_TRIGGER_TOKEN;
    if (!expectedToken) {
        return res.status(503).json({ error: 'TRAINING_TRIGGER_TOKEN not configured' });
    }
    if (authHeader !***REMOVED*** `Bearer ${expectedToken}`) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    try {
        const result = await runTraining('http_trigger');
        res.json({ ok: true, ...result });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
}

// ***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED*** CLI / 直接运行 ***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED***
if (require.main ***REMOVED***= module) {
    runTraining('cli')
        .then(r => { console.log('结果:', r); process.exit(0); })
        .catch(e => { console.error(e); process.exit(1); });
}

module.exports = { runTraining, handleTrigger, ensureTrainingLogTable };
