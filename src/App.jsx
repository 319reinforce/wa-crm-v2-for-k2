import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import useIsMobile from './hooks/useIsMobile'
import MobileShell from './components/mobile/MobileShell'
import MobileChatListRow from './components/mobile/MobileChatListRow'
import { WAMessageComposer } from './components/WAMessageComposer'
import { SFTDashboard } from './components/SFTDashboard'
import { EventPanel } from './components/EventPanel'
import { LifecycleConfigPanel } from './components/LifecycleConfigPanel'
import { StrategyConfigPanel } from './components/StrategyConfigPanel'
import { WorkerStatusBar } from './components/WorkerStatusBar'
import { CreatorDetail } from './components/CreatorDetail'
import { WAGroupChatViewer } from './components/WAGroupChatViewer'
import { MobileEventTagsBar } from './components/MobileEventTagsBar'
import AuthSessionControls from './components/AuthSessionControls'
import { AccountsPanel } from './components/AccountsPanel'
import { UsersPanel } from './components/UsersPanel'
import { AIProvidersAdminPanel } from './components/AIProvidersAdminPanel'
import { getAppAuthScopeOwner, isAppAuthOwnerLocked, isAppAuthAdmin } from './utils/appAuth'
import { fetchJsonOrThrow } from './utils/api'
import {
  getCreatorMessages,
  getCreatorReplyState,
  getCreatorSignalBadges,
  getCreatorStatusMeta,
  getCreatorTrialPhaseMeta,
} from './utils/creatorMeta'
import { buildOwnerOptions, getOwnerColor, useOperatorRoster } from './utils/operators'
import { fetchWaAdmin } from './utils/waAdmin'
import WA from './utils/waTheme'

const API_BASE = '/api'

const EVENT_FILTER_FIELD_MAP = {
  trial_7day: ['ev_trial_active', 'ev_trial_7day'],
  monthly_invited: ['ev_monthly_invited', 'ev_monthly_started'],
  monthly_joined: ['ev_monthly_joined'],
  gmv_1k: ['ev_gmv_1k'],
  churned: ['ev_churned'],
}

function parseMaybeJson(value, fallback) {
  if (value === null || value === undefined || value === '') return fallback
  if (typeof value === 'object') return value
  try {
    const parsed = JSON.parse(value)
    return parsed ?? fallback
  } catch (_) {
    return fallback
  }
}

function normalizeCreatorEventSnapshot(snapshot = null) {
  if (!snapshot) return null
  return {
    ...snapshot,
    active_event_keys: parseMaybeJson(snapshot.active_event_keys, parseMaybeJson(snapshot.active_event_keys_json, [])),
    overlay_flags: parseMaybeJson(snapshot.overlay_flags, parseMaybeJson(snapshot.overlay_flags_json, [])),
    compat_ev_flags: parseMaybeJson(snapshot.compat_ev_flags, parseMaybeJson(snapshot.compat_ev_flags_json, {})),
  }
}

function getCreatorEventFlag(creator, key) {
  const snapshot = normalizeCreatorEventSnapshot(creator?.event_snapshot || creator?._full?.event_snapshot)
  const snapshotFlags = snapshot?.compat_ev_flags || {}
  if (Object.prototype.hasOwnProperty.call(snapshotFlags, key)) return !!snapshotFlags[key]
  return !!(creator?._full?.joinbrands?.[key] || creator?.joinbrands?.[key] || creator?.[key])
}

function creatorMatchesEventFilter(creator, filterEvent) {
  if (!filterEvent) return true
  const evKeys = EVENT_FILTER_FIELD_MAP[filterEvent] || [`ev_${filterEvent}`]
  return evKeys.some(key => getCreatorEventFlag(creator, key))
}

const LIFECYCLE_FILTER_OPTIONS = [
  { key: '', label: '生命周期' },
  { key: 'acquisition', label: '获取' },
  { key: 'activation', label: '激活' },
  { key: 'retention', label: '留存' },
  { key: 'revenue', label: '变现' },
  { key: 'terminated', label: '终止池' },
]

const LIFECYCLE_BADGE_META = {
  acquisition: { label: '获取', color: '#2563eb', bg: 'rgba(37,99,235,0.12)' },
  activation: { label: '激活', color: '#7c3aed', bg: 'rgba(124,58,237,0.12)' },
  retention: { label: '留存', color: '#0f766e', bg: 'rgba(15,118,110,0.12)' },
  revenue: { label: '变现', color: '#b45309', bg: 'rgba(180,83,9,0.12)' },
  terminated: { label: '终止池', color: '#dc2626', bg: 'rgba(220,38,38,0.12)' },
}

const KANBAN_COLUMNS = [
  { key: 'new', label: '🆕 新建', color: '#94a3b8', filter: c => !c.msg_count },
  { key: 'active', label: '🔥 活跃', color: '#10b981', filter: c => c.msg_count > 5 },
  { key: 'trial', label: '⏳ 试用中', color: '#3b82f6', filter: c => getCreatorEventFlag(c, 'ev_trial_active') },
  { key: 'monthly', label: '💎 月卡', color: '#8b5cf6', filter: c => getCreatorEventFlag(c, 'ev_monthly_started') || getCreatorEventFlag(c, 'ev_monthly_joined') },
  { key: 'churned', label: '⚠️ 流失', color: '#ef4444', filter: c => getCreatorEventFlag(c, 'ev_churned') },
]

const LIST_PANEL_MIN_WIDTH = 260
const LIST_PANEL_MAX_WIDTH = 500
const DESKTOP_PRIMARY_TABS = [
  { key: 'creators', label: '消息', subtitle: '达人对话与跟进' },
  { key: 'contacts', label: '联系人', subtitle: '新增、导入、解绑与恢复' },
  { key: 'finance', label: '财务', subtitle: '月费与 Keeper 指标' },
  { key: 'events', label: '事件', subtitle: '事件判断与回顾' },
  { key: 'strategy', label: '策略', subtitle: '生命周期与策略配置' },
  { key: 'sft', label: 'SFT', subtitle: '训练与审核看板' },
  { key: 'accounts', label: '账号', subtitle: 'WhatsApp 账号管理' },
{ key: 'users', label: '用户', subtitle: '管理员账号与权限', adminOnly: true },
  { key: 'ai-providers', label: 'AI Providers', subtitle: 'LLM 配置与用量', adminOnly: true },
]
const WORKSPACE_META = {
  creators: { title: '消息工作台', subtitle: '以聊天为中心推进达人转化、跟进与维护。' },
  contacts: { title: '联系人管理', subtitle: '集中管理达人新增、批量导入、owner 归属和解绑恢复。' },
  finance: { title: '财务面板', subtitle: '按达人查看月费、GMV、订单与 Keeper 指标。' },
  events: { title: '事件面板', subtitle: '集中处理事件判定、回填和时间线检查。' },
  strategy: { title: '策略配置', subtitle: '统一管理生命周期规则与未绑定 Agency 策略。' },
  sft: { title: 'SFT 看板', subtitle: '查看语料、反馈与训练准备状态。' },
}
const MORAS_GROUP_KEYWORDS = [
  'moras monthly beta tester',
  'morasbetatester',
  'moras creator group 1',
  'moras creator1',
  'moras creator group 2',
  'moras creator2',
]

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max)
}

function isMorasCoreGroup(groupName) {
  const normalized = String(groupName || '').toLowerCase().replace(/\s+/g, ' ').trim()
  if (!normalized) return false
  return MORAS_GROUP_KEYWORDS.some((keyword) => normalized.includes(keyword))
}

function parsePositiveInt(value) {
  const n = parseInt(String(value || '').trim(), 10)
  return Number.isFinite(n) && n > 0 ? n : null
}

function normalizeLookupText(value) {
  return String(value || '').trim().toLowerCase()
}

function normalizePhoneKey(value) {
  return String(value || '').replace(/[^\d+]/g, '').trim()
}

function normalizeWorkspaceTab(value) {
  const tab = String(value || '').trim().toLowerCase()
  return DESKTOP_PRIMARY_TABS.some((item) => item.key === tab) ? tab : 'creators'
}

