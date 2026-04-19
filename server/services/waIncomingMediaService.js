/**
 * waIncomingMediaService.js
 *
 * 处理 incoming WhatsApp 消息中的媒体下载和存储。
 *
 * 核心函数：downloadAndStoreIncomingMedia(msg, { creatorId, operator })
 *   - 检测 msg.hasMedia
 *   - 调用 msg.downloadMedia() 获取媒体数据
 *   - 存储到 media_assets 表（SHA256 内容去重）
 *   - 返回 { mediaAssetId, mediaType, mime, size, width, height, caption, thumbnail }
 *
 * 支持类型：图片（jpeg/png/webp/gif）+ 视频（mp4/mov/webm/3gp）+ 音频（ogg/mp3/wav/opus）+ PDF
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const db = require('../../db');
const {
    ensureMediaSchema,
    normalizeMimeType,
    ALLOWED_IMAGE_MIME,
    VIDEO_AUDIO_MIME,
} = require('./mediaAssetService');

const LOG_PREFIX = '[IncomingMedia]';

const MIME_EXT = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'video/mp4': 'mp4',
    'video/quicktime': 'mov',
    'video/webm': 'webm',
    'video/3gpp': '3gp',
    'audio/ogg': 'ogg',
    'audio/mpeg': 'mp3',
    'audio/wav': 'wav',
    'audio/opus': 'opus',
    'application/pdf': 'pdf',
};

// incoming media 文件大小限制（默认 50MB，WhatsApp 视频最大约 16MB）
const WA_INCOMING_MEDIA_MAX_BYTES = Math.max(
    parseInt(process.env.WA_INCOMING_MEDIA_MAX_BYTES || `${50 * 1024 * 1024}`, 10)
    || (50 * 1024 * 1024),
    256 * 1024
);

function extFromMime(mimeType) {
    return MIME_EXT[mimeType] || 'bin';
}

function sha256Buffer(buffer) {
    return crypto.createHash('sha256').update(buffer).digest('hex');
}

function buildIncomingMediaKey(hash, ext) {
    const now = new Date();
    const y = String(now.getFullYear());
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return `wa-incoming/${y}/${m}/${d}/${hash}.${ext}`;
}

function toPublicUrl(storageKey) {
    const base = String(process.env.MEDIA_PUBLIC_BASE_URL || '').trim().replace(/\/+$/, '');
    if (!base) return null;
    return `${base}/${storageKey}`;
}

function ensureParentDir(filePath) {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

/**
 * 根据 MIME type 返回 media_type 分类。
 */
function mediaTypeFromMime(mimeType) {
    const type = String(mimeType || '').split('/')[0];
    if (type === 'image') return 'image';
    if (type === 'video') return 'video';
    if (type === 'audio') return 'audio';
    if (type === 'application') return 'document';
    return type || 'unknown';
}

/**
 * 检查是否支持该 MIME 类型。
 * 支持：图片 + 视频 + 音频 + PDF
 */
function isAllowedMimeType(mimeType) {
    const normalized = String(mimeType || '').toLowerCase().trim();
    return ALLOWED_IMAGE_MIME.has(normalized) || VIDEO_AUDIO_MIME.has(normalized);
}

/**
 * 将 base64 data URL 或纯 base64 字符串解码为 Buffer。
 */
function decodeDataUrl(data) {
    if (!data) return null;
    const raw = String(data).trim();
    const match = raw.match(/^data:[^;]+;base64,(.+)$/i);
    if (match) {
        return Buffer.from(match[1], 'base64');
    }
    return Buffer.from(raw, 'base64');
}

/**
 * 创建 incoming media asset 记录（写入文件 + 写入 media_assets 表）。
 * 支持 SHA256 内容去重：相同 hash 的媒体只存储一份。
 *
 * @param {object} opts
 * @param {Buffer} opts.buffer         - 媒体文件内容
 * @param {string} opts.mimeType      - MIME 类型，如 'image/jpeg'
 * @param {number|null} opts.creatorId - creator ID（可为 null）
 * @param {string|null} opts.operator  - operator 名称
 * @param {string|null} opts.waMessageId - 对应的 WhatsApp 消息 ID
 * @param {number|null} opts.width    - 图片宽度
 * @param {number|null} opts.height   - 图片高度
 * @param {string|null} opts.caption  - caption 文本
 * @param {string|null} opts.thumbnail - base64 缩略图
 * @returns {object|null} media_assets 记录行，或 null（去重命中时返回已有记录）
 */
