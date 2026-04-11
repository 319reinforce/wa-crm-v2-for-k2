/**
 * WhatsApp 路由 — 单账号版本
 * POST /api/wa/send — 发送消息
 * GET  /api/wa/status — 查询状态
 * GET  /api/wa/qr — 获取二维码（终端显示，网页端不再提供）
 */
const express = require('express');
const router = express.Router();
const QRCode = require('qrcode');
const { getQrValue } = require('../services/waService');
const {
    getRoutedQr,
    getRoutedStatus,
    sendRoutedMessage,
} = require('../services/waSessionRouter');

// POST /api/wa/send
router.post('/send', async (req, res) => {
    try {
        const { phone, text, session_id, operator, creator_id } = req.body || {};
        if (!phone || !text) {
            return res.status(400).json({ ok: false, error: 'phone and text required' });
        }
        const bypass = req.get('X-WA-Proxy-Bypass') ***REMOVED***= '1';
        const result = await sendRoutedMessage(
            { phone, text, session_id, operator, creator_id },
            { bypass }
        );
        if (result.ok) {
            res.json({
                ok: true,
                messageId: result.messageId,
                routed_session_id: result.routed_session_id || session_id || null,
                routed_operator: result.routed_operator || operator || null,
            });
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
    const localOnly = req.query.local_only ***REMOVED***= '1' || req.get('X-WA-Proxy-Bypass') ***REMOVED***= '1';
    const all = req.query.all ***REMOVED***= '1' && !localOnly;
    res.json(await getRoutedStatus({
        all,
        session_id: req.query.session_id,
        operator: req.query.operator,
        creator_id: req.query.creator_id ? parseInt(req.query.creator_id, 10) : null,
    }));
});

// GET /api/wa/sessions — 聚合状态接口
router.get('/sessions', async (req, res) => {
    res.json(await getRoutedStatus({ all: true }));
});

// GET /api/wa/qr — 返回二维码图片（网页端扫码用）
router.get('/qr', async (req, res) => {
    const localOnly = req.query.local_only ***REMOVED***= '1' || req.get('X-WA-Proxy-Bypass') ***REMOVED***= '1';
    const rawQr = localOnly
        ? getQrValue()
        : await getRoutedQr({
            session_id: req.query.session_id,
            operator: req.query.operator,
            creator_id: req.query.creator_id ? parseInt(req.query.creator_id, 10) : null,
        });
    if (!rawQr) {
        return res.status(404).json({ ok: false, message: '无可用二维码' });
    }
    if (String(rawQr).startsWith('data:image/')) {
        return res.json({ ok: true, qr: rawQr });
    }
    try {
        const dataUrl = await QRCode.toDataURL(rawQr, {
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
