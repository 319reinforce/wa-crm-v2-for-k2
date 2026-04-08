import React, { useState, useEffect, useCallback } from 'react'
import { WAMessageComposer } from './components/WAMessageComposer'
import { SFTDashboard } from './components/SFTDashboard'

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
  { key: 'ev_trial_7day', label: '7天试用', color: '#3b82f6', bg: 'rgba(59,130,246,0.15)' },
  { key: 'ev_monthly_invited', label: '月卡邀请', color: '#8b5cf6', bg: 'rgba(139,92,246,0.15)' },
  { key: 'ev_monthly_joined', label: '月卡加入', color: '#10b981', bg: 'rgba(16,185,129,0.15)' },
  { key: 'ev_whatsapp_shared', label: 'WA已发', color: '#00a884', bg: 'rgba(0,168,132,0.15)' },
  { key: 'ev_gmv_1k', label: 'GMV>1K', color: '#f59e0b', bg: 'rgba(245,158,11,0.15)' },
  { key: 'ev_gmv_3k', label: 'GMV>3K', color: '#f97316', bg: 'rgba(249,115,22,0.15)' },
  { key: 'ev_gmv_10k', label: 'GMV>10K', color: '#ef4444', bg: 'rgba(239,68,68,0.15)' },
  { key: 'ev_churned', label: '已流失', color: '#ef4444', bg: 'rgba(239,68,68,0.15)' },
]

