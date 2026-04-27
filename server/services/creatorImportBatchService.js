const db = require('../../db');
const { writeAudit } = require('../middleware/audit');
const { normalizeOperatorName, ownersEqual } = require('../utils/operator');
const { sendRoutedMessage } = require('./waSessionRouter');
const { persistDirectMessageRecord } = require('./directMessagePersistenceService');
const { getSessionIdForOperator, TABLE: ROSTER_TABLE } = require('./operatorRosterService');

const MAX_ROWS_PER_BATCH = 500;
const DEFAULT_SEND_DELAY_MS = Math.max(0, parseInt(process.env.CREATOR_IMPORT_SEND_DELAY_MS || '8000', 10) || 8000);

const activeRuns = new Set();

function normalizePhone(value) {
    return String(value || '').replace(/\D/g, '').trim();
}

function normalizeName(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function toBool(value, fallback = false) {
    if (value === undefined) return fallback;
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value !== 0;
    const normalized = String(value || '').trim().toLowerCase();
    if (!normalized) return fallback;
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
    return fallback;
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms || 0)));
}

function normalizeTemplateKey(value, fallback = 'welcome') {
    const raw = String(value || fallback || '').trim().toLowerCase();
    return raw.replace(/[^a-z0-9._-]/g, '_').slice(0, 64) || fallback;
}

function normalizeTemplateLabel(value, fallback = 'Welcome') {
    return String(value || fallback || '').replace(/\s+/g, ' ').trim().slice(0, 128) || fallback;
}

function normalizeTemplateBody(value) {
    return String(value || '').replace(/\r\n/g, '\n').trim();
}

async function ensureColumn(dbConn, tableName, columnName, ddl) {
    const row = await dbConn.prepare(`SHOW COLUMNS FROM ${tableName} LIKE ?`).get(columnName);
    if (!row) await dbConn.prepare(`ALTER TABLE ${tableName} ADD COLUMN ${ddl}`).run();
}

async function ensureCreatorImportBatchSchema() {
    const dbConn = db.getDb();
    await dbConn.prepare(`
        CREATE TABLE IF NOT EXISTS operator_outreach_templates (
            id BIGINT PRIMARY KEY AUTO_INCREMENT,
            owner VARCHAR(64) NOT NULL,
            template_key VARCHAR(64) NOT NULL DEFAULT 'welcome',
            label VARCHAR(128) NOT NULL DEFAULT 'Welcome',
            body TEXT NOT NULL,
            is_active TINYINT(1) NOT NULL DEFAULT 1,
            created_by VARCHAR(64) DEFAULT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            UNIQUE KEY uk_outreach_template_owner_key (owner, template_key),
            KEY idx_outreach_template_owner_active (owner, is_active)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `).run();
    await ensureColumn(dbConn, 'operator_outreach_templates', 'label', "label VARCHAR(128) NOT NULL DEFAULT 'Welcome' AFTER template_key");

    await dbConn.prepare(`
        CREATE TABLE IF NOT EXISTS creator_import_batches (
            id BIGINT PRIMARY KEY AUTO_INCREMENT,
            owner VARCHAR(64) NOT NULL,
            source VARCHAR(64) NOT NULL DEFAULT 'csv-import',
            status VARCHAR(32) NOT NULL DEFAULT 'queued',
            send_welcome TINYINT(1) NOT NULL DEFAULT 0,
            welcome_template_id BIGINT DEFAULT NULL,
            welcome_template_key VARCHAR(64) DEFAULT NULL,
            welcome_text TEXT DEFAULT NULL,
            total_count INT NOT NULL DEFAULT 0,
            created_count INT NOT NULL DEFAULT 0,
            reused_count INT NOT NULL DEFAULT 0,
            skipped_count INT NOT NULL DEFAULT 0,
            error_count INT NOT NULL DEFAULT 0,
            welcome_queued_count INT NOT NULL DEFAULT 0,
            welcome_sent_count INT NOT NULL DEFAULT 0,
            welcome_failed_count INT NOT NULL DEFAULT 0,
            created_by VARCHAR(64) DEFAULT NULL,
            started_at DATETIME DEFAULT NULL,
            completed_at DATETIME DEFAULT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            KEY idx_creator_import_batches_owner (owner),
            KEY idx_creator_import_batches_status (status),
            KEY idx_creator_import_batches_created_at (created_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `).run();
    await ensureColumn(dbConn, 'creator_import_batches', 'welcome_template_id', 'welcome_template_id BIGINT DEFAULT NULL AFTER send_welcome');
    await ensureColumn(dbConn, 'creator_import_batches', 'welcome_template_key', 'welcome_template_key VARCHAR(64) DEFAULT NULL AFTER welcome_template_id');

    await dbConn.prepare(`
        CREATE TABLE IF NOT EXISTS creator_import_items (
            id BIGINT PRIMARY KEY AUTO_INCREMENT,
            batch_id BIGINT NOT NULL,
            row_index INT NOT NULL,
            creator_id INT DEFAULT NULL,
            owner VARCHAR(64) NOT NULL,
            input_name VARCHAR(255) DEFAULT NULL,
            input_phone VARCHAR(64) DEFAULT NULL,
            normalized_name VARCHAR(255) DEFAULT NULL,
            normalized_phone VARCHAR(32) DEFAULT NULL,
            import_status VARCHAR(32) NOT NULL DEFAULT 'pending',
            send_status VARCHAR(32) NOT NULL DEFAULT 'not_requested',
            error TEXT DEFAULT NULL,
            wa_message_id VARCHAR(255) DEFAULT NULL,
            routed_session_id VARCHAR(64) DEFAULT NULL,
            routed_operator VARCHAR(64) DEFAULT NULL,
            attempt_count INT NOT NULL DEFAULT 0,
            last_attempt_at DATETIME DEFAULT NULL,
            sent_at DATETIME DEFAULT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            UNIQUE KEY uk_creator_import_item_batch_row (batch_id, row_index),
            KEY idx_creator_import_items_batch (batch_id),
            KEY idx_creator_import_items_creator (creator_id),
            KEY idx_creator_import_items_send_status (send_status),
            CONSTRAINT fk_creator_import_items_batch
                FOREIGN KEY (batch_id) REFERENCES creator_import_batches(id) ON DELETE CASCADE,
            CONSTRAINT fk_creator_import_items_creator
                FOREIGN KEY (creator_id) REFERENCES creators(id) ON DELETE SET NULL
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `).run();
}

