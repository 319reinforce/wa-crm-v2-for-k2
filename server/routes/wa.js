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
const {
    getLockedOwner,
    getLockedSessionId,
    matchesOwnerScope,
    resolveScopedOwner,
    sendOwnerScopeForbidden,
} = require('../middleware/appAuth');
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
    replaceRoutedContact,
} = require('../services/waSessionRouter');
const {
    listGroupChats,
    listGroupMessages,
} = require('../services/groupMessageService');
const { persistDirectMessageRecord } = require('../services/directMessagePersistenceService');
const {
    assertNoGroupSend,
} = require('../services/groupSendGuard');

function parsePositiveInt(value, fallback = null) {
    const n = parseInt(value, 10);
    return Number.isInteger(n) && n > 0 ? n : fallback;
}

function getRequestActor(req, explicit = '') {
    const candidate = String(explicit || req.get('X-Operator') || req.get('X-Actor') || 'api_user').trim();
    return candidate.slice(0, 64) || 'api_user';
}

function getEffectiveOperator(req, operator, fallback = null) {
    return resolveScopedOwner(req, operator, fallback);
}

function getEffectiveSessionId(req, sessionId = null) {
    return getLockedSessionId(req) || (sessionId ? String(sessionId).trim() : null);
}

function toBooleanFlag(value, fallback = true) {
    if (value === undefined) return fallback;
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value !== 0;
    const normalized = String(value || '').trim().toLowerCase();
    if (!normalized) return fallback;
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
    return fallback;
}

function ensureResolvedCreatorAccess(req, res, resolvedCreator) {
    if (!resolvedCreator?.ok) return resolvedCreator;
    const lockedOwner = getLockedOwner(req);
    if (lockedOwner && !matchesOwnerScope(req, resolvedCreator.creator?.wa_owner)) {
        sendOwnerScopeForbidden(res, lockedOwner);
        return null;
    }
    return resolvedCreator;
}

async function ensureGroupAccess(req, res, groupChatId) {
    const row = await db.getDb().prepare(
        'SELECT id, operator FROM wa_group_chats WHERE id = ? LIMIT 1'
    ).get(groupChatId);
    if (!row) {
        res.status(404).json({ ok: false, error: 'group not found' });
        return null;
    }
    const lockedOwner = getLockedOwner(req);
    if (lockedOwner && !matchesOwnerScope(req, row.operator)) {
        sendOwnerScopeForbidden(res, lockedOwner);
        return null;
    }
    return row;
}

