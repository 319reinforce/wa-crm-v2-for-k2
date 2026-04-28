/**
 * UsersPanel — 用户管理面板(admin only)
 *
 * 功能:
 * - 列出所有用户(admin / operator / viewer)
 * - 创建 operator/viewer/admin(operator/viewer 必填 operator_name,下拉支持已有 roster 或新建 owner)
 * - 修改 role / operator_name / disabled(任一变更立即踢下线目标用户)
 * - 重置密码(可自动生成 16 位临时密码并显示给 admin 转交)
 *
 * 样式与 AccountsPanel 对齐:复用 waTheme + ModalShell/FormField 风格,避免各页面视觉割裂。
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { fetchJsonOrThrow } from '../utils/api'
import WA from '../utils/waTheme'
import { clearRosterCache } from '../utils/operators'
import { useToast } from './Toast'

const API_BASE = '/api'
const ACCENT = {
  danger: '#b45309',
  warning: '#c08a2e',
  info: '#0f766e',
  muted: WA.textMuted,
}
const OPERATOR_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_\- ]{0,31}$/

const ROLE_META = {
  admin: { color: '#0f766e', label: '管理员' },
  operator: { color: '#0f766e', label: '运营' },
  viewer: { color: '#c08a2e', label: '并发查看者' },
}

function RoleBadge({ role }) {
  const cfg = ROLE_META[role] || { color: WA.textMuted, label: role || '未知' }
  return (
    <span
      className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium"
      style={{ background: `${cfg.color}1a`, color: cfg.color }}
    >
      {cfg.label}
    </span>
  )
}

const inputStyle = {
  width: '100%',
  minHeight: 40,
  padding: '0 12px',
  borderRadius: 12,
  border: `1px solid ${WA.borderLight}`,
  background: WA.white,
  color: WA.textDark,
  fontSize: 13,
  outline: 'none',
}

const selectStyle = { ...inputStyle, paddingRight: 28 }

const primaryBtnStyle = (disabled = false) => ({
  minHeight: 40,
  padding: '0 16px',
  borderRadius: 999,
  border: 'none',
  background: disabled ? '#9a9288' : WA.teal,
  color: '#fff',
  fontSize: 13,
  fontWeight: 600,
  cursor: disabled ? 'wait' : 'pointer',
  opacity: disabled ? 0.7 : 1,
})

const secondaryBtnStyle = {
  minHeight: 40,
  padding: '0 14px',
  borderRadius: 999,
  border: `1px solid ${WA.borderLight}`,
  background: WA.white,
  color: WA.textMuted,
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
}

const rowBtnStyle = {
  minHeight: 32,
  padding: '0 12px',
  borderRadius: 999,
  border: `1px solid ${WA.borderLight}`,
  background: WA.white,
  color: WA.textMuted,
  fontSize: 12,
  fontWeight: 500,
  cursor: 'pointer',
}

function ModalShell({ title, onClose, children, maxWidth = 440, dismissOnBackdrop = true, dismissOnEsc = true }) {
  useEffect(() => {
    if (!dismissOnEsc || !onClose) return undefined
    const handler = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [dismissOnEsc, onClose])

  const handleBackdrop = (e) => {
    if (!dismissOnBackdrop || !onClose) return
    if (e.target === e.currentTarget) onClose()
  }

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center"
      style={{ background: 'rgba(31,29,26,0.45)', padding: 16 }}
      onClick={handleBackdrop}
    >
      <div
        className="w-full rounded-[24px] overflow-hidden flex flex-col"
        style={{
          maxWidth,
          maxHeight: '90dvh',
          background: WA.white,
          border: `1px solid ${WA.borderLight}`,
          boxShadow: WA.shellShadow,
        }}
      >
        <div
          className="shrink-0 flex items-center justify-between px-5 py-4"
          style={{ borderBottom: `1px solid ${WA.borderLight}`, background: WA.shellPanelStrong }}
        >
          <div className="docs-title truncate" style={{ fontSize: 16 }}>{title}</div>
          <button
            type="button"
            onClick={onClose}
            disabled={!onClose}
            className="inline-flex items-center justify-center rounded-full shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
            style={{
              width: 36,
              height: 36,
              background: WA.white,
              color: WA.textMuted,
              border: `1px solid ${WA.borderLight}`,
              fontSize: 16,
            }}
            aria-label="关闭"
          >
            ✕
          </button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto docs-scrollbar p-5">{children}</div>
      </div>
    </div>
  )
}

function FormField({ label, hint, children }) {
  return (
    <label className="block space-y-1.5 mb-4">
      <span className="docs-kicker block">{label}</span>
      {children}
      {hint && <span className="text-[11px] block" style={{ color: WA.textMuted }}>{hint}</span>}
    </label>
  )
}

function ModeSegmented({ mode, onChange, options }) {
  return (
    <div
      className="inline-flex rounded-full p-[3px]"
      style={{ background: WA.shellPanelMuted, border: `1px solid ${WA.borderLight}` }}
      role="tablist"
    >
      {options.map((opt) => {
        const active = mode === opt.key
        return (
          <button
            key={opt.key}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(opt.key)}
            className="rounded-full px-3 py-1 text-[12px] font-medium transition-colors"
            style={{
              background: active ? WA.white : 'transparent',
              color: active ? WA.textDark : WA.textMuted,
              boxShadow: active ? WA.shellShadow : 'none',
            }}
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}

/**
 * OwnerPicker — 显式的"选择已有 / 新建"切换,避免 datalist UX
 * 让用户误以为下拉只有固定几个选项。
 *
 * 行为:
 * - mode=existing  : 下拉列 roster,空选项 disabled
 * - mode=new       : 纯文本输入,提示格式约束
 * - value 始终是最终 operator_name 字符串,父组件只关心它
 */
