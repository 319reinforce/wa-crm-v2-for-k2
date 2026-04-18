/**
 * 用户管理路由 — 仅 DB-backed admin 可用
 *
 * admin 在 UI 里管理运营账号:创建/禁用/改 operator_name/重置密码/删除
 * 变更任一敏感字段(role/operator_name/disabled/密码) → revoke 该用户全部 session
 */
const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const db = require('../../db');
const { requireHumanAdmin } = require('../middleware/appAuth');
const { writeAudit } = require('../middleware/audit');
const { normalizeOperatorName } = require('../utils/operator');
const { getOperatorRoster } = require('../config/operatorRoster');
const userSessionRepo = require('../services/userSessionRepo');

const router = express.Router();
const BCRYPT_COST = 12;

function rosterOperatorNames() {
    return getOperatorRoster().map((item) => item.operator);
}

function validateOperatorName(raw) {
    const canonical = normalizeOperatorName(raw, null);
    if (!canonical) return null;
    const allowed = rosterOperatorNames();
    return allowed.includes(canonical) ? canonical : null;
}

function validatePassword(pw) {
    const s = String(pw || '');
    if (s.length < 10) return 'Password must be at least 10 characters';
    if (!/[a-zA-Z]/.test(s) || !/[0-9]/.test(s)) return 'Password must contain letters and digits';
    return null;
}

function publicUser(row) {
    if (!row) return null;
    return {
        id: row.id,
        username: row.username,
        role: row.role,
        operator_name: row.operator_name,
        disabled: !!row.disabled,
        last_login_at: row.last_login_at,
        created_at: row.created_at,
        updated_at: row.updated_at,
    };
}

router.use(requireHumanAdmin);

// GET /api/users — 列表
router.get('/', async (req, res) => {
    try {
        const rows = await db.getDb().prepare(`
            SELECT id, username, role, operator_name, disabled,
                   last_login_at, created_at, updated_at
              FROM users
             ORDER BY role DESC, username ASC
        `).all();
        res.json({ ok: true, data: rows.map(publicUser) });
    } catch (err) {
        console.error('GET /api/users error:', err);
        res.status(500).json({ error: err.message });
    }
});

// POST /api/users — 新建
router.post('/', async (req, res) => {
    try {
        const username = String(req.body?.username || '').trim();
        const password = String(req.body?.password || '');
        const role = String(req.body?.role || '').trim();
        const operatorNameRaw = req.body?.operator_name;

        if (!username) return res.status(400).json({ error: 'username required' });
        if (!['admin', 'operator'].includes(role)) return res.status(400).json({ error: 'role must be admin or operator' });

        let operatorName = null;
        if (role === 'operator') {
            operatorName = validateOperatorName(operatorNameRaw);
            if (!operatorName) {
                return res.status(400).json({
                    error: `operator_name must be one of: ${rosterOperatorNames().join(', ')}`,
                });
            }
        }

        const pwErr = validatePassword(password);
        if (pwErr) return res.status(400).json({ error: pwErr });

        const hash = await bcrypt.hash(password, BCRYPT_COST);

        let insertResult;
        try {
            insertResult = await db.getDb().prepare(`
                INSERT INTO users (username, password_hash, role, operator_name)
                VALUES (?, ?, ?, ?)
            `).run(username, hash, role, operatorName);
        } catch (e) {
            if (String(e?.code || '').includes('ER_DUP_ENTRY')) {
                return res.status(409).json({ error: 'username already exists' });
            }
            throw e;
        }

        const insertedId = insertResult?.insertId || insertResult?.lastInsertRowid;
        const row = await db.getDb().prepare(`SELECT * FROM users WHERE id = ?`).get(insertedId);
        await writeAudit('user.create', 'users', insertedId, null, publicUser(row), req);
        res.status(201).json({ ok: true, data: publicUser(row) });
    } catch (err) {
        console.error('POST /api/users error:', err);
        res.status(500).json({ error: err.message });
    }
});

