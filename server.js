/**
 * WA CRM v2 Server
 * SQLite 数据存储，端口 3000
 */

require('dotenv').config();
const crypto = require('crypto');
const express = require('express');
const path = require('path');
const db = require('./db');

const app = express();
const PORT = 3000;

// 中间件
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ================== API ==================

// 获取所有达人（支持事件筛选）
app.get('/api/creators', (req, res) => {
    try {
        const { owner, search, is_active, beta_status, priority, agency, event } = req.query;

        let sql = `
            SELECT
                c.id,
                c.primary_name,
                c.wa_phone,
                c.keeper_username,
                c.wa_owner,
                c.source,
                c.is_active,
                c.created_at,
                c.updated_at,
                COUNT(wm.id) as msg_count,
                MAX(wm.timestamp) as last_active,
                k.keeper_gmv,
                k.keeper_gmv30,
                k.keeper_orders,
                wc.priority,
                wc.beta_status,
                wc.monthly_fee_status,
                wc.agency_bound,
                wc.video_count,
                wc.video_target,
                j.ev_joined,
                j.ev_ready_sent,
                j.ev_trial_7day,
                j.ev_monthly_invited,
                j.ev_monthly_joined,
                j.ev_whatsapp_shared,
                j.ev_gmv_1k,
                j.ev_gmv_3k,
                j.ev_gmv_10k,
                j.ev_churned,
                j.days_since_msg
            FROM creators c
            LEFT JOIN wa_messages wm ON wm.creator_id = c.id
            LEFT JOIN keeper_link k ON k.creator_id = c.id
            LEFT JOIN wa_crm_data wc ON wc.creator_id = c.id
            LEFT JOIN joinbrands_link j ON j.creator_id = c.id
            WHERE 1=1
        `;
        const params = [];

        if (owner) {
            sql += ' AND c.wa_owner = ?';
            params.push(owner);
        }
        if (search) {
            sql += ' AND (c.primary_name LIKE ? OR c.wa_phone LIKE ? OR c.keeper_username LIKE ?)';
            const s = `%${search}%`;
            params.push(s, s, s);
        }
        if (beta_status) {
            sql += ' AND wc.beta_status = ?';
            params.push(beta_status);
        }
        if (priority) {
            sql += ' AND wc.priority = ?';
            params.push(priority);
        }
        if (agency === 'yes') {
            sql += ' AND wc.agency_bound = 1';
        } else if (agency === 'no') {
            sql += ' AND (wc.agency_bound = 0 OR wc.agency_bound IS NULL)';
        }
        if (is_active !== undefined && is_active !== '') {
            sql += ' AND c.is_active = ?';
            params.push(is_active == '1' ? 1 : 0);
        }
        if (event) {
            const VALID_EVENTS = ['joined','ready_sent','trial_7day','monthly_invited','monthly_joined','whatsapp_shared','gmv_1k','gmv_3k','gmv_10k','agency_bound','churned'];
            if (VALID_EVENTS.includes(event)) {
                sql += ` AND j.ev_${event} = 1`;
            }
        }

        sql += ' GROUP BY c.id ORDER BY msg_count DESC';

        const creators = db.getDb().prepare(sql).all(...params);
        res.json(creators);
    } catch (err) {
        console.error('Error fetching creators:', err);
        res.status(500).json({ error: err.message });
    }
});

// 获取单个达人完整信息
app.get('/api/creators/:id', (req, res) => {
    try {
        const creator = db.getCreatorFull(parseInt(req.params.id));
        if (!creator) {
            return res.status(404).json({ error: 'Creator not found' });
        }
        res.json(creator);
    } catch (err) {
        console.error('Error fetching creator:', err);
        res.status(500).json({ error: err.message });
    }
});