function normalizeTemplateRow(row = null) {
    if (!row) return null;
    return {
        id: row.id,
        owner: row.owner,
        template_key: row.template_key,
        label: row.label || row.template_key || 'Welcome',
        body: row.body || '',
        is_active: Number(row.is_active) ? 1 : 0,
        created_by: row.created_by || null,
        created_at: row.created_at || null,
        updated_at: row.updated_at || null,
    };
}

async function listOutreachTemplates({ owner, includeInactive = false } = {}) {
    await ensureCreatorImportBatchSchema();
    const normalizedOwner = normalizeOperatorName(owner, owner || null);
    if (!normalizedOwner) throw new Error('owner required');
    const rows = await db.getDb().prepare(`
        SELECT *
        FROM operator_outreach_templates
        WHERE owner = ?
          ${includeInactive ? '' : 'AND is_active = 1'}
        ORDER BY updated_at DESC, id DESC
        LIMIT 100
    `).all(normalizedOwner);
    return rows.map(normalizeTemplateRow);
}

async function getOutreachTemplate({ owner, templateKey = 'welcome' } = {}) {
    await ensureCreatorImportBatchSchema();
    const normalizedOwner = normalizeOperatorName(owner, owner || null);
    if (!normalizedOwner) throw new Error('owner required');
    const key = normalizeTemplateKey(templateKey, 'welcome');
    const row = await db.getDb().prepare(`
        SELECT *
        FROM operator_outreach_templates
        WHERE owner = ? AND template_key = ? AND is_active = 1
        LIMIT 1
    `).get(normalizedOwner, key);
    return normalizeTemplateRow(row);
}

