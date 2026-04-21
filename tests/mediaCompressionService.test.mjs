import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

// 注:这里按模块默认加载:COMPRESS_ENABLED=true, MIN_COMPRESS_SIZE=10240 (10 KB)
const compressionService = require('../server/services/mediaCompressionService')
const {
    shouldCompress,
    isCompressible,
    isImage,
    isVideo,
    isGif,
    compressBuffer,
    MIN_COMPRESS_SIZE,
    COMPRESSIBLE_IMAGE_MIMES,
    COMPRESSIBLE_VIDEO_MIMES,
} = compressionService

test('isCompressible — 正例:图片和视频 MIME 都返回 true', () => {
    assert.equal(isCompressible('image/jpeg'), true)
    assert.equal(isCompressible('image/png'), true)
    assert.equal(isCompressible('image/webp'), true)
    assert.equal(isCompressible('image/gif'), true)
    assert.equal(isCompressible('video/mp4'), true)
    assert.equal(isCompressible('video/quicktime'), true)
})

test('isCompressible — 反例:音频/PDF/未知 MIME 都返回 false', () => {
    assert.equal(isCompressible('audio/ogg'), false)
    assert.equal(isCompressible('audio/mpeg'), false)
    assert.equal(isCompressible('application/pdf'), false)
    assert.equal(isCompressible('text/plain'), false)
    assert.equal(isCompressible(null), false)
    assert.equal(isCompressible(undefined), false)
    assert.equal(isCompressible(''), false)
})

test('isImage / isVideo / isGif — 分类正确', () => {
    assert.equal(isImage('image/jpeg'), true)
    assert.equal(isImage('video/mp4'), false)

    assert.equal(isVideo('video/mp4'), true)
    assert.equal(isVideo('image/png'), false)

    assert.equal(isGif('image/gif'), true)
    assert.equal(isGif('image/png'), false)
    assert.equal(isGif('video/mp4'), false)
})

test('shouldCompress — 正例:图片 >MIN_COMPRESS_SIZE 返回 true', () => {
    assert.equal(shouldCompress(MIN_COMPRESS_SIZE + 1, 'image/jpeg'), true)
    assert.equal(shouldCompress(100 * 1024, 'image/png'), true)
    assert.equal(shouldCompress(5 * 1024 * 1024, 'video/mp4'), true)
})

test('shouldCompress — 反例:小于阈值/不可压缩 MIME/空值 返回 false', () => {
    // 小于阈值
    assert.equal(shouldCompress(MIN_COMPRESS_SIZE - 1, 'image/jpeg'), false)
    assert.equal(shouldCompress(0, 'image/jpeg'), false)
    // 音频/PDF 不压缩
    assert.equal(shouldCompress(1024 * 1024, 'audio/ogg'), false)
    assert.equal(shouldCompress(1024 * 1024, 'application/pdf'), false)
    // 空值
    assert.equal(shouldCompress(100, null), false)
    assert.equal(shouldCompress(100, ''), false)
})

test('COMPRESSIBLE_IMAGE_MIMES / COMPRESSIBLE_VIDEO_MIMES — 导出集合不为空', () => {
    assert.ok(COMPRESSIBLE_IMAGE_MIMES instanceof Set)
    assert.ok(COMPRESSIBLE_VIDEO_MIMES instanceof Set)
    assert.ok(COMPRESSIBLE_IMAGE_MIMES.size >= 4)
    assert.ok(COMPRESSIBLE_VIDEO_MIMES.size >= 4)
})

test('compressBuffer — 不可压缩 MIME 返回 skipped', async () => {
    // 哪怕是大的 audio 也会被跳过(不属于可压缩类)
    const buf = Buffer.alloc(1024 * 1024, 0)
    const result = await compressBuffer(buf, 'audio/ogg', 'voice.ogg')
    assert.equal(result.skipped, true)
    assert.equal(result.buffer, buf)
    assert.equal(result.originalSize, buf.length)
    assert.equal(result.compressedSize, buf.length)
    assert.equal(result.ratio, 1)
})

test('compressBuffer — 小于阈值的图片返回 skipped,不碰数据', async () => {
    // 5 KB < MIN_COMPRESS_SIZE (10 KB) → 跳过
    const buf = Buffer.alloc(5 * 1024, 0)
    const result = await compressBuffer(buf, 'image/jpeg', 'small.jpg')
    assert.equal(result.skipped, true)
    assert.equal(result.buffer, buf)
})

test('compressBuffer — 压缩失败时抛错,调用方需要在 try/catch 里 fallback 到原图', async () => {
    // 假 buffer(不是真视频数据)传给 video 分支 → ffmpeg 会报错或 ffmpeg 不存在;
    // 这个测试验证调用方不能指望结果一定成功,必须 try/catch。
    // 构造一个会进入视频分支的场景:假 buffer + video/mp4 + 大于阈值
    const buf = Buffer.alloc(50 * 1024, 0)
    await assert.rejects(
        compressBuffer(buf, 'video/mp4', 'sample.mp4'),
        (err) => {
            // 可能的错误:ffmpeg binary missing / ffmpeg error / sharp not available 等
            assert.ok(err instanceof Error, 'should reject with an Error')
            return true
        }
    )
})
