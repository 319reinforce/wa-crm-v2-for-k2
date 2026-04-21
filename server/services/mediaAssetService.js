const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const db = require('../../db');

let mediaCompressionService = null;
try {
    mediaCompressionService = require('./mediaCompressionService');
} catch (_) {}

const ALLOWED_IMAGE_MIME = new Set([
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
]);
const VIDEO_AUDIO_MIME = new Set([
    'video/mp4',
    'video/quicktime',
    'video/webm',
    'video/3gpp',
    'audio/ogg',
    'audio/mpeg',
    'audio/wav',
    'audio/opus',
    'application/pdf',
]);
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
const MEDIA_UPLOAD_MAX_BYTES = Math.max(parseInt(process.env.MEDIA_UPLOAD_MAX_BYTES || `${8 * 1024 * 1024}`, 10) || (8 * 1024 * 1024), 256 * 1024);
const MEDIA_LOCAL_DIR = path.resolve(process.env.MEDIA_LOCAL_DIR || path.join(process.cwd(), 'data', 'media-assets'));
const MEDIA_STORAGE_PROVIDER = String(process.env.MEDIA_STORAGE_PROVIDER || 'local').trim().toLowerCase();
const MEDIA_PUBLIC_BASE_URL = String(process.env.MEDIA_PUBLIC_BASE_URL || '').trim().replace(/\/+$/, '');

let schemaEnsured = false;

function ensureDir(dirPath) {
    fs.mkdirSync(dirPath, { recursive: true });
}

function ensureParentDir(filePath) {
    ensureDir(path.dirname(filePath));
}

function sha256Buffer(buffer) {
    return crypto.createHash('sha256').update(buffer).digest('hex');
}

function sha256Text(text) {
    return crypto.createHash('sha256').update(String(text || '')).digest('hex');
}

function normalizeMimeType(value) {
    return String(value || '').trim().toLowerCase();
}

function sanitizeFileName(fileName, fallbackExt = 'bin') {
    const raw = String(fileName || '').trim();
    const clean = raw.replace(/[^\w.\-() ]+/g, '_').slice(0, 120);
    if (clean) return clean;
    return `upload_${Date.now()}.${fallbackExt}`;
}

function extForMime(mimeType) {
    return MIME_EXT[mimeType] || 'bin';
}

function parseBase64Payload(input) {
    const raw = String(input || '').trim();
    if (!raw) throw new Error('data_base64 is empty');
    const dataUrlMatch = raw.match(/^data:([^;]+);base64,(.+)$/i);
    if (dataUrlMatch) {
        return {
            mimeFromDataUrl: normalizeMimeType(dataUrlMatch[1]),
            base64: dataUrlMatch[2],
        };
    }
    return {
        mimeFromDataUrl: '',
        base64: raw,
    };
}

function decodeImageBuffer(dataBase64) {
    const { mimeFromDataUrl, base64 } = parseBase64Payload(dataBase64);
    const buffer = Buffer.from(base64, 'base64');
    if (!buffer || buffer.length === 0) {
        throw new Error('invalid base64 payload');
    }
    return { buffer, mimeFromDataUrl };
}

function buildStorageKey(ext) {
    const now = new Date();
    const y = String(now.getFullYear());
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    const rand = crypto.randomBytes(5).toString('hex');
    return `${y}/${m}/${d}/${Date.now()}_${rand}.${ext}`;
}

function toPublicUrl(storageKey) {
    if (!MEDIA_PUBLIC_BASE_URL) return null;
    return `${MEDIA_PUBLIC_BASE_URL}/${storageKey}`;
}

