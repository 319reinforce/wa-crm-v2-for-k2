/**
 * Compress Existing Media Script
 *
 * 对已有媒体资产进行压缩处理：
 * 1. 图片：>50KB 且未压缩过的，转 JPEG/WebP 并压缩到 ≤500KB
 * 2. 视频：>5MB 且未压缩过的，压缩到 ≤5MB
 * 3. 跳过已压缩（meta_json.compressed=true）或有 compressed=true 的
 * 4. 按创建时间排序（先旧后新）
 *
 * 用法:
 *   node scripts/compress-existing-media.cjs [--dry-run] [--type=image|image+video] [--limit=100]
 *
 * 环境变量:
 *   MEDIA_COMPRESS_BATCH   每批处理数量 (默认 100)
 */

'use strict';

const path = require('path');
const db = require('../db');
const { mediaCompressionService } = require('../server/services/mediaCompressionService');
const { getActiveMediaAssetById, ensureMediaSchema } = require('../server/services/mediaAssetService');

// 参数解析
const args = process.argv.slice(2).reduce((acc, arg) => {
    const match = arg.match(/^--(\w+)(?:=(.+))?$/);
    if (match) {
        acc[match[1]] = match[2] !== undefined ? match[2] : true;
    }
    return acc;
}, {});

const DRY_RUN = args['dry-run'] === true || args['dry-run'] === 'true';
const MEDIA_TYPE = args.type || 'image'; // 'image' | 'image+video'
const BATCH_SIZE = parseInt(args.limit || process.env.MEDIA_COMPRESS_BATCH || '100', 10);
const IMAGE_SIZE_THRESHOLD = 50 * 1024;   // 50KB
const VIDEO_SIZE_THRESHOLD = 5 * 1024 * 1024; // 5MB

function log(msg, type = 'INFO') {
    const prefix = DRY_RUN ? '[DRY-RRY]' : '[COMPRESS]';
    console.log(`${prefix} [${type}] ${msg}`);
}

function logError(msg) {
    log(msg, 'ERROR');
}

function mimeIsImage(mime) {
    return /^image\/(jpeg|jpg|png|gif|webp|bmp|tiff)$/i.test(mime);
}

function mimeIsVideo(mime) {
    return /^video\//.test(mime);
}

function isCompressedAsset(asset) {
    try {
        const meta = asset.meta_json ? JSON.parse(asset.meta_json) : {};
        return meta.compressed === true;
    } catch (_) {
        return false;
    }
}