async function resolveSendCreator({ creator_id, phone }) {
    const creatorId = parsePositiveInt(creator_id, null);
    const rawPhone = String(phone || '').trim();
    const targetGuard = assertNoGroupSend(rawPhone, { source: 'route.resolve_creator' });
    if (!targetGuard.ok) {
        return { ok: false, status: 400, error: targetGuard.error };
    }
    const normalizedPhone = normalizeDigits(rawPhone);
    const dbConn = db.getDb();
    const creatorCache = require('../services/creatorCache');

    if (!creatorId && !normalizedPhone && !rawPhone) {
        return { ok: false, status: 400, error: 'creator_id or phone required' };
    }

    if (creatorId) {
        const row = await creatorCache.getCreator(dbConn, creatorId, 'id, primary_name, wa_phone, wa_owner');
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

    let row = await creatorCache.getCreatorByPhone(dbConn, rawPhone, 'id, primary_name, wa_phone, wa_owner');
    if (!row && normalizedPhone !== rawPhone) {
        row = await creatorCache.getCreatorByPhone(dbConn, normalizedPhone, 'id, primary_name, wa_phone, wa_owner');
    }
    if (!row) {
        return { ok: false, status: 404, error: 'phone not found in creators' };
    }
    if (!row.wa_phone) {
        return { ok: false, status: 400, error: 'creator has empty wa_phone' };
    }
    return { ok: true, creator: row, phone: normalizeDigits(row.wa_phone) || String(row.wa_phone).trim() };
}

async function persistOutboundCrmMessage({
    req,
    creatorId,
    operator,
    text,
    timestamp = null,
    waMessageId = null,
}) {
    try {
        return await persistDirectMessageRecord({
            dbConn: db.getDb(),
            creatorId,
            role: 'me',
            operator,
            text,
            timestamp: timestamp || Date.now(),
            waMessageId,
            req,
            shortWindowGuard: false,
            groupConflictGuard: false,
        });
    } catch (err) {
        console.error('[WA Route] CRM persist error:', err);
        return {
            handled: true,
            persisted: false,
            duplicate: false,
            blocked: false,
            reason: 'crm_persist_error',
            error: err.message,
            timestamp: Number(timestamp) > 0 ? Number(timestamp) : Date.now(),
            operator: normalizeOperatorName(operator, operator || null),
            message_hash: null,
            wa_message_id: waMessageId || null,
            text: String(text || ''),
        };
    }
}

// POST /api/wa/send
router.post('/send', async (req, res) => {
    try {
        const { phone, text, session_id, operator, creator_id, persist_to_crm } = req.body || {};
        if (!text) {
            return res.status(400).json({ ok: false, error: 'text required' });
        }

        const resolvedCreator = ensureResolvedCreatorAccess(
            req,
            res,
            await resolveSendCreator({ creator_id, phone })
        );
        if (!resolvedCreator) return;
        if (!resolvedCreator.ok) {
            return res.status(resolvedCreator.status).json({ ok: false, error: resolvedCreator.error });
        }

        const effectiveOperator = getEffectiveOperator(req, operator, resolvedCreator.creator.wa_owner || null);
        const effectiveSessionId = getEffectiveSessionId(req, session_id);
        const persistToCrm = toBooleanFlag(persist_to_crm, true);
        const result = await sendRoutedMessage({
            phone: resolvedCreator.phone,
            text,
            session_id: effectiveSessionId,
            operator: effectiveOperator,
            creator_id: resolvedCreator.creator.id,
        });
        if (result.ok) {
            const crmMessage = persistToCrm
                ? await persistOutboundCrmMessage({
                    req,
                    creatorId: resolvedCreator.creator.id,
                    operator: result.routed_operator || effectiveOperator || resolvedCreator.creator.wa_owner || null,
                    text,
                    waMessageId: typeof result.messageId === 'string' && result.messageId.trim() ? result.messageId.trim() : null,
                })
                : {
                    handled: false,
                    persisted: false,
                    duplicate: false,
                    blocked: false,
                    reason: 'persist_disabled',
                    timestamp: Date.now(),
                    operator: result.routed_operator || effectiveOperator || resolvedCreator.creator.wa_owner || null,
                    message_hash: null,
                    text: String(text || ''),
                };
            res.json({
                ok: true,
                messageId: result.messageId,
                creator_id: resolvedCreator.creator.id,
                routed_session_id: result.routed_session_id || effectiveSessionId || null,
                routed_operator: result.routed_operator || effectiveOperator || resolvedCreator.creator.wa_owner || null,
                crm_message: crmMessage,
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
        const { creator_id, phone, session_id, operator, fetch_limit, full_dedup } = req.body || {};
        if (!creator_id && !phone) {
            return res.status(400).json({ ok: false, error: 'creator_id or phone required' });
        }

        const resolvedCreator = ensureResolvedCreatorAccess(
            req,
            res,
            await resolveSendCreator({ creator_id, phone })
        );
        if (!resolvedCreator) return;
        if (!resolvedCreator.ok) {
            return res.status(resolvedCreator.status).json({ ok: false, error: resolvedCreator.error });
        }

        const result = await reconcileRoutedContact({
            creator_id: resolvedCreator.creator.id,
            phone: resolvedCreator.phone,
            session_id: getEffectiveSessionId(req, session_id),
            operator: getEffectiveOperator(req, operator, resolvedCreator.creator.wa_owner || null),
            fetch_limit: parsePositiveInt(fetch_limit, 500),
            full_dedup: full_dedup === undefined ? true : (full_dedup === true || full_dedup === 'true' || full_dedup === 1 || full_dedup === '1'),
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
        const { creator_id, phone, session_id, operator, fetch_limit, full_dedup } = req.body || {};
        if (!creator_id && !phone) {
            return res.status(400).json({ ok: false, error: 'creator_id or phone required' });
        }

        const resolvedCreator = ensureResolvedCreatorAccess(
            req,
            res,
            await resolveSendCreator({ creator_id, phone })
        );
        if (!resolvedCreator) return;
        if (!resolvedCreator.ok) {
            return res.status(resolvedCreator.status).json({ ok: false, error: resolvedCreator.error });
        }

        const result = await syncRoutedContact({
            creator_id: resolvedCreator.creator.id,
            phone: resolvedCreator.phone,
            session_id: getEffectiveSessionId(req, session_id),
            operator: getEffectiveOperator(req, operator, resolvedCreator.creator.wa_owner || null),
            fetch_limit: parsePositiveInt(fetch_limit, 200),
            full_dedup: full_dedup === true || full_dedup === 'true' || full_dedup === 1 || full_dedup === '1',
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

// POST /api/wa/replace-contact
// 按手机号/creator 定向拉取原始聊天并替换时间窗内全部消息
router.post('/replace-contact', async (req, res) => {
    try {
        const { creator_id, phone, session_id, operator, fetch_limit, force, delete_all, full_dedup } = req.body || {};
        if (!creator_id && !phone) {
            return res.status(400).json({ ok: false, error: 'creator_id or phone required' });
        }

        const resolvedCreator = ensureResolvedCreatorAccess(
            req,
            res,
            await resolveSendCreator({ creator_id, phone })
        );
        if (!resolvedCreator) return;
        if (!resolvedCreator.ok) {
            return res.status(resolvedCreator.status).json({ ok: false, error: resolvedCreator.error });
        }

        const result = await replaceRoutedContact({
            creator_id: resolvedCreator.creator.id,
            phone: resolvedCreator.phone,
            session_id: getEffectiveSessionId(req, session_id),
            operator: getEffectiveOperator(req, operator, resolvedCreator.creator.wa_owner || null),
            fetch_limit: parsePositiveInt(fetch_limit, 800),
            force: force === true || force === 'true' || force === 1 || force === '1',
            delete_all: delete_all === true || delete_all === 'true' || delete_all === 1 || delete_all === '1',
            full_dedup: full_dedup === undefined ? true : (full_dedup === true || full_dedup === 'true' || full_dedup === 1 || full_dedup === '1'),
        });
        if (!result.ok) {
            return res.status(400).json(result);
        }
        res.json(result);
    } catch (err) {
        console.error('[WA Route] replace-contact error:', err);
        res.status(500).json({ ok: false, error: err.message });
    }
});

// GET /api/wa/groups
router.get('/groups', async (req, res) => {
    try {
        const operator = getEffectiveOperator(req, req.query.operator, '');
        const groups = await listGroupChats({
            operator: operator || '',
            sessionId: getEffectiveSessionId(req, req.query.session_id ? String(req.query.session_id).trim() : ''),
            search: req.query.search ? String(req.query.search).trim() : '',
            limit: parsePositiveInt(req.query.limit, 200),
        });
        res.json({
            groups,
            total: groups.length,
        });
    } catch (err) {
        console.error('[WA Route] groups error:', err);
        res.status(500).json({ ok: false, error: err.message });
    }
});

// GET /api/wa/groups/:id/messages
router.get('/groups/:id/messages', async (req, res) => {
    try {
        const groupChatId = parsePositiveInt(req.params.id, null);
        if (!groupChatId) {
            return res.status(400).json({ ok: false, error: 'invalid group id' });
        }
        const groupRow = await ensureGroupAccess(req, res, groupChatId);
        if (!groupRow) return;
        const payload = await listGroupMessages(groupChatId, {
            limit: parsePositiveInt(req.query.limit, 100),
            offset: Math.max(parseInt(req.query.offset, 10) || 0, 0),
        });
        res.json(payload);
    } catch (err) {
        console.error('[WA Route] group messages error:', err);
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

        let creatorRow = null;
        if (creatorId) {
            creatorRow = await creatorCache.getCreator(db.getDb(), creatorId, 'id, wa_owner');
            if (!creatorRow) {
                return res.status(404).json({ ok: false, error: 'creator_id not found' });
            }
            const lockedOwner = getLockedOwner(req);
            if (lockedOwner && !matchesOwnerScope(req, creatorRow.wa_owner)) {
                return sendOwnerScopeForbidden(res, lockedOwner);
            }
        }

        const asset = await createMediaAsset({
            creatorId,
            operator: getEffectiveOperator(req, operator, creatorRow?.wa_owner || null),
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
            persist_to_crm,
        } = req.body || {};
        const mediaId = parsePositiveInt(media_id, null);
        if (!mediaId) {
            return res.status(400).json({ ok: false, error: 'media_id required' });
        }

        const asset = await getActiveMediaAssetById(mediaId);
        if (!asset) {
            return res.status(404).json({ ok: false, error: 'media asset not found or inactive' });
        }

        const resolvedCreator = ensureResolvedCreatorAccess(
            req,
            res,
            await resolveSendCreator({
                creator_id: parsePositiveInt(creator_id, null) || parsePositiveInt(asset.creator_id, null),
                phone,
            })
        );
        if (!resolvedCreator) return;
        if (!resolvedCreator.ok) {
            return res.status(resolvedCreator.status).json({ ok: false, error: resolvedCreator.error });
        }

        const resolvedCreatorId = resolvedCreator.creator.id;
        const effectiveOperator = getEffectiveOperator(req, operator, resolvedCreator.creator.wa_owner || asset.operator || null);
        const effectiveSessionId = getEffectiveSessionId(req, session_id);
        sendLogId = await createMediaSendLog({
            mediaAssetId: mediaId,
            creatorId: resolvedCreatorId,
            phone: resolvedCreator.phone,
            sessionId: effectiveSessionId || null,
            operator: effectiveOperator,
            caption: caption || null,
            sentBy: getRequestActor(req, sent_by),
        });

        const persistToCrm = toBooleanFlag(persist_to_crm, true);
        const result = await sendRoutedMedia({
            phone: resolvedCreator.phone,
            caption,
            media_asset_id: mediaId,
            media_path: asset.file_path || null,
            media_url: asset.file_url || null,
            mime_type: asset.mime_type || null,
            file_name: asset.file_name || null,
            session_id: effectiveSessionId,
            operator: effectiveOperator,
            creator_id: resolvedCreatorId,
        });

        if (result.ok) {
            await finalizeMediaSendLogSuccess(sendLogId, {
                waMessageId: result.messageId || null,
                routedSessionId: result.routed_session_id || effectiveSessionId || null,
                routedOperator: result.routed_operator || effectiveOperator || null,
            });
            const timelineText = caption ? `🖼️ [Image] ${caption}` : '🖼️ [Image]';
            const crmMessage = persistToCrm
                ? await persistOutboundCrmMessage({
                    req,
                    creatorId: resolvedCreatorId,
                    operator: result.routed_operator || effectiveOperator || resolvedCreator.creator.wa_owner || null,
                    text: timelineText,
                })
                : {
                    handled: false,
                    persisted: false,
                    duplicate: false,
                    blocked: false,
                    reason: 'persist_disabled',
                    timestamp: Date.now(),
                    operator: result.routed_operator || effectiveOperator || resolvedCreator.creator.wa_owner || null,
                    message_hash: null,
                    text: timelineText,
                };
            return res.json({
                ok: true,
                messageId: result.messageId,
                send_log_id: sendLogId,
                routed_session_id: result.routed_session_id || effectiveSessionId || null,
                routed_operator: result.routed_operator || effectiveOperator || null,
                crm_message: crmMessage,
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
    const all = req.query.all === '1' && !getLockedOwner(req);
    res.json(await getRoutedStatus({
        all,
        session_id: getEffectiveSessionId(req, req.query.session_id),
        operator: getEffectiveOperator(req, req.query.operator, null),
        creator_id: req.query.creator_id ? parseInt(req.query.creator_id, 10) : null,
    }));
});

// GET /api/wa/qr — 返回二维码图片（网页端扫码用）
router.get('/qr', async (req, res) => {
    const rawQr = await getRoutedQr({
        session_id: getEffectiveSessionId(req, req.query.session_id),
        operator: getEffectiveOperator(req, req.query.operator, null),
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