// 获取达人消息
app.get('/api/creators/:id/messages', (req, res) => {
    try {
        const creator = db.getDb().prepare(
            'SELECT * FROM wa_messages WHERE creator_id = ? ORDER BY timestamp ASC'
        ).all(parseInt(req.params.id));

        res.json(creator);
    } catch (err) {
        console.error('Error fetching messages:', err);
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/creators/:id/messages', (req, res) => {
    try {
        const { role, text, timestamp } = req.body;
        if (!role || !text) {
            return res.status(400).json({ error: 'role and text required' });
        }
        const creatorId = parseInt(req.params.id);
        const ts = timestamp || Date.now();

        db.getDb().prepare(
            'INSERT INTO wa_messages (creator_id, role, text, timestamp) VALUES (?, ?, ?, ?)'
        ).run(creatorId, role, text, ts);

        res.json({ ok: true, id: creatorId, timestamp: ts });
    } catch (err) {
        console.error('Error inserting message:', err);
        res.status(500).json({ error: err.message });
    }
});

// 统计接口
app.get('/api/stats', (req, res) => {
    try {
        const db2 = db.getDb();
        const row = db2.prepare(`
            SELECT COUNT(DISTINCT c.id) as total_creators
            FROM creators c
        `).get();

        const msgRow = db2.prepare(`
            SELECT COUNT(*) as total_messages FROM wa_messages
        `).get();

        const byOwner = {};
        db2.prepare(`SELECT wa_owner, COUNT(*) as count FROM creators GROUP BY wa_owner`).all().forEach(r => {
            byOwner[r.wa_owner || 'Unknown'] = r.count;
        });

        const byBeta = {};
        db2.prepare(`SELECT beta_status, COUNT(*) as count FROM wa_crm_data GROUP BY beta_status`).all().forEach(r => {
            byBeta[r.beta_status || 'unknown'] = r.count;
        });

        const byPriority = {};
        db2.prepare(`SELECT priority, COUNT(*) as count FROM wa_crm_data GROUP BY priority`).all().forEach(r => {
            byPriority[r.priority || 'unknown'] = r.count;
        });

        const eventStats = {};
        const evCols = ['ev_joined','ev_ready_sent','ev_trial_7day','ev_monthly_invited','ev_monthly_joined','ev_whatsapp_shared','ev_gmv_1k','ev_gmv_3k','ev_gmv_10k','ev_agency_bound','ev_churned'];
        for (const col of evCols) {
            const r = db2.prepare(`SELECT COUNT(*) as count FROM joinbrands_link WHERE ${col} = 1`).get();
            eventStats[col] = r.count;
        }

        res.json({
            total_creators: row.total_creators || 0,
            by_owner: byOwner,
            total_messages: msgRow.total_messages || 0,
            by_beta: byBeta,
            by_priority: byPriority,
            events: eventStats,
        });
    } catch (err) {
        console.error('Error fetching stats:', err);
        res.status(500).json({ error: err.message });
    }
});

// 健康检查
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// MiniMax API 代理（绕过浏览器 CORS）
// 隔离机制：验证 client_id 必须属于数据库中的某个 creator，防止跨客户数据注入
app.post('/api/minimax', async (req, res) => {
    try {
        const { messages, model, max_tokens, temperature, client_id } = req.body;

        // 隔离校验：client_id 必须在 creators 表中存在（防止任意注入）
        if (client_id) {
            const db2 = db.getDb();
            const valid = db2.prepare('SELECT id FROM creators WHERE wa_phone = ?').get(client_id);
            if (!valid) {
                return res.status(403).json({ error: '无效的 client_id' });
            }
        }

        const response = await fetch('https://api.minimaxi.com/anthropic/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': process.env.MINIMAX_API_KEY || 'sk-cp-A_5r2O7e-wDzIhHgqlRWiWNQgQBRaY41zuxM0ZZ9O2C-W2RYk7s4uJnkhTslO948oszM44i4eirp4cSRqqcPvvByqnicyD__x3MfS189wp-L86oe1iLHnkU',
                'anthropic-version': '2023-06-01',
            },
            body: JSON.stringify({
                model: model || 'mini-max-typing',
                messages,
                max_tokens: max_tokens || 500,
                temperature: temperature || 0.7,
            }),
        });

        const data = await response.json();
        res.json(data);
    } catch (err) {
        console.error('MiniMax proxy error:', err);
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// 翻译接口（不走 audit_log，仅前端展示用）
// ============================================================
app.post('/api/translate', async (req, res) => {
    try {
        // 支持单条 {text, role, timestamp} 或批量 [{text, role, timestamp}]
        const { text, role, timestamp } = req.body;

        if (text !== undefined) {
            // 单条翻译
            const roleLabel = role === 'me' ? '我（Beau/Yiyun）' : '达人';
            const response = await fetch('https://api.minimaxi.com/anthropic/v1/messages', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': process.env.MINIMAX_API_KEY || 'sk-cp-A_5r2O7e-wDzIhHgqlRWiWNQgQBRaY41zuxM0ZZ9O2C-W2RYk7s4uJnkhTslO948oszM44i4eirp4cSRqqcPvvByqnicyD__x3MfS189wp-L86oe1iLHnkU',
                    'anthropic-version': '2023-06-01',
                },
                body: JSON.stringify({
                    model: 'mini-max',
                    max_tokens: 1000,
                    temperature: 0.3,
                    messages: [{
                        role: 'user',
                        content: `你是一个翻译助手。请将以下消息翻译为中文（所有消息都译为中文，不区分发送者，直接给出中文翻译即可，不需要解释）：\n"${text}"`,
                    }],
                }),
            });

            const data = await response.json();
            let raw = '';
            if (data.content && Array.isArray(data.content)) {
                const textItem = data.content.find(item => item.type === 'text');
                raw = textItem?.text || '';
            } else {
                raw = data.content?.text || data.content || '';
            }

            const translation = (typeof raw === 'string' ? raw.trim() : '') || text;
            return res.json({ translation, timestamp });
        }

        // 批量翻译（兼容旧调用）
        const { texts } = req.body;
        if (!Array.isArray(texts) || texts.length === 0) {
            return res.json([]);
        }

        const combined = texts
            .map((t, i) => `[${i + 1}] ${t.role === 'me' ? '我' : '达人'}: ${t.text}`)
            .join('\n');

        const response = await fetch('https://api.minimaxi.com/anthropic/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': process.env.MINIMAX_API_KEY || 'sk-cp-A_5r2O7e-wDzIhHgqlRWiWNQgQBRaY41zuxM0ZZ9O2C-W2RYk7s4uJnkhTslO948oszM44i4eirp4cSRqqcPvvByqnicyD__x3MfS189wp-L86oe1iLHnkU',
                'anthropic-version': '2023-06-01',
            },
            body: JSON.stringify({
                model: 'mini-max',
                max_tokens: 1000,
                temperature: 0.3,
                messages: [{
                    role: 'user',
                    content: `你是一个翻译助手。请将以下每条消息翻译为中文（不区分发送者，全部译为中文）。请严格按以下JSON数组格式返回，不要输出任何其他内容：\n[{"idx":1,"translation":"中文翻译"},{"idx":2,"translation":"中文翻译"}]\n\n消息列表：\n${combined}`,
                }],
            }),
        });

        const data = await response.json();
        let raw = '';
        if (data.content && Array.isArray(data.content)) {
            const textItem = data.content.find(item => item.type === 'text');
            const thinkingItem = data.content.find(item => item.type === 'thinking');
            raw = textItem?.text || thinkingItem?.thinking || '';
        } else {
            raw = data.content?.[0]?.text || data.content?.[0]?.thinking || '';
        }

        let translations = [];
        try {
            const jsonMatch = raw.match(/\[[\s\S]*\]/);
            if (jsonMatch) translations = JSON.parse(jsonMatch[0]);
        } catch (_) {
            translations = texts.map((t, i) => ({ idx: i + 1, translation: t.text }));
        }

        res.json({ translations });
    } catch (err) {
        console.error('Translate error:', err);
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// 审计日志辅助函数
// ============================================================
function writeAudit(action, tableName, recordId, afterValue, req) {
    try {
        const db2 = db.getDb();
        db2.prepare(`
            INSERT INTO audit_log (action, table_name, record_id, after_value, ip_address, user_agent)
            VALUES (?, ?, ?, ?, ?, ?)
        `).run(
            action,
            tableName,
            recordId,
            afterValue ? JSON.stringify(afterValue) : null,
            req.ip || req.connection?.remoteAddress || null,
            req.get('User-Agent') || null
        );
    } catch (e) {
        console.error('Audit log error:', e.message);
    }
}

// ============================================================
// SFT Memory APIs
// ============================================================

// SHA256 helper
function sha256(str) {
    return crypto.createHash('sha256').update(str || '').digest('hex');
}

// POST /api/sft-memory — 写入 SFT 记录
app.post('/api/sft-memory', (req, res) => {
    try {
        const {
            model_candidates,
            human_selected,
            human_output,
            diff_analysis,
            context,
            messages = [],        // 前10轮对话历史
            reviewed_by = 'system'
        } = req.body;

        if (!human_selected || !human_output) {
            return res.status(400).json({ error: 'human_selected and human_output required' });
        }

        // 质量过滤：human_output 必须满足最低质量标准
        const trimmedOutput = (human_output || '').trim();
        if (trimmedOutput.length < 3) {
            return res.status(400).json({ error: 'human_output too short (< 3 chars)' });
        }
        // 过滤纯 emoji / 纯符号
        if (/^[🔶✅❌👍👎💬📋✨🎉🙏👏🎊⭐️🎯💡🔔📌📎🎬🗣️👀✅☑️✔️❤️🧡💛💚💙💜🤎🖤🤍]+$/.test(trimmedOutput)) {
            return res.status(400).json({ error: 'human_output is pure emoji, rejected' });
        }
        if (/^[.,!?。，！?、：:;；\-—_=+*#]+$/.test(trimmedOutput)) {
            return res.status(400).json({ error: 'human_output is pure punctuation, rejected' });
        }

        const db2 = db.getDb();
        const context_json = context ? JSON.stringify(context) : null;

        // 从 context 中提取字段
        const ctx = context || {};
        const client_id = ctx.client_id || '';
        const input_text = ctx.input_text || '';
        const scene = ctx.scene || 'unknown';
        const similarity = diff_analysis?.similarity ?? null;

        // 后端判定 status
        let status = 'approved';
        if (diff_analysis?.is_custom) {
            status = similarity >= 85 ? 'approved' : 'pending_review';
        } else if (similarity !== null && similarity < 85) {
            status = 'pending_review';
        }

        // 计算去重哈希
        const client_id_hash = sha256(client_id);
        const input_text_hash = sha256(input_text);
        const human_output_hash = sha256(human_output);
        const created_date = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

        // 消息历史（最多10轮）
        const message_history_json = messages.length > 0
            ? JSON.stringify(messages.slice(-10))
            : null;

        // 去重检查
        const existing = db2.prepare(`
            SELECT id FROM sft_memory
            WHERE client_id_hash = ? AND input_text_hash = ? AND human_output_hash = ? AND created_date = ?
        `).get(client_id_hash, input_text_hash, human_output_hash, created_date);

        if (existing) {
            // 已存在 → 更新（取较严格 status）
            const newStatus = (status === 'approved') ? existing.status || status : status;
            db2.prepare(`
                UPDATE sft_memory SET
                    human_output = excluded.human_output,
                    status = CASE WHEN excluded.status = 'approved' THEN status ELSE excluded.status END,
                    similarity = excluded.similarity
                WHERE id = ?
            `).run(human_output, newStatus, similarity, existing.id);
            return res.json({ ok: true, id: existing.id, updated: true });
        }

        const result = db2.prepare(`
            INSERT INTO sft_memory
            (model_opt1, model_opt2, human_selected, human_output,
             model_predicted, model_rejected, is_custom_input, human_reason,
             context_json, status, reviewed_by,
             similarity, scene, message_history,
             client_id_hash, input_text_hash, human_output_hash, created_date)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            model_candidates?.opt1 || null,
            model_candidates?.opt2 || null,
            human_selected,
            human_output,
            diff_analysis?.model_predicted || null,
            diff_analysis?.model_rejected || null,
            diff_analysis?.is_custom ? 1 : 0,
            diff_analysis?.human_reason || null,
            context_json,
            status,
            reviewed_by,
            similarity,
            scene,
            message_history_json,
            client_id_hash,
            input_text_hash,
            human_output_hash,
            created_date
        );

        writeAudit('sft_create', 'sft_memory', result.lastInsertRowid, {
            human_selected, human_output, status, reviewed_by
        }, req);
        res.json({ ok: true, id: result.lastInsertRowid });
    } catch (err) {
        console.error('POST /api/sft-memory error:', err);
        res.status(500).json({ error: err.message });
    }
});

// GET /api/sft-memory — 查询 SFT 记忆
app.get('/api/sft-memory', (req, res) => {
    try {
        const db2 = db.getDb();
        const { limit = 50, offset = 0 } = req.query;
        const rows = db2.prepare(`
            SELECT * FROM sft_memory
            ORDER BY created_at DESC
            LIMIT ? OFFSET ?
        `).all(parseInt(limit), parseInt(offset));
        res.json(rows.map(r => ({
            ...r,
            context: r.context_json ? JSON.parse(r.context_json) : null,
            message_history: r.message_history ? JSON.parse(r.message_history) : null
        })));
    } catch (err) {
        console.error('GET /api/sft-memory error:', err);
        res.status(500).json({ error: err.message });
    }
});

// GET /api/sft-memory/pending — 待审核记录
app.get('/api/sft-memory/pending', (req, res) => {
    try {
        const db2 = db.getDb();
        const rows = db2.prepare(`
            SELECT * FROM sft_memory
            WHERE status IN ('pending_review', 'needs_review')
            ORDER BY created_at DESC
            LIMIT 100
        `).all();
        res.json(rows.map(r => ({
            ...r,
            context: r.context_json ? JSON.parse(r.context_json) : null,
            message_history: r.message_history ? JSON.parse(r.message_history) : null
        })));
    } catch (err) {
        console.error('GET /api/sft-memory/pending error:', err);
        res.status(500).json({ error: err.message });
    }
});

// PATCH /api/sft-memory/:id/review — 审核操作
app.patch('/api/sft-memory/:id/review', (req, res) => {
    try {
        const { action, comment } = req.body;
        if (!action || !['approve', 'reject'].includes(action)) {
            return res.status(400).json({ error: 'action must be approve or reject' });
        }
        const db2 = db.getDb();
        const newStatus = action === 'approve' ? 'approved' : 'rejected';
        const result = db2.prepare(`
            UPDATE sft_memory SET status = ?, reviewed_by = ?, human_reason = COALESCE(?, human_reason)
            WHERE id = ?
        `).run(newStatus, 'human_review', comment || null, parseInt(req.params.id));
        if (result.changes === 0) {
            return res.status(404).json({ error: 'Record not found' });
        }
        res.json({ ok: true, status: newStatus });
    } catch (err) {
        console.error('PATCH /api/sft-memory/:id/review error:', err);
        res.status(500).json({ error: err.message });
    }
});

// GET /api/sft-memory/stats — SFT 统计（含去重）
app.get('/api/sft-memory/stats', (req, res) => {
    try {
        const db2 = db.getDb();
        const total = db2.prepare('SELECT COUNT(*) as count FROM sft_memory').get().count;
        const opt1 = db2.prepare("SELECT COUNT(*) as count FROM sft_memory WHERE human_selected = 'opt1'").get().count;
        const opt2 = db2.prepare("SELECT COUNT(*) as count FROM sft_memory WHERE human_selected = 'opt2'").get().count;
        const custom = db2.prepare("SELECT COUNT(*) as count FROM sft_memory WHERE human_selected = 'custom'").get().count;
        const pending = db2.prepare("SELECT COUNT(*) as count FROM sft_memory WHERE status IN ('pending_review','needs_review')").get().count;
        const approved = db2.prepare("SELECT COUNT(*) as count FROM sft_memory WHERE status = 'approved'").get().count;
        res.json({
            total,
            opt1_selected: opt1,
            opt2_selected: opt2,
            custom_input: custom,
            pending_review: pending,
            approved,
            model_override_rate: total > 0 ? ((custom / total) * 100).toFixed(1) + '%' : '0%'
        });
    } catch (err) {
        console.error('GET /api/sft-memory/stats error:', err);
        res.status(500).json({ error: err.message });
    }
});

// GET /api/sft-memory/trends — 30天趋势
app.get('/api/sft-memory/trends', (req, res) => {
    try {
        const db2 = db.getDb();
        const rows = db2.prepare(`
            SELECT
                DATE(created_at) as date,
                COUNT(*) as total,
                SUM(CASE WHEN human_selected = 'opt1' THEN 1 ELSE 0 END) as opt1_cnt,
                SUM(CASE WHEN human_selected = 'opt2' THEN 1 ELSE 0 END) as opt2_cnt,
                SUM(CASE WHEN human_selected = 'custom' THEN 1 ELSE 0 END) as custom_cnt,
                SUM(CASE WHEN status = 'pending_review' THEN 1 ELSE 0 END) as pending_cnt
            FROM sft_memory
            WHERE created_at >= DATE('now', '-30 days')
            GROUP BY DATE(created_at)
            ORDER BY date ASC
        `).all();

        const dates = rows.map(r => r.date);
        const volumes = rows.map(r => r.total);
        const opt1_rate = rows.map(r => r.total > 0 ? +(r.opt1_cnt / r.total * 100).toFixed(1) : 0);
        const opt2_rate = rows.map(r => r.total > 0 ? +(r.opt2_cnt / r.total * 100).toFixed(1) : 0);
        const custom_rate = rows.map(r => r.total > 0 ? +(r.custom_cnt / r.total * 100).toFixed(1) : 0);

        // 获取 skip 率（来自 feedback）
        const skipRows = db2.prepare(`
            SELECT DATE(created_at) as date, COUNT(*) as skip_cnt
            FROM sft_feedback
            WHERE feedback_type = 'skip' AND created_at >= DATE('now', '-30 days')
            GROUP BY DATE(created_at)
        `).all();
        const skipMap = {};
        skipRows.forEach(r => { skipMap[r.date] = r.skip_cnt; });
        const skip_rate = rows.map(r => {
            const skip = skipMap[r.date] || 0;
            return r.total > 0 ? +(skip / (r.total + skip) * 100).toFixed(1) : 0;
        });

        res.json({ dates, volumes, opt1_rate, opt2_rate, custom_rate, skip_rate });
    } catch (err) {
        console.error('GET /api/sft-memory/trends error:', err);
        res.status(500).json({ error: err.message });
    }
});

// POST /api/sft-feedback — 写入 Skip/Reject/Edit 反馈
app.post('/api/sft-feedback', (req, res) => {
    try {
        const { client_id, feedback_type, input_text, opt1, opt2, final_output, scene, detail } = req.body;
        if (!feedback_type || !['skip', 'reject', 'edit'].includes(feedback_type)) {
            return res.status(400).json({ error: 'feedback_type must be skip, reject, or edit' });
        }
        const db2 = db.getDb();
        const result = db2.prepare(`
            INSERT INTO sft_feedback (client_id, feedback_type, input_text, opt1, opt2, final_output, scene, detail)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(client_id || null, feedback_type, input_text || null, opt1 || null, opt2 || null, final_output || null, scene || null, detail || null);
        res.json({ ok: true, id: result.lastInsertRowid });
    } catch (err) {
        console.error('POST /api/sft-feedback error:', err);
        res.status(500).json({ error: err.message });
    }
});

// GET /api/sft-feedback/stats — 反馈统计
app.get('/api/sft-feedback/stats', (req, res) => {
    try {
        const db2 = db.getDb();
        const total = db2.prepare('SELECT COUNT(*) as count FROM sft_feedback').get().count;
        const byType = {};
        db2.prepare('SELECT feedback_type, COUNT(*) as count FROM sft_feedback GROUP BY feedback_type').all().forEach(r => {
            byType[r.feedback_type] = r.count;
        });
        const byScene = db2.prepare(`
            SELECT scene, feedback_type, COUNT(*) as count
            FROM sft_feedback WHERE scene IS NOT NULL
            GROUP BY scene, feedback_type
        `).all();
        // 按 scene 聚合
        const sceneMap = {};
        byScene.forEach(r => {
            if (!sceneMap[r.scene]) sceneMap[r.scene] = { skip: 0, reject: 0, edit: 0 };
            sceneMap[r.scene][r.feedback_type] = r.count;
        });
        res.json({ total, by_type: byType, by_scene: sceneMap });
    } catch (err) {
        console.error('GET /api/sft-feedback/stats error:', err);
        res.status(500).json({ error: err.message });
    }
});

// GET /api/policy-documents — 获取政策文档
app.get('/api/policy-documents', (req, res) => {
    try {
        const db2 = db.getDb();
        const { active_only } = req.query;
        let sql = 'SELECT * FROM policy_documents';
        if (active_only === 'true') sql += ' WHERE is_active = 1';
        sql += ' ORDER BY policy_key';
        const rows = db2.prepare(sql).all();
        res.json(rows.map(r => ({
            ...r,
            applicable_scenarios: r.applicable_scenarios ? JSON.parse(r.applicable_scenarios) : []
        })));
    } catch (err) {
        console.error('GET /api/policy-documents error:', err);
        res.status(500).json({ error: err.message });
    }
});

// POST /api/policy-documents — 创建/更新政策文档
app.post('/api/policy-documents', (req, res) => {
    try {
        const { policy_key, policy_version, policy_content, applicable_scenarios, is_active = 1 } = req.body;
        if (!policy_key || !policy_version || !policy_content) {
            return res.status(400).json({ error: 'policy_key, policy_version, policy_content required' });
        }
        const db2 = db.getDb();
        const scenarios_json = applicable_scenarios ? JSON.stringify(applicable_scenarios) : null;

        // 先查旧值，用于审计
        const oldRow = db2.prepare('SELECT * FROM policy_documents WHERE policy_key = ?').get(policy_key);
        const auditAction = oldRow ? (is_active ? 'policy_update' : 'policy_deactivate') : 'policy_create';

        db2.prepare(`
            INSERT OR REPLACE INTO policy_documents
            (policy_key, policy_version, policy_content, applicable_scenarios, is_active, updated_at)
            VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        `).run(policy_key, policy_version, policy_content, scenarios_json, is_active ? 1 : 0);

        writeAudit(auditAction, 'policy_documents', policy_key, {
            before: oldRow || null,
            after: { policy_key, policy_version, is_active }
        }, req);
        res.json({ ok: true });
    } catch (err) {
        console.error('POST /api/policy-documents error:', err);
        res.status(500).json({ error: err.message });
    }
});

// GET /api/client-memory/:clientId — 获取客户记忆
app.get('/api/client-memory/:clientId', (req, res) => {
    try {
        const db2 = db.getDb();
        const rows = db2.prepare(`
            SELECT * FROM client_memory
            WHERE client_id = ?
            ORDER BY memory_type, confidence DESC
        `).all(req.params.clientId);
        res.json(rows);
    } catch (err) {
        console.error('GET /api/client-memory error:', err);
        res.status(500).json({ error: err.message });
    }
});

// POST /api/client-memory — 更新客户记忆
app.post('/api/client-memory', (req, res) => {
    try {
        const { client_id, memory_type, memory_key, memory_value, confidence = 1 } = req.body;
        if (!client_id || !memory_type || !memory_key || !memory_value) {
            return res.status(400).json({ error: 'client_id, memory_type, memory_key, memory_value required' });
        }
        const db2 = db.getDb();
        db2.prepare(`
            INSERT OR REPLACE INTO client_memory
            (client_id, memory_type, memory_key, memory_value, confidence, updated_at)
            VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        `).run(client_id, memory_type, memory_key, memory_value, confidence);

        writeAudit('client_memory_update', 'client_memory', null, {
            client_id, memory_type, memory_key, memory_value, confidence
        }, req);
        res.json({ ok: true });
    } catch (err) {
        console.error('POST /api/client-memory error:', err);
        res.status(500).json({ error: err.message });
    }
});

// GET /api/audit-log — 查询审计日志
app.get('/api/audit-log', (req, res) => {
    try {
        const db2 = db.getDb();
        const { action, limit = 50, offset = 0 } = req.query;
        let sql = 'SELECT * FROM audit_log WHERE 1=1';
        const params = [];
        if (action) {
            sql += ' AND action = ?';
            params.push(action);
        }
        sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
        params.push(parseInt(limit), parseInt(offset));
        const rows = db2.prepare(sql).all(...params);
        res.json(rows.map(r => ({
            ...r,
            after_value: r.after_value ? JSON.parse(r.after_value) : null,
            before_value: r.before_value ? JSON.parse(r.before_value) : null,
        })));
    } catch (err) {
        console.error('GET /api/audit-log error:', err);
        res.status(500).json({ error: err.message });
    }
});

// GET /api/ab-evaluation — A/B 评估框架
app.get('/api/ab-evaluation', (req, res) => {
    try {
        const db2 = db.getDb();
        const { start_date, end_date, owner } = req.query;

        // 基础过滤
        let where = 'WHERE 1=1';
        const params = [];
        if (start_date) {
            where += ' AND created_at >= ?';
            params.push(start_date);
        }
        if (end_date) {
            where += ' AND created_at <= ?';
            params.push(end_date);
        }

        // 按 owner 过滤需要 join creators 表
        let joinCreators = '';
        if (owner) {
            joinCreators = ' LEFT JOIN creators c ON c.wa_phone = json_extract(sm.context_json, "$.client_id")';
            where += ' AND c.wa_owner = ?';
            params.push(owner);
        }

        // 总体统计
        const total = db2.prepare(`SELECT COUNT(*) as count FROM sft_memory sm ${joinCreators} ${where}`).get(...params)?.count || 0;
        const opt1Count = db2.prepare(`SELECT COUNT(*) as count FROM sft_memory sm ${joinCreators} ${where} AND sm.human_selected = 'opt1'`).get(...params)?.count || 0;
        const opt2Count = db2.prepare(`SELECT COUNT(*) as count FROM sft_memory sm ${joinCreators} ${where} AND sm.human_selected = 'opt2'`).get(...params)?.count || 0;
        const customCount = db2.prepare(`SELECT COUNT(*) as count FROM sft_memory sm ${joinCreators} ${where} AND sm.human_selected = 'custom'`).get(...params)?.count || 0;

        // 按场景统计（从 context_json 提取 scene）
        const bySceneRows = db2.prepare(`
            SELECT
                json_extract(context_json, '$.scene') as scene,
                COUNT(*) as total,
                SUM(CASE WHEN human_selected = 'custom' THEN 1 ELSE 0 END) as custom_count
            FROM sft_memory sm
            ${joinCreators}
            ${where}
            GROUP BY scene
            ORDER BY total DESC
        `).all(...params);

        const byScene = {};
        for (const row of bySceneRows) {
            const scene = row.scene || 'unknown';
            byScene[scene] = {
                total: row.total,
                custom_rate: row.total > 0 ? ((row.custom_count / row.total) * 100).toFixed(1) + '%' : '0%',
                custom_count: row.custom_count,
            };
        }

        // 按 owner 统计
        const byOwnerRows = db2.prepare(`
            SELECT
                c.wa_owner as owner,
                COUNT(*) as total,
                SUM(CASE WHEN sm.human_selected = 'custom' THEN 1 ELSE 0 END) as custom_count
            FROM sft_memory sm
            LEFT JOIN creators c ON c.wa_phone = json_extract(sm.context_json, '$.client_id')
            GROUP BY c.wa_owner
            ORDER BY total DESC
        `).all();

        const byOwner = {};
        for (const row of byOwnerRows) {
            const o = row.owner || 'Unknown';
            byOwner[o] = {
                total: row.total,
                custom_rate: row.total > 0 ? ((row.custom_count / row.total) * 100).toFixed(1) + '%' : '0%',
                custom_count: row.custom_count,
            };
        }

        // 按天统计（最近30天）
        const byDayRows = db2.prepare(`
            SELECT
                DATE(created_at) as date,
                COUNT(*) as total,
                SUM(CASE WHEN human_selected = 'custom' THEN 1 ELSE 0 END) as custom_count
            FROM sft_memory
            WHERE created_at >= DATE('now', '-30 days')
            GROUP BY DATE(created_at)
            ORDER BY date ASC
        `).all();

        const byDay = byDayRows.map(row => ({
            date: row.date,
            total: row.total,
            custom_count: row.custom_count,
            custom_rate: row.total > 0 ? ((row.custom_count / row.total) * 100).toFixed(1) + '%' : '0%',
        }));

        res.json({
            total_records: total,
            opt1_selected: opt1Count,
            opt2_selected: opt2Count,
            custom_input: customCount,
            custom_rate: total > 0 ? ((customCount / total) * 100).toFixed(1) + '%' : '0%',
            opt1_rate: total > 0 ? ((opt1Count / total) * 100).toFixed(1) + '%' : '0%',
            opt2_rate: total > 0 ? ((opt2Count / total) * 100).toFixed(1) + '%' : '0%',
            model_override_rate: total > 0 ? ((customCount / total) * 100).toFixed(1) + '%' : '0%',
            by_scene: byScene,
            by_owner: byOwner,
            by_day: byDay,
        });
    } catch (err) {
        console.error('GET /api/ab-evaluation error:', err);
        res.status(500).json({ error: err.message });
    }
});

// GET /api/sft-export — 导出 SFT 训练数据
app.get('/api/sft-export', async (req, res) => {
    try {
        // 动态导入共享 system prompt 模板（与前端 minimax.js 共用同一份）
        const { buildSystemPromptTemplate } = await import('./src/utils/systemPrompt.js');

        const db2 = db.getDb();
        const { format = 'json', limit = 1000, status = 'approved' } = req.query;

        const rows = db2.prepare(`
            SELECT * FROM sft_memory
            WHERE status = ?
            ORDER BY created_at DESC
            LIMIT ? OFFSET ?
        `).all(status, parseInt(limit), 0);

        function buildConversationMessages(history, inputText) {
            const msgs = [];
            // 加载前10轮历史
            if (history && history.length > 0) {
                for (const m of history) {
                    msgs.push({
                        role: m.role === 'me' ? 'assistant' : 'user',
                        content: m.text
                    });
                }
            }
            // 当前输入
            msgs.push({ role: 'user', content: inputText || '' });
            return msgs;
        }

        const exportRecord = (r) => {
            const ctx = r.context_json ? JSON.parse(r.context_json) : {};
            const history = r.message_history ? JSON.parse(r.message_history) : [];
            const inputText = ctx.input_text || '';
            const systemPrompt = buildSystemPromptTemplate(ctx);
            const conversationMsgs = buildConversationMessages(history, inputText);

            return {
                messages: [
                    { role: 'system', content: systemPrompt },
                    ...conversationMsgs,
                    { role: 'assistant', content: r.human_output || '' }
                ],
                metadata: {
                    human_selected: r.human_selected,
                    scene: r.scene || ctx.scene || 'unknown',
                    similarity: r.similarity,
                    model_opt1: r.model_opt1,
                    model_opt2: r.model_opt2,
                    is_custom_input: r.is_custom_input,
                    reviewed_by: r.reviewed_by,
                    created_at: r.created_at,
                    system_prompt_version: r.system_prompt_version || 'v1',
                }
            };
        };

        if (format === 'jsonl') {
            res.setHeader('Content-Type', 'application/x-ndjson');
            const lines = rows.map(r => JSON.stringify(exportRecord(r)));
            res.end(lines.join('\n'));
        } else {
            res.setHeader('Content-Type', 'application/json');
            res.json(rows.map(exportRecord));
        }
    } catch (err) {
        console.error('GET /api/sft-export error:', err);
        res.status(500).json({ error: err.message });
    }
});

// PUT /api/creators/:id — 更新达人基本信息
app.put('/api/creators/:id', (req, res) => {
    try {
        const db2 = db.getDb();
        const { primary_name, wa_phone, wa_owner, keeper_username } = req.body;
        const id = parseInt(req.params.id);

        const fields = [];
        const values = [];
        if (primary_name !== undefined) { fields.push('primary_name = ?'); values.push(primary_name); }
        if (wa_phone !== undefined) { fields.push('wa_phone = ?'); values.push(wa_phone); }
        if (wa_owner !== undefined) { fields.push('wa_owner = ?'); values.push(wa_owner); }
        if (keeper_username !== undefined) { fields.push('keeper_username = ?'); values.push(keeper_username); }

        if (fields.length === 0) return res.status(400).json({ error: 'No fields to update' });

        fields.push('updated_at = CURRENT_TIMESTAMP');
        values.push(id);
        db2.prepare(`UPDATE creators SET ${fields.join(', ')} WHERE id = ?`).run(...values);

        writeAudit('creator_update', 'creators', id, req.body, req);
        res.json({ ok: true });
    } catch (err) {
        console.error('PUT /api/creators/:id error:', err);
        res.status(500).json({ error: err.message });
    }
});

// PUT /api/creators/:id/wacrm — 更新 WA CRM 数据
app.put('/api/creators/:id/wacrm', (req, res) => {
    try {
        const db2 = db.getDb();
        const { beta_status, priority, agency_bound, video_count } = req.body;
        const creatorId = parseInt(req.params.id);

        // 确保 wacrm 记录存在
        const existing = db2.prepare('SELECT id FROM wa_crm_data WHERE creator_id = ?').get(creatorId);
        if (!existing) {
            db2.prepare('INSERT INTO wa_crm_data (creator_id) VALUES (?)').run(creatorId);
        }

        const fields = [];
        const values = [];
        if (beta_status !== undefined) { fields.push('beta_status = ?'); values.push(beta_status); }
        if (priority !== undefined) { fields.push('priority = ?'); values.push(priority); }
        if (agency_bound !== undefined) { fields.push('agency_bound = ?'); values.push(agency_bound); }
        if (video_count !== undefined) { fields.push('video_count = ?'); values.push(video_count); }

        if (fields.length === 0) return res.status(400).json({ error: 'No fields to update' });

        fields.push('updated_at = CURRENT_TIMESTAMP');
        values.push(creatorId);
        db2.prepare(`UPDATE wa_crm_data SET ${fields.join(', ')} WHERE creator_id = ?`).run(...values);

        writeAudit('wacrm_update', 'wa_crm_data', creatorId, req.body, req);
        res.json({ ok: true });
    } catch (err) {
        console.error('PUT /api/creators/:id/wacrm error:', err);
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// Profile Agent APIs
// ============================================================

// POST /api/profile-agent/event — 触发画像更新事件
app.post('/api/profile-agent/event', (req, res) => {
    try {
        const { event_type, client_id, data: eventData } = req.body;
        if (!event_type || !client_id) {
            return res.status(400).json({ error: 'event_type and client_id required' });
        }

        const db2 = db.getDb();

        // 确保 client 存在
        const creator = db2.prepare('SELECT id FROM creators WHERE wa_phone = ?').get(client_id);
        if (!creator) {
            return res.status(404).json({ error: 'client not found' });
        }

        // 确保 profile 存在
        let profile = db2.prepare('SELECT id FROM client_profiles WHERE client_id = ?').get(client_id);
        if (!profile) {
            db2.prepare('INSERT INTO client_profiles (client_id) VALUES (?)').run(client_id);
        }

        let tags_added = [];

        if (event_type === 'wa_message') {
            const { text, role } = eventData || {};
            if (text) {
                const t = text.toLowerCase();
                // preference
                if (/\b(prefer|更喜欢|比较喜欢)\b/.test(t)) {
                    if (/\bvideo\b/.test(t)) tags_added.push({ tag: 'format:video', source: 'ai_extracted' });
                    if (/\btext\b/.test(t)) tags_added.push({ tag: 'format:text', source: 'ai_extracted' });
                }
                if (/\b(please|would|could|kindly)\b/.test(t)) {
                    tags_added.push({ tag: 'tone:formal', source: 'ai_extracted' });
                }
                if (/\b(hey|great|awesome|cool|yeah|thanks?)\b/.test(t)) {
                    tags_added.push({ tag: 'tone:casual', source: 'ai_extracted' });
                }
                if (/\b(trial|7[\s-]?day|7day|free\s*try)\b/.test(t)) {
                    tags_added.push({ tag: 'stage:trial_intro', source: 'ai_extracted' });
                }
            }
            db2.prepare(
                'UPDATE client_profiles SET last_interaction = CURRENT_TIMESTAMP, last_updated = CURRENT_TIMESTAMP WHERE client_id = ?'
            ).run(client_id);

        } else if (event_type === 'sft_record') {
            const { sft_record_id } = eventData || {};
            if (sft_record_id) {
                const sft = db2.prepare('SELECT * FROM sft_memory WHERE id = ?').get(sft_record_id);
                if (sft && sft.context_json) {
                    const ctx = JSON.parse(sft.context_json);
                    const scene = ctx.scene || 'unknown';
                    tags_added.push({ tag: `scene:${scene}`, source: 'sft_feedback' });
                    if (sft.human_selected === 'custom') {
                        tags_added.push({ tag: `scene:${scene}:ai_weak`, source: 'sft_feedback' });
                    }
                }
            }

        } else if (event_type === 'keeper_update') {
            const { keeper_gmv, keeper_videos } = eventData || {};
            if (keeper_gmv !== undefined) {
                if (keeper_gmv >= 3000) tags_added.push({ tag: 'gmv_tier:high', source: 'keeper_update' });
                else if (keeper_gmv >= 1000) tags_added.push({ tag: 'gmv_tier:medium', source: 'keeper_update' });
                else if (keeper_gmv > 0) tags_added.push({ tag: 'gmv_tier:low', source: 'keeper_update' });
            }
            if (keeper_videos !== undefined) {
                if (keeper_videos >= 20) tags_added.push({ tag: 'content_active:high', source: 'keeper_update' });
                else if (keeper_videos >= 5) tags_added.push({ tag: 'content_active:medium', source: 'keeper_update' });
            }

        } else if (event_type === 'manual_tag') {
            const { tag, value, confidence = 3 } = eventData || {};
            if (tag) {
                tags_added.push({ tag: `${tag}:${value || 'true'}`, source: 'manual' });
            }
        }

        // upsert tags
        for (const t of tags_added) {
            db2.prepare(`
                INSERT OR REPLACE INTO client_tags (client_id, tag, source, confidence)
                VALUES (?, ?, ?, 2)
            `).run(client_id, t.tag, t.source);
        }

        // 异步刷新 summary（带 debounce，防止频繁重复触发）
        if (tags_added.length > 0) {
            scheduleProfileRefresh(client_id);
        }

        res.json({ ok: true, client_id, tags_added });
    } catch (err) {
        console.error('POST /api/profile-agent/event error:', err);
        res.status(500).json({ error: err.message });
    }
});

// GET /api/client-profile/:clientId — 获取完整画像
app.get('/api/client-profile/:clientId', (req, res) => {
    try {
        const db2 = db.getDb();
        const { clientId } = req.params;

        const profile = db2.prepare('SELECT * FROM client_profiles WHERE client_id = ?').get(clientId);
        const tags = db2.prepare(
            'SELECT * FROM client_tags WHERE client_id = ? ORDER BY confidence DESC'
        ).all(clientId);
        const memory = db2.prepare(
            'SELECT * FROM client_memory WHERE client_id = ? ORDER BY created_at DESC LIMIT 20'
        ).all(clientId);

        if (!profile) {
            return res.status(404).json({ error: 'profile not found' });
        }

        // 获取 creator 基础信息
        const creator = db2.prepare(`
            SELECT c.primary_name as name, c.wa_owner, c.keeper_username,
                   wc.beta_status as conversion_stage, wc.priority,
                   k.keeper_gmv, k.keeper_videos, k.keeper_orders
            FROM creators c
            LEFT JOIN wa_crm_data wc ON wc.creator_id = c.id
            LEFT JOIN keeper_link k ON k.creator_id = c.id
            WHERE c.wa_phone = ?
        `).get(clientId);

        res.json({
            client_id: clientId,
            name: creator?.name || null,
            wa_owner: creator?.wa_owner || null,
            keeper_username: creator?.keeper_username || null,
            conversion_stage: creator?.conversion_stage || null,
            priority: creator?.priority || null,
            summary: profile.summary || null,
            tags: tags.map(t => ({ tag: t.tag, source: t.source, confidence: t.confidence })),
            tiktok_data: profile.tiktok_data ? JSON.parse(profile.tiktok_data) : null,
            stage: profile.stage || creator?.conversion_stage || null,
            last_interaction: profile.last_interaction,
            last_updated: profile.last_updated,
            memory: memory.map(m => ({ type: m.memory_type, key: m.memory_key, value: m.memory_value })),
        });
    } catch (err) {
        console.error('GET /api/client-profile error:', err);
        res.status(500).json({ error: err.message });
    }
});

// PUT /api/client-profiles/:clientId/tags — 手工更新标签
app.put('/api/client-profiles/:clientId/tags', (req, res) => {
    try {
        const db2 = db.getDb();
        const { clientId } = req.params;
        const { tag, value, action = 'upsert', confidence = 3 } = req.body;

        if (!tag) return res.status(400).json({ error: 'tag required' });

        const fullTag = `${tag}:${value || 'true'}`;

        if (action === 'delete') {
            db2.prepare('DELETE FROM client_tags WHERE client_id = ? AND tag = ?').run(clientId, fullTag);
        } else {
            db2.prepare(`
                INSERT OR REPLACE INTO client_tags (client_id, tag, source, confidence)
                VALUES (?, ?, 'manual', ?)
            `).run(clientId, fullTag, confidence);
        }

        res.json({ ok: true });
    } catch (err) {
        console.error('PUT /api/client-profiles/tags error:', err);
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// Experience Router
// ============================================================
const experienceRouter = require('./routes/experience');
app.use('/api/experience', experienceRouter);

// 启动服务器
app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n✅ WA CRM v2 Server`);
    console.log(`   Local:   http://localhost:${PORT}`);
    console.log(`   LAN:     http://192.168.1.51:${PORT}`);
    console.log(`   SQLite:  crm.db\n`);
});

// ============================================================
// Profile Summary Refresh（异步，不阻塞请求）
// ============================================================

// 防止同一 client 频繁刷新的 debounce 标记
const _pendingRefresh = new Map(); // clientId → setImmediate handle

/**
 * 带 debounce 的 summary 刷新
 * 同一 client 5 秒内不重复触发
 */
function scheduleProfileRefresh(clientId) {
    if (_pendingRefresh.has(clientId)) {
        // 已在等待中，跳过
        return;
    }
    const handle = setImmediate(async () => {
        _pendingRefresh.delete(clientId);
        try {
            await refreshProfileSummary(clientId);
        } catch (err) {
            console.error('scheduleProfileRefresh error:', err.message);
        }
    });
    _pendingRefresh.set(clientId, handle);
    // 5 秒后自动清除（兜底）
    setTimeout(() => _pendingRefresh.delete(clientId), 5000);
}
async function refreshProfileSummary(clientId) {
    try {
        const db2 = db.getDb();
        const creator = db2.prepare(`
            SELECT c.primary_name as name, c.wa_owner, c.keeper_username,
                   wc.beta_status as conversion_stage,
                   k.keeper_gmv, k.keeper_videos
            FROM creators c
            LEFT JOIN wa_crm_data wc ON wc.creator_id = c.id
            LEFT JOIN keeper_link k ON k.creator_id = c.id
            WHERE c.wa_phone = ?
        `).get(clientId);

        if (!creator) return;

        const tags = db2.prepare(
            'SELECT * FROM client_tags WHERE client_id = ? ORDER BY confidence DESC LIMIT 15'
        ).all(clientId);
        const memory = db2.prepare(
            'SELECT * FROM client_memory WHERE client_id = ? ORDER BY created_at DESC LIMIT 5'
        ).all(clientId);

        const tagLines = tags.map(t => t.tag).join(', ') || '暂无';
        const memLines = memory.map(m => m.memory_value).join('; ') || '暂无';

        const prompt = `客户画像分析（50字以内）。姓名:${creator.name || '未知'} | 负责人:${creator.wa_owner || '未知'} | 阶段:${creator.conversion_stage || '未知'} | TikTok:${creator.keeper_username || '未知'} | 标签:${tagLines} | 对话:${memLines}。直接输出简介。`;

        const response = await fetch('https://api.minimaxi.com/anthropic/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': process.env.MINIMAX_API_KEY || 'sk-cp-A_5r2O7e-wDzIhHgqlRWiWNQgQBRaY41zuxM0ZZ9O2C-W2RYk7s4uJnkhTslO948oszM44i4eirp4cSRqqcPvvByqnicyD__x3MfS189wp-L86oe1iLHnkU',
                'anthropic-version': '2023-06-01',
            },
            body: JSON.stringify({
                model: 'mini-max-typing',
                messages: [{ role: 'user', content: prompt }],
                max_tokens: 150,
                temperature: 0.5,
            }),
        });

        if (!response.ok) return;
        const data = await response.json();
        const textItem = data.content?.find(item => item.type === 'text');
        const summary = textItem?.text?.trim();

        if (summary) {
            db2.prepare(
                'UPDATE client_profiles SET summary = ?, last_updated = CURRENT_TIMESTAMP WHERE client_id = ?'
            ).run(summary, clientId);
        }
    } catch (err) {
        console.error('refreshProfileSummary error:', err.message);
    }
}