async function ensureMediaSchema() {
    if (schemaEnsured) return;
    const db2 = db.getDb();
    await db2.prepare(`
        CREATE TABLE IF NOT EXISTS media_assets (
            id BIGINT AUTO_INCREMENT PRIMARY KEY,
            creator_id INT NULL,
            operator VARCHAR(32) NULL,
            uploaded_by VARCHAR(64) NULL,
            storage_provider VARCHAR(16) NOT NULL DEFAULT 'local',
            storage_key VARCHAR(255) NOT NULL,
            file_path TEXT NULL,
            file_url TEXT NULL,
            file_name VARCHAR(255) NOT NULL,
            mime_type VARCHAR(64) NOT NULL,
            file_size BIGINT NOT NULL,
            sha256_hash VARCHAR(64) NOT NULL,
            status VARCHAR(16) NOT NULL DEFAULT 'active',
            meta_json JSON NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            INDEX idx_media_assets_creator (creator_id),
            INDEX idx_media_assets_status (status),
            INDEX idx_media_assets_hash (sha256_hash)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `).run();
    await db2.prepare(`
        CREATE TABLE IF NOT EXISTS media_send_log (
            id BIGINT AUTO_INCREMENT PRIMARY KEY,
            media_asset_id BIGINT NOT NULL,
            creator_id INT NULL,
            phone VARCHAR(32) NOT NULL,
            session_id VARCHAR(64) NULL,
            operator VARCHAR(32) NULL,
            caption TEXT NULL,
            status VARCHAR(16) NOT NULL DEFAULT 'pending',
            error_message TEXT NULL,
            wa_message_id VARCHAR(255) NULL,
            routed_session_id VARCHAR(64) NULL,
            routed_operator VARCHAR(32) NULL,
            sent_by VARCHAR(64) NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            sent_at DATETIME NULL,
            INDEX idx_media_send_creator (creator_id, created_at),
            INDEX idx_media_send_status (status, created_at),
            INDEX idx_media_send_media_asset (media_asset_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `).run();
    schemaEnsured = true;
}

async function createMediaAsset({
    creatorId = null,
    operator = null,
    uploadedBy = null,
    fileName,
    mimeType,
    dataBase64,
    sourceUrl = '',
    sourceSize = null,
    meta = {},
}) {
    await ensureMediaSchema();
    const normalizedMime = normalizeMimeType(mimeType);
    if (!ALLOWED_IMAGE_MIME.has(normalizedMime)) {
        throw new Error(`unsupported mime_type: ${normalizedMime || '(empty)'}`);
    }

    let buffer = null;
    let filePath = null;
    let fileUrl = null;
    let fileSize = 0;
    let hash = '';
    let storageKey = '';
    let storageProvider = MEDIA_STORAGE_PROVIDER || 'local';
    let processedMime = normalizedMime;
    let metaOut = { ...meta };
    if (sourceUrl) {
        let parsed = null;
        try {
            parsed = new URL(String(sourceUrl));
        } catch (_) {}
        if (!parsed || !/^https?:$/.test(parsed.protocol)) {
            throw new Error('invalid source_url');
        }
        fileUrl = parsed.toString();
        storageKey = String(parsed.pathname || '').replace(/^\/+/, '') || `external/${Date.now()}`;
        fileSize = Math.max(parseInt(sourceSize || '0', 10) || 0, 0);
        hash = sha256Text(fileUrl);
        storageProvider = storageProvider === 'local' ? 'external' : storageProvider;
    } else {
        const decoded = decodeImageBuffer(dataBase64);
        buffer = decoded.buffer;
        if (!normalizedMime && decoded.mimeFromDataUrl) {
            mimeType = decoded.mimeFromDataUrl;
        }
        if (!buffer || buffer.length === 0) {
            throw new Error('empty image payload');
        }
        if (buffer.length > MEDIA_UPLOAD_MAX_BYTES) {
            throw new Error(`file too large: ${buffer.length} bytes > ${MEDIA_UPLOAD_MAX_BYTES}`);
        }

        // 压缩图片
        let processedBuffer = buffer;
        let compressedMime = normalizedMime;
        let originalSize = buffer.length;
        if (mediaCompressionService) {
            const { shouldCompress, compressBuffer } = mediaCompressionService;
            if (shouldCompress && shouldCompress(buffer.length, normalizedMime)) {
                try {
                    const compressed = await compressBuffer(buffer, normalizedMime, fileName || `upload_${Date.now()}.${extForMime(normalizedMime)}`);
                    if (!compressed.skipped && compressed.buffer.length < buffer.length) {
                        processedBuffer = compressed.buffer;
                        compressedMime = compressed.mimeType;
                        console.log(`[mediaAssetService] compressed: ${buffer.length} → ${compressed.buffer.length} (${compressed.ratio.toFixed(2)}x) mime: ${normalizedMime} → ${compressed.mimeType}`);
                    }
                } catch (err) {
                    console.warn(`[mediaAssetService] compression failed, storing original: ${err.message}`);
                }
            }
        }
        processedMime = compressedMime;

        const ext = extForMime(processedMime);
        const generatedKey = buildStorageKey(ext);
        const generatedPath = path.join(MEDIA_LOCAL_DIR, generatedKey);
        ensureParentDir(generatedPath);
        fs.writeFileSync(generatedPath, processedBuffer);

        storageKey = generatedKey;
        filePath = generatedPath;
        fileUrl = toPublicUrl(generatedKey);
        fileSize = processedBuffer.length;
        hash = sha256Buffer(processedBuffer);
        metaOut = {
            ...meta,
            original_size: processedBuffer.length < buffer.length ? buffer.length : undefined,
            compressed: processedBuffer.length < buffer.length,
            mime_before_compress: processedBuffer.length < buffer.length ? normalizedMime : undefined,
        };
    }
    const ext = extForMime(normalizedMime);
    const safeFileName = sanitizeFileName(fileName, ext);

    const db2 = db.getDb();
    const result = await db2.prepare(`
        INSERT INTO media_assets
        (creator_id, operator, uploaded_by, storage_provider, storage_key, file_path, file_url, file_name, mime_type, file_size, sha256_hash, status, meta_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)
    `).run(
        creatorId || null,
        operator || null,
        uploadedBy || null,
        storageProvider,
        storageKey,
        filePath,
        fileUrl,
        safeFileName,
        processedMime,
        fileSize,
        hash,
        JSON.stringify(metaOut || {})
    );
    const insertedId = result.lastInsertRowid;
    const row = await db2.prepare('SELECT * FROM media_assets WHERE id = ?').get(insertedId);
    return row;
}

