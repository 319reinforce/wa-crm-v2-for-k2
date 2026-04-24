/**
 * AIProviderEditDialog — 新建/编辑 AI Provider 配置
 */
import React, { useState, useEffect } from 'react'
import WA from '../utils/waTheme'
import { aiProvidersApi } from '../utils/aiProvidersApi'

const PURPOSE_LABELS = {
  'reply-generation': 'reply-generation',
  'profile-analysis': 'profile-analysis',
  'event-verification': 'event-verification',
  'memory-extraction': 'memory-extraction',
  'rag-vector': 'rag-vector',
  'generic-ai': 'generic-ai',
}

const DEFAULT_EXTRA_PARAMS = { temperature: 0.7, max_tokens: 500 }

function parseJsonSafe(raw) {
  if (!raw || typeof raw === 'object') return raw
  try { return JSON.parse(raw) } catch (_) { return null }
}

function ModalShell({ title, onClose, children, dismissOnBackdrop = true, dismissOnEsc = true }) {
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
        className="w-full rounded-3xl overflow-hidden flex flex-col"
        style={{
          maxWidth: 480,
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
          <div style={{ fontSize: 16, fontWeight: 600, color: WA.textDark }}>{title}</div>
          <button
            onClick={onClose}
            disabled={!onClose}
            className="inline-flex items-center justify-center rounded-full shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
            style={{
              width: 36, height: 36, background: WA.white, color: WA.textMuted,
              border: `1px solid ${WA.borderLight}`, fontSize: 16,
            }}
            aria-label="关闭"
          >✕</button>
        </div>
        <div className="overflow-y-auto p-5" style={{ maxHeight: 'calc(90dvh - 130px)' }}>
          {children}
        </div>
      </div>
    </div>
  )
}

function Field({ label, required, children }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <label style={{ display: 'block', marginBottom: 6 }}>
        <span style={{ fontSize: 13, color: WA.textMuted, fontWeight: 500 }}>
          {label}{required && <span style={{ color: WA.teal, marginLeft: 3 }}>*</span>}
        </span>
      </label>
      {children}
    </div>
  )
}

