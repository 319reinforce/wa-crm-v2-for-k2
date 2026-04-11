import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { WAMessageComposer } from './components/WAMessageComposer'
import { SFTDashboard } from './components/SFTDashboard'
import { EventPanel } from './components/EventPanel'
import { WorkerStatusBar } from './components/WorkerStatusBar'
import { CreatorDetail } from './components/CreatorDetail'
import { MobileEventTagsBar } from './components/MobileEventTagsBar'
import { buildAppAuthUrl } from './utils/appAuth'
import { fetchJsonOrThrow } from './utils/api'
import { getCreatorMessages, getCreatorStatusMeta } from './utils/creatorMeta'
import { buildOwnerOptions, getOwnerColor } from './utils/operators'
import { fetchWaAdmin } from './utils/waAdmin'
import WA from './utils/waTheme'

const API_BASE = '/api'

const EVENT_BADGES = [
  { key: 'ev_trial_active', label: '七日挑战进行中', color: '#3b82f6', bg: 'rgba(59,130,246,0.15)' },
  { key: 'ev_monthly_started', label: '开启月度挑战', color: '#8b5cf6', bg: 'rgba(139,92,246,0.15)' },
  { key: 'ev_monthly_joined', label: '月卡加入', color: '#10b981', bg: 'rgba(16,185,129,0.15)' },
  { key: 'ev_whatsapp_shared', label: 'WA已发', color: '#00a884', bg: 'rgba(0,168,132,0.15)' },
  { key: 'ev_gmv_1k', label: 'GMV>1K', color: '#f59e0b', bg: 'rgba(245,158,11,0.15)' },
  { key: 'ev_gmv_2k', label: 'GMV 2K', color: '#f97316', bg: 'rgba(249,115,22,0.15)' },
  { key: 'ev_gmv_5k', label: 'GMV 5K', color: '#f97316', bg: 'rgba(249,115,22,0.15)' },
  { key: 'ev_gmv_10k', label: 'GMV 10K', color: '#ef4444', bg: 'rgba(239,68,68,0.15)' },
  { key: 'ev_churned', label: '已流失', color: '#ef4444', bg: 'rgba(239,68,68,0.15)' },
]

const EVENT_FILTER_FIELD_MAP = {
  trial_7day: ['ev_trial_active', 'ev_trial_7day'],
  monthly_invited: ['ev_monthly_invited', 'ev_monthly_started'],
  monthly_joined: ['ev_monthly_joined'],
  gmv_1k: ['ev_gmv_1k'],
  churned: ['ev_churned'],
}

const KANBAN_COLUMNS = [
  { key: 'new', label: '🆕 新建', color: '#94a3b8', filter: c => !c.msg_count },
  { key: 'active', label: '🔥 活跃', color: '#10b981', filter: c => c.msg_count > 5 },
  { key: 'trial', label: '⏳ 试用中', color: '#3b82f6', filter: c => c.ev_trial_active },
  { key: 'monthly', label: '💎 月卡', color: '#8b5cf6', filter: c => c.ev_monthly_started || c.ev_monthly_joined },
  { key: 'churned', label: '⚠️ 流失', color: '#ef4444', filter: c => c.ev_churned },
]

const DETAIL_COLLAPSED_WIDTH = 28

