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

export function StrategyConfigPanel({ embedded = false }) {
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
        is_active: data?.is_active === undefined ? true : !!data.is_active,
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
    if (list.length === 0) return '至少保留一条策略'
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
    <div className={embedded ? 'space-y-4' : 'h-full overflow-y-auto p-4 space-y-4'} style={embedded ? undefined : { background: WA.lightBg }}>
      <div className="grid grid-cols-1 gap-4">
        <BoardSection
          title="未绑定 Agency 策略配置"
          subtitle={`key: ${draft.policy_key} · source: ${draft.source || 'default'}`}
          action={(
            <div className="flex gap-2 flex-wrap">
              <button
                onClick={loadConfig}
                disabled={loading}
                className="px-3 py-1.5 rounded-full text-[12px] font-medium"
                style={{ border: `1px solid ${WA.borderLight}`, color: WA.textDark, background: WA.white }}
              >
                {loading ? '加载中...' : '加载'}
              </button>
              <button
                onClick={resetDraft}
                disabled={!loaded || saving}
                className="px-3 py-1.5 rounded-full text-[12px] font-medium"
                style={{ border: `1px solid ${WA.borderLight}`, color: WA.textDark, background: WA.white }}
              >
                重置
              </button>
              <button
                onClick={saveConfig}
                disabled={saving || !!validate}
                className="px-3 py-1.5 rounded-full text-[12px] font-medium text-white"
                style={{ background: saving ? '#9ca3af' : WA.teal }}
              >
                {saving ? '保存中...' : '保存'}
              </button>
            </div>
          )}
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="rounded-[20px] p-4 space-y-4" style={{ background: WA.shellPanelMuted, border: `1px solid ${WA.borderLight}` }}>
              <div className="text-[12px] font-semibold tracking-[0.08em] uppercase" style={{ color: WA.textMuted }}>Policy Meta</div>
              <BoardInput label="policy_version" value={draft.policy_version} onChange={(v) => setDraft((prev) => ({ ...prev, policy_version: v }))} />
              <BoardInput label="applicable_scenarios" value={draft.applicable_scenarios_text} onChange={(v) => setDraft((prev) => ({ ...prev, applicable_scenarios_text: v }))} />
              <label className="flex items-center gap-2 text-[12px]" style={{ color: WA.textMuted }}>
                <input
                  type="checkbox"
                  checked={!!draft.is_active}
                  onChange={(e) => setDraft((prev) => ({ ...prev, is_active: e.target.checked }))}
                />
                启用策略（灰度或临时关闭时可取消勾选）
              </label>
            </div>

            <div className="rounded-[20px] p-4 space-y-3" style={{ background: WA.shellPanelMuted, border: `1px solid ${WA.borderLight}` }}>
              <div className="text-[12px] font-semibold tracking-[0.08em] uppercase" style={{ color: WA.textMuted }}>Board Status</div>
              <MetaPill label="策略数" value={`${draft.strategies.length} 条`} />
              {savedAt && <MetaPill label="最近保存" value={savedAt} tone="success" />}
              {validate && <MetaPill label="校验" value={validate} tone="danger" />}
              {error && <MetaPill label="错误" value={error} tone="danger" />}
              {!savedAt && !validate && !error && (
                <div className="text-[13px] leading-6" style={{ color: WA.textMuted }}>
                  每张策略卡独立维护 ID、短描述、记忆值、下一步模板和 prompt hint，减少整页长表单的阅读负担。
                </div>
              )}
            </div>
          </div>
        </BoardSection>

        <div className="flex items-center justify-between">
          <div className="text-[12px] font-semibold tracking-[0.08em] uppercase" style={{ color: WA.textMuted }}>
            策略列表（{draft.strategies.length}）
          </div>
          <button
            onClick={addStrategy}
            className="px-3 py-1.5 rounded-full text-[12px] font-medium"
            style={{ border: `1px solid ${WA.borderLight}`, background: WA.white, color: WA.textDark }}
          >
            + 新增策略
          </button>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          {draft.strategies.map((item, idx) => (
            <BoardSection
              key={`${item.id || 'new'}_${idx}`}
              title={item.name || `策略 #${idx + 1}`}
              subtitle={`${item.name_en || '未命名英文名'} · priority ${item.priority || 0}`}
              action={(
                <button
                  onClick={() => removeStrategy(idx)}
                  disabled={draft.strategies.length <= 1}
                  className="px-3 py-1.5 rounded-full text-[12px] font-medium"
                  style={{ border: `1px solid ${WA.borderLight}`, background: WA.white, color: '#ef4444' }}
                >
                  删除
                </button>
              )}
            >
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <BoardInput label="id" value={item.id} onChange={(v) => updateStrategy(idx, 'id', v)} />
                <BoardInput label="priority" value={String(item.priority)} onChange={(v) => updateStrategy(idx, 'priority', Number(v) || 0)} />
                <BoardInput label="name" value={item.name} onChange={(v) => updateStrategy(idx, 'name', v)} />
                <BoardInput label="name_en" value={item.name_en} onChange={(v) => updateStrategy(idx, 'name_en', v)} />
                <BoardInput label="memory_key" value={item.memory_key} onChange={(v) => updateStrategy(idx, 'memory_key', v)} />
                <BoardInput label="aliases (逗号)" value={item.aliases_text} onChange={(v) => updateStrategy(idx, 'aliases_text', v)} />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <BoardTextarea label="short_desc" value={item.short_desc} onChange={(v) => updateStrategy(idx, 'short_desc', v)} rows={4} />
                <BoardTextarea label="memory_value" value={item.memory_value} onChange={(v) => updateStrategy(idx, 'memory_value', v)} rows={6} />
                <BoardTextarea label="next_action_template" value={item.next_action_template} onChange={(v) => updateStrategy(idx, 'next_action_template', v)} rows={5} />
                <BoardTextarea label="next_action_template_en" value={item.next_action_template_en} onChange={(v) => updateStrategy(idx, 'next_action_template_en', v)} rows={5} />
                <BoardTextarea label="prompt_hint" value={item.prompt_hint} onChange={(v) => updateStrategy(idx, 'prompt_hint', v)} rows={4} />
                <BoardTextarea label="prompt_hint_en" value={item.prompt_hint_en} onChange={(v) => updateStrategy(idx, 'prompt_hint_en', v)} rows={4} />
              </div>
            </BoardSection>
          ))}
        </div>
      </div>
    </div>
  )
}

