import React, { useEffect, useMemo, useState } from 'react'
import { fetchJsonOrThrow, fetchOkOrThrow } from '../utils/api'
import WA from '../utils/waTheme'
import { useToast } from './Toast'

const API_BASE = '/api'
const DISPLAY_TIME_ZONE = 'Asia/Shanghai'

const EVENT_TYPE_LABELS = {
  trial_7day: { label: '7天试用', color: '#3b82f6', bg: 'rgba(59,130,246,0.15)' },
  monthly_challenge: { label: '月度挑战', color: '#8b5cf6', bg: 'rgba(139,92,246,0.15)' },
  agency_bound: { label: 'Agency绑定', color: '#10b981', bg: 'rgba(16,185,129,0.15)' },
  gmv_milestone: { label: 'GMV里程碑', color: '#f59e0b', bg: 'rgba(245,158,11,0.15)' },
  referral: { label: '推荐', color: '#06b6d4', bg: 'rgba(6,182,212,0.15)' },
  incentive_task: { label: '激励任务', color: '#ec4899', bg: 'rgba(236,72,153,0.15)' },
  recall_pending: { label: '待召回', color: '#f97316', bg: 'rgba(249,115,22,0.15)' },
  second_touch: { label: '二次触达', color: '#0ea5e9', bg: 'rgba(14,165,233,0.15)' },
}

const STATUS_LABELS = {
  draft: { label: '待确认', color: '#f59e0b', bg: 'rgba(245,158,11,0.15)' },
  pending: { label: '待确认', color: '#f59e0b', bg: 'rgba(245,158,11,0.15)' },
  active: { label: '进行中', color: '#10b981', bg: 'rgba(16,185,129,0.15)' },
  completed: { label: '已完成', color: '#94a3b8', bg: 'rgba(148,163,184,0.15)' },
  cancelled: { label: '已取消', color: '#ef4444', bg: 'rgba(239,68,68,0.15)' },
}

const VERIFICATION_LABELS = {
  pending: { label: '待二审', color: '#f59e0b', bg: 'rgba(245,158,11,0.15)' },
  confirmed: { label: '已核对通过', color: '#10b981', bg: 'rgba(16,185,129,0.15)' },
  rejected: { label: '已核对驳回', color: '#ef4444', bg: 'rgba(239,68,68,0.15)' },
  uncertain: { label: '核对不确定', color: '#64748b', bg: 'rgba(100,116,139,0.15)' },
}

function parseEventMeta(meta) {
  if (!meta) return {}
  if (typeof meta === 'object') return meta
  try {
    return JSON.parse(meta)
  } catch (_) {
    return {}
  }
}

function toDisplayTimestamp(value) {
  const numeric = Number(value)
  if (Number.isFinite(numeric) && numeric > 0) return numeric > 1e12 ? numeric : numeric * 1000
  const ts = new Date(value || 0).getTime()
  return Number.isFinite(ts) ? ts : 0
}

function formatDateTimeCN(value) {
  const ts = toDisplayTimestamp(value)
  if (!ts) return '-'
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: DISPLAY_TIME_ZONE,
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(ts))
}

function formatEventShortDate(value) {
  const ts = toDisplayTimestamp(value)
  if (!ts) return '-'
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: DISPLAY_TIME_ZONE,
    month: 'numeric',
    day: 'numeric',
  }).format(new Date(ts))
}

function formatUsd(value) {
  const amount = Number(value || 0)
  if (!Number.isFinite(amount) || amount <= 0) return '$0'
  return `$${amount.toLocaleString()}`
}

function getEventDateValue(evt) {
  return toDisplayTimestamp(evt?.start_at || evt?.created_at || evt?.updated_at || 0)
}

function getGmvMilestoneStates(gmvCurrent) {
  const amount = Number(gmvCurrent || 0)
  return [
    { label: '1K', threshold: 1000 },
    { label: '2K', threshold: 2000 },
    { label: '5K', threshold: 5000 },
    { label: '10K', threshold: 10000 },
  ].map(item => ({ ...item, reached: amount >= item.threshold }))
}

function Section({ title, children }) {
  return (
    <div>
      <div className="text-[11px] font-medium mb-2" style={{ color: WA.textMuted }}>{title}</div>
      <div className="space-y-0.5">{children}</div>
    </div>
  )
}

function Pill({ label, tone }) {
  return (
    <span className="text-[11px] px-2.5 py-1 rounded-full font-semibold" style={{ background: tone.bg, color: tone.color }}>
      {label}
    </span>
  )
}

