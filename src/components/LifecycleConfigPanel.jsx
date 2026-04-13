import React, { useCallback, useEffect, useState } from 'react'
import { fetchJsonOrThrow } from '../utils/api'
import WA from '../utils/waTheme'

const API_BASE = '/api'

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
      agency_bound_mainline: true,
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
  const [error, setError] = useState('')
  const [savedAt, setSavedAt] = useState('')
  const [loaded, setLoaded] = useState(null)
  const [draft, setDraft] = useState(buildDefaultDraft())

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
          agency_bound_mainline: data?.config?.agency_bound_mainline === undefined ? true : !!data.config.agency_bound_mainline,
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
          agency_bound_mainline: draft.config.agency_bound_mainline === undefined ? true : !!draft.config.agency_bound_mainline,
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
          agency_bound_mainline: data?.config?.agency_bound_mainline === undefined ? payload.config.agency_bound_mainline : !!data.config.agency_bound_mainline,
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
    loadConfig()
  }, [loadConfig])

  return (
    <div className={embedded ? 'space-y-3' : 'h-full overflow-y-auto p-3 space-y-3'} style={embedded ? undefined : { background: WA.lightBg }}>
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
              onClick={loadConfig}
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
              checked={!!draft.config.agency_bound_mainline}
              onChange={(e) => setDraft(prev => ({
                ...prev,
                config: { ...prev.config, agency_bound_mainline: e.target.checked },
              }))}
            />
            Agency 绑定作为主线
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
          <div>- `revenue_requires_gmv = false`：只要已绑定 agency，即进入 Revenue。</div>
          <div>- `revenue_requires_gmv = true`：需要已绑定 agency 且达到 GMV 门槛才进入 Revenue。</div>
        </div>

        {savedAt && <div className="text-xs" style={{ color: '#10b981' }}>已保存：{savedAt}</div>}
        {error && <div className="text-xs" style={{ color: '#ef4444' }}>错误：{error}</div>}
      </div>
    </div>
  )
}