async function upsertOutreachTemplate({
    owner,
    templateKey = 'welcome',
    label = '',
    body,
    isActive = true,
    createdBy = null,
    req = null,
}) {
    await ensureCreatorImportBatchSchema();
    const normalizedOwner = normalizeOperatorName(owner, owner || null);
    if (!normalizedOwner) throw new Error('owner required');
    const key = normalizeTemplateKey(templateKey, 'welcome');
    const safeLabel = normalizeTemplateLabel(label || key, key);
    const safeBody = normalizeTemplateBody(body);
    if (!safeBody) throw new Error('body required');
    if (safeBody.length > 6000) throw new Error('body too long');
    const active = toBool(isActive, true) ? 1 : 0;

    const oldRow = await db.getDb().prepare(`
        SELECT *
        FROM operator_outreach_templates
        WHERE owner = ? AND template_key = ?
        LIMIT 1
    `).get(normalizedOwner, key);

    await db.getDb().prepare(`
        INSERT INTO operator_outreach_templates
            (owner, template_key, label, body, is_active, created_by)
        VALUES (?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
            label = VALUES(label),
            body = VALUES(body),
            is_active = VALUES(is_active),
            created_by = VALUES(created_by),
            updated_at = CURRENT_TIMESTAMP
    `).run(normalizedOwner, key, safeLabel, safeBody, active, createdBy || null);

    const saved = await db.getDb().prepare(`
        SELECT *
        FROM operator_outreach_templates
        WHERE owner = ? AND template_key = ?
        LIMIT 1
    `).get(normalizedOwner, key);

    await writeAudit(
        oldRow ? 'operator_outreach_template_update' : 'operator_outreach_template_create',
        'operator_outreach_templates',
        saved?.id || null,
        oldRow ? normalizeTemplateRow(oldRow) : null,
        normalizeTemplateRow(saved),
        req,
    );

    return normalizeTemplateRow(saved);
}

async function findPhoneConflictRows(txDb, normalizedPhone) {
    if (!normalizedPhone) return [];
    return await txDb.prepare(`
        SELECT id, primary_name, wa_phone, wa_owner
        FROM creators
        WHERE wa_phone = ?
           OR REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(wa_phone, '+', ''), ' ', ''), '-', ''), '(', ''), ')', '') = ?
        ORDER BY id DESC
        LIMIT 10
    `).all(normalizedPhone, normalizedPhone);
}

