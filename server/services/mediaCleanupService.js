/**
 * Media Cleanup Service
 *
 * Implements retention-based soft delete + physical purge for media_assets.
 *
 * Retention flow:
 *   1. findCleanupCandidates(days)  — Mark assets as 'deleted' (soft delete), set deleted_at
 *   2. purgeDeletedAssets(jobId)   — Physically delete files on disk for soft-deleted assets
 *
 * Exemption: cleanup_exemptions records with null expires_at prevent any deletion.
 *
 * Environment variables:
 *   MEDIA_RETENTION_DAYS         — Days before assets are soft-deleted (default: 30)
 *   MEDIA_PURGE_AFTER_DAYS      — Days after soft-delete before physical purge (default: 7)
 *   MEDIA_CLEANUP_BATCH_SIZE    — Assets processed per batch (default: 100)
 *   MEDIA_LOCAL_DIR             — Local storage root (for file deletion)
 */

const db = require('../../db');
const path = require('path');
const fs = require('fs');
const { assertManagedSchemaReady } = require('./schemaReadinessGuard');

const RETENTION_DAYS = parseInt(process.env.MEDIA_RETENTION_DAYS || '30', 10);
const PURGE_AFTER_DAYS = parseInt(process.env.MEDIA_PURGE_AFTER_DAYS || '7', 10);
const BATCH_SIZE = parseInt(process.env.MEDIA_CLEANUP_BATCH_SIZE || '100', 10);
const MEDIA_LOCAL_DIR = path.resolve(process.env.MEDIA_LOCAL_DIR || path.join(process.cwd(), 'data', 'media-assets'));

function getRetentionCutoff() {
    const now = new Date();
    now.setDate(now.getDate() - RETENTION_DAYS);
    return now;
}

async function ensureSchema() {
    const conn = db.getDb();
    await assertManagedSchemaReady(conn, {
        feature: 'Media cleanup',
        migration: 'server/migrations/008_template_media_training_tables.sql',
        tables: ['media_assets', 'cleanup_jobs', 'cleanup_exemptions'],
        columns: {
            media_assets: ['id', 'storage_tier', 'status', 'created_at', 'deleted_at', 'cleanup_job_id', 'file_path', 'storage_key', 'storage_provider', 'mime_type', 'file_size'],
            cleanup_jobs: ['id', 'job_type', 'retention_days', 'status', 'total_candidates', 'candidates_checked', 'candidates_deleted', 'candidates_skipped', 'started_at', 'completed_at', 'triggered_by', 'triggered_by_user', 'note', 'error_message'],
            cleanup_exemptions: ['id', 'media_asset_id', 'exempted_by', 'exemption_reason', 'exempted_at', 'expires_at', 'created_at'],
        },
    });
}

async function startCleanupJob(jobType, retentionDays, triggeredBy, triggeredByUser, note) {
    const conn = db.getDb();
    const result = await conn.prepare(`
        INSERT INTO cleanup_jobs (job_type, retention_days, status, total_candidates, triggered_by, triggered_by_user, note)
        VALUES (?, ?, 'running', 0, ?, ?, ?)
    `).run(jobType, retentionDays || RETENTION_DAYS, triggeredBy, triggeredByUser, note);
    return result.lastInsertRowid;
}

async function finishCleanupJob(jobId, status, candidatesChecked, candidatesDeleted, candidatesSkipped, errorMessage) {
    const conn = db.getDb();
    await conn.prepare(`
        UPDATE cleanup_jobs
        SET status = ?,
            candidates_checked = ?,
            candidates_deleted = ?,
            candidates_skipped = ?,
            completed_at = CURRENT_TIMESTAMP,
            error_message = ?
        WHERE id = ?
    `).run(status, candidatesChecked, candidatesDeleted, candidatesSkipped, errorMessage || null, jobId);
}

/**
 * Find and soft-delete assets that have passed the retention period.
 *
 * Only 'hot' storage tier assets are considered.
 * Assets with an active cleanup_exemption (expires_at is null or in the future) are skipped.
 *
 * @param {number} retentionDays — Override default RETENTION_DAYS
 * @param {number} jobId        — FK to cleanup_jobs
 * @returns {{checked: number, deleted: number, skipped: number, errors: string[]}}
 */
async function cleanupBatch(retentionDays = RETENTION_DAYS, jobId = null) {
    await ensureSchema();
    const conn = db.getDb();

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - retentionDays);

    let checked = 0;
    let deleted = 0;
    let skipped = 0;
    const errors = [];

    // Process in batches to avoid locking the table too long
    let page = 0;
    while (true) {
        const candidates = await conn.prepare(`
            SELECT ma.id, ma.file_path, ma.storage_key, ma.sha256_hash, ma.storage_provider, ma.mime_type, ma.file_size
            FROM media_assets ma
            WHERE ma.storage_tier = 'hot'
              AND ma.status = 'active'
              AND ma.created_at < ?
              AND NOT EXISTS (
                  SELECT 1 FROM cleanup_exemptions ce
                  WHERE ce.media_asset_id = ma.id
                    AND (ce.expires_at IS NULL OR ce.expires_at > NOW())
              )
            LIMIT ?
            OFFSET ?
        `).all(cutoff, BATCH_SIZE, page * BATCH_SIZE);

        if (!candidates || candidates.length === 0) break;

        for (const asset of candidates) {
            try {
                await conn.prepare(`
                    UPDATE media_assets
                    SET status = 'deleted',
                        deleted_at = CURRENT_TIMESTAMP,
                        storage_tier = 'deleted',
                        cleanup_job_id = ?
                    WHERE id = ?
                      AND status = 'active'
                `).run(jobId, asset.id);
                deleted++;
            } catch (err) {
                errors.push(`id=${asset.id}: ${err.message}`);
            }
            checked++;
        }

        if (candidates.length < BATCH_SIZE) break;
        page++;
    }

    return { checked, deleted, skipped: 0, errors };
}

