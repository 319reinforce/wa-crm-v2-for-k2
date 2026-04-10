import React, { useState, useEffect, useCallback } from 'react'
import { WAMessageComposer } from './components/WAMessageComposer'
import { SFTDashboard } from './components/SFTDashboard'
import { EventPanel } from './components/EventPanel'
import { WorkerStatusBar } from './components/WorkerStatusBar'

const API_BASE = '/api'

const WA = {
  darkHeader: '#111b21',
  teal: '#00a884',
  tealDark: '#008069',
  lightBg: '#f0f2f5',
  chatBg: '#efeae2',
  white: '#ffffff',
  borderLight: '#e9edef',
  bubbleOut: '#d9fdd3',
  bubbleIn: '#ffffff',
  textDark: '#111b21',
  textMuted: '#667781',
  hover: '#f5f6f6',
  darkBg: '#111b21',
}

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

const KANBAN_COLUMNS = [
  { key: 'new', label: '🆕 新建', color: '#94a3b8', filter: c => !c.msg_count },
  { key: 'active', label: '🔥 活跃', color: '#10b981', filter: c => c.msg_count > 5 },
  { key: 'trial', label: '⏳ 试用中', color: '#3b82f6', filter: c => c.ev_trial_active },
  { key: 'monthly', label: '💎 月卡', color: '#8b5cf6', filter: c => c.ev_monthly_started || c.ev_monthly_joined },
  { key: 'churned', label: '⚠️ 流失', color: '#ef4444', filter: c => c.ev_churned },
]

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
  const [lastRefreshed, setLastRefreshed] = useState(null)
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false)
  const [tagsVisible, setTagsVisible] = useState(true)
  const [waQrData, setWaQrData] = useState(null)  // WA QR code data URL

  // 轮询 WhatsApp 状态和二维码
  useEffect(() => {
    async function fetchWaStatus() {
      try {
        const res = await fetch(`${API_BASE}/wa/status`)
        const data = await res.json()
        if (data.hasQr) {
          try {
            const qrRes = await fetch(`${API_BASE}/wa/qr`)
            const qrInfo = await qrRes.json()
            if (qrInfo.qr) setWaQrData(qrInfo.qr)
          } catch (_) {}
        } else {
          setWaQrData(null)
        }
      } catch (_) {}
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
  const [dragging, setDragging] = useState(null) // 'list-detail' | 'detail-chat'

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
        } else if (dragging ***REMOVED***= 'detail-chat') {
          // clientX is the position of divider 2 (detail-chat boundary)
          // Detail panel width = divider2_position - divider1_position - divider1_width
          next.detail = Math.min(Math.max(240, clientX - next.list - 6), 520)
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

  // loadData ref：确保 SSE 回调永远调用最新版本的 loadData（带当前 filter 值）
  const loadDataRef = useRef(loadData)
  useEffect(() => { loadDataRef.current = loadData }, [loadData])

  useEffect(() => {
    loadData()
    const interval = setInterval(loadData, 15000)
    return () => clearInterval(interval)
  }, [filterOwner, filterBeta, filterPriority, filterAgency, filterEvent])

  // SSE 实时订阅（populate_db.cjs 写完 MySQL 后会收到广播）
  useEffect(() => {
    let es
    try {
      es = new EventSource('/api/events/subscribe')
      es.addEventListener('creators-updated', () => {
        console.log('[SSE] 收到刷新事件，重新加载数据')
        loadDataRef.current()
      })
      es.onerror = () => {
        console.warn('[SSE] 连接断开，5秒后自动重连')
      }
    } catch (e) {
      console.warn('[SSE] 连接失败，使用轮询兜底:', e.message)
    }
    return () => { if (es) es.close() }
  }, [])

  // 计算未读：基于 ev_replied 字段（0=未回复显示红点，1=已回复消除红点）
  const loadData = async () => {
    console.log('[WACRM] 刷新开始', new Date().toLocaleTimeString('zh-CN'))
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (filterOwner) params.set('owner', filterOwner)

      const [creatorsData, statsData] = await Promise.all([
        fetch(`${API_BASE}/creators?${params.toString()}`).then(r => r.json()),
        fetch(`${API_BASE}/stats`).then(r => r.json()),
      ])

      // Enrich with full data
      const enriched = await Promise.all(creatorsData.map(async c => {
        try {
          const full = await fetch(`${API_BASE}/creators/${c.id}`).then(r => r.json())
          return { ...c, _full: full }
        } catch {
          return c
        }
      }))

      // 计算未读：基于 ev_replied 字段（0=未回复显示红点，1=已回复消除红点）
      const newUnread = {}
      for (const c of creatorsData) {
        newUnread[c.id] = c.ev_replied ? 0 : 1
      }
      setUnreadCounts(newUnread)

      // 按最后活跃时间倒序（最新的在前面）
      enriched.sort((a, b) => (new Date(b.updated_at).getTime() || 0) - (new Date(a.updated_at).getTime() || 0))

      setCreators(enriched)
      setStats(statsData)
      setLastRefreshed(new Date())
      console.log(`[WACRM] 刷新成功: ${enriched.length} 位达人`, new Date().toLocaleTimeString('zh-CN'))
    } catch (e) {
      console.error('[WACRM] 加载失败:', e)
    } finally {
      setLoading(false)
    }
  }

  const handleSelectCreator = (creator) => {
    // 标记该联系人的未读为 0
    setUnreadCounts(prev => ({ ...prev, [creator.id]: 0 }))
    setSelectedCreator(creator)
  }

  const filteredCreators = creators.filter(c => {
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
      const evKey = `ev_${filterEvent}`
      if (!c._full?.joinbrands?.[evKey]) return false
    }
    return true
  })

  const activeFilterCount = [filterBeta, filterPriority, filterAgency, filterEvent].filter(Boolean).length

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
                  {lastRefreshed && (
                    <div className="text-xs mt-0.5 truncate" style={{ color: 'rgba(255,255,255,0.4)' }}>
                      更新 {lastRefreshed.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                    </div>
                  )}
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
              <div className="flex items-center gap-1 px-3 py-2 border-b" style={{ borderColor: WA.borderLight }}>
                {['', 'Beau', 'Yiyun'].map(o => (
                  <button key={o} onClick={() => setFilterOwner(o)} className="flex-1 py-1.5 rounded-lg text-xs font-medium transition-colors" style={{ background: filterOwner ***REMOVED***= o ? WA.teal : 'transparent', color: filterOwner ***REMOVED***= o ? 'white' : WA.textMuted }}>{o ***REMOVED***= '' ? '全部' : o}</button>
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
                {lastRefreshed && (
                  <div className="text-xs mt-0.5" style={{ color: 'rgba(255,255,255,0.4)' }}>
                    更新 {lastRefreshed.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                  </div>
                )}
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
            {['', 'Beau', 'Yiyun'].map(o => (
              <button
                key={o}
                onClick={() => setFilterOwner(o)}
                className="flex-1 py-2 rounded-xl text-sm font-semibold transition-all"
                style={{
                  background: filterOwner ***REMOVED***= o ? WA.teal : 'transparent',
                  color: filterOwner ***REMOVED***= o ? 'white' : WA.textMuted,
                  fontSize: '13px'
                }}
              >
                {o ***REMOVED***= '' ? '全部' : o}
              </button>
            ))}
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

        {/* Panel 2: Creator Info */}
        <div className="shrink-0 flex flex-col" style={{ width: panelWidths.detail, minWidth: panelWidths.detail, maxWidth: panelWidths.detail }}>
          {selectedCreator ? (
            <CreatorDetail
              creatorId={selectedCreator.id}
              creatorName={selectedCreator.primary_name}
              onClose={() => setSelectedCreator(null)}
              asPanel
            />
          ) : (
            <Panel2Empty stats={stats} creators={creators} />
          )}
        </div>

        {/* 分隔线 2：详情 ↔ 聊天 */}
        <div
          className="w-1.5 shrink-0 cursor-col-resize group relative z-10"
          style={{ background: dragging ***REMOVED***= 'detail-chat' ? WA.teal : 'transparent' }}
          onMouseDown={startDrag('detail-chat')}
          onTouchStart={startDrag('detail-chat')}
        >
          <div className="absolute inset-y-0 -left-1 -right-1 group-hover:flex hidden items-center justify-center">
            <div className="w-1.5 h-12 rounded-full flex flex-col items-center justify-center gap-1" style={{ background: WA.borderLight }}>
              <span className="w-1 h-1 rounded-full" style={{ background: WA.textMuted }} />
              <span className="w-1 h-1 rounded-full" style={{ background: WA.textMuted }} />
              <span className="w-1 h-1 rounded-full" style={{ background: WA.textMuted }} />
            </div>
          </div>
        </div>

        {/* Panel 3: Chat */}
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

          {/* Event pills bar — toggleable */}
          {selectedCreator.joinbrands && (
            <div
              className="overflow-x-auto px-4 py-2 gap-2 transition-all duration-200"
              style={{
                background: WA.white,
                borderBottom: `1px solid ${WA.borderLight}`,
                maxHeight: tagsVisible ? '60px' : '0',
                overflow: 'hidden',
                opacity: tagsVisible ? 1 : 0,
              }}
            >
              <div className="flex gap-2">
                {selectedCreator.joinbrands.ev_trial_active && <span className="text-xs px-3 py-1 rounded-full font-semibold shrink-0" style={{ background: '#3b82f618', color: '#3b82f6' }}>七日挑战进行中</span>}
                {selectedCreator.joinbrands.ev_monthly_started && <span className="text-xs px-3 py-1 rounded-full font-semibold shrink-0" style={{ background: '#8b5cf618', color: '#8b5cf6' }}>开启月度挑战</span>}
                {selectedCreator.joinbrands.ev_monthly_joined && <span className="text-xs px-3 py-1 rounded-full font-semibold shrink-0" style={{ background: '#10b98118', color: '#10b981' }}>月卡加入</span>}
                {selectedCreator.joinbrands.ev_whatsapp_shared && <span className="text-xs px-3 py-1 rounded-full font-semibold shrink-0" style={{ background: '#00a88418', color: '#00a884' }}>WA已发</span>}
                {selectedCreator.joinbrands.ev_gmv_1k && <span className="text-xs px-3 py-1 rounded-full font-semibold shrink-0" style={{ background: '#f59e0b18', color: '#f59e0b' }}>GMV&gt;1K</span>}
                {selectedCreator.joinbrands.ev_gmv_1k && <span className="text-xs px-3 py-1 rounded-full font-semibold shrink-0" style={{ background: '#f59e0b18', color: '#f59e0b' }}>GMV 1K</span>}
                {selectedCreator.joinbrands.ev_gmv_2k && <span className="text-xs px-3 py-1 rounded-full font-semibold shrink-0" style={{ background: '#f9731618', color: '#f97316' }}>GMV 2K</span>}
                {selectedCreator.joinbrands.ev_gmv_5k && <span className="text-xs px-3 py-1 rounded-full font-semibold shrink-0" style={{ background: '#f9731618', color: '#f97316' }}>GMV 5K</span>}
                {selectedCreator.joinbrands.ev_gmv_10k && <span className="text-xs px-3 py-1 rounded-full font-semibold shrink-0" style={{ background: '#ef444418', color: '#ef4444' }}>GMV 10K</span>}
                {selectedCreator.joinbrands.ev_churned && <span className="text-xs px-3 py-1 rounded-full font-semibold shrink-0" style={{ background: '#ef444418', color: '#ef4444' }}>已流失</span>}
              </div>
            </div>
          )}

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
  const ownerColor = { 'Beau': '#3b82f6', 'Yiyun': '#8b5cf6' }[creator.wa_owner] || '#94a3b8'
  return (
    <div
      onClick={onClick}
      className="bg-white rounded-xl p-4 cursor-pointer hover:shadow-lg transition-all"
      style={{ borderLeft: `4px solid ${color}` }}
    >
      <div className="flex items-center gap-3 mb-3">
        <div className="w-10 h-10 rounded-full flex items-center justify-center text-white text-sm font-bold" style={{ background: ownerColor }}>
          {(creator.primary_name || '?')[0]?.toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold truncate" style={{ color: WA.textDark }}>{creator.primary_name || 'Unknown'}</div>
          <div className="text-xs" style={{ color: WA.textMuted }}>{creator.wa_phone || '-'}</div>
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
function formatRelativeTime(ts) {
  if (!ts) return null
  const diff = Date.now() - ts
  const m = Math.floor(diff / 60000)
  const h = Math.floor(diff / 3600000)
  const d = Math.floor(diff / 86400000)
  if (m < 1) return '刚刚'
  if (m < 60) return `${m}分钟前`
  if (h < 24) return `${h}小时前`
  if (d ***REMOVED***= 1) return '昨天'
  if (d < 7) return `${d}天前`
  const md = new Date(ts)
  return `${md.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })}`
}

// ***REMOVED******REMOVED******REMOVED*** Chat List Item ***REMOVED******REMOVED******REMOVED***
function ChatListItem({ creator, onClick, unread }) {
  const ownerColor = { 'Beau': '#3b82f6', 'Yiyun': '#8b5cf6' }[creator.wa_owner] || WA.textMuted
  const full = creator._full || {}
  const wacrm = full.wacrm || {}

  const lastActiveTs = creator.updated_at ? new Date(creator.updated_at).getTime() : 0
  const lastActiveLabel = lastActiveTs ? formatRelativeTime(lastActiveTs) : null
  const lastActiveFull = lastActiveTs
    ? new Date(lastActiveTs).toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    : ''
  const isRecent = lastActiveTs && (Date.now() - lastActiveTs) < 86400000

  const activeEvents = EVENT_BADGES.filter(e => full[e.key]).slice(0, 2)

  return (
    <div
      onClick={onClick}
      className="flex items-center gap-3 px-4 py-3 cursor-pointer transition-colors"
      style={{ borderBottom: `1px solid ${WA.borderLight}`, background: 'transparent' }}
      onMouseEnter={e => e.currentTarget.style.background = WA.hover}
      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
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
              style={{ color: isRecent ? WA.teal : WA.textMuted }}
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
          <span className="text-xs" style={{ color: WA.textMuted }}>{creator.msg_count || 0} 条</span>
        </div>

        {/* Tags row */}
        {(activeEvents.length > 0 || wacrm.priority || wacrm.agency_bound > 0 || creator.keeper_gmv > 0) && (
          <div className="flex flex-wrap gap-1 mt-1">
            {activeEvents.map(e => (
              <span key={e.key} className="text-xs px-1.5 py-0.5 rounded-full" style={{ background: e.bg, color: e.color }}>
                {e.label}
              </span>
            ))}
            {wacrm.priority && wacrm.priority !***REMOVED*** 'low' && (
              <span className="text-xs px-1.5 py-0.5 rounded-full" style={{ background: wacrm.priority ***REMOVED***= 'high' ? 'rgba(239,68,68,0.12)' : 'rgba(245,158,11,0.12)', color: wacrm.priority ***REMOVED***= 'high' ? '#ef4444' : '#f59e0b' }}>
                {wacrm.priority ***REMOVED***= 'high' ? '高优先级' : '中优先级'}
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

// ***REMOVED******REMOVED******REMOVED*** Creator Detail Panel ***REMOVED******REMOVED******REMOVED***
function CreatorDetail({ creatorId, creatorName, onClose, asPanel }) {
  const [creator, setCreator] = useState(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [showEdit, setShowEdit] = useState(false)
  const [editForm, setEditForm] = useState({})
  const [editFormInitial, setEditFormInitial] = useState({})
  const [editSaving, setEditSaving] = useState(false)
  const [editPanelOpen, setEditPanelOpen] = useState(false)
  const [clientProfile, setClientProfile] = useState(null)
  const [profileRefreshing, setProfileRefreshing] = useState(false)
  const [profileExpanded, setProfileExpanded] = useState(false)

  const fetchCreator = useCallback((silent = false) => {
    if (!silent) setRefreshing(true)
    fetch(`/api/creators/${creatorId}`)
      .then(r => r.json())
      .then(data => {
        setCreator(data)
        setEditForm({
          primary_name: data.primary_name || '',
          wa_phone: data.wa_phone || '',
          wa_owner: data.wa_owner || '',
          keeper_username: data.keeper_username || '',
          beta_status: data.wacrm?.beta_status || 'not_introduced',
          priority: data.wacrm?.priority || 'normal',
          agency_bound: data.wacrm?.agency_bound ? '1' : '0',
          video_count: data.wacrm?.video_count || 0,
        })
        setLoading(false)
        setRefreshing(false)
      })
      .catch(() => {
        setLoading(false)
        setRefreshing(false)
      })
  }, [creatorId])

  // 获取客户画像（summary + tags + memory）
  const fetchClientProfile = useCallback((silent = false) => {
    if (!creator?.wa_phone) return
    if (!silent) setProfileRefreshing(true)
    fetch(`/api/client-profile/${encodeURIComponent(creator.wa_phone)}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data) setClientProfile(data) })
      .catch(() => {})
      .finally(() => { if (!silent) setProfileRefreshing(false) })
  }, [creator?.wa_phone])

  useEffect(() => {
    fetchCreator(true)
    fetchClientProfile()
    const i = setInterval(() => fetchCreator(true), 8000)
    return () => clearInterval(i)
  }, [fetchCreator, fetchClientProfile])

  // 当 creator 变化时，同步 editForm（用于内联编辑）
  useEffect(() => {
    if (!creator) return
    const jb = creator.joinbrands || {};
    const w = creator.wacrm || {};
    const k = creator.keeper || {};
    setEditForm({
      primary_name: creator.primary_name || '',
      wa_phone: creator.wa_phone || '',
      wa_owner: creator.wa_owner || '',
      keeper_username: creator.keeper_username || '',
      beta_status: w.beta_status || 'not_introduced',
      priority: w.priority || 'normal',
      agency_bound: w.agency_bound ? '1' : '0',
      video_count: w.video_count || 0,
      video_target: w.video_target || 35,
      monthly_fee_status: w.monthly_fee_status || 'pending',
      monthly_fee_amount: w.monthly_fee_amount || 0,
      keeper_gmv: k.keeper_gmv || 0,
      keeper_gmv30: k.keeper_gmv30 || 0,
      keeper_orders: k.keeper_orders || 0,
      ev_trial_active: !!jb.ev_trial_active,
      ev_monthly_started: !!jb.ev_monthly_started,
      ev_monthly_joined: !!jb.ev_monthly_joined,
      ev_whatsapp_shared: !!jb.ev_whatsapp_shared,
      ev_gmv_1k: !!jb.ev_gmv_1k,
      ev_gmv_2k: !!jb.ev_gmv_2k,
      ev_gmv_5k: !!jb.ev_gmv_5k,
      ev_gmv_10k: !!jb.ev_gmv_10k,
      ev_agency_bound: !!jb.ev_agency_bound,
      ev_churned: !!jb.ev_churned,
    })
  }, [creator])

  const handleRefresh = () => fetchCreator(false)

  const handleEditOpen = () => {
    const jb = creator?.joinbrands || {};
    const w = creator?.wacrm || {};
    const k = creator?.keeper || {};
    const initial = {
      primary_name: creator.primary_name || '',
      wa_phone: creator.wa_phone || '',
      wa_owner: creator.wa_owner || '',
      keeper_username: creator.keeper_username || '',
      beta_status: w.beta_status || 'not_introduced',
      priority: w.priority || 'normal',
      agency_bound: w.agency_bound ? '1' : '0',
      video_count: w.video_count || 0,
      video_target: w.video_target || 35,
      monthly_fee_status: w.monthly_fee_status || 'pending',
      monthly_fee_amount: w.monthly_fee_amount || 0,
      next_action: w.next_action || '',
      keeper_gmv: k.keeper_gmv || 0,
      keeper_gmv30: k.keeper_gmv30 || 0,
      keeper_orders: k.keeper_orders || 0,
      keeper_videos: k.keeper_videos || 0,
      keeper_videos_posted: k.keeper_videos_posted || 0,
      keeper_videos_sold: k.keeper_videos_sold || 0,
      keeper_card_rate: k.keeper_card_rate || '',
      keeper_order_rate: k.keeper_order_rate || '',
      keeper_reg_time: k.keeper_reg_time || 0,
      keeper_activate_time: k.keeper_activate_time || 0,
      ev_trial_active: !!jb.ev_trial_active,
      ev_monthly_started: !!jb.ev_monthly_started,
      ev_gmv_1k: !!jb.ev_gmv_1k,
      ev_gmv_2k: !!jb.ev_gmv_2k,
      ev_gmv_5k: !!jb.ev_gmv_5k,
      ev_gmv_10k: !!jb.ev_gmv_10k,
      ev_agency_bound: !!jb.ev_agency_bound,
      ev_churned: !!jb.ev_churned,
    }
    setEditForm(initial)
    setEditFormInitial(initial)
    // Panel 模式不走 modal，直接用内联表单
    if (!asPanel) setShowEdit(true)
  }

  const handleEditSave = async () => {
    setEditSaving(true)
    try {
      // 更新 creators 表（基本信息）
      await fetch(`/api/creators/${creatorId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          primary_name: editForm.primary_name,
          wa_phone: editForm.wa_phone,
          wa_owner: editForm.wa_owner,
          keeper_username: editForm.keeper_username,
        })
      })
      // 更新 wa_crm_data + joinbrands_link + keeper_link（运营数据 & 事件标签）
      await fetch(`/api/creators/${creatorId}/wacrm`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          beta_status: editForm.beta_status,
          priority: editForm.priority,
          agency_bound: parseInt(editForm.agency_bound),
          video_count: parseInt(editForm.video_count) || 0,
          video_target: parseInt(editForm.video_target) || 35,
          monthly_fee_status: editForm.monthly_fee_status,
          monthly_fee_amount: parseFloat(editForm.monthly_fee_amount) || 0,
          next_action: editForm.next_action || null,
          keeper_gmv: parseFloat(editForm.keeper_gmv) || 0,
          keeper_gmv30: parseFloat(editForm.keeper_gmv30) || 0,
          keeper_orders: parseInt(editForm.keeper_orders) || 0,
          keeper_videos: parseInt(editForm.keeper_videos) || 0,
          keeper_videos_posted: parseInt(editForm.keeper_videos_posted) || 0,
          keeper_videos_sold: parseInt(editForm.keeper_videos_sold) || 0,
          keeper_card_rate: editForm.keeper_card_rate || '',
          keeper_order_rate: editForm.keeper_order_rate || '',
          keeper_reg_time: parseInt(editForm.keeper_reg_time) || 0,
          keeper_activate_time: parseInt(editForm.keeper_activate_time) || 0,
          ev_trial_active: !!editForm.ev_trial_active,
          ev_monthly_started: !!editForm.ev_monthly_started,
          ev_gmv_1k: !!editForm.ev_gmv_1k,
          ev_gmv_2k: !!editForm.ev_gmv_2k,
          ev_gmv_5k: !!editForm.ev_gmv_5k,
          ev_gmv_10k: !!editForm.ev_gmv_10k,
          ev_agency_bound: !!editForm.ev_agency_bound,
          ev_churned: !!editForm.ev_churned,
        })
      })
      setShowEdit(false)
      if (asPanel) setEditPanelOpen(false)
      fetchCreator(true)
    } catch (e) {
      console.error('保存失败:', e)
    } finally {
      setEditSaving(false)
    }
  }

  if (loading) return (
    <div className="flex items-center justify-center h-full" style={{ background: WA.white }}>
      <div className="flex flex-col items-center gap-2">
        <div className="w-8 h-8 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: WA.teal, borderTopColor: 'transparent' }} />
        <span className="text-xs" style={{ color: WA.textMuted }}>加载中...</span>
      </div>
    </div>
  )

  const wacrm = creator?.wacrm || {}
  const clientInfo = {
    id: creator?.id,
    phone: creator?.wa_phone,
    name: creator?.primary_name,
    wa_owner: creator?.wa_owner,
    conversion_stage: wacrm.beta_status || 'unknown',
    priority: wacrm.priority || 'normal',
    sentiment: 'neutral',
    msg_count: creator?.messages?.length || 0,
    messages: creator?.messages || []
  }

  return (
    <>
      {/* Desktop: as a resizable panel — no overlay */}
      {asPanel ? (
        <div className="flex flex-col h-full" style={{ background: WA.white }}>
          {/* Header */}
          <div className="flex items-center gap-3 px-5 py-4" style={{ background: WA.darkHeader }}>
            <button onClick={onClose} className="text-white/70 hover:text-white text-xl">←</button>
            <div className="w-11 h-11 rounded-full flex items-center justify-center text-white font-bold text-base" style={{ background: WA.teal }}>
              {(creator?.primary_name || '?')[0]?.toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-semibold text-base text-white truncate">{creatorName}</div>
              <div className="text-xs text-white/50">{creator?.wa_phone}</div>
            </div>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            <div className="grid grid-cols-4 gap-2">
              <MiniStat label="消息" value={creator?.messages?.length || 0} />
              <MiniStat label="GMV" value={creator?.keeper_gmv ? '$' + Number(creator?.keeper_gmv).toLocaleString() : '-'} />
              <MiniStat label="30天GMV" value={creator?.keeper_gmv30 ? '$' + Number(creator?.keeper_gmv30).toLocaleString() : '-'} />
              <MiniStat label="事件评分" value={wacrm.event_score != null ? wacrm.event_score.toFixed(1) : '-'} />
              <MiniStat label="紧急度" value={wacrm.urgency_level != null ? wacrm.urgency_level : '-'} />
              <MiniStat label="视频数" value={creator?.keeper?.keeper_videos || '-'} />
              <MiniStat label="已发布" value={creator?.keeper?.keeper_videos_posted || '-'} />
              <MiniStat label="已售出" value={creator?.keeper?.keeper_videos_sold || '-'} />
            </div>

            <CreatorEventsSection creatorId={creatorId} />

            <Section title="基本信息">
              <InfoRow label="电话" value={creator?.wa_phone || '-'} />
              <InfoRow label="Keeper" value={creator?.keeper_username || '-'} />
              <InfoRow label="负责人" value={creator?.wa_owner || '-'} />
            </Section>

            <Section title="Beta & 月费">
              <InfoRow label="Beta" value={wacrm.beta_status || '-'} />
              <InfoRow label="月费" value={wacrm.monthly_fee_status || '-'} />
              <InfoRow label="月费金额" value={wacrm.monthly_fee_amount ? '$' + wacrm.monthly_fee_amount : '-'} />
            </Section>

            <Section title="状态">
              <InfoRow label="优先级" value={wacrm.priority || '-'} />
              <InfoRow label="Agency绑定" value={wacrm.agency_bound ? '✓ 是' : '✗ 否'} />
              <InfoRow label="视频数" value={wacrm.video_count ? `${wacrm.video_count} / ${wacrm.video_target || 35}` : '-'} />
            </Section>

            {/* ***REMOVED******REMOVED***= 画像管理（可折叠）***REMOVED******REMOVED******REMOVED*** */}
            <div className="rounded-xl border" style={{ borderColor: WA.borderLight, background: WA.white }}>
              {/* 折叠头部 */}
              <div
                className="flex items-center justify-between px-4 py-3 cursor-pointer"
                onClick={() => setProfileExpanded(v => !v)}
              >
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold" style={{ color: '#111b21' }}>画像管理</span>
                  {clientProfile?.tags?.length > 0 && (
                    <span className="text-xs px-1.5 py-0.5 rounded-full" style={{ background: '#f0f0f0', color: '#667781' }}>
                      {clientProfile.tags.length}标签
                    </span>
                  )}
                  {clientProfile?.memory?.filter(m => m.type ***REMOVED***= 'strategy').length > 0 && (
                    <span className="text-xs px-1.5 py-0.5 rounded-full" style={{ background: 'rgba(0,168,132,0.12)', color: '#008069' }}>
                      {clientProfile.memory.filter(m => m.type ***REMOVED***= 'strategy').length}策略
                    </span>
                  )}
                </div>
                <span className="text-sm" style={{ color: '#667781' }}>{profileExpanded ? '▲' : '▼'}</span>
              </div>

              {/* 展开内容 */}
              {profileExpanded && (
                <div className="px-4 pb-4 space-y-3 border-t" style={{ borderColor: WA.borderLight }}>
                  {/* AI 摘要 */}
                  <div className="pt-3">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-xs font-semibold" style={{ color: '#111b21' }}>AI 摘要</span>
                      <button
                        onClick={() => fetchClientProfile()}
                        disabled={profileRefreshing}
                        className="text-xs px-2 py-0.5 rounded hover:opacity-80 transition-opacity"
                        style={{ color: profileRefreshing ? '#667781' : '#00a884' }}
                      >
                        {profileRefreshing ? '刷新中...' : '🔄 刷新'}
                      </button>
                    </div>
                    {clientProfile?.summary ? (
                      <div className="text-sm py-2 px-3 rounded-lg" style={{ background: '#f0f2f5', color: '#111b21' }}>
                        {clientProfile.summary}
                      </div>
                    ) : (
                      <div className="text-sm" style={{ color: '#667781' }}>暂无摘要</div>
                    )}
                  </div>

                  {/* 客户标签 */}
                  <div>
                    <div className="text-xs font-semibold mb-1.5" style={{ color: '#111b21' }}>客户标签</div>
                    {clientProfile?.tags?.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mb-2">
                        {clientProfile.tags.map((t, i) => (
                          <span key={i} className="flex items-center gap-1 text-xs px-2 py-1 rounded-full" style={{ background: '#f0f0f0', color: '#111b21' }}>
                            {t.tag}
                            <button
                              onClick={() => {
                                fetch(`/api/client-profiles/${encodeURIComponent(creator?.wa_phone)}/tags`, {
                                  method: 'PUT',
                                  headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify({ tag: t.tag, action: 'delete' })
                                }).then(() => fetchClientProfile())
                              }}
                              className="text-red-400 hover:text-red-600 font-bold ml-0.5"
                            >×</button>
                          </span>
                        ))}
                      </div>
                    )}
                    <div className="flex flex-wrap gap-1.5">
                      <span className="text-xs w-10 shrink-0 pt-1" style={{ color: '#667781' }}>语气</span>
                      {[['tone:casual','休闲'],['tone:formal','正式'],['tone:friendly','友好']].map(([tag, label]) => (
                        <button key={tag} onClick={() => { fetch(`/api/client-profiles/${encodeURIComponent(creator?.wa_phone)}/tags`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tag, action: 'upsert' }) }).then(() => fetchClientProfile()) }}
                          className="text-xs px-2 py-1 rounded-full border" style={{ borderColor: '#e9edef', color: '#111b21', background: 'transparent' }}>+ {label}</button>
                      ))}
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      <span className="text-xs w-10 shrink-0 pt-1" style={{ color: '#667781' }}>内容</span>
                      {[['format:video','视频'],['format:text','图文'],['format:mixed','混合']].map(([tag, label]) => (
                        <button key={tag} onClick={() => { fetch(`/api/client-profiles/${encodeURIComponent(creator?.wa_phone)}/tags`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tag, action: 'upsert' }) }).then(() => fetchClientProfile()) }}
                          className="text-xs px-2 py-1 rounded-full border" style={{ borderColor: '#e9edef', color: '#111b21', background: 'transparent' }}>+ {label}</button>
                      ))}
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      <span className="text-xs w-10 shrink-0 pt-1" style={{ color: '#667781' }}>阶段</span>
                      {[['stage:new','新用户'],['stage:trial','试用中'],['stage:onboarding','onboarding'],['stage:active','活跃'],['stage:churned','流失']].map(([tag, label]) => (
                        <button key={tag} onClick={() => { fetch(`/api/client-profiles/${encodeURIComponent(creator?.wa_phone)}/tags`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tag, action: 'upsert' }) }).then(() => fetchClientProfile()) }}
                          className="text-xs px-2 py-1 rounded-full border" style={{ borderColor: '#e9edef', color: '#111b21', background: 'transparent' }}>+ {label}</button>
                      ))}
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      <span className="text-xs w-10 shrink-0 pt-1" style={{ color: '#667781' }}>偏好</span>
                      {[['interest:drifto','DRIFTO'],['interest:fashion','时尚'],['interest:beauty','美妆'],['interest:lifestyle','生活']].map(([tag, label]) => (
                        <button key={tag} onClick={() => { fetch(`/api/client-profiles/${encodeURIComponent(creator?.wa_phone)}/tags`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tag, action: 'upsert' }) }).then(() => fetchClientProfile()) }}
                          className="text-xs px-2 py-1 rounded-full border" style={{ borderColor: '#e9edef', color: '#111b21', background: 'transparent' }}>+ {label}</button>
                      ))}
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      <span className="text-xs w-10 shrink-0 pt-1" style={{ color: '#667781' }}>互动</span>
                      {[['engagement:high','高'],['engagement:medium','中'],['engagement:low','低']].map(([tag, label]) => (
                        <button key={tag} onClick={() => { fetch(`/api/client-profiles/${encodeURIComponent(creator?.wa_phone)}/tags`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tag, action: 'upsert' }) }).then(() => fetchClientProfile()) }}
                          className="text-xs px-2 py-1 rounded-full border" style={{ borderColor: '#e9edef', color: '#111b21', background: 'transparent' }}>+ {label}</button>
                      ))}
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      <span className="text-xs w-10 shrink-0 pt-1" style={{ color: '#667781' }}>来源</span>
                      {[['source:organic','自然流量'],['source:referral','推荐'],['source:ads','广告']].map(([tag, label]) => (
                        <button key={tag} onClick={() => { fetch(`/api/client-profiles/${encodeURIComponent(creator?.wa_phone)}/tags`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tag, action: 'upsert' }) }).then(() => fetchClientProfile()) }}
                          className="text-xs px-2 py-1 rounded-full border" style={{ borderColor: '#e9edef', color: '#111b21', background: 'transparent' }}>+ {label}</button>
                      ))}
                    </div>
                  </div>

                  {/* 回复策略 */}
                  <div className="border-t pt-3" style={{ borderColor: '#e9edef' }}>
                    <div className="text-xs font-semibold mb-1.5" style={{ color: '#111b21' }}>回复策略</div>
                    {clientProfile?.memory?.filter(m => m.type ***REMOVED***= 'strategy').length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mb-2">
                        {clientProfile.memory.filter(m => m.type ***REMOVED***= 'strategy').map((m, i) => (
                          <span key={i} className="flex items-center gap-1 text-xs px-2 py-1 rounded-full" style={{ background: 'rgba(0,168,132,0.12)', color: '#008069' }}>
                            {m.value}
                            <button onClick={() => {
                              fetch(`/api/client-profiles/${encodeURIComponent(creator?.wa_phone)}/memory`, {
                                method: 'DELETE',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ memory_type: 'strategy', memory_key: m.key })
                              }).then(() => fetchClientProfile())
                            }} className="text-red-400 hover:text-red-600 font-bold ml-0.5">×</button>
                          </span>
                        ))}
                      </div>
                    )}
                    <div className="flex flex-wrap gap-1.5">
                      {[
                        ['DRIFTO介绍', '介绍DRIFTO MCN背景、2个月签约期、佣金100%返还机制'],
                        ['价格咨询', '回应月费、Beta激励、套餐价格相关疑问'],
                        ['月费说明', '解释$20月费扣除规则、每周一结算'],
                        ['Beta计划', '介绍20天Beta $200激励、$10/天规则'],
                        ['月度挑战', '邀请开启月度挑战计划、DRIFTO MCN月费权益'],
                        ['流失挽回', '针对流失客户的激活话术、重新建立沟通'],
                        ['视频要求', '说明5个/天最佳、超6个TikTok降权规则'],
                        ['付款说明', '解释PayPal返还、佣金结算周期'],
                      ].map(([key, desc]) => (
                        <button key={key}
                          onClick={() => {
                            fetch(`/api/client-profiles/${encodeURIComponent(creator?.wa_phone)}/memory`, {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ memory_type: 'strategy', memory_key: key, memory_value: desc })
                            }).then(() => fetchClientProfile())
                          }}
                          className="text-xs px-2 py-1 rounded-full border"
                          style={{ borderColor: '#00a884', color: '#111b21', background: 'transparent' }}
                        >+ {key}</button>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>

            <Section title="事件">
              <div className="flex flex-wrap gap-1.5">
                {EVENT_BADGES.filter(e => creator?.[e.key]).map(e => (
                  <span key={e.key} className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ background: e.bg, color: e.color }}>
                    {e.label}
                  </span>
                ))}
                {!EVENT_BADGES.some(e => creator?.[e.key]) && (
                  <span className="text-xs" style={{ color: WA.textMuted }}>暂无事件</span>
                )}
              </div>
            </Section>

            <Section title="快捷操作">
              <div className="flex flex-col gap-2">
                <ActionPill label="更新状态" icon="🔄" color="#f59e0b" onClick={handleRefresh} loading={refreshing} />
                {asPanel ? (
                  <ActionPill
                    label={editPanelOpen ? '收起编辑' : '编辑达人'}
                    icon={editPanelOpen ? '▲' : '✏️'}
                    color="#3b82f6"
                    onClick={() => {
                      if (!editPanelOpen) handleEditOpen()
                      setEditPanelOpen(v => !v)
                    }}
                    disabled={editSaving}
                  />
                ) : (
                  <ActionPill label="编辑达人" icon="✏️" color="#3b82f6" onClick={handleEditOpen} />
                )}
              </div>

              {/* Panel 模式内联编辑表单 */}
              {asPanel && editPanelOpen && (
                <div className="mt-3 p-4 rounded-xl space-y-3" style={{ background: WA.lightBg }}>
                  <div className="text-xs font-semibold mb-2" style={{ color: WA.textMuted }}>快速编辑</div>

                  {/* 基本信息 */}
                  <InlineEditField label="Beta" value={editForm.beta_status || ''} onChange={v => setEditForm(f => ({ ...f, beta_status: v }))} type="select" options={[['not_introduced', '未引入'], ['introduced', '已引入'], ['churned', '流失']]} />
                  <InlineEditField label="月费状态" value={editForm.monthly_fee_status || ''} onChange={v => setEditForm(f => ({ ...f, monthly_fee_status: v }))} type="select" options={[['pending', '待支付'], ['paid', '已支付'], ['overdue', '逾期']]} />
                  <InlineEditField label="月费金额" value={String(editForm.monthly_fee_amount || 0)} onChange={v => setEditForm(f => ({ ...f, monthly_fee_amount: parseFloat(v) || 0 }))} type="number" />
                  <InlineEditField label="优先级" value={editForm.priority || ''} onChange={v => setEditForm(f => ({ ...f, priority: v }))} type="select" options={[['normal', '普通'], ['high', '高'], ['urgent', '紧急']]} />
                  <InlineEditField label="Agency绑定" value={editForm.agency_bound || '0'} onChange={v => setEditForm(f => ({ ...f, agency_bound: v }))} type="select" options={[['0', '否'], ['1', '是']]} />
                  <InlineEditField label="视频数" value={String(editForm.video_count || 0)} onChange={v => setEditForm(f => ({ ...f, video_count: parseInt(v) || 0 }))} type="number" />
                  <InlineEditField label="视频目标" value={String(editForm.video_target || 35)} onChange={v => setEditForm(f => ({ ...f, video_target: parseInt(v) || 35 }))} type="number" />
                  <div>
                    <div className="text-xs mb-1" style={{ color: WA.textMuted }}>下一步</div>
                    <textarea
                      className="w-full text-sm px-3 py-2 rounded-xl border focus:outline-none focus:ring-2 resize-none"
                      style={{ borderColor: WA.borderLight, background: WA.white, color: '#111b21' }}
                      rows={2}
                      value={editForm.next_action || ''}
                      onChange={e => setEditForm(f => ({ ...f, next_action: e.target.value }))}
                      placeholder="记录下一步跟进计划..."
                    />
                  </div>

                  {/* Keeper 数据 */}
                  <div className="border-t pt-2 mt-1" style={{ borderColor: WA.borderLight }}>
                    <div className="text-xs font-semibold mb-2" style={{ color: WA.textMuted }}>Keeper 数据</div>
                    <div className="grid grid-cols-2 gap-2">
                      <InlineEditField label="GMV" value={String(editForm.keeper_gmv || 0)} onChange={v => setEditForm(f => ({ ...f, keeper_gmv: parseFloat(v) || 0 }))} type="number" />
                      <InlineEditField label="30天GMV" value={String(editForm.keeper_gmv30 || 0)} onChange={v => setEditForm(f => ({ ...f, keeper_gmv30: parseFloat(v) || 0 }))} type="number" />
                      <InlineEditField label="视频总数" value={String(editForm.keeper_videos || 0)} onChange={v => setEditForm(f => ({ ...f, keeper_videos: parseInt(v) || 0 }))} type="number" />
                      <InlineEditField label="视频发布数" value={String(editForm.keeper_videos_posted || 0)} onChange={v => setEditForm(f => ({ ...f, keeper_videos_posted: parseInt(v) || 0 }))} type="number" />
                      <InlineEditField label="视频售出数" value={String(editForm.keeper_videos_sold || 0)} onChange={v => setEditForm(f => ({ ...f, keeper_videos_sold: parseInt(v) || 0 }))} type="number" />
                      <InlineEditField label="订单数" value={String(editForm.keeper_orders || 0)} onChange={v => setEditForm(f => ({ ...f, keeper_orders: parseInt(v) || 0 }))} type="number" />
                      <InlineEditField label="橱窗转化率" value={editForm.keeper_card_rate || ''} onChange={v => setEditForm(f => ({ ...f, keeper_card_rate: v }))} type="text" />
                      <InlineEditField label="订单转化率" value={editForm.keeper_order_rate || ''} onChange={v => setEditForm(f => ({ ...f, keeper_order_rate: v }))} type="text" />
                    </div>
                  </div>

                  {/* 事件标签 */}
                  <div className="border-t pt-2 mt-1" style={{ borderColor: WA.borderLight }}>
                    <div className="text-xs font-semibold mb-2" style={{ color: WA.textMuted }}>事件标签</div>
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-2">
                        <span className="text-xs w-20 shrink-0" style={{ color: WA.textMuted }}>挑战阶段</span>
                        <select
                          value={editForm.ev_trial_active ? 'active' : (editForm.ev_monthly_started ? 'monthly' : 'none')}
                          onChange={e => {
                            const v = e.target.value
                            setEditForm(f => ({
                              ...f,
                              ev_trial_active: v ***REMOVED***= 'active',
                              ev_monthly_started: v ***REMOVED***= 'monthly',
                            }))
                          }}
                          className="flex-1 text-xs px-2 py-1.5 rounded-lg border"
                          style={{ borderColor: WA.borderLight, background: WA.white, color: WA.textDark }}
                        >
                          <option value="none">无</option>
                          <option value="active">七日挑战进行中</option>
                          <option value="monthly">开启月度挑战</option>
                        </select>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs w-20 shrink-0" style={{ color: WA.textMuted }}>GMV 阶段</span>
                        <select
                          value={editForm.ev_gmv_10k ? '10k' : (editForm.ev_gmv_5k ? '5k' : (editForm.ev_gmv_2k ? '2k' : (editForm.ev_gmv_1k ? '1k' : 'none')))}
                          onChange={e => {
                            const v = e.target.value
                            setEditForm(f => ({
                              ...f,
                              ev_gmv_1k: v ***REMOVED***= '1k',
                              ev_gmv_2k: v ***REMOVED***= '2k',
                              ev_gmv_5k: v ***REMOVED***= '5k',
                              ev_gmv_10k: v ***REMOVED***= '10k',
                            }))
                          }}
                          className="flex-1 text-xs px-2 py-1.5 rounded-lg border"
                          style={{ borderColor: WA.borderLight, background: WA.white, color: WA.textDark }}
                        >
                          <option value="none">无</option>
                          <option value="1k">GMV&gt;1K</option>
                          <option value="2k">GMV&gt;2K</option>
                          <option value="5k">GMV&gt;5K</option>
                          <option value="10k">GMV&gt;10K</option>
                        </select>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs w-20 shrink-0" style={{ color: WA.textMuted }}>状态</span>
                        <select
                          value={editForm.ev_churned ? 'churned' : (editForm.ev_agency_bound ? 'agency' : 'active')}
                          onChange={e => {
                            const v = e.target.value
                            setEditForm(f => ({
                              ...f,
                              ev_agency_bound: v ***REMOVED***= 'agency',
                              ev_churned: v ***REMOVED***= 'churned',
                            }))
                          }}
                          className="flex-1 text-xs px-2 py-1.5 rounded-lg border"
                          style={{ borderColor: WA.borderLight, background: WA.white, color: WA.textDark }}
                        >
                          <option value="active">正常/活跃</option>
                          <option value="agency">Agency绑定</option>
                          <option value="churned">已流失</option>
                        </select>
                      </div>
                    </div>
                  </div>

                  <div className="flex gap-2 pt-1">
                    <button
                      onClick={handleEditSave}
                      disabled={editSaving}
                      className="flex-1 py-2 rounded-xl text-sm font-medium text-white"
                      style={{ background: editSaving ? '#9ca3af' : WA.teal }}
                    >
                      {editSaving ? '保存中...' : '保存'}
                    </button>
                    <button
                      onClick={() => setEditForm(editFormInitial)}
                      className="px-4 py-2 rounded-xl text-sm font-medium"
                      style={{ background: WA.borderLight, color: WA.textMuted }}
                    >
                      重置
                    </button>
                  </div>
                </div>
              )}
            </Section>
          </div>
        </div>
      ) : (
        <>
          {/* Desktop overlay + sidebar */}
          <div className="fixed inset-0 bg-black/30 z-40 hidden md:block" onClick={onClose} />
          <div className="fixed right-0 top-0 h-full w-full z-50 hidden md:flex">

            {/* Desktop Info sidebar */}
            <div className="w-72 shrink-0 flex flex-col h-full" style={{ background: WA.white }}>
              <div className="flex items-center gap-3 px-5 py-4" style={{ background: WA.darkHeader }}>
                <button onClick={onClose} className="text-white/70 hover:text-white text-xl">←</button>
                <div className="w-11 h-11 rounded-full flex items-center justify-center text-white font-bold text-base" style={{ background: WA.teal }}>
                  {(creator?.primary_name || '?')[0]?.toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-base text-white truncate">{creatorName}</div>
                  <div className="text-xs text-white/50">{creator?.wa_phone}</div>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-5 space-y-5">
                <div className="grid grid-cols-4 gap-3">
                  <MiniStat label="消息" value={creator?.messages?.length || 0} />
                  <MiniStat label="GMV" value={creator?.keeper_gmv ? '$' + Number(creator?.keeper_gmv).toLocaleString() : '-'} />
                  <MiniStat label="30天GMV" value={creator?.keeper_gmv30 ? '$' + Number(creator?.keeper_gmv30).toLocaleString() : '-'} />
                  <MiniStat label="事件评分" value={wacrm.event_score != null ? wacrm.event_score.toFixed(1) : '-'} />
                  <MiniStat label="紧急度" value={wacrm.urgency_level != null ? wacrm.urgency_level : '-'} />
                  <MiniStat label="视频总数" value={creator?.keeper?.keeper_videos || '-'} />
                  <MiniStat label="视频发布" value={creator?.keeper?.keeper_videos_posted || '-'} />
                  <MiniStat label="视频售出" value={creator?.keeper?.keeper_videos_sold || '-'} />
                </div>

                <Section title="基本信息">
                  <InfoRow label="电话" value={creator?.wa_phone || '-'} />
                  <InfoRow label="Keeper" value={creator?.keeper_username || '-'} />
                  <InfoRow label="负责人" value={creator?.wa_owner || '-'} />
                </Section>

                <Section title="画像摘要">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs" style={{ color: WA.textMuted }}>AI 生成</span>
                    <button
                      onClick={() => fetchClientProfile()}
                      disabled={profileRefreshing}
                      className="text-xs px-2 py-0.5 rounded hover:opacity-80 transition-opacity"
                      style={{ color: profileRefreshing ? WA.textMuted : WA.teal }}
                    >
                      {profileRefreshing ? '刷新中...' : '🔄 刷新'}
                    </button>
                  </div>
                  {clientProfile?.summary ? (
                    <div className="text-sm py-1 px-3 rounded-lg" style={{ background: WA.lightBg, color: WA.text }}>
                      {clientProfile.summary}
                    </div>
                  ) : (
                    <div className="text-sm" style={{ color: WA.textMuted }}>暂无摘要</div>
                  )}
                  {clientProfile?.tags?.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {clientProfile.tags.map((t, i) => (
                        <span key={i} className="text-xs px-2 py-0.5 rounded-full" style={{ background: '#f0f0f0', color: WA.text }}>
                          {t.tag}
                          <span className="ml-1 text-xs" style={{ color: WA.textMuted }}>({t.source ***REMOVED***= 'ai_extracted' ? 'AI' : t.source ***REMOVED***= 'manual' ? '手动' : t.source ***REMOVED***= 'sft_feedback' ? 'SFT' : t.source ***REMOVED***= 'keeper_update' ? 'Keeper' : t.source})</span>
                        </span>
                      ))}
                    </div>
                  )}
                </Section>

                <Section title="Beta & 月费">
                  <InfoRow label="Beta" value={wacrm.beta_status || '-'} />
                  <InfoRow label="月费" value={wacrm.monthly_fee_status || '-'} />
                  <InfoRow label="月费金额" value={wacrm.monthly_fee_amount ? '$' + wacrm.monthly_fee_amount : '-'} />
                </Section>

                <Section title="状态">
                  <InfoRow label="优先级" value={wacrm.priority || '-'} />
                  <InfoRow label="Agency绑定" value={wacrm.agency_bound ? '✓ 是' : '✗ 否'} />
                  <InfoRow label="视频数" value={wacrm.video_count ? `${wacrm.video_count} / ${wacrm.video_target || 35}` : '-'} />
                  {wacrm.next_action && <InfoRow label="下一步" value={wacrm.next_action} />}
                </Section>

                <Section title="快捷操作">
                  <div className="flex flex-col gap-2">
                    <ActionPill label="更新状态" icon="🔄" color="#f59e0b" onClick={handleRefresh} loading={refreshing} />
                    <ActionPill label="编辑达人" icon="✏️" color="#3b82f6" onClick={handleEditOpen} />
                  </div>
                </Section>
              </div>
            </div>

            {/* Desktop Message composer */}
            <div className="flex-1 flex flex-col min-w-0" style={{ background: WA.chatBg }}>
              <WAMessageComposer client={clientInfo} creator={creator} onClose={onClose} />
            </div>
          </div>

          {/* Mobile: just the chat composer (header is in App's main panel) */}
          <div className="flex-1 flex flex-col md:hidden" style={{ background: WA.chatBg }}>
            <WAMessageComposer client={clientInfo} creator={creator} onClose={onClose} />
          </div>
        </>
      )}

      {/* 编辑达人弹窗 */}
      {showEdit && (
        <div className="fixed inset-0 bg-black/40 z-[60] flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-2xl overflow-hidden" style={{ background: WA.white }}>
            {/* 弹窗头部 */}
            <div className="flex items-center justify-between px-6 py-4" style={{ background: WA.darkHeader }}>
              <div className="flex items-center gap-3">
                <span className="text-lg">✏️</span>
                <span className="font-semibold text-white">编辑达人</span>
              </div>
              <button onClick={() => setShowEdit(false)} className="text-white/60 hover:text-white text-xl">✕</button>
            </div>

            {/* 弹窗表单 */}
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-semibold mb-1.5" style={{ color: WA.textMuted }}>姓名</label>
                <input
                  className="w-full text-sm px-3 py-2.5 rounded-xl border focus:outline-none focus:ring-2"
                  style={{ borderColor: WA.borderLight, background: WA.lightBg }}
                  value={editForm.primary_name}
                  onChange={e => setEditForm(f => ({ ...f, primary_name: e.target.value }))}
                />
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1.5" style={{ color: WA.textMuted }}>电话</label>
                <input
                  className="w-full text-sm px-3 py-2.5 rounded-xl border focus:outline-none focus:ring-2"
                  style={{ borderColor: WA.borderLight, background: WA.lightBg }}
                  value={editForm.wa_phone}
                  onChange={e => setEditForm(f => ({ ...f, wa_phone: e.target.value }))}
                />
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1.5" style={{ color: WA.textMuted }}>负责人</label>
                <select
                  className="w-full text-sm px-3 py-2.5 rounded-xl border focus:outline-none focus:ring-2"
                  style={{ borderColor: WA.borderLight, background: WA.lightBg }}
                  value={editForm.wa_owner}
                  onChange={e => setEditForm(f => ({ ...f, wa_owner: e.target.value }))}
                >
                  <option value="Beau">Beau</option>
                  <option value="Yiyun">Yiyun</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1.5" style={{ color: WA.textMuted }}>Keeper</label>
                <input
                  className="w-full text-sm px-3 py-2.5 rounded-xl border focus:outline-none focus:ring-2"
                  style={{ borderColor: WA.borderLight, background: WA.lightBg }}
                  value={editForm.keeper_username}
                  onChange={e => setEditForm(f => ({ ...f, keeper_username: e.target.value }))}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold mb-1.5" style={{ color: WA.textMuted }}>Beta状态</label>
                  <select
                    className="w-full text-sm px-3 py-2.5 rounded-xl border focus:outline-none focus:ring-2"
                    style={{ borderColor: WA.borderLight, background: WA.lightBg }}
                    value={editForm.beta_status}
                    onChange={e => setEditForm(f => ({ ...f, beta_status: e.target.value }))}
                  >
                    <option value="not_introduced">未引入</option>
                    <option value="introduced">已引入</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-1.5" style={{ color: WA.textMuted }}>优先级</label>
                  <select
                    className="w-full text-sm px-3 py-2.5 rounded-xl border focus:outline-none focus:ring-2"
                    style={{ borderColor: WA.borderLight, background: WA.lightBg }}
                    value={editForm.priority}
                    onChange={e => setEditForm(f => ({ ...f, priority: e.target.value }))}
                  >
                    <option value="normal">普通</option>
                    <option value="high">高</option>
                    <option value="urgent">紧急</option>
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold mb-1.5" style={{ color: WA.textMuted }}>Agency绑定</label>
                  <select
                    className="w-full text-sm px-3 py-2.5 rounded-xl border focus:outline-none focus:ring-2"
                    style={{ borderColor: WA.borderLight, background: WA.lightBg }}
                    value={editForm.agency_bound}
                    onChange={e => setEditForm(f => ({ ...f, agency_bound: e.target.value }))}
                  >
                    <option value="0">否</option>
                    <option value="1">是</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-1.5" style={{ color: WA.textMuted }}>视频数</label>
                  <input
                    type="number"
                    className="w-full text-sm px-3 py-2.5 rounded-xl border focus:outline-none focus:ring-2"
                    style={{ borderColor: WA.borderLight, background: WA.lightBg }}
                    value={editForm.video_count}
                    onChange={e => setEditForm(f => ({ ...f, video_count: e.target.value }))}
                  />
                </div>
              </div>
            </div>

            {/* 弹窗底部按钮 */}
            <div className="flex gap-3 px-6 pb-6">
              <button
                onClick={() => setShowEdit(false)}
                className="flex-1 py-2.5 rounded-xl text-sm font-medium border"
                style={{ borderColor: WA.borderLight, color: WA.textMuted }}
              >
                取消
              </button>
              <button
                onClick={handleEditSave}
                disabled={editSaving}
                className="flex-1 py-2.5 rounded-xl text-sm font-bold text-white disabled:opacity-50"
                style={{ background: WA.teal }}
              >
                {editSaving ? '保存中...' : '保存'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

// ***REMOVED******REMOVED******REMOVED*** 内联编辑字段组件 ***REMOVED******REMOVED******REMOVED***
function InlineEditField({ label, value, onChange, type = 'text', options = [] }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs shrink-0 w-14" style={{ color: WA.textMuted }}>{label}</span>
      {type ***REMOVED***= 'select' ? (
        <select
          value={value}
          onChange={e => onChange(e.target.value)}
          className="flex-1 text-sm px-2 py-1.5 rounded-lg border focus:outline-none focus:ring-1"
          style={{ borderColor: WA.borderLight, background: WA.white, color: WA.textDark }}
        >
          {options.map(([val, text]) => (
            <option key={val} value={val}>{text}</option>
          ))}
        </select>
      ) : type ***REMOVED***= 'number' ? (
        <input
          type="number"
          value={value}
          onChange={e => onChange(e.target.value)}
          className="flex-1 text-sm px-2 py-1.5 rounded-lg border focus:outline-none focus:ring-1"
          style={{ borderColor: WA.borderLight, background: WA.white, color: WA.textDark }}
        />
      ) : type ***REMOVED***= 'toggle' ? (
        <button
          onClick={() => onChange(!value)}
          className="flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium transition-all"
          style={{
            background: value ? 'rgba(0,168,132,0.15)' : 'rgba(0,0,0,0.06)',
            color: value ? WA.teal : WA.textMuted,
          }}
        >
          <span style={{ fontSize: '10px' }}>{value ? '✓' : '✗'}</span>
          <span>{value ? options[1] || '是' : options[0] || '否'}</span>
        </button>
      ) : (
        <input
          type="text"
          value={value}
          onChange={e => onChange(e.target.value)}
          className="flex-1 text-sm px-2 py-1.5 rounded-lg border focus:outline-none focus:ring-1"
          style={{ borderColor: WA.borderLight, background: WA.white, color: WA.textDark }}
        />
      )}
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

function MiniStat({ label, value }) {
  return (
    <div className="text-center py-2 px-1 rounded-lg" style={{ background: WA.lightBg }}>
      <div className="text-sm font-semibold" style={{ color: WA.textDark }}>{value}</div>
      <div className="text-xs mt-0.5" style={{ color: WA.textMuted }}>{label}</div>
    </div>
  )
}

function Section({ title, children }) {
  return (
    <div>
      <div className="text-xs font-medium mb-2" style={{ color: WA.textMuted }}>{title}</div>
      <div className="space-y-0.5">{children}</div>
    </div>
  )
}

function InfoRow({ label, value }) {
  return (
    <div className="flex justify-between items-center py-1.5 px-1">
      <span className="text-sm" style={{ color: WA.textMuted }}>{label}</span>
      <span className="text-sm font-medium" style={{ color: WA.textDark }}>{value}</span>
    </div>
  )
}

function ActionPill({ label, icon, color, onClick, loading }) {
  return (
    <button
      onClick={onClick}
      disabled={loading}
      className="w-full flex items-center gap-2.5 px-4 py-2.5 rounded-xl text-sm font-medium transition-all hover:opacity-80 disabled:opacity-50"
      style={{ background: color + '18', color }}
    >
      <span>{loading ? '⏳' : icon}</span><span>{loading ? '刷新中...' : label}</span>
    </button>
  )
}

// ***REMOVED******REMOVED******REMOVED*** Creator Events Section (in CreatorDetail) ***REMOVED******REMOVED******REMOVED***
function CreatorEventsSection({ creatorId }) {
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
    setLoading(true)
    fetch(`/api/events/summary/${creatorId}`)
      .then(r => r.json())
      .then(data => {
        setSummary(data.summary)
        setEvents(data.events || [])
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [creatorId])

  if (loading) {
    return (
      <Section title="事件">
        <div className="flex items-center justify-center py-4 gap-2" style={{ color: WA.textMuted }}>
          <div className="w-4 h-4 rounded-full border border-t-transparent animate-spin" style={{ borderColor: WA.teal, borderTopColor: 'transparent' }} />
          <span className="text-xs">加载中...</span>
        </div>
      </Section>
    )
  }

  if (!summary || events.length ***REMOVED***= 0) {
    return (
      <Section title="事件">
        <div className="text-center py-4" style={{ color: WA.textMuted }}>
          <span className="text-sm">暂无事件记录</span>
        </div>
      </Section>
    )
  }

  return (
    <Section title={`事件 (${events.length})`}>
      {/* Summary chips */}
      <div className="flex flex-wrap gap-2 mb-3">
        {summary.active_count > 0 && (
          <span className="text-xs px-3 py-1 rounded-full font-semibold" style={{ background: 'rgba(16,185,129,0.15)', color: '#10b981' }}>
            🔥 {summary.active_count} 进行中
          </span>
        )}
        {summary.completed_count > 0 && (
          <span className="text-xs px-3 py-1 rounded-full font-semibold" style={{ background: 'rgba(148,163,184,0.15)', color: '#94a3b8' }}>
            ✅ {summary.completed_count} 已完成
          </span>
        )}
        {summary.wa_owner && (
          <span className="text-xs px-3 py-1 rounded-full font-semibold" style={{ background: summary.wa_owner ***REMOVED***= 'Beau' ? 'rgba(59,130,246,0.15)' : 'rgba(139,92,246,0.15)', color: summary.wa_owner ***REMOVED***= 'Beau' ? '#3b82f6' : '#8b5cf6' }}>
            {summary.wa_owner}
          </span>
        )}
      </div>

      {/* Events list */}
      <div className="space-y-2">
        {events.slice(0, 5).map(evt => {
          const typeInfo = EVENT_TYPE_LABELS[evt.event_key] || { label: evt.event_key, color: '#94a3b8', bg: 'rgba(148,163,184,0.15)' }
          const statusInfo = STATUS_LABELS[evt.status] || { label: evt.status, color: '#94a3b8', bg: 'rgba(148,163,184,0.15)' }
          return (
            <div key={evt.id} className="p-3 rounded-xl" style={{ background: WA.lightBg }}>
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs px-2 py-0.5 rounded-full font-semibold" style={{ background: typeInfo.bg, color: typeInfo.color }}>
                    {typeInfo.label}
                  </span>
                  <span className="text-xs px-2 py-0.5 rounded-full font-semibold" style={{ background: statusInfo.bg, color: statusInfo.color }}>
                    {statusInfo.label}
                  </span>
                </div>
                <span className="text-xs" style={{ color: WA.textMuted }}>
                  {evt.start_at ? new Date(evt.start_at).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' }) : '-'}
                </span>
              </div>
              {evt.trigger_text && (
                <div className="text-xs truncate" style={{ color: WA.textMuted }}>
                  "{evt.trigger_text.slice(0, 50)}{evt.trigger_text.length > 50 ? '...' : ''}"
                </div>
              )}
            </div>
          )
        })}
        {events.length > 5 && (
          <div className="text-center text-xs py-2" style={{ color: WA.textMuted }}>
            还有 {events.length - 5} 个事件...
          </div>
        )}
      </div>
    </Section>
  )
}

export default App
