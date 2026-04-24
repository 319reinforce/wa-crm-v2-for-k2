/**
 * AIProvidersAdminPanel — admin-only AI Provider 配置管理 + Usage 图表
 */
import React, { useState, useEffect, useCallback } from 'react'
import { aiProvidersApi } from '../utils/aiProvidersApi'
import { AIProviderEditDialog } from './AIProviderEditDialog'
import WA from '../utils/waTheme'

const PURPOSES = [
  'reply-generation',
  'profile-analysis',
  'event-verification',
  'memory-extraction',
  'rag-vector',
  'generic-ai',
]

function timeAgo(dateStr) {
  if (!dateStr) return '—'
  const ms = Date.now() - new Date(dateStr).getTime()
  const m = Math.floor(ms / 60000)
  if (m < 1) return '刚刚'
  if (m < 60) return `${m} 分钟前`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h} 小时前`
  const d = Math.floor(h / 24)
  return `${d} 天前`
}

function truncateUrl(url, max = 50) {
  if (!url) return '—'
  return url.length > max ? url.slice(0, max) + '…' : url
}

function SimpleBarChart({ data }) {
  if (!data || data.length === 0) return null
  const maxVal = Math.max(...data.map(d => d.tokens_total || 0), 1)
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 64 }}>
      {data.map((d, i) => {
        const pct = maxVal > 0 ? ((d.tokens_total || 0) / maxVal) * 100 : 0
        const label = d.date ? d.date.slice(5) : `D${i + 1}`
        return (
          <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
            <div
              title={`${d.date || label}: ${d.tokens_total?.toLocaleString() || 0} tokens`}
              style={{
                width: '100%', height: `${Math.max(pct, 2)}%`,
                background: pct > 80 ? WA.teal : pct > 40 ? WA.tealDark : WA.borderLight,
                borderRadius: '3px 3px 0 0',
                minHeight: 2,
              }}
            />
            <span style={{ fontSize: 10, color: WA.textMuted }}>{label}</span>
          </div>
        )
      })}
    </div>
  )
}

function UsagePanel({ purpose }) {
  const [usage, setUsage] = useState(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    aiProvidersApi.usage(purpose, 7, 'day')
      .then(data => { if (!cancelled) setUsage(data) })
      .catch(() => { if (!cancelled) setUsage(null) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [purpose])

  const days = usage?.data || []
  const totalRequests = days.reduce((s, d) => s + (d.request_count || 0), 0)
  const totalTokens = days.reduce((s, d) => s + (d.tokens_total || 0), 0)
  const avgLatency = days.length > 0
    ? Math.round(days.reduce((s, d) => s + (d.avg_latency_ms || 0), 0) / days.length)
    : 0

  return (
    <div style={{
      background: WA.shellPanel, border: `1px solid ${WA.borderLight}`,
      borderRadius: 12, padding: '14px 16px', marginTop: 16,
    }}>
      <div style={{ fontSize: 14, fontWeight: 600, color: WA.textDark, marginBottom: 12 }}>
        近 7 天使用量
      </div>

      {loading ? (
        <div style={{ color: WA.textMuted, fontSize: 13 }}>加载中...</div>
      ) : days.length === 0 ? (
        <div style={{ color: WA.textMuted, fontSize: 13 }}>暂无使用记录</div>
      ) : (
        <div style={{ display: 'flex', gap: 24, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 200px', minWidth: 160 }}>
            <SimpleBarChart data={days} />
          </div>
          <div style={{ display: 'flex', gap: 20, flexShrink: 0 }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 20, fontWeight: 700, color: WA.textDark }}>
                {totalRequests.toLocaleString()}
              </div>
              <div style={{ fontSize: 11, color: WA.textMuted }}>总请求数</div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 20, fontWeight: 700, color: WA.textDark }}>
                {totalTokens.toLocaleString()}
              </div>
              <div style={{ fontSize: 11, color: WA.textMuted }}>总 tokens</div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 20, fontWeight: 700, color: WA.textDark }}>
                {avgLatency}ms
              </div>
              <div style={{ fontSize: 11, color: WA.textMuted }}>平均延迟</div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function DeleteConfirmModal({ provider, onConfirm, onClose }) {
  useEffect(() => {
    if (!onClose) return undefined
    const handler = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  const handleBackdrop = (e) => {
    if (!onClose) return
    if (e.target === e.currentTarget) onClose()
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center"
      style={{ background: 'rgba(31,29,26,0.5)', padding: 16 }}
      onClick={handleBackdrop}>
      <div style={{
        background: WA.white, border: `1px solid ${WA.borderLight}`, borderRadius: 16,
        padding: 24, maxWidth: 360, boxShadow: WA.shellShadow,
      }}>
        <div style={{ fontSize: 16, fontWeight: 600, color: WA.textDark, marginBottom: 8 }}>
          确认删除
        </div>
        <div style={{ fontSize: 14, color: WA.textMuted, marginBottom: 20 }}>
          确定删除配置「<strong>{provider?.name}</strong>」？此操作不可撤销。
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onClose}
            style={{ padding: '7px 14px', border: `1px solid ${WA.borderLight}`, borderRadius: 8, background: WA.white, color: WA.textMuted, cursor: 'pointer' }}>
            取消
          </button>
          <button onClick={onConfirm}
            style={{ padding: '7px 14px', border: 'none', borderRadius: 8, background: '#dc2626', color: 'white', cursor: 'pointer' }}>
            删除
          </button>
        </div>
      </div>
    </div>
  )
}

export function AIProvidersAdminPanel() {
  const [activePurpose, setActivePurpose] = useState(PURPOSES[0])
  const [providers, setProviders] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [editTarget, setEditTarget] = useState(null)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [actionLoading, setActionLoading] = useState(false)
  const [toast, setToast] = useState('')

  const loadProviders = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const data = await aiProvidersApi.list(activePurpose)
      setProviders(data?.data || [])
    } catch (err) {
      setError(err?.body || err?.message || '加载失败')
    } finally {
      setLoading(false)
    }
  }, [activePurpose])

  useEffect(() => { loadProviders() }, [loadProviders])

  function showToast(msg) {
    setToast(msg)
    setTimeout(() => setToast(''), 3000)
  }

  async function handleActivate(provider) {
    setActionLoading(true)
    try {
      await aiProvidersApi.activate(provider.id)
      showToast('已切换为 active')
      loadProviders()
    } catch (err) {
      showToast(err?.body || err?.message || '切换失败')
    } finally {
      setActionLoading(false)
    }
  }

  async function handleDelete(provider) {
    setActionLoading(true)
    try {
      await aiProvidersApi.remove(provider.id)
      showToast('已删除')
      setDeleteTarget(null)
      loadProviders()
    } catch (err) {
      showToast(err?.body || err?.message || '删除失败')
    } finally {
      setActionLoading(false)
    }
  }

  function handleSaved() {
    showToast('保存成功')
    loadProviders()
  }

  function handleActivateAndSaved() {
    showToast('保存并设为 active 成功')
    loadProviders()
  }

  return (
    <div style={{ padding: 16, background: WA.lightBg, minHeight: '100%' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 600, color: WA.textDark }}>AI Providers</div>
          <div style={{ fontSize: 12, color: WA.textMuted, marginTop: 2 }}>管理员专属 · 配置 LLM provider 及查看使用量</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={loadProviders} disabled={loading}
            style={{ padding: '6px 12px', border: `1px solid ${WA.borderLight}`, borderRadius: 6, background: WA.white, cursor: 'pointer', fontSize: 13 }}>
            {loading ? '...' : '刷新'}
          </button>
          <button onClick={() => setShowCreate(true)}
            style={{ padding: '6px 14px', border: 'none', borderRadius: 6, background: WA.teal, color: 'white', cursor: 'pointer', fontSize: 13 }}>
            + 新建配置
          </button>
        </div>
      </div>

      {/* Toast */}
      {toast && (
        <div style={{
          position: 'fixed', top: 16, right: 16, zIndex: 200,
          padding: '10px 16px', background: WA.textDark, color: 'white',
          borderRadius: 8, fontSize: 13, boxShadow: '0 4px 16px rgba(0,0,0,0.15)',
        }}>
          {toast}
        </div>
      )}

      {/* Error banner */}
      {error && (
        <div style={{
          padding: 12, background: '#fef2f2', color: '#dc2626',
          borderRadius: 6, marginBottom: 12, fontSize: 13,
        }}>
          {error}
        </div>
      )}

      {/* Purpose tabs */}
      <div style={{
        display: 'flex', gap: 4, marginBottom: 12, flexWrap: 'wrap',
        borderBottom: `1px solid ${WA.borderLight}`, paddingBottom: 0,
      }}>
        {PURPOSES.map(p => (
          <button
            key={p}
            onClick={() => setActivePurpose(p)}
            style={{
              padding: '6px 14px', border: 'none', borderRadius: '6px 6px 0 0',
              background: activePurpose === p ? WA.teal : 'transparent',
              color: activePurpose === p ? 'white' : WA.textMuted,
              cursor: 'pointer', fontSize: 12, fontWeight: activePurpose === p ? 600 : 400,
              borderBottom: activePurpose === p ? `2px solid ${WA.teal}` : '2px solid transparent',
              marginBottom: -1,
            }}
          >
            {p}
          </button>
        ))}
      </div>

      {/* Table */}
      <div style={{
        background: WA.white, border: `1px solid ${WA.borderLight}`,
        borderRadius: 10, overflow: 'hidden',
      }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: WA.shellBg, color: WA.textMuted }}>
              <th style={{ textAlign: 'left', padding: '9px 12px', fontWeight: 500 }}>配置名</th>
              <th style={{ textAlign: 'left', padding: '9px 12px', fontWeight: 500 }}>模型</th>
              <th style={{ textAlign: 'left', padding: '9px 12px', fontWeight: 500 }}>Base URL</th>
              <th style={{ textAlign: 'left', padding: '9px 12px', fontWeight: 500 }}>API Key</th>
              <th style={{ textAlign: 'center', padding: '9px 12px', fontWeight: 500 }}>Active</th>
              <th style={{ textAlign: 'left', padding: '9px 12px', fontWeight: 500 }}>更新时间</th>
              <th style={{ textAlign: 'right', padding: '9px 12px', fontWeight: 500 }}>操作</th>
            </tr>
          </thead>
          <tbody>
            {loading && providers.length === 0 ? (
              <tr><td colSpan={7} style={{ padding: 24, textAlign: 'center', color: WA.textMuted }}>
                加载中...
              </td></tr>
            ) : providers.length === 0 ? (
              <tr><td colSpan={7} style={{ padding: 24, textAlign: 'center', color: WA.textMuted }}>
                暂无配置，点击右上角新建
              </td></tr>
            ) : providers.map(p => (
              <tr key={p.id} style={{ borderTop: `1px solid ${WA.borderLight}` }}>
                <td style={{ padding: '9px 12px', color: WA.textDark, fontWeight: 500 }}>
                  {p.name}
                </td>
                <td style={{ padding: '9px 12px', color: WA.textDark }}>
                  <code style={{ fontSize: 12, background: WA.shellBg, padding: '1px 5px', borderRadius: 4 }}>
                    {p.model}
                  </code>
                </td>
                <td style={{ padding: '9px 12px', color: WA.textMuted, fontSize: 12 }}>
                  <span title={p.base_url}>{truncateUrl(p.base_url)}</span>
                </td>
                <td style={{ padding: '9px 12px', color: WA.textMuted, fontSize: 12 }}>
                  {p.api_key_preview || p.api_key?.slice(0, 8) + '***' || '—'}
                </td>
                <td style={{ padding: '9px 12px', textAlign: 'center' }}>
                  {p.is_active ? (
                    <span style={{ color: WA.teal, fontSize: 16 }} title="Active">✓</span>
                  ) : (
                    <span style={{ color: WA.borderLight, fontSize: 14 }} title="Inactive">·</span>
                  )}
                </td>
                <td style={{ padding: '9px 12px', color: WA.textMuted, fontSize: 12 }}>
                  {timeAgo(p.updated_at)}
                </td>
                <td style={{ padding: '9px 12px', textAlign: 'right' }}>
                  <button
                    onClick={() => setEditTarget(p)}
                    disabled={actionLoading}
                    style={{
                      padding: '3px 9px', marginRight: 5, border: `1px solid ${WA.borderLight}`,
                      borderRadius: 5, background: WA.white, color: WA.textMuted,
                      cursor: 'pointer', fontSize: 12,
                    }}
                  >编辑</button>
                  <button
                    onClick={() => handleActivate(p)}
                    disabled={actionLoading || !!p.is_active}
                    style={{
                      padding: '3px 9px', marginRight: 5, border: `1px solid ${p.is_active ? WA.borderLight : WA.teal}`,
                      borderRadius: 5, background: WA.white,
                      color: p.is_active ? WA.textMuted : WA.teal,
                      cursor: p.is_active ? 'default' : 'pointer', fontSize: 12,
                    }}
                  >切 active</button>
                  <button
                    onClick={() => setDeleteTarget(p)}
                    disabled={actionLoading}
                    style={{
                      padding: '3px 9px', border: `1px solid ${WA.borderLight}`,
                      borderRadius: 5, background: WA.white, color: '#dc2626',
                      cursor: 'pointer', fontSize: 12,
                    }}
                  >删除</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Usage panel */}
      <UsagePanel key={activePurpose} purpose={activePurpose} />

      {/* Create dialog */}
      {showCreate && (
        <AIProviderEditDialog
          mode="create"
          initial={{ purpose: activePurpose }}
          onClose={() => setShowCreate(false)}
          onSaved={handleSaved}
          onActivateAndSaved={handleActivateAndSaved}
        />
      )}

      {/* Edit dialog */}
      {editTarget && (
        <AIProviderEditDialog
          mode="edit"
          initial={editTarget}
          onClose={() => setEditTarget(null)}
          onSaved={handleSaved}
          onActivateAndSaved={handleActivateAndSaved}
        />
      )}

      {/* Delete confirm */}
      {deleteTarget && (
        <DeleteConfirmModal
          provider={deleteTarget}
          onConfirm={() => handleDelete(deleteTarget)}
          onClose={() => setDeleteTarget(null)}
        />
      )}
    </div>
  )
}

export default AIProvidersAdminPanel
