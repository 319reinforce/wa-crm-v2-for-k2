/**
 * WhatsApp 路由
 * POST /api/wa/send — 发送消息（可指定 operator）
 * GET  /api/wa/status — 查询所有账号状态
 * GET  /api/wa/status/:operator — 查询指定 operator 状态
 * GET  /api/wa/qr — 获取二维码
 */
const express = require('express');
const router = express.Router();
const { sendMessage, getStatus, getAllStatus } = require('../services/waService');

// POST /api/wa/send
// Body: { phone, text, operator? }
router.post('/send', async (req, res) => {
    try {
        const { phone, text, operator = 'Beau' } = req.body;
        if (!phone || !text) {
            return res.status(400).json({ ok: false, error: 'phone and text required' });
        }

        const result = await sendMessage(phone, text, operator);
        if (result.ok) {
            res.json({ ok: true, operator, messageId: result.messageId });
        } else {
            res.status(400).json({ ok: false, operator, error: result.error });
        }
    } catch (err) {
        console.error('[WA Route] send error:', err);
        res.status(500).json({ ok: false, error: err.message });
    }
});

// GET /api/wa/status — 所有账号状态
router.get('/status', async (req, res) => {
    res.json({ operators: getAllStatus() });
});

// GET /api/wa/status/:operator
router.get('/status/:operator', async (req, res) => {
    res.json(getStatus(req.params.operator));
});

// GET /api/wa/qr?operator=Beau
router.get('/qr', async (req, res) => {
    const operator = req.query.operator || 'Beau';
    const status = getStatus(operator);
    if (status.hasQr) {
        res.json({ ok: true, operator, qr: status.qr });
    } else if (status.ready) {
        res.json({ ok: true, operator, message: '已就绪，无需扫码' });
    } else {
        res.json({ ok: false, operator, message: '等待二维码生成，请稍后刷新' });
    }
});

module.exports = router;
