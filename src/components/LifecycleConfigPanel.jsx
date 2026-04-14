import React, { useCallback, useEffect, useState } from 'react'
import { fetchJsonOrThrow } from '../utils/api'
import WA from '../utils/waTheme'

const API_BASE = '/api'
const STAGE_LABELS = {
  acquisition: '获取',
  activation: '激活',
  retention: '留存',
  revenue: '收入',
  terminated: '终止池',
}
const CONFLICT_LABELS = {
  agency_bound_not_revenue: '已绑定 Agency 但还未进入 Revenue',
  gmv_outpaces_stage: 'GMV 已领先于当前主阶段',
  churn_not_terminated: '已出现流失信号但未进入终止池',
  referral_without_activation: '已出现推荐信号但主线仍未激活',
}

function buildDefaultDraft() {
  return {
    policy_key: 'lifecycle.aarrr',
    policy_version: 'v1',
    applicable_scenarios_text: 'lifecycle_management',
    is_active: true,
    source: 'default',
    config: {
      revenue_requires_gmv: false,
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
          revenue_requires_gmv: !!data?.config?.revenue_requires_gmv,
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
          revenue_requires_gmv: !!draft.config.revenue_requires_gmv,
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
          revenue_requires_gmv: !!data?.config?.revenue_requires_gmv,
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
  const stageCards = Object.entries(STAGE_LABELS).map(([key, label]) => ({
    key,
    label,
    count: Number(stageCounts?.[key] || 0),
  }))
  const conflictItems = Array.isArray(dashboard?.conflicts) ? dashboard.conflicts.slice(0, 6) : []

  return (
    <div className={embedded ? 'space-y-3' : 'h-full overflow-y-auto p-3 space-y-3'} style={embedded ? undefined : { background: WA.lightBg }}>
      <div className="rounded-xl p-3 space-y-3" style={{ background: WA.white, border: `1px solid ${WA.borderLight}` }}>
        <div className="flex items-center justify-between gap-2">
          <div>
            <div className="text-sm font-semibold" style={{ color: WA.textDark }}>生命周期驾驶舱</div>
            <div className="text-xs" style={{ color: WA.textMuted }}>
              主阶段只认 lifecycle.stage_key，Referral 作为平行徽章展示
            </div>
          </div>
          <button
            onClick={loadDashboard}
            disabled={dashboardLoading}
            className="px-2.5 py-1.5 rounded-lg text-xs"
            style={{ border: `1px solid ${WA.borderLight}`, color: WA.textDark, background: WA.white }}
          >
            {dashboardLoading ? '刷新中...' : '刷新驾驶舱'}
          </button>
        </div>

        {!dashboardLoading && !dashboardError && dashboard?.snapshot_ready === false && (
          <div className="rounded-xl px-3 py-2 text-xs" style={{ background: 'rgba(245,158,11,0.08)', color: '#b45309' }}>
            生命周期快照表尚未准备好，当前只保留规则配置；请先执行 migration 与 lifecycle rebuild。
          </div>
        )}

        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <MetricCard label="总人数" value={dashboard?.total || 0} />
          <MetricCard label="推荐中" value={dashboard?.referral_active_count || 0} tone="teal" />
          <MetricCard label="冲突数" value={dashboard?.conflict_count || 0} tone="red" />
          <MetricCard label="快照状态" value={dashboard?.snapshot_ready === false ? '待初始化' : '已启用'} tone={dashboard?.snapshot_ready === false ? 'amber' : 'default'} />
        </div>

        <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
          {stageCards.map((item) => (
            <MetricCard key={item.key} label={item.label} value={item.count} subtle />
          ))}
        </div>

        <div className="rounded-xl p-3 text-xs space-y-2" style={{ background: WA.lightBg, color: WA.textDark }}>
          <div className="font-semibold" style={{ color: WA.textMuted }}>卡住与冲突</div>
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
            <div className="space-y-2">
              {conflictItems.map((item) => (
                <div
                  key={`${item.creator_id}_${item.evaluated_at || ''}`}
                  className="rounded-xl px-3 py-2"
                  style={{ background: WA.white, border: `1px solid ${WA.borderLight}` }}
                >
                  <div className="text-xs font-semibold" style={{ color: WA.textDark }}>
                    {item.creator_name || `Creator ${item.creator_id}`} · {item.wa_owner || '-'}
                  </div>
                  <div className="text-[11px]" style={{ color: WA.textMuted }}>
                    当前阶段：{item.stage_label || STAGE_LABELS[item.stage_key] || item.stage_key || '-'}
                  </div>
                  <div className="text-[11px]" style={{ color: WA.textDark }}>
                    {(item.conflicts || []).map(formatConflictLabel).join('；')}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="rounded-xl p-3 space-y-3" style={{ background: WA.white, border: `1px solid ${WA.borderLight}` }}>
        <div className="flex items-center justify-between gap-2">
          <div>
            <div className="text-sm font-semibold" style={{ color: WA.textDark }}>生命周期规则配置</div>
            <div className="text-xs" style={{ color: WA.textMuted }}>
              key: {draft.policy_key} | source: {draft.source || 'default'}
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={loadAll}
              disabled={loading}
              className="px-2.5 py-1.5 rounded-lg text-xs"
              style={{ border: `1px solid ${WA.borderLight}`, color: WA.textDark, background: WA.white }}
            >
              {loading ? '加载中...' : '加载'}
            </button>
            <button
              onClick={resetDraft}
              disabled={!loaded || saving}
              className="px-2.5 py-1.5 rounded-lg text-xs"
              style={{ border: `1px solid ${WA.borderLight}`, color: WA.textDark, background: WA.white }}
            >
              重置
            </button>
            <button
              onClick={saveConfig}
              disabled={saving}
              className="px-2.5 py-1.5 rounded-lg text-xs text-white"
              style={{ background: saving ? '#9ca3af' : WA.teal }}
            >
              {saving ? '保存中...' : '保存'}
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <label className="text-xs" style={{ color: WA.textMuted }}>
            policy_version
            <input
              value={draft.policy_version}
              onChange={(e) => setDraft(prev => ({ ...prev, policy_version: e.target.value }))}
              className="mt-1 w-full rounded-lg px-2 py-1.5 text-xs"
              style={{ border: `1px solid ${WA.borderLight}`, background: WA.white, color: WA.textDark }}
            />
          </label>
          <label className="text-xs" style={{ color: WA.textMuted }}>
            applicable_scenarios (逗号分隔)
            <input
              value={draft.applicable_scenarios_text}
              onChange={(e) => setDraft(prev => ({ ...prev, applicable_scenarios_text: e.target.value }))}
              className="mt-1 w-full rounded-lg px-2 py-1.5 text-xs"
              style={{ border: `1px solid ${WA.borderLight}`, background: WA.white, color: WA.textDark }}
            />
          </label>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <label className="flex items-center gap-2 text-xs" style={{ color: WA.textMuted }}>
            <input
              type="checkbox"
              checked={!!draft.is_active}
              onChange={(e) => setDraft(prev => ({ ...prev, is_active: e.target.checked }))}
            />
            启用生命周期规则配置
          </label>
          <label className="flex items-center gap-2 text-xs" style={{ color: WA.textMuted }}>
            <input
              type="checkbox"
              checked={!!draft.config.revenue_requires_gmv}
              onChange={(e) => setDraft(prev => ({
                ...prev,
                config: { ...prev.config, revenue_requires_gmv: e.target.checked },
              }))}
            />
            Revenue 必须校验 GMV 门槛
          </label>
          <label className="text-xs" style={{ color: WA.textMuted }}>
            Revenue GMV Threshold
            <input
              type="number"
              value={String(draft.config.revenue_gmv_threshold ?? 2000)}
              onChange={(e) => setDraft(prev => ({
                ...prev,
                config: { ...prev.config, revenue_gmv_threshold: Number(e.target.value) || 2000 },
              }))}
              className="mt-1 w-full rounded-lg px-2 py-1.5 text-xs"
              style={{ border: `1px solid ${WA.borderLight}`, background: WA.white, color: WA.textDark }}
            />
          </label>
        </div>

        <div className="rounded-xl p-3 text-xs space-y-1" style={{ background: WA.lightBg, color: WA.textMuted }}>
          <div>当前行为说明：</div>
          <div>- `agency_bound` 已固定为 Revenue 主线核心事实，不再作为运营侧开关配置。</div>
          <div>- `revenue_requires_gmv = false`：只要已绑定 agency，即进入 Revenue。</div>
          <div>- `revenue_requires_gmv = true`：需要已绑定 agency 且达到 GMV 门槛才进入 Revenue。</div>
        </div>

        {savedAt && <div className="text-xs" style={{ color: '#10b981' }}>已保存：{savedAt}</div>}
        {error && <div className="text-xs" style={{ color: '#ef4444' }}>错误：{error}</div>}
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
    <div className="rounded-xl px-3 py-2" style={{ background: current.bg, border: `1px solid ${WA.borderLight}` }}>
      <div className="text-[11px]" style={{ color: WA.textMuted }}>{label}</div>
      <div className="text-sm font-semibold" style={{ color: current.color }}>{String(value)}</div>
    </div>
  )
}

function formatConflictLabel(code) {
  return CONFLICT_LABELS[code] || code || '-'
}
