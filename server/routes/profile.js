/**
 * Profile routes
 * GET /api/client-memory/:clientId, POST /api/client-memory,
 * GET /api/client-profile/:clientId, PUT /api/client-profile/:clientId,
 * PUT /api/client-profiles/:clientId/tags,
 * POST /api/client-profiles/:clientId/memory,
 * DELETE /api/client-profiles/:clientId/memory,
 * POST /api/profile-agent/event
 */
const express = require('express');
const router = express.Router();
const db = require('../../db');
const { writeAudit } = require('../middleware/audit');

// GET /api/client-memory/:clientId
router.get('/client-memory/:clientId', (req, res) => {
    try {
        const { clientId } = req.params;
        if (!clientId || typeof clientId !***REMOVED*** 'string' || clientId.length > 50) {
            return res.status(400).json({ error: 'invalid clientId' });
        }
        const db2 = db.getDb();
        const rows = db2.prepare(`
            SELECT * FROM client_memory
            WHERE client_id = ?
            ORDER BY memory_type, confidence DESC
        `).all(clientId);
        res.json(rows);
    } catch (err) {
        console.error('GET /api/client-memory error:', err);
        res.status(500).json({ error: err.message });
    }
});

// POST /api/client-memory
router.post('/client-memory', (req, res) => {
    try {
        const { client_id, memory_type, memory_key, memory_value, confidence = 1 } = req.body;
        if (!client_id || !memory_type || !memory_key || !memory_value) {
            return res.status(400).json({ error: 'client_id, memory_type, memory_key, memory_value required' });
        }
        const db2 = db.getDb();
        db2.prepare(`
            INSERT INTO client_memory
            (client_id, memory_type, memory_key, memory_value, confidence, updated_at)
            VALUES (?, ?, ?, ?, ?, NOW())
            ON DUPLICATE KEY UPDATE memory_value = VALUES(memory_value), confidence = VALUES(confidence), updated_at = NOW()
        `).run(client_id, memory_type, memory_key, memory_value, confidence);

        writeAudit('client_memory_update', 'client_memory', null, null, {
            client_id, memory_type, memory_key, memory_value, confidence
        }, req);
        res.json({ ok: true });
    } catch (err) {
        console.error('POST /api/client-memory error:', err);
        res.status(500).json({ error: err.message });
    }
});

// GET /api/client-profile/:clientId
router.get('/client-profile/:clientId', (req, res) => {
    try {
        const db2 = db.getDb();
        const { clientId } = req.params;

        const profile = db2.prepare('SELECT * FROM client_profiles WHERE client_id = ?').get(clientId);
        const tags = db2.prepare(
            'SELECT * FROM client_tags WHERE client_id = ? ORDER BY confidence DESC'
        ).all(clientId);
        const memory = db2.prepare(
            'SELECT * FROM client_memory WHERE client_id = ? ORDER BY created_at DESC LIMIT 20'
        ).all(clientId);

        const profileData = profile || { summary: null, tiktok_data: null, stage: null, last_interaction: null, last_updated: null };

        const creator = db2.prepare(`
            SELECT c.primary_name as name, c.wa_owner, c.keeper_username,
                   wc.beta_status as conversion_stage, wc.priority,
                   k.keeper_gmv, k.keeper_videos, k.keeper_orders
            FROM creators c
            LEFT JOIN wa_crm_data wc ON wc.creator_id = c.id
            LEFT JOIN keeper_link k ON k.creator_id = c.id
            WHERE c.wa_phone = ?
        `).get(clientId);

        res.json({
            client_id: clientId,
            name: creator?.name || null,
            wa_owner: creator?.wa_owner || null,
            keeper_username: creator?.keeper_username || null,
            conversion_stage: creator?.conversion_stage || null,
            priority: creator?.priority || null,
            summary: profileData.summary || null,
            tags: tags.map(t => ({ tag: t.tag, source: t.source, confidence: t.confidence })),
            tiktok_data: profileData.tiktok_data ? JSON.parse(profileData.tiktok_data) : null,
            stage: profileData.stage || creator?.conversion_stage || null,
            last_interaction: profileData.last_interaction,
            last_updated: profileData.last_updated,
            memory: memory.map(m => ({ type: m.memory_type, key: m.memory_key, value: m.memory_value })),
        });
    } catch (err) {
        console.error('GET /api/client-profile error:', err);
        res.status(500).json({ error: err.message });
    }
});

// PUT /api/client-profile/:clientId
router.put('/client-profile/:clientId', (req, res) => {
    try {
        const db2 = db.getDb();
        const { clientId } = req.params;
        const { summary } = req.body;

        const updated = db2.prepare(`
            UPDATE client_profiles SET summary = ?, last_updated = CURRENT_TIMESTAMP WHERE client_id = ?
        `).run(summary || '', clientId);

        if (updated.changes ***REMOVED***= 0) {
            db2.prepare(`
                INSERT INTO client_profiles (client_id, summary) VALUES (?, ?)
            `).run(clientId, summary || '');
        }

        res.json({ ok: true });
    } catch (err) {
        console.error('PUT /api/client-profile error:', err);
        res.status(500).json({ error: err.message });
    }
});