const KANBAN_COLUMNS = [
  { key: 'new', label: '🆕 新建', color: '#94a3b8', filter: c => !c.msg_count },
  { key: 'active', label: '🔥 活跃', color: '#10b981', filter: c => c.msg_count > 5 },
  { key: 'trial', label: '⏳ 试用中', color: '#3b82f6', filter: c => c.ev_trial_7day },
  { key: 'monthly', label: '💎 月卡', color: '#8b5cf6', filter: c => c.ev_monthly_joined },
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
          next.detail = Math.min(Math.max(240, window.innerWidth - clientX), 520)
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

  useEffect(() => {
    loadData()
    const interval = setInterval(loadData, 15000)
    return () => clearInterval(interval)
  }, [filterOwner, filterBeta, filterPriority, filterAgency, filterEvent])

  // 计算未读：客户发了消息但后面没有我的回复
  const computeUnread = (messages) => {
    const msgs = messages || []
    let unread = 0
    for (let i = 0; i < msgs.length; i++) {
      if (msgs[i].role ***REMOVED***= 'user') {
        const hasReply = msgs.slice(i + 1).some(m => m.role ***REMOVED***= 'me')
        if (!hasReply) unread++
      }
    }
    return unread
  }

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

      // 计算未读消息数（客户发了但我还没回复）
      const newUnread = {}
      for (const c of enriched) {
        newUnread[c.id] = computeUnread(c._full?.messages)
      }
      setUnreadCounts(newUnread)

      // 按最后活跃时间倒序（最新的在前面）
      enriched.sort((a, b) => (b.last_active || 0) - (a.last_active || 0))

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
              <div className="flex items-center gap-1 px-4 py-3 border-b" style={{ borderColor: WA.borderLight }}>
                {['', 'Beau', 'Yiyun'].map(o => (
                  <button key={o} onClick={() => setFilterOwner(o)} className="flex-1 py-2 rounded-xl text-xs font-semibold" style={{ background: filterOwner ***REMOVED***= o ? WA.teal : 'transparent', color: filterOwner ***REMOVED***= o ? 'white' : WA.textMuted }}>{o ***REMOVED***= '' ? '全部' : o}</button>
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
          <div className="px-4 py-3 border-b space-y-2" style={{ borderColor: WA.borderLight, background: '#f8f9fa' }}>
            <div className="flex gap-2">
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
            <div className="flex gap-2">
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
                🗑 清除所有筛选
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
                  <div className="w-12 h-12 rounded-full flex items-center justify-center" style={{ background: WA.lightBg }}>
                    <span className="text-xl">⏳</span>
                  </div>
                  <span className="text-sm">加载中...</span>
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
              <div className="text-center" style={{ color: WA.textMuted }}>
                <div className="text-5xl mb-4">💬</div>
                <div className="text-sm">选择一个达人开始对话</div>
              </div>
            </div>
          )}
        </div>
      </div>

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
                {selectedCreator.joinbrands.ev_trial_7day && <span className="text-xs px-3 py-1 rounded-full font-semibold shrink-0" style={{ background: '#3b82f618', color: '#3b82f6' }}>7天试用</span>}
                {selectedCreator.joinbrands.ev_monthly_invited && <span className="text-xs px-3 py-1 rounded-full font-semibold shrink-0" style={{ background: '#8b5cf618', color: '#8b5cf6' }}>月卡邀请</span>}
                {selectedCreator.joinbrands.ev_monthly_joined && <span className="text-xs px-3 py-1 rounded-full font-semibold shrink-0" style={{ background: '#10b98118', color: '#10b981' }}>月卡加入</span>}
                {selectedCreator.joinbrands.ev_whatsapp_shared && <span className="text-xs px-3 py-1 rounded-full font-semibold shrink-0" style={{ background: '#00a88418', color: '#00a884' }}>WA已发</span>}
                {selectedCreator.joinbrands.ev_gmv_1k && <span className="text-xs px-3 py-1 rounded-full font-semibold shrink-0" style={{ background: '#f59e0b18', color: '#f59e0b' }}>GMV&gt;1K</span>}
                {selectedCreator.joinbrands.ev_gmv_3k && <span className="text-xs px-3 py-1 rounded-full font-semibold shrink-0" style={{ background: '#f9731618', color: '#f97316' }}>GMV&gt;3K</span>}
                {selectedCreator.joinbrands.ev_gmv_10k && <span className="text-xs px-3 py-1 rounded-full font-semibold shrink-0" style={{ background: '#ef444418', color: '#ef4444' }}>GMV&gt;10K</span>}
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
      className="flex-1 text-sm px-3 py-2 rounded-xl border focus:outline-none focus:ring-2 transition-all"
      style={{
        background: value ? WA.white : 'rgba(255,255,255,0.6)',
        borderColor: value ? WA.teal + '40' : WA.borderLight,
        color: value ? WA.textDark : WA.textMuted,
        fontSize: '13px'
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

  const lastActiveLabel = creator.last_active ? formatRelativeTime(creator.last_active) : null
  const lastActiveFull = creator.last_active
    ? new Date(creator.last_active).toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    : ''
  const isRecent = creator.last_active && (Date.now() - creator.last_active) < 86400000

  const activeEvents = EVENT_BADGES.filter(e => full[e.key]).slice(0, 2)

  return (
    <div
      onClick={onClick}
      className="flex items-center gap-3 px-5 py-4 cursor-pointer transition-all"
      style={{ borderBottom: `1px solid ${WA.borderLight}` }}
      onMouseEnter={e => e.currentTarget.style.background = WA.hover}
      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
    >
      {/* Avatar + unread dot */}
      <div className="relative shrink-0">
        <div className="rounded-full flex items-center justify-center text-white font-bold" style={{ background: ownerColor, width: 52, height: 52, fontSize: 18 }}>
          {(creator.primary_name || '?')[0]?.toUpperCase()}
        </div>
        {unread > 0 && (
          <div className="absolute -top-0.5 -right-0.5 w-5 h-5 rounded-full flex items-center justify-center text-white text-xs font-bold" style={{ background: '#ef4444' }}>
            {unread > 9 ? '9+' : unread}
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        {/* Name + Time row */}
        <div className="flex items-center justify-between mb-1">
          <span className="font-semibold text-base truncate" style={{ color: WA.textDark }}>{creator.primary_name || 'Unknown'}</span>
          {lastActiveLabel && (
            <span
              className="shrink-0 ml-3 text-xs font-medium px-2 py-0.5 rounded-full"
              style={{
                background: isRecent ? 'rgba(0,168,132,0.12)' : 'rgba(0,0,0,0.04)',
                color: isRecent ? '#008069' : WA.textMuted
              }}
              title={lastActiveFull}
            >
              {lastActiveLabel}
            </span>
          )}
        </div>

        {/* Phone + msg count */}
        <div className="flex items-center gap-2 mb-1.5">
          <span className="text-sm" style={{ color: WA.textMuted }}>{creator.wa_phone || '-'}</span>
          <span className="text-xs" style={{ color: WA.borderLight }}>·</span>
          <span className="text-sm font-medium" style={{ color: WA.textMuted }}>{creator.msg_count || 0} 条消息</span>
        </div>

        {/* Tags row */}
        <div className="flex flex-wrap gap-1.5">
          {activeEvents.map(e => (
            <span key={e.key} className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ background: e.bg, color: e.color }}>
              {e.label}
            </span>
          ))}
          {wacrm.priority && wacrm.priority !***REMOVED*** 'low' && (
            <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ background: wacrm.priority ***REMOVED***= 'high' ? 'rgba(239,68,68,0.12)' : 'rgba(245,158,11,0.12)', color: wacrm.priority ***REMOVED***= 'high' ? '#ef4444' : '#f59e0b' }}>
              {wacrm.priority ***REMOVED***= 'high' ? '🔴 高' : '🟡 中'}
            </span>
          )}
          {wacrm.agency_bound > 0 && (
            <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ background: 'rgba(0,168,132,0.12)', color: '#008069' }}>Agency</span>
          )}
          {creator.keeper_gmv > 0 && (
            <span className="text-xs px-2 py-0.5 rounded-full font-semibold" style={{ background: 'rgba(16,185,129,0.12)', color: '#10b981' }}>
              ${Number(creator.keeper_gmv).toLocaleString()}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

// ***REMOVED******REMOVED******REMOVED*** Empty State ***REMOVED******REMOVED******REMOVED***
function EmptyState({ viewMode }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center" style={{ background: WA.chatBg }}>
      <div className="w-24 h-24 rounded-full flex items-center justify-center mb-5" style={{ background: WA.teal + '15' }}>
        <span className="text-4xl">💬</span>
      </div>
      <h2 className="text-xl font-light mb-1" style={{ color: WA.textDark }}>WA Bot CRM</h2>
      <p className="text-sm" style={{ color: WA.textMuted }}>选择一个达人开始对话</p>
      <div className="mt-6 flex gap-3">
        {[['🤖', 'MiniMax AI'], ['📊', 'SFT 训练'], ['⊞', '看板视图']].map(([icon, label]) => (
          <div key={label} className="flex items-center gap-2 px-4 py-2 rounded-full text-sm" style={{ background: 'rgba(0,0,0,0.04)', color: WA.textMuted }}>
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
  const [editSaving, setEditSaving] = useState(false)

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

  useEffect(() => {
    fetchCreator(true)
    const i = setInterval(() => fetchCreator(true), 8000)
    return () => clearInterval(i)
  }, [fetchCreator])

  // 当 creator 变化时，同步 editForm（用于内联编辑）
  useEffect(() => {
    if (!creator) return
    setEditForm({
      primary_name: creator.primary_name || '',
      wa_phone: creator.wa_phone || '',
      wa_owner: creator.wa_owner || '',
      keeper_username: creator.keeper_username || '',
      beta_status: creator.wacrm?.beta_status || 'not_introduced',
      priority: creator.wacrm?.priority || 'normal',
      agency_bound: creator.wacrm?.agency_bound ? '1' : '0',
      video_count: creator.wacrm?.video_count || 0,
    })
  }, [creator])

  const handleRefresh = () => fetchCreator(false)

  const handleEditOpen = () => {
    setEditForm({
      primary_name: creator.primary_name || '',
      wa_phone: creator.wa_phone || '',
      wa_owner: creator.wa_owner || '',
      keeper_username: creator.keeper_username || '',
      beta_status: creator.wacrm?.beta_status || 'not_introduced',
      priority: creator.wacrm?.priority || 'normal',
      agency_bound: creator.wacrm?.agency_bound ? '1' : '0',
      video_count: creator.wacrm?.video_count || 0,
    })
    // Panel 模式不走 modal，直接用内联表单
    if (!asPanel) setShowEdit(true)
  }

  const handleEditSave = async () => {
    setEditSaving(true)
    try {
      // 更新 creators 表
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
      // 更新 wa_crm_data 表
      await fetch(`/api/creators/${creatorId}/wacrm`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          beta_status: editForm.beta_status,
          priority: editForm.priority,
          agency_bound: parseInt(editForm.agency_bound),
          video_count: parseInt(editForm.video_count) || 0,
        })
      })
      setShowEdit(false)
      fetchCreator(true)
    } catch (e) {
      console.error('保存失败:', e)
    } finally {
      setEditSaving(false)
    }
  }

  if (loading) return (
    <div className="fixed inset-0 bg-black/30 z-40 flex items-center justify-center" onClick={onClose}>
      <div className="w-12 h-12 rounded-full flex items-center justify-center" style={{ background: WA.white }}>
        <span className="text-2xl">⏳</span>
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
          <div className="flex-1 overflow-y-auto p-5 space-y-5">
            <div className="grid grid-cols-4 gap-3">
              <MiniStat label="消息" value={creator?.messages?.length || 0} />
              <MiniStat label="GMV" value={creator?.keeper_gmv ? '$' + Number(creator?.keeper_gmv).toLocaleString() : '-'} />
              <MiniStat label="30天GMV" value={creator?.keeper_gmv30 ? '$' + Number(creator?.keeper_gmv30).toLocaleString() : '-'} />
              <MiniStat label="订单" value={creator?.keeper_orders || '-'} />
            </div>

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

            <Section title="事件标签">
              <div className="flex flex-wrap gap-2">
                {EVENT_BADGES.filter(e => creator?.[e.key]).map(e => (
                  <span key={e.key} className="text-sm px-3 py-1 rounded-full font-semibold" style={{ background: e.bg, color: e.color }}>
                    {e.label}
                  </span>
                ))}
                {!EVENT_BADGES.some(e => creator?.[e.key]) && (
                  <span className="text-sm" style={{ color: WA.textMuted }}>无</span>
                )}
              </div>
            </Section>

            <Section title="快捷操作">
              <div className="flex flex-col gap-2">
                <ActionPill label="更新状态" icon="🔄" color="#f59e0b" onClick={handleRefresh} loading={refreshing} />
                {asPanel ? (
                  <ActionPill
                    label={editSaving ? '保存中...' : (editSaving ? '保存中' : '编辑达人')}
                    icon="✏️"
                    color="#3b82f6"
                    onClick={handleEditOpen}
                    disabled={editSaving}
                  />
                ) : (
                  <ActionPill label="编辑达人" icon="✏️" color="#3b82f6" onClick={handleEditOpen} />
                )}
              </div>

              {/* Panel 模式内联编辑表单 */}
              {asPanel && (
                <div className="mt-3 p-4 rounded-xl space-y-3" style={{ background: WA.lightBg }}>
                  <div className="text-xs font-semibold mb-2" style={{ color: WA.textMuted }}>快速编辑</div>
                  <InlineEditField
                    label="Beta"
                    value={editForm.beta_status || ''}
                    onChange={v => setEditForm(f => ({ ...f, beta_status: v }))}
                    type="select"
                    options={[['not_introduced', '未引入'], ['introduced', '已引入']]}
                  />
                  <InlineEditField
                    label="优先级"
                    value={editForm.priority || ''}
                    onChange={v => setEditForm(f => ({ ...f, priority: v }))}
                    type="select"
                    options={[['normal', '普通'], ['high', '高'], ['urgent', '紧急']]}
                  />
                  <InlineEditField
                    label="Agency绑定"
                    value={editForm.agency_bound || '0'}
                    onChange={v => setEditForm(f => ({ ...f, agency_bound: v }))}
                    type="select"
                    options={[['0', '否'], ['1', '是']]}
                  />
                  <InlineEditField
                    label="视频数"
                    value={String(editForm.video_count || 0)}
                    onChange={v => setEditForm(f => ({ ...f, video_count: parseInt(v) || 0 }))}
                    type="number"
                  />
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
                      onClick={() => { setEditForm({}); }}
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
                  <MiniStat label="订单" value={creator?.keeper_orders || '-'} />
                </div>

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

                <Section title="事件标签">
                  <div className="flex flex-wrap gap-2">
                    {EVENT_BADGES.filter(e => creator?.[e.key]).map(e => (
                      <span key={e.key} className="text-sm px-3 py-1 rounded-full font-semibold" style={{ background: e.bg, color: e.color }}>
                        {e.label}
                      </span>
                    ))}
                    {!EVENT_BADGES.some(e => creator?.[e.key]) && (
                      <span className="text-sm" style={{ color: WA.textMuted }}>无</span>
                    )}
                  </div>
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
      <span className="text-xs shrink-0 w-16" style={{ color: WA.textMuted }}>{label}</span>
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
    <div className="text-center p-3 rounded-xl" style={{ background: WA.lightBg }}>
      <div className="text-sm font-bold" style={{ color: WA.textDark }}>{value}</div>
      <div className="text-xs mt-0.5" style={{ color: WA.textMuted }}>{label}</div>
    </div>
  )
}

function Section({ title, children }) {
  return (
    <div>
      <div className="text-sm font-bold uppercase tracking-wide mb-2.5" style={{ color: WA.textMuted }}>{title}</div>
      <div className="space-y-1">{children}</div>
    </div>
  )
}

function InfoRow({ label, value }) {
  return (
    <div className="flex justify-between items-center py-2 px-3 rounded-xl" style={{ background: WA.lightBg }}>
      <span className="text-sm" style={{ color: WA.textMuted }}>{label}</span>
      <span className="text-sm font-semibold" style={{ color: WA.textDark }}>{value}</span>
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

export default App
