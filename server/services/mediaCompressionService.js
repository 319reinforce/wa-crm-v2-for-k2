/**
 * Media Compression Service
 *
 * Handles image compression (via sharp) and video compression (via fluent-ffmpeg).
 *
 * Supported media types for compression:
 *   - Images: image/jpeg, image/png, image/webp, image/gif
 *   - Video:  video/mp4, video/quicktime, video/x-msvideo, video/webm
 *
 * Not compressed:
 *   - audio/* (WhatsApp voice notes)
 *   - application/pdf, application/msword, etc.
 *   - Any media that is already smaller than MIN_COMPRESS_SIZE
 *
 * Environment variables:
 *   COMPRESS_ENABLED          — 'true' (default) or 'false'
 *   COMPRESS_MIN_SIZE_BYTES   — Skip if file smaller than this (default: 10 KB)
 *   COMPRESS_MAX_WIDTH        — Max image width (default: 1920)
 *   COMPRESS_MAX_HEIGHT       — Max image height (default: 1920)
 *   COMPRESS_QUALITY_IMAGE    — JPEG/WebP quality 1-100 (default: 80)
 *   COMPRESS_GIF_AS_VIDEO     — Compress GIF as video? (default: false, keep as GIF)
 *   COMPRESS_VIDEO_CRF        — x264 CRF for video (default: 28)
 *   COMPRESS_VIDEO_PRESET     — x264 preset (default: 'fast')
 *   FFmpeg_PATH               — Path to ffmpeg binary
 *   FFPROBE_PATH              — Path to ffprobe binary
 */

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const COMPRESS_ENABLED = process.env.COMPRESS_ENABLED !== 'false';
const MIN_COMPRESS_SIZE = parseInt(process.env.COMPRESS_MIN_SIZE_BYTES || '10240', 10); // 10 KB
const MAX_WIDTH = parseInt(process.env.COMPRESS_MAX_WIDTH || '1920', 10);
const MAX_HEIGHT = parseInt(process.env.COMPRESS_MAX_HEIGHT || '1920', 10);
const IMAGE_QUALITY = parseInt(process.env.COMPRESS_QUALITY_IMAGE || '80', 10);
const COMPRESS_GIF_AS_VIDEO = process.env.COMPRESS_GIF_AS_VIDEO === 'true';
const VIDEO_CRF = process.env.COMPRESS_VIDEO_CRF || '28';
const VIDEO_PRESET = process.env.COMPRESS_VIDEO_PRESET || 'fast';

const COMPRESSIBLE_IMAGE_MIMES = new Set([
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
]);

const COMPRESSIBLE_VIDEO_MIMES = new Set([
    'video/mp4',
    'video/quicktime',
    'video/x-msvideo',
    'video/webm',
]);

const GIF_MIME = 'image/gif';

function isCompressible(mimeType) {
    if (!mimeType) return false;
    const mime = String(mimeType).toLowerCase().trim();
    if (COMPRESSIBLE_IMAGE_MIMES.has(mime)) return true;
    if (COMPRESSIBLE_VIDEO_MIMES.has(mime)) return true;
    return false;
}

function isImage(mimeType) {
    if (!mimeType) return false;
    return COMPRESSIBLE_IMAGE_MIMES.has(String(mimeType).toLowerCase().trim());
}

function isVideo(mimeType) {
    if (!mimeType) return false;
    return COMPRESSIBLE_VIDEO_MIMES.has(String(mimeType).toLowerCase().trim());
}

function isGif(mimeType) {
    if (!mimeType) return false;
    return String(mimeType).toLowerCase().trim() === GIF_MIME;
}

function shouldCompress(fileSize, mimeType) {
    if (!COMPRESS_ENABLED) return false;
    if (!isCompressible(mimeType)) return false;
    if (fileSize < MIN_COMPRESS_SIZE) return false;
    return true;
}

async function compressImageBuffer(buffer, mimeType) {
    let sharp;
    try { sharp = require('sharp'); } catch (e) { throw new Error('sharp not available'); }

    const inputMime = String(mimeType || '').toLowerCase().trim();
    let pipeline = sharp(buffer);

    const meta = await pipeline.metadata();
    const needsResize = (meta.width || 0) > MAX_WIDTH || (meta.height || 0) > MAX_HEIGHT;

    if (inputMime === 'image/png') {
        pipeline = pipeline.png({ quality: IMAGE_QUALITY, compressionLevel: 9 });
    } else if (inputMime === 'image/webp') {
        pipeline = pipeline.webp({ quality: IMAGE_QUALITY });
    } else if (inputMime === 'image/gif') {
        if (COMPRESS_GIF_AS_VIDEO) {
            throw new Error('GIF-to-video compression requires compressAndReplaceAsset (ffmpeg path)');
        }
        // For GIF, just resize if needed; keep as GIF (sharp doesn't re-encode GIF frames well)
        if (needsResize) {
            pipeline = pipeline.resize(MAX_WIDTH, MAX_HEIGHT, { fit: 'inside', withoutEnlargement: true });
        }
    } else {
        // Default: JPEG
        pipeline = pipeline.jpeg({ quality: IMAGE_QUALITY, progressive: true });
    }

    if (needsResize && inputMime !== 'image/gif') {
        pipeline = pipeline.resize(MAX_WIDTH, MAX_HEIGHT, { fit: 'inside', withoutEnlargement: true });
    }

    const outputBuffer = await pipeline.toBuffer();

    let outputMime = inputMime;
    if (inputMime === 'image/png' || inputMime === 'image/webp') {
        outputMime = inputMime;
    } else {
        outputMime = 'image/jpeg';
    }

    return {
        buffer: outputBuffer,
        mimeType: outputMime,
        originalSize: buffer.length,
        compressedSize: outputBuffer.length,
    };
}