function OwnerPicker({ value, onChange, roster, disabled }) {
  const hasRoster = (roster || []).length > 0
  const matchesExisting = useMemo(
    () => (roster || []).some((r) => r.operator === value),
    [roster, value],
  )
  const [mode, setMode] = useState(() => (!value || matchesExisting ? 'existing' : 'new'))

  useEffect(() => {
    if (!value) return
    if (matchesExisting && mode === 'new') setMode('existing')
    if (!matchesExisting && mode === 'existing') setMode('new')
  }, [matchesExisting]) // eslint-disable-line react-hooks/exhaustive-deps

  function handleModeChange(nextMode) {
    if (nextMode === mode) return
    setMode(nextMode)
    // 切换模式时清空,避免把已有名字带进"新建"态造成误导
    onChange('')
  }

  return (
    <div className="space-y-2">
      <ModeSegmented
        mode={mode}
        onChange={handleModeChange}
        options={[
          { key: 'existing', label: hasRoster ? `选择已有(${roster.length})` : '选择已有' },
          { key: 'new', label: '＋ 新建 owner' },
        ]}
      />
      {mode === 'existing' ? (
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled || !hasRoster}
          required
          style={{ ...selectStyle, background: disabled ? WA.shellPanelMuted : WA.white }}
        >
          <option value="" disabled>—— 请选择 ——</option>
          {(roster || []).map((r) => {
            const label = r.real_name || r.wa_note
            const suffix = r.source === 'dynamic' ? ' · 自定义' : ''
            return (
              <option key={r.operator} value={r.operator}>
                {r.operator}{label ? ` (${label})` : ''}{suffix}
              </option>
            )
          })}
        </select>
      ) : (
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          placeholder="输入新 owner 名称,如:Marco"
          autoFocus
          autoComplete="off"
          maxLength={32}
          style={{ ...inputStyle, background: disabled ? WA.shellPanelMuted : WA.white }}
        />
      )}
    </div>
  )
}

