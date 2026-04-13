import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { fetchJsonOrThrow } from '../utils/api'
import { normalizeUnboundAgencyStrategies } from '../utils/unboundAgencyStrategies'
import WA from '../utils/waTheme'

const API_BASE = '/api'

function toDraftStrategy(item) {
  return {
    id: item.id || '',
    name: item.name || '',
    name_en: item.nameEn || '',
    short_desc: item.shortDesc || '',
    memory_key: item.memoryKey || '',
    memory_value: item.memoryValue || '',
    next_action_template: item.nextActionTemplate || '',
    next_action_template_en: item.nextActionTemplateEn || '',
    prompt_hint: item.promptHint || '',
    prompt_hint_en: item.promptHintEn || '',
    aliases_text: Array.isArray(item.aliases) ? item.aliases.join(', ') : '',
    priority: Number.isFinite(Number(item.priority)) ? Number(item.priority) : 0,
  }
}

function normalizeCommaText(text) {
  return String(text || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

function buildPutPayload(draft) {
  return {
    policy_version: String(draft.policy_version || 'v1').trim() || 'v1',
    applicable_scenarios: normalizeCommaText(draft.applicable_scenarios_text),
    is_active: draft.is_active ? 1 : 0,
    strategies: (draft.strategies || []).map((item) => ({
      id: String(item.id || '').trim(),
      name: String(item.name || '').trim(),
      name_en: String(item.name_en || '').trim(),
      short_desc: String(item.short_desc || '').trim(),
      memory_key: String(item.memory_key || '').trim(),
      memory_value: String(item.memory_value || '').trim(),
      next_action_template: String(item.next_action_template || '').trim(),
      next_action_template_en: String(item.next_action_template_en || '').trim(),
      prompt_hint: String(item.prompt_hint || '').trim(),
      prompt_hint_en: String(item.prompt_hint_en || '').trim(),
      aliases: normalizeCommaText(item.aliases_text),
      priority: Number(item.priority) || 0,
    })),
  }
}

function emptyDraftStrategy() {
  return {
    id: '',
    name: '',
    name_en: '',
    short_desc: '',
    memory_key: '',
    memory_value: '',
    next_action_template: '',
    next_action_template_en: '',
    prompt_hint: '',
    prompt_hint_en: '',
    aliases_text: '',
    priority: 0,
  }
}

export function StrategyConfigPanel() {
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [savedAt, setSavedAt] = useState('')
  const [loaded, setLoaded] = useState(null)
  const [draft, setDraft] = useState({
    policy_key: 'strategy.unbound_agency',
    policy_version: 'v1',
    applicable_scenarios_text: 'mcn_binding, follow_up',
    is_active: true,
    source: 'default',
    strategies: [],
  })

  const loadConfig = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const data = await fetchJsonOrThrow(`${API_BASE}/strategy-config/unbound-agency`)
      const normalized = normalizeUnboundAgencyStrategies(data?.strategies || [])
      const next = {
        policy_key: data?.policy_key || 'strategy.unbound_agency',
        policy_version: data?.policy_version || 'v1',
        applicable_scenarios_text: Array.isArray(data?.applicable_scenarios) ? data.applicable_scenarios.join(', ') : '',
        is_active: true,
        source: data?.source || 'default',
        updated_at: data?.updated_at || null,
        strategies: normalized.map(toDraftStrategy),
      }
      setLoaded(next)
      setDraft(next)
    } catch (e) {
      setError(e.message || '加载配置失败')
    } finally {
      setLoading(false)
    }
  }, [])

  const resetDraft = useCallback(() => {
    if (!loaded) return
    setDraft(loaded)
    setError('')
  }, [loaded])

  const validate = useMemo(() => {
    const list = draft.strategies || []
    if (list.length ***REMOVED***= 0) return '至少保留一条策略'
    const ids = new Set()
    const keys = new Set()
    for (const item of list) {
      if (!item.id || !item.name || !item.memory_key) return '每条策略必须填写 id / 名称 / memory_key'
      if (ids.has(item.id)) return `策略 id 重复: ${item.id}`
      if (keys.has(item.memory_key)) return `memory_key 重复: ${item.memory_key}`
      ids.add(item.id)
      keys.add(item.memory_key)
    }
    return ''
  }, [draft.strategies])

  const saveConfig = useCallback(async () => {
    const validationError = validate
    if (validationError) {
      setError(validationError)
      return
    }
    setSaving(true)
    setError('')
    try {
      const payload = buildPutPayload(draft)
      const data = await fetchJsonOrThrow(`${API_BASE}/strategy-config/unbound-agency`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      setSavedAt(new Date().toLocaleString('zh-CN'))
      const normalized = normalizeUnboundAgencyStrategies(data?.strategies || [])
      const next = {
        ...draft,
        policy_version: data?.policy_version || draft.policy_version,
        strategies: normalized.map(toDraftStrategy),
        source: 'db',
      }
      setDraft(next)
      setLoaded(next)
    } catch (e) {
      setError(e.message || '保存失败')
    } finally {
      setSaving(false)
    }
  }, [draft, validate])

  const updateStrategy = useCallback((index, key, value) => {
    setDraft((prev) => {
      const next = { ...prev, strategies: [...prev.strategies] }
      next.strategies[index] = { ...next.strategies[index], [key]: value }
      return next
    })
  }, [])

  const addStrategy = useCallback(() => {
    setDraft((prev) => ({ ...prev, strategies: [...(prev.strategies || []), emptyDraftStrategy()] }))
  }, [])

  const removeStrategy = useCallback((index) => {
    setDraft((prev) => {
      const next = { ...prev, strategies: [...(prev.strategies || [])] }
      next.strategies.splice(index, 1)
      return next
    })
  }, [])

  useEffect(() => {
    loadConfig()
  }, [loadConfig])

  return (
    <div className="h-full overflow-y-auto p-3 space-y-3" style={{ background: WA.lightBg }}>
      <div className="rounded-xl p-3 space-y-2" style={{ background: WA.white, border: `1px solid ${WA.borderLight}` }}>
        <div className="flex items-center justify-between gap-2">
          <div>
            <div className="text-sm font-semibold" style={{ color: WA.textDark }}>未绑定Agency策略配置</div>
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
              disabled={saving || !!validate}
              className="px-2.5 py-1.5 rounded-lg text-xs text-white"
              style={{ background: saving ? '#9ca3af' : WA.teal }}
            >
              {saving ? '保存中...' : '保存'}
            </button>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-2">
          <label className="text-xs" style={{ color: WA.textMuted }}>
            policy_version
            <input
              value={draft.policy_version}
              onChange={(e) => setDraft((prev) => ({ ...prev, policy_version: e.target.value }))}
              className="mt-1 w-full rounded-lg px-2 py-1.5 text-xs"
              style={{ border: `1px solid ${WA.borderLight}`, background: WA.white, color: WA.textDark }}
            />
          </label>
          <label className="text-xs" style={{ color: WA.textMuted }}>
            applicable_scenarios (逗号分隔)
            <input
              value={draft.applicable_scenarios_text}
              onChange={(e) => setDraft((prev) => ({ ...prev, applicable_scenarios_text: e.target.value }))}
              className="mt-1 w-full rounded-lg px-2 py-1.5 text-xs"
              style={{ border: `1px solid ${WA.borderLight}`, background: WA.white, color: WA.textDark }}
            />
          </label>
        </div>
        {savedAt && <div className="text-xs" style={{ color: '#10b981' }}>已保存：{savedAt}</div>}
        {validate && <div className="text-xs" style={{ color: '#ef4444' }}>校验：{validate}</div>}
        {error && <div className="text-xs" style={{ color: '#ef4444' }}>错误：{error}</div>}
      </div>

      <div className="flex items-center justify-between">
        <div className="text-xs font-semibold" style={{ color: WA.textMuted }}>策略列表（{draft.strategies.length}）</div>
        <button
          onClick={addStrategy}
          className="px-2 py-1 rounded-lg text-xs"
          style={{ border: `1px solid ${WA.borderLight}`, background: WA.white, color: WA.textDark }}
        >
          + 新增策略
        </button>
      </div>

      {draft.strategies.map((item, idx) => (
        <div key={`${item.id || 'new'}_${idx}`} className="rounded-xl p-3 space-y-2" style={{ background: WA.white, border: `1px solid ${WA.borderLight}` }}>
          <div className="flex items-center justify-between">
            <div className="text-xs font-semibold" style={{ color: WA.textDark }}>策略 #{idx + 1}</div>
            <button
              onClick={() => removeStrategy(idx)}
              disabled={draft.strategies.length <= 1}
              className="px-2 py-1 rounded-lg text-xs"
              style={{ border: `1px solid ${WA.borderLight}`, background: WA.white, color: '#ef4444' }}
            >
              删除
            </button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <SmallInput label="id" value={item.id} onChange={(v) => updateStrategy(idx, 'id', v)} />
            <SmallInput label="priority" value={String(item.priority)} onChange={(v) => updateStrategy(idx, 'priority', Number(v) || 0)} />
            <SmallInput label="name" value={item.name} onChange={(v) => updateStrategy(idx, 'name', v)} />
            <SmallInput label="name_en" value={item.name_en} onChange={(v) => updateStrategy(idx, 'name_en', v)} />
            <SmallInput label="memory_key" value={item.memory_key} onChange={(v) => updateStrategy(idx, 'memory_key', v)} />
            <SmallInput label="aliases(逗号)" value={item.aliases_text} onChange={(v) => updateStrategy(idx, 'aliases_text', v)} />
          </div>
          <SmallTextarea label="short_desc" value={item.short_desc} onChange={(v) => updateStrategy(idx, 'short_desc', v)} />
          <SmallTextarea label="memory_value" value={item.memory_value} onChange={(v) => updateStrategy(idx, 'memory_value', v)} />
          <SmallTextarea label="next_action_template" value={item.next_action_template} onChange={(v) => updateStrategy(idx, 'next_action_template', v)} />
          <SmallTextarea label="next_action_template_en" value={item.next_action_template_en} onChange={(v) => updateStrategy(idx, 'next_action_template_en', v)} />
          <SmallTextarea label="prompt_hint" value={item.prompt_hint} onChange={(v) => updateStrategy(idx, 'prompt_hint', v)} />
          <SmallTextarea label="prompt_hint_en" value={item.prompt_hint_en} onChange={(v) => updateStrategy(idx, 'prompt_hint_en', v)} />
        </div>
      ))}
    </div>
  )
}

function SmallInput({ label, value, onChange }) {
  return (
    <label className="text-xs" style={{ color: WA.textMuted }}>
      {label}
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-lg px-2 py-1.5 text-xs"
        style={{ border: `1px solid ${WA.borderLight}`, background: WA.white, color: WA.textDark }}
      />
    </label>
  )
}

function SmallTextarea({ label, value, onChange }) {
  return (
    <label className="text-xs block" style={{ color: WA.textMuted }}>
      {label}
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={3}
        className="mt-1 w-full rounded-lg px-2 py-1.5 text-xs resize-y"
        style={{ border: `1px solid ${WA.borderLight}`, background: WA.white, color: WA.textDark }}
      />
    </label>
  )
}
