import React, { useCallback, useEffect, useState } from 'react'
import { fetchJsonOrThrow } from '../utils/api'
import WA from '../utils/waTheme'

const API_BASE = '/api'
const STAGE_LABELS = {
  acquisition: '获取',
  activation: '激活',
  retention: '留存',
  revenue: '变现',
  terminated: '终止池',
}
const CONFLICT_LABELS = {
  mainline_without_wa_channel: '尚未进入 WA 渠道，但已被放入生命周期主线',
  completed_trial_not_activated: '7日挑战已完成，但主线还未进入激活',
  agency_bound_not_retention: '已绑定 Agency，但主线还未进入留存/变现',
  gmv_not_revenue: 'GMV 已达门槛，但主线还未进入变现',
  churn_not_terminated: '已出现流失信号但未进入终止池',
  referral_without_wa_join: '已出现推荐信号，但仍未确认进入 WA 渠道',
}

function buildDefaultDraft() {
  return {
    policy_key: 'lifecycle.aarrr',
    policy_version: 'v1',
    applicable_scenarios_text: 'lifecycle_management',
    is_active: true,
    source: 'default',
    config: {
      revenue_requires_gmv: true,
      revenue_gmv_threshold: 2000,
    },
  }
}

function normalizeCommaText(text) {
  return String(text || '')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean)
}

