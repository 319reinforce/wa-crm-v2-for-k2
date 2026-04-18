/**
 * AccountsPanel — WhatsApp 账号管理面板(admin only)
 *
 * 功能:
 * - 列出所有 wa_sessions + 运行时状态(desired/runtime, QR, phone, heartbeat)
 * - 添加账号 → 扫码流程(polling QR,扫完自动关闭)
 * - 重启 / 启用 / 停用 / 删除(可选清除 auth 目录)
 */
import React, { useState, useEffect, useCallback, useRef } from 'react'
import { fetchJsonOrThrow } from '../utils/api'
import WA from '../utils/waTheme'

const API_BASE = '/api'
const REFRESH_INTERVAL_MS = 5000
const QR_POLL_INTERVAL_MS = 2000

// 本地状态色（danger/warning/info/muted 在项目 waTheme 无对应，保留为状态色）
const ACCENT = {
  danger: '#c65f49',
  warning: '#b45309',
  info: '#2563eb',
  muted: '#9a9288',
}

function formatHeartbeat(ms) {
  if (ms == null) return '-'
  if (ms < 1000) return '<1s'
  if (ms < 60000) return `${Math.round(ms / 1000)}s 前`
  if (ms < 3600000) return `${Math.round(ms / 60000)}m 前`
  return `${Math.round(ms / 3600000)}h 前`
}

function StateBadge({ desiredState, runtimeState, agent }) {
  const effective = agent?.ready ? 'ready'
    : agent?.state === 'starting' ? 'starting'
    : runtimeState || 'unknown'

  const config = {
    ready: { color: WA.teal, label: '运行中' },
    starting: { color: ACCENT.warning, label: '启动中' },
    pending: { color: ACCENT.muted, label: '待启动' },
    stale: { color: ACCENT.warning, label: '心跳超时' },
    crashed: { color: ACCENT.danger, label: '已崩溃' },
    stopped: { color: ACCENT.muted, label: '已停止' },
    unknown: { color: ACCENT.muted, label: '未知' },
  }[effective] || { color: ACCENT.muted, label: effective }

  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full"
      style={{
        padding: '3px 10px',
        fontSize: 11,
        fontWeight: 600,
        background: `${config.color}18`,
        color: config.color,
      }}
    >
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: config.color }} />
      {config.label}
      {desiredState === 'stopped' && effective === 'ready' && (
        <span style={{ fontSize: 10, opacity: 0.65 }}>(关停中)</span>
      )}
    </span>
  )
}

function IntentBadge({ desiredState }) {
  const active = desiredState === 'running'
  return (
    <span
      className="inline-flex items-center rounded-full"
      style={{
        padding: '3px 10px',
        fontSize: 11,
        fontWeight: 600,
        background: active ? WA.shellAccentSoft : WA.shellPanelMuted,
        color: active ? WA.teal : WA.textMuted,
      }}
    >
      {active ? '运行' : '停止'}
    </span>
  )
}

