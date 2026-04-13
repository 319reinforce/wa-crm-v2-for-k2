/**
 * WhatsApp 路由 — 单账号版本
 * POST /api/wa/send — 发送消息
 * GET  /api/wa/status — 查询状态
 * GET  /api/wa/qr — 获取二维码（终端显示，网页端不再提供）
 */
const express = require('express');
const router = express.Router();
const QRCode = require('qrcode');
const db = require('../../db');
const { getQrValue } = require('../services/waService');
const { normalizeOperatorName, normalizeDigits } = require('../utils/operator');
const {
    MEDIA_UPLOAD_MAX_BYTES,
    ensureMediaSchema,
    createMediaAsset,
    getActiveMediaAssetById,
    createMediaSendLog,
    finalizeMediaSendLogSuccess,
    finalizeMediaSendLogFailed,
} = require('../services/mediaAssetService');
const {
    getRoutedQr,
    getRoutedStatus,
    reconcileRoutedContact,
    sendRoutedMessage,
    sendRoutedMedia,
    syncRoutedContact,
} = require('../services/waSessionRouter');

function parsePositiveInt(value, fallback = null) {
    const n = parseInt(value, 10);
    return Number.isInteger(n) && n > 0 ? n : fallback;
}

function getRequestActor(req, explicit = '') {
    const candidate = String(explicit || req.get('X-Operator') || req.get('X-Actor') || 'api_user').trim();
    return candidate.slice(0, 64) || 'api_user';
}

async function resolveSendCreator({ creator_id, phone }) {
    const creatorId = parsePositiveInt(creator_id, null);
    const rawPhone = String(phone || '').trim();
    const normalizedPhone = normalizeDigits(rawPhone);
    const dbConn = db.getDb();

    if (!creatorId && !normalizedPhone && !rawPhone) {
        return { ok: false, status: 400, error: 'creator_id or phone required' };
    }

    if (creatorId) {
        const row = await dbConn.prepare('SELECT id, primary_name, wa_phone, wa_owner FROM creators WHERE id = ? LIMIT 1').get(creatorId);
        if (!row) {
            return { ok: false, status: 404, error: 'creator_id not found' };
        }
        if (!row.wa_phone) {
            return { ok: false, status: 400, error: 'creator has empty wa_phone' };
        }
        if (normalizedPhone) {
            const creatorPhoneDigits = normalizeDigits(row.wa_phone);
            if (creatorPhoneDigits && creatorPhoneDigits !== normalizedPhone) {
                return { ok: false, status: 400, error: 'phone does not match creator_id wa_phone' };
            }
        }
        return { ok: true, creator: row, phone: normalizeDigits(row.wa_phone) || String(row.wa_phone).trim() };
    }

    const row = await dbConn.prepare(
        'SELECT id, primary_name, wa_phone, wa_owner FROM creators WHERE wa_phone = ? OR wa_phone = ? LIMIT 1'
    ).get(rawPhone, normalizedPhone);
    if (!row) {
        return { ok: false, status: 404, error: 'phone not found in creators' };
    }
    if (!row.wa_phone) {
        return { ok: false, status: 400, error: 'creator has empty wa_phone' };
    }
    return { ok: true, creator: row, phone: normalizeDigits(row.wa_phone) || String(row.wa_phone).trim() };
}

// POST /api/wa/send
router.post('/send', async (req, res) => {
    try {
        const { phone, text, session_id, operator, creator_id } = req.body || {};
        if (!text) {
            return res.status(400).json({ ok: false, error: 'text required' });
        }

        const resolvedCreator = await resolveSendCreator({ creator_id, phone });
        if (!resolvedCreator.ok) {
            return res.status(resolvedCreator.status).json({ ok: false, error: resolvedCreator.error });
        }

        const bypass = req.get('X-WA-Proxy-Bypass') === '1';
        const result = await sendRoutedMessage(
            {
                phone: resolvedCreator.phone,
                text,
                session_id,
                operator: normalizeOperatorName(operator, operator || resolvedCreator.creator.wa_owner || null),
                creator_id: resolvedCreator.creator.id,
            },
            { bypass }
        );
        if (result.ok) {
            res.json({
                ok: true,
                messageId: result.messageId,
                creator_id: resolvedCreator.creator.id,
                wa_phone: resolvedCreator.phone,
                routed_session_id: result.routed_session_id || session_id || null,
                routed_operator: result.routed_operator || operator || resolvedCreator.creator.wa_owner || null,
            });
        } else {
            res.status(400).json({ ok: false, error: result.error });
        }
    } catch (err) {
        console.error('[WA Route] send error:', err);
        res.status(500).json({ ok: false, error: err.message });
    }
});

// POST /api/wa/reconcile-contact
// 按手机号/creator 定向重爬原始聊天并修复 CRM 消息
router.post('/reconcile-contact', async (req, res) => {
    try {
        const { creator_id, phone, session_id, operator, fetch_limit } = req.body || {};
        if (!creator_id && !phone) {
            return res.status(400).json({ ok: false, error: 'creator_id or phone required' });
        }

        const result = await reconcileRoutedContact({
            creator_id: parsePositiveInt(creator_id, null),
            phone: phone ? String(phone).trim() : '',
            session_id,
            operator,
            fetch_limit: parsePositiveInt(fetch_limit, 500),
        });
        if (!result.ok) {
            return res.status(400).json(result);
        }
        res.json(result);
    } catch (err) {
        console.error('[WA Route] reconcile-contact error:', err);
        res.status(500).json({ ok: false, error: err.message });
    }
});