/**
 * Physically delete files on disk for all assets with status='deleted' and
 * deleted_at older than PURGE_AFTER_DAYS.
 *
 * @param {number} jobId — FK to cleanup_jobs
 * @returns {{purged: number, errors: string[]}}
 */
async function purgeDeletedAssets(jobId = null) {
    await ensureSchema();
    const conn = db.getDb();

    const purgeCutoff = new Date();
    purgeCutoff.setDate(purgeCutoff.getDate() - PURGE_AFTER_DAYS);

    let purged = 0;
    const errors = [];

    let page = 0;
    while (true) {
        const assets = await conn.prepare(`
            SELECT id, file_path, storage_key, storage_provider
            FROM media_assets
            WHERE status = 'deleted'
              AND storage_tier = 'deleted'
              AND deleted_at < ?
            LIMIT ?
            OFFSET ?
        `).all(purgeCutoff, BATCH_SIZE, page * BATCH_SIZE);

        if (!assets || assets.length === 0) break;

        for (const asset of assets) {
            try {
                // Only delete local files
                if (asset.storage_provider === 'local' && asset.file_path) {
                    if (fs.existsSync(asset.file_path)) {
                        fs.unlinkSync(asset.file_path);
                    }
                }
                // Mark as fully purged (keep record for audit trail)
                await conn.prepare(`
                    UPDATE media_assets
                    SET storage_tier = 'cold', file_path = NULL
                    WHERE id = ?
                `).run(asset.id);
                purged++;
            } catch (err) {
                errors.push(`id=${asset.id}: ${err.message}`);
            }
        }

        if (assets.length < BATCH_SIZE) break;
        page++;
    }

    return { purged, errors };
}

/**
 * Find candidates that WOULD be cleaned up without actually deleting them.
 * Useful for dry-run / preview.
 *
 * @param {number} retentionDays
 * @returns {Promise<Array>}
 */
async function findCleanupCandidates(retentionDays = RETENTION_DAYS) {
    await ensureSchema();
    const conn = db.getDb();

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - retentionDays);

    return await conn.prepare(`
        SELECT ma.id, ma.file_name, ma.mime_type, ma.file_size, ma.storage_provider,
               ma.created_at, ma.storage_key, ce.exemption_reason, ce.expires_at
        FROM media_assets ma
        LEFT JOIN cleanup_exemptions ce ON ce.media_asset_id = ma.id
            AND (ce.expires_at IS NULL OR ce.expires_at > NOW())
        WHERE ma.storage_tier = 'hot'
          AND ma.status = 'active'
          AND ma.created_at < ?
          AND ce.id IS NULL
        ORDER BY ma.created_at ASC
    `).all(cutoff);
}

/**
 * Run a full cleanup cycle: soft delete + physical purge.
 * Returns a summary object.
 *
 * @param {object} opts
 * @param {string} opts.triggeredBy        — 'system'|'cron'|'manual'|'script'
 * @param {string} [opts.triggeredByUser] — username if triggered by a user
 * @param {number} [opts.retentionDays]
 * @param {boolean} [opts.purge=true]     — Also run physical purge
 */
async function runCleanup({ triggeredBy = 'system', triggeredByUser = null, retentionDays = RETENTION_DAYS, purge = true } = {}) {
    const jobId = await startCleanupJob('retention', retentionDays, triggeredBy, triggeredByUser, null);

    let status = 'completed';
    let candidatesChecked = 0;
    let candidatesDeleted = 0;
    let candidatesSkipped = 0;
    let purged = 0;
    let allErrors = [];

    try {
        // Phase 1: Soft delete
        const softResult = await cleanupBatch(retentionDays, jobId);
        candidatesChecked = softResult.checked;
        candidatesDeleted = softResult.deleted;
        candidatesSkipped = softResult.skipped;
        allErrors = allErrors.concat(softResult.errors);

        // Phase 2: Physical purge (if requested)
        if (purge) {
            const purgeResult = await purgeDeletedAssets(jobId);
            purged = purgeResult.purged;
            allErrors = allErrors.concat(purgeResult.errors);
        }
    } catch (err) {
        status = 'failed';
        allErrors.push(`cleanup error: ${err.message}`);
    }

    await finishCleanupJob(jobId, status, candidatesChecked, candidatesDeleted, candidatesSkipped, allErrors.join('; ') || null);

    return {
        jobId,
        status,
        candidatesChecked,
        candidatesDeleted,
        candidatesSkipped,
        purged,
        errors: allErrors,
    };
}

module.exports = {
    cleanupBatch,
    purgeDeletedAssets,
    findCleanupCandidates,
    runCleanup,
    getRetentionCutoff,
    RETENTION_DAYS,
    PURGE_AFTER_DAYS,
    BATCH_SIZE,
};