async function createImportBatch({
    rows,
    owner,
    source = 'csv-import',
    sendWelcome = false,
    welcomeText = '',
    welcomeTemplateKey = 'welcome',
    createdBy = null,
    lockedOwner = null,
    req = null,
}) {
    await ensureCreatorImportBatchSchema();

    if (!Array.isArray(rows)) throw new Error('rows array required');
    if (rows.length === 0) throw new Error('rows is empty');
    if (rows.length > MAX_ROWS_PER_BATCH) throw new Error(`too many rows (max ${MAX_ROWS_PER_BATCH} per request)`);

    const normalizedOwner = normalizeOperatorName(owner, owner || null);
    if (!normalizedOwner) throw new Error('owner required');
    const safeSource = String(source || 'csv-import').trim() || 'csv-import';
    const shouldSendWelcome = toBool(sendWelcome, false);
    const templateKey = normalizeTemplateKey(welcomeTemplateKey, 'welcome');
    const selectedTemplate = shouldSendWelcome
        ? await getOutreachTemplate({ owner: normalizedOwner, templateKey })
        : null;
    const safeWelcomeText = normalizeTemplateBody(welcomeText) || selectedTemplate?.body || '';
    if (shouldSendWelcome && !safeWelcomeText) {
        throw new Error('welcome_text or active outreach template required when send_welcome=true');
    }

    const batch = await db.getDb().transaction(async (txDb) => {
        const batchInsert = await txDb.prepare(`
            INSERT INTO creator_import_batches
                (owner, source, status, send_welcome, welcome_template_id, welcome_template_key, welcome_text, total_count, created_by)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            normalizedOwner,
            safeSource,
            shouldSendWelcome ? 'running' : 'completed',
            shouldSendWelcome ? 1 : 0,
            selectedTemplate?.id || null,
            shouldSendWelcome ? templateKey : null,
            safeWelcomeText || null,
            rows.length,
            createdBy || null,
        );
        const batchId = Number(batchInsert.lastInsertRowid || 0);

        let createdCount = 0;
        let reusedCount = 0;
        let skippedCount = 0;
        let errorCount = 0;
        let welcomeQueuedCount = 0;

        for (let i = 0; i < rows.length; i += 1) {
            const row = rows[i] || {};
            const inputName = String(row.name || row.primary_name || '').trim();
            const inputPhone = String(row.phone || row.wa_phone || '').trim();
            const normalizedName = normalizeName(inputName);
            const normalizedPhone = normalizePhone(inputPhone);

            if (!normalizedName || !normalizedPhone) {
                skippedCount += 1;
                await txDb.prepare(`
                    INSERT INTO creator_import_items
                        (batch_id, row_index, owner, input_name, input_phone, normalized_name, normalized_phone, import_status, send_status, error)
                    VALUES (?, ?, ?, ?, ?, ?, ?, 'skipped', 'not_requested', ?)
                `).run(
                    batchId,
                    i,
                    normalizedOwner,
                    inputName || null,
                    inputPhone || null,
                    normalizedName || null,
                    normalizedPhone || null,
                    !normalizedName ? 'name required' : 'phone required',
                );
                continue;
            }

            try {
                const samePhoneRows = await findPhoneConflictRows(txDb, normalizedPhone);
                if (lockedOwner && samePhoneRows.some((item) => !ownersEqual(item.wa_owner, lockedOwner))) {
                    errorCount += 1;
                    await txDb.prepare(`
                        INSERT INTO creator_import_items
                            (batch_id, row_index, owner, input_name, input_phone, normalized_name, normalized_phone, import_status, send_status, error)
                        VALUES (?, ?, ?, ?, ?, ?, ?, 'error', 'not_requested', 'phone already belongs to another owner')
                    `).run(
                        batchId,
                        i,
                        normalizedOwner,
                        inputName || null,
                        inputPhone || null,
                        normalizedName || null,
                        normalizedPhone || null,
                    );
                    continue;
                }
                const reused = samePhoneRows.length > 0;
                let creatorId = Number(samePhoneRows[0]?.id || 0);
                if (creatorId) {
                    await txDb.prepare(`
                        UPDATE creators
                        SET primary_name = ?,
                            wa_owner = ?,
                            source = ?,
                            updated_at = CURRENT_TIMESTAMP
                        WHERE id = ?
                    `).run(normalizedName, normalizedOwner, safeSource, creatorId);
                } else {
                    const upsertCreator = await txDb.prepare(`
                        INSERT INTO creators (primary_name, wa_phone, wa_owner, source)
                        VALUES (?, ?, ?, ?)
                        ON DUPLICATE KEY UPDATE
                            id = LAST_INSERT_ID(id),
                            primary_name = VALUES(primary_name),
                            wa_owner = VALUES(wa_owner),
                            source = VALUES(source),
                            updated_at = CURRENT_TIMESTAMP
                    `).run(normalizedName, normalizedPhone, normalizedOwner, safeSource);
                    creatorId = Number(upsertCreator.lastInsertRowid || 0);
                }
                const sessionId = getSessionIdForOperator(normalizedOwner) || String(normalizedOwner || '').toLowerCase();

                await txDb.prepare(`
                    INSERT INTO ${ROSTER_TABLE}
                        (creator_id, operator, session_id, source_file, raw_name, match_strategy, score, is_primary)
                    VALUES (?, ?, ?, ?, ?, ?, ?, 1)
                    ON DUPLICATE KEY UPDATE
                        operator = VALUES(operator),
                        session_id = VALUES(session_id),
                        source_file = VALUES(source_file),
                        raw_name = VALUES(raw_name),
                        match_strategy = VALUES(match_strategy),
                        score = VALUES(score),
                        is_primary = 1,
                        updated_at = CURRENT_TIMESTAMP
                `).run(creatorId, normalizedOwner, sessionId, safeSource, normalizedName, 'csv-import', 100);

                await txDb.prepare('INSERT IGNORE INTO wa_crm_data (creator_id) VALUES (?)').run(creatorId);

                if (reused) reusedCount += 1; else createdCount += 1;
                if (shouldSendWelcome) welcomeQueuedCount += 1;
                await txDb.prepare(`
                    INSERT INTO creator_import_items
                        (batch_id, row_index, creator_id, owner, input_name, input_phone, normalized_name, normalized_phone, import_status, send_status)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `).run(
                    batchId,
                    i,
                    creatorId,
                    normalizedOwner,
                    inputName,
                    inputPhone,
                    normalizedName,
                    normalizedPhone,
                    reused ? 'reused' : 'created',
                    shouldSendWelcome ? 'queued' : 'not_requested',
                );
            } catch (err) {
                errorCount += 1;
                await txDb.prepare(`
                    INSERT INTO creator_import_items
                        (batch_id, row_index, owner, input_name, input_phone, normalized_name, normalized_phone, import_status, send_status, error)
                    VALUES (?, ?, ?, ?, ?, ?, ?, 'error', 'not_requested', ?)
                `).run(
                    batchId,
                    i,
                    normalizedOwner,
                    inputName || null,
                    inputPhone || null,
                    normalizedName || null,
                    normalizedPhone || null,
                    err.message || 'unknown error',
                );
            }
        }

        await txDb.prepare(`
            UPDATE creator_import_batches
            SET created_count = ?,
                reused_count = ?,
                skipped_count = ?,
                error_count = ?,
                welcome_queued_count = ?,
                completed_at = CASE WHEN send_welcome = 0 THEN NOW() ELSE completed_at END
            WHERE id = ?
        `).run(createdCount, reusedCount, skippedCount, errorCount, welcomeQueuedCount, batchId);

        return {
            id: batchId,
            owner: normalizedOwner,
            source: safeSource,
            status: shouldSendWelcome ? 'running' : 'completed',
            send_welcome: shouldSendWelcome,
            welcome_template_id: selectedTemplate?.id || null,
            welcome_template_key: shouldSendWelcome ? templateKey : null,
            summary: {
                total: rows.length,
                created: createdCount,
                reused: reusedCount,
                skipped: skippedCount,
                errors: errorCount,
                welcome_queued: welcomeQueuedCount,
                welcome_sent: 0,
                welcome_failed: 0,
            },
        };
    });

    await writeAudit('creator_import_batch_create', 'creator_import_batches', batch.id, null, {
        owner: batch.owner,
        source: batch.source,
        total: batch.summary.total,
        created: batch.summary.created,
        reused: batch.summary.reused,
        skipped: batch.summary.skipped,
        errors: batch.summary.errors,
        send_welcome: batch.send_welcome,
        welcome_template_id: batch.welcome_template_id || null,
        welcome_template_key: batch.welcome_template_key || null,
    }, req);

    if (batch.send_welcome) {
        runImportBatch(batch.id, { req }).catch((err) => {
            console.error(`[creatorImportBatch] run ${batch.id} failed:`, err.message);
        });
    }

    return batch;
}

async function fetchBatch(batchId, { includeItems = true } = {}) {
    await ensureCreatorImportBatchSchema();
    const id = Number(batchId);
    if (!Number.isInteger(id) || id <= 0) return null;
    const batch = await db.getDb().prepare(`
        SELECT *
        FROM creator_import_batches
        WHERE id = ?
        LIMIT 1
    `).get(id);
    if (!batch) return null;
    const items = includeItems
        ? await db.getDb().prepare(`
            SELECT *
            FROM creator_import_items
            WHERE batch_id = ?
            ORDER BY row_index ASC
        `).all(id)
        : [];
    return {
        ...batch,
        send_welcome: !!batch.send_welcome,
        summary: {
            total: Number(batch.total_count || 0),
            created: Number(batch.created_count || 0),
            reused: Number(batch.reused_count || 0),
            skipped: Number(batch.skipped_count || 0),
            errors: Number(batch.error_count || 0),
            welcome_queued: Number(batch.welcome_queued_count || 0),
            welcome_sent: Number(batch.welcome_sent_count || 0),
            welcome_failed: Number(batch.welcome_failed_count || 0),
        },
        items,
    };
}

async function updateBatchSendCounts(batchId, status = null) {
    const row = await db.getDb().prepare(`
        SELECT
            SUM(CASE WHEN send_status = 'sent' THEN 1 ELSE 0 END) AS sent_count,
            SUM(CASE WHEN send_status = 'failed' THEN 1 ELSE 0 END) AS failed_count,
            SUM(CASE WHEN send_status IN ('queued', 'sending') THEN 1 ELSE 0 END) AS pending_count
        FROM creator_import_items
        WHERE batch_id = ?
    `).get(batchId);
    const sent = Number(row?.sent_count || 0);
    const failed = Number(row?.failed_count || 0);
    const pending = Number(row?.pending_count || 0);
    const nextStatus = status || (pending > 0 ? 'running' : (failed > 0 ? 'completed_with_errors' : 'completed'));
    await db.getDb().prepare(`
        UPDATE creator_import_batches
        SET welcome_sent_count = ?,
            welcome_failed_count = ?,
            status = ?,
            completed_at = CASE WHEN ? = 0 THEN NOW() ELSE completed_at END
        WHERE id = ?
    `).run(sent, failed, nextStatus, pending, batchId);
    return { sent, failed, pending, status: nextStatus };
}

async function runImportBatch(batchId, { req = null, retryFailed = false } = {}) {
    await ensureCreatorImportBatchSchema();
    const id = Number(batchId);
    if (!Number.isInteger(id) || id <= 0) throw new Error('invalid batch id');
    if (activeRuns.has(id)) return await fetchBatch(id);

    activeRuns.add(id);
    try {
        const batch = await fetchBatch(id, { includeItems: false });
        if (!batch) throw new Error('batch not found');
        if (!batch.send_welcome) return batch;
        if (!batch.welcome_text) throw new Error('batch has empty welcome_text');

        await db.getDb().prepare(`
            UPDATE creator_import_batches
            SET status = 'running', started_at = COALESCE(started_at, NOW())
            WHERE id = ?
        `).run(id);

        const statuses = retryFailed ? ['queued', 'failed'] : ['queued'];
        const placeholders = statuses.map(() => '?').join(', ');
        const items = await db.getDb().prepare(`
            SELECT *
            FROM creator_import_items
            WHERE batch_id = ?
              AND import_status IN ('created', 'reused')
              AND send_status IN (${placeholders})
            ORDER BY row_index ASC
        `).all(id, ...statuses);

        for (const item of items) {
            await db.getDb().prepare(`
                UPDATE creator_import_items
                SET send_status = 'sending',
                    attempt_count = attempt_count + 1,
                    last_attempt_at = NOW(),
                    error = NULL
                WHERE id = ?
            `).run(item.id);

            const result = await sendRoutedMessage({
                phone: item.normalized_phone,
                text: batch.welcome_text,
                operator: batch.owner,
                creator_id: item.creator_id,
            });

            if (result?.ok) {
                const waMessageId = typeof result.messageId === 'string' && result.messageId.trim()
                    ? result.messageId.trim()
                    : (typeof result.id === 'string' && result.id.trim() ? result.id.trim() : null);
                await persistDirectMessageRecord({
                    dbConn: db.getDb(),
                    creatorId: item.creator_id,
                    role: 'me',
                    operator: result.routed_operator || batch.owner,
                    text: batch.welcome_text,
                    timestamp: result.timestamp || Date.now(),
                    waMessageId,
                    req,
                    auditAction: 'creator_import_welcome_send',
                    shortWindowGuard: false,
                    groupConflictGuard: false,
                });
                await db.getDb().prepare(`
                    UPDATE creator_import_items
                    SET send_status = 'sent',
                        wa_message_id = ?,
                        routed_session_id = ?,
                        routed_operator = ?,
                        sent_at = NOW()
                    WHERE id = ?
                `).run(
                    waMessageId,
                    result.routed_session_id || null,
                    result.routed_operator || batch.owner,
                    item.id,
                );
            } else {
                await db.getDb().prepare(`
                    UPDATE creator_import_items
                    SET send_status = 'failed',
                        routed_session_id = ?,
                        routed_operator = ?,
                        error = ?
                    WHERE id = ?
                `).run(
                    result?.routed_session_id || null,
                    result?.routed_operator || batch.owner,
                    result?.error || 'send failed',
                    item.id,
                );
            }

            await updateBatchSendCounts(id);
            if (DEFAULT_SEND_DELAY_MS > 0) await sleep(DEFAULT_SEND_DELAY_MS);
        }

        await updateBatchSendCounts(id);
        return await fetchBatch(id);
    } finally {
        activeRuns.delete(id);
    }
}

module.exports = {
    createImportBatch,
    ensureCreatorImportBatchSchema,
    fetchBatch,
    getOutreachTemplate,
    listOutreachTemplates,
    runImportBatch,
    upsertOutreachTemplate,
};