// POST /api/wa/sync-contact
// 按手机号/creator 定向拉取最近原始聊天并补齐最新消息，不做重度修复
router.post('/sync-contact', async (req, res) => {
    try {
        const { creator_id, phone, session_id, operator, fetch_limit } = req.body || {};
        if (!creator_id && !phone) {
            return res.status(400).json({ ok: false, error: 'creator_id or phone required' });
        }

        const result = await syncRoutedContact({
            creator_id: parsePositiveInt(creator_id, null),
            phone: phone ? String(phone).trim() : '',
            session_id,
            operator,
            fetch_limit: parsePositiveInt(fetch_limit, 200),
        });
        if (!result.ok) {
            return res.status(400).json(result);
        }
        res.json(result);
    } catch (err) {
        console.error('[WA Route] sync-contact error:', err);
        res.status(500).json({ ok: false, error: err.message });
    }
});

// POST /api/wa/media-assets
// 上传图片资产（MVP: base64 JSON）
router.post('/media-assets', async (req, res) => {
    try {
        await ensureMediaSchema();
        const {
            creator_id,
            operator,
            uploaded_by,
            file_name,
            mime_type,
            data_base64,
            file_url,
            file_size,
            meta,
        } = req.body || {};
        const creatorId = parsePositiveInt(creator_id, null);
        if (!file_name || !mime_type || (!data_base64 && !file_url)) {
            return res.status(400).json({
                ok: false,
                error: 'file_name, mime_type, and (data_base64 or file_url) are required',
                upload_max_bytes: MEDIA_UPLOAD_MAX_BYTES,
            });
        }

        if (creatorId) {
            const creatorRow = await db.getDb().prepare('SELECT id FROM creators WHERE id = ?').get(creatorId);
            if (!creatorRow) {
                return res.status(404).json({ ok: false, error: 'creator_id not found' });
            }
        }

        const asset = await createMediaAsset({
            creatorId,
            operator: normalizeOperatorName(operator, operator || null),
            uploadedBy: getRequestActor(req, uploaded_by),
            fileName: file_name,
            mimeType: mime_type,
            dataBase64: data_base64,
            sourceUrl: file_url || '',
            sourceSize: file_size || null,
            meta: meta && typeof meta === 'object' ? meta : {},
        });

        res.json({
            ok: true,
            media_asset: {
                id: asset.id,
                creator_id: asset.creator_id,
                operator: asset.operator,
                uploaded_by: asset.uploaded_by,
                file_name: asset.file_name,
                mime_type: asset.mime_type,
                file_size: asset.file_size,
                file_url: asset.file_url,
                storage_provider: asset.storage_provider,
                status: asset.status,
                created_at: asset.created_at,
            },
        });
    } catch (err) {
        console.error('[WA Route] media upload error:', err);
        res.status(500).json({
            ok: false,
            error: err.message,
            upload_max_bytes: MEDIA_UPLOAD_MAX_BYTES,
        });
    }
});

// POST /api/wa/send-media
// 发送图片消息（可选 caption）
router.post('/send-media', async (req, res) => {
    let sendLogId = null;
    try {
        await ensureMediaSchema();
        const {
            phone,
            media_id,
            caption = '',
            session_id,
            operator,
            creator_id,
            sent_by,
        } = req.body || {};
        const mediaId = parsePositiveInt(media_id, null);
        const creatorId = parsePositiveInt(creator_id, null);
        if (!phone || !mediaId) {
            return res.status(400).json({ ok: false, error: 'phone and media_id required' });
        }

        const asset = await getActiveMediaAssetById(mediaId);
        if (!asset) {
            return res.status(404).json({ ok: false, error: 'media asset not found or inactive' });
        }

        const resolvedCreatorId = creatorId || parsePositiveInt(asset.creator_id, null);
        sendLogId = await createMediaSendLog({
            mediaAssetId: mediaId,
            creatorId: resolvedCreatorId,
            phone,
            sessionId: session_id || null,
            operator: normalizeOperatorName(operator, operator || asset.operator || null),
            caption: caption || null,
            sentBy: getRequestActor(req, sent_by),
        });

        const bypass = req.get('X-WA-Proxy-Bypass') === '1';
        const result = await sendRoutedMedia({
            phone,
            caption,
            media_asset_id: mediaId,
            media_path: asset.file_path || null,
            media_url: asset.file_url || null,
            mime_type: asset.mime_type || null,
            file_name: asset.file_name || null,
            session_id,
            operator: normalizeOperatorName(operator, operator || asset.operator || null),
            creator_id: resolvedCreatorId,
        }, { bypass });

        if (result.ok) {
            await finalizeMediaSendLogSuccess(sendLogId, {
                waMessageId: result.messageId || null,
                routedSessionId: result.routed_session_id || session_id || null,
                routedOperator: result.routed_operator || operator || null,
            });
            return res.json({
                ok: true,
                messageId: result.messageId,
                send_log_id: sendLogId,
                routed_session_id: result.routed_session_id || session_id || null,
                routed_operator: result.routed_operator || operator || null,
            });
        }

        await finalizeMediaSendLogFailed(sendLogId, result.error || 'send media failed');
        return res.status(400).json({
            ok: false,
            error: result.error || 'send media failed',
            send_log_id: sendLogId,
        });
    } catch (err) {
        console.error('[WA Route] send-media error:', err);
        if (sendLogId) {
            try {
                await finalizeMediaSendLogFailed(sendLogId, err.message);
            } catch (_) {}
        }
        res.status(500).json({ ok: false, error: err.message, send_log_id: sendLogId });
    }
});

// GET /api/wa/status
router.get('/status', async (req, res) => {
    const localOnly = req.query.local_only === '1' || req.get('X-WA-Proxy-Bypass') === '1';
    const all = req.query.all === '1' && !localOnly;
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
    const localOnly = req.query.local_only === '1' || req.get('X-WA-Proxy-Bypass') === '1';
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
