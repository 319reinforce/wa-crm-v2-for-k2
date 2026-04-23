/**
 * UsersPanel — 用户管理面板(admin only)
 *
 * 功能:
 * - 列出所有用户(admin / operator)
 * - 创建 operator/admin(operator 必选 operator_name,下拉来自 operatorRoster)
 * - 修改 role / operator_name / disabled(任一变更立即踢下线目标用户)
 * - 重置密码(可自动生成 16 位临时密码并显示给 admin 转交)
 */
import React, { useState, useEffect, useCallback } from 'react'
import { fetchJsonOrThrow } from '../utils/api'

const API_BASE = '/api'

const WA = {
  teal: '#00a884',
  danger: '#ef4444',
  warning: '#f59e0b',
  info: '#3b82f6',
  muted: '#94a3b8',
  border: '#e9edef',
  bg: '#f6f7f8',
  text: '#111b21',
  textMuted: '#667781',
}

function RoleBadge({ role }) {
  const cfg = role === 'admin'
    ? { color: WA.info, label: '管理员' }
    : role === 'viewer'
      ? { color: WA.warning, label: '并发查看者' }
      : { color: WA.teal, label: '运营' }
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', padding: '2px 8px',
      borderRadius: 10, fontSize: 12, background: `${cfg.color}22`, color: cfg.color,
    }}>{cfg.label}</span>
  )
}

function CreateUserModal({ roster, onClose, onCreated }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState('operator')
  const [operatorName, setOperatorName] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)

  async function handleSubmit(e) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      const body = { username: username.trim(), password, role }
      // operator 和 viewer 都需要绑定 owner
      if (role === 'operator' || role === 'viewer') body.operator_name = operatorName
      const res = await fetchJsonOrThrow(`${API_BASE}/users`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (onCreated) onCreated(res?.data)
      onClose()
    } catch (err) {
      setError(err?.message || '创建失败')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50,
    }}>
      <form onSubmit={handleSubmit} style={{
        background: 'white', padding: 24, borderRadius: 12, minWidth: 360, maxWidth: 440,
        display: 'flex', flexDirection: 'column', gap: 12,
      }}>
        <div style={{ fontSize: 18, fontWeight: 600, color: WA.text }}>新增用户</div>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 12, color: WA.textMuted }}>用户名</span>
          <input type="text" value={username} onChange={e => setUsername(e.target.value)} required
            style={{ padding: 8, border: `1px solid ${WA.border}`, borderRadius: 6 }} />
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 12, color: WA.textMuted }}>密码(≥10 位,含字母和数字)</span>
          <input type="password" value={password} onChange={e => setPassword(e.target.value)} required
            style={{ padding: 8, border: `1px solid ${WA.border}`, borderRadius: 6 }} />
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 12, color: WA.textMuted }}>角色</span>
          <select value={role} onChange={e => setRole(e.target.value)}
            style={{ padding: 8, border: `1px solid ${WA.border}`, borderRadius: 6 }}>
            <option value="operator">运营（读写仅限自己 owner）</option>
            <option value="viewer">并发查看者（跨 owner 读，仅可写自己 owner）</option>
            <option value="admin">管理员</option>
          </select>
        </label>

        {(role === 'operator' || role === 'viewer') && (
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 12, color: WA.textMuted }}>绑定 owner</span>
            <select value={operatorName} onChange={e => setOperatorName(e.target.value)} required
              style={{ padding: 8, border: `1px solid ${WA.border}`, borderRadius: 6 }}>
              <option value="">—— 请选择 ——</option>
              {roster.map(r => (
                <option key={r.operator} value={r.operator}>{r.operator} ({r.real_name || r.wa_note || ''})</option>
              ))}
            </select>
          </label>
        )}

        {error && (
          <div style={{ color: WA.danger, fontSize: 13, padding: 8, background: `${WA.danger}11`, borderRadius: 4 }}>
            {error}
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 }}>
          <button type="button" onClick={onClose} disabled={submitting}
            style={{ padding: '8px 14px', border: `1px solid ${WA.border}`, borderRadius: 6, background: 'white' }}>
            取消
          </button>
          <button type="submit" disabled={submitting}
            style={{ padding: '8px 14px', border: 'none', borderRadius: 6, background: WA.teal, color: 'white', cursor: 'pointer' }}>
            {submitting ? '创建中...' : '创建'}
          </button>
        </div>
      </form>
    </div>
  )
}

function ResetPasswordBadge({ tempPassword, onClose }) {
  if (!tempPassword) return null
  return (
    <div style={{
      position: 'fixed', top: 20, right: 20, background: 'white', padding: 16,
      borderRadius: 8, boxShadow: '0 4px 20px rgba(0,0,0,0.15)', zIndex: 100,
      maxWidth: 320, borderLeft: `4px solid ${WA.warning}`,
    }}>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>临时密码已生成</div>
      <div style={{ fontSize: 11, color: WA.textMuted, marginBottom: 6 }}>请转交给用户并让其立即修改:</div>
      <code style={{ display: 'block', padding: 8, background: WA.bg, borderRadius: 4, fontSize: 13, wordBreak: 'break-all' }}>
        {tempPassword}
      </code>
      <button onClick={onClose} style={{ marginTop: 8, padding: '4px 10px', fontSize: 12, border: `1px solid ${WA.border}`, borderRadius: 4, background: 'white', cursor: 'pointer' }}>
        关闭
      </button>
    </div>
  )
}