function CreateUserModal({ roster, onClose, onCreated }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState('operator')
  const [operatorName, setOperatorName] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)
  const needsOwner = role === 'operator' || role === 'viewer'

  const ownerIsNew = useMemo(() => {
    const trimmed = operatorName.trim()
    if (!trimmed) return false
    return !(roster || []).some((r) => r.operator === trimmed)
  }, [operatorName, roster])

  async function handleSubmit(e) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      const trimmedOwner = operatorName.trim()
      if (needsOwner) {
        if (!trimmedOwner) throw new Error('请选择或输入 owner')
        if (!OPERATOR_NAME_PATTERN.test(trimmedOwner)) {
          throw new Error('owner 需以字母/数字开头,长度 ≤32,仅允许字母、数字、空格、下划线和连字符')
        }
      }
      const body = { username: username.trim(), password, role }
      if (needsOwner) body.operator_name = trimmedOwner
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
    <ModalShell title="新增用户" onClose={onClose} maxWidth={460}>
      <form onSubmit={handleSubmit}>
        <FormField label="用户名" hint="登录账号,唯一">
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="如:marco"
            required
            style={inputStyle}
          />
        </FormField>

        <FormField label="密码" hint="至少 10 位,需同时包含字母与数字">
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            style={inputStyle}
          />
        </FormField>

        <FormField label="角色">
          <select
            value={role}
            onChange={(e) => setRole(e.target.value)}
            style={selectStyle}
          >
            <option value="operator">运营(读写仅限自己 owner)</option>
            <option value="viewer">并发查看者(跨 owner 只读,仅可写自己 owner)</option>
            <option value="admin">管理员</option>
          </select>
        </FormField>

        {needsOwner && (
          <FormField
            label="绑定 owner"
            hint={
              ownerIsNew
                ? '将创建新的 owner 名称,并立即出现在全站下拉中'
                : '从已有 owner 选择,或切换到"新建"直接输入新名称'
            }
          >
            <OwnerPicker
              value={operatorName}
              onChange={setOperatorName}
              roster={roster}
            />
          </FormField>
        )}

        {error && (
          <div
            className="rounded-[12px] px-3 py-2 text-[12px] mb-3"
            style={{ background: `${ACCENT.danger}14`, color: ACCENT.danger, border: `1px solid ${ACCENT.danger}33` }}
          >
            {error}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} disabled={submitting} style={secondaryBtnStyle}>
            取消
          </button>
          <button type="submit" disabled={submitting} style={primaryBtnStyle(submitting)}>
            {submitting ? '创建中…' : '创建'}
          </button>
        </div>
      </form>
    </ModalShell>
  )
}

function TempPasswordToast({ tempPassword, onClose }) {
  if (!tempPassword) return null
  return (
    <div
      className="fixed top-5 right-5 z-[80] rounded-[16px] p-4"
      style={{
        background: WA.white,
        boxShadow: WA.shellShadow,
        borderLeft: `4px solid ${ACCENT.warning}`,
        maxWidth: 320,
      }}
    >
      <div className="text-[13px] font-semibold mb-1" style={{ color: WA.textDark }}>临时密码已生成</div>
      <div className="text-[11px] mb-2" style={{ color: WA.textMuted }}>请转交给用户并让其立即修改:</div>
      <code
        className="block rounded-[10px] px-3 py-2 text-[13px] break-all"
        style={{ background: WA.shellPanelMuted, color: WA.textDark }}
      >
        {tempPassword}
      </code>
      <button onClick={onClose} className="mt-2" style={{ ...rowBtnStyle, minHeight: 28, padding: '0 10px' }}>
        关闭
      </button>
    </div>
  )
}