async function getActiveMediaAssetById(id) {
    await ensureMediaSchema();
    const db2 = db.getDb();
    return await db2.prepare('SELECT * FROM media_assets WHERE id = ? AND status = ?').get(id, 'active');
}

async function createMediaSendLog({
    mediaAssetId,
    creatorId = null,
    phone,
    sessionId = null,
    operator = null,
    caption = null,
    sentBy = null,
}) {
    await ensureMediaSchema();
    const db2 = db.getDb();
    const result = await db2.prepare(`
        INSERT INTO media_send_log
        (media_asset_id, creator_id, phone, session_id, operator, caption, status, sent_by)
        VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)
    `).run(
        mediaAssetId,
        creatorId || null,
        phone,
        sessionId || null,
        operator || null,
        caption || null,
        sentBy || null
    );
    return result.lastInsertRowid || null;
}

async function finalizeMediaSendLogSuccess(logId, {
    waMessageId = null,
    routedSessionId = null,
    routedOperator = null,
}) {
    if (!logId) return;
    const db2 = db.getDb();
    await db2.prepare(`
        UPDATE media_send_log
        SET status = 'success',
            error_message = NULL,
            wa_message_id = ?,
            routed_session_id = ?,
            routed_operator = ?,
            sent_at = CURRENT_TIMESTAMP
        WHERE id = ?
    `).run(
        waMessageId || null,
        routedSessionId || null,
        routedOperator || null,
        logId
    );
}

async function finalizeMediaSendLogFailed(logId, errorMessage) {
    if (!logId) return;
    const db2 = db.getDb();
    await db2.prepare(`
        UPDATE media_send_log
        SET status = 'failed',
            error_message = ?,
            sent_at = CURRENT_TIMESTAMP
        WHERE id = ?
    `).run(
        String(errorMessage || 'unknown error').slice(0, 1000),
        logId
    );
}

module.exports = {
    ALLOWED_IMAGE_MIME,
    VIDEO_AUDIO_MIME,
    MEDIA_UPLOAD_MAX_BYTES,
    ensureMediaSchema,
    createMediaAsset,
    getActiveMediaAssetById,
    createMediaSendLog,
    finalizeMediaSendLogSuccess,
    finalizeMediaSendLogFailed,
};
