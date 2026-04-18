/**
 * userSessionRepo — DB 驱动的人类用户会话仓库
 *
 * 管理 users + user_sessions 两张表的读写:
 *   - 登录:findActiveUserByUsername → 校验密码 → createSession
 *   - 每次请求:findActiveSessionByToken(token) → 返回 {user,session}
 *   - 登出/踢下线:revokeSession / revokeAllSessionsForUser
 *   - 失败计数:recordLoginFailure / resetLoginFailures
 *
 * 所有 SQL 使用预处理语句,绝不拼接 user 输入。
 */
const crypto = require('crypto');
const db = require('../../db');

const SESSION_TTL_MS = 12 * 60 * 60 * 1000;        // 12 小时
const LOCK_THRESHOLD = 5;                           // 连续失败次数
const LOCK_DURATION_MS = 15 * 60 * 1000;            // 锁定 15 分钟
const CLEANUP_GRACE_MS = 7 * 24 * 60 * 60 * 1000;   // 过期/revoked 保留 7 天便于审计回溯

function generateSessionToken() {
    return crypto.randomBytes(32).toString('hex');
}

async function findActiveUserByUsername(username) {
    const row = await db.getDb().prepare(`
        SELECT id, username, password_hash, role, operator_name, disabled,
               failed_login_count, locked_until
          FROM users
         WHERE username = ?
         LIMIT 1
    `).get(username);
    return row || null;
}

async function findUserById(id) {
    if (!id) return null;
    const row = await db.getDb().prepare(`
        SELECT id, username, role, operator_name, disabled
          FROM users
         WHERE id = ?
         LIMIT 1
    `).get(id);
    return row || null;
}

async function recordLoginFailure(userId) {
    if (!userId) return;
    const dbConn = db.getDb();
    const row = await dbConn.prepare(`
        SELECT failed_login_count FROM users WHERE id = ?
    `).get(userId);
    const nextCount = Number(row?.failed_login_count || 0) + 1;
    if (nextCount >= LOCK_THRESHOLD) {
        const lockedUntil = new Date(Date.now() + LOCK_DURATION_MS);
        await dbConn.prepare(`
            UPDATE users
               SET failed_login_count = 0,
                   locked_until = ?
             WHERE id = ?
        `).run(lockedUntil, userId);
    } else {
        await dbConn.prepare(`
            UPDATE users
               SET failed_login_count = ?
             WHERE id = ?
        `).run(nextCount, userId);
    }
}

async function resetLoginFailures(userId) {
    if (!userId) return;
    await db.getDb().prepare(`
        UPDATE users
           SET failed_login_count = 0,
               locked_until = NULL,
               last_login_at = NOW()
         WHERE id = ?
    `).run(userId);
}

function isUserLocked(userRow) {
    if (!userRow?.locked_until) return false;
    return new Date(userRow.locked_until).getTime() > Date.now();
}

async function createSession({ userId, ipAddress = null, userAgent = null }) {
    if (!userId) throw new Error('createSession: userId is required');
    const token = generateSessionToken();
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
    await db.getDb().prepare(`
        INSERT INTO user_sessions (token, user_id, expires_at, ip_address, user_agent)
        VALUES (?, ?, ?, ?, ?)
    `).run(token, userId, expiresAt, ipAddress, userAgent);
    return { token, expiresAt };
}

async function findActiveSessionByToken(token) {
    if (!token) return null;
    const row = await db.getDb().prepare(`
        SELECT s.token, s.user_id, s.expires_at, s.revoked_at,
               u.username, u.role, u.operator_name, u.disabled
          FROM user_sessions s
          JOIN users u ON u.id = s.user_id
         WHERE s.token = ?
         LIMIT 1
    `).get(token);
    if (!row) return null;
    if (row.revoked_at) return null;
    if (row.disabled) return null;
    if (new Date(row.expires_at).getTime() <= Date.now()) return null;
    // 异步 last_seen_at 更新,不阻塞主路径
    db.getDb().prepare(`
        UPDATE user_sessions SET last_seen_at = NOW() WHERE token = ?
    `).run(token).catch(() => { /* best-effort */ });
    return {
        token: row.token,
        user: {
            id: row.user_id,
            username: row.username,
            role: row.role,
            operator_name: row.operator_name,
        },
        expiresAt: row.expires_at,
    };
}

async function revokeSession(token) {
    if (!token) return;
    await db.getDb().prepare(`
        UPDATE user_sessions
           SET revoked_at = NOW()
         WHERE token = ? AND revoked_at IS NULL
    `).run(token);
}

async function revokeAllSessionsForUser(userId) {
    if (!userId) return;
    await db.getDb().prepare(`
        UPDATE user_sessions
           SET revoked_at = NOW()
         WHERE user_id = ? AND revoked_at IS NULL
    `).run(userId);
}

async function cleanupStaleSessions() {
    const cutoff = new Date(Date.now() - CLEANUP_GRACE_MS);
    const res = await db.getDb().prepare(`
        DELETE FROM user_sessions
         WHERE (expires_at < ? OR revoked_at < ?)
    `).run(cutoff, cutoff);
    return res;
}

module.exports = {
    SESSION_TTL_MS,
    LOCK_THRESHOLD,
    LOCK_DURATION_MS,
    findActiveUserByUsername,
    findUserById,
    recordLoginFailure,
    resetLoginFailures,
    isUserLocked,
    createSession,
    findActiveSessionByToken,
    revokeSession,
    revokeAllSessionsForUser,
    cleanupStaleSessions,
};