function ModalShell({ title, onClose, children, maxWidth = 460 }) {
  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center"
      style={{ background: 'rgba(31,29,26,0.45)', padding: 16 }}
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
            onClick={onClose}
            className="inline-flex items-center justify-center rounded-full shrink-0"
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
        <div className="flex-1 min-h-0 overflow-y-auto docs-scrollbar p-5">
          {children}
        </div>
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

const inputStyle = {
  width: '100%',
  minHeight: 44,
  padding: '0 14px',
  borderRadius: 14,
  border: `1px solid ${WA.borderLight}`,
  background: WA.white,
  color: WA.textDark,
  fontSize: 14,
  outline: 'none',
}

const primaryBtnStyle = (disabled = false) => ({
  minHeight: 44,
  padding: '0 18px',
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
  minHeight: 44,
  padding: '0 16px',
  borderRadius: 999,
  border: `1px solid ${WA.borderLight}`,
  background: WA.white,
  color: WA.textMuted,
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
}

const dangerLinkBtnStyle = {
  ...secondaryBtnStyle,
  color: ACCENT.danger,
  borderColor: `${ACCENT.danger}33`,
  background: `${ACCENT.danger}10`,
}

function AddAccountModal({ onClose, onCreated }) {
  const [sessionId, setSessionId] = useState('')
  const [owner, setOwner] = useState('')
  const [aliases, setAliases] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)
  const [qrDataUrl, setQrDataUrl] = useState(null)
  const [qrPolling, setQrPolling] = useState(false)
  const [createdSessionId, setCreatedSessionId] = useState(null)
  const [lastQrAt, setLastQrAt] = useState(null)
  const pollTimerRef = useRef(null)

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current)
      pollTimerRef.current = null
    }
    setQrPolling(false)
  }, [])

  useEffect(() => {
    return () => stopPolling()
  }, [stopPolling])

  const startQrPolling = useCallback((sid) => {
    setQrPolling(true)
    const poll = async () => {
      try {
        const data = await fetchJsonOrThrow(`${API_BASE}/wa/sessions/${sid}/qr`)
        if (data?.qr) {
          setQrDataUrl(data.qr)
          setLastQrAt(data.last_qr_at || new Date().toISOString())
        }
      } catch (err) {
        if (/ready/i.test(err.message)) {
          stopPolling()
          onCreated?.({ session_id: sid })
          onClose?.()
        }
      }
    }
    poll()
    pollTimerRef.current = setInterval(poll, QR_POLL_INTERVAL_MS)
  }, [onClose, onCreated, stopPolling])

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      const aliasArray = aliases.split(',').map((s) => s.trim()).filter(Boolean)
      const result = await fetchJsonOrThrow(`${API_BASE}/wa/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sessionId, owner, aliases: aliasArray }),
      })
      if (result?.ok) {
        setCreatedSessionId(result.session.session_id)
        startQrPolling(result.session.session_id)
      } else {
        setError(result?.error || '创建失败')
      }
    } catch (err) {
      setError(err.message || String(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <ModalShell
      title={createdSessionId ? `扫码登录 ${createdSessionId}` : '添加 WhatsApp 账号'}
      onClose={onClose}
    >
      {!createdSessionId && (
        <form onSubmit={handleSubmit}>
          <FormField label="Session ID" hint="小写字母数字，如 beau / yiyun">
            <input
              type="text"
              value={sessionId}
              onChange={(e) => setSessionId(e.target.value)}
              placeholder="beau"
              required
              style={inputStyle}
            />
          </FormField>
          <FormField label="Owner" hint="运营姓名，首字母大写">
            <input
              type="text"
              value={owner}
              onChange={(e) => setOwner(e.target.value)}
              placeholder="Beau"
              required
              style={inputStyle}
            />
          </FormField>
          <FormField label="别名" hint="逗号分隔，可选">
            <input
              type="text"
              value={aliases}
              onChange={(e) => setAliases(e.target.value)}
              placeholder="sybil, jw"
              style={inputStyle}
            />
          </FormField>

          {error && (
            <div
              className="rounded-[14px] px-3 py-2.5 mb-3 text-[13px]"
              style={{ background: `${ACCENT.danger}14`, color: ACCENT.danger, border: `1px solid ${ACCENT.danger}33` }}
            >
              {error}
            </div>
          )}

          <div className="flex flex-wrap gap-2 pt-2">
            <button type="button" onClick={onClose} style={{ ...secondaryBtnStyle, flex: 1, minWidth: 100 }}>
              取消
            </button>
            <button type="submit" disabled={submitting} style={{ ...primaryBtnStyle(submitting), flex: 1, minWidth: 120 }}>
              {submitting ? '创建中…' : '创建并扫码'}
            </button>
          </div>
        </form>
      )}

      {createdSessionId && (
        <QrBody qrDataUrl={qrDataUrl} lastQrAt={lastQrAt} status={qrPolling ? 'polling' : 'waiting'} onClose={onClose} />
      )}
    </ModalShell>
  )
}

function QrModal({ sessionId, onClose }) {
  const [qrDataUrl, setQrDataUrl] = useState(null)
  const [lastQrAt, setLastQrAt] = useState(null)
  const [refreshCount, setRefreshCount] = useState(0)
  const [status, setStatus] = useState('loading')
  const [error, setError] = useState(null)
  const pollTimerRef = useRef(null)

  useEffect(() => {
    let cancelled = false
    const poll = async () => {
      try {
        const data = await fetchJsonOrThrow(`${API_BASE}/wa/sessions/${sessionId}/qr`)
        if (cancelled) return
        if (data?.qr) {
          setQrDataUrl(data.qr)
          setLastQrAt(data.last_qr_at || new Date().toISOString())
          setRefreshCount(data.qr_refresh_count || 0)
          setStatus('has_qr')
        }
      } catch (err) {
        if (cancelled) return
        const msg = err.message || String(err)
        if (/already authenticated|ready/i.test(msg)) {
          setStatus('ready')
          setTimeout(onClose, 1500)
        } else if (/no QR available/i.test(msg)) {
          setStatus('waiting')
        } else {
          setError(msg)
          setStatus('error')
        }
      }
    }
    poll()
    pollTimerRef.current = setInterval(poll, QR_POLL_INTERVAL_MS)
    return () => {
      cancelled = true
      if (pollTimerRef.current) clearInterval(pollTimerRef.current)
    }
  }, [sessionId, onClose])

  return (
    <ModalShell title={`扫码登录 ${sessionId}`} onClose={onClose}>
      <QrBody
        qrDataUrl={qrDataUrl}
        lastQrAt={lastQrAt}
        status={status}
        refreshCount={refreshCount}
        error={error}
        onClose={onClose}
      />
    </ModalShell>
  )
}

function QrBody({ qrDataUrl, lastQrAt, status, refreshCount, error, onClose }) {
  return (
    <div className="text-center space-y-3">
      <p className="text-[13px] leading-relaxed" style={{ color: WA.textMuted }}>
        WhatsApp 手机端 → ⋮ → <b>已关联的设备</b> → <b>关联新设备</b> → 扫码
      </p>

      {status === 'ready' && (
        <div
          className="rounded-[18px] py-8 font-semibold"
          style={{ background: WA.shellAccentSoft, color: WA.teal, fontSize: 15 }}
        >
          ✓ 扫码成功，session 已就绪
        </div>
      )}

      {status === 'has_qr' && qrDataUrl && (
        <>
          <div
            className="mx-auto rounded-[18px]"
            style={{
              width: 260,
              height: 260,
              background: WA.white,
              border: `1px solid ${WA.borderLight}`,
              padding: 12,
            }}
          >
            <img src={qrDataUrl} alt="QR" style={{ width: '100%', height: '100%', display: 'block' }} />
          </div>
          <p style={{ fontSize: 11, color: WA.textMuted }}>
            QR 刷新 #{refreshCount || 0}
            {lastQrAt ? ` · ${new Date(lastQrAt).toLocaleTimeString()}` : ''}
          </p>
        </>
      )}

      {(status === 'loading' || status === 'waiting' || status === 'polling') && (
        <div
          className="mx-auto rounded-[18px] flex flex-col items-center justify-center gap-2"
          style={{
            width: 260,
            height: 260,
            background: WA.shellPanelMuted,
            color: WA.textMuted,
            fontSize: 13,
            padding: 16,
          }}
        >
          <span>{status === 'loading' ? '加载二维码…' : '等待 agent 生成二维码…'}</span>
          {status === 'waiting' && <span style={{ fontSize: 11, opacity: 0.8 }}>Chrome 启动需 10–20s</span>}
        </div>
      )}

      {status === 'error' && (
        <div
          className="rounded-[14px] px-3 py-2.5 text-[13px]"
          style={{ background: `${ACCENT.danger}14`, color: ACCENT.danger, border: `1px solid ${ACCENT.danger}33` }}
        >
          {error}
        </div>
      )}

      <div className="pt-1">
        <button onClick={onClose} style={{ ...secondaryBtnStyle, width: '100%' }}>
          {status === 'has_qr' ? '关闭（后台继续扫码）' : '关闭'}
        </button>
      </div>
    </div>
  )
}

function SummaryBar({ summary }) {
  if (!summary) return null
  return (
    <div
      className="docs-panel flex flex-wrap items-center gap-2 px-4 py-3"
      style={{ background: WA.white }}
    >
      <SummaryPill label="总计" value={summary.total} color={WA.textDark} />
      <SummaryPill label="就绪" value={summary.ready} color={WA.teal} dotted />
      <SummaryPill label="崩溃" value={summary.crashed} color={ACCENT.danger} dotted />
      <SummaryPill label="停止" value={summary.stopped} color={ACCENT.muted} dotted />
      {!summary.registry_enabled && (
        <span
          className="ml-auto text-[11px] font-semibold rounded-full"
          style={{
            padding: '3px 10px',
            background: `${ACCENT.warning}18`,
            color: ACCENT.warning,
          }}
          title="WA_AGENTS_ENABLED=false"
        >
          ⚠ SessionRegistry 未启用
        </span>
      )}
    </div>
  )
}

function SummaryPill({ label, value, color, dotted }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full"
      style={{
        padding: '4px 12px',
        background: WA.shellPanelMuted,
        color: WA.textMuted,
        fontSize: 12,
        fontWeight: 500,
      }}
    >
      {dotted && (
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: color }} />
      )}
      {label}
      <b style={{ color, marginLeft: 2 }}>{value ?? 0}</b>
    </span>
  )
}

function SessionActions({ session, pending, onRestart, onToggle, onDelete, onScan }) {
  const showScan = session.agent?.has_qr || (session.agent && !session.agent.ready && session.desired_state === 'running')
  const isRunning = session.desired_state === 'running'
  const isActionPending = (key) => !!pending[`${session.session_id}:${key}`]

  return (
    <div className="flex flex-wrap gap-2">
      {showScan && (
        <button onClick={() => onScan(session.session_id)} style={{ ...primaryBtnStyle(), minHeight: 36, padding: '0 14px', fontSize: 12 }}>
          扫码登录
        </button>
      )}
      <button
        onClick={() => onRestart(session.session_id)}
        disabled={isActionPending('restart')}
        style={{ ...secondaryBtnStyle, minHeight: 36, padding: '0 14px', fontSize: 12 }}
      >
        {isActionPending('restart') ? '重启中…' : '重启'}
      </button>
      <button
        onClick={() => onToggle(session.session_id, isRunning ? 'stopped' : 'running')}
        disabled={isActionPending('toggle')}
        style={{ ...secondaryBtnStyle, minHeight: 36, padding: '0 14px', fontSize: 12 }}
      >
        {isRunning ? '停用' : '启用'}
      </button>
      <button
        onClick={() => onDelete(session.session_id)}
        disabled={isActionPending('delete')}
        style={{ ...dangerLinkBtnStyle, minHeight: 36, padding: '0 14px', fontSize: 12 }}
      >
        删除
      </button>
    </div>
  )
}

function SessionCard({ session, pending, onRestart, onToggle, onDelete, onScan }) {
  return (
    <article
      className="rounded-[20px] p-4 space-y-3"
      style={{ background: WA.white, border: `1px solid ${WA.borderLight}`, boxShadow: '0 1px 2px rgba(15,23,42,0.04)' }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="docs-kicker">Session</div>
          <div className="docs-title mt-0.5" style={{ fontSize: 16 }}>{session.session_id}</div>
          {session.aliases?.length > 0 && (
            <div className="text-[11px] mt-1" style={{ color: WA.textMuted }}>
              别名：{session.aliases.join('、')}
            </div>
          )}
        </div>
        <div className="flex flex-col items-end gap-1.5 shrink-0">
          <StateBadge
            desiredState={session.desired_state}
            runtimeState={session.runtime_state}
            agent={session.agent}
          />
          <IntentBadge desiredState={session.desired_state} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 text-[12px]">
        <MetaRow label="Owner" value={session.owner || '-'} />
        <MetaRow label="手机号" value={session.account_phone || '-'} />
        <MetaRow label="心跳" value={formatHeartbeat(session.agent?.last_heartbeat_ms_ago)} />
        <MetaRow label="重启次数" value={String(session.restart_count || 0)} />
        {session.runtime_phase && <MetaRow label="Phase" value={session.runtime_phase} />}
      </div>

      {session.last_error && (
        <div
          className="rounded-[12px] px-3 py-2 text-[12px]"
          style={{ background: `${ACCENT.danger}10`, color: ACCENT.danger, border: `1px solid ${ACCENT.danger}26` }}
          title={session.last_error}
        >
          <span className="docs-kicker mr-1" style={{ color: ACCENT.danger }}>错误</span>
          <span className="break-words">{session.last_error}</span>
        </div>
      )}

      <div style={{ borderTop: `1px solid ${WA.borderLight}`, paddingTop: 12 }}>
        <SessionActions
          session={session}
          pending={pending}
          onRestart={onRestart}
          onToggle={onToggle}
          onDelete={onDelete}
          onScan={onScan}
        />
      </div>
    </article>
  )
}

function MetaRow({ label, value }) {
  return (
    <div>
      <div className="docs-kicker" style={{ fontSize: 10 }}>{label}</div>
      <div className="mt-0.5 font-semibold break-all" style={{ color: WA.textDark, fontSize: 13 }}>{value}</div>
    </div>
  )
}

export function AccountsPanel() {
  const [sessions, setSessions] = useState([])
  const [summary, setSummary] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [showAddModal, setShowAddModal] = useState(false)
  const [scanSessionId, setScanSessionId] = useState(null)
  const [actionPending, setActionPending] = useState({})

  const loadSessions = useCallback(async () => {
    try {
      const data = await fetchJsonOrThrow(`${API_BASE}/wa/sessions`)
      if (data?.ok) {
        setSessions(data.sessions || [])
        setSummary(data.summary || null)
        setError(null)
        try {
          window.dispatchEvent(new CustomEvent('wa-session-status-changed', {
            detail: { owners: (data.sessions || []).map(s => s.owner).filter(Boolean) }
          }))
        } catch (_) {}
      }
    } catch (err) {
      setError(err.message || String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadSessions()
    const id = setInterval(loadSessions, REFRESH_INTERVAL_MS)
    return () => clearInterval(id)
  }, [loadSessions])

  const doAction = async (sessionId, actionKey, fn) => {
    setActionPending((prev) => ({ ...prev, [`${sessionId}:${actionKey}`]: true }))
    try {
      await fn()
      await loadSessions()
    } catch (err) {
      alert(`操作失败: ${err.message || err}`)
    } finally {
      setActionPending((prev) => {
        const next = { ...prev }
        delete next[`${sessionId}:${actionKey}`]
        return next
      })
    }
  }

  const handleRestart = (sid) => doAction(sid, 'restart', () =>
    fetchJsonOrThrow(`${API_BASE}/wa/sessions/${sid}/restart`, { method: 'POST' })
  )

  const handleToggleDesired = (sid, nextState) => doAction(sid, 'toggle', () =>
    fetchJsonOrThrow(`${API_BASE}/wa/sessions/${sid}/desired-state`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state: nextState }),
    })
  )

  const handleDelete = (sid) => {
    const purgeAuth = confirm(`确认删除 session "${sid}"?\n\n"确定"=同时清除 LocalAuth 目录(需要重新扫码才能恢复)\n"取消"=只删 DB 记录(LocalAuth 保留)`)
    doAction(sid, 'delete', () =>
      fetchJsonOrThrow(`${API_BASE}/wa/sessions/${sid}?purge_auth=${purgeAuth}`, { method: 'DELETE' })
    )
  }

  const handleScan = (sid) => setScanSessionId(sid)

  return (
    <div className="h-full overflow-y-auto docs-scrollbar px-3 py-3 md:px-6 md:py-6 space-y-4" style={{ background: WA.shellBg }}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="docs-kicker">WhatsApp</div>
          <div className="text-[18px] md:text-[20px] font-semibold tracking-[-0.03em]" style={{ color: WA.textDark }}>
            账号管理
          </div>
        </div>
        <button
          onClick={() => setShowAddModal(true)}
          style={{ ...primaryBtnStyle(), minHeight: 40, padding: '0 16px', fontSize: 13 }}
        >
          ＋ 添加账号
        </button>
      </div>

      <SummaryBar summary={summary} />

      {error && (
        <div
          className="rounded-[16px] px-4 py-3 text-[13px]"
          style={{ background: `${ACCENT.danger}14`, color: ACCENT.danger, border: `1px solid ${ACCENT.danger}33` }}
        >
          {error}
        </div>
      )}

      {loading && !sessions.length ? (
        <div className="docs-panel py-12 text-center text-sm" style={{ color: WA.textMuted, background: WA.white }}>
          加载中…
        </div>
      ) : sessions.length === 0 ? (
        <div className="docs-panel py-12 text-center text-sm" style={{ color: WA.textMuted, background: WA.white }}>
          暂无账号，点击右上"＋ 添加账号"开始
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {sessions.map((s) => (
            <SessionCard
              key={s.session_id}
              session={s}
              pending={actionPending}
              onRestart={handleRestart}
              onToggle={handleToggleDesired}
              onDelete={handleDelete}
              onScan={handleScan}
            />
          ))}
        </div>
      )}

      {showAddModal && (
        <AddAccountModal
          onClose={() => { setShowAddModal(false); loadSessions() }}
          onCreated={() => loadSessions()}
        />
      )}

      {scanSessionId && (
        <QrModal
          sessionId={scanSessionId}
          onClose={() => { setScanSessionId(null); loadSessions() }}
        />
      )}
    </div>
  )
}

export default AccountsPanel