// PUT /api/client-profiles/:clientId/tags
router.put('/client-profiles/:clientId/tags', (req, res) => {
    try {
        const db2 = db.getDb();
        const { clientId } = req.params;
        const { tag, value, action = 'upsert', confidence = 3 } = req.body;

        if (!tag) return res.status(400).json({ error: 'tag required' });

        if (action ***REMOVED***= 'delete') {
            db2.prepare('DELETE FROM client_tags WHERE client_id = ? AND tag = ?').run(clientId, tag);
        } else {
            const fullTag = tag.includes(':') ? tag : `${tag}:${value || 'true'}`;
            db2.prepare(`
                INSERT INTO client_tags (client_id, tag, source, confidence)
                VALUES (?, ?, 'manual', ?)
                ON DUPLICATE KEY UPDATE confidence = VALUES(confidence), tag = VALUES(tag)
            `).run(clientId, fullTag, confidence);
        }

        res.json({ ok: true });
    } catch (err) {
        console.error('PUT /api/client-profiles/tags error:', err);
        res.status(500).json({ error: err.message });
    }
});

// POST /api/client-profiles/:clientId/memory
router.post('/client-profiles/:clientId/memory', (req, res) => {
    try {
        const db2 = db.getDb();
        const { clientId } = req.params;
        const { memory_type, memory_key, memory_value } = req.body;

        if (!memory_type || !memory_key || memory_value ***REMOVED***= undefined) {
            return res.status(400).json({ error: 'memory_type, memory_key and memory_value required' });
        }

        db2.prepare(`
            INSERT INTO client_memory (client_id, memory_type, memory_key, memory_value)
            VALUES (?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE memory_value = VALUES(memory_value)
        `).run(clientId, memory_type, memory_key, memory_value);

        res.json({ ok: true });
    } catch (err) {
        console.error('POST /api/client-profiles/memory error:', err);
        res.status(500).json({ error: err.message });
    }
});

// DELETE /api/client-profiles/:clientId/memory
router.delete('/client-profiles/:clientId/memory', (req, res) => {
    try {
        const db2 = db.getDb();
        const { clientId } = req.params;
        const { memory_type, memory_key } = req.body;

        if (!memory_type || !memory_key) {
            return res.status(400).json({ error: 'memory_type and memory_key required' });
        }

        db2.prepare('DELETE FROM client_memory WHERE client_id = ? AND memory_type = ? AND memory_key = ?')
            .run(clientId, memory_type, memory_key);

        res.json({ ok: true });
    } catch (err) {
        console.error('DELETE /api/client-profiles/memory error:', err);
        res.status(500).json({ error: err.message });
    }
});

// POST /api/profile-agent/event
router.post('/profile-agent/event', (req, res) => {
    try {
        const { event_type, client_id, data: eventData } = req.body;
        if (!event_type || !client_id) {
            return res.status(400).json({ error: 'event_type and client_id required' });
        }

        const db2 = db.getDb();

        const creator = db2.prepare('SELECT id FROM creators WHERE wa_phone = ?').get(client_id);
        if (!creator) {
            return res.status(404).json({ error: 'client not found' });
        }

        let profile = db2.prepare('SELECT id FROM client_profiles WHERE client_id = ?').get(client_id);
        if (!profile) {
            db2.prepare('INSERT INTO client_profiles (client_id) VALUES (?)').run(client_id);
        }

        let tags_added = [];

        if (event_type ***REMOVED***= 'wa_message') {
            const { text, role } = eventData || {};
            if (text) {
                const t = text.toLowerCase();
                if (/\b(prefer|更喜欢|比较喜欢)\b/.test(t)) {
                    if (/\bvideo\b/.test(t)) tags_added.push({ tag: 'format:video', source: 'ai_extracted' });
                    if (/\btext\b/.test(t)) tags_added.push({ tag: 'format:text', source: 'ai_extracted' });
                }
                if (/\b(please|would|could|kindly)\b/.test(t)) {
                    tags_added.push({ tag: 'tone:formal', source: 'ai_extracted' });
                }
                if (/\b(today|tonight|马上|立刻|赶紧)\b/.test(t)) {
                    tags_added.push({ tag: 'urgency:high', source: 'ai_extracted' });
                }
            }
        }

        // Insert tags
        for (const { tag, source } of tags_added) {
            db2.prepare(
                'INSERT OR IGNORE INTO client_tags (client_id, tag, source, confidence) VALUES (?, ?, ?, 2)'
            ).run(client_id, tag, source);
        }

        // Trigger async profile refresh
        const { scheduleProfileRefresh } = require('../services/profileService');
        scheduleProfileRefresh(client_id);

        res.json({ ok: true, tags_added });
    } catch (err) {
        console.error('POST /api/profile-agent/event error:', err);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