export function UsersPanel() {
  const [users, setUsers] = useState([])
  const [roster, setRoster] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [showCreate, setShowCreate] = useState(false)
  const [tempPassword, setTempPassword] = useState(null)

  const loadAll = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [usersRes, rosterRes] = await Promise.all([
        fetchJsonOrThrow(`${API_BASE}/users`),
        fetchJsonOrThrow(`${API_BASE}/operator-roster`),
      ])
      setUsers(usersRes?.data || [])
      setRoster(rosterRes?.data || [])
    } catch (err) {
      setError(err?.message || '加载失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadAll() }, [loadAll])

  async function handleToggleDisabled(user) {
    if (!confirm(`确认${user.disabled ? '启用' : '禁用'} ${user.username}?`)) return
    try {
      await fetchJsonOrThrow(`${API_BASE}/users/${user.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ disabled: !user.disabled }),
      })
      loadAll()
    } catch (err) {
      alert(err?.message || '操作失败')
    }
  }

  async function handleChangeOperator(user, newOperator) {
    if (newOperator === user.operator_name) return
    try {
      await fetchJsonOrThrow(`${API_BASE}/users/${user.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ operator_name: newOperator }),
      })
      loadAll()
    } catch (err) {
      alert(err?.message || '修改失败')
    }
  }

  async function handleResetPassword(user) {
    if (!confirm(`重置 ${user.username} 的密码?此操作会让该用户当前登录立即失效。`)) return
    try {
      const res = await fetchJsonOrThrow(`${API_BASE}/users/${user.id}/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      if (res?.data?.temporary_password) {
        setTempPassword(res.data.temporary_password)
      }
    } catch (err) {
      alert(err?.message || '重置失败')
    }
  }

  return (
    <div style={{ padding: 16, background: WA.bg, minHeight: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 600, color: WA.text }}>用户管理</div>
          <div style={{ fontSize: 12, color: WA.textMuted, marginTop: 2 }}>
            管理员可见 · 新增运营后对方即可登录,无需改 env 或重启
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={loadAll} disabled={loading}
            style={{ padding: '6px 12px', border: `1px solid ${WA.border}`, borderRadius: 6, background: 'white', cursor: 'pointer' }}>
            {loading ? '...' : '刷新'}
          </button>
          <button onClick={() => setShowCreate(true)}
            style={{ padding: '6px 14px', border: 'none', borderRadius: 6, background: WA.teal, color: 'white', cursor: 'pointer' }}>
            + 新增用户
          </button>
        </div>
      </div>

      {error && (
        <div style={{ padding: 12, background: `${WA.danger}11`, color: WA.danger, borderRadius: 6, marginBottom: 12 }}>
          {error}
        </div>
      )}

      <div style={{ background: 'white', border: `1px solid ${WA.border}`, borderRadius: 8, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: WA.bg, color: WA.textMuted }}>
              <th style={{ textAlign: 'left', padding: '10px 12px' }}>用户名</th>
              <th style={{ textAlign: 'left', padding: '10px 12px' }}>角色</th>
              <th style={{ textAlign: 'left', padding: '10px 12px' }}>Owner</th>
              <th style={{ textAlign: 'left', padding: '10px 12px' }}>状态</th>
              <th style={{ textAlign: 'left', padding: '10px 12px' }}>最近登录</th>
              <th style={{ textAlign: 'right', padding: '10px 12px' }}>操作</th>
            </tr>
          </thead>
          <tbody>
            {users.length === 0 && !loading && (
              <tr><td colSpan={6} style={{ padding: 24, textAlign: 'center', color: WA.textMuted }}>暂无用户</td></tr>
            )}
            {users.map(u => (
              <tr key={u.id} style={{ borderTop: `1px solid ${WA.border}` }}>
                <td style={{ padding: '10px 12px', color: WA.text, fontWeight: 500 }}>{u.username}</td>
                <td style={{ padding: '10px 12px' }}><RoleBadge role={u.role} /></td>
                <td style={{ padding: '10px 12px' }}>
                  {(u.role === 'operator' || u.role === 'viewer') ? (
                    <select
                      value={u.operator_name || ''}
                      onChange={e => handleChangeOperator(u, e.target.value)}
                      style={{ padding: '4px 6px', border: `1px solid ${WA.border}`, borderRadius: 4, fontSize: 12 }}
                    >
                      {roster.map(r => (
                        <option key={r.operator} value={r.operator}>{r.operator}</option>
                      ))}
                    </select>
                  ) : <span style={{ color: WA.textMuted }}>—</span>}
                </td>
                <td style={{ padding: '10px 12px' }}>
                  {u.disabled
                    ? <span style={{ color: WA.danger, fontSize: 12 }}>已禁用</span>
                    : <span style={{ color: WA.teal, fontSize: 12 }}>正常</span>}
                </td>
                <td style={{ padding: '10px 12px', color: WA.textMuted, fontSize: 12 }}>
                  {u.last_login_at ? new Date(u.last_login_at).toLocaleString('zh-CN') : '—'}
                </td>
                <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                  <button onClick={() => handleResetPassword(u)}
                    style={{ padding: '4px 10px', marginRight: 6, border: `1px solid ${WA.border}`, borderRadius: 4, background: 'white', cursor: 'pointer', fontSize: 12 }}>
                    重置密码
                  </button>
                  <button onClick={() => handleToggleDisabled(u)}
                    style={{ padding: '4px 10px', border: `1px solid ${u.disabled ? WA.teal : WA.danger}`, color: u.disabled ? WA.teal : WA.danger, borderRadius: 4, background: 'white', cursor: 'pointer', fontSize: 12 }}>
                    {u.disabled ? '启用' : '禁用'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showCreate && (
        <CreateUserModal
          roster={roster}
          onClose={() => setShowCreate(false)}
          onCreated={() => loadAll()}
        />
      )}

      <ResetPasswordBadge tempPassword={tempPassword} onClose={() => setTempPassword(null)} />
    </div>
  )
}

export default UsersPanel
