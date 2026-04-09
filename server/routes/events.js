/**
 * Events routes
 * GET /api/events, GET /api/events/:id, POST /api/events, PATCH /api/events/:id,
 * DELETE /api/events/:id, POST /api/events/detect, GET /api/events/:id/periods,
 * POST /api/events/:id/judge, POST /api/events/gmv-check,
 * GET /api/events/summary/:creatorId, GET /api/events/policy/:owner/:eventKey
 */
const express = require('express');
const router = express.Router();
const db = require('../../db');
const { EVENT_KEYWORDS } = require('../constants/eventKeywords');
const { getPolicy } = require('../utils/policyMatcher');

// GET /api/events
router.get('/', (req, res) => {
  try {
    const db2 = db.getDb();
    const { status, owner, creator_id, event_key, limit = 50, offset = 0 } = req.query;

    let sql = `SELECT e.*, c.primary_name as creator_name, c.wa_phone as creator_phone
               FROM events e
               LEFT JOIN creators c ON c.id = e.creator_id
               WHERE 1=1`;
    const params = [];

    if (status) { sql += ` AND e.status = ?`; params.push(status); }
    if (owner) { sql += ` AND e.owner = ?`; params.push(owner); }
    if (creator_id) { sql += ` AND e.creator_id = ?`; params.push(creator_id); }
    if (event_key) { sql += ` AND e.event_key = ?`; params.push(event_key); }

    sql += ` ORDER BY e.created_at DESC LIMIT ? OFFSET ?`;
    params.push(parseInt(limit), parseInt(offset));

    const events = db2.prepare(sql).all(...params);
    const total = db2.prepare(`SELECT COUNT(*) as count FROM events e WHERE 1=1${status ? ' AND e.status = ?' : ''}${owner ? ' AND e.owner = ?' : ''}${creator_id ? ' AND e.creator_id = ?' : ''}${event_key ? ' AND e.event_key = ?' : ''}`).get(...(status ? [status] : owner ? [owner] : creator_id ? [creator_id] : event_key ? [event_key] : []));

    res.json({ events, total: total.count, limit: parseInt(limit), offset: parseInt(offset) });
  } catch (err) {
    console.error('GET /api/events error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/events/:id
router.get('/:id', (req, res) => {
  try {
    const db2 = db.getDb();
    const event = db2.prepare(`
      SELECT e.*, c.primary_name as creator_name, c.wa_phone as creator_phone
      FROM events e
      LEFT JOIN creators c ON c.id = e.creator_id
      WHERE e.id = ?
    `).get(req.params.id);

    if (!event) return res.status(404).json({ error: 'Event not found' });

    event.policy = getPolicy(event.owner, event.event_key);
    event.periods = db2.prepare(`
      SELECT * FROM event_periods WHERE event_id = ? ORDER BY period_start DESC
    `).all(req.params.id);

    res.json(event);
  } catch (err) {
    console.error('GET /api/events/:id error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/events
router.post('/', (req, res) => {
  try {
    const db2 = db.getDb();
    const { creator_id, event_key, event_type, owner, trigger_source = 'manual', trigger_text = '', start_at, end_at, meta = {} } = req.body;

    if (!creator_id || !event_key || !event_type || !owner) {
      return res.status(400).json({ error: 'creator_id, event_key, event_type, owner required' });
    }

    const existing = db2.prepare(`SELECT id FROM events WHERE creator_id = ? AND event_key = ? AND status = 'active'`).get(creator_id, event_key);
    if (existing) {
      return res.status(409).json({ error: '同一达人已有相同事件处于 active 状态', existing_id: existing.id });
    }

    const stmt = db2.prepare(`
      INSERT INTO events (creator_id, event_key, event_type, owner, status, trigger_source, trigger_text, start_at, end_at, meta)
      VALUES (?, ?, ?, ?, 'active', ?, ?, ?, ?, ?)
    `);
    const result = stmt.run(creator_id, event_key, event_type, owner, trigger_source, trigger_text, start_at || new Date().toISOString(), end_at, JSON.stringify(meta));

    res.json({ id: result.insertId, status: 'active' });
  } catch (err) {
    console.error('POST /api/events error:', err);
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/events/:id
router.patch('/:id', (req, res) => {
  try {
    const db2 = db.getDb();
    const { status, end_at, meta } = req.body;

    const existing = db2.prepare('SELECT * FROM events WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Event not found' });

    const updates = [];
    const params = [];
    if (status) { updates.push('status = ?'); params.push(status); }
    if (end_at !***REMOVED*** undefined) { updates.push('end_at = ?'); params.push(end_at); }
    if (meta) { updates.push('meta = ?'); params.push(JSON.stringify(meta)); }

    if (updates.length ***REMOVED***= 0) return res.status(400).json({ error: 'No fields to update' });

    updates.push('updated_at = CURRENT_TIMESTAMP');
    params.push(req.params.id);

    db2.prepare(`UPDATE events SET ${updates.join(', ')} WHERE id = ?`).run(...params);
    res.json({ ok: true });
  } catch (err) {
    console.error('PATCH /api/events/:id error:', err);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/events/:id
router.delete('/:id', (req, res) => {
  try {
    const db2 = db.getDb();
    const event = db2.prepare('SELECT status FROM events WHERE id = ?').get(req.params.id);
    if (!event) return res.status(404).json({ error: 'Event not found' });
    if (event.status !***REMOVED*** 'pending') return res.status(400).json({ error: '只能删除 pending 状态的事件' });

    db2.prepare('DELETE FROM event_periods WHERE event_id = ?').run(req.params.id);
    db2.prepare('DELETE FROM events WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE /api/events/:id error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/events/detect
router.post('/detect', (req, res) => {
  try {
    const { text, creator_id } = req.body;
    if (!text || !creator_id) return res.status(400).json({ error: 'text and creator_id required' });

    const db2 = db.getDb();
    const creator = db2.prepare('SELECT * FROM creators WHERE id = ?').get(creator_id);
    if (!creator) return res.status(404).json({ error: 'Creator not found' });

    const lowerText = text.toLowerCase();
    const detected = [];

    for (const [event_key, keywords] of Object.entries(EVENT_KEYWORDS)) {
      for (const kw of keywords) {
        if (lowerText.includes(kw.toLowerCase())) {
          if (!detected.find(d => d.event_key ***REMOVED***= event_key)) {
            const event_type = event_key ***REMOVED***= 'trial_7day' || event_key ***REMOVED***= 'monthly_challenge' ? 'challenge'
              : event_key ***REMOVED***= 'agency_bound' ? 'agency'
              : event_key ***REMOVED***= 'referral' ? 'referral' : 'incentive_task';

            detected.push({
              event_key,
              event_type,
              owner: creator.wa_owner || 'Beau',
              trigger_text: text,
              trigger_source: 'semantic_auto',
              confidence: 1.0,
            });
          }
          break;
        }
      }
    }

    const gmvKeywords = ['gmv', '$', 'revenue', '销售额', '成交'];
    for (const kw of gmvKeywords) {
      if (lowerText.includes(kw) && creator.keeper_username) {
        const keeper = db2.prepare('SELECT * FROM keeper_link WHERE creator_id = ?').get(creator_id);
        if (keeper && keeper.keeper_gmv > 0) {
          detected.push({
            event_key: 'gmv_milestone',
            event_type: 'gmv',
            owner: creator.wa_owner || 'Beau',
            trigger_text: text,
            trigger_source: 'gmv_crosscheck',
            gmv_current: keeper.keeper_gmv,
            confidence: 0.8,
          });
        }
        break;
      }
    }

    res.json({ detected, creator_id, creator_name: creator.primary_name });
  } catch (err) {
    console.error('POST /api/events/detect error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/events/:id/periods
router.get('/:id/periods', (req, res) => {
  try {
    const db2 = db.getDb();
    const periods = db2.prepare(`
      SELECT * FROM event_periods WHERE event_id = ? ORDER BY period_start DESC
    `).all(req.params.id);
    res.json({ periods });
  } catch (err) {
    console.error('GET /api/events/:id/periods error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/events/:id/judge
router.post('/:id/judge', (req, res) => {
  try {
    const db2 = db.getDb();
    const { period_start, period_end, video_count } = req.body;

    const event = db2.prepare('SELECT * FROM events WHERE id = ?').get(req.params.id);
    if (!event) return res.status(404).json({ error: 'Event not found' });

    const policy = getPolicy(event.owner, event.event_key);
    if (!policy) return res.status(400).json({ error: `No policy found for ${event.owner}/${event.event_key}` });

    let bonus_earned = 0;
    const weekly_target = policy.weekly_target || 35;
    const bonus_per_video = policy.bonus_per_video || 5;

    if (video_count >= weekly_target) {
      bonus_earned = video_count * bonus_per_video;
    }

    const existingPeriod = db2.prepare(`SELECT id FROM event_periods WHERE event_id = ? AND period_start = ?`).get(req.params.id, period_start);
    let periodId;
    if (existingPeriod) {
      db2.prepare(`
        UPDATE event_periods SET video_count = ?, bonus_earned = ?, status = 'settled', updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(video_count, bonus_earned, existingPeriod.id);
      periodId = existingPeriod.id;
    } else {
      const result = db2.prepare(`
        INSERT INTO event_periods (event_id, period_start, period_end, video_count, bonus_earned, status)
        VALUES (?, ?, ?, ?, ?, 'settled')
      `).run(req.params.id, period_start, period_end || period_start, video_count, bonus_earned);
      periodId = result.insertId;
    }

    res.json({
      period_id: periodId,
      event_id: event.id,
      event_key: event.event_key,
      video_count,
      weekly_target,
      bonus_earned,
      policy,
    });
  } catch (err) {
    console.error('POST /api/events/:id/judge error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/events/gmv-check
router.post('/gmv-check', (req, res) => {
  try {
    const db2 = db.getDb();
    const activeGmvEvents = db2.prepare(`SELECT e.*, c.primary_name as creator_name, c.keeper_username FROM events e JOIN creators c ON c.id = e.creator_id WHERE e.event_type = 'gmv' AND e.status = 'active'`).all();

    const results = [];
    for (const evt of activeGmvEvents) {
      const keeper = db2.prepare('SELECT * FROM keeper_link WHERE creator_id = ?').get(evt.creator_id);
      if (!keeper) continue;

      const gmv = keeper.keeper_gmv || 0;
      const policy = getPolicy(evt.owner, 'gmv_milestone');

      let totalReward = 0;
      if (policy && policy.gmv_milestones) {
        for (const milestone of policy.gmv_milestones) {
          if (gmv >= milestone.threshold) {
            if (milestone.reward_type ***REMOVED***= 'cash') totalReward += milestone.value;
            else if (milestone.reward_type ***REMOVED***= 'commission_boost') {
              const recentPeriod = db2.prepare(`SELECT video_count FROM event_periods WHERE event_id = ? ORDER BY period_end DESC LIMIT 1`).get(evt.id);
              if (recentPeriod && recentPeriod.video_count >= 35) {
                totalReward += milestone.value;
              }
            }
          }
        }
      }

      results.push({
        event_id: evt.id,
        creator_id: evt.creator_id,
        creator_name: evt.creator_name,
        keeper_username: evt.keeper_username,
        gmv_current: gmv,
        estimated_reward: totalReward,
        status: evt.status,
      });
    }

    res.json({ events: results });
  } catch (err) {
    console.error('POST /api/events/gmv-check error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/events/summary/:creatorId
router.get('/summary/:creatorId', (req, res) => {
  try {
    const db2 = db.getDb();
    const creatorId = req.params.creatorId;

    const creator = db2.prepare('SELECT id, primary_name, wa_owner FROM creators WHERE id = ?').get(creatorId);
    if (!creator) return res.status(404).json({ error: 'Creator not found' });

    const events = db2.prepare(`SELECT * FROM events WHERE creator_id = ? ORDER BY created_at DESC`).all(creatorId);
    const activeEvents = events.filter(e => e.status ***REMOVED***= 'active');
    const completedEvents = events.filter(e => e.status ***REMOVED***= 'completed');

    const summary = {
      creator_id: creatorId,
      creator_name: creator.primary_name,
      wa_owner: creator.wa_owner,
      total_events: events.length,
      active_count: activeEvents.length,
      completed_count: completedEvents.length,
      by_type: {},
      by_status: {},
    };

    for (const evt of events) {
      summary.by_type[evt.event_key] = (summary.by_type[evt.event_key] || 0) + 1;
      summary.by_status[evt.status] = (summary.by_status[evt.status] || 0) + 1;
    }

    res.json({ summary, events });
  } catch (err) {
    console.error('GET /api/events/summary/:creatorId error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/events/policy/:owner/:eventKey
router.get('/policy/:owner/:eventKey', (req, res) => {
  try {
    const { owner, eventKey } = req.params;
    const policy = getPolicy(owner, eventKey);
    if (!policy) return res.status(404).json({ error: 'Policy not found' });
    res.json({ owner, event_key: eventKey, policy });
  } catch (err) {
    console.error('GET /api/events/policy error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
