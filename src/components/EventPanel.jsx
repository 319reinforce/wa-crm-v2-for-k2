import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import JudgeQuickForm from './JudgeQuickForm'
import { OWNER_ORDER, getOwnerColor, useOperatorRoster } from '../utils/operators'
import { getAppAuthScopeOwner, isAppAuthOwnerLocked } from '../utils/appAuth'
import { fetchJsonOrThrow, fetchOkOrThrow } from '../utils/api'
import { useToast } from './Toast'
import sharedWA from '../utils/waTheme'

const API_BASE = '/api';
const DISPLAY_TIME_ZONE = 'Asia/Shanghai';

function toDisplayTimestamp(value) {
  const numeric = Number(value)
  if (Number.isFinite(numeric) && numeric > 0) {
    return numeric > 1e12 ? numeric : numeric * 1000
  }
  const ts = new Date(value || 0).getTime()
  return Number.isFinite(ts) ? ts : 0
}

function formatDateCN(value) {
  const ts = toDisplayTimestamp(value);
  if (!ts) return '-';
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: DISPLAY_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(ts));
}

function formatDateTimeCN(value) {
  const ts = toDisplayTimestamp(value);
  if (!ts) return '-';
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: DISPLAY_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(new Date(ts));
}

function toLocalDateTimeInputValue(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// 统一到项目 waTheme，不再维护本地 palette（历史遗留的 WhatsApp 官方色和项目暖米色冲突）
const WA = {
  darkHeader: sharedWA.darkHeader,
  teal: sharedWA.teal,
  tealDark: sharedWA.tealDark,
  lightBg: sharedWA.lightBg,
  chatBg: sharedWA.chatBg,
  shellPanelMuted: sharedWA.shellPanelMuted,
  white: sharedWA.white,
  borderLight: sharedWA.borderLight,
  textDark: sharedWA.textDark,
  textMuted: sharedWA.textMuted,
  hover: sharedWA.hover,
}

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

const REVIEW_LABELS = {
  unreviewed: { label: '待人工确认', color: '#f59e0b', bg: 'rgba(245,158,11,0.15)' },
  pending: { label: '待人工确认', color: '#f59e0b', bg: 'rgba(245,158,11,0.15)' },
  confirmed: { label: '人工已确认', color: '#10b981', bg: 'rgba(16,185,129,0.15)' },
  rejected: { label: '人工已驳回', color: '#ef4444', bg: 'rgba(239,68,68,0.15)' },
  uncertain: { label: '证据不足', color: '#64748b', bg: 'rgba(100,116,139,0.15)' },
}

function getTierLabel(value) {
  const tier = Number(value ?? 0)
  if (tier >= 3) return 'Tier 3'
  if (tier === 2) return 'Tier 2'
  if (tier === 1) return 'Tier 1'
  return 'Tier 0'
}

export function EventPanel({ onOpenCreatorChat, selectedEventId, onSelectedEventChange, restoreState }) {
  const toast = useToast()
  const lockedOwner = getAppAuthScopeOwner()
  const ownerLocked = isAppAuthOwnerLocked() && !!lockedOwner
  const { owners: rosterOwners } = useOperatorRoster()
  const dynamicOwnerOptions = useMemo(() => (
    rosterOwners && rosterOwners.length > 0 ? rosterOwners : [...OWNER_ORDER]
  ), [rosterOwners])
  const ownerOptions = ownerLocked ? [lockedOwner] : dynamicOwnerOptions
  const defaultOwner = lockedOwner || dynamicOwnerOptions[0] || OWNER_ORDER[0]
  const [events, setEvents] = useState([])
  const [loading, setLoading] = useState(true)
  const [total, setTotal] = useState(0)
  const [filterStatus, setFilterStatus] = useState('')
  const [filterOwner, setFilterOwner] = useState(lockedOwner || '')
  const [filterEventKey, setFilterEventKey] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [creators, setCreators] = useState([])
  const [selectedEvent, setSelectedEvent] = useState(null)
  const [judging, setJudging] = useState(false)
  const [judgeResult, setJudgeResult] = useState(null)
  const [verifyingEventId, setVerifyingEventId] = useState(null)
  const [verificationPreview, setVerificationPreview] = useState(null)
  const eventCardRefs = useRef(new Map())
  const contentScrollRef = useRef(null)
  const [flashEventId, setFlashEventId] = useState(null)

  // 创建表单
  const [createForm, setCreateForm] = useState({
    creator_id: '',
    event_key: 'trial_7day',
    event_type: 'challenge',
    owner: defaultOwner,
    trigger_source: 'manual',
    trigger_text: '',
    start_at: toLocalDateTimeInputValue(),
    end_at: '',
  })
  const selectedCreator = creators.find(c => String(c.id) === String(createForm.creator_id))
  const selectedAgencyBound = Boolean(
    selectedCreator?.wacrm?.agency_bound
      ?? selectedCreator?._full?.wacrm?.agency_bound
      ?? selectedCreator?.joinbrands?.ev_agency_bound
      ?? selectedCreator?._full?.joinbrands?.ev_agency_bound
  )
  const agencyOnlyKeys = new Set(['recall_pending', 'second_touch'])
  const createEventEntries = Object.entries(EVENT_TYPE_LABELS).filter(([key]) => {
    if (!selectedCreator) return true
    if (selectedAgencyBound && agencyOnlyKeys.has(key)) return false
    return true
  })

  const fetchEvents = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    try {
      const params = new URLSearchParams()
      if (filterStatus) params.set('status', filterStatus)
      if (filterOwner) params.set('owner', filterOwner)
      if (filterEventKey) params.set('event_key', filterEventKey)
      params.set('limit', '100')

      const data = await fetchJsonOrThrow(`${API_BASE}/events?${params.toString()}`, { signal: AbortSignal.timeout(15000) })
      setEvents(data.events || [])
      setTotal(data.total || 0)
    } catch (e) {
      console.error('fetchEvents error:', e)
    } finally {
      if (!silent) setLoading(false)
    }
  }, [filterStatus, filterOwner, filterEventKey])

  const fetchCreators = useCallback(async () => {
    try {
      const params = new URLSearchParams()
      params.set('limit', '500')
      params.set('fields', 'wa_phone')
      const data = await fetchJsonOrThrow(`${API_BASE}/creators?${params.toString()}`, { signal: AbortSignal.timeout(15000) })
      setCreators(Array.isArray(data) ? data : [])
    } catch (e) {
      console.error('fetchCreators error:', e)
    }
  }, [])

  useEffect(() => {
    fetchEvents()
    fetchCreators()
  }, [fetchEvents, fetchCreators])

  useEffect(() => {
    if (!ownerLocked || !lockedOwner) return
    setFilterOwner(lockedOwner)
    setCreateForm((current) => ({
      ...current,
      owner: lockedOwner,
    }))
  }, [ownerLocked, lockedOwner])

  useEffect(() => {
    const eventId = Number(selectedEventId || 0)
    if (!eventId) return

    let cancelled = false
    const syncSelectedEvent = async () => {
      if (Number(selectedEvent?.id || 0) === eventId) return
      try {
        const data = await fetchJsonOrThrow(`${API_BASE}/events/${eventId}`, { signal: AbortSignal.timeout(15000) })
        if (cancelled) return
        setSelectedEvent(data)
        setJudgeResult(null)
      } catch (e) {
        if (!cancelled) console.error('syncSelectedEvent error:', e)
      }
    }

    syncSelectedEvent()
    return () => { cancelled = true }
  }, [selectedEventId, selectedEvent?.id])

  const ensureEventVisible = useCallback((eventId, behavior = 'smooth') => {
    const numericId = Number(eventId || 0)
    if (!numericId) return
    const node = eventCardRefs.current.get(numericId)
    const container = contentScrollRef.current
    if (!node || !container) return

    const nodeRect = node.getBoundingClientRect()
    const containerRect = container.getBoundingClientRect()
    const isVisible = nodeRect.top >= containerRect.top + 18 && nodeRect.bottom <= containerRect.bottom - 18
    if (!isVisible) {
      node.scrollIntoView({ behavior, block: 'center' })
    }
  }, [])

  useEffect(() => {
    const eventId = Number(selectedEventId || 0)
    if (!eventId || typeof window === 'undefined') return
    const raf = window.requestAnimationFrame(() => {
      ensureEventVisible(eventId, 'smooth')
    })
    return () => window.cancelAnimationFrame(raf)
  }, [selectedEventId, events, ensureEventVisible])

  useEffect(() => {
    const token = Number(restoreState?.token || 0)
    const eventId = Number(restoreState?.eventId || 0)
    if (!token || !eventId) return

    const container = contentScrollRef.current
    if (container) {
      container.scrollTop = Number(restoreState?.scrollTop || 0)
    }

    setFlashEventId(eventId)
    const raf = window.requestAnimationFrame(() => {
      ensureEventVisible(eventId, 'auto')
    })
    const timer = window.setTimeout(() => {
      setFlashEventId((current) => current === eventId ? null : current)
    }, 2200)

    return () => {
      window.cancelAnimationFrame(raf)
      window.clearTimeout(timer)
    }
  }, [restoreState, ensureEventVisible])

  useEffect(() => {
    if (!selectedCreator) return
    const creatorOwner = selectedCreator.wa_owner || selectedCreator?._full?.wa_owner || lockedOwner || ''
    if (creatorOwner && createForm.owner !== creatorOwner) {
      setCreateForm((f) => ({ ...f, owner: creatorOwner }))
    }
    if (selectedAgencyBound && agencyOnlyKeys.has(createForm.event_key)) {
      setCreateForm(f => ({ ...f, event_key: 'trial_7day', event_type: 'challenge' }))
    }
  }, [selectedCreator, selectedAgencyBound, createForm.event_key, createForm.owner, lockedOwner])

  const handleCreate = async () => {
    try {
      await fetchJsonOrThrow(`${API_BASE}/events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(createForm),
        signal: AbortSignal.timeout(15000),
      })
      setShowCreate(false)
      setCreateForm({
        creator_id: '',
        event_key: 'trial_7day',
        event_type: 'challenge',
        owner: defaultOwner,
        trigger_source: 'manual',
        trigger_text: '',
        start_at: toLocalDateTimeInputValue(),
        end_at: '',
      })
      fetchEvents()
    } catch (e) {
      toast.error('创建失败: ' + e.message)
    }
  }

  const handleStatusChange = async (eventId, newStatus) => {
    try {
      await fetchOkOrThrow(`${API_BASE}/events/${eventId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
        signal: AbortSignal.timeout(15000),
      })
      fetchEvents(true)
      if (selectedEvent?.id === eventId) {
        const data = await fetchJsonOrThrow(`${API_BASE}/events/${eventId}`, { signal: AbortSignal.timeout(15000) })
        setSelectedEvent(data)
      }
    } catch (e) {
      console.error('handleStatusChange error:', e)
    }
  }

  const handleReviewEvent = async (eventId, decision) => {
    const currentEvent = Number(selectedEvent?.id || 0) === Number(eventId)
      ? selectedEvent
      : events.find(event => Number(event.id || 0) === Number(eventId))
    const confirmedLifecycleEffect = currentEvent?.event_key === 'referral' ? 'overlay' : 'stage_signal'
    const payloadByDecision = {
      confirm: {
        status: 'active',
        review_state: 'confirmed',
        evidence_tier: 2,
        source_kind: 'human_review',
        lifecycle_effect: confirmedLifecycleEffect,
      },
      reject: {
        status: 'cancelled',
        review_state: 'rejected',
        evidence_tier: 0,
        source_kind: 'human_review',
        lifecycle_effect: 'none',
      },
      uncertain: {
        review_state: 'uncertain',
        evidence_tier: 1,
        source_kind: 'human_review',
        lifecycle_effect: 'none',
      },
    }
    const payload = payloadByDecision[decision]
    if (!payload) return
    try {
      await fetchJsonOrThrow(`${API_BASE}/events/${eventId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(15000),
      })
      await fetchEvents(true)
      await handleViewEvent(eventId)
    } catch (e) {
      toast.error(`审核失败: ${e.message}`)
    }
  }

  const handleJudge = async (eventId) => {
    setJudging(true)
    setJudgeResult(null)
    try {
      // 获取最近一周的起止时间
      const now = new Date()
      const periodStart = new Date(now - 7 * 24 * 3600 * 1000).toISOString()
      const periodEnd = now.toISOString()

      // 尝试从 event_periods 获取 video_count，或者弹窗让用户输入
      const event = events.find(e => e.id === eventId)
      let meta = {};
      try { if (event?.meta) meta = JSON.parse(event.meta); } catch (_) {}
      const videoCount = meta.video_count || 0

      const data = await fetchJsonOrThrow(`${API_BASE}/events/${eventId}/judge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ period_start: periodStart, period_end: periodEnd, video_count: videoCount }),
        signal: AbortSignal.timeout(15000),
      })
      setJudgeResult(data)
      fetchEvents(true)
    } catch (e) {
      console.error('handleJudge error:', e)
    } finally {
      setJudging(false)
    }
  }

  const handleViewEvent = async (eventId) => {
    try {
      onSelectedEventChange?.(eventId)
      const data = await fetchJsonOrThrow(`${API_BASE}/events/${eventId}`, { signal: AbortSignal.timeout(15000) })
      setSelectedEvent(data)
      setJudgeResult(null)
    } catch (e) {
      console.error('handleViewEvent error:', e)
    }
  }

  const handleVerify = async (eventId) => {
    setVerifyingEventId(eventId)
    try {
      const data = await fetchJsonOrThrow(`${API_BASE}/events/${eventId}/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ context_window: { before: 5, after: 4 } }),
        signal: AbortSignal.timeout(45000),
      })
      if (data?.event) {
        setSelectedEvent(data.event)
      } else {
        await handleViewEvent(eventId)
      }
      await fetchEvents(true)
    } catch (e) {
      toast.error(`二次核对失败: ${e.message}`)
    } finally {
      setVerifyingEventId(null)
    }
  }

  const handleViewVerificationContext = async (eventId) => {
    try {
      const data = await fetchJsonOrThrow(`${API_BASE}/events/${eventId}/verification-context`, {
        signal: AbortSignal.timeout(15000),
      })
      setVerificationPreview(data)
    } catch (e) {
      toast.error(`加载核对上下文失败: ${e.message}`)
    }
  }

  const activeFilterCount = [filterStatus, ownerLocked ? '' : filterOwner, filterEventKey].filter(Boolean).length

  return (
    <div className="flex flex-col h-full" style={{ background: WA.lightBg }}>
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 md:px-6 py-4 md:py-5 border-b" style={{ background: WA.white, borderColor: WA.borderLight }}>
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <div className="w-10 h-10 rounded-full flex items-center justify-center text-white text-sm font-bold shrink-0" style={{ background: WA.teal }}>
            E
          </div>
          <div className="min-w-0">
            <div className="text-[18px] md:text-[20px] font-semibold leading-none truncate" style={{ color: WA.textDark }}>事件管理</div>
            <div className="text-[12px] md:text-[13px] mt-1" style={{ color: WA.textMuted }}>
              {total} 个事件
            </div>
          </div>
        </div>
        <div className="flex gap-2 shrink-0">
          <button
            onClick={() => fetchEvents()}
            disabled={loading}
            className="rounded-full text-[12px] font-semibold whitespace-nowrap"
            style={{ minHeight: 40, padding: '0 14px', background: WA.white, color: WA.textDark, border: `1px solid ${WA.borderLight}` }}
          >
            {loading ? '刷新中…' : '刷新'}
          </button>
          <button
            onClick={() => setShowCreate(true)}
            className="rounded-full text-[12px] font-semibold text-white whitespace-nowrap"
            style={{ minHeight: 40, padding: '0 16px', background: WA.teal }}
          >
            + 新建事件
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="px-6 py-4 border-b flex items-center gap-2 flex-wrap" style={{ background: WA.white, borderColor: WA.borderLight }}>
        <select
          value={filterStatus}
          onChange={e => setFilterStatus(e.target.value)}
          className="text-[13px] px-3 py-2.5 rounded-full border focus:outline-none"
          style={{ borderColor: filterStatus ? WA.teal + '50' : WA.borderLight, color: filterStatus ? WA.textDark : WA.textMuted }}
        >
          <option value="">全部状态</option>
          {Object.entries(STATUS_LABELS).map(([k, v]) => (
            <option key={k} value={k}>{v.label}</option>
          ))}
        </select>
        <select
          value={filterOwner}
          onChange={e => setFilterOwner(e.target.value)}
          disabled={ownerLocked}
          className="text-[13px] px-3 py-2.5 rounded-full border focus:outline-none"
          style={{
            borderColor: filterOwner ? WA.teal + '50' : WA.borderLight,
            color: filterOwner ? WA.textDark : WA.textMuted,
            background: ownerLocked ? WA.shellPanelMuted : WA.white,
            opacity: ownerLocked ? 0.92 : 1,
          }}
        >
          <option value="">{ownerLocked ? '当前负责人' : '全部负责人'}</option>
          {ownerOptions.map(owner => (
            <option key={owner} value={owner}>{owner}</option>
          ))}
        </select>
        <select
          value={filterEventKey}
          onChange={e => setFilterEventKey(e.target.value)}
          className="text-[13px] px-3 py-2.5 rounded-full border focus:outline-none"
          style={{ borderColor: filterEventKey ? WA.teal + '50' : WA.borderLight, color: filterEventKey ? WA.textDark : WA.textMuted }}
        >
          <option value="">全部类型</option>
          {Object.entries(EVENT_TYPE_LABELS).map(([k, v]) => (
            <option key={k} value={k}>{v.label}</option>
          ))}
        </select>
        {activeFilterCount > 0 && (
          <button
            onClick={() => {
              setFilterStatus('')
              setFilterOwner(ownerLocked ? lockedOwner : '')
              setFilterEventKey('')
            }}
            className="text-[12px] px-3 py-2 rounded-full font-medium"
            style={{ color: '#ef4444', background: 'rgba(239,68,68,0.08)' }}
          >
            🗑 清除
          </button>
        )}
        <div className="ml-auto hidden md:block text-[12px] font-medium px-3 py-2 rounded-full" style={{ background: WA.shellPanelMuted, color: WA.textMuted }}>
          看板模式 · 两列事件卡
        </div>
      </div>

      {/* Content */}
      <div ref={contentScrollRef} className="flex-1 overflow-y-auto docs-scrollbar p-4">
          {loading && events.length === 0 ? (
            <div className="flex items-center justify-center py-16" style={{ color: WA.textMuted }}>
              <span>⏳ 加载中...</span>
            </div>
          ) : events.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3" style={{ color: WA.textMuted }}>
              <span className="text-3xl">📋</span>
              <span className="text-sm">暂无事件</span>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
            {events.map(event => {
              const isSelected = selectedEvent?.id === event.id
              const displayEvent = isSelected && selectedEvent?.id === event.id ? { ...event, ...selectedEvent } : event
              const typeInfo = EVENT_TYPE_LABELS[displayEvent.event_key] || { label: displayEvent.event_key, color: '#94a3b8', bg: 'rgba(148,163,184,0.15)' }
              const statusInfo = STATUS_LABELS[displayEvent.status] || { label: displayEvent.status, color: '#94a3b8', bg: 'rgba(148,163,184,0.15)' }
              const ownerColor = getOwnerColor(displayEvent.owner)
              const meta = parseEventMeta(displayEvent.meta)
              const verificationMeta = meta.verification || meta.llm_verification || {}
              const verificationStatus = displayEvent.verification_status || verificationMeta.review_status || 'pending'
              const verificationInfo = VERIFICATION_LABELS[verificationStatus] || VERIFICATION_LABELS.pending
              const reviewState = displayEvent.review_state || (displayEvent.status === 'draft' ? 'pending' : 'unreviewed')
              const reviewInfo = REVIEW_LABELS[reviewState] || REVIEW_LABELS.unreviewed
              const evidenceTier = Number(displayEvent.evidence_tier ?? meta?.evidence_contract?.evidence_tier ?? 0)
              const evidenceRows = Array.isArray(displayEvent.evidence) ? displayEvent.evidence : []
              const isTier0Draft = displayEvent.status === 'draft' && evidenceTier === 0
              const transitionSuggestion = displayEvent.transition_suggestion || verificationMeta.transition_suggestion || null
              const sourcePreview = displayEvent.trigger_text || meta.source_text || meta.note || '暂无原始触发文本'
              const displayStartAt = displayEvent.display_start_at || displayEvent.created_at || displayEvent.start_at || null
              const displayStartLabel = displayEvent.display_start_label || (displayEvent.source_message_timestamp ? '原始消息时间' : displayEvent.created_at ? '识别时间' : '开始时间')
              const jumpPayload = {
                eventId: displayEvent.id,
                creatorId: displayEvent.creator_id,
                triggerText: displayEvent.trigger_text || '',
                sourceText: displayEvent.source_message_text || sourcePreview,
                sourceMessageId: displayEvent.source_message_id || null,
                sourceMessageTimestamp: displayEvent.source_message_timestamp || null,
                displayStartAt,
                eventKey: displayEvent.event_key,
                returnScrollTop: contentScrollRef.current?.scrollTop || 0,
              }
              const isFlashing = flashEventId === Number(displayEvent.id)

              return (
                <article
                  key={displayEvent.id}
                  ref={(node) => {
                    if (node) eventCardRefs.current.set(Number(displayEvent.id), node)
                    else eventCardRefs.current.delete(Number(displayEvent.id))
                  }}
                  onClick={() => handleViewEvent(displayEvent.id)}
                  className="p-5 cursor-pointer transition-all rounded-[24px] space-y-4"
                  style={{
                    border: `1px solid ${isSelected ? 'rgba(0,168,132,0.28)' : WA.borderLight}`,
                    background: isSelected || isFlashing ? 'rgba(0,168,132,0.08)' : WA.white,
                    boxShadow: isFlashing
                      ? '0 0 0 3px rgba(0,168,132,0.18), 0 14px 34px rgba(0,168,132,0.16)'
                      : isSelected
                        ? '0 10px 26px rgba(0,168,132,0.08)'
                        : '0 2px 8px rgba(15,23,42,0.03)',
                  }}
                  onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = WA.hover }}
                  onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = WA.white }}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-1.5 flex-wrap min-w-0 flex-1">
                      <span className="text-[11px] px-2.5 py-0.5 rounded-full font-semibold whitespace-nowrap" style={{ background: typeInfo.bg, color: typeInfo.color }}>
                        {typeInfo.label}
                      </span>
                      <span className="text-[11px] px-2.5 py-0.5 rounded-full font-semibold whitespace-nowrap" style={{ background: statusInfo.bg, color: statusInfo.color }}>
                        {statusInfo.label}
                      </span>
                      <span className="text-[11px] px-2.5 py-0.5 rounded-full font-semibold whitespace-nowrap" style={{ background: ownerColor + '16', color: ownerColor }}>
                        {displayEvent.owner}
                      </span>
                      <span className="text-[11px] px-2.5 py-0.5 rounded-full font-semibold whitespace-nowrap" style={{ background: verificationInfo.bg, color: verificationInfo.color }}>
                        {verificationInfo.label}
                      </span>
                      <span className="text-[11px] px-2.5 py-0.5 rounded-full font-semibold whitespace-nowrap" style={{ background: reviewInfo.bg, color: reviewInfo.color }}>
                        {reviewInfo.label}
                      </span>
                      <span className="text-[11px] px-2.5 py-0.5 rounded-full font-semibold whitespace-nowrap" style={{ background: evidenceTier >= 2 ? 'rgba(16,185,129,0.12)' : 'rgba(100,116,139,0.12)', color: evidenceTier >= 2 ? '#0f766e' : '#64748b' }}>
                        {getTierLabel(evidenceTier)}
                      </span>
                    </div>
                    <span className="text-[11px] shrink-0 whitespace-nowrap" style={{ color: WA.textMuted }}>
                      {displayStartAt ? formatDateCN(displayStartAt) : '-'}
                    </span>
                  </div>

                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div
                        className="text-[18px] md:text-[22px] font-semibold tracking-[-0.03em] break-words"
                        style={{ color: WA.textDark, wordBreak: 'break-word', overflowWrap: 'anywhere' }}
                        title={displayEvent.creator_name || `达人 #${displayEvent.creator_id}`}
                      >
                        {displayEvent.creator_name || `达人 #${displayEvent.creator_id}`}
                      </div>
                      <div className="text-[12px] md:text-[13px] mt-1 truncate" style={{ color: WA.textMuted }}>
                        {formatTriggerSource(displayEvent.trigger_source)} · {displayEvent.creator_phone || '-'}
                      </div>
                    </div>
                    {meta.bonus_per_video ? (
                      <div className="shrink-0 rounded-full px-2.5 py-1 font-semibold" style={{ background: 'rgba(16,185,129,0.12)', color: '#10b981', fontSize: 11, whiteSpace: 'nowrap' }}>
                        ${meta.bonus_per_video}/条
                      </div>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      onOpenCreatorChat?.(jumpPayload)
                    }}
                    className="w-full text-left rounded-[20px] p-4 space-y-2 transition-all"
                    style={{ background: WA.shellPanelMuted, border: `1px solid ${WA.borderLight}` }}
                    title="打开原始达人聊天并定位到相关消息"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-[11px] font-semibold tracking-[0.08em] uppercase" style={{ color: WA.textMuted }}>
                        原始信源
                      </div>
                      <span className="text-[12px] font-semibold" style={{ color: WA.teal }}>
                        打开原始聊天 →
                      </span>
                    </div>
                    <div className="text-[13px]" style={{ color: WA.textMuted }}>
                      {formatTriggerSource(displayEvent.trigger_source)}
                    </div>
                    <div className="text-[14px] leading-6" style={{ color: WA.textDark }}>
                      {sourcePreview}
                    </div>
                    {displayEvent.source_message_text ? (
                      <div className="text-[12px] leading-5 rounded-[14px] px-3 py-2" style={{ color: WA.textMuted, background: WA.white, border: `1px solid ${WA.borderLight}` }}>
                        命中原始消息: {displayEvent.source_message_text}
                      </div>
                    ) : (
                      <div className="text-[12px]" style={{ color: WA.textMuted }}>
                        当前按 source anchor 回溯上下文；如无精确锚点则回退到最近相关消息。
                      </div>
                    )}
                  </button>

                  <div className="grid grid-cols-2 gap-3">
                    <InfoCard label={displayStartLabel} value={displayStartAt ? formatDateTimeCN(displayStartAt) : '-'} />
                    <InfoCard label="结束时间" value={displayEvent.end_at ? formatDateTimeCN(displayEvent.end_at) : '进行中'} />
                  </div>

                  {isSelected && (
                    <div className="space-y-4 pt-2">
                      <div className="rounded-[20px] p-4 space-y-3" style={{ background: WA.white, border: `1px solid ${WA.borderLight}` }}>
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="text-[11px] font-semibold tracking-[0.08em] uppercase" style={{ color: WA.textMuted }}>证据与人工审核</div>
                            <div className="text-[14px] mt-1" style={{ color: WA.textDark }}>
                              {reviewInfo.label} · {getTierLabel(evidenceTier)} · {displayEvent.source_kind || 'unknown'}
                            </div>
                          </div>
                          {isTier0Draft ? (
                            <div className="flex flex-wrap gap-2 justify-end">
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  handleReviewEvent(displayEvent.id, 'confirm')
                                }}
                                className="px-3 py-1.5 rounded-full text-[12px] font-semibold text-white"
                                style={{ background: '#10b981' }}
                              >
                                人工确认
                              </button>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  handleReviewEvent(displayEvent.id, 'uncertain')
                                }}
                                className="px-3 py-1.5 rounded-full text-[12px] font-semibold"
                                style={{ background: WA.shellPanelMuted, color: WA.textDark, border: `1px solid ${WA.borderLight}` }}
                              >
                                证据不足
                              </button>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  handleReviewEvent(displayEvent.id, 'reject')
                                }}
                                className="px-3 py-1.5 rounded-full text-[12px] font-semibold text-white"
                                style={{ background: '#ef4444' }}
                              >
                                驳回
                              </button>
                            </div>
                          ) : null}
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                          <InfoCard compact label="规范事件" value={displayEvent.canonical_event_key || displayEvent.event_key || '-'} />
                          <InfoCard compact label="影响" value={displayEvent.lifecycle_effect || 'none'} />
                          <InfoCard compact label="业务时间" value={displayEvent.source_event_at ? formatDateTimeCN(displayEvent.source_event_at) : '-'} />
                        </div>
                        {evidenceRows.length > 0 ? (
                          <div className="space-y-2">
                            {evidenceRows.slice(0, 2).map(row => (
                              <div key={row.id || `${row.source_kind}-${row.created_at}`} className="rounded-[14px] px-3 py-2 text-[12px] leading-5" style={{ color: WA.textMuted, background: WA.shellPanelMuted, border: `1px solid ${WA.borderLight}` }}>
                                <div className="font-semibold" style={{ color: WA.textDark }}>{row.source_kind || 'source'} · {row.source_table || 'event'}</div>
                                <div>{row.source_quote || '暂无证据原文'}</div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="text-[12px]" style={{ color: WA.textMuted }}>
                            暂无结构化 evidence 记录。
                          </div>
                        )}
                      </div>

                      <div className="rounded-[20px] p-4 space-y-3" style={{ background: WA.white, border: `1px solid ${WA.borderLight}` }}>
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="text-[11px] font-semibold tracking-[0.08em] uppercase" style={{ color: WA.textMuted }}>二次语义核对</div>
                            <div className="text-[14px] mt-1" style={{ color: WA.textDark }}>
                              {verificationInfo.label}
                              {displayEvent.verification_confidence ? ` · 置信度 ${displayEvent.verification_confidence}/5` : ''}
                            </div>
                          </div>
                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation()
                                handleViewVerificationContext(displayEvent.id)
                              }}
                              className="px-3 py-1.5 rounded-full text-[12px] font-medium"
                              style={{ background: WA.shellPanelMuted, color: WA.textDark, border: `1px solid ${WA.borderLight}` }}
                            >
                              查看上下文
                            </button>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation()
                                handleVerify(displayEvent.id)
                              }}
                              disabled={verifyingEventId === displayEvent.id}
                              className="px-3 py-1.5 rounded-full text-[12px] font-semibold text-white disabled:opacity-60"
                              style={{ background: WA.teal }}
                            >
                              {verifyingEventId === displayEvent.id ? '核对中...' : 'OpenAI 二次核对'}
                            </button>
                          </div>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          <InfoCard compact label="建议事件" value={displayEvent.verification_event_key || displayEvent.event_key || '-'} />
                          <InfoCard compact label="建议状态" value={displayEvent.verification_suggested_status || '-'} />
                        </div>
                        <div className="text-[13px] leading-6" style={{ color: WA.textMuted }}>
                          {displayEvent.verification_reason || '当前还没有二次核对结论。'}
                        </div>
                        {displayEvent.verification_quote ? (
                          <div className="text-[12px] leading-5 rounded-[14px] px-3 py-2" style={{ color: WA.textMuted, background: WA.shellPanelMuted, border: `1px solid ${WA.borderLight}` }}>
                            证据原句: {displayEvent.verification_quote}
                          </div>
                        ) : null}
                        {transitionSuggestion?.suggested ? (
                          <div className="text-[12px] leading-5 rounded-[14px] px-3 py-2" style={{ color: '#92400e', background: 'rgba(245,158,11,0.10)', border: '1px solid rgba(245,158,11,0.22)' }}>
                            建议流转：{transitionSuggestion.from_status} → {transitionSuggestion.to_status}。当前仅为模型建议，仍需人工复核后再正式流转。
                          </div>
                        ) : null}
                      </div>

                      {selectedEvent?.policy && (
                        <div className="rounded-[20px] p-4 space-y-2" style={{ background: WA.white, border: `1px solid ${WA.borderLight}` }}>
                          <div className="text-[11px] font-semibold tracking-[0.08em] uppercase" style={{ color: WA.textMuted }}>策略配置</div>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                            {Object.entries(selectedEvent.policy).map(([k, v]) => (
                              <InfoCard key={k} label={k} value={String(v)} compact />
                            ))}
                          </div>
                        </div>
                      )}

                      {selectedEvent?.periods && selectedEvent.periods.length > 0 && (
                        <div className="rounded-[20px] p-4 space-y-3" style={{ background: WA.white, border: `1px solid ${WA.borderLight}` }}>
                          <div className="text-[11px] font-semibold tracking-[0.08em] uppercase" style={{ color: WA.textMuted }}>周期记录</div>
                          <div className="grid grid-cols-1 gap-3">
                            {selectedEvent.periods.map(p => (
                              <div key={p.id} className="rounded-[18px] p-3" style={{ background: WA.shellPanelMuted, border: `1px solid ${WA.borderLight}` }}>
                                <div className="flex justify-between items-center mb-2">
                                  <span className="text-[12px] font-medium" style={{ color: WA.textMuted }}>
                                    {formatDateCN(p.period_start)} – {formatDateCN(p.period_end)}
                                  </span>
                                  <span className={`text-[12px] px-2.5 py-1 rounded-full font-semibold ${p.status === 'settled' ? 'text-green-600 bg-green-50' : 'text-yellow-600 bg-yellow-50'}`}>
                                    {p.status === 'settled' ? '✓ 已结算' : '⏳ 待结算'}
                                  </span>
                                </div>
                                <div className="flex justify-between text-[13px]">
                                  <span style={{ color: WA.textMuted }}>发布 {p.video_count} 条</span>
                                  <span style={{ color: '#10b981', fontWeight: 700 }}>{p.bonus_earned > 0 ? `+$${p.bonus_earned}` : '无 Bonus'}</span>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {judgeResult && selectedEvent?.id === displayEvent.id && (
                        <div className="rounded-[20px] p-4" style={{ background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.2)' }}>
                          <div className="text-[11px] font-bold mb-2 tracking-[0.08em] uppercase" style={{ color: '#10b981' }}>判定结果</div>
                          <div className="grid grid-cols-3 gap-2">
                            <InfoCard label="视频数" value={judgeResult.video_count} compact />
                            <InfoCard label="目标" value={`≥ ${judgeResult.weekly_target}`} compact />
                            <InfoCard label="Bonus" value={judgeResult.bonus_earned > 0 ? `$${judgeResult.bonus_earned}` : '无'} compact />
                          </div>
                        </div>
                      )}

                      <div className="flex flex-wrap gap-2">
                        <ActionBtn
                          label="🧠 二次核对"
                          color={WA.teal}
                          onClick={() => handleVerify(selectedEvent.id)}
                          loading={verifyingEventId === selectedEvent.id}
                        />
                        <ActionBtn
                          label="🗂 查看上下文"
                          color="#64748b"
                          onClick={() => handleViewVerificationContext(selectedEvent.id)}
                        />
                        {selectedEvent?.status === 'draft' && (
                          <>
                            <ActionBtn label={isTier0Draft ? "确认入库" : (transitionSuggestion?.suggested ? "人工确认流转" : "确认激活")} color="#10b981" onClick={() => isTier0Draft ? handleReviewEvent(selectedEvent.id, 'confirm') : handleStatusChange(selectedEvent.id, 'active')} />
                            <ActionBtn label="驳回" color="#ef4444" onClick={() => isTier0Draft ? handleReviewEvent(selectedEvent.id, 'reject') : handleStatusChange(selectedEvent.id, 'cancelled')} />
                          </>
                        )}
                        {selectedEvent?.status === 'active' && (
                          <>
                            <ActionBtn label="📊 判定 Bonus" color="#f59e0b" onClick={() => handleJudge(selectedEvent.id)} loading={judging} />
                            <ActionBtn label="🏁 标记完成" color="#8b5cf6" onClick={() => handleStatusChange(selectedEvent.id, 'completed')} />
                            <ActionBtn label="❌ 取消" color="#ef4444" onClick={() => handleStatusChange(selectedEvent.id, 'cancelled')} />
                          </>
                        )}
                      </div>

                      {selectedEvent?.status === 'active' && (
                        <div className="rounded-[20px] p-4 space-y-3" style={{ background: WA.white, border: `1px solid ${WA.borderLight}` }}>
                          <div className="text-[11px] font-semibold tracking-[0.08em] uppercase" style={{ color: WA.textMuted }}>快速判定</div>
                          <JudgeQuickForm
                            eventId={selectedEvent.id}
                            policy={selectedEvent.policy}
                            onJudge={(result) => setJudgeResult(result)}
                            onClose={() => {}}
                          />
                        </div>
                      )}
                    </div>
                  )}
                </article>
              )
            })}
            </div>
          )}
      </div>

      {/* Create modal */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-2xl overflow-hidden" style={{ background: WA.white }}>
            <div className="flex items-center justify-between px-6 py-4" style={{ background: WA.darkHeader }}>
              <div className="flex items-center gap-3">
                <span className="text-lg">📋</span>
                <span className="font-semibold text-white">新建事件</span>
              </div>
              <button onClick={() => setShowCreate(false)} className="text-white/60 hover:text-white text-xl">✕</button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-semibold mb-1.5" style={{ color: WA.textMuted }}>达人</label>
                <select
                  className="w-full text-sm px-3 py-2.5 rounded-xl border focus:outline-none"
                  style={{ borderColor: WA.borderLight, background: WA.lightBg }}
                  value={createForm.creator_id}
                  onChange={e => setCreateForm(f => ({ ...f, creator_id: e.target.value }))}
                >
                  <option value="">选择达人...</option>
                  {creators.map(c => (
                    <option key={c.id} value={c.id}>{c.primary_name} ({c.wa_owner})</option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold mb-1.5" style={{ color: WA.textMuted }}>事件类型</label>
                  <select
                    className="w-full text-sm px-3 py-2.5 rounded-xl border focus:outline-none"
                    style={{ borderColor: WA.borderLight, background: WA.lightBg }}
                    value={createForm.event_key}
                    onChange={e => {
                      const key = e.target.value
                      const typeMap = {
                        trial_7day: 'challenge',
                        monthly_challenge: 'challenge',
                        agency_bound: 'agency',
                        gmv_milestone: 'gmv',
                        referral: 'referral',
                        incentive_task: 'incentive',
                        recall_pending: 'followup',
                        second_touch: 'followup',
                      }
                      setCreateForm(f => ({ ...f, event_key: key, event_type: typeMap[key] || 'challenge' }))
                    }}
                  >
                    {createEventEntries.map(([k, v]) => (
                      <option key={k} value={k}>{v.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-1.5" style={{ color: WA.textMuted }}>负责人</label>
                  <select
                    className="w-full text-sm px-3 py-2.5 rounded-xl border focus:outline-none"
                    style={{
                      borderColor: WA.borderLight,
                      background: ownerLocked || !!selectedCreator ? WA.shellPanelMuted : WA.lightBg,
                    }}
                    value={createForm.owner}
                    onChange={e => setCreateForm(f => ({ ...f, owner: e.target.value }))}
                    disabled={ownerLocked || !!selectedCreator}
                  >
                    {ownerOptions.map(owner => (
                      <option key={owner} value={owner}>{owner}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold mb-1.5" style={{ color: WA.textMuted }}>开始时间</label>
                  <input
                    type="datetime-local"
                    className="w-full text-sm px-3 py-2.5 rounded-xl border focus:outline-none"
                    style={{ borderColor: WA.borderLight, background: WA.lightBg }}
                    value={createForm.start_at}
                    onChange={e => setCreateForm(f => ({ ...f, start_at: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-1.5" style={{ color: WA.textMuted }}>结束时间（可选）</label>
                  <input
                    type="datetime-local"
                    className="w-full text-sm px-3 py-2.5 rounded-xl border focus:outline-none"
                    style={{ borderColor: WA.borderLight, background: WA.lightBg }}
                    value={createForm.end_at}
                    onChange={e => setCreateForm(f => ({ ...f, end_at: e.target.value }))}
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1.5" style={{ color: WA.textMuted }}>触发文本（可选）</label>
                <input
                  className="w-full text-sm px-3 py-2.5 rounded-xl border focus:outline-none"
                  style={{ borderColor: WA.borderLight, background: WA.lightBg }}
                  value={createForm.trigger_text}
                  onChange={e => setCreateForm(f => ({ ...f, trigger_text: e.target.value }))}
                  placeholder="记录触发时的原始语义..."
                />
              </div>
            </div>
            <div className="flex gap-3 px-6 pb-6">
              <button
                onClick={() => setShowCreate(false)}
                className="flex-1 py-2.5 rounded-xl text-sm font-medium border"
                style={{ borderColor: WA.borderLight, color: WA.textMuted }}
              >
                取消
              </button>
              <button
                onClick={handleCreate}
                disabled={!createForm.creator_id}
                className="flex-1 py-2.5 rounded-xl text-sm font-bold text-white disabled:opacity-50"
                style={{ background: WA.teal }}
              >
                创建
              </button>
            </div>
          </div>
        </div>
      )}

      {verificationPreview && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="w-full max-w-3xl rounded-2xl overflow-hidden" style={{ background: WA.white }}>
            <div className="flex items-center justify-between px-6 py-4" style={{ background: WA.darkHeader }}>
              <div className="flex items-center gap-3">
                <span className="text-lg">🧠</span>
                <span className="font-semibold text-white">核对上下文</span>
              </div>
              <button onClick={() => setVerificationPreview(null)} className="text-white/60 hover:text-white text-xl">✕</button>
            </div>
            <div className="p-6 space-y-4 max-h-[75vh] overflow-y-auto docs-scrollbar">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <InfoCard compact label="事件ID" value={verificationPreview.event_id || '-'} />
                <InfoCard compact label="锚点消息" value={verificationPreview.source_anchor?.message_id || '-'} />
                <InfoCard compact label="锚点解析" value={verificationPreview.source_anchor?.resolution || '-'} />
              </div>
              <div className="text-[12px]" style={{ color: WA.textMuted }}>
                使用消息数: {verificationPreview.stats?.used_count || 0}，前文 {verificationPreview.stats?.before_count || 0} 条，后文 {verificationPreview.stats?.after_count || 0} 条
              </div>
              <div className="space-y-3">
                {(verificationPreview.messages || []).map((message) => (
                  <div key={message.id} className="rounded-[18px] px-4 py-3" style={{ background: WA.shellPanelMuted, border: `1px solid ${WA.borderLight}` }}>
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-[12px] font-semibold" style={{ color: message.role === 'me' ? WA.teal : WA.textDark }}>
                        {message.role === 'me' ? '运营' : '达人'} · #{message.id}
                      </span>
                      <span className="text-[12px]" style={{ color: WA.textMuted }}>
                        {formatDateTimeCN(message.timestamp)}
                      </span>
                    </div>
                    <div className="text-[14px] leading-6 mt-2" style={{ color: WA.textDark }}>
                      {message.text || '[空消息]'}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function parseEventMeta(raw) {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw
  try {
    return raw ? JSON.parse(raw) : {}
  } catch (_) {
    return {}
  }
}

function formatTriggerSource(value) {
  if (value === 'semantic_auto') return '🤖 语义自动'
  if (value === 'gmv_crosscheck') return '📊 GMV核对'
  if (value === 'manual') return '✏️ 手动创建'
  return value || '未标注来源'
}

function InfoCard({ label, value, compact = false }) {
  return (
    <div
      className={compact ? 'rounded-[16px] px-3 py-2.5' : 'rounded-[18px] px-3 py-3'}
      style={{ background: WA.shellPanelMuted, border: `1px solid ${WA.borderLight}` }}
    >
      <div className="text-[11px] font-semibold tracking-[0.08em] uppercase" style={{ color: WA.textMuted }}>{label}</div>
      <div className={compact ? 'text-[13px] mt-1 font-semibold' : 'text-[14px] mt-1.5 font-semibold'} style={{ color: WA.textDark }}>{value}</div>
    </div>
  )
}

function ActionBtn({ label, color, onClick, loading }) {
  return (
    <button
      onClick={onClick}
      disabled={loading}
      className="flex items-center gap-2 px-4 py-2.5 rounded-full text-[13px] font-medium transition-all hover:opacity-80 disabled:opacity-50"
      style={{ background: color + '18', color }}
    >
      <span>{loading ? '⏳' : label.split(' ')[0]}</span>
      <span>{label.split(' ').slice(1).join(' ')}</span>
    </button>
  )
}
