/**
 * Training routes — SFT 训练触发与状态查询
 * POST /api/training/trigger, GET /api/training/status, GET /api/training/logs
 */
const express = require('express');
const router = express.Router();
const { runTraining, ensureTrainingLogTable } = require('../workers/trainingWorker');
const db = require('../../db');

// POST /api/training/trigger — 触发训练（外部 cron 或 MetaBot Scheduler 调用）
router.post('/trigger', async (req, res) => {
    // Token 校验
    const token = process.env.TRAINING_TRIGGER_TOKEN;
    if (!token) {
        return res.status(503).json({ error: 'TRAINING_TRIGGER_TOKEN not configured' });
    }
    const auth = req.headers['authorization'] || '';
    if (auth !***REMOVED*** `Bearer ${token}`) {
        return res.status(401).json({ error: 'Unauthorized: invalid token' });
    }
    try {
        const result = await runTraining('http_trigger');
        res.json({ ok: true, ...result });
    } catch (err) {
        console.error('Training trigger error:', err);
        res.status(500).json({ error: err.message });
    }
});

// GET /api/training/status — 最近一次训练状态
router.get('/status', async (req, res) => {
    try {
        const db2 = db.getDb();
        await ensureTrainingLogTable();
        const lastRun = await db2.prepare(`
            SELECT * FROM training_log ORDER BY created_at DESC LIMIT 1
        `).get();
        const count30 = await db2.prepare(`
            SELECT COUNT(*) as cnt FROM training_log
            WHERE created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
        `).get();
        res.json({
            last_run: lastRun || null,
            runs_last_30_days: count30?.cnt || 0,
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/training/logs — 训练历史
router.get('/logs', async (req, res) => {
    try {
        const db2 = db.getDb();
        await ensureTrainingLogTable();
        const limit = Math.min(parseInt(req.query.limit) || 12, 60);
        // MySQL LIMIT 不支持占位符，用字符串拼接（limit 已做安全钳制）
        const rows = await db2.prepare(`
            SELECT id, month_label, record_count, status, detail, triggered_by, created_at
            FROM training_log ORDER BY created_at DESC LIMIT ${limit}
        `).all();
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