async function compressExistingMedia() {
    if (!mediaCompressionService) {
        logError('mediaCompressionService not available — is sharp/ffmpeg installed?');
        process.exit(1);
    }

    log(`Starting compress-existing-media (dry-run=${DRY_RUN}, type=${MEDIA_TYPE}, batch=${BATCH_SIZE})`);
    log(`Image threshold: ${(IMAGE_SIZE_THRESHOLD / 1024).toFixed(0)}KB, Video threshold: ${(VIDEO_SIZE_THRESHOLD / (1024 * 1024)).toFixed(0)}MB`);

    await ensureMediaSchema();
    const dbConn = db.getDb();

    // 构建 MIME 过滤条件
    const mimeConditions = [];
    if (MEDIA_TYPE === 'image' || MEDIA_TYPE === 'image+video') {
        mimeConditions.push("mime_type LIKE 'image/%'");
    }
    if (MEDIA_TYPE === 'image+video') {
        mimeConditions.push("mime_type LIKE 'video/%'");
    }
    const mimeFilter = mimeConditions.length > 0 ? `AND (${mimeConditions.join(' OR ')})` : '';

    let totalProcessed = 0;
    let totalCompressed = 0;
    let totalSkipped = 0;
    let totalFailed = 0;

    // 分批处理，直到没有更多符合条件的记录
    let offset = 0;
    let hasMore = true;

    while (hasMore) {
        const rows = dbConn.prepare(`
            SELECT ma.*, c.primary_name as creator_name
            FROM media_assets ma
            LEFT JOIN creators c ON c.id = ma.creator_id
            WHERE ma.status = 'active'
              AND ma.storage_provider = 'local'
              AND ma.file_path IS NOT NULL
              AND ma.file_path != ''
              ${mimeFilter}
            ORDER BY ma.created_at ASC
            LIMIT ? OFFSET ?
        `).all(BATCH_SIZE, offset);

        if (rows.length === 0) {
            hasMore = false;
            break;
        }

        log(`Batch offset=${offset}, got ${rows.length} assets`);

        for (const asset of rows) {
            const isImage = mimeIsImage(asset.mime_type);
            const isVideo = mimeIsVideo(asset.mime_type);

            // 判断是否需要压缩
            let shouldCompress = false;
            if (isImage && asset.file_size > IMAGE_SIZE_THRESHOLD) shouldCompress = true;
            if (isVideo && asset.file_size > VIDEO_SIZE_THRESHOLD) shouldCompress = true;

            if (!shouldCompress) {
                totalSkipped++;
                continue;
            }

            // 跳过已压缩的
            if (isCompressedAsset(asset)) {
                log(`  SKIP #${asset.id}: already compressed`);
                totalSkipped++;
                continue;
            }

            // 检查文件是否存在
            if (!asset.file_path || !require('fs').existsSync(asset.file_path)) {
                logError(`  SKIP #${asset.id}: file not found at ${asset.file_path}`);
                totalSkipped++;
                continue;
            }

            log(`  Processing #${asset.id} "${asset.file_name}" ${(asset.file_size / 1024).toFixed(1)}KB ${asset.mime_type}`);

            if (DRY_RUN) {
                totalProcessed++;
                totalCompressed++;
                continue;
            }

            // 执行压缩
            try {
                const { shouldCompress: sc, compressBuffer } = mediaCompressionService;
                if (!sc || !compressBuffer) {
                    logError(`  FAIL #${asset.id}: compressBuffer not available`);
                    totalFailed++;
                    continue;
                }

                const fileBuffer = require('fs').readFileSync(asset.file_path);
                const compressed = await compressBuffer(fileBuffer, asset.mime_type, asset.file_name);

                if (compressed.skipped) {
                    log(`  SKIP #${asset.id}: compression skipped by service`);
                    totalSkipped++;
                    continue;
                }

                if (compressed.buffer.length >= fileBuffer.length) {
                    log(`  SKIP #${asset.id}: compressed (${compressed.buffer.length}) >= original (${fileBuffer.length})`);
                    totalSkipped++;
                    continue;
                }

                // 写回新文件
                const newPath = asset.file_path;
                require('fs').writeFileSync(newPath, compressed.buffer);

                const ratio = (compressed.buffer.length / fileBuffer.length).toFixed(2);
                log(`  OK #${asset.id}: ${(fileBuffer.length / 1024).toFixed(1)}KB → ${(compressed.buffer.length / 1024).toFixed(1)}KB (${ratio}x)`);

                // 更新数据库
                const newMeta = {
                    ...(asset.meta_json ? JSON.parse(asset.meta_json) : {}),
                    original_size: fileBuffer.length,
                    compressed: true,
                    mime_before_compress: asset.mime_type,
                    compress_ratio: parseFloat(ratio),
                    compressed_at: new Date().toISOString(),
                };

                dbConn.prepare(`
                    UPDATE media_assets
                    SET mime_type = ?,
                        file_size = ?,
                        sha256_hash = ?,
                        meta_json = ?,
                        updated_at = CURRENT_TIMESTAMP
                    WHERE id = ?
                `).run(
                    compressed.mimeType || asset.mime_type,
                    compressed.buffer.length,
                    require('crypto').createHash('sha256').update(compressed.buffer).digest('hex'),
                    JSON.stringify(newMeta),
                    asset.id
                );

                totalProcessed++;
                totalCompressed++;
            } catch (err) {
                logError(`  FAIL #${asset.id}: ${err.message}`);
                totalFailed++;
            }
        }

        offset += BATCH_SIZE;
        if (rows.length < BATCH_SIZE) {
            hasMore = false;
        }
    }

    log('--- Summary ---');
    log(`Processed: ${totalProcessed}`);
    log(`Compressed: ${totalCompressed}`);
    log(`Skipped: ${totalSkipped}`);
    log(`Failed: ${totalFailed}`);

    if (DRY_RUN) {
        log('DRY-RUN complete — no actual changes made');
    } else {
        log('Compression complete');
    }
}

compressExistingMedia().then(() => {
    process.exit(0);
}).catch((err) => {
    logError(`Fatal error: ${err.message}`);
    console.error(err.stack);
    process.exit(1);
});