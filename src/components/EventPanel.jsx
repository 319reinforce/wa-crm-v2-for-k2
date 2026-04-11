import React, { useState, useEffect, useCallback } from 'react'
import JudgeQuickForm from './JudgeQuickForm'
import { OWNER_ORDER, getOwnerColor } from '../utils/operators'
import { fetchJsonOrThrow, fetchOkOrThrow } from '../utils/api'

const API_BASE = '/api';

const WA = {
  darkHeader: '#111b21',
  teal: '#00a884',
  tealDark: '#008069',
  lightBg: '#f0f2f5',
  chatBg: '#efeae2',
  white: '#ffffff',
  borderLight: '#e9edef',
  textDark: '#111b21',
  textMuted: '#667781',
  hover: '#f5f6f6',
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
  pending: { label: '待确认', color: '#f59e0b', bg: 'rgba(245,158,11,0.15)' },
  active: { label: '进行中', color: '#10b981', bg: 'rgba(16,185,129,0.15)' },
  completed: { label: '已完成', color: '#94a3b8', bg: 'rgba(148,163,184,0.15)' },
  cancelled: { label: '已取消', color: '#ef4444', bg: 'rgba(239,68,68,0.15)' },
}

const OWNER_OPTIONS = OWNER_ORDER

export function EventPanel() {
  const [events, setEvents] = useState([])
  const [loading, setLoading] = useState(true)
  const [total, setTotal] = useState(0)
  const [filterStatus, setFilterStatus] = useState('')
  const [filterOwner, setFilterOwner] = useState('')
  const [filterEventKey, setFilterEventKey] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [creators, setCreators] = useState([])
  const [selectedEvent, setSelectedEvent] = useState(null)
  const [judging, setJudging] = useState(false)
  const [judgeResult, setJudgeResult] = useState(null)

  // 创建表单
  const [createForm, setCreateForm] = useState({
    creator_id: '',
    event_key: 'trial_7day',
    event_type: 'challenge',
    owner: OWNER_OPTIONS[0],
    trigger_source: 'manual',
    trigger_text: '',
    start_at: new Date().toISOString().slice(0, 16),
    end_at: '',
  })
  const selectedCreator = creators.find(c => String(c.id) ***REMOVED***= String(createForm.creator_id))
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
      const data = await fetchJsonOrThrow(`${API_BASE}/creators?limit=500`, { signal: AbortSignal.timeout(15000) })
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
    if (!selectedCreator) return
    if (selectedAgencyBound && agencyOnlyKeys.has(createForm.event_key)) {
      setCreateForm(f => ({ ...f, event_key: 'trial_7day', event_type: 'challenge' }))
    }
  }, [selectedCreator, selectedAgencyBound, createForm.event_key])

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
        owner: OWNER_OPTIONS[0],
        trigger_source: 'manual',
        trigger_text: '',
        start_at: new Date().toISOString().slice(0, 16),
        end_at: '',
      })
      fetchEvents()
    } catch (e) {
      alert('创建失败: ' + e.message)
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
      if (selectedEvent?.id ***REMOVED***= eventId) {
        const data = await fetchJsonOrThrow(`${API_BASE}/events/${eventId}`, { signal: AbortSignal.timeout(15000) })
        setSelectedEvent(data)
      }
    } catch (e) {
      console.error('handleStatusChange error:', e)
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
      const event = events.find(e => e.id ***REMOVED***= eventId)
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
      const data = await fetchJsonOrThrow(`${API_BASE}/events/${eventId}`, { signal: AbortSignal.timeout(15000) })
      setSelectedEvent(data)
      setJudgeResult(null)
    } catch (e) {
      console.error('handleViewEvent error:', e)
    }
  }

  const activeFilterCount = [filterStatus, filterOwner, filterEventKey].filter(Boolean).length

  return (
    <div className="flex flex-col h-full" style={{ background: WA.lightBg }}>
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4" style={{ background: WA.darkHeader }}>
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-full flex items-center justify-center text-white text-sm font-bold" style={{ background: WA.teal }}>
            E
          </div>
          <div>
            <div className="text-base font-semibold text-white leading-none">事件管理</div>
            <div className="text-xs mt-0.5" style={{ color: 'rgba(255,255,255,0.4)' }}>
              {total} 个事件
            </div>
          </div>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => fetchEvents()}
            disabled={loading}
            className="px-3 py-1.5 rounded-lg text-xs font-medium"
            style={{ background: 'rgba(255,255,255,0.15)', color: 'white' }}
          >
            {loading ? '⏳' : '🔄'}
          </button>
          <button
            onClick={() => setShowCreate(true)}
            className="px-4 py-1.5 rounded-lg text-xs font-semibold text-white"
            style={{ background: WA.teal }}
          >
            + 新建事件
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="px-4 py-3 border-b flex items-center gap-2 flex-wrap" style={{ background: WA.white, borderColor: WA.borderLight }}>
        <select
          value={filterStatus}
          onChange={e => setFilterStatus(e.target.value)}
          className="text-sm px-3 py-2 rounded-xl border focus:outline-none"
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
          className="text-sm px-3 py-2 rounded-xl border focus:outline-none"
          style={{ borderColor: filterOwner ? WA.teal + '50' : WA.borderLight, color: filterOwner ? WA.textDark : WA.textMuted }}
        >
          <option value="">全部负责人</option>
          {OWNER_OPTIONS.map(owner => (
            <option key={owner} value={owner}>{owner}</option>
          ))}
        </select>
        <select
          value={filterEventKey}
          onChange={e => setFilterEventKey(e.target.value)}
          className="text-sm px-3 py-2 rounded-xl border focus:outline-none"
          style={{ borderColor: filterEventKey ? WA.teal + '50' : WA.borderLight, color: filterEventKey ? WA.textDark : WA.textMuted }}
        >
          <option value="">全部类型</option>
          {Object.entries(EVENT_TYPE_LABELS).map(([k, v]) => (
            <option key={k} value={k}>{v.label}</option>
          ))}
        </select>
        {activeFilterCount > 0 && (
          <button
            onClick={() => { setFilterStatus(''); setFilterOwner(''); setFilterEventKey(''); }}
            className="text-xs px-3 py-2 rounded-xl font-medium"
            style={{ color: '#ef4444', background: 'rgba(239,68,68,0.08)' }}
          >
            🗑 清除
          </button>
        )}
      </div>

      {/* Content: list + detail */}
      <div className="flex-1 overflow-hidden flex">
        {/* Event list */}
        <div className="flex-1 overflow-y-auto">
          {loading && events.length ***REMOVED***= 0 ? (
            <div className="flex items-center justify-center py-16" style={{ color: WA.textMuted }}>
              <span>⏳ 加载中...</span>
            </div>
          ) : events.length ***REMOVED***= 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3" style={{ color: WA.textMuted }}>
              <span className="text-3xl">📋</span>
              <span className="text-sm">暂无事件</span>
            </div>
          ) : (
            events.map(event => {
              const typeInfo = EVENT_TYPE_LABELS[event.event_key] || { label: event.event_key, color: '#94a3b8', bg: 'rgba(148,163,184,0.15)' }
              const statusInfo = STATUS_LABELS[event.status] || { label: event.status, color: '#94a3b8', bg: 'rgba(148,163,184,0.15)' }
              const ownerColor = getOwnerColor(event.owner)
              const isSelected = selectedEvent?.id ***REMOVED***= event.id

              return (
                <div
                  key={event.id}
                  onClick={() => handleViewEvent(event.id)}
                  className="px-5 py-4 cursor-pointer transition-all"
                  style={{
                    borderBottom: `1px solid ${WA.borderLight}`,
                    background: isSelected ? 'rgba(0,168,132,0.06)' : 'transparent',
                  }}
                  onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = WA.hover }}
                  onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = 'transparent' }}
                >
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-xs px-2.5 py-1 rounded-full font-semibold" style={{ background: typeInfo.bg, color: typeInfo.color }}>
                        {typeInfo.label}
                      </span>
                      <span className="text-xs px-2.5 py-1 rounded-full font-semibold" style={{ background: statusInfo.bg, color: statusInfo.color }}>
                        {statusInfo.label}
                      </span>
                    </div>
                    <span className="text-xs shrink-0" style={{ color: ownerColor, fontWeight: 600 }}>
                      {event.owner}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-sm font-semibold" style={{ color: WA.textDark }}>
                        {event.creator_name || `达人 #${event.creator_id}`}
                      </div>
                      <div className="text-xs mt-0.5" style={{ color: WA.textMuted }}>
                        {event.trigger_source ***REMOVED***= 'semantic_auto' ? '🤖 语义自动' : event.trigger_source ***REMOVED***= 'gmv_crosscheck' ? '📊 GMV核对' : '✏️ 手动'}
                        {event.start_at ? ` · ${new Date(event.start_at).toLocaleDateString('zh-CN')}` : ''}
                      </div>
                    </div>
                    <div className="text-right">
                      {event.meta && (() => {
                        try {
                          const m = JSON.parse(event.meta)
                          if (m.bonus_per_video) return <span className="text-xs font-semibold" style={{ color: '#10b981' }}>${m.bonus_per_video}/条</span>
                        } catch (_) {}
                        return null
                      })()}
                    </div>
                  </div>
                </div>
              )
            })
          )}
        </div>

        {/* Detail panel */}
        {selectedEvent && (
          <div
            className="w-80 shrink-0 overflow-y-auto border-l"
            style={{ background: WA.white, borderColor: WA.borderLight }}
          >
            <div className="p-5 space-y-4">
              {/* Detail header */}
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-base font-bold" style={{ color: WA.textDark }}>
                    {EVENT_TYPE_LABELS[selectedEvent.event_key]?.label || selectedEvent.event_key}
                  </div>
                  <div className="text-xs mt-0.5" style={{ color: WA.textMuted }}>
                    事件 #{selectedEvent.id}
                  </div>
                </div>
                <button onClick={() => setSelectedEvent(null)} className="text-lg" style={{ color: WA.textMuted }}>✕</button>
              </div>

              {/* Status badge */}
              <div className="flex items-center gap-2">
                <span className="text-xs px-3 py-1.5 rounded-full font-semibold" style={{
                  background: STATUS_LABELS[selectedEvent.status]?.bg,
                  color: STATUS_LABELS[selectedEvent.status]?.color,
                }}>
                  {STATUS_LABELS[selectedEvent.status]?.label || selectedEvent.status}
                </span>
                <span className="text-xs px-3 py-1.5 rounded-full font-semibold" style={{
                  background: getOwnerColor(selectedEvent.owner) + '20',
                  color: getOwnerColor(selectedEvent.owner),
                }}>
                  {selectedEvent.owner}
                </span>
              </div>

              {/* Creator info */}
              <div className="p-3 rounded-xl" style={{ background: WA.lightBg }}>
                <div className="text-xs font-semibold mb-1" style={{ color: WA.textMuted }}>达人</div>
                <div className="text-sm font-semibold" style={{ color: WA.textDark }}>
                  {selectedEvent.creator_name || `ID: ${selectedEvent.creator_id}`}
                </div>
                <div className="text-xs mt-0.5" style={{ color: WA.textMuted }}>{selectedEvent.creator_phone || '-'}</div>
              </div>

              {/* Time info */}
              <div className="space-y-2">
                <InfoRow label="开始时间" value={selectedEvent.start_at ? new Date(selectedEvent.start_at).toLocaleString('zh-CN') : '-'} />
                <InfoRow label="结束时间" value={selectedEvent.end_at ? new Date(selectedEvent.end_at).toLocaleString('zh-CN') : '进行中'} />
                <InfoRow label="触发来源" value={selectedEvent.trigger_source} />
              </div>

              {/* Trigger text */}
              {selectedEvent.trigger_text && (
                <div>
                  <div className="text-xs font-semibold mb-1.5" style={{ color: WA.textMuted }}>触发文本</div>
                  <div className="text-xs p-3 rounded-xl leading-relaxed" style={{ background: WA.lightBg, color: WA.textDark }}>
                    {selectedEvent.trigger_text}
                  </div>
                </div>
              )}

              {/* Policy */}
              {selectedEvent.policy && (
                <div>
                  <div className="text-xs font-semibold mb-1.5" style={{ color: WA.textMuted }}>策略配置</div>
                  <div className="text-xs p-3 rounded-xl space-y-1" style={{ background: WA.lightBg }}>
                    {Object.entries(selectedEvent.policy).map(([k, v]) => (
                      <div key={k} className="flex justify-between">
                        <span style={{ color: WA.textMuted }}>{k}</span>
                        <span className="font-semibold" style={{ color: WA.textDark }}>{String(v)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Periods */}
              {selectedEvent.periods && selectedEvent.periods.length > 0 && (
                <div>
                  <div className="text-xs font-semibold mb-2" style={{ color: WA.textMuted }}>周期记录</div>
                  <div className="space-y-2">
                    {selectedEvent.periods.map(p => (
                      <div key={p.id} className="p-3 rounded-xl" style={{ background: WA.lightBg }}>
                        <div className="flex justify-between items-center mb-1">
                          <span className="text-xs font-medium" style={{ color: WA.textMuted }}>
                            {new Date(p.period_start).toLocaleDateString('zh-CN')} – {new Date(p.period_end).toLocaleDateString('zh-CN')}
                          </span>
                          <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${p.status ***REMOVED***= 'settled' ? 'text-green-600 bg-green-50' : 'text-yellow-600 bg-yellow-50'}`}>
                            {p.status ***REMOVED***= 'settled' ? '✓ 已结算' : '⏳ 待结算'}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-xs" style={{ color: WA.textMuted }}>发布 {p.video_count} 条</span>
                          <span className="text-xs font-bold" style={{ color: '#10b981' }}>
                            {p.bonus_earned > 0 ? `+$${p.bonus_earned}` : '无 Bonus'}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Judge result */}
              {judgeResult && (
                <div className="p-3 rounded-xl" style={{ background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.2)' }}>
                  <div className="text-xs font-bold mb-2" style={{ color: '#10b981' }}>判定结果</div>
                  <div className="space-y-1 text-xs">
                    <div className="flex justify-between">
                      <span style={{ color: WA.textMuted }}>视频数</span>
                      <span className="font-semibold" style={{ color: WA.textDark }}>{judgeResult.video_count}</span>
                    </div>
                    <div className="flex justify-between">
                      <span style={{ color: WA.textMuted }}>目标</span>
                      <span className="font-semibold" style={{ color: WA.textDark }}>≥ {judgeResult.weekly_target} 条/周</span>
                    </div>
                    <div className="flex justify-between">
                      <span style={{ color: WA.textMuted }}>Bonus</span>
                      <span className="font-bold" style={{ color: '#10b981' }}>
                        {judgeResult.bonus_earned > 0 ? `$${judgeResult.bonus_earned}` : '无'}
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {/* Actions */}
              <div className="space-y-2 pt-2">
                {/* Status actions */}
                {selectedEvent.status ***REMOVED***= 'pending' && (
                  <>
                    <ActionBtn label="✅ 确认激活" color="#10b981" onClick={() => handleStatusChange(selectedEvent.id, 'active')} />
                    <ActionBtn label="❌ 取消" color="#ef4444" onClick={() => handleStatusChange(selectedEvent.id, 'cancelled')} />
                  </>
                )}
                {selectedEvent.status ***REMOVED***= 'active' && (
                  <>
                    <ActionBtn label="📊 判定 Bonus" color="#f59e0b" onClick={() => handleJudge(selectedEvent.id)} loading={judging} />
                    <ActionBtn label="🏁 标记完成" color="#8b5cf6" onClick={() => handleStatusChange(selectedEvent.id, 'completed')} />
                    <ActionBtn label="❌ 取消" color="#ef4444" onClick={() => handleStatusChange(selectedEvent.id, 'cancelled')} />
                  </>
                )}
                {selectedEvent.status ***REMOVED***= 'active' && (
                  <div className="pt-2">
                    <div className="text-xs font-semibold mb-2" style={{ color: WA.textMuted }}>快速判定</div>
                    <JudgeQuickForm
                      eventId={selectedEvent.id}
                      policy={selectedEvent.policy}
                      onJudge={(result) => setJudgeResult(result)}
                      onClose={() => {}}
                    />
                  </div>
                )}
              </div>
            </div>
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
                    style={{ borderColor: WA.borderLight, background: WA.lightBg }}
                  value={createForm.owner}
                  onChange={e => setCreateForm(f => ({ ...f, owner: e.target.value }))}
                >
                    {OWNER_OPTIONS.map(owner => (
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
    </div>
  )
}

// Quick judge form inline in detail panel

function InfoRow({ label, value }) {
  return (
    <div className="flex justify-between items-center py-1.5 px-3 rounded-lg" style={{ background: WA.lightBg }}>
      <span className="text-xs" style={{ color: WA.textMuted }}>{label}</span>
      <span className="text-xs font-semibold" style={{ color: WA.textDark }}>{value}</span>
    </div>
  )
}

function ActionBtn({ label, color, onClick, loading }) {
  return (
    <button
      onClick={onClick}
      disabled={loading}
      className="w-full flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all hover:opacity-80 disabled:opacity-50"
      style={{ background: color + '18', color }}
    >
      <span>{loading ? '⏳' : label.split(' ')[0]}</span>
      <span>{label.split(' ').slice(1).join(' ')}</span>
    </button>
  )
}