function BoardSection({ title, subtitle, action, children }) {
  return (
    <section className="rounded-[24px] p-5 space-y-4" style={{ background: WA.white, border: `1px solid ${WA.borderLight}` }}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-[20px] font-semibold tracking-[-0.03em]" style={{ color: WA.textDark }}>{title}</div>
          {subtitle ? <div className="text-[13px] mt-1" style={{ color: WA.textMuted }}>{subtitle}</div> : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  )
}

function BoardInput({ label, value, onChange }) {
  return (
    <label className="block text-[12px] space-y-2" style={{ color: WA.textMuted }}>
      <span className="font-semibold tracking-[0.04em]">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-[18px] px-3 py-2.5 text-[14px]"
        style={{ border: `1px solid ${WA.borderLight}`, background: WA.white, color: WA.textDark }}
      />
    </label>
  )
}

function BoardTextarea({ label, value, onChange, rows = 4 }) {
  return (
    <label className="block text-[12px] space-y-2" style={{ color: WA.textMuted }}>
      <span className="font-semibold tracking-[0.04em]">{label}</span>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={rows}
        className="w-full rounded-[18px] px-3 py-3 text-[14px] resize-y leading-6"
        style={{ border: `1px solid ${WA.borderLight}`, background: WA.white, color: WA.textDark }}
      />
    </label>
  )
}

function MetaPill({ label, value, tone = 'default' }) {
  const tones = {
    default: { bg: WA.white, color: WA.textDark },
    success: { bg: 'rgba(16,185,129,0.12)', color: '#0f766e' },
    danger: { bg: 'rgba(239,68,68,0.10)', color: '#dc2626' },
  }
  const current = tones[tone] || tones.default
  return (
    <div className="rounded-[18px] px-3 py-2" style={{ background: current.bg, border: `1px solid ${WA.borderLight}` }}>
      <div className="text-[11px] font-semibold tracking-[0.08em] uppercase" style={{ color: WA.textMuted }}>{label}</div>
      <div className="text-[13px] mt-1 leading-5" style={{ color: current.color }}>{value}</div>
    </div>
  )
}