async function createIncomingMediaAsset({
    buffer,
    mimeType,
    creatorId = null,
    operator = null,
    waMessageId = null,
    width = null,
    height = null,
    caption = '',
    thumbnail = null,
}) {
    await ensureMediaSchema();

    if (!buffer || buffer.length === 0) {
        throw new Error('empty buffer payload');
    }

    const normalizedMime = normalizeMimeType(mimeType);
    if (!isAllowedMimeType(normalizedMime)) {
        throw new Error(`unsupported mime_type: ${normalizedMime}`);
    }

    if (buffer.length > WA_INCOMING_MEDIA_MAX_BYTES) {
        throw new Error(`incoming media too large: ${buffer.length} bytes > ${WA_INCOMING_MEDIA_MAX_BYTES}`);
    }

    const hash = sha256Buffer(buffer);
    const ext = extFromMime(normalizedMime);
    const storageKey = buildIncomingMediaKey(hash, ext);

    const db2 = db.getDb();

    // SHA256 内容去重
    const existing = await db2.prepare(
        'SELECT id, file_url, file_size, created_at FROM media_assets WHERE sha256_hash = ? AND status = ? LIMIT 1'
    ).get(hash, 'active');

    if (existing) {
        console.log(`${LOG_PREFIX} dedup hit: hash=${hash.slice(0, 12)}... existing_id=${existing.id}`);
        return existing;
    }

    // 写入本地文件
    const mediaLocalDir = path.resolve(
        process.env.MEDIA_LOCAL_DIR || path.join(process.cwd(), 'data', 'media-assets')
    );
    const filePath = path.join(mediaLocalDir, storageKey);
    ensureParentDir(filePath);
    fs.writeFileSync(filePath, buffer);

    const fileUrl = toPublicUrl(storageKey);
    const fileName = `wa_${hash.slice(0, 12)}.${ext}`;

    const meta = {
        source: 'whatsapp_incoming',
        wa_message_id: waMessageId,
        width,
        height,
    };

    const result = await db2.prepare(`
        INSERT INTO media_assets
        (creator_id, operator, storage_provider, storage_key, file_path, file_url, file_name,
         mime_type, file_size, sha256_hash, status, meta_json)
        VALUES (?, ?, 'local', ?, ?, ?, ?, ?, ?, ?, 'active', ?)
    `).run(
        creatorId || null,
        operator || null,
        storageKey,
        filePath,
        fileUrl,
        fileName,
        normalizedMime,
        buffer.length,
        hash,
        JSON.stringify(meta)
    );

    const insertedId = result.lastInsertRowid;
    const row = await db2.prepare('SELECT * FROM media_assets WHERE id = ?').get(insertedId);
    console.log(`${LOG_PREFIX} stored: id=${insertedId} hash=${hash.slice(0, 12)}... mime=${normalizedMime} size=${buffer.length}`);
    return row;
}

/**
 * 从 WhatsApp 消息下载并存储媒体。
 *
 * @param {object} msg  - wwebjs Message 对象
 * @param {object} opts
 * @param {number|null} opts.creatorId
 * @param {string|null} opts.operator
 * @returns {object|null} 媒体下载结果，或 null（无媒体/不支持/下载失败）
 *
 * 返回值结构：
 *   {
 *     mediaAssetId: number,       // media_assets.id
 *     mediaType: string,         // 'image'
 *     mime: string,              // 'image/jpeg'
 *     size: number,              // bytes
 *     width: number|null,
 *     height: number|null,
 *     caption: string|null,
 *     thumbnail: string|null,
 *   }
 */
async function downloadAndStoreIncomingMedia(msg, { creatorId, operator }) {
    if (!msg?.hasMedia) {
        return null;
    }

    const mimeType = msg.mimetype || '';
    if (!isAllowedMimeType(mimeType)) {
        console.warn(`${LOG_PREFIX} unsupported mime: ${mimeType}, skipping`);
        return null;
    }

    let mediaData = null;
    let lastError = null;

    // 最多重试 2 次（处理临时网络抖动）
    for (let attempt = 1; attempt <= 2; attempt++) {
        try {
            mediaData = await Promise.race([
                msg.downloadMedia(),
                new Promise((_, reject) =>
                    setTimeout(() => reject(new Error('download_timeout')), 30000)
                ),
            ]);
            if (mediaData?.data) break;
        } catch (err) {
            lastError = err;
            if (attempt < 2) {
                console.warn(`${LOG_PREFIX} download attempt ${attempt} failed: ${err.message}, retrying...`);
                await new Promise((r) => setTimeout(r, 2000 * attempt));
            }
        }
    }

    if (!mediaData?.data) {
        console.error(`${LOG_PREFIX} download failed after retries: ${lastError?.message}`);
        return null;
    }

    const buffer = decodeDataUrl(mediaData.data);
    if (!buffer || buffer.length === 0) {
        console.error(`${LOG_PREFIX} empty media data after decode`);
        return null;
    }

    const waMessageId = typeof msg.id === 'string'
        ? msg.id
        : msg.id?._serialized || msg.id?.id || null;

    const asset = await createIncomingMediaAsset({
        buffer,
        mimeType,
        creatorId,
        operator,
        waMessageId,
        width: msg.width || null,
        height: msg.height || null,
        caption: (msg.body || msg.caption || '').trim() || null,
        thumbnail: msg.thumbnailUrl || null,
    });

    return {
        mediaAssetId: asset.id,
        mediaType: mediaTypeFromMime(mimeType),
        mime: mimeType,
        size: buffer.length,
        width: msg.width || null,
        height: msg.height || null,
        caption: (msg.body || msg.caption || '').trim() || null,
        thumbnail: msg.thumbnailUrl || null,
    };
}

module.exports = {
    downloadAndStoreIncomingMedia,
    createIncomingMediaAsset,
    isAllowedMimeType,
    mediaTypeFromMime,
    ALLOWED_IMAGE_MIME,
    VIDEO_AUDIO_MIME,
};
