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

const API_BASE = '/api'
const REFRESH_INTERVAL_MS = 5000
const QR_POLL_INTERVAL_MS = 2000

const WA = {
  teal: '#00a884',
  tealDark: '#008069',
  danger: '#ef4444',
  warning: '#f59e0b',
  info: '#3b82f6',
  muted: '#94a3b8',
  border: '#e9edef',
  bg: '#f6f7f8',
  text: '#111b21',
  textMuted: '#667781',
}

function formatHeartbeat(ms) {
  if (ms == null) return '-'
  if (ms < 1000) return '<1s'
  if (ms < 60000) return `${Math.round(ms / 1000)}s ago`
  if (ms < 3600000) return `${Math.round(ms / 60000)}m ago`
  return `${Math.round(ms / 3600000)}h ago`
}

function StateBadge({ desiredState, runtimeState, agent }) {
  const effective = agent?.ready ? 'ready'
    : agent?.state === 'starting' ? 'starting'
    : runtimeState || 'unknown'

  const config = {
    ready: { color: WA.teal, label: '运行中', dot: '●' },
    starting: { color: WA.warning, label: '启动中', dot: '○' },
    pending: { color: WA.muted, label: '待启动', dot: '○' },
    stale: { color: WA.warning, label: '心跳超时', dot: '●' },
    crashed: { color: WA.danger, label: '已崩溃', dot: '●' },
    stopped: { color: WA.muted, label: '已停止', dot: '○' },
    unknown: { color: WA.muted, label: '未知', dot: '?' },
  }[effective] || { color: WA.muted, label: effective, dot: '?' }

  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: '2px 8px', borderRadius: 12, fontSize: 12,
      background: `${config.color}22`, color: config.color,
    }}>
      <span>{config.dot}</span>
      <span>{config.label}</span>
      {desiredState === 'stopped' && effective === 'ready' && (
        <span style={{ fontSize: 10, opacity: 0.6 }}>(关停中)</span>
      )}
    </span>
  )
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
          // 扫码成功
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
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10000,
    }}>
      <div style={{
        background: 'white', borderRadius: 12, padding: 24, width: 480,
        maxHeight: '90vh', overflow: 'auto', boxShadow: '0 8px 32px rgba(0,0,0,0.2)',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h3 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>
            {createdSessionId ? `扫码登录 ${createdSessionId}` : '添加 WhatsApp 账号'}
          </h3>
          <button onClick={onClose} style={{
            background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: WA.textMuted,
          }}>×</button>
        </div>

        {!createdSessionId && (
          <form onSubmit={handleSubmit}>
            <div style={{ marginBottom: 12 }}>
              <label style={{ display: 'block', fontSize: 13, color: WA.textMuted, marginBottom: 4 }}>
                Session ID (小写字母数字,如 beau)
              </label>
              <input
                type="text"
                value={sessionId}
                onChange={(e) => setSessionId(e.target.value)}
                placeholder="例如 beau / yiyun"
                required
                style={{ width: '100%', padding: '8px 12px', border: `1px solid ${WA.border}`, borderRadius: 6, fontSize: 14 }}
              />
            </div>
            <div style={{ marginBottom: 12 }}>
              <label style={{ display: 'block', fontSize: 13, color: WA.textMuted, marginBottom: 4 }}>
                Owner(运营姓名,首字母大写)
              </label>
              <input
                type="text"
                value={owner}
                onChange={(e) => setOwner(e.target.value)}
                placeholder="例如 Beau / Yiyun"
                required
                style={{ width: '100%', padding: '8px 12px', border: `1px solid ${WA.border}`, borderRadius: 6, fontSize: 14 }}
              />
            </div>
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: 13, color: WA.textMuted, marginBottom: 4 }}>
                别名(逗号分隔,可选)
              </label>
              <input
                type="text"
                value={aliases}
                onChange={(e) => setAliases(e.target.value)}
                placeholder="例如 sybil,jw"
                style={{ width: '100%', padding: '8px 12px', border: `1px solid ${WA.border}`, borderRadius: 6, fontSize: 14 }}
              />
            </div>
            {error && (
              <div style={{ marginBottom: 12, padding: 8, background: `${WA.danger}22`, color: WA.danger, borderRadius: 6, fontSize: 13 }}>
                {error}
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button
                type="button"
                onClick={onClose}
                style={{ padding: '8px 16px', border: `1px solid ${WA.border}`, background: 'white', borderRadius: 6, cursor: 'pointer' }}
              >
                取消
              </button>
              <button
                type="submit"
                disabled={submitting}
                style={{
                  padding: '8px 16px', border: 'none', background: WA.teal, color: 'white',
                  borderRadius: 6, cursor: submitting ? 'wait' : 'pointer', opacity: submitting ? 0.6 : 1,
                }}
              >
                {submitting ? '创建中...' : '创建并扫码'}
              </button>
            </div>
          </form>
        )}

        {createdSessionId && (
          <div style={{ textAlign: 'center' }}>
            <p style={{ fontSize: 13, color: WA.textMuted, marginBottom: 16 }}>
              WhatsApp 手机端 → ⋮ → 已关联的设备 → 关联新设备 → 扫码
            </p>
            {qrDataUrl ? (
              <div>
                <img src={qrDataUrl} alt="QR" style={{ width: 280, height: 280, border: `1px solid ${WA.border}`, borderRadius: 8 }} />
                <p style={{ fontSize: 12, color: WA.textMuted, marginTop: 8 }}>
                  {qrPolling ? '等待扫码...' : '请刷新'}
                </p>
                {lastQrAt && (
                  <p style={{ fontSize: 11, color: WA.textMuted }}>
                    刷新于 {new Date(lastQrAt).toLocaleTimeString()}
                  </p>
                )}
              </div>
            ) : (
              <div style={{
                width: 280, height: 280, margin: '0 auto',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: WA.bg, borderRadius: 8, color: WA.textMuted,
              }}>
                {qrPolling ? '生成二维码中...' : '等待 agent 启动...'}
              </div>
            )}
            <div style={{ marginTop: 16 }}>
              <button
                onClick={onClose}
                style={{ padding: '8px 16px', border: `1px solid ${WA.border}`, background: 'white', borderRadius: 6, cursor: 'pointer' }}
              >
                关闭(后台继续扫码)
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
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
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10000,
    }}>
      <div style={{
        background: 'white', borderRadius: 12, padding: 24, width: 420,
        boxShadow: '0 8px 32px rgba(0,0,0,0.2)',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h3 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>扫码登录 {sessionId}</h3>
          <button onClick={onClose} style={{
            background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: WA.textMuted,
          }}>×</button>
        </div>

        <p style={{ fontSize: 13, color: WA.textMuted, marginBottom: 16, textAlign: 'center' }}>
          WhatsApp 手机端 → ⋮ → 已关联的设备 → 关联新设备 → 扫码
        </p>

        {status === 'ready' && (
          <div style={{ textAlign: 'center', padding: 40, color: WA.teal, fontSize: 16, fontWeight: 600 }}>
            ✓ 扫码成功,该 session 已就绪
          </div>
        )}

        {status === 'has_qr' && qrDataUrl && (
          <div style={{ textAlign: 'center' }}>
            <img src={qrDataUrl} alt="QR" style={{ width: 280, height: 280, border: `1px solid ${WA.border}`, borderRadius: 8 }} />
            <p style={{ fontSize: 11, color: WA.textMuted, marginTop: 8 }}>
              QR 刷新 #{refreshCount}{lastQrAt ? ` · ${new Date(lastQrAt).toLocaleTimeString()}` : ''}
            </p>
          </div>
        )}

        {status === 'loading' && (
          <div style={{
            width: 280, height: 280, margin: '0 auto',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: WA.bg, borderRadius: 8, color: WA.textMuted,
          }}>加载二维码...</div>
        )}

        {status === 'waiting' && (
          <div style={{
            width: 280, height: 280, margin: '0 auto',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: WA.bg, borderRadius: 8, color: WA.textMuted, textAlign: 'center', padding: 20,
          }}>
            等待 agent 生成二维码...<br/>
            <span style={{ fontSize: 11 }}>(Chrome 启动需 10-20s)</span>
          </div>
        )}

        {status === 'error' && (
          <div style={{ padding: 16, color: WA.danger, fontSize: 13, textAlign: 'center' }}>
            {error}
          </div>
        )}

        <div style={{ marginTop: 16, textAlign: 'center' }}>
          <button
            onClick={onClose}
            style={{ padding: '8px 16px', border: `1px solid ${WA.border}`, background: 'white', borderRadius: 6, cursor: 'pointer' }}
          >
            关闭
          </button>
        </div>
      </div>
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
        // 通知 App.jsx 等其它组件刷新 owner 选项
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

  return (
    <div style={{ padding: 24, height: '100%', overflow: 'auto', background: WA.bg }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2 style={{ margin: 0, fontSize: 20, fontWeight: 600 }}>WhatsApp 账号管理</h2>
        <button
          onClick={() => setShowAddModal(true)}
          style={{
            padding: '8px 16px', border: 'none', background: WA.teal, color: 'white',
            borderRadius: 6, cursor: 'pointer', fontSize: 14, fontWeight: 500,
          }}
        >
          + 添加账号
        </button>
      </div>

      {summary && (
        <div style={{ display: 'flex', gap: 12, marginBottom: 16, fontSize: 13 }}>
          <span>总计 <b>{summary.total}</b></span>
          <span style={{ color: WA.teal }}>● 就绪 {summary.ready}</span>
          <span style={{ color: WA.danger }}>● 崩溃 {summary.crashed}</span>
          <span style={{ color: WA.muted }}>● 停止 {summary.stopped}</span>
          {!summary.registry_enabled && (
            <span style={{ marginLeft: 'auto', color: WA.warning, fontSize: 12 }}>
              ⚠ SessionRegistry 未启用(WA_AGENTS_ENABLED=false)
            </span>
          )}
        </div>
      )}

      {error && (
        <div style={{ marginBottom: 12, padding: 12, background: `${WA.danger}22`, color: WA.danger, borderRadius: 6 }}>
          {error}
        </div>
      )}

      {loading && !sessions.length ? (
        <div style={{ padding: 48, textAlign: 'center', color: WA.textMuted }}>加载中...</div>
      ) : (
        <div style={{ background: 'white', borderRadius: 8, border: `1px solid ${WA.border}`, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: WA.bg, borderBottom: `1px solid ${WA.border}` }}>
                <th style={thStyle}>Session ID</th>
                <th style={thStyle}>Owner</th>
                <th style={thStyle}>意图</th>
                <th style={thStyle}>运行状态</th>
                <th style={thStyle}>手机号</th>
                <th style={thStyle}>心跳</th>
                <th style={thStyle}>重启次数</th>
                <th style={thStyle}>错误</th>
                <th style={thStyle}>操作</th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((s) => {
                const pending = (key) => !!actionPending[`${s.session_id}:${key}`]
                return (
                  <tr key={s.session_id} style={{ borderBottom: `1px solid ${WA.border}` }}>
                    <td style={tdStyle}>
                      <div style={{ fontWeight: 600 }}>{s.session_id}</div>
                      {s.aliases?.length > 0 && (
                        <div style={{ fontSize: 11, color: WA.textMuted }}>
                          别名: {s.aliases.join(', ')}
                        </div>
                      )}
                    </td>
                    <td style={tdStyle}>{s.owner}</td>
                    <td style={tdStyle}>
                      <span style={{
                        padding: '2px 8px', borderRadius: 4, fontSize: 11,
                        background: s.desired_state === 'running' ? `${WA.teal}22` : `${WA.muted}22`,
                        color: s.desired_state === 'running' ? WA.teal : WA.muted,
                      }}>
                        {s.desired_state === 'running' ? '运行' : '停止'}
                      </span>
                    </td>
                    <td style={tdStyle}>
                      <StateBadge
                        desiredState={s.desired_state}
                        runtimeState={s.runtime_state}
                        agent={s.agent}
                      />
                      {s.runtime_phase && (
                        <div style={{ fontSize: 10, color: WA.textMuted, marginTop: 2 }}>
                          phase: {s.runtime_phase}
                        </div>
                      )}
                    </td>
                    <td style={tdStyle}>
                      {s.account_phone || <span style={{ color: WA.textMuted }}>-</span>}
                    </td>
                    <td style={tdStyle}>
                      {formatHeartbeat(s.agent?.last_heartbeat_ms_ago)}
                    </td>
                    <td style={tdStyle}>{s.restart_count || 0}</td>
                    <td style={{ ...tdStyle, maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={s.last_error || ''}>
                      {s.last_error ? (
                        <span style={{ color: WA.danger }}>{s.last_error}</span>
                      ) : (
                        <span style={{ color: WA.textMuted }}>-</span>
                      )}
                    </td>
                    <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>
                      {s.agent?.has_qr || (s.agent && !s.agent.ready && s.desired_state === 'running') ? (
                        <button
                          onClick={() => setScanSessionId(s.session_id)}
                          style={{
                            ...actionBtnStyle,
                            background: WA.teal,
                            color: 'white',
                            border: 'none',
                            fontWeight: 600,
                          }}
                        >
                          扫码登录
                        </button>
                      ) : null}
                      <button
                        onClick={() => handleRestart(s.session_id)}
                        disabled={pending('restart')}
                        style={actionBtnStyle}
                      >
                        {pending('restart') ? '...' : '重启'}
                      </button>
                      {s.desired_state === 'running' ? (
                        <button
                          onClick={() => handleToggleDesired(s.session_id, 'stopped')}
                          disabled={pending('toggle')}
                          style={actionBtnStyle}
                        >
                          停用
                        </button>
                      ) : (
                        <button
                          onClick={() => handleToggleDesired(s.session_id, 'running')}
                          disabled={pending('toggle')}
                          style={actionBtnStyle}
                        >
                          启用
                        </button>
                      )}
                      <button
                        onClick={() => handleDelete(s.session_id)}
                        disabled={pending('delete')}
                        style={{ ...actionBtnStyle, color: WA.danger }}
                      >
                        删除
                      </button>
                    </td>
                  </tr>
                )
              })}
              {sessions.length === 0 && (
                <tr>
                  <td colSpan={9} style={{ padding: 48, textAlign: 'center', color: WA.textMuted }}>
                    暂无账号,点击右上"添加账号"开始
                  </td>
                </tr>
              )}
            </tbody>
          </table>
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

const thStyle = { padding: '10px 12px', textAlign: 'left', fontWeight: 600, color: WA.textMuted, fontSize: 12 }
const tdStyle = { padding: '10px 12px', verticalAlign: 'top' }
const actionBtnStyle = {
  padding: '4px 10px', marginRight: 6, fontSize: 12,
  border: `1px solid ${WA.border}`, background: 'white', borderRadius: 4, cursor: 'pointer',
}

export default AccountsPanel