export function AIProviderEditDialog({ mode, initial, onClose, onSaved, onActivateAndSaved }) {
  const isEdit = mode === 'edit'

  const [purpose, setPurpose] = useState(initial?.purpose || 'reply-generation')
  const [name, setName] = useState(initial?.name || '')
  const [model, setModel] = useState(initial?.model || '')
  const [baseUrl, setBaseUrl] = useState(initial?.base_url || '')
  const [apiKey, setApiKey] = useState(initial?.api_key || '')
  const [extraParams, setExtraParams] = useState(
    initial?.extra_params
      ? (typeof initial.extra_params === 'string'
          ? initial.extra_params
          : JSON.stringify(initial.extra_params, null, 2))
      : JSON.stringify(DEFAULT_EXTRA_PARAMS, null, 2)
  )
  const [notes, setNotes] = useState(initial?.notes || '')
  const [jsonError, setJsonError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')

  useEffect(() => {
    if (!extraParams.trim()) { setJsonError(''); return }
    const parsed = parseJsonSafe(extraParams)
    if (parsed === null && extraParams.trim() !== '') {
      setJsonError('必须是合法 JSON')
    } else {
      setJsonError('')
    }
  }, [extraParams])

  function validate() {
    if (!name.trim()) return '配置名不能为空'
    if (!model.trim()) return '模型不能为空'
    if (!baseUrl.trim()) return 'Base URL 不能为空'
    if (!apiKey.trim()) return 'API Key 不能为空'
    if (jsonError) return 'extra_params 必须是合法 JSON'
    return null
  }

  async function handleSave(e) {
    e.preventDefault()
    const err = validate()
    if (err) { setSubmitError(err); return }
    setSubmitting(true)
    setSubmitError('')
    try {
      const payload = {
        purpose,
        name: name.trim(),
        model: model.trim(),
        base_url: baseUrl.trim(),
        api_key: apiKey.trim(),
        extra_params: parseJsonSafe(extraParams) || DEFAULT_EXTRA_PARAMS,
        notes: notes.trim(),
      }
      const res = isEdit
        ? await aiProvidersApi.update(initial.id, payload)
        : await aiProvidersApi.create(payload)
      onSaved(res?.data || res)
      onClose()
    } catch (err) {
      setSubmitError(err?.body || err?.message || '保存失败')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleActivateAndSave(e) {
    e.preventDefault()
    const err = validate()
    if (err) { setSubmitError(err); return }
    setSubmitting(true)
    setSubmitError('')
    try {
      const payload = {
        purpose,
        name: name.trim(),
        model: model.trim(),
        base_url: baseUrl.trim(),
        api_key: apiKey.trim(),
        extra_params: parseJsonSafe(extraParams) || DEFAULT_EXTRA_PARAMS,
        notes: notes.trim(),
      }
      let res
      if (isEdit) {
        res = await aiProvidersApi.update(initial.id, payload)
        await aiProvidersApi.activate(initial.id)
      } else {
        res = await aiProvidersApi.create(payload)
        if (res?.data?.id) await aiProvidersApi.activate(res.data.id)
      }
      onActivateAndSaved(res?.data || res)
      onClose()
    } catch (err) {
      setSubmitError(err?.body || err?.message || '保存失败')
    } finally {
      setSubmitting(false)
    }
  }

  const inputStyle = {
    width: '100%', padding: '8px 10px', border: `1px solid ${WA.borderLight}`,
    borderRadius: 8, fontSize: 14, color: WA.textDark, background: WA.white, outline: 'none',
  }

  return (
    <ModalShell title={isEdit ? '编辑配置' : '新建配置'} onClose={onClose}>
      <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
        <Field label="Purpose">
          {isEdit ? (
            <code style={{ fontSize: 13, color: WA.textMuted, padding: '6px 0' }}>
              {PURPOSE_LABELS[purpose] || purpose}
            </code>
          ) : (
            <select value={purpose} onChange={e => setPurpose(e.target.value)} style={inputStyle}>
              {Object.entries(PURPOSE_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          )}
        </Field>

        <Field label="配置名" required>
          <input type="text" value={name} onChange={e => setName(e.target.value)}
            placeholder="如 GPT-4o 生产环境" style={inputStyle} />
        </Field>

        <Field label="模型" required>
          <input type="text" value={model} onChange={e => setModel(e.target.value)}
            placeholder="gpt-4o / MiniMax-M2.7-highspeed" style={inputStyle} />
        </Field>

        <Field label="Base URL" required>
          <input type="url" value={baseUrl} onChange={e => setBaseUrl(e.target.value)}
            placeholder="https://api.openai.com/v1" style={inputStyle} />
        </Field>

        <Field label="API Key" required>
          <input type="password" value={apiKey} onChange={e => setApiKey(e.target.value)}
            placeholder="sk-..." style={inputStyle} autoComplete="off" />
        </Field>

        <Field label="Extra Params (JSON)">
          <textarea value={extraParams} onChange={e => setExtraParams(e.target.value)}
            rows={4}
            style={{ ...inputStyle, resize: 'vertical', fontFamily: 'monospace', fontSize: 13 }}
            placeholder='{"temperature": 0.7, "max_tokens": 500}'
          />
          {jsonError && (
            <div style={{ fontSize: 12, color: '#dc2626', marginTop: 4 }}>{jsonError}</div>
          )}
        </Field>

        <Field label="备注">
          <textarea value={notes} onChange={e => setNotes(e.target.value)}
            rows={2} style={{ ...inputStyle, resize: 'vertical' }} placeholder="可选备注说明" />
        </Field>

        {submitError && (
          <div style={{
            padding: '8px 12px', background: '#fef2f2', color: '#dc2626',
            borderRadius: 6, fontSize: 13, marginBottom: 12,
          }}>
            {submitError}
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
          <button type="button" onClick={onClose} disabled={submitting}
            style={{
              padding: '8px 16px', border: `1px solid ${WA.borderLight}`,
              borderRadius: 8, background: WA.white, color: WA.textMuted, cursor: 'pointer',
            }}>
            取消
          </button>
          {isEdit && (
            <button type="button" onClick={handleActivateAndSave}
              disabled={submitting || !!jsonError}
              style={{
                padding: '8px 16px', border: 'none', borderRadius: 8,
                background: WA.tealDark, color: 'white', cursor: 'pointer',
              }}>
              保存并切 active
            </button>
          )}
          <button type="submit" disabled={submitting || !!jsonError}
            style={{
              padding: '8px 16px', border: 'none', borderRadius: 8,
              background: WA.teal, color: 'white', cursor: 'pointer',
            }}>
            {submitting ? '保存中...' : '保存'}
          </button>
        </div>
      </form>
    </ModalShell>
  )
}

export default AIProviderEditDialog