function App() {
  const [creators, setCreators] = useState([])
  const [loading, setLoading] = useState(true)
  const [stats, setStats] = useState(null)
  const [activeTab, setActiveTab] = useState('creators')
  const [viewMode, setViewMode] = useState('list')
  const [filterOwner, setFilterOwner] = useState('')
  const [filterBeta, setFilterBeta] = useState('')
  const [filterPriority, setFilterPriority] = useState('')
  const [filterAgency, setFilterAgency] = useState('')
  const [filterEvent, setFilterEvent] = useState('')
  const [search, setSearch] = useState('')
  const [selectedCreator, setSelectedCreator] = useState(null)
  const [unreadCounts, setUnreadCounts] = useState({}) // creatorId -> unread count
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false)
  const [tagsVisible, setTagsVisible] = useState(true)
  const [waQrData, setWaQrData] = useState(null)  // WA QR code data URL
  const [detailPanelExpanded, setDetailPanelExpanded] = useState(false)
  const [detailPanelPinned, setDetailPanelPinned] = useState(false)

  // 轮询 WhatsApp 状态和二维码
  useEffect(() => {
    const fetchWaStatus = async () => {
      try {
        const res = await fetchWaAdmin(`${API_BASE}/wa/status`)
        if (!res.ok) {
          setWaQrData(null)
          return
        }
        const data = await res.json()
        if (data.hasQr) {
          try {
            const qrRes = await fetchWaAdmin(`${API_BASE}/wa/qr`)
            if (!qrRes.ok) {
              setWaQrData(null)
              return
            }
            const qrInfo = await qrRes.json()
            if (qrInfo.qr) setWaQrData(qrInfo.qr)
          } catch (_) {}
        } else {
          setWaQrData(null)
        }
      } catch (_) {
        setWaQrData(null)
      }
    }
    fetchWaStatus()
    const id = setInterval(fetchWaStatus, 5000)
    return () => clearInterval(id)
  }, [])

  // 面板尺寸记忆（从 localStorage 恢复）
  const [panelWidths, setPanelWidths] = useState(() => {
    try {
      const saved = localStorage.getItem('wa_panel_widths')
      if (saved) return JSON.parse(saved)
    } catch (_) {}
    return { list: 320, detail: 320 } // defaults: 320px each
  })
  const [dragging, setDragging] = useState(null) // 'list-detail'

  const savePanelWidths = (widths) => {
    try { localStorage.setItem('wa_panel_widths', JSON.stringify(widths)) } catch (_) {}
    setPanelWidths(widths)
  }

  // 拖拽开始
  const startDrag = (handle) => (e) => {
    e.preventDefault()
    setDragging(handle)
  }

  // 拖拽中
  useEffect(() => {
    if (!dragging) return
    const onMove = (e) => {
      const clientX = e.touches ? e.touches[0].clientX : e.clientX
      setPanelWidths(prev => {
        const next = { ...prev }
        if (dragging ***REMOVED***= 'list-detail') {
          next.list = Math.min(Math.max(200, clientX), 500)
        }
        try { localStorage.setItem('wa_panel_widths', JSON.stringify(next)) } catch (_) {}
        return next
      })
    }
    const onUp = () => setDragging(null)
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    window.addEventListener('touchmove', onMove)
    window.addEventListener('touchend', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      window.removeEventListener('touchmove', onMove)
      window.removeEventListener('touchend', onUp)
    }
  }, [dragging])

  // 计算未读：基于 ev_replied 字段（0=未回复显示红点，1=已回复消除红点）
  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (filterOwner) params.set('owner', filterOwner)

      const [creatorsData, statsData] = await Promise.all([
        fetchJsonOrThrow(`${API_BASE}/creators?${params.toString()}`),
        fetchJsonOrThrow(`${API_BASE}/stats`),
      ])

      const enriched = creatorsData.map(c => buildCreatorViewModel(buildCreatorListFull(c), c))

      // 计算未读：基于消息方向 + 48h 话题过期规则
      const newUnread = {}
      for (const c of enriched) {
        newUnread[c.id] = shouldShowUnread(c) ? 1 : 0
      }
      setUnreadCounts(newUnread)

      // 按最后一次对话结束时间倒序
      enriched.sort((a, b) => getCreatorLastConversationTs(b) - getCreatorLastConversationTs(a))

      setCreators(enriched)
      setStats(statsData)
    } catch (e) {
      console.error('[WACRM] 加载失败:', e)
    } finally {
      setLoading(false)
    }
  }, [filterOwner])

  // loadData ref：确保 SSE 回调永远调用最新版本的 loadData（带当前 filter 值）
  const loadDataRef = useRef(loadData)
  useEffect(() => { loadDataRef.current = loadData }, [loadData])

  useEffect(() => {
    loadData()
    const interval = setInterval(loadData, 15000)
    return () => clearInterval(interval)
  }, [loadData])

  // SSE 实时订阅（populate_db.cjs 写完 MySQL 后会收到广播）
  useEffect(() => {
    let es
    try {
      es = new EventSource(buildAppAuthUrl('/api/events/subscribe'))
      es.addEventListener('creators-updated', () => {
        loadDataRef.current?.()
      })
      es.onerror = () => {
        console.warn('[SSE] 连接断开，5秒后自动重连')
      }
    } catch (e) {
      console.warn('[SSE] 连接失败，使用轮询兜底:', e.message)
    }
    return () => { if (es) es.close() }
  }, [])

  const handleSelectCreator = (creator) => {
    if (!shouldShowUnread(creator)) {
      setUnreadCounts(prev => ({ ...prev, [creator.id]: 0 }))
    }
    setDetailPanelExpanded(false)
    setDetailPanelPinned(false)
    setSelectedCreator(creator)
  }

  const handleCreatorMessageSent = useCallback((creatorId) => {
    if (!creatorId) return
    setUnreadCounts(prev => ({ ...prev, [creatorId]: 0 }))
    setCreators(prev => prev.map(c => {
      if (c.id !***REMOVED*** creatorId) return c
      return {
        ...c,
        ev_replied: 1,
        _full: c._full ? { ...c._full, ev_replied: 1 } : c._full,
      }
    }))
    setSelectedCreator(prev => {
      if (!prev || prev.id !***REMOVED*** creatorId) return prev
      return {
        ...prev,
        ev_replied: 1,
        _full: prev._full ? { ...prev._full, ev_replied: 1 } : prev._full,
      }
    })
  }, [])

  const handleCreatorUpdated = useCallback((updatedDetail) => {
    if (!updatedDetail?.id) return
    setCreators(prev => {
      const next = prev.map(c => c.id ***REMOVED***= updatedDetail.id ? buildCreatorViewModel(updatedDetail, c) : c)
      next.sort((a, b) => getCreatorLastConversationTs(b) - getCreatorLastConversationTs(a))
      return next
    })
    setSelectedCreator(prev => {
      if (!prev || prev.id !***REMOVED*** updatedDetail.id) return prev
      return buildCreatorViewModel(updatedDetail, prev)
    })
  }, [])

  const filteredCreators = useMemo(() => creators.filter(c => {
    if (search) {
      const s = search.toLowerCase()
      if (!(c.primary_name || '').toLowerCase().includes(s) &&
          !(c.wa_phone || '').includes(s) &&
          !(c.keeper_username || '').toLowerCase().includes(s)) return false
    }
    if (filterBeta && c._full?.wacrm?.beta_status !***REMOVED*** filterBeta) return false
    if (filterPriority && c._full?.wacrm?.priority !***REMOVED*** filterPriority) return false
    if (filterAgency ***REMOVED***= 'yes' && !c._full?.wacrm?.agency_bound) return false
    if (filterAgency ***REMOVED***= 'no' && c._full?.wacrm?.agency_bound) return false
    if (filterEvent) {
      const evKeys = EVENT_FILTER_FIELD_MAP[filterEvent] || [`ev_${filterEvent}`]
      const matched = evKeys.some(key => c._full?.joinbrands?.[key])
      if (!matched) return false
    }
    return true
  }), [creators, search, filterBeta, filterPriority, filterAgency, filterEvent])

  const ownerOptions = useMemo(() => {
    return buildOwnerOptions([
      ...Object.keys(stats?.by_owner || {}),
      ...creators.map(c => c.wa_owner),
      selectedCreator?.wa_owner,
      filterOwner,
    ], { includeAll: true })
  }, [creators, stats, selectedCreator?.wa_owner, filterOwner])

  const activeFilterCount = [filterBeta, filterPriority, filterAgency, filterEvent].filter(Boolean).length
  const selectedCreatorStatusMeta = getCreatorStatusMeta(selectedCreator)
  const isDetailPanelOpen = !!selectedCreator && (detailPanelExpanded || detailPanelPinned)
  const detailPanelWidth = selectedCreator
    ? (isDetailPanelOpen ? panelWidths.detail : DETAIL_COLLAPSED_WIDTH)
    : panelWidths.detail

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* ***REMOVED******REMOVED***= Mobile Sidebar Overlay ***REMOVED******REMOVED***= */}
      {mobileSidebarOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setMobileSidebarOpen(false)} />
          <div
            className="absolute left-0 top-0 bottom-0 w-[280px] flex flex-col shadow-2xl"
            style={{ background: WA.white, zIndex: 1 }}
          >
            <div className="flex items-center justify-between px-5 py-4" style={{ background: WA.darkHeader }}>
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-full flex items-center justify-center text-white text-sm font-bold shrink-0" style={{ background: WA.teal }}>WA</div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-white leading-none">达人列表</div>
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => loadData()}
                  disabled={loading}
                  className="text-white/60 hover:text-white text-base disabled:opacity-40"
                  title="刷新"
                >
                  {loading ? '⏳' : '🔄'}
                </button>
                <button onClick={() => setMobileSidebarOpen(false)} className="text-white/60 hover:text-white text-xl">✕</button>
              </div>
            </div>
            {/* Sidebar content */}
            <div className="flex-1 overflow-y-auto">
              {/* Search */}
              <div className="p-4" style={{ background: WA.darkHeader }}>
                <div className="flex items-center gap-3 px-4 py-2.5 rounded-xl" style={{ background: WA.darkBg }}>
                  <span style={{ color: WA.textMuted }}>🔍</span>
                  <input
                    type="text"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    placeholder="搜索..."
                    className="flex-1 bg-transparent text-sm text-white placeholder-slate-400 focus:outline-none"
                  />
                  {search && <button onClick={() => setSearch('')} style={{ color: 'rgba(255,255,255,0.4)' }}>✕</button>}
                </div>
              </div>
              {/* Owner tabs */}
              <div className="flex items-center gap-1 px-3 py-2 border-b overflow-x-auto" style={{ borderColor: WA.borderLight }}>
                {ownerOptions.map(o => (
                  <button key={o} onClick={() => setFilterOwner(o)} className="shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors" style={{ background: filterOwner ***REMOVED***= o ? WA.teal : 'transparent', color: filterOwner ***REMOVED***= o ? 'white' : WA.textMuted }}>{o ***REMOVED***= '' ? '全部' : o}</button>
                ))}
              </div>
              {/* Creator list */}
              <div>
                {filteredCreators.map(c => (
                  <ChatListItem key={c.id} creator={c} unread={unreadCounts[c.id] || 0} onClick={() => { handleSelectCreator(c); setMobileSidebarOpen(false) }} />
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ***REMOVED******REMOVED***= Desktop: Three-Panel Layout ***REMOVED******REMOVED***= */}
      <div className="hidden md:flex h-screen overflow-hidden" style={{ background: WA.lightBg }}>

        {/* Panel 1: Contact List */}
        <div className="shrink-0 flex flex-col" style={{ width: panelWidths.list, minWidth: panelWidths.list, maxWidth: panelWidths.list, background: WA.white, borderRight: `1px solid ${WA.borderLight}` }}>

          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4" style={{ background: WA.darkHeader }}>
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-full flex items-center justify-center text-white text-sm font-bold" style={{ background: WA.teal }}>
                WA
              </div>
              <div>
                <div className="text-base font-semibold text-white leading-none">CRM</div>
              </div>
            </div>
            <div className="flex gap-1.5">
              <button onClick={() => setActiveTab('creators')} className="px-4 py-1.5 rounded-lg text-xs font-medium transition-all" style={{ background: activeTab ***REMOVED***= 'creators' ? 'rgba(255,255,255,0.18)' : 'transparent', color: activeTab ***REMOVED***= 'creators' ? 'white' : 'rgba(255,255,255,0.55)' }}>
                达人
              </button>
              <button onClick={() => setActiveTab('sft')} className="px-4 py-1.5 rounded-lg text-xs font-medium transition-all" style={{ background: activeTab ***REMOVED***= 'sft' ? 'rgba(255,255,255,0.18)' : 'transparent', color: activeTab ***REMOVED***= 'sft' ? 'white' : 'rgba(255,255,255,0.55)' }}>
                SFT
              </button>
              <button onClick={() => setActiveTab('events')} className="px-4 py-1.5 rounded-lg text-xs font-medium transition-all" style={{ background: activeTab ***REMOVED***= 'events' ? 'rgba(255,255,255,0.18)' : 'transparent', color: activeTab ***REMOVED***= 'events' ? 'white' : 'rgba(255,255,255,0.55)' }}>
                事件
              </button>
            </div>
          </div>

          {/* Search bar */}
          <div className="px-4 py-3" style={{ background: WA.darkHeader }}>
            <div className="flex items-center gap-3 px-4 py-2.5 rounded-xl" style={{ background: WA.darkBg }}>
              <span style={{ color: WA.textMuted }}>🔍</span>
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="搜索姓名、电话..."
                className="flex-1 bg-transparent text-sm text-white placeholder-slate-400 focus:outline-none"
              />
              {search && (
                <button onClick={() => setSearch('')} style={{ color: 'rgba(255,255,255,0.4)' }}>✕</button>
              )}
            </div>
          </div>

          {/* Owner tabs + filter toggle */}
          <div className="flex items-center gap-2 px-4 py-3 border-b" style={{ borderColor: WA.borderLight, background: WA.white }}>
            <div className="flex items-center gap-2 flex-1 overflow-x-auto">
              {ownerOptions.map(o => (
                <button
                  key={o}
                  onClick={() => setFilterOwner(o)}
                  className="shrink-0 px-3 py-2 rounded-xl text-sm font-semibold transition-all"
                  style={{
                    background: filterOwner ***REMOVED***= o ? WA.teal : 'transparent',
                    color: filterOwner ***REMOVED***= o ? 'white' : WA.textMuted,
                    fontSize: '13px'
                  }}
                >
                  {o ***REMOVED***= '' ? '全部' : o}
                </button>
              ))}
            </div>
            <button
              onClick={() => setActiveTab(prev => prev ***REMOVED***= 'creators' ? 'creators' : prev)}
              className="relative px-3 py-2 rounded-xl text-sm font-medium transition-all"
              style={{
                background: activeFilterCount > 0 ? WA.teal + '18' : 'transparent',
                color: activeFilterCount > 0 ? WA.teal : WA.textMuted,
                border: `1px solid ${activeFilterCount > 0 ? WA.teal + '30' : WA.borderLight}`
              }}
            >
              ⚙️ 筛选 {activeFilterCount > 0 && <span className="ml-1 text-xs font-bold" style={{ color: WA.teal }}>{activeFilterCount}</span>}
            </button>
          </div>

          {/* Filter bar — always visible */}
          <div className="px-3 py-2.5 border-b space-y-2" style={{ borderColor: WA.borderLight, background: WA.lightBg }}>
            <div className="flex gap-1.5">
              <FilterSelect value={filterBeta} onChange={setFilterBeta} placeholder="Beta">
                <option value="">Beta</option>
                <option value="not_introduced">未介绍</option>
                <option value="introduced">已介绍</option>
                <option value="started">已开始</option>
                <option value="completed">已完成</option>
              </FilterSelect>
              <FilterSelect value={filterPriority} onChange={setFilterPriority} placeholder="优先级">
                <option value="">优先级</option>
                <option value="high">高</option>
                <option value="medium">中</option>
                <option value="low">低</option>
              </FilterSelect>
            </div>
            <div className="flex gap-1.5">
              <FilterSelect value={filterAgency} onChange={setFilterAgency} placeholder="Agency">
                <option value="">Agency</option>
                <option value="yes">已绑定</option>
                <option value="no">未绑定</option>
              </FilterSelect>
              <FilterSelect value={filterEvent} onChange={setFilterEvent} placeholder="事件">
                <option value="">事件</option>
                <option value="trial_7day">7天试用</option>
                <option value="monthly_invited">月卡邀请</option>
                <option value="monthly_joined">月卡加入</option>
                <option value="gmv_1k">GMV&gt;1K</option>
                <option value="churned">已流失</option>
              </FilterSelect>
            </div>
            {(filterBeta || filterPriority || filterAgency || filterEvent) && (
              <button
                onClick={() => { setFilterBeta(''); setFilterPriority(''); setFilterAgency(''); setFilterEvent('') }}
                className="w-full text-xs py-1.5 rounded-lg text-center font-medium"
                style={{ color: '#ef4444', background: 'rgba(239,68,68,0.08)' }}
              >
                清除筛选
              </button>
            )}
          </div>

          {/* View mode + count */}
          <div className="flex items-center justify-between px-4 py-2.5 border-b" style={{ borderColor: WA.borderLight }}>
            <span className="text-sm font-medium" style={{ color: WA.textDark }}>
              {filteredCreators.length} <span style={{ color: WA.textMuted }}>位达人</span>
            </span>
            <div className="flex gap-0.5 rounded-xl p-1" style={{ background: WA.lightBg }}>
              <button
                onClick={() => setViewMode('list')}
                className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
                style={{ background: viewMode ***REMOVED***= 'list' ? WA.white : 'transparent', color: viewMode ***REMOVED***= 'list' ? WA.teal : WA.textMuted, boxShadow: viewMode ***REMOVED***= 'list' ? '0 1px 3px rgba(0,0,0,0.12)' : 'none' }}
              >
                ☰
              </button>
              <button
                onClick={() => setViewMode('kanban')}
                className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
                style={{ background: viewMode ***REMOVED***= 'kanban' ? WA.white : 'transparent', color: viewMode ***REMOVED***= 'kanban' ? WA.teal : WA.textMuted, boxShadow: viewMode ***REMOVED***= 'kanban' ? '0 1px 3px rgba(0,0,0,0.12)' : 'none' }}
              >
                ⊞
              </button>
            </div>
          </div>

          {/* List / Kanban content */}
          <div className="flex-1 overflow-y-auto">
            {activeTab ***REMOVED***= 'creators' ? (
              loading && creators.length ***REMOVED***= 0 ? (
                <div className="flex flex-col items-center justify-center py-16 gap-3" style={{ color: WA.textMuted }}>
                  <div className="w-8 h-8 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: WA.teal, borderTopColor: 'transparent' }} />
                  <span className="text-xs">加载中...</span>
                </div>
              ) : filteredCreators.length ***REMOVED***= 0 ? (
                <div className="flex flex-col items-center justify-center py-16 gap-3" style={{ color: WA.textMuted }}>
                  <div className="w-12 h-12 rounded-full flex items-center justify-center" style={{ background: WA.lightBg }}>
                    <span className="text-xl">🔍</span>
                  </div>
                  <span className="text-sm">没有找到达人</span>
                </div>
              ) : viewMode ***REMOVED***= 'list' ? (
                filteredCreators.map(c => (
                  <ChatListItem
                    key={c.id}
                    creator={c}
                    unread={unreadCounts[c.id] || 0}
                    onClick={() => handleSelectCreator(c)}
                  />
                ))
              ) : (
                <KanbanView creators={filteredCreators} onCreatorClick={c => handleSelectCreator(c)} />
              )
            ) : activeTab ***REMOVED***= 'events' ? (
              <EventPanel />
            ) : (
              <SFTDashboard compact />
            )}
          </div>
        </div>

        {/* 分隔线 1：列表 ↔ 详情 */}
        <div
          className="w-1.5 shrink-0 cursor-col-resize group relative z-10"
          style={{ background: dragging ***REMOVED***= 'list-detail' ? WA.teal : 'transparent' }}
          onMouseDown={startDrag('list-detail')}
          onTouchStart={startDrag('list-detail')}
        >
          <div className="absolute inset-y-0 -left-1 -right-1 group-hover:flex hidden items-center justify-center">
            <div className="w-1.5 h-12 rounded-full flex flex-col items-center justify-center gap-1" style={{ background: WA.borderLight }}>
              <span className="w-1 h-1 rounded-full" style={{ background: WA.textMuted }} />
              <span className="w-1 h-1 rounded-full" style={{ background: WA.textMuted }} />
              <span className="w-1 h-1 rounded-full" style={{ background: WA.textMuted }} />
            </div>
          </div>
        </div>

        {/* Panel 2: Chat */}
        <div className="flex-1 flex flex-col min-w-0">
          {selectedCreator ? (
            <WAMessageComposer
              key={selectedCreator.id}
              client={{
                id: selectedCreator.id,
                phone: selectedCreator.wa_phone,
                name: selectedCreator.primary_name,
                wa_owner: selectedCreator.wa_owner,
                conversion_stage: selectedCreator.beta_status || 'unknown',
              }}
              creator={selectedCreator}
              onClose={() => setSelectedCreator(null)}
              onMessageSent={handleCreatorMessageSent}
            />
          ) : (
            <div className="flex-1 flex items-center justify-center" style={{ background: WA.chatBg }}>
              {waQrData ? (
                <div className="text-center">
                  <img src={waQrData} alt="WA QR" style={{ width: 220, height: 220, borderRadius: 12, border: '2px solid #e5e7eb', marginBottom: 16 }} />
                  <div style={{ fontSize: 14, fontWeight: 600, color: '#856404', marginBottom: 4 }}>⚠️ 请扫码认证 WhatsApp</div>
                  <div style={{ fontSize: 12, color: '#856404' }}>WhatsApp → ⋮ → 已关联的设备 → 关联新设备</div>
                </div>
              ) : (
                <div className="text-center" style={{ color: WA.textMuted }}>
                  <div className="text-5xl mb-4">💬</div>
                  <div className="text-sm">选择一个达人开始对话</div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Panel 3: Right Detail Drawer */}
        {selectedCreator && (
          <div
            className="shrink-0 flex flex-col"
            style={{
              width: detailPanelWidth,
              minWidth: detailPanelWidth,
              maxWidth: detailPanelWidth,
              transition: 'width 220ms ease',
            }}
            onMouseEnter={() => setDetailPanelExpanded(true)}
            onMouseLeave={() => {
              if (!detailPanelPinned) setDetailPanelExpanded(false)
            }}
          >
            <CreatorDetail
              creatorId={selectedCreator.id}
              creatorName={selectedCreator.primary_name}
              onClose={() => setSelectedCreator(null)}
              onMessageSent={handleCreatorMessageSent}
              onCreatorUpdated={handleCreatorUpdated}
              asPanel
              collapsed={!isDetailPanelOpen}
              pinned={detailPanelPinned}
              onTogglePin={() => {
                setDetailPanelPinned(prev => !prev)
                setDetailPanelExpanded(true)
              }}
              onExpand={() => setDetailPanelExpanded(true)}
            />
          </div>
        )}
      </div>

      <WorkerStatusBar />

      {/* ***REMOVED******REMOVED***= Mobile: Full-screen Chat (shown when creator selected) ***REMOVED******REMOVED***= */}
      {selectedCreator && (
        <div className="flex-1 flex flex-col md:hidden" style={{ background: WA.chatBg }}>
          {/* Mobile top bar */}
          <div className="flex items-center gap-3 px-4 py-3" style={{ background: WA.darkHeader }}>
            <button onClick={() => setMobileSidebarOpen(true)} className="text-white/70 hover:text-white text-lg shrink-0">☰</button>
            <div className="w-9 h-9 rounded-full flex items-center justify-center text-white font-bold text-sm shrink-0" style={{ background: WA.teal }}>
              {(selectedCreator.primary_name || '?')[0]?.toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-white truncate">{selectedCreator.primary_name}</div>
              <div className="text-xs text-white/50">{selectedCreator.wa_phone}</div>
            </div>
            <button
              onClick={() => setTagsVisible(v => !v)}
              className="text-white/70 hover:text-white text-base shrink-0 px-2 py-1 rounded-lg"
              title={tagsVisible ? '隐藏标签' : '显示标签'}
            >
              🏷
            </button>
            <button onClick={() => setSelectedCreator(null)} className="text-white/70 hover:text-white text-lg shrink-0">✕</button>
          </div>

          <MobileEventTagsBar
            creator={selectedCreator}
            statusMeta={selectedCreatorStatusMeta}
            visible={tagsVisible}
          />

          {/* WAMessageComposer — as panel, no internal mobile header */}
          <div className="flex-1 overflow-hidden">
            <WAMessageComposer
              client={{
                id: selectedCreator.id,
                phone: selectedCreator.wa_phone,
                name: selectedCreator.primary_name,
                wa_owner: selectedCreator.wa_owner,
                conversion_stage: selectedCreator.beta_status || 'unknown',
              }}
              creator={selectedCreator}
              onClose={() => setSelectedCreator(null)}
              onSwipeLeft={() => setMobileSidebarOpen(true)}
              onMessageSent={handleCreatorMessageSent}
              asPanel
            />
          </div>
        </div>
      )}
    </div>
  )
}

// ***REMOVED******REMOVED******REMOVED*** Kanban Board ***REMOVED******REMOVED******REMOVED***
function KanbanView({ creators, onCreatorClick }) {
  return (
    <div className="flex gap-3 p-3 overflow-x-auto h-full">
      {KANBAN_COLUMNS.map(col => {
        const colCreators = creators.filter(c => col.filter(c))
        return (
          <div key={col.key} className="flex flex-col w-56 shrink-0 rounded-2xl overflow-hidden" style={{ background: '#f5f6f7' }}>
            <div className="flex items-center justify-between px-4 py-3" style={{ background: col.color + '18' }}>
              <span className="text-sm font-bold" style={{ color: col.color }}>{col.label}</span>
              <span className="text-xs px-2 py-0.5 rounded-full font-bold" style={{ background: col.color + '25', color: col.color }}>{colCreators.length}</span>
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-2">
              {colCreators.map(c => (
                <KanbanCard key={c.id} creator={c} color={col.color} onClick={() => onCreatorClick(c)} />
              ))}
              {colCreators.length ***REMOVED***= 0 && (
                <div className="text-center py-8 text-xs" style={{ color: WA.textMuted }}>无</div>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function KanbanCard({ creator, color, onClick }) {
  const ownerColor = getOwnerColor(creator.wa_owner)
  const statusMeta = getCreatorStatusMeta(creator)
  return (
    <div
      onClick={onClick}
      className="bg-white rounded-xl p-4 cursor-pointer hover:shadow-lg transition-all"
      style={{
        borderLeft: `4px solid ${statusMeta.accent ***REMOVED***= 'transparent' ? color : statusMeta.accent}`,
        background: statusMeta.bg ***REMOVED***= 'transparent' ? WA.white : `linear-gradient(180deg, ${statusMeta.bg} 0%, ${WA.white} 72%)`,
      }}
    >
      <div className="flex items-center gap-3 mb-3">
        <div className="w-10 h-10 rounded-full flex items-center justify-center text-white text-sm font-bold" style={{ background: ownerColor }}>
          {(creator.primary_name || '?')[0]?.toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold truncate" style={{ color: WA.textDark }}>{creator.primary_name || 'Unknown'}</div>
          <div className="text-xs" style={{ color: WA.textMuted }}>{creator.wa_phone || '-'}</div>
          {statusMeta.label && (
            <div className="mt-1">
              <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ background: statusMeta.bg, color: statusMeta.accent }}>
                {statusMeta.label}
              </span>
            </div>
          )}
        </div>
      </div>
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold" style={{ color: '#10b981' }}>
          {creator.keeper_gmv > 0 ? '$' + Number(creator.keeper_gmv).toLocaleString() : '-'}
        </span>
        <span className="text-xs" style={{ color: WA.textMuted }}>{creator.msg_count || 0} 💬</span>
      </div>
    </div>
  )
}

// ***REMOVED******REMOVED******REMOVED*** Filter components ***REMOVED******REMOVED******REMOVED***
function FilterSelect({ value, onChange, placeholder, children }) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      className="flex-1 text-xs px-2.5 py-1.5 rounded-lg border focus:outline-none transition-all"
      style={{
        background: WA.white,
        borderColor: value ? WA.teal + '50' : WA.borderLight,
        color: value ? WA.textDark : WA.textMuted,
        fontSize: '12px'
      }}
    >
      {children}
    </select>
  )
}

// ***REMOVED******REMOVED******REMOVED*** Relative time formatter ***REMOVED******REMOVED******REMOVED***
function formatChatListTime(ts) {
  if (!ts) return null
  return new Date(ts).toLocaleString('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

const TOPIC_STALE_MS = 48 * 3600 * 1000

function normalizeChatTimestamp(value) {
  if (value ***REMOVED*** null || value ***REMOVED***= '') return 0
  if (typeof value ***REMOVED***= 'number') return value > 1e12 ? value : value * 1000
  if (typeof value ***REMOVED***= 'string' && /^\d+$/.test(value)) {
    const n = Number(value)
    return n > 1e12 ? n : n * 1000
  }
  const parsed = new Date(value).getTime()
  return Number.isFinite(parsed) ? parsed : 0
}

function getCreatorLastMessageTs(creator) {
  const messageTs = getCreatorMessages(creator).map(m => normalizeChatTimestamp(m?.timestamp))
  const candidates = [
    normalizeChatTimestamp(creator?.last_active),
    ...messageTs,
  ].filter(Boolean)
  return candidates.length ? Math.max(...candidates) : 0
}

function getCreatorLastConversationTs(creator) {
  const lastMessageTs = getCreatorLastMessageTs(creator)
  if (lastMessageTs > 0) return lastMessageTs
  return 0
}

function isTopicExpired(creator) {
  const messages = getCreatorMessages(creator)
  const lastUserTs = messages
    .filter(m => m?.role ***REMOVED***= 'user')
    .map(m => normalizeChatTimestamp(m?.timestamp))
    .filter(Boolean)
    .reduce((max, ts) => Math.max(max, ts), 0)

  const referenceTs = lastUserTs || getCreatorLastConversationTs(creator)
  return referenceTs > 0 && (Date.now() - referenceTs) > TOPIC_STALE_MS
}

function shouldShowUnread(creator) {
  const messages = getCreatorMessages(creator)
  if (messages.length > 0) {
    let lastUserTs = 0
    let lastMeTs = 0
    for (const msg of messages) {
      const ts = normalizeChatTimestamp(msg?.timestamp)
      if (!ts) continue
      if (msg?.role ***REMOVED***= 'user') lastUserTs = Math.max(lastUserTs, ts)
      if (msg?.role ***REMOVED***= 'me') lastMeTs = Math.max(lastMeTs, ts)
    }
    if (!lastUserTs) return false
    if (lastMeTs >= lastUserTs) return false
    if ((Date.now() - lastUserTs) > TOPIC_STALE_MS) return false
    return true
  }

  if (creator?.ev_replied) return false
  if (isTopicExpired(creator)) return false
  return !creator?.ev_replied
}

function flattenJoinbrandsFlags(joinbrands = {}) {
  return {
    ev_trial_active: !!joinbrands.ev_trial_active,
    ev_monthly_started: !!joinbrands.ev_monthly_started,
    ev_monthly_joined: !!joinbrands.ev_monthly_joined,
    ev_whatsapp_shared: !!joinbrands.ev_whatsapp_shared,
    ev_gmv_1k: !!joinbrands.ev_gmv_1k,
    ev_gmv_2k: !!joinbrands.ev_gmv_2k,
    ev_gmv_5k: !!joinbrands.ev_gmv_5k,
    ev_gmv_10k: !!joinbrands.ev_gmv_10k,
    ev_agency_bound: !!joinbrands.ev_agency_bound,
    ev_churned: !!joinbrands.ev_churned,
  }
}

function buildCreatorListFull(detail = {}) {
  const joinbrands = {
    ...(detail.joinbrands || {}),
    ev_joined: detail.ev_joined ?? detail.joinbrands?.ev_joined,
    ev_ready_sent: detail.ev_ready_sent ?? detail.joinbrands?.ev_ready_sent,
    ev_trial_active: detail.ev_trial_active ?? detail.joinbrands?.ev_trial_active,
    ev_monthly_started: detail.ev_monthly_started ?? detail.joinbrands?.ev_monthly_started,
    ev_monthly_joined: detail.ev_monthly_joined ?? detail.joinbrands?.ev_monthly_joined,
    ev_whatsapp_shared: detail.ev_whatsapp_shared ?? detail.joinbrands?.ev_whatsapp_shared,
    ev_gmv_1k: detail.ev_gmv_1k ?? detail.joinbrands?.ev_gmv_1k,
    ev_gmv_2k: detail.ev_gmv_2k ?? detail.joinbrands?.ev_gmv_2k,
    ev_gmv_5k: detail.ev_gmv_5k ?? detail.joinbrands?.ev_gmv_5k,
    ev_gmv_10k: detail.ev_gmv_10k ?? detail.joinbrands?.ev_gmv_10k,
    ev_agency_bound: detail.ev_agency_bound ?? detail.joinbrands?.ev_agency_bound,
    ev_churned: detail.ev_churned ?? detail.joinbrands?.ev_churned,
  }

  const wacrm = {
    ...(detail.wacrm || {}),
    beta_status: detail.beta_status ?? detail.wacrm?.beta_status,
    priority: detail.priority ?? detail.wacrm?.priority,
    agency_bound: detail.agency_bound ?? detail.wacrm?.agency_bound,
    monthly_fee_status: detail.monthly_fee_status ?? detail.wacrm?.monthly_fee_status,
    video_count: detail.video_count ?? detail.wacrm?.video_count,
    video_target: detail.video_target ?? detail.wacrm?.video_target,
    next_action: detail.next_action ?? detail.wacrm?.next_action,
  }

  const keeper = {
    ...(detail.keeper || {}),
    keeper_gmv: detail.keeper_gmv ?? detail.keeper?.keeper_gmv,
    keeper_gmv30: detail.keeper_gmv30 ?? detail.keeper?.keeper_gmv30,
    keeper_orders: detail.keeper_orders ?? detail.keeper?.keeper_orders,
  }

  return {
    ...detail,
    joinbrands,
    wacrm,
    keeper,
  }
}

function buildCreatorViewModel(detail, previous = {}) {
  if (!detail) return previous
  const joinbrands = detail.joinbrands || previous.joinbrands || {}
  const wacrm = detail.wacrm || previous.wacrm || {}
  const keeper = detail.keeper || previous.keeper || {}
  const next = {
    ...previous,
    ...detail,
    primary_name: detail.primary_name ?? previous.primary_name,
    wa_phone: detail.wa_phone ?? previous.wa_phone,
    wa_owner: detail.wa_owner ?? previous.wa_owner,
    keeper_username: detail.keeper_username ?? previous.keeper_username,
    beta_status: wacrm.beta_status ?? previous.beta_status,
    priority: wacrm.priority ?? previous.priority,
    agency_bound: wacrm.agency_bound ?? previous.agency_bound,
    joinbrands,
    wacrm,
    keeper,
    keeper_gmv: keeper.keeper_gmv ?? previous.keeper_gmv ?? 0,
    keeper_gmv30: keeper.keeper_gmv30 ?? previous.keeper_gmv30 ?? 0,
    msg_count: Array.isArray(detail.messages) ? detail.messages.length : previous.msg_count ?? 0,
    ev_replied: detail.ev_replied ?? previous.ev_replied,
    updated_at: detail.updated_at ?? previous.updated_at,
    last_active: detail.last_active ?? previous.last_active ?? 0,
    _full: detail,
  }
  return {
    ...next,
    ...flattenJoinbrandsFlags(joinbrands),
  }
}

function getPriorityBadgeMeta(priority) {
  if (!priority) return null
  if (priority ***REMOVED***= 'urgent') {
    return {
      label: '高优先级',
      style: { background: 'rgba(245,158,11,0.16)', color: '#f59e0b' }
    }
  }
  if (priority ***REMOVED***= 'high') {
    return {
      label: '高优先级',
      style: { background: 'rgba(245,158,11,0.10)', color: '#d97706', border: '1px solid rgba(245,158,11,0.18)' }
    }
  }
  if (priority ***REMOVED***= 'medium') {
    return {
      label: '中优先级',
      style: { background: WA.white, color: WA.textMuted, border: `1px solid ${WA.borderLight}` }
    }
  }
  if (priority ***REMOVED***= 'normal' || priority ***REMOVED***= 'low') {
    return {
      label: '低优先级',
      style: { background: WA.white, color: WA.textMuted, border: `1px solid ${WA.borderLight}` }
    }
  }
  return null
}

// ***REMOVED******REMOVED******REMOVED*** Chat List Item ***REMOVED******REMOVED******REMOVED***
function ChatListItem({ creator, onClick, unread }) {
  const ownerColor = getOwnerColor(creator.wa_owner, WA.textMuted)
  const full = creator._full || {}
  const wacrm = full.wacrm || {}
  const joinbrands = full.joinbrands || {}
  const statusMeta = getCreatorStatusMeta(creator)
  const priorityMeta = getPriorityBadgeMeta(wacrm.priority)

  const lastActiveTs = getCreatorLastConversationTs(creator)
  const lastActiveLabel = lastActiveTs ? formatChatListTime(lastActiveTs) : null
  const lastActiveFull = lastActiveTs
    ? new Date(lastActiveTs).toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    : ''

  const activeEvents = EVENT_BADGES.filter(e => joinbrands[e.key] || full[e.key]).slice(0, 2)

  return (
    <div
      onClick={onClick}
      className="mx-3 my-2 flex items-center gap-3.5 px-4 py-4 cursor-pointer transition-colors"
      style={{
        border: `1px solid ${WA.borderLight}`,
        borderLeft: `3px solid ${statusMeta.accent}`,
        background: statusMeta.bg,
        borderRadius: 22,
        boxShadow: '0 1px 2px rgba(15, 23, 42, 0.04)',
      }}
      onMouseEnter={e => e.currentTarget.style.background = statusMeta.hoverBg}
      onMouseLeave={e => e.currentTarget.style.background = statusMeta.bg}
    >
      {/* Avatar + unread dot */}
      <div className="relative shrink-0">
        <div className="rounded-full flex items-center justify-center text-white font-medium" style={{ background: ownerColor, width: 48, height: 48, fontSize: 16 }}>
          {(creator.primary_name || '?')[0]?.toUpperCase()}
        </div>
        {unread > 0 && (
          <div className="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full flex items-center justify-center text-white text-xs font-bold" style={{ background: '#ef4444' }}>
            {unread > 9 ? '9+' : unread}
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        {/* Name + Time row */}
        <div className="flex items-center justify-between">
          <span className="font-medium text-sm truncate" style={{ color: WA.textDark }}>{creator.primary_name || 'Unknown'}</span>
          {lastActiveLabel && (
            <span
              className="shrink-0 ml-2 text-xs"
              style={{ color: WA.textMuted }}
              title={lastActiveFull}
            >
              {lastActiveLabel}
            </span>
          )}
        </div>

        {/* Phone + msg count */}
        <div className="flex items-center gap-1.5 mt-0.5">
          <span className="text-xs" style={{ color: WA.textMuted }}>{creator.wa_phone || '-'}</span>
          <span className="text-xs" style={{ color: WA.borderLight }}>·</span>
          {creator.wa_owner && (
            <>
              <span
                className="text-[11px] px-1.5 py-0.5 rounded-full font-semibold"
                style={{ background: ownerColor + '18', color: ownerColor }}
              >
                {creator.wa_owner}
              </span>
              <span className="text-xs" style={{ color: WA.borderLight }}>·</span>
            </>
          )}
          <span className="text-xs" style={{ color: WA.textMuted }}>{creator.msg_count || 0} 条</span>
        </div>

        {/* Tags row */}
        {(activeEvents.length > 0 || priorityMeta || wacrm.agency_bound > 0 || creator.keeper_gmv > 0 || statusMeta.label) && (
          <div className="flex flex-wrap gap-1 mt-1">
            {statusMeta.label && (
              <span className="text-xs px-1.5 py-0.5 rounded-full font-medium" style={{ background: statusMeta.bg ***REMOVED***= 'transparent' ? 'rgba(0,0,0,0.05)' : statusMeta.bg, color: statusMeta.accent }}>
                {statusMeta.label}
              </span>
            )}
            {activeEvents.map(e => (
              <span key={e.key} className="text-xs px-1.5 py-0.5 rounded-full" style={{ background: e.bg, color: e.color }}>
                {e.label}
              </span>
            ))}
            {priorityMeta && (
              <span className="text-xs px-1.5 py-0.5 rounded-full" style={priorityMeta.style}>
                {priorityMeta.label}
              </span>
            )}
            {wacrm.agency_bound > 0 && (
              <span className="text-xs px-1.5 py-0.5 rounded-full" style={{ background: 'rgba(0,168,132,0.12)', color: '#008069' }}>Agency</span>
            )}
            {creator.keeper_gmv > 0 && (
              <span className="text-xs px-1.5 py-0.5 rounded-full font-medium" style={{ background: 'rgba(16,185,129,0.12)', color: '#10b981' }}>
                ${Number(creator.keeper_gmv).toLocaleString()}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ***REMOVED******REMOVED******REMOVED*** Empty State ***REMOVED******REMOVED******REMOVED***
function EmptyState({ viewMode }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center" style={{ background: WA.chatBg }}>
      <div className="w-20 h-20 rounded-full flex items-center justify-center mb-4" style={{ background: WA.teal + '15' }}>
        <span className="text-3xl">💬</span>
      </div>
      <h2 className="text-lg font-medium mb-1" style={{ color: WA.textDark }}>WA Bot CRM</h2>
      <p className="text-sm" style={{ color: WA.textMuted }}>选择一个达人开始对话</p>
      <div className="mt-6 flex gap-2">
        {[['🤖', 'AI 回复'], ['📊', 'SFT 训练'], ['⊞', '看板']].map(([icon, label]) => (
          <div key={label} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs" style={{ background: 'rgba(0,0,0,0.04)', color: WA.textMuted }}>
            <span>{icon}</span><span>{label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ***REMOVED******REMOVED******REMOVED*** Panel 2 空状态：显示全局统计 ***REMOVED******REMOVED******REMOVED***
function Panel2Empty({ stats, creators }) {
  if (!stats) {
    return (
      <div className="flex-1 flex items-center justify-center" style={{ background: WA.chatBg }}>
        <span style={{ color: WA.textMuted }}>加载中...</span>
      </div>
    )
  }
  const totalCreators = creators.length
  const totalMessages = stats.total_messages || 0
  const activeCreators = creators.filter(c => c.msg_count > 0).length
  const betaCount = creators.filter(c => c.beta_status ***REMOVED***= 'introduced' || c.beta_status ***REMOVED***= 'joined').length

  return (
    <div className="flex-1 flex flex-col" style={{ background: WA.chatBg }}>
      <div className="flex-1 overflow-y-auto p-5 space-y-4">
        {/* 标题 */}
        <div className="text-center mb-6">
          <div className="text-4xl mb-2">📊</div>
          <div className="font-semibold" style={{ color: WA.textDark }}>WA CRM</div>
          <div className="text-xs mt-1" style={{ color: WA.textMuted }}>全局概览</div>
        </div>

        {/* 核心统计 */}
        <div className="grid grid-cols-2 gap-3">
          <div className="text-center p-4 rounded-xl" style={{ background: WA.white }}>
            <div className="text-2xl font-bold" style={{ color: WA.teal }}>{totalCreators}</div>
            <div className="text-xs mt-1" style={{ color: WA.textMuted }}>总达人</div>
          </div>
          <div className="text-center p-4 rounded-xl" style={{ background: WA.white }}>
            <div className="text-2xl font-bold" style={{ color: WA.teal }}>{totalMessages.toLocaleString()}</div>
            <div className="text-xs mt-1" style={{ color: WA.textMuted }}>消息总数</div>
          </div>
          <div className="text-center p-4 rounded-xl" style={{ background: WA.white }}>
            <div className="text-2xl font-bold" style={{ color: '#10b981' }}>{activeCreators}</div>
            <div className="text-xs mt-1" style={{ color: WA.textMuted }}>活跃达人</div>
          </div>
          <div className="text-center p-4 rounded-xl" style={{ background: WA.white }}>
            <div className="text-2xl font-bold" style={{ color: '#8b5cf6' }}>{betaCount}</div>
            <div className="text-xs mt-1" style={{ color: WA.textMuted }}>Beta 已引入</div>
          </div>
        </div>

        {/* 按负责人分布 */}
        {stats.by_owner && Object.keys(stats.by_owner).length > 0 && (
          <div className="rounded-xl p-4" style={{ background: WA.white }}>
            <div className="text-xs font-semibold mb-3" style={{ color: WA.textMuted }}>按负责人</div>
            <div className="space-y-2">
              {Object.entries(stats.by_owner).map(([owner, count]) => (
                <div key={owner} className="flex items-center justify-between">
                  <span className="text-sm" style={{ color: WA.textDark }}>{owner}</span>
                  <span className="text-sm font-bold" style={{ color: WA.teal }}>{count}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 提示 */}
        <div className="text-center text-xs py-3 rounded-xl" style={{ background: 'rgba(0,168,132,0.08)', color: WA.textMuted }}>
          👈 从左侧列表选择一个达人
        </div>
      </div>
    </div>
  )
}

export default App