export function LifecycleConfigPanel({ embedded = false }) {
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [dashboardLoading, setDashboardLoading] = useState(false)
  const [error, setError] = useState('')
  const [dashboardError, setDashboardError] = useState('')
  const [savedAt, setSavedAt] = useState('')
  const [loaded, setLoaded] = useState(null)
  const [draft, setDraft] = useState(buildDefaultDraft())
  const [dashboard, setDashboard] = useState(null)

  const loadConfig = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const data = await fetchJsonOrThrow(`${API_BASE}/lifecycle-config`)
      const next = {
        policy_key: data?.policy_key || 'lifecycle.aarrr',
        policy_version: data?.policy_version || 'v1',
        applicable_scenarios_text: Array.isArray(data?.applicable_scenarios) ? data.applicable_scenarios.join(', ') : 'lifecycle_management',
        is_active: data?.is_active === undefined ? true : !!data.is_active,
        source: data?.source || 'default',
        updated_at: data?.updated_at || null,
        config: {
          revenue_requires_gmv: true,
          revenue_gmv_threshold: Number(data?.config?.revenue_gmv_threshold) || 2000,
        },
      }
      setLoaded(next)
      setDraft(next)
    } catch (e) {
      setError(e.message || '加载生命周期配置失败')
    } finally {
      setLoading(false)
    }
  }, [])

  const loadDashboard = useCallback(async () => {
    setDashboardLoading(true)
    setDashboardError('')
    try {
      const data = await fetchJsonOrThrow(`${API_BASE}/lifecycle/dashboard`)
      setDashboard(data || null)
    } catch (e) {
      setDashboardError(e.message || '加载生命周期驾驶舱失败')
    } finally {
      setDashboardLoading(false)
    }
  }, [])

  const loadAll = useCallback(async () => {
    await Promise.all([loadConfig(), loadDashboard()])
  }, [loadConfig, loadDashboard])

  const resetDraft = useCallback(() => {
    if (!loaded) return
    setDraft(loaded)
    setError('')
  }, [loaded])

  const saveConfig = useCallback(async () => {
    setSaving(true)
    setError('')
    try {
      const payload = {
        policy_version: String(draft.policy_version || 'v1').trim() || 'v1',
        applicable_scenarios: normalizeCommaText(draft.applicable_scenarios_text),
        is_active: draft.is_active ? 1 : 0,
        config: {
          revenue_requires_gmv: true,
          revenue_gmv_threshold: Number(draft.config.revenue_gmv_threshold) || 2000,
        },
      }
      const data = await fetchJsonOrThrow(`${API_BASE}/lifecycle-config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const next = {
        ...draft,
        policy_version: data?.policy_version || payload.policy_version,
        is_active: data?.is_active === undefined ? draft.is_active : !!data.is_active,
        source: 'db',
        config: {
          revenue_requires_gmv: true,
          revenue_gmv_threshold: Number(data?.config?.revenue_gmv_threshold) || payload.config.revenue_gmv_threshold,
        },
      }
      setDraft(next)
      setLoaded(next)
      setSavedAt(new Date().toLocaleString('zh-CN'))
    } catch (e) {
      setError(e.message || '保存生命周期配置失败')
    } finally {
      setSaving(false)
    }
  }, [draft])

  useEffect(() => {
    loadAll()
  }, [loadAll])

  const stageCounts = dashboard?.stage_counts || {}
  const funnelCounts = dashboard?.funnel_counts || {}
  const stageCards = [
    { key: 'acquisition', label: STAGE_LABELS.acquisition, count: Number(funnelCounts?.acquisition || stageCounts?.acquisition || 0) },
    { key: 'activation', label: STAGE_LABELS.activation, count: Number(funnelCounts?.activation || stageCounts?.activation || 0) },
    { key: 'retention', label: STAGE_LABELS.retention, count: Number(funnelCounts?.retention || stageCounts?.retention || 0) },
    { key: 'revenue', label: STAGE_LABELS.revenue, count: Number(funnelCounts?.revenue || stageCounts?.revenue || 0) },
    { key: 'terminated', label: '终止池（当前）', count: Number(dashboard?.terminated_count || stageCounts?.terminated || 0) },
  ]
  const conflictItems = Array.isArray(dashboard?.conflicts) ? dashboard.conflicts.slice(0, 6) : []

  return (
    <div className={embedded ? 'space-y-4' : 'h-full overflow-y-auto p-4 space-y-4'} style={embedded ? undefined : { background: WA.lightBg }}>
      <div className="rounded-[20px] md:rounded-[24px] p-4 md:p-5 space-y-4" style={{ background: WA.white, border: `1px solid ${WA.borderLight}` }}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-[18px] md:text-[20px] font-semibold tracking-[-0.03em]" style={{ color: WA.textDark }}>生命周期驾驶舱</div>
            <div className="text-[12px] md:text-[13px] mt-1" style={{ color: WA.textMuted }}>
              主阶段只认 lifecycle.stage_key；下方人数按累计漏斗展示，Referral 作为平行徽章展示
            </div>
          </div>
          <button
            onClick={loadDashboard}
            disabled={dashboardLoading}
            className="rounded-full text-[12px] font-semibold whitespace-nowrap shrink-0"
            style={{ minHeight: 40, padding: '0 14px', border: `1px solid ${WA.borderLight}`, color: WA.textDark, background: WA.white }}
          >
            {dashboardLoading ? '刷新中…' : '刷新驾驶舱'}
          </button>
        </div>

        {!dashboardLoading && !dashboardError && dashboard?.snapshot_ready === false && (
          <div className="rounded-[18px] px-4 py-3 text-[13px]" style={{ background: 'rgba(245,158,11,0.08)', color: '#b45309' }}>
            生命周期快照表尚未准备好，当前只保留规则配置；请先执行 migration 与 lifecycle rebuild。
          </div>
        )}

        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <MetricCard label="总人数" value={dashboard?.total || 0} />
          <MetricCard label="已入WA" value={dashboard?.wa_joined_count || 0} tone="default" />
          <MetricCard label="推荐中" value={dashboard?.referral_active_count || 0} tone="teal" />
          <MetricCard label="冲突数" value={dashboard?.conflict_count || 0} tone="red" />
          <MetricCard label="快照状态" value={dashboard?.snapshot_ready === false ? '待初始化' : '已启用'} tone={dashboard?.snapshot_ready === false ? 'amber' : 'default'} />
        </div>

        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {stageCards.map((item) => (
            <MetricCard key={item.key} label={item.label} value={item.count} subtle />
          ))}
        </div>
        <div className="text-[12px]" style={{ color: WA.textMuted }}>
          获取/激活/留存/变现为累计到达人数；终止池仍显示当前阶段人数。
        </div>

        <div className="rounded-[20px] p-4 text-[13px] space-y-3" style={{ background: WA.lightBg, color: WA.textDark }}>
          <div className="font-semibold tracking-[0.08em] uppercase" style={{ color: WA.textMuted }}>卡住与冲突</div>
          {dashboardLoading && (
            <div style={{ color: WA.textMuted }}>加载中...</div>
          )}
          {!dashboardLoading && dashboardError && (
            <div style={{ color: '#ef4444' }}>错误：{dashboardError}</div>
          )}
          {!dashboardLoading && !dashboardError && conflictItems.length === 0 && (
            <div style={{ color: WA.textMuted }}>当前没有检测到生命周期冲突。</div>
          )}
          {!dashboardLoading && !dashboardError && conflictItems.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {conflictItems.map((item) => (
                <div
                  key={`${item.creator_id}_${item.evaluated_at || ''}`}
                  className="rounded-[18px] px-4 py-3"
                  style={{ background: WA.white, border: `1px solid ${WA.borderLight}` }}
                >
                  <div className="text-[13px] font-semibold" style={{ color: WA.textDark }}>
                    {item.creator_name || `Creator ${item.creator_id}`} · {item.wa_owner || '-'}
                  </div>
                  <div className="text-[12px] mt-1" style={{ color: WA.textMuted }}>
                    当前阶段：{item.stage_label || STAGE_LABELS[item.stage_key] || item.stage_key || '-'}
                  </div>
                  <div className="text-[13px] mt-2 leading-6" style={{ color: WA.textDark }}>
                    {(item.conflicts || []).map(formatConflictLabel).join('；')}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="rounded-[24px] p-5 space-y-4" style={{ background: WA.white, border: `1px solid ${WA.borderLight}` }}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-[18px] md:text-[20px] font-semibold tracking-[-0.03em]" style={{ color: WA.textDark }}>生命周期规则配置</div>
            <div className="text-[12px] md:text-[13px] mt-1 truncate" style={{ color: WA.textMuted }}>
              key: {draft.policy_key} | source: {draft.source || 'default'}
            </div>
          </div>
          <div className="flex flex-wrap gap-2 shrink-0">
            <button
              onClick={loadAll}
              disabled={loading}
              className="rounded-full text-[12px] font-semibold whitespace-nowrap"
              style={{ minHeight: 40, padding: '0 14px', border: `1px solid ${WA.borderLight}`, color: WA.textDark, background: WA.white }}
            >
              {loading ? '加载中…' : '加载'}
            </button>
            <button
              onClick={resetDraft}
              disabled={!loaded || saving}
              className="rounded-full text-[12px] font-semibold whitespace-nowrap"
              style={{ minHeight: 40, padding: '0 14px', border: `1px solid ${WA.borderLight}`, color: WA.textDark, background: WA.white }}
            >
              重置
            </button>
            <button
              onClick={saveConfig}
              disabled={saving}
              className="rounded-full text-[12px] font-semibold text-white whitespace-nowrap"
              style={{ minHeight: 40, padding: '0 16px', background: saving ? '#9ca3af' : WA.teal }}
            >
              {saving ? '保存中…' : '保存'}
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <label className="text-[12px]" style={{ color: WA.textMuted }}>
            policy_version
            <input
              value={draft.policy_version}
              onChange={(e) => setDraft(prev => ({ ...prev, policy_version: e.target.value }))}
              className="mt-2 w-full rounded-[18px] px-3 py-2.5 text-[14px]"
              style={{ border: `1px solid ${WA.borderLight}`, background: WA.white, color: WA.textDark }}
            />
          </label>
          <label className="text-[12px]" style={{ color: WA.textMuted }}>
            applicable_scenarios (逗号分隔)
            <input
              value={draft.applicable_scenarios_text}
              onChange={(e) => setDraft(prev => ({ ...prev, applicable_scenarios_text: e.target.value }))}
              className="mt-2 w-full rounded-[18px] px-3 py-2.5 text-[14px]"
              style={{ border: `1px solid ${WA.borderLight}`, background: WA.white, color: WA.textDark }}
            />
          </label>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <label className="flex items-center gap-2 text-[12px]" style={{ color: WA.textMuted }}>
            <input
              type="checkbox"
              checked={!!draft.is_active}
              onChange={(e) => setDraft(prev => ({ ...prev, is_active: e.target.checked }))}
            />
            启用生命周期规则配置
          </label>
          <label className="text-[12px]" style={{ color: WA.textMuted }}>
            Revenue GMV Threshold
            <input
              type="number"
              value={String(draft.config.revenue_gmv_threshold ?? 2000)}
              onChange={(e) => setDraft(prev => ({
                ...prev,
                config: { ...prev.config, revenue_gmv_threshold: Number(e.target.value) || 2000 },
              }))}
              className="mt-2 w-full rounded-[18px] px-3 py-2.5 text-[14px]"
              style={{ border: `1px solid ${WA.borderLight}`, background: WA.white, color: WA.textDark }}
            />
          </label>
        </div>

        <div className="rounded-[20px] p-4 text-[13px] space-y-2 leading-6" style={{ background: WA.lightBg, color: WA.textMuted }}>
          <div>当前行为说明：</div>
          <div>- 获取：以 WA 渠道实际进入为准，不再用默认兜底当作获取。</div>
          <div>- 激活：完成 7 日挑战即进入 Activation；已绑定 agency 也视为已激活。</div>
          <div>- 留存：Agency 绑定是留存关键动作。</div>
          <div>- 变现：固定要求 GMV 达到门槛，不再暴露“关闭 GMV 校验”的旧开关。</div>
        </div>

        {savedAt && <div className="text-[12px]" style={{ color: '#10b981' }}>已保存：{savedAt}</div>}
        {error && <div className="text-[12px]" style={{ color: '#ef4444' }}>错误：{error}</div>}
      </div>
    </div>
  )
}

function MetricCard({ label, value, tone = 'default', subtle = false }) {
  const styles = {
    default: { bg: subtle ? WA.white : WA.lightBg, color: WA.textDark },
    teal: { bg: 'rgba(0,168,132,0.10)', color: WA.teal },
    red: { bg: 'rgba(239,68,68,0.10)', color: '#dc2626' },
    amber: { bg: 'rgba(245,158,11,0.12)', color: '#b45309' },
  }
  const current = styles[tone] || styles.default
  return (
    <div className="rounded-[18px] px-4 py-3" style={{ background: current.bg, border: `1px solid ${WA.borderLight}` }}>
      <div className="text-[11px] font-semibold tracking-[0.08em] uppercase" style={{ color: WA.textMuted }}>{label}</div>
      <div className="text-[18px] mt-1 font-semibold tracking-[-0.02em]" style={{ color: current.color }}>{String(value)}</div>
    </div>
  )
}

function formatConflictLabel(code) {
  if (code && typeof code === 'object') {
    const message = code.message || code.detail || code.reason
    if (message) return String(message)
    const conflictCode = code.code || code.key || code.type
    if (conflictCode) return CONFLICT_LABELS[conflictCode] || String(conflictCode)
    try {
      return JSON.stringify(code)
    } catch (_) {
      return '[冲突对象]'
    }
  }
  return CONFLICT_LABELS[code] || code || '-'
}
