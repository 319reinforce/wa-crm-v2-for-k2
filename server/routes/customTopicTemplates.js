/**
 * Custom topic template routes
 * GET /api/custom-topic-templates
 * POST /api/custom-topic-templates
 * PUT /api/custom-topic-templates/:id
 */
const express = require('express');
const router = express.Router();
const db = require('../../db');
const { writeAudit } = require('../middleware/audit');
const { assertManagedSchemaReady } = require('../services/schemaReadinessGuard');

let tableEnsured = false;

async function ensureCustomTopicTemplatesTable(db2) {
    if (tableEnsured) return;
    await assertManagedSchemaReady(db2, {
        feature: 'Custom topic templates',
        migration: 'server/migrations/008_template_media_training_tables.sql',
        tables: ['custom_topic_templates'],
        columns: {
            custom_topic_templates: [
                'id', 'label', 'topic_group', 'intent_key', 'scene_key', 'template_text',
                'media_items_json', 'owner_scope', 'created_by', 'is_active', 'created_at', 'updated_at',
            ],
        },
    });
    tableEnsured = true;
}

function normalizeText(value, maxLength = 128) {
    return String(value || '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function normalizeTemplateText(value) {
    return String(value || '').replace(/\r\n/g, '\n').trim();
}

function normalizeMediaItems(value) {
    const rawItems = Array.isArray(value)
        ? value
        : typeof value === 'string'
            ? value.split(/\n+/).map((line) => ({ url: line }))
            : [];
    return rawItems
        .map((item) => {
            const media = typeof item === 'string' ? { url: item } : (item || {});
            return {
                url: normalizeTemplateText(media.url || media.file_url || ''),
                label: normalizeText(media.label || media.title || media.file_name || '对应图片', 96),
                note: normalizeText(media.note || media.description || '', 160),
                media_asset_id: Number.isFinite(Number(media.media_asset_id || media.id))
                    ? Number(media.media_asset_id || media.id)
                    : null,
            };
        })
        .filter((item) => item.url || item.media_asset_id)
        .slice(0, 6);
}

function parseMediaItems(row = {}) {
    if (!row.media_items_json) return [];
    try {
        return normalizeMediaItems(JSON.parse(row.media_items_json));
    } catch (_) {
        return [];
    }
}

function normalizeRow(row = {}) {
    return {
        id: row.id,
        label: row.label,
        topic_group: row.topic_group || 'custom_topic',
        intent_key: row.intent_key || 'custom_template',
        scene_key: row.scene_key || 'follow_up',
        template_text: row.template_text || '',
        media_items: parseMediaItems(row),
        owner_scope: row.owner_scope || null,
        created_by: row.created_by || null,
        is_active: Number(row.is_active) ? 1 : 0,
        created_at: row.created_at || null,
        updated_at: row.updated_at || null,
    };
}

function getOwnerScope(req) {
    return req?.auth?.owner || 'global';
}

// GET /api/custom-topic-templates
router.get('/custom-topic-templates', async (req, res) => {
    try {
        const db2 = db.getDb();
        await ensureCustomTopicTemplatesTable(db2);
        const ownerScope = getOwnerScope(req);
        const rows = await db2.prepare(`
            SELECT *
            FROM custom_topic_templates
            WHERE is_active = 1
              AND (owner_scope = 'global' OR owner_scope = ?)
            ORDER BY updated_at DESC, id DESC
            LIMIT 100
        `).all(ownerScope);
        res.json({ ok: true, templates: rows.map(normalizeRow) });
    } catch (err) {
        console.error('GET /api/custom-topic-templates error:', err);
        res.status(500).json({ error: err.message });
    }
});

// POST /api/custom-topic-templates
router.post('/custom-topic-templates', async (req, res) => {
    try {
        const label = normalizeText(req.body?.label);
        const templateText = normalizeTemplateText(req.body?.template_text || req.body?.template);
        const mediaItems = normalizeMediaItems(req.body?.media_items || req.body?.media_urls || []);
        if (!label || (!templateText && mediaItems.length === 0)) {
            return res.status(400).json({ error: 'label and template_text or media_items required' });
        }
        if (templateText.length > 6000) {
            return res.status(400).json({ error: 'template_text too long' });
        }

        const db2 = db.getDb();
        await ensureCustomTopicTemplatesTable(db2);
        const ownerScope = getOwnerScope(req);
        const createdBy = req?.auth?.username || req?.auth?.token_principal || 'unknown';
        const topicGroup = normalizeText(req.body?.topic_group || 'custom_topic', 64) || 'custom_topic';
        const intentKey = normalizeText(req.body?.intent_key || 'custom_template', 64) || 'custom_template';
        const sceneKey = normalizeText(req.body?.scene_key || 'follow_up', 64) || 'follow_up';
        const mediaItemsJson = mediaItems.length ? JSON.stringify(mediaItems) : null;

        const oldRow = await db2.prepare(`
            SELECT *
            FROM custom_topic_templates
            WHERE owner_scope = ? AND label = ?
            LIMIT 1
        `).get(ownerScope, label);

        await db2.prepare(`
            INSERT INTO custom_topic_templates
                (label, topic_group, intent_key, scene_key, template_text, media_items_json, owner_scope, created_by, is_active)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
            ON DUPLICATE KEY UPDATE
                topic_group = VALUES(topic_group),
                intent_key = VALUES(intent_key),
                scene_key = VALUES(scene_key),
                template_text = VALUES(template_text),
                media_items_json = VALUES(media_items_json),
                created_by = VALUES(created_by),
                is_active = 1,
                updated_at = CURRENT_TIMESTAMP
        `).run(label, topicGroup, intentKey, sceneKey, templateText, mediaItemsJson, ownerScope, createdBy);

        const saved = await db2.prepare(`
            SELECT *
            FROM custom_topic_templates
            WHERE owner_scope = ? AND label = ?
            LIMIT 1
        `).get(ownerScope, label);

        await writeAudit(
            oldRow ? 'custom_topic_template_update' : 'custom_topic_template_create',
            'custom_topic_templates',
            saved?.id || null,
            oldRow || null,
            {
                id: saved?.id || null,
                label,
                topic_group: topicGroup,
                intent_key: intentKey,
                scene_key: sceneKey,
                owner_scope: ownerScope,
                media_items_count: mediaItems.length,
            },
            req
        );

        res.json({ ok: true, template: normalizeRow(saved) });
    } catch (err) {
        console.error('POST /api/custom-topic-templates error:', err);
        res.status(500).json({ error: err.message });
    }
});

// PUT /api/custom-topic-templates/:id
router.put('/custom-topic-templates/:id', async (req, res) => {
    try {
        const id = Number(req.params.id);
        if (!Number.isInteger(id) || id <= 0) {
            return res.status(400).json({ error: 'valid id required' });
        }
        const label = normalizeText(req.body?.label);
        const templateText = normalizeTemplateText(req.body?.template_text || req.body?.template);
        const mediaItems = normalizeMediaItems(req.body?.media_items || req.body?.media_urls || []);
        if (!label || (!templateText && mediaItems.length === 0)) {
            return res.status(400).json({ error: 'label and template_text or media_items required' });
        }
        if (templateText.length > 6000) {
            return res.status(400).json({ error: 'template_text too long' });
        }

        const db2 = db.getDb();
        await ensureCustomTopicTemplatesTable(db2);
        const ownerScope = getOwnerScope(req);
        const oldRow = await db2.prepare(`
            SELECT *
            FROM custom_topic_templates
            WHERE id = ? AND owner_scope = ?
            LIMIT 1
        `).get(id, ownerScope);
        if (!oldRow) {
            return res.status(404).json({ error: 'template not found' });
        }

        const topicGroup = normalizeText(req.body?.topic_group || oldRow.topic_group || 'custom_topic', 64) || 'custom_topic';
        const intentKey = normalizeText(req.body?.intent_key || oldRow.intent_key || 'custom_template', 64) || 'custom_template';
        const sceneKey = normalizeText(req.body?.scene_key || oldRow.scene_key || 'follow_up', 64) || 'follow_up';
        const mediaItemsJson = mediaItems.length ? JSON.stringify(mediaItems) : null;

        await db2.prepare(`
            UPDATE custom_topic_templates
            SET label = ?,
                topic_group = ?,
                intent_key = ?,
                scene_key = ?,
                template_text = ?,
                media_items_json = ?,
                is_active = 1,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ? AND owner_scope = ?
        `).run(label, topicGroup, intentKey, sceneKey, templateText, mediaItemsJson, id, ownerScope);

        const saved = await db2.prepare(`
            SELECT *
            FROM custom_topic_templates
            WHERE id = ? AND owner_scope = ?
            LIMIT 1
        `).get(id, ownerScope);

        await writeAudit(
            'custom_topic_template_update',
            'custom_topic_templates',
            id,
            oldRow,
            {
                id,
                label,
                topic_group: topicGroup,
                intent_key: intentKey,
                scene_key: sceneKey,
                owner_scope: ownerScope,
                media_items_count: mediaItems.length,
            },
            req
        );

        res.json({ ok: true, template: normalizeRow(saved) });
    } catch (err) {
        console.error('PUT /api/custom-topic-templates/:id error:', err);
        if (err?.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({ error: 'template label already exists' });
        }
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
