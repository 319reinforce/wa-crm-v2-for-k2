/**
 * Messages routes
 * GET /api/creators/:id/messages, POST /api/creators/:id/messages
 */
const express = require('express');
const router = express.Router({ mergeParams: true });
const db = require('../../db');

// GET /api/creators/:id/messages
router.get('/', async (req, res) => {
    try {
        const creatorId = parseInt(req.params.id);
        const limit = Math.min(parseInt(req.query.limit) || 100, 1000);
        const offset = parseInt(req.query.offset) || 0;
        const safeLimit = Number.isFinite(limit) && limit > 0 ? limit : 100;
        const safeOffset = Number.isFinite(offset) && offset >= 0 ? offset : 0;

        // MySQL prepared statements may reject LIMIT/OFFSET placeholders in some driver paths.
        // These values are validated integers, so inline them and keep creator_id parameterized.
        const messages = await db.getDb().prepare(
            `SELECT * FROM wa_messages WHERE creator_id = ? ORDER BY timestamp ASC LIMIT ${safeLimit} OFFSET ${safeOffset}`
        ).all(creatorId);

        const { total } = await db.getDb().prepare(
            'SELECT COUNT(*) as total FROM wa_messages WHERE creator_id = ?'
        ).get(creatorId);

        res.json({ messages, total, limit: safeLimit, offset: safeOffset });
    } catch (err) {
        console.error('Error fetching messages:', err);
        res.status(500).json({ error: err.message });
    }
});

// POST /api/creators/:id/messages
router.post('/', async (req, res) => {
    try {
        const { role, text, timestamp } = req.body;
        if (!role || !text) {
            return res.status(400).json({ error: 'role and text required' });
        }
        const creatorId = parseInt(req.params.id);
        const ts = timestamp ? Math.floor(timestamp / 1000) : Math.floor(Date.now() / 1000);

        await db.getDb().prepare(
            'INSERT INTO wa_messages (creator_id, role, text, timestamp) VALUES (?, ?, ?, ?)'
        ).run(creatorId, role, text, ts);

        res.json({ ok: true, id: creatorId, timestamp: ts });
    } catch (err) {
        console.error('Error inserting message:', err);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
