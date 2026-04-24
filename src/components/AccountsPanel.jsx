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
import { useToast } from './Toast'

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

function ModalShell({ title, onClose, children, maxWidth = 460, dismissOnBackdrop = true, dismissOnEsc = true }) {
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
  const [qrStatus, setQrStatus] = useState('waiting')
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
    setQrStatus('loading')
    const poll = async () => {
      try {
        const data = await fetchJsonOrThrow(`${API_BASE}/wa/sessions/${sid}/qr`)
        if (data?.qr) {
          setQrDataUrl(data.qr)
          setQrStatus('has_qr')
          setLastQrAt(data.last_qr_at || new Date().toISOString())
        }
      } catch (err) {
        const msg = err.message || ''
        if (/ready|authenticated/i.test(msg)) {
          setQrStatus('ready')
          stopPolling()
          onCreated?.({ session_id: sid })
          onClose?.()
        } else if (/no QR available/i.test(msg)) {
          setQrStatus('waiting')
        } else if (/http \d+/i.test(msg)) {
          setQrStatus('error')
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
        <QrBody qrDataUrl={qrDataUrl} lastQrAt={lastQrAt} status={qrStatus} onClose={onClose} />
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

const DRIVER_LABELS = {
  wwebjs: 'WWeb (Chrome/Puppeteer)',
  baileys: 'Baileys (WebSocket)',
}

const PROGRESS_LABELS = {
  queued: '排队中',
  updating_db: '更新 driver 配置',
  awaiting_stopped: '等待原 driver 停止',
  requesting_restart: '启动新 driver',
  done: '切换完成',
  stopped_wait_exceeded: '等待超时（desired_state 已写入，后台继续推进）',
  unhandled: '出错',
  error: '出错',
}

function DriverSwitchModal({ session, onClose, onSwitchedToScan }) {
  const currentDriver = (session.driver || 'wwebjs').toLowerCase()
  const defaultTarget = currentDriver === 'baileys' ? 'wwebjs' : 'baileys'
  const [target, setTarget] = useState(defaultTarget)
  const [forceDisconnect, setForceDisconnect] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [progress, setProgress] = useState(null)
  const [error, setError] = useState(null)
  const pollTimerRef = useRef(null)

  useEffect(() => () => { if (pollTimerRef.current) clearInterval(pollTimerRef.current) }, [])

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (target === currentDriver) {
      setError(`session 当前已经是 ${target}，无需切换`)
      return
    }
    setSubmitting(true)
    setError(null)
    setProgress({ status: 'pending', progress: 'queued' })
    try {
      const resp = await fetchJsonOrThrow(`${API_BASE}/wa/sessions/${session.session_id}/driver`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ driver: target, force_disconnect: forceDisconnect }),
      })
      if (resp?.already_set) {
        setProgress({ status: 'completed', progress: 'done' })
        setTimeout(() => { onSwitchedToScan?.(session.session_id); onClose?.() }, 600)
        return
      }
      const cmdId = resp?.command_id
      if (!cmdId) throw new Error('后端未返回 command_id')
      // poll
      const poll = async () => {
        try {
          const status = await fetchJsonOrThrow(`${API_BASE}/wa/sessions/${session.session_id}/commands/${cmdId}`)
          const cmd = status?.command
          if (!cmd) return
          setProgress({ status: cmd.status, progress: cmd.progress, error: cmd.error })
          if (['completed', 'failed', 'timeout'].includes(cmd.status)) {
            clearInterval(pollTimerRef.current)
            if (cmd.status === 'completed') {
              setTimeout(() => { onSwitchedToScan?.(session.session_id); onClose?.() }, 800)
            } else {
              setError(cmd.error || `切换失败 (${cmd.status})`)
              setSubmitting(false)
            }
          }
        } catch (err) {
          clearInterval(pollTimerRef.current)
          setError(err.message || String(err))
          setSubmitting(false)
        }
      }
      poll()
      pollTimerRef.current = setInterval(poll, 1500)
    } catch (err) {
      setError(err.message || String(err))
      setSubmitting(false)
    }
  }

  const isTerminal = progress && ['completed', 'failed', 'timeout'].includes(progress.status)

  return (
    <ModalShell title={`切换驱动：${session.session_id}`} onClose={submitting && !isTerminal ? undefined : onClose}>
      <form onSubmit={handleSubmit} className="space-y-3">
        <div
          className="rounded-[12px] px-3 py-2 text-[12px]"
          style={{ background: `${ACCENT.info}10`, color: WA.textDark, border: `1px solid ${ACCENT.info}33` }}
        >
          <div>当前驱动：<b>{DRIVER_LABELS[currentDriver] || currentDriver}</b></div>
          <div className="mt-1" style={{ color: WA.textMuted }}>
            切换会强制断开当前连接，需要 <b>重新扫描 QR 码</b>，消息历史不会丢失（DB 里已存）。
          </div>
        </div>

        <FormField label="目标驱动">
          <div className="space-y-2">
            {['wwebjs', 'baileys'].map((d) => (
              <label
                key={d}
                className="flex items-start gap-2 rounded-[12px] px-3 py-2 cursor-pointer"
                style={{
                  border: `1px solid ${target === d ? WA.teal : WA.borderLight}`,
                  background: target === d ? `${WA.teal}0c` : WA.white,
                }}
              >
                <input
                  type="radio"
                  name="driver"
                  value={d}
                  checked={target === d}
                  onChange={() => setTarget(d)}
                  disabled={submitting}
                  style={{ marginTop: 3 }}
                />
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-semibold" style={{ color: WA.textDark }}>
                    {DRIVER_LABELS[d]} {d === currentDriver && <span style={{ color: WA.textMuted, fontWeight: 400 }}>（当前）</span>}
                  </div>
                  <div className="text-[11px] mt-0.5" style={{ color: WA.textMuted }}>
                    {d === 'wwebjs'
                      ? 'Chromium + Puppeteer，稳定但重（200–500MB/session）'
                      : 'WebSocket 原生协议，轻量（30–60MB）、秒级重连；第三方协议有封号风险'}
                  </div>
                </div>
              </label>
            ))}
          </div>
        </FormField>

        <label className="flex items-center gap-2 text-[12px]" style={{ color: WA.textDark }}>
          <input
            type="checkbox"
            checked={forceDisconnect}
            onChange={(e) => setForceDisconnect(e.target.checked)}
            disabled={submitting}
          />
          <span>强制断开当前连接（force_disconnect，建议勾选）</span>
        </label>

        {progress && (
          <div
            className="rounded-[12px] px-3 py-2 text-[12px]"
            style={{
              background: progress.status === 'failed' || progress.status === 'timeout'
                ? `${ACCENT.danger}14`
                : `${WA.teal}0f`,
              color: WA.textDark,
              border: `1px solid ${progress.status === 'failed' || progress.status === 'timeout' ? ACCENT.danger : WA.teal}33`,
            }}
          >
            <div><b>状态：</b>{progress.status} · {PROGRESS_LABELS[progress.progress] || progress.progress}</div>
            {progress.error && (
              <div className="mt-1 break-words" style={{ color: ACCENT.danger }}>{progress.error}</div>
            )}
            {progress.status === 'completed' && (
              <div className="mt-1" style={{ color: WA.teal }}>即将跳转到扫码页面…</div>
            )}
          </div>
        )}

        {error && (
          <div
            className="rounded-[12px] px-3 py-2 text-[12px]"
            style={{ background: `${ACCENT.danger}14`, color: ACCENT.danger, border: `1px solid ${ACCENT.danger}33` }}
          >
            {error}
          </div>
        )}

        <div className="flex gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting && !isTerminal}
            style={{ ...secondaryBtnStyle, flex: 1, minWidth: 100 }}
          >
            取消
          </button>
          <button
            type="submit"
            disabled={submitting || target === currentDriver}
            style={{ ...primaryBtnStyle(submitting || target === currentDriver), flex: 1, minWidth: 120 }}
          >
            {submitting ? '切换中…' : `切换到 ${target}`}
          </button>
        </div>
      </form>
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

function DriverBadge({ driver }) {
  const current = (driver || 'wwebjs').toLowerCase()
  const cfg = current === 'baileys'
    ? { color: WA.teal, label: 'Baileys' }
    : { color: ACCENT.info, label: 'WWeb (Chrome)' }
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold tracking-wide"
      style={{
        background: `${cfg.color}14`,
        color: cfg.color,
        border: `1px solid ${cfg.color}33`,
      }}
      title={`当前驱动：${current}`}
    >
      <span style={{ width: 5, height: 5, borderRadius: '50%', background: cfg.color }} />
      {cfg.label}
    </span>
  )
}

function SessionActions({ session, pending, onRestart, onToggle, onDelete, onScan, onSwitchDriver, onReauth }) {
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
        onClick={() => onSwitchDriver(session)}
        disabled={isActionPending('driver')}
        style={{ ...secondaryBtnStyle, minHeight: 36, padding: '0 14px', fontSize: 12 }}
        title="切换 WhatsApp 驱动（需要重扫 QR）"
      >
        {isActionPending('driver') ? '切换中…' : '切换驱动'}
      </button>
      <button
        onClick={() => onRestart(session.session_id)}
        disabled={isActionPending('restart')}
        style={{ ...secondaryBtnStyle, minHeight: 36, padding: '0 14px', fontSize: 12 }}
      >
        {isActionPending('restart') ? '重启中…' : '重启'}
      </button>
      <button
        onClick={() => onReauth(session.session_id)}
        disabled={isActionPending('reauth')}
        style={{ ...secondaryBtnStyle, minHeight: 36, padding: '0 14px', fontSize: 12 }}
        title="清除当前登录态并弹出新 QR 码，session 配置保留"
      >
        {isActionPending('reauth') ? '处理中…' : '重新扫码'}
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

function SessionCard({ session, pending, onRestart, onToggle, onDelete, onScan, onSwitchDriver, onReauth }) {
  return (
    <article
      className="rounded-[20px] p-4 space-y-3"
      style={{ background: WA.white, border: `1px solid ${WA.borderLight}`, boxShadow: '0 1px 2px rgba(15,23,42,0.04)' }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="docs-kicker">Session</div>
          <div className="docs-title mt-0.5 flex items-center gap-2 flex-wrap" style={{ fontSize: 16 }}>
            <span>{session.session_id}</span>
            <DriverBadge driver={session.driver} />
          </div>
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
          onReauth={onReauth}
          onToggle={onToggle}
          onDelete={onDelete}
          onScan={onScan}
          onSwitchDriver={onSwitchDriver}
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
  const toast = useToast()
  const [sessions, setSessions] = useState([])
  const [summary, setSummary] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [showAddModal, setShowAddModal] = useState(false)
  const [scanSessionId, setScanSessionId] = useState(null)
  const [switchDriverSession, setSwitchDriverSession] = useState(null)
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
      toast.error(`操作失败: ${err.message || err}`)
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

  const handleReauth = async (sid) => {
    const confirmed = confirm(
      `确认重新扫码 session "${sid}"?\n\n会清除当前登录态（LocalAuth 目录），需要在手机端重新扫描 QR 码。\n\n配置（owner / driver / desired_state）保留，消息历史不会丢失。`
    )
    if (!confirmed) return
    await doAction(sid, 'reauth', () =>
      fetchJsonOrThrow(`${API_BASE}/wa/sessions/${sid}/reauth`, { method: 'POST' })
    )
    // 触发扫码弹窗，后台 agent 重启后会产生新 QR
    setScanSessionId(sid)
  }

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

  const handleSwitchDriver = (session) => setSwitchDriverSession(session)

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
              onReauth={handleReauth}
              onToggle={handleToggleDesired}
              onDelete={handleDelete}
              onScan={handleScan}
              onSwitchDriver={handleSwitchDriver}
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

      {switchDriverSession && (
        <DriverSwitchModal
          session={switchDriverSession}
          onClose={() => { setSwitchDriverSession(null); loadSessions() }}
          onSwitchedToScan={(sid) => { setSwitchDriverSession(null); setScanSessionId(sid); loadSessions() }}
        />
      )}
    </div>
  )
}

export default AccountsPanel
