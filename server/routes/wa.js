/**
 * WhatsApp 路由 — 单账号版本
 * POST /api/wa/send — 发送消息
 * GET  /api/wa/status — 查询状态
 * GET  /api/wa/qr — 获取二维码（终端显示，网页端不再提供）
 */
const express = require('express');
const router = express.Router();
const QRCode = require('qrcode');
const { sendMessage, getStatus } = require('../services/waService');

// POST /api/wa/send
router.post('/send', async (req, res) => {
    try {
        const { phone, text } = req.body;
        if (!phone || !text) {
            return res.status(400).json({ ok: false, error: 'phone and text required' });
        }
        const result = await sendMessage(phone, text);
        if (result.ok) {
            res.json({ ok: true, messageId: result.messageId });
        } else {
            res.status(400).json({ ok: false, error: result.error });
        }
    } catch (err) {
        console.error('[WA Route] send error:', err);
        res.status(500).json({ ok: false, error: err.message });
    }
});

// GET /api/wa/status
router.get('/status', async (req, res) => {
    res.json(getStatus());
});

// GET /api/wa/qr — 返回二维码图片（网页端扫码用）
router.get('/qr', async (req, res) => {
    const status = getStatus();
    if (!status.hasQr) {
        return res.status(404).json({ ok: false, message: '无可用二维码' });
    }
    try {
        const dataUrl = await QRCode.toDataURL(status.qr, {
            margin: 2,
            width: 300,
            color: { dark: '#000000', light: '#ffffff' },
        });
        res.json({ ok: true, qr: dataUrl });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

module.exports = router;