// PATCH /api/users/:id — 改 role/operator_name/disabled
router.patch('/:id', async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        if (!id) return res.status(400).json({ error: 'invalid id' });

        const before = await db.getDb().prepare(`SELECT * FROM users WHERE id = ?`).get(id);
        if (!before) return res.status(404).json({ error: 'user not found' });

        const changes = {};
        if ('role' in req.body) {
            if (!['admin', 'operator'].includes(req.body.role)) {
                return res.status(400).json({ error: 'role must be admin or operator' });
            }
            changes.role = req.body.role;
        }
        if ('operator_name' in req.body) {
            if (req.body.operator_name === null || req.body.operator_name === '') {
                changes.operator_name = null;
            } else {
                const canonical = validateOperatorName(req.body.operator_name);
                if (!canonical) {
                    return res.status(400).json({
                        error: `operator_name must be one of: ${rosterOperatorNames().join(', ')}`,
                    });
                }
                changes.operator_name = canonical;
            }
        }
        if ('disabled' in req.body) {
            changes.disabled = req.body.disabled ? 1 : 0;
        }

        const nextRole = changes.role || before.role;
        const nextOperatorName = ('operator_name' in changes) ? changes.operator_name : before.operator_name;
        if (nextRole === 'operator' && !nextOperatorName) {
            return res.status(400).json({ error: 'operator role requires operator_name' });
        }
        if (nextRole === 'admin' && nextOperatorName) {
            changes.operator_name = null;
        }

        if (Object.keys(changes).length === 0) {
            return res.status(400).json({ error: 'no updatable fields' });
        }

        const setClauses = Object.keys(changes).map((k) => `${k} = ?`).join(', ');
        const values = Object.values(changes);
        await db.getDb().prepare(`UPDATE users SET ${setClauses} WHERE id = ?`).run(...values, id);

        // 敏感变更一律 revoke 全部 session
        await userSessionRepo.revokeAllSessionsForUser(id);

        const after = await db.getDb().prepare(`SELECT * FROM users WHERE id = ?`).get(id);
        await writeAudit('user.update', 'users', id, publicUser(before), publicUser(after), req);
        res.json({ ok: true, data: publicUser(after) });
    } catch (err) {
        console.error('PATCH /api/users/:id error:', err);
        res.status(500).json({ error: err.message });
    }
});

// POST /api/users/:id/reset-password — 重置密码
router.post('/:id/reset-password', async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        if (!id) return res.status(400).json({ error: 'invalid id' });

        const user = await db.getDb().prepare(`SELECT id, username FROM users WHERE id = ?`).get(id);
        if (!user) return res.status(404).json({ error: 'user not found' });

        let newPassword = String(req.body?.password || '').trim();
        if (!newPassword) {
            // admin 未指定则系统生成 16 位随机密码(含字母+数字)
            newPassword = crypto.randomBytes(12).toString('base64').replace(/[^a-zA-Z0-9]/g, '').slice(0, 16);
            while (newPassword.length < 12) {
                newPassword += crypto.randomBytes(4).toString('hex');
            }
            newPassword = newPassword.slice(0, 16);
        }
        const pwErr = validatePassword(newPassword);
        if (pwErr) return res.status(400).json({ error: pwErr });

        const hash = await bcrypt.hash(newPassword, BCRYPT_COST);
        await db.getDb().prepare(`
            UPDATE users
               SET password_hash = ?,
                   password_changed_at = NOW(),
                   failed_login_count = 0,
                   locked_until = NULL
             WHERE id = ?
        `).run(hash, id);
        await userSessionRepo.revokeAllSessionsForUser(id);
        await writeAudit('user.reset_password', 'users', id, null, { username: user.username }, req);
        res.json({ ok: true, data: { id, username: user.username, temporary_password: newPassword } });
    } catch (err) {
        console.error('POST /api/users/:id/reset-password error:', err);
        res.status(500).json({ error: err.message });
    }
});

// DELETE /api/users/:id — soft delete(disabled=1 + revoke)
router.delete('/:id', async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        if (!id) return res.status(400).json({ error: 'invalid id' });

        const before = await db.getDb().prepare(`SELECT * FROM users WHERE id = ?`).get(id);
        if (!before) return res.status(404).json({ error: 'user not found' });

        // 不允许删除自己,防止误操作锁自己出来
        if (before.id === req.auth?.user_id) {
            return res.status(400).json({ error: 'cannot disable self' });
        }

        await db.getDb().prepare(`UPDATE users SET disabled = 1 WHERE id = ?`).run(id);
        await userSessionRepo.revokeAllSessionsForUser(id);

        const after = await db.getDb().prepare(`SELECT * FROM users WHERE id = ?`).get(id);
        await writeAudit('user.disable', 'users', id, publicUser(before), publicUser(after), req);
        res.json({ ok: true, data: publicUser(after) });
    } catch (err) {
        console.error('DELETE /api/users/:id error:', err);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