function MiniAction({ label, color, onClick, disabled = false }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="px-2.5 py-1.5 rounded-full text-[11px] font-semibold disabled:opacity-60"
      style={{ background: `${color}18`, color }}
    >
      {label}
    </button>
  )
}

export function CreatorEventsSection({ creatorId }) {
  const toast = useToast()
  const [summary, setSummary] = useState(null)
  const [events, setEvents] = useState([])
  const [loading, setLoading] = useState(true)
  const [verifyingEventId, setVerifyingEventId] = useState(null)
  const [applyingEventId, setApplyingEventId] = useState(null)

  const loadSummary = async (silent = false) => {
    if (!creatorId) return
    if (!silent) setLoading(true)
    try {
      const data = await fetchJsonOrThrow(`${API_BASE}/events/summary/${creatorId}`)
      setSummary(data.summary)
      setEvents(data.events || [])
    } finally {
      if (!silent) setLoading(false)
    }
  }

  useEffect(() => {
    let cancelled = false
    if (!creatorId) return
    const run = async () => {
      try {
        const data = await fetchJsonOrThrow(`${API_BASE}/events/summary/${creatorId}`)
        if (cancelled) return
        setSummary(data.summary)
        setEvents(data.events || [])
      } catch (_) {
        if (cancelled) return
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    setLoading(true)
    run()
    return () => { cancelled = true }
  }, [creatorId])

  const sortedEvents = useMemo(() => [...events].sort((a, b) => getEventDateValue(b) - getEventDateValue(a)), [events])

  const handleVerify = async (eventId) => {
    setVerifyingEventId(eventId)
    try {
      await fetchJsonOrThrow(`${API_BASE}/events/${eventId}/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ context_window: { before: 5, after: 4 } }),
        signal: AbortSignal.timeout(45000),
      })
      await loadSummary(true)
    } catch (e) {
      toast.error(`二次核对失败: ${e.message}`)
    } finally {
      setVerifyingEventId(null)
    }
  }

  const handleApplySuggestedTransition = async (eventId) => {
    setApplyingEventId(eventId)
    try {
      await fetchOkOrThrow(`${API_BASE}/events/${eventId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'active' }),
        signal: AbortSignal.timeout(15000),
      })
      await loadSummary(true)
    } catch (e) {
      toast.error(`人工确认流转失败: ${e.message}`)
    } finally {
      setApplyingEventId(null)
    }
  }

  if (loading) {
    return (
      <Section title="事件">
        <div className="flex items-center justify-center py-4 gap-2" style={{ color: WA.textMuted }}>
          <div className="w-4 h-4 rounded-full border border-t-transparent animate-spin" style={{ borderColor: WA.teal, borderTopColor: 'transparent' }} />
          <span className="text-[11px]">加载中...</span>
        </div>
      </Section>
    )
  }

  if (!summary || events.length === 0) {
    return (
      <Section title="事件">
        <div className="text-center py-4" style={{ color: WA.textMuted }}>
          <span className="text-xs">暂无事件记录</span>
        </div>
      </Section>
    )
  }

  const latestGmvEvent = sortedEvents.find(evt => evt.event_key === 'gmv_milestone')
  const gmvMeta = latestGmvEvent ? parseEventMeta(latestGmvEvent.meta) : {}
  const gmvCurrent = gmvMeta.gmv_current || gmvMeta.gmv || gmvMeta.amount || 0
  const gmvMilestones = latestGmvEvent ? getGmvMilestoneStates(gmvCurrent) : []

  return (
    <Section title={`事件状态 (${events.length})`}>
      <div className="flex flex-wrap gap-2 mb-3">
        {summary.active_count > 0 && <Pill label={`🔥 ${summary.active_count} 进行中`} tone={{ bg: 'rgba(16,185,129,0.15)', color: '#10b981' }} />}
        {summary.completed_count > 0 && <Pill label={`✅ ${summary.completed_count} 已完成`} tone={{ bg: 'rgba(148,163,184,0.15)', color: '#94a3b8' }} />}
        {summary.wa_owner && <Pill label={summary.wa_owner} tone={{ bg: summary.wa_owner === 'Beau' ? 'rgba(59,130,246,0.15)' : 'rgba(139,92,246,0.15)', color: summary.wa_owner === 'Beau' ? '#3b82f6' : '#8b5cf6' }} />}
      </div>

      <div className="space-y-3">
        {latestGmvEvent && (
          <div className="p-3 rounded-2xl" style={{ background: WA.lightBg }}>
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-[11px] font-semibold" style={{ color: WA.textMuted }}>GMV 状态识别</div>
                <div className="text-base font-semibold" style={{ color: '#f59e0b' }}>{formatUsd(gmvCurrent)}</div>
              </div>
              <span className="text-[11px]" style={{ color: WA.textMuted }}>
                {formatEventShortDate(latestGmvEvent.start_at || latestGmvEvent.created_at)}
              </span>
            </div>
            <div className="flex flex-wrap gap-1.5 mt-2">
              {gmvMilestones.map(item => (
                <span
                  key={item.label}
                  className="text-[11px] px-2.5 py-1 rounded-full font-semibold"
                  style={{
                    background: item.reached ? 'rgba(245,158,11,0.15)' : 'rgba(148,163,184,0.12)',
                    color: item.reached ? '#f59e0b' : WA.textMuted,
                  }}
                >
                  {item.label}
                </span>
              ))}
            </div>
          </div>
        )}

        <div className="space-y-2">
          {sortedEvents.slice(0, 6).map((evt) => {
            const typeInfo = EVENT_TYPE_LABELS[evt.event_key] || { label: evt.event_key, color: '#94a3b8', bg: 'rgba(148,163,184,0.15)' }
            const statusInfo = STATUS_LABELS[evt.status] || { label: evt.status, color: '#94a3b8', bg: 'rgba(148,163,184,0.15)' }
            const verificationInfo = VERIFICATION_LABELS[evt.verification_status || 'pending'] || VERIFICATION_LABELS.pending
            const transitionSuggestion = evt.transition_suggestion || null
            const sourcePreview = evt.source_message_text || evt.trigger_text || '暂无原始触发文本'
            return (
              <div key={evt.id} className="rounded-2xl px-3 py-3 space-y-3" style={{ background: WA.lightBg, border: `1px solid ${WA.borderLight}` }}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2 min-w-0">
                      <Pill label={typeInfo.label} tone={typeInfo} />
                      <Pill label={statusInfo.label} tone={statusInfo} />
                      <Pill label={verificationInfo.label} tone={verificationInfo} />
                    </div>
                    <div className="text-[12px] leading-5" style={{ color: WA.textDark }}>
                      {sourcePreview}
                    </div>
                    <div className="text-[10px]" style={{ color: WA.textMuted }}>
                      {formatEventShortDate(evt.start_at || evt.created_at)} · {formatDateTimeCN(evt.source_message_timestamp || evt.display_start_at || evt.created_at)}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-[11px] font-semibold" style={{ color: typeInfo.color }}>#{evt.id}</div>
                    {evt.verification_confidence ? (
                      <div className="text-[10px] mt-1" style={{ color: WA.textMuted }}>
                        置信度 {evt.verification_confidence}/5
                      </div>
                    ) : null}
                  </div>
                </div>

                <div className="rounded-2xl px-3 py-2.5" style={{ background: WA.white, border: `1px solid ${WA.borderLight}` }}>
                  <div className="text-[11px] font-semibold" style={{ color: WA.textMuted }}>OpenAI 核对结论</div>
                  <div className="text-[12px] mt-1.5 leading-5" style={{ color: WA.textDark }}>
                    {evt.verification_reason || '当前还没有二次核对结论。'}
                  </div>
                  {evt.verification_quote ? (
                    <div className="text-[11px] mt-2 leading-5" style={{ color: WA.textMuted }}>
                      证据原句：{evt.verification_quote}
                    </div>
                  ) : null}
                  {transitionSuggestion?.suggested ? (
                    <div className="text-[11px] mt-2 leading-5 rounded-xl px-2.5 py-2" style={{ color: '#92400e', background: 'rgba(245,158,11,0.10)', border: '1px solid rgba(245,158,11,0.18)' }}>
                      建议流转：{transitionSuggestion.from_status} → {transitionSuggestion.to_status}。当前仍需人工复核后再正式流转。
                    </div>
                  ) : null}
                </div>

                <div className="flex flex-wrap gap-2">
                  <MiniAction
                    label={verifyingEventId === evt.id ? '核对中...' : 'OpenAI 二次核对'}
                    color={WA.teal}
                    onClick={() => handleVerify(evt.id)}
                    disabled={verifyingEventId === evt.id}
                  />
                  {evt.status === 'draft' && transitionSuggestion?.suggested ? (
                    <MiniAction
                      label={applyingEventId === evt.id ? '确认中...' : '人工确认流转'}
                      color="#10b981"
                      onClick={() => handleApplySuggestedTransition(evt.id)}
                      disabled={applyingEventId === evt.id}
                    />
                  ) : null}
                </div>
              </div>
            )
          })}
        </div>

        {events.length > 6 && (
          <div className="text-center text-[11px] py-1" style={{ color: WA.textMuted }}>
            还有 {events.length - 6} 个历史事件
          </div>
        )}
      </div>
    </Section>
  )
}
