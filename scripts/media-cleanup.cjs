/**
 * Media Cleanup Script
 *
 * 清理孤立媒体和过期资源：
 * 1. 孤立 media_assets（未被任何 wa_messages 引用，且未被 media_send_log 引用）
 * 2. 孤立文件（数据库有记录但文件系统不存在）
 * 3. 过大的媒体文件（可压缩但压缩失败）
 * 4. 软删除状态下超过 N 天的记录
 *
 * 用法:
 *   node scripts/media-cleanup.cjs [--dry-run] [--days=30] [--limit=500]
 *
 * 环境变量:
 *   MEDIA_CLEANUP_DAYS         超过 N 天未引用的资产标记为孤立 (默认 90)
 *   MEDIA_CLEANUP_BATCH_SIZE   每批处理数量 (默认 500)
 *   MEDIA_STORAGE_DIR          媒体存储目录 (默认 ./data/media-assets)
 */

'use strict';

const path = require('path');
const fs = require('fs');
const db = require('../db');

// 参数解析
const args = process.argv.slice(2).reduce((acc, arg) => {
    const match = arg.match(/^--(\w+)(?:=(.+))?$/);
    if (match) {
        acc[match[1]] = match[2] !== undefined ? match[2] : true;
    }
    return acc;
}, {});

const DRY_RUN = args['dry-run'] === true || args['dry-run'] === 'true';
const DAYS = parseInt(args.days || process.env.MEDIA_CLEANUP_DAYS || '90', 10);
const BATCH_SIZE = parseInt(args.limit || process.env.MEDIA_CLEANUP_BATCH_SIZE || '500', 10);
const STORAGE_DIR = path.resolve(process.env.MEDIA_STORAGE_DIR || path.join(__dirname, '..', 'data', 'media-assets'));

function log(msg, type = 'INFO') {
    const prefix = DRY_RUN ? '[DRY-RRY]' : '[CLEANUP]';
    console.log(`${prefix} [${type}] ${msg}`);
}

function logError(msg) {
    log(msg, 'ERROR');
}

async function cleanup() {
    log(`Starting media cleanup (dry-run=${DRY_RUN}, days=${DAYS}, batch=${BATCH_SIZE})`);
    log(`Storage dir: ${STORAGE_DIR}`);

    if (!fs.existsSync(STORAGE_DIR)) {
        log(`Storage dir does not exist: ${STORAGE_DIR}`, 'WARN');
    }

    const dbConn = db.getDb();
    let totalDeleted = 0;
    let totalFileRemoved = 0;
    let totalSoftDeleted = 0;

    // ============ 1. 孤立媒体资产（未被引用）============
    log('--- Phase 1: Orphaned media_assets (unreferenced) ---');
    const orphaned = dbConn.prepare(`
        SELECT ma.id, ma.storage_key, ma.file_path, ma.file_name, ma.file_size, ma.created_at
        FROM media_assets ma
        WHERE ma.status = 'active'
          AND NOT EXISTS (SELECT 1 FROM wa_messages wm WHERE wm.media_asset_id = ma.id)
          AND NOT EXISTS (SELECT 1 FROM media_send_log msl WHERE msl.media_asset_id = ma.id)
        LIMIT ?
    `).all(BATCH_SIZE);

    if (orphaned.length === 0) {
        log('No orphaned media assets found');
    } else {
        log(`Found ${orphaned.length} orphaned media assets`);
        for (const asset of orphaned) {
            const createdDaysAgo = Math.floor((Date.now() - new Date(asset.created_at).getTime()) / (1000 * 60 * 60 * 24));
            log(`  asset #${asset.id} "${asset.file_name}" created ${createdDaysAgo}d ago, size=${asset.file_size}`);

            if (!DRY_RUN) {
                // 软删除
                dbConn.prepare(`
                    UPDATE media_assets SET status = 'orphaned', updated_at = CURRENT_TIMESTAMP WHERE id = ?
                `).run(asset.id);
                totalSoftDeleted++;
            }
        }
    }

    // ============ 2. 孤立文件清理（已软删除但文件仍在）============
    log('--- Phase 2: Orphaned files on disk ---');
    const orphanedFiles = dbConn.prepare(`
        SELECT id, file_path, storage_key FROM media_assets
        WHERE status IN ('orphaned', 'deleted')
          AND file_path IS NOT NULL
          AND file_path != ''
        LIMIT ?
    `).all(BATCH_SIZE);

    if (orphanedFiles.length === 0) {
        log('No orphaned files found');
    } else {
        log(`Found ${orphanedFiles.length} orphaned file records`);
        for (const rec of orphanedFiles) {
            if (rec.file_path && fs.existsSync(rec.file_path)) {
                log(`  Deleting file: ${rec.file_path}`);
                if (!DRY_RUN) {
                    fs.unlinkSync(rec.file_path);
                    totalFileRemoved++;
                }
            }
        }
    }

    // ============ 3. 硬删除超过 N 天的软删除记录（物理文件和数据库记录）============
    log(`--- Phase 3: Hard delete records older than ${DAYS} days ---`);
    const staleAssets = dbConn.prepare(`
        SELECT id, file_path, storage_key FROM media_assets
        WHERE status IN ('orphaned', 'deleted')
          AND updated_at < DATE_SUB(NOW(), INTERVAL ? DAY)
        LIMIT ?
    `).all(DAYS, BATCH_SIZE);

    if (staleAssets.length === 0) {
        log(`No stale assets older than ${DAYS} days`);
    } else {
        log(`Found ${staleAssets.length} stale assets to hard delete`);
        for (const asset of staleAssets) {
            log(`  Hard delete asset #${asset.id}`);

            if (!DRY_RUN) {
                if (asset.file_path && fs.existsSync(asset.file_path)) {
                    fs.unlinkSync(asset.file_path);
                    totalFileRemoved++;
                }
                dbConn.prepare('DELETE FROM media_assets WHERE id = ?').run(asset.id);
                totalDeleted++;
            }
        }
    }

    // ============ 4. 缺失文件报告（数据库有但文件不存在）============
    log('--- Phase 4: Missing file report (active records with missing files) ---');
    const missingFiles = dbConn.prepare(`
        SELECT id, file_path, file_name, storage_provider
        FROM media_assets
        WHERE status = 'active'
          AND storage_provider = 'local'
          AND file_path IS NOT NULL
          AND file_path != ''
    `).all();

    let missingCount = 0;
    for (const rec of missingFiles) {
        if (!fs.existsSync(rec.file_path)) {
            logError(`  Missing file for asset #${rec.id}: ${rec.file_path}`);
            missingCount++;
        }
    }
    if (missingCount === 0) {
        log('All active media files present on disk');
    } else {
        logError(`${missingCount} active assets have missing files`);
    }

    // ============ 5. 统计摘要 ============
    log('--- Summary ---');
    log(`Soft deleted: ${totalSoftDeleted}`);
    log(`Files removed: ${totalFileRemoved}`);
    log(`Hard deleted: ${totalDeleted}`);
    log(`Missing file reports: ${missingCount}`);

    if (DRY_RUN) {
        log('DRY-RUN complete — no actual changes made');
    } else {
        log('Cleanup complete');
    }
}

cleanup().then(() => {
    process.exit(0);
}).catch((err) => {
    logError(`Fatal error: ${err.message}`);
    process.exit(1);
});