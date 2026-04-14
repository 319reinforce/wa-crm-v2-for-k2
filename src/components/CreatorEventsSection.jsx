import React, { useEffect, useState } from 'react'
import { fetchJsonOrThrow } from '../utils/api'
import WA from '../utils/waTheme'

const API_BASE = '/api'
const DISPLAY_TIME_ZONE = 'Asia/Shanghai'

function parseEventMeta(meta) {
  if (!meta) return {}
  if (typeof meta === 'object') return meta
  try {
    return JSON.parse(meta)
  } catch (_) {
    return {}
  }
}

function formatUsd(value) {
  const amount = Number(value || 0)
  if (!Number.isFinite(amount) || amount <= 0) return '$0'
  return `$${amount.toLocaleString()}`
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

function getEventDateValue(evt) {
  return new Date(evt?.start_at || evt?.created_at || evt?.updated_at || 0).getTime() || 0
}

function formatEventShortDate(value) {
  const ts = new Date(value || 0).getTime()
  if (!ts) return '-'
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: DISPLAY_TIME_ZONE,
    month: 'numeric',
    day: 'numeric',
  }).format(new Date(ts))
}

function Section({ title, children }) {
  return (
    <div>
      <div className="text-[11px] font-medium mb-2" style={{ color: WA.textMuted }}>{title}</div>
      <div className="space-y-0.5">{children}</div>
    </div>
  )
}

export function CreatorEventsSection({ creatorId }) {
  const [summary, setSummary] = useState(null)
  const [events, setEvents] = useState([])
  const [loading, setLoading] = useState(true)

  const EVENT_TYPE_LABELS = {
    trial_7day: { label: '7天试用', color: '#3b82f6', bg: 'rgba(59,130,246,0.15)' },
    monthly_challenge: { label: '月度挑战', color: '#8b5cf6', bg: 'rgba(139,92,246,0.15)' },
    agency_bound: { label: 'Agency绑定', color: '#10b981', bg: 'rgba(16,185,129,0.15)' },
    gmv_milestone: { label: 'GMV里程碑', color: '#f59e0b', bg: 'rgba(245,158,11,0.15)' },
    referral: { label: '推荐', color: '#06b6d4', bg: 'rgba(6,182,212,0.15)' },
    incentive_task: { label: '激励任务', color: '#ec4899', bg: 'rgba(236,72,153,0.15)' },
  }

  const STATUS_LABELS = {
    pending: { label: '待确认', color: '#f59e0b', bg: 'rgba(245,158,11,0.15)' },
    active: { label: '进行中', color: '#10b981', bg: 'rgba(16,185,129,0.15)' },
    completed: { label: '已完成', color: '#94a3b8', bg: 'rgba(148,163,184,0.15)' },
    cancelled: { label: '已取消', color: '#ef4444', bg: 'rgba(239,68,68,0.15)' },
  }

  useEffect(() => {
    if (!creatorId) return
    let cancelled = false
    const loadSummary = async () => {
      setLoading(true)
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
    loadSummary()
    return () => { cancelled = true }
  }, [creatorId])

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

  return (
    <Section title={`事件状态 (${events.length})`}>
      <div className="flex flex-wrap gap-2 mb-3">
        {summary.active_count > 0 && (
          <span className="text-[11px] px-2.5 py-1.5 rounded-full font-semibold" style={{ background: 'rgba(16,185,129,0.15)', color: '#10b981' }}>
            🔥 {summary.active_count} 进行中
          </span>
        )}
        {summary.completed_count > 0 && (
          <span className="text-[11px] px-2.5 py-1.5 rounded-full font-semibold" style={{ background: 'rgba(148,163,184,0.15)', color: '#94a3b8' }}>
            ✅ {summary.completed_count} 已完成
          </span>
        )}
        {summary.wa_owner && (
          <span className="text-[11px] px-2.5 py-1.5 rounded-full font-semibold" style={{ background: summary.wa_owner === 'Beau' ? 'rgba(59,130,246,0.15)' : 'rgba(139,92,246,0.15)', color: summary.wa_owner === 'Beau' ? '#3b82f6' : '#8b5cf6' }}>
            {summary.wa_owner}
          </span>
        )}
      </div>

      {(() => {
        const sortedEvents = [...events].sort((a, b) => getEventDateValue(b) - getEventDateValue(a))
        const latestGmvEvent = sortedEvents.find(evt => evt.event_key === 'gmv_milestone')
        const gmvMeta = latestGmvEvent ? parseEventMeta(latestGmvEvent.meta) : {}
        const gmvCurrent = gmvMeta.gmv_current || gmvMeta.gmv || gmvMeta.amount || 0
        const gmvMilestones = latestGmvEvent ? getGmvMilestoneStates(gmvCurrent) : []
        const latestByType = Object.values(sortedEvents.reduce((acc, evt) => {
          if (!acc[evt.event_key]) acc[evt.event_key] = evt
          return acc
        }, {})).slice(0, 4)

        return (
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

            <div className="p-3 rounded-2xl" style={{ background: WA.lightBg }}>
              <div className="space-y-2">
                {latestByType.map(evt => {
                  const typeInfo = EVENT_TYPE_LABELS[evt.event_key] || { label: evt.event_key, color: '#94a3b8', bg: 'rgba(148,163,184,0.15)' }
                  const statusInfo = STATUS_LABELS[evt.status] || { label: evt.status, color: '#94a3b8', bg: 'rgba(148,163,184,0.15)' }
                  return (
                    <div key={evt.id} className="flex items-center justify-between gap-3 rounded-2xl px-3 py-3" style={{ background: WA.white }}>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2 min-w-0">
                          <span className="text-[11px] px-2 py-0.5 rounded-full font-semibold shrink-0" style={{ background: typeInfo.bg, color: typeInfo.color }}>
                            {typeInfo.label}
                          </span>
                          <span className="text-[11px] truncate" style={{ color: WA.textMuted }}>
                            {statusInfo.label}
                          </span>
                        </div>
                        <div className="text-[10px] mt-1" style={{ color: WA.textMuted }}>
                          开始时间 {formatEventShortDate(evt.start_at || evt.created_at)}
                        </div>
                      </div>
                      <span className="text-xs shrink-0 font-semibold" style={{ color: typeInfo.color }}>
                        {formatEventShortDate(evt.start_at || evt.created_at)}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>

            {events.length > latestByType.length && (
              <div className="text-center text-[11px] py-1" style={{ color: WA.textMuted }}>
                还有 {events.length - latestByType.length} 个历史事件
              </div>
            )}
          </div>
        )
      })()}
      
    </Section>
  )
}
