/**
 * Messages routes
 * GET /api/creators/:id/messages, POST /api/creators/:id/messages
 */
const express = require('express');
const router = express.Router({ mergeParams: true });
const db = require('../../db');

// GET /api/creators/:id/messages
router.get('/', (req, res) => {
    try {
        const creatorId = parseInt(req.params.id);
        const limit = Math.min(parseInt(req.query.limit) || 100, 1000);
        const offset = parseInt(req.query.offset) || 0;

        const messages = db.getDb().prepare(
            'SELECT * FROM wa_messages WHERE creator_id = ? ORDER BY timestamp ASC LIMIT ? OFFSET ?'
        ).all(creatorId, limit, offset);

        const { total } = db.getDb().prepare(
            'SELECT COUNT(*) as total FROM wa_messages WHERE creator_id = ?'
        ).get(creatorId);

        res.json({ messages, total, limit, offset });
    } catch (err) {
        console.error('Error fetching messages:', err);
        res.status(500).json({ error: err.message });
    }
});

// POST /api/creators/:id/messages
router.post('/', (req, res) => {
    try {
        const { role, text, timestamp } = req.body;
        if (!role || !text) {
            return res.status(400).json({ error: 'role and text required' });
        }
        const creatorId = parseInt(req.params.id);
        const ts = timestamp || Date.now();

        db.getDb().prepare(
            'INSERT INTO wa_messages (creator_id, role, text, timestamp) VALUES (?, ?, ?, ?)'
        ).run(creatorId, role, text, ts);

        if (role ***REMOVED***= 'me') {
            db.getDb().prepare(
                'UPDATE joinbrands_link SET ev_replied = 1 WHERE creator_id = ?'
            ).run(creatorId);
        }

        res.json({ ok: true, id: creatorId, timestamp: ts });
    } catch (err) {
        console.error('Error inserting message:', err);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