async function compressVideoFile(inputPath, outputPath, onProgress) {
    let ffmpeg;
    try { ffmpeg = require('fluent-ffmpeg'); } catch (e) { throw new Error('fluent-ffmpeg not available'); }

    const ffmpegPath = process.env.FFmpeg_PATH;
    const ffprobePath = process.env.FFPROBE_PATH;
    if (ffmpegPath) ffmpeg.setFfmpegPath(ffmpegPath);
    if (ffprobePath) ffmpeg.setFfprobePath(ffprobePath);

    return new Promise((resolve, reject) => {
        const proc = ffmpeg({ source: inputPath })
            .outputOptions([
                '-c:v libx264',
                `-crf ${VIDEO_CRF}`,
                `-preset ${VIDEO_PRESET}`,
                '-c:a aac',
                '-b:a 128k',
                '-movflags +faststart',
            ])
            .output(outputPath)
            .on('progress', (info) => {
                if (onProgress) onProgress(info);
            })
            .on('end', () => {
                try {
                    const stats = fs.statSync(outputPath);
                    resolve({
                        outputPath,
                        originalSize: fs.statSync(inputPath).size,
                        compressedSize: stats.size,
                    });
                } catch (err) {
                    reject(new Error(`ffmpeg completed but could not read output: ${err.message}`));
                }
            })
            .on('error', (err) => {
                reject(new Error(`ffmpeg error: ${err.message}`));
            });

        proc.run();
    });
}

/**
 * Compress a media buffer and return the compressed result.
 * Does NOT write to disk or update database.
 *
 * @param {Buffer} buffer       — Original file buffer
 * @param {string} mimeType     — Original MIME type
 * @param {string} originalFileName — For extension hint
 * @returns {Promise<{buffer: Buffer, mimeType: string, originalSize: number, compressedSize: number, ratio: number, saved: number}>}
 */
async function compressBuffer(buffer, mimeType, originalFileName) {
    if (!shouldCompress(buffer.length, mimeType)) {
        return {
            buffer,
            mimeType,
            originalSize: buffer.length,
            compressedSize: buffer.length,
            ratio: 1,
            saved: 0,
            skipped: true,
            skipReason: !isCompressible(mimeType)
                ? `mime type ${mimeType} is not compressible`
                : `file size ${buffer.length} < min ${MIN_COMPRESS_SIZE}`,
        };
    }

    if (isImage(mimeType) || isGif(mimeType)) {
        const result = await compressImageBuffer(buffer, mimeType);
        const saved = result.originalSize - result.compressedSize;
        return {
            buffer: result.buffer,
            mimeType: result.mimeType,
            originalSize: result.originalSize,
            compressedSize: result.compressedSize,
            ratio: result.compressedSize / result.originalSize,
            saved: Math.max(0, saved),
            skipped: false,
        };
    }

    if (isVideo(mimeType)) {
        // Video compression requires file paths (streaming), not buffer-in/buffer-out.
        // Write temp file, compress, read back.
        const ext = path.extname(originalFileName || '.mp4') || '.mp4';
        const inputTmp = path.join('/tmp', `wa_compress_in_${Date.now()}_${crypto.randomBytes(4).toString('hex')}${ext}`);
        const outputTmp = path.join('/tmp', `wa_compress_out_${Date.now()}_${crypto.randomBytes(4).toString('hex')}.mp4`);

        try {
            fs.writeFileSync(inputTmp, buffer);
            const result = await compressVideoFile(inputTmp, outputTmp);
            const compressedBuffer = fs.readFileSync(outputTmp);
            const saved = result.originalSize - result.compressedSize;
            return {
                buffer: compressedBuffer,
                mimeType: 'video/mp4',
                originalSize: result.originalSize,
                compressedSize: result.compressedSize,
                ratio: result.compressedSize / result.originalSize,
                saved: Math.max(0, saved),
                skipped: false,
            };
        } finally {
            try { fs.unlinkSync(inputTmp); } catch (_) {}
            try { fs.unlinkSync(outputTmp); } catch (_) {}
        }
    }

    return {
        buffer,
        mimeType,
        originalSize: buffer.length,
        compressedSize: buffer.length,
        ratio: 1,
        saved: 0,
        skipped: true,
        skipReason: `unhandled mime type: ${mimeType}`,
    };
}