function OwnerTransferCard({ roster, onTransferred }) {
  const toast = useToast()
  const [fromOwner, setFromOwner] = useState('Jiawen')
  const [toOwner, setToOwner] = useState('Yiyun')
  const [preview, setPreview] = useState(null)
  const [loadingPreview, setLoadingPreview] = useState(false)
  const [transferring, setTransferring] = useState(false)

  const ownerOptions = useMemo(() => {
    const names = new Set(['Jiawen', 'Yiyun'])
    for (const item of roster || []) {
      if (item?.operator) names.add(item.operator)
    }
    if (fromOwner) names.add(fromOwner)
    if (toOwner) names.add(toOwner)
    return [...names]
  }, [fromOwner, roster, toOwner])

  async function loadPreview() {
    const from = fromOwner.trim()
    const to = toOwner.trim()
    if (!from || !to) {
      toast.warning('请选择来源和目标 owner')
      return null
    }
    setLoadingPreview(true)
    try {
      const params = new URLSearchParams({ from, to })
      const res = await fetchJsonOrThrow(`${API_BASE}/operator-roster/transfer-preview?${params}`)
      setPreview(res?.data || null)
      return res?.data || null
    } catch (err) {
      toast.error(err?.message || '读取迁移预览失败')
      return null
    } finally {
      setLoadingPreview(false)
    }
  }

  async function executeTransfer() {
    const latestPreview = preview || await loadPreview()
    if (!latestPreview) return
    const count = Number(latestPreview.creator_count || 0)
    const rosterCount = Number(latestPreview.roster_count || 0)
    const eventCount = Number(latestPreview.event_count || 0)
    const confirmed = window.confirm(
      `确认将 ${latestPreview.from_owner} 的 ${count} 位联系人迁移到 ${latestPreview.to_owner}？\n\n同时会更新 ${rosterCount} 条 roster 归属和 ${eventCount} 条事件归属；历史消息不会删除。`
    )
    if (!confirmed) return
    setTransferring(true)
    try {
      const res = await fetchJsonOrThrow(`${API_BASE}/operator-roster/transfer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: fromOwner.trim(), to: toOwner.trim(), confirm: true }),
      })
      const data = res?.data || {}
      toast.success(`已迁移 ${data.creators_updated || 0} 位联系人到 ${data.to_owner || toOwner}`)
      setPreview(null)
      if (onTransferred) await onTransferred(data)
    } catch (err) {
      toast.error(err?.message || '迁移失败')
    } finally {
      setTransferring(false)
    }
  }

  return (
    <div
      className="docs-panel p-4"
      style={{ background: WA.white, border: `1px solid ${WA.borderLight}`, borderRadius: 16 }}
    >
      <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
        <div>
          <div className="docs-kicker">Owner Transfer</div>
          <div className="text-[15px] font-semibold mt-1" style={{ color: WA.textDark }}>联系人 owner 迁移</div>
          <div className="text-[12px] mt-1" style={{ color: WA.textMuted }}>
            批量更新联系人负责人、roster 路由和事件 owner，适合业务归属整体调整。
          </div>
        </div>
        {preview && (
          <div className="rounded-[14px] px-3 py-2 text-[12px]" style={{ background: WA.shellPanelMuted, color: WA.textDark }}>
            {preview.from_owner} → {preview.to_owner} · {preview.creator_count} 位联系人
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr_auto_auto] gap-2 items-end">
        <FormField label="来源 owner">
          <select
            value={fromOwner}
            onChange={(e) => { setFromOwner(e.target.value); setPreview(null) }}
            disabled={loadingPreview || transferring}
            style={selectStyle}
          >
            {ownerOptions.map((owner) => (
              <option key={owner} value={owner}>{owner}</option>
            ))}
          </select>
        </FormField>

        <FormField label="目标 owner">
          <select
            value={toOwner}
            onChange={(e) => { setToOwner(e.target.value); setPreview(null) }}
            disabled={loadingPreview || transferring}
            style={selectStyle}
          >
            {ownerOptions.map((owner) => (
              <option key={owner} value={owner}>{owner}</option>
            ))}
          </select>
        </FormField>

        <button
          type="button"
          onClick={loadPreview}
          disabled={loadingPreview || transferring}
          style={{ ...secondaryBtnStyle, marginBottom: 16, minWidth: 92 }}
        >
          {loadingPreview ? '读取中…' : '预览'}
        </button>
        <button
          type="button"
          onClick={executeTransfer}
          disabled={loadingPreview || transferring}
          style={{ ...primaryBtnStyle(transferring), marginBottom: 16, minWidth: 116 }}
        >
          {transferring ? '迁移中…' : '确认迁移'}
        </button>
      </div>
    </div>
  )
}

function OwnerCell({ user, roster, onCommit }) {
  const toast = useToast()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(user.operator_name || '')

  useEffect(() => {
    if (!editing) setDraft(user.operator_name || '')
  }, [user.operator_name, editing])

  if (user.role !== 'operator' && user.role !== 'viewer') {
    return <span style={{ color: WA.textMuted }}>—</span>
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[12px]"
        style={{
          background: WA.shellPanelMuted,
          color: WA.textDark,
          border: `1px solid ${WA.borderLight}`,
        }}
      >
        <span>{user.operator_name || '未设置'}</span>
        <span style={{ color: WA.textMuted, fontSize: 11 }}>✎</span>
      </button>
    )
  }

  async function commit() {
    const trimmed = (draft || '').trim()
    if (!trimmed) { setEditing(false); return }
    if (trimmed === user.operator_name) { setEditing(false); return }
    if (!OPERATOR_NAME_PATTERN.test(trimmed)) {
      toast.warning('owner 需以字母/数字开头，长度 ≤32，仅允许字母、数字、空格、下划线和连字符')
      return
    }
    try {
      await onCommit(user, trimmed)
    } finally {
      setEditing(false)
    }
  }

  return (
    <div className="space-y-2" style={{ minWidth: 260 }}>
      <OwnerPicker value={draft} onChange={setDraft} roster={roster} />
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={commit}
          style={{ ...rowBtnStyle, padding: '0 12px', color: WA.teal, borderColor: `${WA.teal}66` }}
        >
          保存
        </button>
        <button
          type="button"
          onClick={() => setEditing(false)}
          style={{ ...rowBtnStyle, padding: '0 12px' }}
        >
          取消
        </button>
      </div>
    </div>
  )
}

export function UsersPanel() {
  const toast = useToast()
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

  async function handleChangeOperator(user, newOperator) {
    try {
      await fetchJsonOrThrow(`${API_BASE}/users/${user.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ operator_name: newOperator }),
      })
      clearRosterCache()
      await loadAll()
    } catch (err) {
      toast.error(err?.message || '修改失败')
    }
  }

  async function handleToggleDisabled(user) {
    if (!confirm(`确认${user.disabled ? '启用' : '禁用'} ${user.username}?`)) return
    try {
      await fetchJsonOrThrow(`${API_BASE}/users/${user.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ disabled: !user.disabled }),
      })
      await loadAll()
    } catch (err) {
      toast.error(err?.message || '操作失败')
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
      if (res?.data?.temporary_password) setTempPassword(res.data.temporary_password)
    } catch (err) {
      toast.error(err?.message || '重置失败')
    }
  }

  function handleCreated() {
    clearRosterCache()
    loadAll()
  }

  async function handleOwnerTransferred() {
    clearRosterCache()
    await loadAll()
  }

  return (
    <div
      className="h-full overflow-y-auto docs-scrollbar px-3 py-3 md:px-6 md:py-6 space-y-4"
      style={{ background: WA.shellBg }}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="docs-kicker">WhatsApp</div>
          <div
            className="text-[18px] md:text-[20px] font-semibold tracking-[-0.03em]"
            style={{ color: WA.textDark }}
          >
            用户管理
          </div>
          <div className="text-[12px] mt-1" style={{ color: WA.textMuted }}>
            管理员可见 · owner 支持动态扩充,新增后全站下拉立即生效
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={loadAll}
            disabled={loading}
            style={{ ...secondaryBtnStyle, minHeight: 36, padding: '0 14px' }}
          >
            {loading ? '…' : '刷新'}
          </button>
          <button
            onClick={() => setShowCreate(true)}
            style={{ ...primaryBtnStyle(), minHeight: 36, padding: '0 14px' }}
          >
            ＋ 新增用户
          </button>
        </div>
      </div>

      {error && (
        <div
          className="rounded-[16px] px-4 py-3 text-[13px]"
          style={{ background: `${ACCENT.danger}14`, color: ACCENT.danger, border: `1px solid ${ACCENT.danger}33` }}
        >
          {error}
        </div>
      )}

      <OwnerTransferCard roster={roster} onTransferred={handleOwnerTransferred} />

      <div
        className="docs-panel overflow-hidden"
        style={{ background: WA.white, border: `1px solid ${WA.borderLight}`, borderRadius: 16 }}
      >
        <div className="overflow-x-auto">
          <table className="w-full border-collapse" style={{ fontSize: 13 }}>
            <thead>
              <tr style={{ background: WA.shellPanelMuted, color: WA.textMuted }}>
                <th className="text-left px-3 py-3 font-medium">用户名</th>
                <th className="text-left px-3 py-3 font-medium">角色</th>
                <th className="text-left px-3 py-3 font-medium">Owner</th>
                <th className="text-left px-3 py-3 font-medium">状态</th>
                <th className="text-left px-3 py-3 font-medium">最近登录</th>
                <th className="text-right px-3 py-3 font-medium">操作</th>
              </tr>
            </thead>
            <tbody>
              {users.length === 0 && !loading && (
                <tr>
                  <td
                    colSpan={6}
                    className="px-3 py-12 text-center"
                    style={{ color: WA.textMuted }}
                  >
                    暂无用户
                  </td>
                </tr>
              )}
              {users.map((u) => (
                <tr key={u.id} style={{ borderTop: `1px solid ${WA.borderLight}` }}>
                  <td
                    className="px-3 py-3 font-medium"
                    style={{ color: WA.textDark }}
                  >
                    {u.username}
                  </td>
                  <td className="px-3 py-3"><RoleBadge role={u.role} /></td>
                  <td className="px-3 py-3">
                    <OwnerCell user={u} roster={roster} onCommit={handleChangeOperator} />
                  </td>
                  <td className="px-3 py-3">
                    {u.disabled ? (
                      <span className="text-[12px]" style={{ color: ACCENT.danger }}>已禁用</span>
                    ) : (
                      <span className="text-[12px]" style={{ color: WA.teal }}>正常</span>
                    )}
                  </td>
                  <td className="px-3 py-3 text-[12px]" style={{ color: WA.textMuted }}>
                    {u.last_login_at ? new Date(u.last_login_at).toLocaleString('zh-CN') : '—'}
                  </td>
                  <td className="px-3 py-3 text-right whitespace-nowrap">
                    <button
                      onClick={() => handleResetPassword(u)}
                      style={{ ...rowBtnStyle, marginRight: 6 }}
                    >
                      重置密码
                    </button>
                    <button
                      onClick={() => handleToggleDisabled(u)}
                      style={{
                        ...rowBtnStyle,
                        borderColor: u.disabled ? `${WA.teal}55` : `${ACCENT.danger}55`,
                        color: u.disabled ? WA.teal : ACCENT.danger,
                      }}
                    >
                      {u.disabled ? '启用' : '禁用'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {showCreate && (
        <CreateUserModal
          roster={roster}
          onClose={() => setShowCreate(false)}
          onCreated={handleCreated}
        />
      )}

      <TempPasswordToast tempPassword={tempPassword} onClose={() => setTempPassword(null)} />
    </div>
  )
}

export default UsersPanel