function App() {
  const lockedOwner = getAppAuthScopeOwner()
  const ownerLocked = isAppAuthOwnerLocked() && !!lockedOwner
  const isAdmin = isAppAuthAdmin()
  const [creators, setCreators] = useState([])
  const [loading, setLoading] = useState(true)
  const [stats, setStats] = useState(null)
  const [sessionOwners, setSessionOwners] = useState([])
  const [activeTab, setActiveTab] = useState('creators')
  const [viewMode, setViewMode] = useState('list')
  const [filterOwner, setFilterOwner] = useState(lockedOwner || '')
  const [filterBeta, setFilterBeta] = useState('')
  const [filterPriority, setFilterPriority] = useState('')
  const [filterAgency, setFilterAgency] = useState('')
  const [filterEvent, setFilterEvent] = useState('')
  const [filterLifecycle, setFilterLifecycle] = useState('')
  const [filtersExpanded, setFiltersExpanded] = useState(false)
  const [showInactive, setShowInactive] = useState(false)
  const [search, setSearch] = useState('')
  const [selectedCreator, setSelectedCreator] = useState(null)
  const [groupChats, setGroupChats] = useState([])
  const [selectedGroupChat, setSelectedGroupChat] = useState(null)
  const [groupsLoading, setGroupsLoading] = useState(false)
  const [conversationScope, setConversationScope] = useState('creators')
  const [selectedCreatorIds, setSelectedCreatorIds] = useState([])
  const [chatJumpTarget, setChatJumpTarget] = useState(null)
  const [selectedEventId, setSelectedEventId] = useState(null)
  const [eventReturnContext, setEventReturnContext] = useState(null)
  const [eventPanelRestoreState, setEventPanelRestoreState] = useState(null)
  const [batchTogglingActive, setBatchTogglingActive] = useState(false)
  const [activeTogglingCreatorId, setActiveTogglingCreatorId] = useState(null)
  const [unreadCounts, setUnreadCounts] = useState({}) // creatorId -> unread count
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false)
  const [tagsVisible, setTagsVisible] = useState(true)
  const [waQrData, setWaQrData] = useState(null)  // WA QR code data URL
  const [manualOpen, setManualOpen] = useState(false)
  const [manualSaving, setManualSaving] = useState(false)
  const [manualError, setManualError] = useState('')
  const [manualForm, setManualForm] = useState({ name: '', phone: '', owner: lockedOwner || '' })
  const [manualCheckLoading, setManualCheckLoading] = useState(false)
  const [manualCheck, setManualCheck] = useState(null)
  const [manualMode, setManualMode] = useState('single') // 'single' | 'bulk'
  const [bulkText, setBulkText] = useState('')
  const [bulkSaving, setBulkSaving] = useState(false)
  const [bulkResults, setBulkResults] = useState(null)
  const [bulkError, setBulkError] = useState('')
  const [bulkSendWelcome, setBulkSendWelcome] = useState(false)
  const [bulkWelcomeText, setBulkWelcomeText] = useState('')
  const [bulkWelcomeTemplateKey, setBulkWelcomeTemplateKey] = useState('welcome')
  const [ownerTransferPreview, setOwnerTransferPreview] = useState(null)
  const [ownerTransferLoading, setOwnerTransferLoading] = useState(false)
  const [ownerTransferExecuting, setOwnerTransferExecuting] = useState(false)
  const [ownerTransferError, setOwnerTransferError] = useState('')
  const creatorsCacheRef = useRef(new Map())
  const queryBootstrapDoneRef = useRef(false)

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
    const id = setInterval(fetchWaStatus, 30000)
    return () => clearInterval(id)
  }, [])

  // 面板尺寸记忆（从 localStorage 恢复）
  const [panelWidths, setPanelWidths] = useState(() => {
    try {
      const saved = localStorage.getItem('wa_panel_widths')
      if (saved) {
        const parsed = JSON.parse(saved)
        return {
          list: clamp(Number(parsed?.list) || 320, LIST_PANEL_MIN_WIDTH, LIST_PANEL_MAX_WIDTH),
        }
      }
    } catch (_) {}
    return { list: 320 }
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
        if (dragging === 'list-detail') {
          next.list = clamp(clientX, LIST_PANEL_MIN_WIDTH, LIST_PANEL_MAX_WIDTH)
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

  const loadData = useCallback(async (signal, options = {}) => {
    const cacheKey = `${filterOwner}|inactive=${showInactive ? '1' : '0'}`
    const cached = creatorsCacheRef.current.get(cacheKey)
    const forceRefresh = !!options.force
    const isFresh = !forceRefresh && cached && (Date.now() - cached.ts < 15000)

    if (isFresh) {
      setCreators(cached.data)
      setUnreadCounts(cached.unread)
    } else {
      setLoading(true)
    }

    try {
      const params = new URLSearchParams()
      if (filterOwner) params.set('owner', filterOwner)
      params.set('fields', 'wa_phone')
      if (showInactive) {
        params.set('is_active', '0')
        params.set('roster', 'all')
      }

      const [creatorsData, statsData] = await Promise.all([
        fetchJsonOrThrow(`${API_BASE}/creators?${params.toString()}`, { signal }),
        fetchJsonOrThrow(`${API_BASE}/stats`, { signal }),
      ])
      const enriched = creatorsData.map(c => buildCreatorViewModel(buildCreatorListFull(c), c))

      // 计算未读
      const newUnread = {}
      for (const c of enriched) {
        newUnread[c.id] = shouldShowUnread(c) ? 1 : 0
      }

      enriched.sort((a, b) => getCreatorLastConversationTs(b) - getCreatorLastConversationTs(a))
      creatorsCacheRef.current.set(cacheKey, { data: enriched, unread: newUnread, ts: Date.now() })
      setCreators(enriched)
      setUnreadCounts(newUnread)
      setStats(statsData)
    } catch (e) {
      if (e.name === 'AbortError') return
      console.error('[WACRM] 加载失败:', e)
    } finally {
      if (!signal?.aborted) setLoading(false)
    }
  }, [filterOwner, showInactive])

  const loadGroupChats = useCallback(async (signal) => {
    setGroupsLoading(true)
    try {
      const params = new URLSearchParams()
      if (filterOwner) params.set('operator', filterOwner)
      const data = await fetchJsonOrThrow(`${API_BASE}/wa/groups?${params.toString()}`, { signal })
      const groups = Array.isArray(data?.groups) ? data.groups : []
      setGroupChats(groups)
      setSelectedGroupChat(prev => {
        if (!prev?.id) return prev
        return groups.find(group => group.id === prev.id) || null
      })
    } catch (e) {
      if (e.name === 'AbortError') return
      console.error('[WA Groups] 加载失败:', e)
    } finally {
      if (!signal?.aborted) setGroupsLoading(false)
    }
  }, [filterOwner])

  // loadData ref：确保 SSE 回调永远调用最新版本的 loadData（带当前 filter 值）
  const loadDataRef = useRef(loadData)
  useEffect(() => { loadDataRef.current = loadData }, [loadData])

  useEffect(() => {
    const ctrl = new AbortController()
    loadData(ctrl.signal)
    return () => { ctrl.abort() }
  }, [loadData])

  useEffect(() => {
    if (conversationScope !== 'groups') return
    const ctrl = new AbortController()
    loadGroupChats(ctrl.signal)
    const interval = setInterval(() => loadGroupChats(ctrl.signal), 20000)
    return () => {
      clearInterval(interval)
      ctrl.abort()
    }
  }, [loadGroupChats, conversationScope])

  useEffect(() => {
    if (ownerLocked && filterOwner !== lockedOwner) {
      setFilterOwner(lockedOwner)
    }
  }, [filterOwner, lockedOwner, ownerLocked])

  // 拉 wa_sessions 的 owners 合并到 filter(admin token 才有权限,
  // owner-locked token 直接跳过)
  useEffect(() => {
    if (ownerLocked) return
    let cancelled = false
    const load = async () => {
      try {
        const data = await fetchJsonOrThrow(`${API_BASE}/wa/sessions`)
        if (cancelled) return
        if (data?.ok && Array.isArray(data.sessions)) {
          const owners = data.sessions.map(s => s.owner).filter(Boolean)
          setSessionOwners(owners)
        }
      } catch (_) { /* 非 admin / 后端未启用,静默跳过 */ }
    }
    load()
    const handler = () => load()
    window.addEventListener('wa-session-status-changed', handler)
    return () => {
      cancelled = true
      window.removeEventListener('wa-session-status-changed', handler)
    }
  }, [ownerLocked])

  // SSE 实时订阅（populate_db.cjs 写完 MySQL 后会收到广播）
  // 指数退避 + 可见性感知重连，避免后端短暂抖动时浏览器以默认 3s 节奏无限重试打满日志。
  useEffect(() => {
    let es = null
    let debounceTimer = null
    let reconnectTimer = null
    let reconnectDelay = 1000 // 1s → 2s → 4s → 8s → 15s → 30s 上限
    let destroyed = false

    const debouncedLoadData = () => {
      clearTimeout(debounceTimer)
      debounceTimer = setTimeout(() => { loadDataRef.current?.(undefined, { force: true }) }, 1500)
    }

    const scheduleReconnect = () => {
      if (destroyed) return
      if (reconnectTimer) return
      if (document.visibilityState === 'hidden') return // 标签页隐藏时暂停重连
      const delay = reconnectDelay
      reconnectDelay = Math.min(reconnectDelay * 2, 30000)
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null
        connect()
      }, delay)
    }

    const connect = () => {
      if (destroyed) return
      try {
        es = new EventSource('/api/events/subscribe')
        es.addEventListener('open', () => {
          reconnectDelay = 1000 // 连上即复位
        })
        es.addEventListener('creators-updated', () => {
          debouncedLoadData()
        })
        es.addEventListener('wa-message', (event) => {
          try {
            const data = event.data ? JSON.parse(event.data) : null
            window.dispatchEvent(new CustomEvent('wa-message-received', { detail: data }))
          } catch (_) {}
          debouncedLoadData()
        })
        es.addEventListener('wa-session-status', (event) => {
          try {
            const data = event.data ? JSON.parse(event.data) : null
            window.dispatchEvent(new CustomEvent('wa-session-status-changed', { detail: data }))
          } catch (_) {}
        })
        es.onerror = () => {
          console.warn(`[SSE] 连接断开，${Math.round(reconnectDelay / 1000)}s 后重连`)
          try { es && es.close() } catch (_) {}
          es = null
          scheduleReconnect()
        }
      } catch (e) {
        console.warn('[SSE] 连接失败，使用轮询兜底:', e.message)
        scheduleReconnect()
      }
    }

    const onVisibility = () => {
      // 标签页从隐藏恢复且没有活动连接时立刻重连
      if (document.visibilityState === 'visible' && !es && !reconnectTimer) {
        reconnectDelay = 1000
        connect()
      }
    }
    document.addEventListener('visibilitychange', onVisibility)

    connect()

    return () => {
      destroyed = true
      document.removeEventListener('visibilitychange', onVisibility)
      clearTimeout(debounceTimer)
      clearTimeout(reconnectTimer)
      if (es) {
        try { es.close() } catch (_) {}
      }
    }
  }, [])

  const handleSelectCreator = async (creator) => {
    if (!creator?.id) return
    const nextTab = activeTab === 'finance' ? 'finance' : 'creators'
    if (!shouldShowUnread(creator)) {
      setUnreadCounts(prev => ({ ...prev, [creator.id]: 0 }))
    }
    setEventReturnContext(null)
    setChatJumpTarget(null)
    setActiveTab(nextTab)
    setConversationScope('creators')
    setSelectedGroupChat(null)
    setSelectedCreator(null)
    await selectCreatorById(creator.id, {
      activeTab: nextTab,
    })
  }

  const handleSelectGroupChat = useCallback((groupChat) => {
    setEventReturnContext(null)
    setChatJumpTarget(null)
    setActiveTab('creators')
    setConversationScope('groups')
    setSelectedCreator(null)
    setSelectedGroupChat(groupChat)
  }, [])

  const handleCreatorMessageSent = useCallback((creatorId) => {
    if (!creatorId) return
    setUnreadCounts(prev => ({ ...prev, [creatorId]: 0 }))
    setCreators(prev => prev.map(c => {
      if (c.id !== creatorId) return c
      return {
        ...c,
        ev_replied: 1,
        _full: c._full ? { ...c._full, ev_replied: 1 } : c._full,
      }
    }))
    setSelectedCreator(prev => {
      if (!prev || prev.id !== creatorId) return prev
      return {
        ...prev,
        ev_replied: 1,
        _full: prev._full ? { ...prev._full, ev_replied: 1 } : prev._full,
      }
    })
  }, [])

  const handleCreatorUpdated = useCallback((updatedDetail) => {
    if (!updatedDetail?.id) return
    if (updatedDetail.removed) {
      setCreators(prev => prev.filter(c => c.id !== updatedDetail.id))
      setSelectedCreator(prev => (prev && prev.id === updatedDetail.id ? null : prev))
      return
    }
    setCreators(prev => {
      const next = prev.map(c => c.id === updatedDetail.id ? buildCreatorViewModel(updatedDetail, c) : c)
      next.sort((a, b) => getCreatorLastConversationTs(b) - getCreatorLastConversationTs(a))
      return next
    })
    setSelectedCreator(prev => {
      if (!prev || prev.id !== updatedDetail.id) return prev
      return buildCreatorViewModel(updatedDetail, prev)
    })
  }, [])

  const resolveCreatorIdFromQuery = useCallback(async ({ waPhone, jbName, keeperUsername, creator }) => {
    const normalizedPhone = normalizePhoneKey(waPhone)
    const normalizedJbName = normalizeLookupText(jbName)
    const normalizedKeeperUsername = normalizeLookupText(keeperUsername)
    const normalizedCreatorLookup = normalizeLookupText(creator)
    const normalizedCreatorPhone = normalizePhoneKey(creator)
    const fallbackCreatorId = parsePositiveInt(creator)
    const searchValue = waPhone || keeperUsername || jbName || creator
    if (!searchValue) return null

    try {
      const params = new URLSearchParams()
      params.set('search', searchValue)
      params.set('fields', 'wa_phone')
      const list = await fetchJsonOrThrow(`${API_BASE}/creators?${params.toString()}`)
      if (!Array.isArray(list) || list.length === 0) return null

      const exact =
        list.find((item) => normalizedPhone && normalizePhoneKey(item?.wa_phone) === normalizedPhone)
        || list.find((item) => normalizedKeeperUsername && normalizeLookupText(item?.keeper_username) === normalizedKeeperUsername)
        || list.find((item) => normalizedJbName && normalizeLookupText(item?.primary_name) === normalizedJbName)
        || list.find((item) => normalizedCreatorPhone && normalizePhoneKey(item?.wa_phone) === normalizedCreatorPhone)
        || list.find((item) => normalizedCreatorLookup && normalizeLookupText(item?.keeper_username) === normalizedCreatorLookup)
        || list.find((item) => normalizedCreatorLookup && normalizeLookupText(item?.primary_name) === normalizedCreatorLookup)

      return Number(exact?.id || list[0]?.id || 0) || fallbackCreatorId || null
    } catch (e) {
      console.error('[workspaceBootstrap] resolveCreatorIdFromQuery error:', e)
      return fallbackCreatorId || null
    }
  }, [])

  const selectCreatorById = useCallback(async (creatorId, options = {}) => {
    const normalizedCreatorId = Number(creatorId || 0)
    if (!normalizedCreatorId) return null

    try {
      const detail = await fetchJsonOrThrow(`${API_BASE}/creators/${normalizedCreatorId}`)
      const previous =
        creators.find(c => Number(c.id) === normalizedCreatorId)
        || (selectedCreator?.id === normalizedCreatorId ? selectedCreator : {})
      const vm = buildCreatorViewModel(detail, previous)

      setSelectedGroupChat(null)
      setConversationScope('creators')
      setSelectedCreator(vm)
      if (options.activeTab) setActiveTab(options.activeTab)
      if (Object.prototype.hasOwnProperty.call(options, 'selectedEventId')) {
        setSelectedEventId(options.selectedEventId || null)
      }
      if (Object.prototype.hasOwnProperty.call(options, 'chatJumpTarget')) {
        setChatJumpTarget(options.chatJumpTarget || null)
      }
      return vm
    } catch (e) {
      console.error('[workspaceBootstrap] selectCreatorById error:', e)
      return null
    }
  }, [creators, selectedCreator])

  const handleOpenCreatorChatFromEvent = useCallback(async (jumpPayload) => {
    const creatorId = Number(jumpPayload?.creatorId || 0)
    if (!creatorId) return

    const nextEventId = jumpPayload?.eventId ? Number(jumpPayload.eventId) : null
    setEventReturnContext(nextEventId ? {
      source: 'events',
      eventId: nextEventId,
      scrollTop: Number(jumpPayload.returnScrollTop || 0),
    } : null)

    await selectCreatorById(creatorId, {
      activeTab: 'creators',
      selectedEventId: nextEventId,
      chatJumpTarget: {
        requestId: Date.now(),
        creatorId,
        sourceMessageId: jumpPayload?.sourceMessageId || null,
        sourceMessageTimestamp: jumpPayload?.sourceMessageTimestamp || null,
        sourceText: jumpPayload?.sourceText || '',
        triggerText: jumpPayload?.triggerText || '',
        eventKey: jumpPayload?.eventKey || '',
      },
    })
  }, [selectCreatorById])

  useEffect(() => {
    if (queryBootstrapDoneRef.current) return

    const params = new URLSearchParams(window.location.search)
    const hasQuery = ['tab', 'creatorId', 'creator', 'eventId', 'waPhone', 'jbName', 'keeperUsername'].some((key) => params.has(key))
    if (!hasQuery) {
      queryBootstrapDoneRef.current = true
      return
    }

    queryBootstrapDoneRef.current = true
    const targetTab = normalizeWorkspaceTab(params.get('tab'))
    const eventId = parsePositiveInt(params.get('eventId'))
    const creatorId = parsePositiveInt(params.get('creatorId'))
    const legacyCreator = String(params.get('creator') || '').trim()
    const waPhone = String(params.get('waPhone') || '').trim()
    const jbName = String(params.get('jbName') || '').trim()
    const keeperUsername = String(params.get('keeperUsername') || '').trim()

    const bootstrap = async () => {
      setActiveTab(targetTab)
      if (eventId) setSelectedEventId(eventId)

      let resolvedCreatorId = creatorId
      if (!resolvedCreatorId) {
        resolvedCreatorId = await resolveCreatorIdFromQuery({ waPhone, jbName, keeperUsername, creator: legacyCreator })
      }
      if (!resolvedCreatorId) return

      await selectCreatorById(resolvedCreatorId, {
        activeTab: targetTab,
        selectedEventId: eventId,
      })
    }

    bootstrap().catch((e) => {
      console.error('[workspaceBootstrap] error:', e)
    })
  }, [resolveCreatorIdFromQuery, selectCreatorById])

  const handleCloseConversation = useCallback(() => {
    setChatJumpTarget(null)
    setSelectedGroupChat(null)
    setSelectedCreator(null)

    if (eventReturnContext?.source === 'events' && eventReturnContext?.eventId) {
      setConversationScope('creators')
      setActiveTab('events')
      setSelectedEventId(eventReturnContext.eventId)
      setEventPanelRestoreState({
        token: Date.now(),
        eventId: eventReturnContext.eventId,
        scrollTop: Number(eventReturnContext.scrollTop || 0),
      })
      setEventReturnContext(null)
      return
    }

    setConversationScope('creators')
    setEventReturnContext(null)
  }, [eventReturnContext])

  const suggestedManualOwner = useMemo(() => {
    if (ownerLocked) return lockedOwner || ''
    if (filterOwner && filterOwner !== '') return filterOwner
    if (selectedCreator?.wa_owner) return selectedCreator.wa_owner
    const statOwner = Object.keys(stats?.by_owner || {}).find(Boolean)
    if (statOwner) return statOwner
    const creatorOwner = creators.map(c => c.wa_owner).find(Boolean)
    if (creatorOwner) return creatorOwner
    return sessionOwners.find(Boolean) || ''
  }, [creators, filterOwner, lockedOwner, ownerLocked, selectedCreator?.wa_owner, sessionOwners, stats])

  const openManualModal = useCallback(() => {
    setManualForm({ name: '', phone: '', owner: suggestedManualOwner })
    setManualCheck(null)
    setManualError('')
    setManualMode('single')
    setBulkText('')
    setBulkResults(null)
    setBulkError('')
    setBulkSendWelcome(false)
    setBulkWelcomeText('')
    setBulkWelcomeTemplateKey('welcome')
    setManualOpen(true)
  }, [suggestedManualOwner])

  const closeManualModal = useCallback(() => {
    if (manualSaving || bulkSaving) return
    setManualOpen(false)
    setManualError('')
    setManualCheck(null)
    setBulkError('')
  }, [manualSaving, bulkSaving])

  const submitBulkImport = useCallback(async (parsedRows) => {
    if (!Array.isArray(parsedRows) || parsedRows.length === 0) {
      setBulkError('请先粘贴至少一行数据')
      return
    }
    const owner = (manualForm.owner || '').trim()
    if (!owner) {
      setBulkError('请先选择负责人')
      return
    }
    if (bulkSendWelcome && !bulkWelcomeText.trim()) {
      setBulkError('请先填写欢迎消息')
      return
    }
    setBulkSaving(true)
    setBulkError('')
    setBulkResults(null)
    try {
      const payload = bulkSendWelcome ? {
        rows: parsedRows.map(r => ({ name: r.name, phone: r.phone })),
        owner,
        source: 'csv-import',
        send_welcome: true,
        welcome_template_key: bulkWelcomeTemplateKey || 'welcome',
        welcome_text: bulkWelcomeText.trim(),
      } : {
        rows: parsedRows.map(r => ({ name: r.name, phone: r.phone })),
        owner,
        source: 'csv-import',
      }
      const endpoint = bulkSendWelcome
        ? `${API_BASE}/creator-import-batches`
        : `${API_BASE}/creators/import`
      const result = await fetchJsonOrThrow(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      setBulkResults(result)
      await loadData()
    } catch (e) {
      setBulkError(e.message || '批量导入失败')
    } finally {
      setBulkSaving(false)
    }
  }, [bulkSendWelcome, bulkWelcomeTemplateKey, bulkWelcomeText, manualForm.owner, loadData])

  useEffect(() => {
    if (!manualOpen) return
    const name = (manualForm.name || '').trim()
    const phone = (manualForm.phone || '').trim()
    if (!name && !phone) {
      setManualCheck(null)
      return
    }
    const timer = setTimeout(async () => {
      setManualCheckLoading(true)
      try {
        const params = new URLSearchParams()
        if (name) params.set('name', name)
        if (phone) params.set('phone', phone)
        if (manualForm.owner) params.set('owner', manualForm.owner)
        const data = await fetchJsonOrThrow(`${API_BASE}/creators/manual-check?${params.toString()}`)
        setManualCheck(data)
      } catch (e) {
        setManualCheck({ ok: false, error: e.message || '去重检查失败' })
      } finally {
        setManualCheckLoading(false)
      }
    }, 300)
    return () => clearTimeout(timer)
  }, [manualOpen, manualForm.name, manualForm.phone, manualForm.owner])

  const saveManualCreator = useCallback(async () => {
    const payload = {
      primary_name: (manualForm.name || '').trim(),
      wa_phone: (manualForm.phone || '').trim(),
      wa_owner: (manualForm.owner || '').trim(),
      source: 'manual',
    }
    if (!payload.primary_name || !payload.wa_phone || !payload.wa_owner) {
      setManualError('请填写达人姓名、手机号和负责人')
      return
    }
    setManualSaving(true)
    setManualError('')
    try {
      const result = await fetchJsonOrThrow(`${API_BASE}/creators/manual`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      setManualOpen(false)
      await loadData()
      if (result?.creator?.id) {
        const detail = await fetchJsonOrThrow(`${API_BASE}/creators/${result.creator.id}`)
        const vm = buildCreatorViewModel(detail, result.creator)
        setSelectedCreator(vm)
      }
    } catch (e) {
      setManualError(e.message || '录入失败')
    } finally {
      setManualSaving(false)
    }
  }, [manualForm, loadData])

  useEffect(() => {
    setSelectedCreatorIds(prev => prev.filter(id => creators.some(c => c.id === id)))
  }, [creators])

  const toggleCreatorSelection = useCallback((creatorId) => {
    setSelectedCreatorIds(prev => prev.includes(creatorId)
      ? prev.filter(id => id !== creatorId)
      : [...prev, creatorId]
    )
  }, [])

  const clearSelectedCreators = useCallback(() => {
    setSelectedCreatorIds([])
  }, [])

  const loadOwnerTransferPreview = useCallback(async ({ fromOwner = 'Jiawen', toOwner = 'Yiyun' } = {}) => {
    const from = String(fromOwner || '').trim()
    const to = String(toOwner || '').trim()
    if (!from || !to) {
      setOwnerTransferError('请选择来源和目标 owner')
      return null
    }
    setOwnerTransferLoading(true)
    setOwnerTransferError('')
    try {
      const params = new URLSearchParams({ from, to })
      const res = await fetchJsonOrThrow(`${API_BASE}/operator-roster/transfer-preview?${params.toString()}`)
      const data = res?.data || null
      setOwnerTransferPreview(data)
      return data
    } catch (e) {
      setOwnerTransferError(e.message || '读取迁移预览失败')
      return null
    } finally {
      setOwnerTransferLoading(false)
    }
  }, [])

  const executeOwnerTransfer = useCallback(async ({ fromOwner = 'Jiawen', toOwner = 'Yiyun' } = {}) => {
    const preview = ownerTransferPreview || await loadOwnerTransferPreview({ fromOwner, toOwner })
    if (!preview) return
    const confirmed = window.confirm(
      `确认将 ${preview.from_owner} 的 ${preview.creator_count || 0} 位联系人迁移到 ${preview.to_owner}？\n\n同时会更新 ${preview.roster_count || 0} 条 roster 归属和 ${preview.event_count || 0} 条事件归属；历史消息不会删除。`
    )
    if (!confirmed) return
    setOwnerTransferExecuting(true)
    setOwnerTransferError('')
    try {
      const res = await fetchJsonOrThrow(`${API_BASE}/operator-roster/transfer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: fromOwner, to: toOwner, confirm: true }),
      })
      const nextOwner = res?.data?.to_owner || toOwner
      creatorsCacheRef.current.clear()
      setFilterOwner(nextOwner)
      setManualForm(prev => ({ ...prev, owner: nextOwner }))
      setSelectedCreatorIds([])
      setOwnerTransferPreview(null)
      if (nextOwner === filterOwner) await loadData()
      window.alert(`已迁移 ${res?.data?.creators_updated || 0} 位联系人到 ${nextOwner}`)
    } catch (e) {
      setOwnerTransferError(e.message || '迁移失败')
    } finally {
      setOwnerTransferExecuting(false)
    }
  }, [filterOwner, loadData, loadOwnerTransferPreview, ownerTransferPreview])

  const filteredCreators = useMemo(() => creators.filter(c => {
    if (search) {
      const s = search.toLowerCase()
      if (!(c.primary_name || '').toLowerCase().includes(s) &&
          !(c.wa_phone || '').includes(s) &&
          !(c.keeper_username || '').toLowerCase().includes(s)) return false
    }
    if (filterBeta && c._full?.wacrm?.beta_status !== filterBeta) return false
    if (filterPriority && c._full?.wacrm?.priority !== filterPriority) return false
    if (filterAgency === 'yes' && !c._full?.wacrm?.agency_bound) return false
    if (filterAgency === 'no' && c._full?.wacrm?.agency_bound) return false
    if (filterEvent) {
      if (!creatorMatchesEventFilter(c, filterEvent)) return false
    }
    if (filterLifecycle && c.lifecycle?.stage_key !== filterLifecycle) return false
    return true
  }), [creators, search, filterBeta, filterPriority, filterAgency, filterEvent, filterLifecycle])

  const filteredGroupChats = useMemo(() => groupChats.filter(group => {
    if (!isMorasCoreGroup(group.group_name || '')) return false
    if (!search) return true
    const s = search.toLowerCase()
    return (group.group_name || '').toLowerCase().includes(s)
      || (group.session_id || '').toLowerCase().includes(s)
  }), [groupChats, search])

  const ownerOptions = useMemo(() => {
    if (ownerLocked) return buildOwnerOptions([lockedOwner], { includeAll: false })
    return buildOwnerOptions([
      ...Object.keys(stats?.by_owner || {}),
      ...creators.map(c => c.wa_owner),
      ...sessionOwners,
      selectedCreator?.wa_owner,
      filterOwner,
    ], { includeAll: true })
  }, [creators, filterOwner, lockedOwner, ownerLocked, selectedCreator?.wa_owner, sessionOwners, stats])

  const visibleCreatorIds = useMemo(() => filteredCreators.map(c => c.id), [filteredCreators])
  const selectedVisibleCreatorIds = useMemo(
    () => visibleCreatorIds.filter(id => selectedCreatorIds.includes(id)),
    [selectedCreatorIds, visibleCreatorIds]
  )
  const selectedVisibleCount = selectedVisibleCreatorIds.length
  const allVisibleSelected = visibleCreatorIds.length > 0 && selectedVisibleCount === visibleCreatorIds.length

  useEffect(() => {
    setSelectedCreatorIds(prev => prev.filter(id => visibleCreatorIds.includes(id)))
  }, [visibleCreatorIds])

  const applyBatchActiveChange = useCallback(async () => {
    if (selectedVisibleCreatorIds.length === 0) return
    const owner = ownerLocked ? lockedOwner : filterOwner
    if (!owner) {
      window.alert('请先选择一个 owner 后再批量解绑/恢复')
      return
    }
    const action = showInactive ? 'rebind' : 'unbind'
    const verb = action === 'rebind' ? '恢复绑定' : '解绑'
    const confirmed = window.confirm(`确认${verb}当前选中的 ${selectedVisibleCreatorIds.length} 位达人？\n\n该操作只会影响 ${owner} 名下联系人；历史消息和事件数据会保留。`)
    if (!confirmed) return
    setBatchTogglingActive(true)
    try {
      const result = await fetchJsonOrThrow(`${API_BASE}/creators/batch-active`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          owner,
          action,
          creator_ids: selectedVisibleCreatorIds,
        }),
      })
      if (action === 'unbind' && selectedCreator?.id && selectedVisibleCreatorIds.includes(selectedCreator.id)) {
        setSelectedCreator(null)
      }
      setSelectedCreatorIds([])
      creatorsCacheRef.current.clear()
      await loadData()
      window.alert(`已${verb} ${result?.updated_count || 0} 位达人`)
    } catch (e) {
      window.alert(e.message || `批量${verb}失败`)
    } finally {
      setBatchTogglingActive(false)
    }
  }, [filterOwner, loadData, lockedOwner, ownerLocked, selectedCreator?.id, selectedVisibleCreatorIds, showInactive])

  const applyCreatorActiveChange = useCallback(async (creator) => {
    if (!creator?.id) return
    const owner = creator.wa_owner || creator?._full?.wa_owner || (ownerLocked ? lockedOwner : filterOwner)
    if (!owner) {
      window.alert('缺少 owner，无法解绑/恢复该联系人')
      return
    }
    const action = showInactive ? 'rebind' : 'unbind'
    const verb = showInactive ? '恢复绑定' : '解绑'
    const confirmed = window.confirm(`确认${verb} ${creator.primary_name || '该联系人'}？\n\n历史消息和事件数据会保留。`)
    if (!confirmed) return
    setActiveTogglingCreatorId(creator.id)
    try {
      const result = await fetchJsonOrThrow(`${API_BASE}/creators/batch-active`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          owner,
          action,
          creator_ids: [creator.id],
        }),
      })
      if (action === 'unbind' && selectedCreator?.id === creator.id) {
        setSelectedCreator(null)
      }
      setSelectedCreatorIds(prev => prev.filter(id => id !== creator.id))
      creatorsCacheRef.current.clear()
      await loadData()
      window.alert(`已${verb} ${result?.updated_count || 0} 位达人`)
    } catch (e) {
      window.alert(e.message || `${verb}失败`)
    } finally {
      setActiveTogglingCreatorId(null)
    }
  }, [filterOwner, loadData, lockedOwner, ownerLocked, selectedCreator?.id, showInactive])

  const saveCreatorBasicInfo = useCallback(async (creatorId, payload) => {
    const result = await fetchJsonOrThrow(`${API_BASE}/creators/${creatorId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    creatorsCacheRef.current.clear()
    await loadData()
    if (selectedCreator?.id === creatorId) {
      const detail = await fetchJsonOrThrow(`${API_BASE}/creators/${creatorId}`)
      setSelectedCreator(buildCreatorViewModel(detail, selectedCreator))
    }
    return result
  }, [loadData, selectedCreator])

  const toggleSelectAllVisible = useCallback(() => {
    if (visibleCreatorIds.length === 0) return
    setSelectedCreatorIds(prev => {
      if (visibleCreatorIds.every(id => prev.includes(id))) {
        return prev.filter(id => !visibleCreatorIds.includes(id))
      }
      const next = new Set(prev)
      for (const id of visibleCreatorIds) next.add(id)
      return [...next]
    })
  }, [visibleCreatorIds])

  const activeFilterCount = [filterBeta, filterPriority, filterAgency, filterEvent, filterLifecycle].filter(Boolean).length
  const selectedCreatorStatusMeta = getCreatorStatusMeta(selectedCreator)
  const workspaceMeta = WORKSPACE_META[activeTab] || WORKSPACE_META.creators
  const waStatusLabel = waQrData ? '需要扫码' : '已连接'
  const waStatusTone = waQrData ? '#b45309' : WA.teal
  const selectedOwnerLabel = selectedCreator?.wa_owner || selectedGroupChat?.operator || (filterOwner || 'All')

  const isMobile = useIsMobile()

  if (isMobile) {
    return (
      <>
        <MobileShell
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          ownerLocked={ownerLocked}
          creators={creators}
          filteredCreators={filteredCreators}
          loading={loading}
          unreadCounts={unreadCounts}
          search={search}
          setSearch={setSearch}
          filterOwner={filterOwner}
          setFilterOwner={setFilterOwner}
          ownerOptions={ownerOptions}
          filterLifecycle={filterLifecycle}
          setFilterLifecycle={setFilterLifecycle}
          filterBeta={filterBeta}
          setFilterBeta={setFilterBeta}
          filterPriority={filterPriority}
          setFilterPriority={setFilterPriority}
          filterAgency={filterAgency}
          setFilterAgency={setFilterAgency}
          filterEvent={filterEvent}
          setFilterEvent={setFilterEvent}
          activeFilterCount={activeFilterCount}
          openManualModal={openManualModal}
          loadData={loadData}
          selectedCreator={selectedCreator}
          handleSelectCreator={handleSelectCreator}
          handleCloseConversation={handleCloseConversation}
          handleOpenCreatorChatFromEvent={handleOpenCreatorChatFromEvent}
          selectedEventId={selectedEventId}
          setSelectedEventId={setSelectedEventId}
          eventPanelRestoreState={eventPanelRestoreState}
          LIFECYCLE_FILTER_OPTIONS={LIFECYCLE_FILTER_OPTIONS}
          renderCreatorListItem={(c, { unread, onClick }) => (
            <MobileChatListRow key={c.id} creator={c} unread={unread} onClick={onClick} />
          )}
          renderChatContent={(creator) => (
            <WAMessageComposer
              key={creator.id}
              client={{
                id: creator.id,
                phone: creator.wa_phone,
                name: creator.primary_name,
                wa_owner: creator.wa_owner,
                conversion_stage: creator.lifecycle?.stage_key || creator.beta_status || 'unknown',
                lifecycle_stage: creator.lifecycle?.stage_key || 'unknown',
                lifecycle_label: creator.lifecycle?.stage_label || null,
              }}
              creator={creator}
              jumpTarget={creator?.id === chatJumpTarget?.creatorId ? chatJumpTarget : null}
              onClose={handleCloseConversation}
              onMessageSent={handleCreatorMessageSent}
              onCreatorUpdated={handleCreatorUpdated}
              asPanel
            />
          )}
          renderCreatorDetail={(creator, onCloseDetail) => (
            <CreatorDetail
              key={creator.id}
              creatorId={creator.id}
              creatorName={creator.primary_name}
              onClose={onCloseDetail}
              onMessageSent={handleCreatorMessageSent}
              onCreatorUpdated={handleCreatorUpdated}
              asPanel
            />
          )}
        />
        <ManualCreatorModal
          open={manualOpen}
          form={manualForm}
          ownerLocked={ownerLocked}
          lockedOwner={lockedOwner}
          onFormChange={setManualForm}
          onClose={closeManualModal}
          onSave={saveManualCreator}
          saving={manualSaving}
          checkLoading={manualCheckLoading}
          checkResult={manualCheck}
          error={manualError}
          mode={manualMode}
          onModeChange={setManualMode}
          bulkText={bulkText}
          onBulkTextChange={setBulkText}
          onBulkSubmit={submitBulkImport}
          bulkSaving={bulkSaving}
          bulkResults={bulkResults}
          bulkError={bulkError}
          bulkSendWelcome={bulkSendWelcome}
          onBulkSendWelcomeChange={setBulkSendWelcome}
          bulkWelcomeText={bulkWelcomeText}
          onBulkWelcomeTextChange={setBulkWelcomeText}
          bulkWelcomeTemplateKey={bulkWelcomeTemplateKey}
          onBulkWelcomeTemplateKeyChange={setBulkWelcomeTemplateKey}
          availableOwners={ownerOptions}
        />
      </>
    )
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* ===== Mobile Sidebar Overlay ===== */}
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
                  <div className="text-sm font-semibold text-white leading-none">{conversationScope === 'groups' ? '群聊列表' : '达人列表'}</div>
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={openManualModal}
                  className="text-white/70 hover:text-white text-base"
                  title="手动录入达人"
                >
                  ＋
                </button>
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
                  <button key={o} onClick={() => !ownerLocked && setFilterOwner(o)} className="shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors" style={{ background: filterOwner === o ? WA.teal : 'transparent', color: filterOwner === o ? 'white' : WA.textMuted, opacity: ownerLocked ? 0.92 : 1 }}>{o === '' ? '全部' : o}</button>
                ))}
              </div>
              <div className="flex items-center gap-1 px-3 py-2 border-b overflow-x-auto" style={{ borderColor: WA.borderLight }}>
                <button onClick={() => setConversationScope('creators')} className="shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors" style={{ background: conversationScope === 'creators' ? WA.teal : 'transparent', color: conversationScope === 'creators' ? 'white' : WA.textMuted }}>私聊</button>
                <button onClick={() => setConversationScope('groups')} className="shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors" style={{ background: conversationScope === 'groups' ? WA.teal : 'transparent', color: conversationScope === 'groups' ? 'white' : WA.textMuted }}>群聊</button>
              </div>
              <div className="px-3 py-2 border-b" style={{ borderColor: WA.borderLight }}>
                <FilterSelect value={filterLifecycle} onChange={setFilterLifecycle} placeholder="生命周期">
                  {LIFECYCLE_FILTER_OPTIONS.map(option => (
                    <option key={option.key || 'all'} value={option.key}>{option.label}</option>
                  ))}
                </FilterSelect>
              </div>
              {/* Creator list */}
              <div>
                {conversationScope === 'groups'
                  ? filteredGroupChats.map(group => (
                    <GroupChatListItem key={group.id} groupChat={group} active={selectedGroupChat?.id === group.id} onClick={() => { handleSelectGroupChat(group); setMobileSidebarOpen(false) }} />
                  ))
                  : filteredCreators.map(c => (
                    <ChatListItem key={c.id} creator={c} unread={unreadCounts[c.id] || 0} onClick={() => { handleSelectCreator(c); setMobileSidebarOpen(false) }} />
                  ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ===== Desktop: Workbench Layout ===== */}
      <div className="hidden md:flex flex-1 min-h-0 overflow-hidden p-4 app-shell">
        <div className="flex-1 min-w-0 flex flex-col gap-3">
          <div className="docs-panel shrink-0 px-5 py-4 flex items-center justify-between gap-4" style={{ background: WA.shellPanelStrong }}>
            <div className="flex items-center gap-6 min-w-0">
              <div className="flex items-center gap-3 shrink-0">
                <div
                  className="w-10 h-10 rounded-2xl flex items-center justify-center text-sm font-bold text-white"
                  style={{ background: WA.teal, boxShadow: 'inset 0 -1px 0 rgba(255,255,255,0.18)' }}
                >
                  WA
                </div>
                <div className="min-w-0">
                  <div className="docs-kicker">Creator Operations</div>
                  <div className="docs-title">WA CRM</div>
                </div>
              </div>
              <div className="flex items-center gap-2 overflow-x-auto docs-scrollbar">
                {DESKTOP_PRIMARY_TABS.filter(tab => !tab.adminOnly || isAdmin).map(tab => (
                  <button
                    key={tab.key}
                    onClick={() => setActiveTab(tab.key)}
                    className="shrink-0 px-4 py-2.5 rounded-full text-sm font-medium transition-all"
                    style={{
                      background: activeTab === tab.key ? WA.shellActive : 'transparent',
                      color: activeTab === tab.key ? WA.textDark : WA.textMuted,
                      border: `1px solid ${activeTab === tab.key ? WA.shellBorderStrong : 'transparent'}`
                    }}
                    title={tab.subtitle}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <AuthSessionControls />
              <div
                className="hidden lg:flex items-center gap-2 px-3 py-2 rounded-full text-xs font-medium"
                style={{ background: WA.white, color: WA.textMuted, border: `1px solid ${WA.borderLight}` }}
              >
                <span className="w-2 h-2 rounded-full" style={{ background: waStatusTone }} />
                {waStatusLabel}
              </div>
              <button
                onClick={() => loadData()}
                disabled={loading}
                className="px-3.5 py-2 rounded-full text-sm font-medium transition-all disabled:opacity-50 inline-flex items-center justify-center"
                style={{ background: WA.white, color: WA.textMuted, border: `1px solid ${WA.borderLight}`, minWidth: 72 }}
              >
                <span style={{ display: 'inline-block', width: 14, textAlign: 'center' }}>{loading ? '⋯' : '↻'}</span>
                <span style={{ marginLeft: 4 }}>刷新</span>
              </button>
              <button
                onClick={() => setActiveTab('contacts')}
                className="px-4 py-2 rounded-full text-sm font-semibold text-white transition-all"
                style={{ background: WA.teal }}
              >
                联系人管理
              </button>
            </div>
          </div>

          <div className="flex-1 min-h-0 flex gap-1.5 overflow-hidden">
            {activeTab === 'contacts' ? (
              <ContactManagementPage
                ownerLocked={ownerLocked}
                lockedOwner={lockedOwner}
                ownerOptions={ownerOptions.filter(Boolean)}
                owner={manualForm.owner || ''}
                onOwnerChange={(value) => {
                  setManualForm(prev => ({ ...prev, owner: value }))
                  if (!ownerLocked) setFilterOwner(value)
                }}
                search={search}
                onSearchChange={setSearch}
                showInactive={showInactive}
                onShowInactiveChange={setShowInactive}
                creators={filteredCreators}
                selectedCreatorIds={selectedCreatorIds}
                selectedVisibleCount={selectedVisibleCount}
                allVisibleSelected={allVisibleSelected}
                toggleSelectAllVisible={toggleSelectAllVisible}
                clearSelectedCreators={clearSelectedCreators}
                toggleCreatorSelection={toggleCreatorSelection}
                onOpenCreator={(creator) => {
                  handleSelectCreator(creator)
                  setActiveTab('creators')
                }}
                applyBatchActiveChange={applyBatchActiveChange}
                batchTogglingActive={batchTogglingActive}
                activeTogglingCreatorId={activeTogglingCreatorId}
                onToggleCreatorActive={applyCreatorActiveChange}
                onSaveCreatorEdit={saveCreatorBasicInfo}
                form={manualForm}
                onFormChange={setManualForm}
                onSave={saveManualCreator}
                saving={manualSaving}
                checkLoading={manualCheckLoading}
                checkResult={manualCheck}
                error={manualError}
                bulkText={bulkText}
                onBulkTextChange={setBulkText}
                onBulkSubmit={submitBulkImport}
                bulkSaving={bulkSaving}
                bulkResults={bulkResults}
                bulkError={bulkError}
                bulkSendWelcome={bulkSendWelcome}
                onBulkSendWelcomeChange={setBulkSendWelcome}
                bulkWelcomeText={bulkWelcomeText}
                onBulkWelcomeTextChange={setBulkWelcomeText}
                bulkWelcomeTemplateKey={bulkWelcomeTemplateKey}
                onBulkWelcomeTemplateKeyChange={setBulkWelcomeTemplateKey}
                isAdmin={isAdmin}
                transferPreview={ownerTransferPreview}
                transferLoading={ownerTransferLoading}
                transferExecuting={ownerTransferExecuting}
                transferError={ownerTransferError}
                onLoadTransferPreview={loadOwnerTransferPreview}
                onExecuteOwnerTransfer={executeOwnerTransfer}
                onClearTransferPreview={() => setOwnerTransferPreview(null)}
              />
            ) : (
            <>
            <div
              className="docs-panel shrink-0 flex flex-col overflow-hidden"
              style={{
                width: panelWidths.list,
                minWidth: panelWidths.list,
                maxWidth: panelWidths.list,
                background: WA.shellPanel,
              }}
            >
              <div className="px-4 pt-3 pb-3 border-b space-y-2.5" style={{ borderColor: WA.shellBorder }}>
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0 flex items-center gap-2">
                    <div className="docs-title">{conversationScope === 'groups' ? '群聊归档' : '达人名录'}</div>
                    <div
                      className="shrink-0 px-2.5 py-0.5 rounded-full text-[11px] font-semibold"
                      style={{ background: WA.shellAccentSoft, color: WA.teal }}
                    >
                      {conversationScope === 'groups' ? `${filteredGroupChats.length} 群` : `${filteredCreators.length} 人`}
                    </div>
                  </div>
                  <div className="flex gap-1 rounded-full p-0.5 shrink-0" style={{ background: WA.shellPanelMuted }}>
                    <button
                      onClick={() => setConversationScope('creators')}
                      className="px-2.5 py-1 rounded-full text-[11px] font-semibold transition-all"
                      style={{
                        background: conversationScope === 'creators' ? WA.white : 'transparent',
                        color: conversationScope === 'creators' ? WA.textDark : WA.textMuted,
                        border: `1px solid ${conversationScope === 'creators' ? WA.borderLight : 'transparent'}`
                      }}
                      title="私聊达人"
                    >
                      私聊
                    </button>
                    <button
                      onClick={() => setConversationScope('groups')}
                      className="px-2.5 py-1 rounded-full text-[11px] font-semibold transition-all"
                      style={{
                        background: conversationScope === 'groups' ? WA.white : 'transparent',
                        color: conversationScope === 'groups' ? WA.textDark : WA.textMuted,
                        border: `1px solid ${conversationScope === 'groups' ? WA.borderLight : 'transparent'}`
                      }}
                      title="群聊归档"
                    >
                      群聊
                    </button>
                  </div>
                </div>

                <div className="flex items-center gap-3 px-3.5 py-2.5 rounded-2xl" style={{ background: WA.white, border: `1px solid ${WA.borderLight}` }}>
                  <span style={{ color: WA.textMuted }}>🔍</span>
                  <input
                    type="text"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    placeholder="搜索姓名、电话..."
                    className="flex-1 bg-transparent text-sm focus:outline-none"
                    style={{ color: WA.textDark }}
                  />
                  {search && (
                    <button onClick={() => setSearch('')} style={{ color: WA.textMuted }}>✕</button>
                  )}
                </div>

                <div className="flex items-center gap-2 overflow-x-auto docs-scrollbar pb-1">
                  {ownerOptions.map(o => (
                    <button
                      key={o}
                      onClick={() => !ownerLocked && setFilterOwner(o)}
                      className="shrink-0 px-3 py-1.5 rounded-full text-[12px] font-medium transition-all"
                      style={{
                        background: filterOwner === o ? WA.shellActive : WA.white,
                        color: filterOwner === o ? WA.textDark : WA.textMuted,
                        border: `1px solid ${filterOwner === o ? WA.shellBorderStrong : WA.borderLight}`,
                        opacity: ownerLocked ? 0.92 : 1,
                      }}
                    >
                      {o === '' ? '全部' : o}
                    </button>
                  ))}
                </div>
              </div>

              <div className="px-4 py-3 border-b space-y-2" style={{ borderColor: WA.shellBorder, background: WA.shellPanelMuted }}>
                <div className="flex items-center justify-between">
                  <div className="docs-kicker">Filters</div>
                  <div className="flex items-center gap-2">
                    {activeFilterCount > 0 && (
                      <span
                        className="text-[11px] px-2 py-0.5 rounded-full font-semibold"
                        style={{ background: WA.white, color: WA.textMuted, border: `1px solid ${WA.borderLight}` }}
                      >
                        {activeFilterCount} 项
                      </span>
                    )}
                    {activeFilterCount > 0 && filtersExpanded && (
                      <button
                        onClick={() => { setFilterBeta(''); setFilterPriority(''); setFilterAgency(''); setFilterEvent(''); setFilterLifecycle('') }}
                        className="text-[12px] font-semibold"
                        style={{ color: '#c65f49' }}
                      >
                        清除全部
                      </button>
                    )}
                    <button
                      onClick={() => setFiltersExpanded(v => !v)}
                      className="text-[12px] font-semibold"
                      style={{ color: WA.textMuted }}
                    >
                      {filtersExpanded ? '收起' : '展开'}
                    </button>
                  </div>
                </div>
                {filtersExpanded ? (
                  <>
                    <div className="grid grid-cols-2 gap-2">
                      <FilterSelect value={filterBeta} onChange={setFilterBeta} placeholder="Beta 子流程">
                        <option value="">Beta 子流程</option>
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
                    <FilterSelect value={filterLifecycle} onChange={setFilterLifecycle} placeholder="生命周期">
                      {LIFECYCLE_FILTER_OPTIONS.map(option => (
                        <option key={option.key || 'all'} value={option.key}>{option.label}</option>
                      ))}
                    </FilterSelect>
                    <label className="flex items-center gap-2 text-[12px] cursor-pointer select-none" style={{ color: WA.textMuted }}>
                      <input
                        type="checkbox"
                        checked={showInactive}
                        onChange={(e) => setShowInactive(e.target.checked)}
                      />
                      <span>显示已解绑达人</span>
                    </label>
                  </>
                ) : (
                  <div className="text-[12px] flex items-center justify-between gap-3 leading-5" style={{ color: WA.textMuted }}>
                    <span>{showInactive ? '当前：已解绑列表' : '过滤条件已收起'}</span>
                    <span>{activeFilterCount > 0 ? `当前生效 ${activeFilterCount} 项` : '未启用筛选'}</span>
                  </div>
                )}
              </div>

              <div className="px-4 py-2.5 border-b flex items-center justify-between gap-3" style={{ borderColor: WA.shellBorder }}>
                <div>
                  <div className="docs-kicker">Contacts</div>
                  <div className="text-[15px] font-semibold" style={{ color: WA.textDark }}>
                    {conversationScope === 'groups' ? `${filteredGroupChats.length} 个群聊` : `${filteredCreators.length} 位达人`}
                  </div>
                </div>
                {conversationScope === 'creators' && (
                  <div className="flex gap-1 rounded-full p-1" style={{ background: WA.shellPanelMuted }}>
                    <button
                      onClick={() => setViewMode('list')}
                      className="px-3 py-1.5 rounded-full text-[12px] font-semibold transition-all"
                      style={{
                        background: viewMode === 'list' ? WA.white : 'transparent',
                        color: viewMode === 'list' ? WA.textDark : WA.textMuted,
                        border: `1px solid ${viewMode === 'list' ? WA.borderLight : 'transparent'}`
                      }}
                    >
                      列表
                    </button>
                    <button
                      onClick={() => setViewMode('kanban')}
                      className="px-3 py-1.5 rounded-full text-[12px] font-semibold transition-all"
                      style={{
                        background: viewMode === 'kanban' ? WA.white : 'transparent',
                        color: viewMode === 'kanban' ? WA.textDark : WA.textMuted,
                        border: `1px solid ${viewMode === 'kanban' ? WA.borderLight : 'transparent'}`
                      }}
                    >
                      看板
                    </button>
                  </div>
                )}
              </div>

              <div className="flex-1 overflow-y-auto docs-scrollbar" style={{ background: WA.shellPanel }}>
                {loading && creators.length > 0 ? (
                  <div style={{ position: 'sticky', top: 0, height: 2, background: WA.teal, opacity: 0.6, zIndex: 10 }} />
                ) : null}
                {loading && creators.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-16 gap-3" style={{ color: WA.textMuted }}>
                    <div className="w-8 h-8 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: WA.teal, borderTopColor: 'transparent' }} />
                    <span className="text-xs">加载中...</span>
                  </div>
                ) : conversationScope === 'groups' ? (
                  filteredGroupChats.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-16 gap-3" style={{ color: WA.textMuted }}>
                      <div className="w-12 h-12 rounded-full flex items-center justify-center" style={{ background: WA.white, border: `1px solid ${WA.borderLight}` }}>
                        <span className="text-xl">👥</span>
                      </div>
                      <span className="text-sm">{groupsLoading ? '群聊加载中...' : '没有找到群聊'}</span>
                    </div>
                  ) : (
                    filteredGroupChats.map(group => (
                      <GroupChatListItem
                        key={group.id}
                        groupChat={group}
                        active={selectedGroupChat?.id === group.id}
                        onClick={() => handleSelectGroupChat(group)}
                      />
                    ))
                  )
                ) : filteredCreators.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-16 gap-3" style={{ color: WA.textMuted }}>
                    <div className="w-12 h-12 rounded-full flex items-center justify-center" style={{ background: WA.white, border: `1px solid ${WA.borderLight}` }}>
                      <span className="text-xl">🔍</span>
                    </div>
                    <span className="text-sm">没有找到达人</span>
                  </div>
                ) : viewMode === 'list' ? (
                  filteredCreators.map(c => (
                    <ChatListItem
                      key={c.id}
                      creator={c}
                      unread={unreadCounts[c.id] || 0}
                      active={selectedCreator?.id === c.id && activeTab === 'creators'}
                      onClick={() => handleSelectCreator(c)}
                    />
                  ))
                ) : (
                  <KanbanView creators={filteredCreators} onCreatorClick={c => handleSelectCreator(c)} />
                )}
              </div>

              <div className="shrink-0 px-4 py-3 border-t" style={{ borderColor: WA.shellBorder, background: WA.shellPanelStrong }}>
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="docs-panel-strong px-3 py-3">
                    <div className="text-sm font-semibold" style={{ color: WA.textDark }}>{stats?.total_messages?.toLocaleString?.() || 0}</div>
                    <div className="text-xs mt-0.5" style={{ color: WA.textMuted }}>消息</div>
                  </div>
                  <div className="docs-panel-strong px-3 py-3">
                    <div className="text-sm font-semibold" style={{ color: WA.textDark }}>{creators.filter(c => c.msg_count > 0).length}</div>
                    <div className="text-xs mt-0.5" style={{ color: WA.textMuted }}>活跃</div>
                  </div>
                  <div className="docs-panel-strong px-3 py-3">
                    <div className="text-sm font-semibold" style={{ color: WA.textDark }}>
                      {Number(stats?.yesterday_business_events ?? stats?.yesterday_new_events ?? 0).toLocaleString()}
                    </div>
                    <div className="text-xs mt-0.5" style={{ color: WA.textMuted }}>昨日业务事件</div>
                  </div>
                </div>
              </div>
            </div>

            <div
              className="w-3 shrink-0 cursor-col-resize group relative z-10"
              style={{ background: 'transparent' }}
              onMouseDown={startDrag('list-detail')}
              onTouchStart={startDrag('list-detail')}
            >
              <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 flex items-center justify-center">
                <div
                  className="w-0.5 h-12 rounded-full transition-all"
                  style={{ background: dragging === 'list-detail' ? WA.teal : WA.shellBorderStrong, opacity: dragging === 'list-detail' ? 1 : 0.8 }}
                />
              </div>
            </div>

            <div className="flex-1 min-w-0 docs-panel overflow-hidden flex flex-col" style={{ background: WA.shellPanelStrong }}>
              {activeTab === 'creators' ? (
                conversationScope === 'groups' ? (
                  <WAGroupChatViewer groupChat={selectedGroupChat} apiBase={API_BASE} />
                ) : selectedCreator ? (
                  <div className="flex-1 min-h-0 flex flex-col overflow-hidden" style={{ background: WA.chatBg }}>
                    <CreatorDetail
                      key={`chat-context-${selectedCreator.id}`}
                      creatorId={selectedCreator.id}
                      creatorName={selectedCreator.primary_name}
                      onClose={handleCloseConversation}
                      onMessageSent={handleCreatorMessageSent}
                      onCreatorUpdated={handleCreatorUpdated}
                      embedded
                    >
                      <WAMessageComposer
                        key={selectedCreator.id}
                        client={{
                          id: selectedCreator.id,
                          phone: selectedCreator.wa_phone,
                          name: selectedCreator.primary_name,
                          wa_owner: selectedCreator.wa_owner,
                          conversion_stage: selectedCreator.lifecycle?.stage_key || selectedCreator.beta_status || 'unknown',
                          lifecycle_stage: selectedCreator.lifecycle?.stage_key || 'unknown',
                          lifecycle_label: selectedCreator.lifecycle?.stage_label || null,
                        }}
                        creator={selectedCreator}
                        jumpTarget={selectedCreator?.id === chatJumpTarget?.creatorId ? chatJumpTarget : null}
                        onClose={handleCloseConversation}
                        onMessageSent={handleCreatorMessageSent}
                        onCreatorUpdated={handleCreatorUpdated}
                      />
                    </CreatorDetail>
                  </div>
                ) : waQrData ? (
                  <div className="flex-1 flex items-center justify-center" style={{ background: WA.chatBg }}>
                    <div
                      className="text-center p-8 rounded-[28px]"
                      style={{ background: WA.white, border: `1px solid ${WA.borderLight}`, boxShadow: WA.shellShadow }}
                    >
                      <img src={waQrData} alt="WA QR" style={{ width: 220, height: 220, borderRadius: 18, border: `1px solid ${WA.borderLight}`, marginBottom: 20 }} />
                      <div className="docs-title" style={{ fontSize: 20 }}>请扫码认证 WhatsApp</div>
                      <div className="text-sm mt-2" style={{ color: WA.textMuted }}>
                        WhatsApp → ⋮ → 已关联的设备 → 关联新设备
                      </div>
                    </div>
                  </div>
                ) : (
                  <Panel2Empty stats={stats} creators={creators} />
                )
              ) : (
                <div className="flex flex-col h-full min-h-0" style={{ background: WA.shellPanelStrong }}>
                  <div className="shrink-0 px-6 py-5 border-b" style={{ borderColor: WA.shellBorder }}>
                    <div className="docs-kicker">Workspace</div>
                    <div className="mt-1 flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <div className="text-[28px] leading-none font-semibold tracking-[-0.03em]" style={{ color: WA.textDark }}>
                          {workspaceMeta.title}
                        </div>
                        <div className="text-sm mt-2" style={{ color: WA.textMuted }}>
                          {workspaceMeta.subtitle}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <div className="px-3 py-2 rounded-full text-xs font-medium" style={{ background: WA.shellPanelMuted, color: WA.textMuted }}>
                          当前 Owner: <span style={{ color: WA.textDark }}>{selectedOwnerLabel}</span>
                        </div>
                        <div className="px-3 py-2 rounded-full text-xs font-medium" style={{ background: WA.shellPanelMuted, color: WA.textMuted }}>
                          筛选条件: <span style={{ color: WA.textDark }}>{activeFilterCount}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="flex-1 min-h-0 overflow-y-auto docs-scrollbar" style={{ background: WA.shellPanel }}>
                    {activeTab === 'finance' ? (
                      selectedCreator ? (
                        <CreatorDetail
                          key={`finance-${selectedCreator.id}`}
                          creatorId={selectedCreator.id}
                          creatorName={selectedCreator.primary_name}
                          onClose={handleCloseConversation}
                          onMessageSent={handleCreatorMessageSent}
                          onCreatorUpdated={handleCreatorUpdated}
                          financeOnly
                        />
                      ) : (
                        <div className="h-full flex items-center justify-center p-8" style={{ color: WA.textMuted }}>
                          <div className="docs-panel-strong px-6 py-5 text-center">
                            <div className="docs-title">请选择左侧达人</div>
                            <div className="text-sm mt-2">选择后查看月费、GMV、订单和 Keeper 指标。</div>
                          </div>
                        </div>
                      )
                    ) : activeTab === 'events' ? (
                      <EventPanel
                        onOpenCreatorChat={handleOpenCreatorChatFromEvent}
                        selectedEventId={selectedEventId}
                        onSelectedEventChange={setSelectedEventId}
                        restoreState={eventPanelRestoreState}
                      />
                    ) : activeTab === 'strategy' ? (
                      <div className="h-full overflow-y-auto p-4" style={{ background: WA.lightBg }}>
                        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 items-start">
                          <LifecycleConfigPanel embedded />
                          <StrategyConfigPanel embedded />
                        </div>
                      </div>
                    ) : activeTab === 'accounts' ? (
                      <AccountsPanel />
                    ) : activeTab === 'users' ? (
                      <UsersPanel />
                    ) : activeTab === 'ai-providers' ? (
                      <AIProvidersAdminPanel />
                    ) : (
                      <SFTDashboard compact />
                    )}
                  </div>
                </div>
              )}
            </div>
            </>
            )}
          </div>
        </div>
      </div>

      <WorkerStatusBar />

      {/* ===== Mobile: Full-screen Chat (shown when creator selected) ===== */}
      {(selectedCreator || (conversationScope === 'groups' && selectedGroupChat)) && (
        <div className="flex-1 flex flex-col md:hidden" style={{ background: WA.chatBg }}>
          {/* Mobile top bar */}
          <div className="flex items-center gap-3 px-4 py-3" style={{ background: WA.darkHeader }}>
            <button onClick={() => setMobileSidebarOpen(true)} className="text-white/70 hover:text-white text-lg shrink-0">☰</button>
            <div className="w-9 h-9 rounded-full flex items-center justify-center text-white font-bold text-sm shrink-0" style={{ background: WA.teal }}>
              {conversationScope === 'groups'
                ? '#'
                : (selectedCreator?.primary_name || '?')[0]?.toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-white truncate">{conversationScope === 'groups' ? (selectedGroupChat?.group_name || '群聊') : selectedCreator?.primary_name}</div>
              <div className="text-xs text-white/50">{conversationScope === 'groups' ? (selectedGroupChat?.session_id || '') : selectedCreator?.wa_phone}</div>
            </div>
            {conversationScope === 'creators' && (
              <button
                onClick={() => setTagsVisible(v => !v)}
                className="text-white/70 hover:text-white text-base shrink-0 px-2 py-1 rounded-lg"
                title={tagsVisible ? '隐藏标签' : '显示标签'}
              >
                🏷
              </button>
            )}
            <button onClick={handleCloseConversation} className="text-white/70 hover:text-white text-lg shrink-0">✕</button>
          </div>

          {conversationScope === 'creators' && (
            <MobileEventTagsBar
              creator={selectedCreator}
              statusMeta={selectedCreatorStatusMeta}
              visible={tagsVisible}
            />
          )}

          {/* WAMessageComposer — as panel, no internal mobile header */}
          <div className="flex-1 overflow-hidden">
            {conversationScope === 'groups' ? (
              <WAGroupChatViewer groupChat={selectedGroupChat} apiBase={API_BASE} />
            ) : (
              <WAMessageComposer
                client={{
                  id: selectedCreator.id,
                  phone: selectedCreator.wa_phone,
                  name: selectedCreator.primary_name,
                  wa_owner: selectedCreator.wa_owner,
                  conversion_stage: selectedCreator.lifecycle?.stage_key || selectedCreator.beta_status || 'unknown',
                  lifecycle_stage: selectedCreator.lifecycle?.stage_key || 'unknown',
                  lifecycle_label: selectedCreator.lifecycle?.stage_label || null,
                }}
                creator={selectedCreator}
                jumpTarget={selectedCreator?.id === chatJumpTarget?.creatorId ? chatJumpTarget : null}
                onClose={handleCloseConversation}
                onSwipeLeft={() => setMobileSidebarOpen(true)}
                onMessageSent={handleCreatorMessageSent}
                onCreatorUpdated={handleCreatorUpdated}
                asPanel
              />
            )}
          </div>
        </div>
      )}

      <ManualCreatorModal
        open={manualOpen}
        form={manualForm}
        ownerLocked={ownerLocked}
        lockedOwner={lockedOwner}
        onFormChange={setManualForm}
        onClose={closeManualModal}
        onSave={saveManualCreator}
        saving={manualSaving}
        checkLoading={manualCheckLoading}
        checkResult={manualCheck}
        error={manualError}
        mode={manualMode}
        onModeChange={setManualMode}
        bulkText={bulkText}
        onBulkTextChange={setBulkText}
        onBulkSubmit={submitBulkImport}
        bulkSaving={bulkSaving}
        bulkResults={bulkResults}
        bulkError={bulkError}
        bulkSendWelcome={bulkSendWelcome}
        onBulkSendWelcomeChange={setBulkSendWelcome}
        bulkWelcomeText={bulkWelcomeText}
        onBulkWelcomeTextChange={setBulkWelcomeText}
        bulkWelcomeTemplateKey={bulkWelcomeTemplateKey}
        onBulkWelcomeTemplateKeyChange={setBulkWelcomeTemplateKey}
        availableOwners={ownerOptions}
      />
    </div>
  )
}

function ContactManagementPage({
  ownerLocked,
  lockedOwner,
  ownerOptions,
  owner,
  onOwnerChange,
  search,
  onSearchChange,
  showInactive,
  onShowInactiveChange,
  creators,
  selectedCreatorIds,
  selectedVisibleCount,
  allVisibleSelected,
  toggleSelectAllVisible,
  clearSelectedCreators,
  toggleCreatorSelection,
  onOpenCreator,
  applyBatchActiveChange,
  batchTogglingActive,
  activeTogglingCreatorId,
  onToggleCreatorActive,
  onSaveCreatorEdit,
  form,
  onFormChange,
  onSave,
  saving,
  checkLoading,
  checkResult,
  error,
  bulkText,
  onBulkTextChange,
  onBulkSubmit,
  bulkSaving,
  bulkResults,
  bulkError,
  bulkSendWelcome,
  onBulkSendWelcomeChange,
  bulkWelcomeText,
  onBulkWelcomeTextChange,
  bulkWelcomeTemplateKey,
  onBulkWelcomeTemplateKeyChange,
  isAdmin,
  transferPreview,
  transferLoading,
  transferExecuting,
  transferError,
  onLoadTransferPreview,
  onExecuteOwnerTransfer,
  onClearTransferPreview,
}) {
  const [mode, setMode] = useState('single')
  const [transferFromOwner, setTransferFromOwner] = useState('Jiawen')
  const [transferToOwner, setTransferToOwner] = useState('Yiyun')
  const [editingCreator, setEditingCreator] = useState(null)
  const [editForm, setEditForm] = useState({ primary_name: '', wa_phone: '', wa_owner: '' })
  const [editSaving, setEditSaving] = useState(false)
  const [editError, setEditError] = useState('')
  const parsedBulkRows = useMemo(() => parseBulkCreatorRows(bulkText), [bulkText])
  const validBulkRows = useMemo(() => parsedBulkRows.filter(r => r.valid), [parsedBulkRows])
  const samePhone = checkResult?.conflicts?.same_phone || []
  const sameName = checkResult?.conflicts?.same_name || []
  const hasPhoneConflict = samePhone.length > 0
  const hasNameConflict = sameName.length > 0

  const managerOwnerOptions = (() => {
    const merged = new Set()
    for (const item of ownerOptions || []) if (item) merged.add(item)
    if (owner) merged.add(owner)
    if (form?.owner) merged.add(form.owner)
    if (lockedOwner) merged.add(lockedOwner)
    return [...merged]
  })()
  const transferOwnerOptions = (() => {
    const merged = new Set(['Jiawen', 'Yiyun'])
    for (const item of managerOwnerOptions || []) if (item) merged.add(item)
    if (transferFromOwner) merged.add(transferFromOwner)
    if (transferToOwner) merged.add(transferToOwner)
    return [...merged]
  })()
  const editOwnerOptions = (() => {
    const merged = new Set(managerOwnerOptions)
    if (editForm.wa_owner) merged.add(editForm.wa_owner)
    if (editingCreator?.wa_owner) merged.add(editingCreator.wa_owner)
    if (lockedOwner) merged.add(lockedOwner)
    return [...merged].filter(Boolean)
  })()
  const openEditCreator = (creator) => {
    setEditingCreator(creator)
    setEditForm({
      primary_name: creator?.primary_name || '',
      wa_phone: creator?.wa_phone || '',
      wa_owner: creator?.wa_owner || lockedOwner || owner || '',
    })
    setEditError('')
  }
  const closeEditCreator = () => {
    if (editSaving) return
    setEditingCreator(null)
    setEditError('')
  }
  const submitEditCreator = async () => {
    if (!editingCreator?.id) return
    const payload = {
      primary_name: String(editForm.primary_name || '').trim(),
      wa_phone: String(editForm.wa_phone || '').trim(),
      wa_owner: String(editForm.wa_owner || '').trim(),
    }
    if (!payload.primary_name || !payload.wa_phone || !payload.wa_owner) {
      setEditError('姓名、电话和负责人都不能为空')
      return
    }
    setEditSaving(true)
    setEditError('')
    try {
      await onSaveCreatorEdit?.(editingCreator.id, payload)
      setEditingCreator(null)
    } catch (e) {
      setEditError(e.message || '保存失败')
    } finally {
      setEditSaving(false)
    }
  }

  return (
    <div className="flex-1 min-w-0 docs-panel overflow-hidden flex flex-col" style={{ background: WA.shellPanelStrong }}>
      <div className="shrink-0 px-6 py-5 border-b" style={{ borderColor: WA.shellBorder }}>
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="docs-kicker">Contacts</div>
            <div className="text-[28px] leading-none font-semibold" style={{ color: WA.textDark }}>联系人管理</div>
            <div className="text-sm mt-2" style={{ color: WA.textMuted }}>
              新增、批量导入、按 owner 解绑或恢复达人联系人。
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <div className="px-3 py-2 rounded-full text-xs font-medium" style={{ background: WA.shellPanelMuted, color: WA.textMuted }}>
              当前: <span style={{ color: WA.textDark }}>{owner || '未选择 owner'}</span>
            </div>
            <div className="px-3 py-2 rounded-full text-xs font-medium" style={{ background: WA.shellPanelMuted, color: WA.textMuted }}>
              列表: <span style={{ color: WA.textDark }}>{creators.length}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto docs-scrollbar p-5" style={{ background: WA.shellPanel }}>
        <div className="grid grid-cols-1 xl:grid-cols-[minmax(420px,520px)_1fr] gap-5 items-start">
          <div className="space-y-4">
            <div className="docs-panel-strong p-4 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="docs-kicker">Owner</div>
                  <div className="text-sm font-semibold mt-1" style={{ color: WA.textDark }}>负责人范围</div>
                </div>
                <select
                  value={owner}
                  onChange={e => onOwnerChange?.(e.target.value)}
                  disabled={ownerLocked}
                  className="px-3 py-2 rounded-xl border text-sm focus:outline-none min-w-40"
                  style={{ borderColor: WA.borderLight, color: WA.textDark, background: ownerLocked ? WA.lightBg : WA.white }}
                >
                  {!ownerLocked && !owner && <option value="">请选择 owner</option>}
                  {ownerLocked ? (
                    <option value={lockedOwner}>{lockedOwner}</option>
                  ) : managerOwnerOptions.map(item => (
                    <option key={item} value={item}>{item}</option>
                  ))}
                </select>
              </div>
              <div className="flex items-center gap-2 overflow-x-auto docs-scrollbar pb-1">
                {managerOwnerOptions.map(item => (
                  <button
                    key={item}
                    type="button"
                    onClick={() => !ownerLocked && onOwnerChange?.(item)}
                    className="shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold"
                    style={{
                      background: owner === item ? WA.shellActive : WA.white,
                      color: owner === item ? WA.textDark : WA.textMuted,
                      border: `1px solid ${owner === item ? WA.shellBorderStrong : WA.borderLight}`,
                      opacity: ownerLocked ? 0.9 : 1,
                    }}
                  >
                    {item}
                  </button>
                ))}
              </div>
            </div>

            {isAdmin && !ownerLocked && (
              <div className="docs-panel-strong p-4 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="docs-kicker">Transfer</div>
                    <div className="text-sm font-semibold mt-1" style={{ color: WA.textDark }}>联系人迁移</div>
                    <div className="text-xs mt-1" style={{ color: WA.textMuted }}>
                      批量调整联系人 owner 归属，保留历史消息。
                    </div>
                  </div>
                  {transferPreview && (
                    <span className="px-2.5 py-1 rounded-full text-xs font-semibold" style={{ background: WA.shellAccentSoft, color: WA.teal }}>
                      {transferPreview.creator_count || 0} 位
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-[1fr_auto_1fr] gap-2 items-end">
                  <label className="text-xs space-y-1">
                    <span style={{ color: WA.textMuted }}>来源</span>
                    <select
                      value={transferFromOwner}
                      onChange={e => {
                        setTransferFromOwner(e.target.value)
                        onClearTransferPreview?.()
                      }}
                      disabled={transferLoading || transferExecuting}
                      className="w-full px-3 py-2 rounded-lg border text-sm focus:outline-none"
                      style={{ borderColor: WA.borderLight, color: WA.textDark, background: WA.white }}
                    >
                      {transferOwnerOptions.map(item => (
                        <option key={item} value={item}>{item}</option>
                      ))}
                    </select>
                  </label>
                  <div className="pb-2 text-sm" style={{ color: WA.textMuted }}>→</div>
                  <label className="text-xs space-y-1">
                    <span style={{ color: WA.textMuted }}>目标</span>
                    <select
                      value={transferToOwner}
                      onChange={e => {
                        setTransferToOwner(e.target.value)
                        onClearTransferPreview?.()
                      }}
                      disabled={transferLoading || transferExecuting}
                      className="w-full px-3 py-2 rounded-lg border text-sm focus:outline-none"
                      style={{ borderColor: WA.borderLight, color: WA.textDark, background: WA.white }}
                    >
                      {transferOwnerOptions.map(item => (
                        <option key={item} value={item}>{item}</option>
                      ))}
                    </select>
                  </label>
                </div>

                {transferPreview && (
                  <div className="rounded-xl border p-3 text-xs space-y-1" style={{ borderColor: WA.borderLight, background: WA.lightBg }}>
                    <div style={{ color: WA.textDark }}>
                      {transferPreview.from_owner} → {transferPreview.to_owner}
                    </div>
                    <div style={{ color: WA.textMuted }}>
                      活跃 {transferPreview.active_creator_count || 0} / 全部 {transferPreview.creator_count || 0} 位联系人
                    </div>
                    <div style={{ color: WA.textMuted }}>
                      roster {transferPreview.roster_count || 0} 条 · 事件 {transferPreview.event_count || 0} 条 · session {transferPreview.target_session_id || '-'}
                    </div>
                  </div>
                )}

                {transferError && (
                  <div className="text-xs px-3 py-2 rounded-lg" style={{ background: 'rgba(239,68,68,0.08)', color: '#ef4444' }}>
                    {transferError}
                  </div>
                )}

                <div className="flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => onLoadTransferPreview?.({ fromOwner: transferFromOwner, toOwner: transferToOwner })}
                    disabled={transferLoading || transferExecuting || transferFromOwner === transferToOwner}
                    className="px-3 py-2 rounded-lg text-xs font-semibold disabled:opacity-50"
                    style={{ border: `1px solid ${WA.borderLight}`, color: WA.textMuted, background: WA.white }}
                  >
                    {transferLoading ? '读取中...' : '预览'}
                  </button>
                  <button
                    type="button"
                    onClick={() => onExecuteOwnerTransfer?.({ fromOwner: transferFromOwner, toOwner: transferToOwner })}
                    disabled={transferLoading || transferExecuting || transferFromOwner === transferToOwner}
                    className="px-3 py-2 rounded-lg text-xs font-semibold text-white disabled:opacity-50"
                    style={{ background: WA.teal }}
                  >
                    {transferExecuting ? '迁移中...' : '确认迁移'}
                  </button>
                </div>
              </div>
            )}

            <div className="docs-panel-strong p-4 space-y-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="docs-kicker">Create</div>
                  <div className="text-sm font-semibold mt-1" style={{ color: WA.textDark }}>
                    {mode === 'bulk' ? '批量导入联系人' : '新增单个联系人'}
                  </div>
                </div>
                <div className="inline-flex rounded-full p-1" style={{ background: WA.shellPanelMuted }}>
                  {[
                    { key: 'single', label: '单个' },
                    { key: 'bulk', label: '批量' },
                  ].map(item => (
                    <button
                      key={item.key}
                      type="button"
                      onClick={() => setMode(item.key)}
                      className="px-3 py-1.5 rounded-full text-xs font-semibold"
                      style={{
                        background: mode === item.key ? WA.white : 'transparent',
                        color: mode === item.key ? WA.textDark : WA.textMuted,
                        border: `1px solid ${mode === item.key ? WA.borderLight : 'transparent'}`,
                      }}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>

              {mode === 'bulk' ? (
                <BulkImportSection
                  ownerLocked={ownerLocked}
                  lockedOwner={lockedOwner}
                  ownerOptions={managerOwnerOptions}
                  owner={owner}
                  onOwnerChange={onOwnerChange}
                  text={bulkText}
                  onTextChange={onBulkTextChange}
                  parsedRows={parsedBulkRows}
                  validRows={validBulkRows}
                  onSubmit={() => onBulkSubmit && onBulkSubmit(validBulkRows)}
                  saving={bulkSaving}
                  results={bulkResults}
                  error={bulkError}
                  sendWelcome={bulkSendWelcome}
                  onSendWelcomeChange={onBulkSendWelcomeChange}
                  welcomeText={bulkWelcomeText}
                  onWelcomeTextChange={onBulkWelcomeTextChange}
                  welcomeTemplateKey={bulkWelcomeTemplateKey}
                  onWelcomeTemplateKeyChange={onBulkWelcomeTemplateKeyChange}
                  onClose={() => setMode('single')}
                />
              ) : (
                <div className="space-y-3">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <label className="md:col-span-2 text-xs space-y-1">
                      <span style={{ color: WA.textMuted }}>达人姓名</span>
                      <input
                        value={form.name}
                        onChange={e => onFormChange(prev => ({ ...prev, name: e.target.value }))}
                        placeholder="如：Katie"
                        className="w-full px-3 py-2 rounded-lg border text-sm focus:outline-none"
                        style={{ borderColor: WA.borderLight, color: WA.textDark }}
                      />
                    </label>
                    <label className="text-xs space-y-1">
                      <span style={{ color: WA.textMuted }}>负责人</span>
                      <select
                        value={form.owner}
                        onChange={e => onFormChange(prev => ({ ...prev, owner: e.target.value }))}
                        disabled={ownerLocked}
                        className="w-full px-3 py-2 rounded-lg border text-sm focus:outline-none"
                        style={{ borderColor: WA.borderLight, color: WA.textDark, background: ownerLocked ? WA.lightBg : WA.white }}
                      >
                        {ownerLocked ? (
                          <option value={lockedOwner}>{lockedOwner}</option>
                        ) : (
                          <>
                            {!form.owner && <option value="">请选择负责人</option>}
                            {managerOwnerOptions.map(item => (
                              <option key={item} value={item}>{item}</option>
                            ))}
                          </>
                        )}
                      </select>
                    </label>
                    <label className="md:col-span-3 text-xs space-y-1">
                      <span style={{ color: WA.textMuted }}>WhatsApp 手机号</span>
                      <input
                        value={form.phone}
                        onChange={e => onFormChange(prev => ({ ...prev, phone: e.target.value }))}
                        placeholder="如：+1 (318) 701-2419"
                        className="w-full px-3 py-2 rounded-lg border text-sm focus:outline-none"
                        style={{ borderColor: WA.borderLight, color: WA.textDark }}
                      />
                    </label>
                  </div>

                  <div className="rounded-xl border p-3 text-xs space-y-2" style={{ borderColor: WA.borderLight, background: WA.lightBg }}>
                    {checkLoading ? (
                      <div style={{ color: WA.textMuted }}>去重检查中...</div>
                    ) : checkResult?.ok === false ? (
                      <div style={{ color: '#ef4444' }}>去重检查失败：{checkResult.error || 'unknown error'}</div>
                    ) : (
                      <>
                        <div style={{ color: hasPhoneConflict ? '#ef4444' : '#10b981' }}>
                          同号检查：{hasPhoneConflict ? `发现 ${samePhone.length} 条重复（将复用现有达人）` : '未发现重复手机号'}
                        </div>
                        <div style={{ color: hasNameConflict ? '#f59e0b' : WA.textMuted }}>
                          重名检查：{hasNameConflict ? `发现 ${sameName.length} 条相似姓名` : '未发现相似姓名'}
                        </div>
                      </>
                    )}
                  </div>

                  {error && (
                    <div className="text-xs px-3 py-2 rounded-lg" style={{ background: 'rgba(239,68,68,0.08)', color: '#ef4444' }}>
                      {error}
                    </div>
                  )}

                  <div className="flex justify-end">
                    <button
                      onClick={onSave}
                      disabled={saving || !form.name?.trim() || !form.phone?.trim() || !form.owner?.trim()}
                      className="px-4 py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-50"
                      style={{ background: WA.teal }}
                    >
                      {saving ? '保存中...' : '保存并建档'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="docs-panel-strong overflow-hidden">
            <div className="p-4 border-b space-y-3" style={{ borderColor: WA.shellBorder }}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="docs-kicker">Directory</div>
                  <div className="text-lg font-semibold mt-1" style={{ color: WA.textDark }}>
                    {showInactive ? '已解绑联系人' : '活跃联系人'}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => onShowInactiveChange(false)}
                    className="px-3 py-1.5 rounded-full text-xs font-semibold"
                    style={{
                      background: !showInactive ? WA.shellActive : WA.white,
                      color: !showInactive ? WA.textDark : WA.textMuted,
                      border: `1px solid ${!showInactive ? WA.shellBorderStrong : WA.borderLight}`,
                    }}
                  >
                    活跃
                  </button>
                  <button
                    type="button"
                    onClick={() => onShowInactiveChange(true)}
                    className="px-3 py-1.5 rounded-full text-xs font-semibold"
                    style={{
                      background: showInactive ? WA.shellActive : WA.white,
                      color: showInactive ? WA.textDark : WA.textMuted,
                      border: `1px solid ${showInactive ? WA.shellBorderStrong : WA.borderLight}`,
                    }}
                  >
                    已解绑
                  </button>
                </div>
              </div>
              <div className="flex items-center gap-3 px-3.5 py-2.5 rounded-2xl" style={{ background: WA.white, border: `1px solid ${WA.borderLight}` }}>
                <span style={{ color: WA.textMuted }}>🔍</span>
                <input
                  type="text"
                  value={search}
                  onChange={e => onSearchChange?.(e.target.value)}
                  placeholder="搜索姓名、电话、Keeper..."
                  className="flex-1 bg-transparent text-sm focus:outline-none"
                  style={{ color: WA.textDark }}
                />
                {search && <button onClick={() => onSearchChange?.('')} style={{ color: WA.textMuted }}>✕</button>}
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <label className="flex items-center gap-2 text-xs" style={{ color: WA.textMuted }}>
                  <input type="checkbox" checked={allVisibleSelected} onChange={toggleSelectAllVisible} />
                  <span>全选当前 {creators.length} 位</span>
                </label>
                <div className="flex items-center gap-2">
                  {selectedVisibleCount > 0 && (
                    <button
                      type="button"
                      onClick={clearSelectedCreators}
                      className="px-2.5 py-1.5 rounded-full text-xs font-medium"
                      style={{ border: `1px solid ${WA.borderLight}`, color: WA.textMuted, background: WA.white }}
                    >
                      清空
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={applyBatchActiveChange}
                    disabled={selectedVisibleCount === 0 || batchTogglingActive || (!ownerLocked && !owner)}
                    className="px-3 py-1.5 rounded-full text-xs font-semibold text-white disabled:opacity-50"
                    style={{ background: batchTogglingActive ? '#9ca3af' : (showInactive ? WA.teal : '#dc2626') }}
                  >
                    {batchTogglingActive
                      ? '处理中...'
                      : `${showInactive ? '批量恢复' : '批量解绑'}${selectedVisibleCount > 0 ? ` (${selectedVisibleCount})` : ''}`}
                  </button>
                </div>
              </div>
            </div>

            <div className="max-h-[calc(100vh-320px)] overflow-y-auto docs-scrollbar">
              {creators.length === 0 ? (
                <div className="py-16 text-center text-sm" style={{ color: WA.textMuted }}>没有找到联系人</div>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr style={{ color: WA.textMuted, background: WA.shellPanelMuted }}>
                      <th className="text-left px-4 py-3 font-medium w-10"></th>
                      <th className="text-left px-4 py-3 font-medium">联系人</th>
                      <th className="text-left px-4 py-3 font-medium">owner</th>
                      <th className="text-left px-4 py-3 font-medium">消息</th>
                      <th className="text-left px-4 py-3 font-medium">状态</th>
                      <th className="text-right px-4 py-3 font-medium">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {creators.map(creator => (
                      <tr key={creator.id} className="border-t" style={{ borderColor: WA.borderLight }}>
                        <td className="px-4 py-3">
                          <input
                            type="checkbox"
                            checked={selectedCreatorIds.includes(creator.id)}
                            onChange={() => toggleCreatorSelection?.(creator.id)}
                          />
                        </td>
                        <td className="px-4 py-3">
                          <div className="font-semibold" style={{ color: WA.textDark }}>{creator.primary_name || 'Unknown'}</div>
                          <div className="text-xs font-mono mt-1" style={{ color: WA.textMuted }}>{creator.wa_phone || '-'}</div>
                        </td>
                        <td className="px-4 py-3">
                          <span className="px-2 py-1 rounded-full text-xs font-semibold" style={{ background: WA.shellAccentSoft, color: WA.teal }}>
                            {creator.wa_owner || '-'}
                          </span>
                        </td>
                        <td className="px-4 py-3" style={{ color: WA.textMuted }}>{creator.msg_count || 0}</td>
                        <td className="px-4 py-3">
                          <span className="px-2 py-1 rounded-full text-xs font-semibold" style={{
                            background: showInactive ? 'rgba(220,38,38,0.08)' : 'rgba(0,168,132,0.10)',
                            color: showInactive ? '#dc2626' : WA.teal,
                          }}>
                            {showInactive ? '已解绑' : '活跃'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => openEditCreator(creator)}
                              disabled={editSaving}
                              className="px-3 py-1.5 rounded-full text-xs font-semibold disabled:opacity-50"
                              style={{ border: `1px solid ${WA.borderLight}`, color: WA.textMuted, background: WA.white }}
                            >
                              编辑
                            </button>
                            <button
                              type="button"
                              onClick={() => onToggleCreatorActive?.(creator)}
                              disabled={batchTogglingActive || activeTogglingCreatorId === creator.id}
                              className="px-3 py-1.5 rounded-full text-xs font-semibold text-white disabled:opacity-50"
                              style={{ background: activeTogglingCreatorId === creator.id ? '#9ca3af' : (showInactive ? WA.teal : '#dc2626') }}
                            >
                              {activeTogglingCreatorId === creator.id
                                ? '处理中...'
                                : (showInactive ? '恢复' : '解绑')}
                            </button>
                            <button
                              type="button"
                              onClick={() => onOpenCreator?.(creator)}
                              className="px-3 py-1.5 rounded-full text-xs font-semibold"
                              style={{ border: `1px solid ${WA.borderLight}`, color: WA.textMuted, background: WA.white }}
                            >
                              打开
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      </div>
      {editingCreator && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4 py-6" style={{ background: 'rgba(31,29,26,0.42)' }} onMouseDown={closeEditCreator}>
          <div
            className="w-full max-w-3xl rounded-2xl shadow-2xl overflow-hidden"
            style={{ background: WA.shellPanelStrong, border: `1px solid ${WA.shellBorder}` }}
            onMouseDown={e => e.stopPropagation()}
          >
            <div className="px-6 py-4 border-b flex items-center justify-between gap-3" style={{ borderColor: WA.shellBorder, background: WA.white }}>
              <div>
                <div className="docs-kicker">Edit Contact</div>
                <div className="text-lg font-semibold mt-1" style={{ color: WA.textDark }}>编辑达人</div>
              </div>
              <button
                type="button"
                onClick={closeEditCreator}
                disabled={editSaving}
                className="w-9 h-9 rounded-full text-lg disabled:opacity-50"
                style={{ border: `1px solid ${WA.borderLight}`, color: WA.textMuted, background: WA.white }}
                aria-label="关闭编辑弹窗"
              >
                ×
              </button>
            </div>
            <div className="p-6 space-y-5" style={{ background: WA.shellPanel }}>
              <label className="block text-sm space-y-2">
                <span style={{ color: WA.textMuted }}>姓名</span>
                <input
                  value={editForm.primary_name}
                  onChange={e => setEditForm(prev => ({ ...prev, primary_name: e.target.value }))}
                  className="w-full px-4 py-3 rounded-2xl border text-base focus:outline-none"
                  style={{ borderColor: WA.borderLight, color: WA.textDark, background: WA.white }}
                  autoFocus
                />
              </label>
              <label className="block text-sm space-y-2">
                <span style={{ color: WA.textMuted }}>电话</span>
                <input
                  value={editForm.wa_phone}
                  onChange={e => setEditForm(prev => ({ ...prev, wa_phone: e.target.value }))}
                  className="w-full px-4 py-3 rounded-2xl border text-base focus:outline-none"
                  style={{ borderColor: WA.borderLight, color: WA.textDark, background: WA.white }}
                />
              </label>
              <label className="block text-sm space-y-2">
                <span style={{ color: WA.textMuted }}>负责人</span>
                <select
                  value={editForm.wa_owner}
                  onChange={e => setEditForm(prev => ({ ...prev, wa_owner: e.target.value }))}
                  disabled={ownerLocked}
                  className="w-full px-4 py-3 rounded-2xl border text-base focus:outline-none"
                  style={{ borderColor: WA.borderLight, color: WA.textDark, background: ownerLocked ? WA.lightBg : WA.white }}
                >
                  {!editForm.wa_owner && <option value="">请选择负责人</option>}
                  {editOwnerOptions.map(item => (
                    <option key={item} value={item}>{item}</option>
                  ))}
                </select>
              </label>
              {editError && (
                <div className="text-sm px-3 py-2 rounded-lg" style={{ background: 'rgba(239,68,68,0.08)', color: '#ef4444' }}>
                  {editError}
                </div>
              )}
            </div>
            <div className="px-6 py-4 border-t flex items-center justify-end gap-2" style={{ borderColor: WA.shellBorder, background: WA.white }}>
              <button
                type="button"
                onClick={closeEditCreator}
                disabled={editSaving}
                className="px-4 py-2 rounded-lg text-sm font-semibold disabled:opacity-50"
                style={{ border: `1px solid ${WA.borderLight}`, color: WA.textMuted, background: WA.white }}
              >
                取消
              </button>
              <button
                type="button"
                onClick={submitEditCreator}
                disabled={editSaving || !editForm.primary_name.trim() || !editForm.wa_phone.trim() || !editForm.wa_owner.trim()}
                className="px-4 py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-50"
                style={{ background: WA.teal }}
              >
                {editSaving ? '保存中...' : '保存'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function parseBulkCreatorRows(text) {
  const lines = String(text || '').split(/\r?\n/)
  const rows = []
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]
    const line = raw.trim()
    if (!line) continue
    let name = ''
    let phone = ''
    if (line.includes('\t')) {
      const parts = line.split('\t').map(s => s.trim()).filter(Boolean)
      if (parts.length >= 2) {
        name = parts[0]
        phone = parts.slice(1).join(' ')
      } else {
        name = parts[0] || ''
      }
    } else {
      const m = line.match(/^(.+?)\s{2,}(.+)$/)
      if (m) {
        name = m[1].trim()
        phone = m[2].trim()
      } else {
        const m2 = line.match(/^(.*?)([+\d][\d()\-\s+]{6,})$/)
        if (m2) {
          name = m2[1].trim()
          phone = m2[2].trim()
        } else {
          name = line
        }
      }
    }
    const rawDigits = phone.replace(/\D/g, '')
    const digits = rawDigits.length === 10 ? `1${rawDigits}` : rawDigits
    rows.push({
      lineNo: i + 1,
      raw: line,
      name,
      phone: digits || phone,
      digits,
      valid: Boolean(name) && digits.length >= 7,
      reason: !name ? '缺少姓名' : (digits.length < 7 ? '缺少有效手机号' : ''),
    })
  }
  return rows
}

function ManualCreatorModal({
  open,
  form,
  ownerLocked,
  lockedOwner,
  onFormChange,
  onClose,
  onSave,
  saving,
  checkLoading,
  checkResult,
  error,
  mode = 'single',
  onModeChange,
  bulkText = '',
  onBulkTextChange,
  onBulkSubmit,
  bulkSaving,
  bulkResults,
  bulkError,
  bulkSendWelcome,
  onBulkSendWelcomeChange,
  bulkWelcomeText,
  onBulkWelcomeTextChange,
  bulkWelcomeTemplateKey,
  onBulkWelcomeTemplateKeyChange,
  availableOwners,
}) {
  const { owners: rosterOwners } = useOperatorRoster()

  const parsedBulkRows = useMemo(() => parseBulkCreatorRows(bulkText), [bulkText])
  const validBulkRows = useMemo(() => parsedBulkRows.filter(r => r.valid), [parsedBulkRows])

  if (!open) return null

  const ownerOptions = (() => {
    const merged = new Set()
    for (const o of (availableOwners || [])) {
      if (o) merged.add(o)
    }
    for (const o of (rosterOwners || [])) {
      if (o) merged.add(o)
    }
    if (form?.owner) merged.add(form.owner)
    return [...merged]
  })()

  const samePhone = checkResult?.conflicts?.same_phone || []
  const sameName = checkResult?.conflicts?.same_name || []
  const hasPhoneConflict = samePhone.length > 0
  const hasNameConflict = sameName.length > 0

  const isBulk = mode === 'bulk'

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/45" onClick={onClose} />
      <div className="relative w-full max-w-2xl rounded-2xl border shadow-2xl p-5 space-y-4 max-h-[90vh] overflow-y-auto" style={{ background: WA.white, borderColor: WA.borderLight }}>
        <div className="flex items-center justify-between">
          <div>
            <div className="text-base font-semibold" style={{ color: WA.textDark }}>{isBulk ? '批量导入达人' : '手动录入达人'}</div>
            <div className="text-xs mt-1" style={{ color: WA.textMuted }}>
              {isBulk ? '粘贴姓名+电话，每行一条；同号自动复用现有达人' : '录入前自动检查同号与重名，防止重复建档'}
            </div>
          </div>
          <button onClick={onClose} className="text-lg px-2 py-1 rounded-lg" style={{ color: WA.textMuted }}>✕</button>
        </div>

        {onModeChange && (
          <div className="inline-flex rounded-lg border overflow-hidden" style={{ borderColor: WA.borderLight }}>
            {[
              { key: 'single', label: '单个录入' },
              { key: 'bulk', label: 'CSV 批量导入' },
            ].map(t => (
              <button
                key={t.key}
                type="button"
                onClick={() => !saving && !bulkSaving && onModeChange(t.key)}
                className="px-3 py-1.5 text-xs font-medium"
                style={{
                  background: mode === t.key ? WA.teal : 'transparent',
                  color: mode === t.key ? 'white' : WA.textMuted,
                }}
              >
                {t.label}
              </button>
            ))}
          </div>
        )}

        {isBulk ? (
          <BulkImportSection
            ownerLocked={ownerLocked}
            lockedOwner={lockedOwner}
            ownerOptions={ownerOptions}
            owner={form?.owner || ''}
            onOwnerChange={(value) => onFormChange(prev => ({ ...prev, owner: value }))}
            text={bulkText}
            onTextChange={onBulkTextChange}
            parsedRows={parsedBulkRows}
            validRows={validBulkRows}
            onSubmit={() => onBulkSubmit && onBulkSubmit(validBulkRows)}
            saving={bulkSaving}
            results={bulkResults}
            error={bulkError}
            sendWelcome={bulkSendWelcome}
            onSendWelcomeChange={onBulkSendWelcomeChange}
            welcomeText={bulkWelcomeText}
            onWelcomeTextChange={onBulkWelcomeTextChange}
            welcomeTemplateKey={bulkWelcomeTemplateKey}
            onWelcomeTemplateKeyChange={onBulkWelcomeTemplateKeyChange}
            onClose={onClose}
          />
        ) : (
        <>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <label className="md:col-span-2 text-xs space-y-1">
            <span style={{ color: WA.textMuted }}>达人姓名</span>
            <input
              value={form.name}
              onChange={e => onFormChange(prev => ({ ...prev, name: e.target.value }))}
              placeholder="如：Katie"
              className="w-full px-3 py-2 rounded-lg border text-sm focus:outline-none"
              style={{ borderColor: WA.borderLight, color: WA.textDark }}
            />
          </label>
          <label className="text-xs space-y-1">
            <span style={{ color: WA.textMuted }}>负责人</span>
            <select
              value={form.owner}
              onChange={e => onFormChange(prev => ({ ...prev, owner: e.target.value }))}
              disabled={ownerLocked}
              className="w-full px-3 py-2 rounded-lg border text-sm focus:outline-none"
              style={{ borderColor: WA.borderLight, color: WA.textDark, background: ownerLocked ? WA.lightBg : WA.white }}
            >
              {ownerLocked ? (
                <option value={lockedOwner}>{lockedOwner}</option>
              ) : (
                <>
                  {!form.owner && <option value="">请选择负责人</option>}
                  {ownerOptions.map(owner => (
                    <option key={owner} value={owner}>{owner}</option>
                  ))}
                </>
              )}
            </select>
          </label>
          <label className="md:col-span-3 text-xs space-y-1">
            <span style={{ color: WA.textMuted }}>WhatsApp 手机号</span>
            <input
              value={form.phone}
              onChange={e => onFormChange(prev => ({ ...prev, phone: e.target.value }))}
              placeholder="如：+1 (318) 701-2419"
              className="w-full px-3 py-2 rounded-lg border text-sm focus:outline-none"
              style={{ borderColor: WA.borderLight, color: WA.textDark }}
            />
          </label>
        </div>

        <div className="rounded-xl border p-3 text-xs space-y-2" style={{ borderColor: WA.borderLight, background: WA.lightBg }}>
          {checkLoading ? (
            <div style={{ color: WA.textMuted }}>去重检查中...</div>
          ) : checkResult?.ok === false ? (
            <div style={{ color: '#ef4444' }}>去重检查失败：{checkResult.error || 'unknown error'}</div>
          ) : (
            <>
              <div style={{ color: hasPhoneConflict ? '#ef4444' : '#10b981' }}>
                同号检查：{hasPhoneConflict ? `发现 ${samePhone.length} 条重复（将复用现有达人）` : '未发现重复手机号'}
              </div>
              <div style={{ color: hasNameConflict ? '#f59e0b' : WA.textMuted }}>
                重名检查：{hasNameConflict ? `发现 ${sameName.length} 条相似姓名` : '未发现相似姓名'}
              </div>
              {(hasPhoneConflict || hasNameConflict) && (
                <div className="max-h-28 overflow-y-auto space-y-1 pr-1">
                  {[...samePhone, ...sameName.filter(item => !samePhone.some(sp => sp.id === item.id))]
                    .slice(0, 6)
                    .map(item => (
                      <div key={item.id} className="px-2 py-1 rounded" style={{ background: WA.white, color: WA.textDark }}>
                        #{item.id} · {item.primary_name || 'Unknown'} · {item.wa_phone || '-'} · {item.wa_owner || '-'}
                      </div>
                    ))}
                </div>
              )}
            </>
          )}
        </div>

        {error && (
          <div className="text-xs px-3 py-2 rounded-lg" style={{ background: 'rgba(239,68,68,0.08)', color: '#ef4444' }}>
            {error}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            disabled={saving}
            className="px-3 py-2 rounded-lg text-sm border"
            style={{ borderColor: WA.borderLight, color: WA.textMuted }}
          >
            取消
          </button>
          <button
            onClick={onSave}
            disabled={saving || !form.name?.trim() || !form.phone?.trim() || !form.owner?.trim()}
            className="px-4 py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-50"
            style={{ background: WA.teal }}
          >
            {saving ? '保存中...' : '保存并建档'}
          </button>
        </div>
        </>
        )}
      </div>
    </div>
  )
}

function BulkImportSection({
  ownerLocked,
  lockedOwner,
  ownerOptions,
  owner,
  onOwnerChange,
  text,
  onTextChange,
  parsedRows,
  validRows,
  onSubmit,
  saving,
  results,
  error,
  sendWelcome,
  onSendWelcomeChange,
  welcomeText,
  onWelcomeTextChange,
  welcomeTemplateKey,
  onWelcomeTemplateKeyChange,
  onClose,
}) {
  const total = parsedRows.length
  const validCount = validRows.length
  const invalidCount = total - validCount
  const summary = results?.summary
  const summaryRows = results?.results || []
  const [templates, setTemplates] = useState([])
  const [templateLoading, setTemplateLoading] = useState(false)
  const [templateError, setTemplateError] = useState('')
  const [templateSaving, setTemplateSaving] = useState(false)
  const selectedTemplateKey = welcomeTemplateKey || 'welcome'

  useEffect(() => {
    if (!sendWelcome || !owner) {
      setTemplates([])
      setTemplateError('')
      return
    }
    let cancelled = false
    const load = async () => {
      setTemplateLoading(true)
      setTemplateError('')
      try {
        const params = new URLSearchParams({ owner })
        const data = await fetchJsonOrThrow(`${API_BASE}/creator-import-batches/outreach-templates?${params.toString()}`)
        if (cancelled) return
        const rows = Array.isArray(data?.templates) ? data.templates : []
        setTemplates(rows)
        const preferred = rows.find(t => t.template_key === selectedTemplateKey) || rows.find(t => t.template_key === 'welcome') || rows[0]
        if (preferred) {
          onWelcomeTemplateKeyChange?.(preferred.template_key || 'welcome')
          if (!welcomeText?.trim()) onWelcomeTextChange?.(preferred.body || '')
        }
      } catch (e) {
        if (!cancelled) setTemplateError(e.message || '模板加载失败')
      } finally {
        if (!cancelled) setTemplateLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [owner, sendWelcome])

  const selectedTemplate = templates.find(t => t.template_key === selectedTemplateKey) || null

  const applySelectedTemplate = useCallback((key) => {
    const next = templates.find(t => t.template_key === key)
    onWelcomeTemplateKeyChange?.(key || 'welcome')
    if (next?.body) onWelcomeTextChange?.(next.body)
  }, [templates, onWelcomeTemplateKeyChange, onWelcomeTextChange])

  const saveWelcomeTemplate = useCallback(async () => {
    if (!owner || !welcomeText?.trim()) return
    setTemplateSaving(true)
    setTemplateError('')
    try {
      const data = await fetchJsonOrThrow(`${API_BASE}/creator-import-batches/outreach-templates`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          owner,
          template_key: selectedTemplateKey || 'welcome',
          label: selectedTemplate?.label || 'Welcome',
          body: welcomeText.trim(),
          is_active: true,
        }),
      })
      const saved = data?.template
      setTemplates(prev => {
        const rest = prev.filter(t => t.template_key !== saved?.template_key)
        return saved ? [saved, ...rest] : prev
      })
      if (saved?.template_key) onWelcomeTemplateKeyChange?.(saved.template_key)
    } catch (e) {
      setTemplateError(e.message || '模板保存失败')
    } finally {
      setTemplateSaving(false)
    }
  }, [owner, onWelcomeTemplateKeyChange, selectedTemplate?.label, selectedTemplateKey, welcomeText])

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <label className="md:col-span-1 text-xs space-y-1">
          <span style={{ color: WA.textMuted }}>负责人</span>
          <select
            value={owner}
            onChange={e => onOwnerChange(e.target.value)}
            disabled={ownerLocked || saving}
            className="w-full px-3 py-2 rounded-lg border text-sm focus:outline-none"
            style={{ borderColor: WA.borderLight, color: WA.textDark, background: ownerLocked ? WA.lightBg : WA.white }}
          >
            {ownerLocked ? (
              <option value={lockedOwner}>{lockedOwner}</option>
            ) : (
              <>
                {!owner && <option value="">请选择负责人</option>}
                {ownerOptions.map(o => (
                  <option key={o} value={o}>{o}</option>
                ))}
              </>
            )}
          </select>
        </label>
        <div className="md:col-span-2 text-xs flex items-end" style={{ color: WA.textMuted }}>
          支持每行一条，姓名和电话之间可用 Tab、逗号或多个空格分隔。
        </div>
      </div>

      <label className="text-xs space-y-1 block">
        <span style={{ color: WA.textMuted }}>粘贴 CSV / 列表（每行 = 姓名 + 电话）</span>
        <textarea
          value={text}
          onChange={e => onTextChange(e.target.value)}
          rows={8}
          disabled={saving}
          placeholder={'TikTok Tay\t(410) 801-0355\nMarie Lee\t(646) 660-3256\nKerrie Cook\t(717) 847-7055'}
          className="w-full px-3 py-2 rounded-lg border text-sm focus:outline-none font-mono"
          style={{ borderColor: WA.borderLight, color: WA.textDark }}
        />
      </label>

      <div className="rounded-xl border p-3 space-y-3" style={{ borderColor: WA.borderLight, background: WA.lightBg }}>
        <div className="space-y-1">
          <label className="flex items-center gap-2 text-xs" style={{ color: WA.textDark }}>
            <input
              type="checkbox"
              checked={!!sendWelcome}
              onChange={e => onSendWelcomeChange?.(e.target.checked)}
              disabled={saving}
            />
            <span className="font-semibold">发送欢迎消息</span>
            <span
              className="px-2 py-0.5 rounded-full text-[11px]"
              style={{
                color: sendWelcome ? WA.teal : WA.textMuted,
                background: sendWelcome ? 'rgba(15,118,110,0.10)' : WA.white,
                border: `1px solid ${sendWelcome ? 'rgba(15,118,110,0.18)' : WA.borderLight}`,
              }}
            >
              {sendWelcome ? '已开启' : '已关闭'}
            </span>
          </label>
          <div className="text-[11px]" style={{ color: WA.textMuted }}>
            关闭时只导入/绑定 owner，不发送消息，适合已经手动欢迎过但还未入库的历史达人。
          </div>
        </div>
        {sendWelcome && (
          <>
            <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-2 items-end">
              <label className="text-xs space-y-1 block">
                <span style={{ color: WA.textMuted }}>模板池</span>
                <select
                  value={selectedTemplateKey}
                  onChange={e => applySelectedTemplate(e.target.value)}
                  disabled={saving || templateLoading}
                  className="w-full px-3 py-2 rounded-lg border text-sm focus:outline-none"
                  style={{ borderColor: WA.borderLight, color: WA.textDark, background: WA.white }}
                >
                  {!templates.some(t => t.template_key === 'welcome') && (
                    <option value="welcome">{templateLoading ? '加载模板中...' : 'Welcome 默认模板'}</option>
                  )}
                  {templates.map(t => (
                    <option key={t.id || t.template_key} value={t.template_key}>
                      {t.label || t.template_key}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                onClick={saveWelcomeTemplate}
                disabled={saving || templateSaving || !owner || !welcomeText?.trim()}
                className="px-3 py-2 rounded-lg text-xs font-semibold text-white disabled:opacity-50"
                style={{ background: WA.teal }}
              >
                {templateSaving ? '保存中...' : '保存为模板'}
              </button>
            </div>
            <label className="text-xs space-y-1 block">
              <span style={{ color: WA.textMuted }}>欢迎消息</span>
              <textarea
                value={welcomeText}
                onChange={e => onWelcomeTextChange?.(e.target.value)}
                rows={4}
                disabled={saving}
                placeholder="Hi! This is Jiawei from Moras. I’m reaching out to help with onboarding and creator support."
                className="w-full px-3 py-2 rounded-lg border text-sm focus:outline-none"
                style={{ borderColor: WA.borderLight, color: WA.textDark, background: WA.white }}
              />
            </label>
            {templateError && (
              <div className="text-xs" style={{ color: '#ef4444' }}>{templateError}</div>
            )}
          </>
        )}
      </div>

      {total > 0 && (
        <div className="rounded-xl border" style={{ borderColor: WA.borderLight }}>
          <div className="flex items-center justify-between px-3 py-2 text-xs" style={{ background: WA.lightBg, color: WA.textMuted }}>
            <span>预览（{validCount} 条有效 / {invalidCount} 条无效）</span>
            <span>共解析 {total} 行</span>
          </div>
          <div className="max-h-64 overflow-y-auto">
            <table className="w-full text-xs">
              <thead>
                <tr style={{ color: WA.textMuted }}>
                  <th className="text-left px-3 py-2 font-medium">#</th>
                  <th className="text-left px-3 py-2 font-medium">姓名</th>
                  <th className="text-left px-3 py-2 font-medium">电话</th>
                  <th className="text-left px-3 py-2 font-medium">状态</th>
                </tr>
              </thead>
              <tbody>
                {parsedRows.map((row) => (
                  <tr key={row.lineNo} className="border-t" style={{ borderColor: WA.borderLight }}>
                    <td className="px-3 py-1.5" style={{ color: WA.textMuted }}>{row.lineNo}</td>
                    <td className="px-3 py-1.5" style={{ color: WA.textDark }}>{row.name || <span style={{ color: '#ef4444' }}>—</span>}</td>
                    <td className="px-3 py-1.5 font-mono" style={{ color: WA.textDark }}>{row.phone || <span style={{ color: '#ef4444' }}>—</span>}</td>
                    <td className="px-3 py-1.5">
                      {row.valid ? (
                        <span style={{ color: '#10b981' }}>✓ 待导入</span>
                      ) : (
                        <span style={{ color: '#ef4444' }}>✗ {row.reason}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {summary && (
        <div className="rounded-xl border p-3 text-xs space-y-2" style={{ borderColor: WA.borderLight, background: WA.lightBg }}>
          <div className="flex items-center gap-3 flex-wrap">
            <span style={{ color: WA.textDark }}>导入完成：</span>
            <span style={{ color: '#10b981' }}>新建 {summary.created}</span>
            <span style={{ color: '#0284c7' }}>复用 {summary.reused}</span>
            <span style={{ color: '#f59e0b' }}>跳过 {summary.skipped}</span>
            <span style={{ color: summary.errors > 0 ? '#ef4444' : WA.textMuted }}>失败 {summary.errors}</span>
            {summary.welcome_queued !== undefined && (
              <span style={{ color: '#0284c7' }}>欢迎队列 {summary.welcome_queued}</span>
            )}
          </div>
          {(summary.skipped > 0 || summary.errors > 0) && (
            <div className="max-h-40 overflow-y-auto space-y-1 pt-1">
              {summaryRows.filter(r => r.status === 'error' || r.status === 'skipped').map((r, idx) => (
                <div key={idx} className="px-2 py-1 rounded" style={{ background: WA.white, color: WA.textDark }}>
                  <span style={{ color: '#ef4444' }}>{r.status === 'error' ? '错误' : '跳过'}</span>
                  {' '}· {r.name || '(无名)'} · {r.phone || '(无电话)'} · {r.error}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {error && (
        <div className="text-xs px-3 py-2 rounded-lg" style={{ background: 'rgba(239,68,68,0.08)', color: '#ef4444' }}>
          {error}
        </div>
      )}

      <div className="flex justify-end gap-2">
        <button
          onClick={onClose}
          disabled={saving}
          className="px-3 py-2 rounded-lg text-sm border"
          style={{ borderColor: WA.borderLight, color: WA.textMuted }}
        >
          {summary ? '关闭' : '取消'}
        </button>
        <button
          onClick={onSubmit}
          disabled={saving || validCount === 0 || !owner || (sendWelcome && !welcomeText?.trim())}
          className="px-4 py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-50"
          style={{ background: WA.teal }}
        >
          {saving ? '导入中...' : `导入 ${validCount} 条`}
        </button>
      </div>
    </div>
  )
}

// ====== Kanban Board ======
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
              {colCreators.length === 0 && (
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
        borderLeft: `4px solid ${statusMeta.accent === 'transparent' ? color : statusMeta.accent}`,
        background: statusMeta.bg === 'transparent' ? WA.white : `linear-gradient(180deg, ${statusMeta.bg} 0%, ${WA.white} 72%)`,
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

// ====== Filter components ======
function FilterSelect({ value, onChange, placeholder, children }) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      className="flex-1 min-w-0 h-9 text-[12px] pl-3 pr-8 rounded-2xl border focus:outline-none transition-all appearance-none bg-no-repeat"
      style={{
        backgroundColor: WA.white,
        backgroundImage: "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 20 20' fill='none' stroke='%236f6a62' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><polyline points='6 8 10 12 14 8' /></svg>\")",
        backgroundRepeat: 'no-repeat',
        backgroundPosition: 'right 10px center',
        backgroundSize: '12px 12px',
        borderColor: value ? WA.teal + '50' : WA.borderLight,
        color: value ? WA.textDark : WA.textMuted,
        fontSize: '12px',
        lineHeight: 1,
        boxShadow: value ? '0 0 0 1px rgba(15,118,110,0.08)' : 'none',
      }}
    >
      {children}
    </select>
  )
}

// ====== Relative time formatter ======
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
  if (value == null || value === '') return 0
  if (typeof value === 'number') return value > 1e12 ? value : value * 1000
  if (typeof value === 'string' && /^\d+$/.test(value)) {
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
    .filter(m => m?.role === 'user')
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
      if (msg?.role === 'user') lastUserTs = Math.max(lastUserTs, ts)
      if (msg?.role === 'me') lastMeTs = Math.max(lastMeTs, ts)
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

function flattenJoinbrandsFlags(joinbrands = {}, eventSnapshot = null) {
  const snapshotFlags = normalizeCreatorEventSnapshot(eventSnapshot)?.compat_ev_flags || {}
  const flag = (key) => {
    if (Object.prototype.hasOwnProperty.call(snapshotFlags, key)) return !!snapshotFlags[key]
    return !!joinbrands[key]
  }
  return {
    ev_trial_7day: flag('ev_trial_7day'),
    ev_trial_active: flag('ev_trial_active'),
    ev_monthly_invited: flag('ev_monthly_invited'),
    ev_monthly_started: flag('ev_monthly_started'),
    ev_monthly_joined: flag('ev_monthly_joined'),
    ev_whatsapp_shared: !!joinbrands.ev_whatsapp_shared,
    ev_gmv_1k: flag('ev_gmv_1k'),
    ev_gmv_2k: flag('ev_gmv_2k'),
    ev_gmv_5k: flag('ev_gmv_5k'),
    ev_gmv_10k: flag('ev_gmv_10k'),
    ev_agency_bound: flag('ev_agency_bound'),
    ev_churned: flag('ev_churned'),
  }
}

function buildCreatorListFull(detail = {}) {
  const eventSnapshot = normalizeCreatorEventSnapshot(detail.event_snapshot)
  const joinbrands = {
    ...(detail.joinbrands || {}),
    ...flattenJoinbrandsFlags({
      ...(detail.joinbrands || {}),
      ev_trial_7day: detail.ev_trial_7day ?? detail.joinbrands?.ev_trial_7day,
      ev_trial_active: detail.ev_trial_active ?? detail.joinbrands?.ev_trial_active,
      ev_monthly_invited: detail.ev_monthly_invited ?? detail.joinbrands?.ev_monthly_invited,
      ev_monthly_started: detail.ev_monthly_started ?? detail.joinbrands?.ev_monthly_started,
      ev_monthly_joined: detail.ev_monthly_joined ?? detail.joinbrands?.ev_monthly_joined,
      ev_gmv_1k: detail.ev_gmv_1k ?? detail.joinbrands?.ev_gmv_1k,
      ev_gmv_2k: detail.ev_gmv_2k ?? detail.joinbrands?.ev_gmv_2k,
      ev_gmv_5k: detail.ev_gmv_5k ?? detail.joinbrands?.ev_gmv_5k,
      ev_gmv_10k: detail.ev_gmv_10k ?? detail.joinbrands?.ev_gmv_10k,
      ev_agency_bound: detail.ev_agency_bound ?? detail.joinbrands?.ev_agency_bound,
      ev_churned: detail.ev_churned ?? detail.joinbrands?.ev_churned,
    }, eventSnapshot),
    ev_joined: detail.ev_joined ?? detail.joinbrands?.ev_joined,
    ev_ready_sent: detail.ev_ready_sent ?? detail.joinbrands?.ev_ready_sent,
    ev_whatsapp_shared: detail.ev_whatsapp_shared ?? detail.joinbrands?.ev_whatsapp_shared,
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
    event_snapshot: eventSnapshot,
  }
}

function buildCreatorViewModel(detail, previous = {}) {
  if (!detail) return previous
  const joinbrands = detail.joinbrands || previous.joinbrands || {}
  const wacrm = detail.wacrm || previous.wacrm || {}
  const keeper = detail.keeper || previous.keeper || {}
  const eventSnapshot = normalizeCreatorEventSnapshot(detail.event_snapshot || previous.event_snapshot || previous._full?.event_snapshot)
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
    event_snapshot: eventSnapshot,
    keeper_gmv: keeper.keeper_gmv ?? previous.keeper_gmv ?? 0,
    keeper_gmv30: keeper.keeper_gmv30 ?? previous.keeper_gmv30 ?? 0,
    msg_count: Number.isFinite(Number(detail.msg_count))
      ? Number(detail.msg_count)
      : Array.isArray(detail.messages)
        ? detail.messages.length
        : previous.msg_count ?? 0,
    ev_replied: detail.ev_replied ?? previous.ev_replied,
    updated_at: detail.updated_at ?? previous.updated_at,
    last_active: detail.last_active ?? previous.last_active ?? 0,
    _full: detail,
  }
  return {
    ...next,
    ...flattenJoinbrandsFlags({ ...joinbrands, ...(eventSnapshot?.compat_ev_flags || {}) }),
  }
}

function getPriorityBadgeMeta(priority, creator) {
  if (!priority) return null
  const replyState = getCreatorReplyState(creator)
  if (!replyState.awaitingReply && (priority === 'urgent' || priority === 'high')) return null
  if (priority === 'urgent') {
    return null
  }
  if (priority === 'high') {
    return {
      label: '高优先级',
      style: { background: 'rgba(245,158,11,0.10)', color: '#d97706', border: '1px solid rgba(245,158,11,0.18)' }
    }
  }
  if (priority === 'medium') {
    return {
      label: '中优先级',
      style: { background: WA.white, color: WA.textMuted, border: `1px solid ${WA.borderLight}` }
    }
  }
  if (priority === 'normal' || priority === 'low') {
    return {
      label: '低优先级',
      style: { background: WA.white, color: WA.textMuted, border: `1px solid ${WA.borderLight}` }
    }
  }
  return null
}

// ====== Chat List Item ======
function ChatListItem({ creator, onClick, unread, active = false }) {
  const ownerColor = getOwnerColor(creator.wa_owner, WA.textMuted)
  const full = creator._full || {}
  const wacrm = full.wacrm || {}
  const statusMeta = getCreatorStatusMeta(creator)
  const priorityMeta = getPriorityBadgeMeta(wacrm.priority, creator)
  const lifecycle = creator.lifecycle || full.lifecycle || null
  const lifecycleMeta = lifecycle?.stage_key ? LIFECYCLE_BADGE_META[lifecycle.stage_key] : null
  const referralActive = !!lifecycle?.flags?.referral_active
  const waJoined = !!lifecycle?.flags?.wa_joined
  const hasConflicts = !!lifecycle?.has_conflicts
  const trialPhaseMeta = getCreatorTrialPhaseMeta(creator)
  const signalBadges = getCreatorSignalBadges(creator).slice(0, 2)

  const lastActiveTs = getCreatorLastConversationTs(creator)
  const lastActiveLabel = lastActiveTs ? formatChatListTime(lastActiveTs) : null
  const lastActiveFull = lastActiveTs
    ? new Date(lastActiveTs).toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    : ''

  const baseBackground = statusMeta.bg === 'transparent' ? WA.white : statusMeta.bg
  const restBackground = active ? WA.shellActive : baseBackground
  const hoverBackground = active ? WA.shellActive : (statusMeta.hoverBg === 'transparent' ? WA.shellHover : statusMeta.hoverBg)
  const leftAccent = statusMeta.accent === 'transparent' ? WA.shellBorderStrong : statusMeta.accent

  return (
    <div
      onClick={onClick}
      className="mx-3 my-2 flex items-center gap-3.5 px-4 py-4 cursor-pointer transition-colors"
      style={{
        border: `1px solid ${WA.borderLight}`,
        borderLeft: `4px solid ${leftAccent}`,
        background: restBackground,
        borderRadius: 24,
        boxShadow: active ? '0 10px 24px rgba(31,29,26,0.08)' : '0 1px 2px rgba(15, 23, 42, 0.04)',
      }}
      onMouseEnter={e => e.currentTarget.style.background = hoverBackground}
      onMouseLeave={e => e.currentTarget.style.background = restBackground}
    >
      {/* Avatar + unread dot */}
      <div className="relative shrink-0">
        <div className="rounded-full flex items-center justify-center text-white font-medium" style={{ background: ownerColor, width: 48, height: 48, fontSize: 16 }}>
          {(creator.primary_name || '?')[0]?.toUpperCase()}
        </div>
        {unread > 0 && (
          <div className="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full flex items-center justify-center text-white text-xs font-bold" style={{ background: '#E96D5A' }}>
            {unread > 9 ? '9+' : unread}
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        {/* Name + Time row */}
        <div className="flex items-center justify-between">
          <span className="font-medium text-sm truncate flex items-center gap-1.5" style={{ color: WA.textDark }}>
            <span className="truncate">{creator.primary_name || 'Unknown'}</span>
            {Number(creator.is_active ?? 1) === 0 && (
              <span
                className="shrink-0 text-[10px] px-1.5 py-0.5 rounded-full font-medium"
                style={{ background: 'rgba(148,163,184,0.18)', color: WA.textMuted }}
              >
                已解绑
              </span>
            )}
          </span>
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
        {(trialPhaseMeta || signalBadges.length > 0 || priorityMeta || lifecycleMeta || creator.keeper_gmv > 0 || statusMeta.label) && (
          <div className="flex flex-wrap gap-1 mt-1.5">
            {statusMeta.label && (
              <span className="text-[11px] px-2 py-0.5 rounded-full font-medium" style={{ background: statusMeta.bg === 'transparent' ? WA.shellPanelMuted : statusMeta.bg, color: statusMeta.accent }}>
                {statusMeta.label}
              </span>
            )}
            {lifecycleMeta && (
              <span className="text-[11px] px-2 py-0.5 rounded-full font-medium" style={{ background: lifecycleMeta.bg, color: lifecycleMeta.color }}>
                {lifecycleMeta.label}
              </span>
            )}
            {!waJoined && lifecycle?.stage_key === 'acquisition' && (
              <span className="text-[11px] px-2 py-0.5 rounded-full font-medium" style={{ background: 'rgba(100,116,139,0.12)', color: '#475569' }}>
                未入WA
              </span>
            )}
            {referralActive && (
              <span className="text-[11px] px-2 py-0.5 rounded-full font-medium" style={{ background: 'rgba(13,148,136,0.12)', color: '#0d9488' }}>
                推荐中
              </span>
            )}
            {hasConflicts && (
              <span className="text-[11px] px-2 py-0.5 rounded-full font-medium" style={{ background: 'rgba(239,68,68,0.12)', color: '#dc2626' }}>
                冲突
              </span>
            )}
            {trialPhaseMeta && (
              <span className="text-[11px] px-2 py-0.5 rounded-full font-medium" style={{ background: trialPhaseMeta.bg, color: trialPhaseMeta.color }}>
                {trialPhaseMeta.label}
              </span>
            )}
            {signalBadges.map(e => (
              <span key={e.key} className="text-[11px] px-2 py-0.5 rounded-full" style={{ background: e.bg, color: e.color }}>
                {e.label}
              </span>
            ))}
            {priorityMeta && (
              <span className="text-[11px] px-2 py-0.5 rounded-full" style={priorityMeta.style}>
                {priorityMeta.label}
              </span>
            )}
            {creator.keeper_gmv > 0 && (
              <span className="text-[11px] px-2 py-0.5 rounded-full font-medium" style={{ background: 'rgba(16,185,129,0.12)', color: '#10b981' }}>
                ${Number(creator.keeper_gmv).toLocaleString()}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function GroupChatListItem({ groupChat, onClick, active = false }) {
  const lastActiveTs = Number(groupChat?.last_active || 0)
  const lastActiveLabel = lastActiveTs ? formatChatListTime(lastActiveTs) : null
  const restBackground = active ? WA.shellActive : WA.white
  const hoverBackground = active ? WA.shellActive : WA.shellHover

  return (
    <div
      onClick={onClick}
      className="mx-3 my-2 flex items-center gap-3.5 px-4 py-4 cursor-pointer transition-colors"
      style={{
        border: `1px solid ${WA.borderLight}`,
        borderLeft: `4px solid ${WA.teal}`,
        background: restBackground,
        borderRadius: 24,
        boxShadow: active ? '0 10px 24px rgba(31,29,26,0.08)' : '0 1px 2px rgba(15, 23, 42, 0.04)',
      }}
      onMouseEnter={e => e.currentTarget.style.background = hoverBackground}
      onMouseLeave={e => e.currentTarget.style.background = restBackground}
    >
      <div className="relative shrink-0">
        <div className="rounded-full flex items-center justify-center text-white font-medium" style={{ background: WA.teal, width: 48, height: 48, fontSize: 16 }}>
          #
        </div>
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between">
          <span className="font-medium text-sm truncate" style={{ color: WA.textDark }}>{groupChat.group_name || 'Unnamed Group'}</span>
          {lastActiveLabel && (
            <span className="shrink-0 ml-2 text-xs" style={{ color: WA.textMuted }}>
              {lastActiveLabel}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5 mt-0.5">
          <span className="text-xs" style={{ color: WA.textMuted }}>{groupChat.session_id || '-'}</span>
          <span className="text-xs" style={{ color: WA.borderLight }}>·</span>
          <span className="text-xs" style={{ color: WA.textMuted }}>{groupChat.msg_count || 0} 条</span>
        </div>
      </div>
    </div>
  )
}

function formatBetaStatusLabel(value) {
  const map = {
    not_introduced: '未介绍',
    introduced: '已介绍',
    started: '已开始',
    joined: '已加入',
    completed: '已完成',
    churned: '已流失',
  }
  return map[value] || value || '-'
}

// ====== Empty State ======
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

function compactWorkspaceMessage(text = '') {
  return String(text || '')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function buildWorkspaceDigestSummary(creator) {
  const lifecycleLabel = creator?.lifecycle?.stage_label || '待跟进'
  const priority = creator?._full?.wacrm?.priority || creator?.priority || 'normal'
  const messages = getCreatorMessages(creator)
  const latestIncoming = [...messages].reverse().find(m => m?.role === 'user' && String(m?.text || '').trim())
  const latestAny = [...messages].reverse().find(m => String(m?.text || '').trim())
  const latestText = compactWorkspaceMessage(latestIncoming?.text || latestAny?.text || '')

  if (!latestText) {
    return `${lifecycleLabel}阶段，当前为${formatBetaStatusLabel(creator?.beta_status || creator?._full?.wacrm?.beta_status || 'not_introduced')}，建议优先查看最新会话状态。`
  }

  const prefix = latestIncoming ? '最新达人消息' : '最近会话摘要'
  return `${prefix}：${latestText}`.slice(0, 120)
}

function buildWorkspaceDigestItems(creators = [], limit = 4) {
  return [...creators]
    .sort((a, b) => getCreatorLastConversationTs(b) - getCreatorLastConversationTs(a))
    .slice(0, limit)
    .map((creator) => ({
      id: creator.id,
      name: creator.primary_name || 'Unknown',
      owner: creator.wa_owner || '-',
      stage: creator?.lifecycle?.stage_label || '待跟进',
      time: formatChatListTime(getCreatorLastConversationTs(creator)) || '暂无记录',
      summary: buildWorkspaceDigestSummary(creator),
    }))
}

// ====== Panel 2 空状态：显示全局统计 ======
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
  const generationReplyHitRate = Number(stats.generation_reply_hit_rate || 0)
  const totalEvents = Number(stats.total_events || 0)
  const totalCanonicalEvents = Number(stats.total_canonical_events || 0)
  const totalLifecycleDrivingEvents = Number(stats.total_lifecycle_driving_events || 0)
  const yesterdayDetectedEvents = Number(stats.yesterday_detected_events ?? stats.yesterday_new_events ?? 0)
  const yesterdayBusinessEvents = Number(stats.yesterday_business_events || 0)
  const yesterdayConfirmedEvents = Number(stats.yesterday_confirmed_events || 0)
  const digestItems = buildWorkspaceDigestItems(creators, 4)

  return (
    <div className="flex-1 min-h-0 flex flex-col" style={{ background: WA.chatBg }}>
      <div className="flex-1 min-h-0 overflow-y-auto p-8 space-y-5 docs-scrollbar">
        <div className="text-center mb-2">
          <div className="docs-kicker">Workspace</div>
          <div className="text-[34px] mt-2 font-semibold tracking-[-0.03em]" style={{ color: WA.textDark }}>消息工作台</div>
          <div className="text-sm mt-2" style={{ color: WA.textMuted }}>从左侧选择一位达人，进入对话、策略和上下文协同视图。</div>
        </div>

        <div className="grid grid-cols-2 xl:grid-cols-3 gap-3">
          <div className="text-center p-5 rounded-[24px]" style={{ background: WA.white, border: `1px solid ${WA.borderLight}` }}>
            <div className="text-2xl font-bold" style={{ color: WA.teal }}>{totalCreators}</div>
            <div className="text-xs mt-1" style={{ color: WA.textMuted }}>总达人</div>
          </div>
          <div className="text-center p-5 rounded-[24px]" style={{ background: WA.white, border: `1px solid ${WA.borderLight}` }}>
            <div className="text-2xl font-bold" style={{ color: WA.teal }}>{totalMessages.toLocaleString()}</div>
            <div className="text-xs mt-1" style={{ color: WA.textMuted }}>消息总数</div>
          </div>
          <div className="text-center p-5 rounded-[24px]" style={{ background: WA.white, border: `1px solid ${WA.borderLight}` }}>
            <div className="text-2xl font-bold" style={{ color: '#10b981' }}>{activeCreators}</div>
            <div className="text-xs mt-1" style={{ color: WA.textMuted }}>活跃达人</div>
          </div>
          <div className="text-center p-5 rounded-[24px]" style={{ background: WA.white, border: `1px solid ${WA.borderLight}` }}>
            <div className="text-2xl font-bold" style={{ color: '#8b5cf6' }}>{generationReplyHitRate.toFixed(1)}%</div>
            <div className="text-xs mt-1" style={{ color: WA.textMuted }}>生成回复命中率</div>
          </div>
          <div className="text-center p-5 rounded-[24px]" style={{ background: WA.white, border: `1px solid ${WA.borderLight}` }}>
            <div className="text-2xl font-bold" style={{ color: '#f59e0b' }}>{totalEvents.toLocaleString()}</div>
            <div className="text-xs mt-1" style={{ color: WA.textMuted }}>事件总数</div>
            <div className="text-[11px] mt-1" style={{ color: WA.textMuted }}>
              标准 {totalCanonicalEvents.toLocaleString()} · 可驱动 {totalLifecycleDrivingEvents.toLocaleString()}
            </div>
          </div>
          <div className="text-center p-5 rounded-[24px]" style={{ background: WA.white, border: `1px solid ${WA.borderLight}` }}>
            <div className="text-2xl font-bold" style={{ color: '#2563eb' }}>{yesterdayDetectedEvents.toLocaleString()}</div>
            <div className="text-xs mt-1" style={{ color: WA.textMuted }}>昨日识别事件</div>
          </div>
          <div className="text-center p-5 rounded-[24px]" style={{ background: WA.white, border: `1px solid ${WA.borderLight}` }}>
            <div className="text-2xl font-bold" style={{ color: '#14b8a6' }}>{yesterdayBusinessEvents.toLocaleString()}</div>
            <div className="text-xs mt-1" style={{ color: WA.textMuted }}>昨日业务事件</div>
          </div>
          <div className="text-center p-5 rounded-[24px]" style={{ background: WA.white, border: `1px solid ${WA.borderLight}` }}>
            <div className="text-2xl font-bold" style={{ color: '#7c3aed' }}>{yesterdayConfirmedEvents.toLocaleString()}</div>
            <div className="text-xs mt-1" style={{ color: WA.textMuted }}>昨日确认事件</div>
          </div>
        </div>

        {stats.by_owner && Object.keys(stats.by_owner).length > 0 && (
          <div className="rounded-[24px] p-5" style={{ background: WA.white, border: `1px solid ${WA.borderLight}` }}>
            <div className="docs-kicker mb-3">Owners</div>
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

        <div className="text-center text-sm py-4 rounded-[24px]" style={{ background: WA.shellAccentSoft, color: WA.textMuted }}>
          👈 从左侧名录选择达人，右侧上下文抽屉会随聊天工作流展开
        </div>

        <div
          className="rounded-[26px] border p-5 flex flex-col gap-4"
          style={{ background: WA.white, borderColor: WA.borderLight, minHeight: 280 }}
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="docs-kicker">Quick Digest</div>
              <div className="text-[18px] font-semibold tracking-[-0.02em]" style={{ color: WA.textDark }}>快速消息概览 AI 摘要</div>
              <div className="text-[13px] mt-1" style={{ color: WA.textMuted }}>
                基于最近会话与阶段信息，为你先看一眼今天最值得关注的联系人。
              </div>
            </div>
            <div className="px-3 py-1.5 rounded-full text-[11px] font-semibold" style={{ background: WA.shellPanelMuted, color: WA.textMuted }}>
              最近 {digestItems.length} 位
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            {digestItems.map((item) => (
              <div
                key={item.id}
                className="rounded-[22px] border px-4 py-3 space-y-2"
                style={{ background: WA.shellPanelStrong, borderColor: WA.borderLight }}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-[15px] font-semibold truncate" style={{ color: WA.textDark }}>{item.name}</div>
                    <div className="text-[11px]" style={{ color: WA.textMuted }}>
                      {item.owner} · {item.stage}
                    </div>
                  </div>
                  <div className="shrink-0 text-[11px]" style={{ color: WA.textMuted }}>{item.time}</div>
                </div>
                <div className="text-[13px] leading-5" style={{ color: WA.textDark }}>
                  {item.summary}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

export default App