/**
 * Compress a file on disk and replace it with the compressed version.
 * Returns metadata about the compression result.
 *
 * @param {string} inputPath — Path to the original file
 * @param {string} mimeType  — MIME type of the file
 * @returns {Promise<{outputPath: string, mimeType: string, originalSize: number, compressedSize: number, saved: number, ratio: number, skipped: boolean, skipReason?: string}>}
 */
async function compressAndReplaceFile(inputPath, mimeType) {
    if (!fs.existsSync(inputPath)) {
        throw new Error(`file not found: ${inputPath}`);
    }

    const originalSize = fs.statSync(inputPath).size;

    if (!shouldCompress(originalSize, mimeType)) {
        const skipReason = !isCompressible(mimeType)
            ? `mime type ${mimeType} is not compressible`
            : `file size ${originalSize} < min ${MIN_COMPRESS_SIZE}`;
        return {
            outputPath: inputPath,
            mimeType,
            originalSize,
            compressedSize: originalSize,
            saved: 0,
            ratio: 1,
            skipped: true,
            skipReason,
        };
    }

    if (isImage(mimeType) || isGif(mimeType)) {
        let sharp;
        try { sharp = require('sharp'); } catch (e) { throw new Error('sharp not available'); }

        const inputMime = String(mimeType || '').toLowerCase().trim();
        let pipeline = sharp(inputPath);

        const meta = await pipeline.metadata();
        const needsResize = (meta.width || 0) > MAX_WIDTH || (meta.height || 0) > MAX_HEIGHT;

        if (inputMime === 'image/png') {
            pipeline = pipeline.png({ quality: IMAGE_QUALITY, compressionLevel: 9 });
        } else if (inputMime === 'image/webp') {
            pipeline = pipeline.webp({ quality: IMAGE_QUALITY });
        } else if (inputMime === 'image/gif') {
            if (needsResize) {
                pipeline = pipeline.resize(MAX_WIDTH, MAX_HEIGHT, { fit: 'inside', withoutEnlargement: true });
            }
            await pipeline.toFile(inputPath);
            const stats = fs.statSync(inputPath);
            return {
                outputPath: inputPath,
                mimeType,
                originalSize,
                compressedSize: stats.size,
                saved: Math.max(0, originalSize - stats.size),
                ratio: stats.size / originalSize,
                skipped: false,
            };
        } else {
            pipeline = pipeline.jpeg({ quality: IMAGE_QUALITY, progressive: true });
        }

        if (needsResize) {
            pipeline = pipeline.resize(MAX_WIDTH, MAX_HEIGHT, { fit: 'inside', withoutEnlargement: true });
        }

        await pipeline.toFile(inputPath);
        const stats = fs.statSync(inputPath);
        const saved = originalSize - stats.size;
        return {
            outputPath: inputPath,
            mimeType: inputMime === 'image/png' || inputMime === 'image/webp' ? inputMime : 'image/jpeg',
            originalSize,
            compressedSize: stats.size,
            saved: Math.max(0, saved),
            ratio: stats.size / originalSize,
            skipped: false,
        };
    }

    if (isVideo(mimeType)) {
        const outputTmp = inputPath + `.compressed.${Date.now()}.mp4`;
        const result = await compressVideoFile(inputPath, outputTmp);
        const saved = result.originalSize - result.compressedSize;

        // Replace original with compressed
        fs.unlinkSync(inputPath);
        fs.renameSync(outputTmp, inputPath);

        return {
            outputPath: inputPath,
            mimeType: 'video/mp4',
            originalSize: result.originalSize,
            compressedSize: result.compressedSize,
            saved: Math.max(0, saved),
            ratio: result.compressedSize / result.originalSize,
            skipped: false,
        };
    }

    return {
        outputPath: inputPath,
        mimeType,
        originalSize,
        compressedSize: originalSize,
        saved: 0,
        ratio: 1,
        skipped: true,
        skipReason: `unhandled mime type: ${mimeType}`,
    };
}

module.exports = {
    isCompressible,
    isImage,
    isVideo,
    isGif,
    shouldCompress,
    compressBuffer,
    compressAndReplaceFile,
    MIN_COMPRESS_SIZE,
    MAX_WIDTH,
    MAX_HEIGHT,
    IMAGE_QUALITY,
    COMPRESSIBLE_IMAGE_MIMES,
    COMPRESSIBLE_VIDEO_MIMES,
};
