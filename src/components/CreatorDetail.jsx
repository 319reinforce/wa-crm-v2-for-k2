import React, { useCallback, useEffect, useState } from 'react'
import { WAMessageComposer } from './WAMessageComposer'
import { CreatorEventsSection } from './CreatorEventsSection'
import { fetchJsonOrThrow, fetchOkOrThrow } from '../utils/api'
import { getCreatorStatusMeta } from '../utils/creatorMeta'
import { OWNER_ORDER } from '../utils/operators'
import {
  DEFAULT_UNBOUND_AGENCY_STRATEGIES,
  isAgencyBoundStatus,
  normalizeUnboundAgencyStrategies,
  resolveUnboundAgencyStrategy
} from '../utils/unboundAgencyStrategies'
import WA from '../utils/waTheme'

const API_BASE = '/api'
const V1_APP_BASE = String(import.meta.env.VITE_V1_BASE || '').trim()
const LOCAL_CROSS_APP_HOSTS = new Set(['localhost', '127.0.0.1'])
const CONTEXT_TABS = [
  { key: 'overview', label: '概览' },
  { key: 'events', label: '事件' },
  { key: 'operations', label: '运营' },
  { key: 'data', label: '数据' },
]
const STRATEGY_PRESET_OPTIONS = [
  ['DRIFTO介绍', '介绍DRIFTO MCN背景、2个月签约期、佣金100%返还机制'],
  ['价格咨询', '回应月费、Beta激励、套餐价格相关疑问'],
  ['月费说明', '解释$20月费扣除规则、每周一结算'],
  ['Beta计划', '介绍20天Beta $200激励、$10/天规则'],
  ['月度挑战', '邀请开启月度挑战计划、DRIFTO MCN月费权益'],
  ['流失挽回', '针对流失客户的激活话术、重新建立沟通'],
  ['视频要求', '说明5个/天最佳、超6个TikTok降权规则'],
  ['付款说明', '解释PayPal返还、佣金结算周期'],
]
const PORTRAIT_FIELD_CONFIG = [
  {
    key: 'frequency',
    label: '沟通频次 (Frequency)',
    options: [['high', '高'], ['medium', '中'], ['low', '低']],
    hint: '高=主动评论/私信/反复互动；中=偶尔互动；低=只浏览不说话',
  },
  {
    key: 'difficulty',
    label: '沟通难度 (Difficulty)',
    options: [['high', '高'], ['medium', '中'], ['low', '低']],
    hint: '高=需要解释产品逻辑；中=能理解但需要引导；低=一说就懂',
  },
  {
    key: 'intent',
    label: '沟通意愿 (Intent)',
    options: [['strong', '强'], ['medium', '中'], ['weak', '弱']],
    hint: '综合上次沟通时间、建联时长、回复信息量判断',
  },
  {
    key: 'emotion',
    label: '沟通情绪 (Emotion)',
    options: [['positive', '正向'], ['neutral', '中性'], ['negative', '负向']],
    hint: '正向=兴奋/好奇/想尝试；中性=理性观察；负向=质疑/抵触/不信',
  },
]

function resolveCrossAppBase(configuredBase, fallbackPort) {
  const explicit = String(configuredBase || '').trim().replace(/\/+$/, '')
  if (explicit) return explicit
  if (typeof window === 'undefined') return ''
  const { protocol, hostname, port, origin } = window.location
  if (!hostname) return ''
  if (!LOCAL_CROSS_APP_HOSTS.has(hostname)) return origin.replace(/\/+$/, '')
  const targetPort = String(fallbackPort || '').trim()
  if (!targetPort || port === targetPort) return origin.replace(/\/+$/, '')
  return `${protocol}//${hostname}:${targetPort}`
}

function buildV1DashboardUrl(options = {}) {
  const base = resolveCrossAppBase(V1_APP_BASE, 2000)
  const params = new URLSearchParams()
  params.set('tab', String(options.tab || 'wa'))
  params.set('source', 'v2')
  if (options.creatorId) params.set('creatorId', String(options.creatorId))
  if (options.openChat) params.set('openChat', '1')
  if (options.phone) params.set('phone', String(options.phone))
  if (options.name) params.set('name', String(options.name))
  return `${base}/?${params.toString()}`
}

function buildPortraitDraft(source = null) {
  const input = (source && typeof source === 'object') ? source : {}
  return {
    frequency: {
      value: String(input?.frequency?.value || '').trim().toLowerCase(),
      confidence: Number(input?.frequency?.confidence) || 2,
      evidence: String(input?.frequency?.evidence || ''),
    },
    difficulty: {
      value: String(input?.difficulty?.value || '').trim().toLowerCase(),
      confidence: Number(input?.difficulty?.confidence) || 2,
      evidence: String(input?.difficulty?.evidence || ''),
    },
    intent: {
      value: String(input?.intent?.value || '').trim().toLowerCase(),
      confidence: Number(input?.intent?.confidence) || 2,
      evidence: String(input?.intent?.evidence || ''),
    },
    emotion: {
      value: String(input?.emotion?.value || '').trim().toLowerCase(),
      confidence: Number(input?.emotion?.confidence) || 2,
      evidence: String(input?.emotion?.evidence || ''),
    },
  }
}

function normalizePortraitForSave(source = null) {
  const draft = buildPortraitDraft(source)
  const clamp = (n) => Math.max(1, Math.min(3, Number.isFinite(Number(n)) ? Math.round(Number(n)) : 2))
  return {
    frequency: {
      value: draft.frequency.value || null,
      confidence: clamp(draft.frequency.confidence),
      evidence: draft.frequency.evidence.trim().slice(0, 250),
    },
    difficulty: {
      value: draft.difficulty.value || null,
      confidence: clamp(draft.difficulty.confidence),
      evidence: draft.difficulty.evidence.trim().slice(0, 250),
    },
    intent: {
      value: draft.intent.value || null,
      confidence: clamp(draft.intent.confidence),
      evidence: draft.intent.evidence.trim().slice(0, 250),
    },
    emotion: {
      value: draft.emotion.value || null,
      confidence: clamp(draft.emotion.confidence),
      evidence: draft.emotion.evidence.trim().slice(0, 250),
    },
  }
}

function buildEditFormSnapshot(creator) {
  const jb = creator?.joinbrands || {}
  const w = creator?.wacrm || {}
  const k = creator?.keeper || {}
  return {
    primary_name: creator?.primary_name || '',
    wa_phone: creator?.wa_phone || '',
    wa_owner: creator?.wa_owner || '',
    keeper_username: creator?.keeper_username || '',
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
    ev_monthly_joined: !!jb.ev_monthly_joined,
    ev_whatsapp_shared: !!jb.ev_whatsapp_shared,
    ev_gmv_1k: !!jb.ev_gmv_1k,
    ev_gmv_2k: !!jb.ev_gmv_2k,
    ev_gmv_5k: !!jb.ev_gmv_5k,
    ev_gmv_10k: !!jb.ev_gmv_10k,
    ev_agency_bound: !!jb.ev_agency_bound,
    ev_churned: !!jb.ev_churned,
  }
}

// ====== Creator Detail Panel ======
function CreatorDetail({ creatorId, creatorName, onClose, onMessageSent, onCreatorUpdated, asPanel, collapsed = false, pinned = false, onTogglePin, onExpand }) {
  const [creator, setCreator] = useState(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [showEdit, setShowEdit] = useState(false)
  const [editForm, setEditForm] = useState({})
  const [editFormInitial, setEditFormInitial] = useState({})
  const [editSaving, setEditSaving] = useState(false)
  const [clientProfile, setClientProfile] = useState(null)
  const [profileRefreshing, setProfileRefreshing] = useState(false)
  const [profileExpanded, setProfileExpanded] = useState(false)
  const [activeContextTab, setActiveContextTab] = useState('overview')
  const [activeManageTab, setActiveManageTab] = useState(null)
  const [strategyPresetExpanded, setStrategyPresetExpanded] = useState(false)
  const [agencyStrategies, setAgencyStrategies] = useState(DEFAULT_UNBOUND_AGENCY_STRATEGIES)
  const [strategyInsight, setStrategyInsight] = useState(null)
  const [strategyInsightLoading, setStrategyInsightLoading] = useState(false)
  const [strategyInsightError, setStrategyInsightError] = useState('')
  const [strategyRebuilding, setStrategyRebuilding] = useState(false)
  const [lifecycleHistory, setLifecycleHistory] = useState([])
  const [lifecycleHistorySource, setLifecycleHistorySource] = useState('')
  const [lifecycleHistoryLoading, setLifecycleHistoryLoading] = useState(false)
  const [lifecycleHistoryError, setLifecycleHistoryError] = useState('')
  const [portraitDraft, setPortraitDraft] = useState(buildPortraitDraft(null))
  const [portraitSaving, setPortraitSaving] = useState(false)
  const [portraitError, setPortraitError] = useState('')

  const fetchCreator = useCallback(async (silent = false) => {
    if (!silent) setRefreshing(true)
    try {
      const data = await fetchJsonOrThrow(`${API_BASE}/creators/${creatorId}`)
      setCreator(data)
      onCreatorUpdated?.(data)
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
    } catch (_) {
      // ignore, keep current creator state
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [creatorId, onCreatorUpdated])

  // 获取客户画像（summary + tags + memory）
  const fetchClientProfile = useCallback((silent = false) => {
    if (!creator?.wa_phone) return
    if (!silent) setProfileRefreshing(true)
    fetchJsonOrThrow(`${API_BASE}/client-profile/${encodeURIComponent(creator.wa_phone)}`)
      .then(data => {
        if (data) {
          setClientProfile(data)
          setPortraitDraft(buildPortraitDraft(data?.portrait || null))
          if (!silent) setPortraitError('')
        }
      })
      .catch((e) => {
        if (!silent) setPortraitError(e?.message || '画像加载失败')
      })
      .finally(() => { if (!silent) setProfileRefreshing(false) })
  }, [creator?.wa_phone])

  const fetchAgencyStrategies = useCallback(async () => {
    try {
      const data = await fetchJsonOrThrow(`${API_BASE}/strategy-config/unbound-agency`)
      const normalized = normalizeUnboundAgencyStrategies(data?.strategies || [])
      setAgencyStrategies(normalized.length > 0 ? normalized : DEFAULT_UNBOUND_AGENCY_STRATEGIES)
    } catch (_) {
      setAgencyStrategies(DEFAULT_UNBOUND_AGENCY_STRATEGIES)
    }
  }, [])

  const fetchStrategyInsight = useCallback(async (silent = false) => {
    if (!creatorId) return
    if (!silent) setStrategyInsightLoading(true)
    if (!silent) setStrategyInsightError('')
    try {
      const data = await fetchJsonOrThrow(`${API_BASE}/reply-strategy/insight/${creatorId}`)
      setStrategyInsight(data || null)
    } catch (e) {
      if (!silent) setStrategyInsightError(e.message || '策略洞察加载失败')
    } finally {
      if (!silent) setStrategyInsightLoading(false)
    }
  }, [creatorId])

  const fetchLifecycleHistory = useCallback(async (silent = false) => {
    if (!creatorId) return
    if (!silent) setLifecycleHistoryLoading(true)
    if (!silent) setLifecycleHistoryError('')
    try {
      const data = await fetchJsonOrThrow(`${API_BASE}/creators/${creatorId}/lifecycle-history?limit=20`)
      setLifecycleHistory(Array.isArray(data?.transitions) ? data.transitions : [])
      setLifecycleHistorySource(String(data?.source || ''))
    } catch (e) {
      if (!silent) setLifecycleHistoryError(e.message || '生命周期轨迹加载失败')
    } finally {
      if (!silent) setLifecycleHistoryLoading(false)
    }
  }, [creatorId])

  const handleRebuildReplyStrategy = useCallback(async () => {
    if (!creatorId) return
    setStrategyRebuilding(true)
    setStrategyInsightError('')
    try {
      await fetchJsonOrThrow(`${API_BASE}/reply-strategy/rebuild/${creatorId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trigger: 'manual_panel_rebuild', allow_soft_adjust: false }),
      })
      fetchClientProfile(true)
      fetchStrategyInsight(true)
      fetchLifecycleHistory(true)
    } catch (e) {
      setStrategyInsightError(e.message || '重算失败')
    } finally {
      setStrategyRebuilding(false)
    }
  }, [creatorId, fetchClientProfile, fetchStrategyInsight, fetchLifecycleHistory])

  const updatePortraitField = useCallback((fieldKey, partial) => {
    setPortraitDraft((prev) => ({
      ...prev,
      [fieldKey]: {
        ...(prev?.[fieldKey] || { value: '', confidence: 2, evidence: '' }),
        ...partial,
      },
    }))
  }, [])

  const handleSavePortrait = useCallback(async () => {
    if (!creator?.wa_phone) return
    setPortraitSaving(true)
    setPortraitError('')
    try {
      await fetchOkOrThrow(`${API_BASE}/client-profile/${encodeURIComponent(creator.wa_phone)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          portrait: normalizePortraitForSave(portraitDraft),
        }),
      })
      fetchClientProfile(true)
    } catch (e) {
      setPortraitError(e?.message || '画像保存失败')
    } finally {
      setPortraitSaving(false)
    }
  }, [creator?.wa_phone, portraitDraft, fetchClientProfile])

  const deleteStrategyMemory = useCallback(async (memoryKey) => {
    if (!creator?.wa_phone || !memoryKey) return
    try {
      await fetchOkOrThrow(`${API_BASE}/client-profiles/${encodeURIComponent(creator.wa_phone)}/memory`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ memory_type: 'strategy', memory_key: memoryKey })
      })
      fetchClientProfile(true)
      fetchStrategyInsight(true)
    } catch (e) {
      console.error('[ClientProfile][memory] 删除失败:', e)
    }
  }, [creator?.wa_phone, fetchClientProfile, fetchStrategyInsight])

  const addStrategyMemory = useCallback(async (memoryKey, memoryValue) => {
    if (!creator?.wa_phone || !memoryKey || !memoryValue) return
    try {
      await fetchOkOrThrow(`${API_BASE}/client-profiles/${encodeURIComponent(creator.wa_phone)}/memory`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ memory_type: 'strategy', memory_key: memoryKey, memory_value: memoryValue })
      })
      fetchClientProfile(true)
      fetchStrategyInsight(true)
    } catch (e) {
      console.error('[ClientProfile][memory] 新增失败:', e)
    }
  }, [creator?.wa_phone, fetchClientProfile, fetchStrategyInsight])

  useEffect(() => {
    fetchCreator(true)
    fetchClientProfile()
    fetchAgencyStrategies()
    fetchStrategyInsight()
    fetchLifecycleHistory()
    const i = setInterval(() => fetchCreator(true), 8000)
    return () => clearInterval(i)
  }, [fetchCreator, fetchClientProfile, fetchAgencyStrategies, fetchStrategyInsight, fetchLifecycleHistory])

  useEffect(() => {
    setActiveContextTab('overview')
    setActiveManageTab(null)
    setStrategyPresetExpanded(false)
    setStrategyInsight(null)
    setStrategyInsightError('')
    setLifecycleHistory([])
    setLifecycleHistorySource('')
    setLifecycleHistoryError('')
    setPortraitDraft(buildPortraitDraft(null))
    setPortraitError('')
  }, [creatorId])

  // 当 creator 变化时，同步 editForm（用于内联编辑）
  useEffect(() => {
    if (!creator || showEdit) return
    setEditForm(buildEditFormSnapshot(creator))
  }, [creator, showEdit])

  useEffect(() => {
    if (!creatorId || !creator?.lifecycle?.stage_key) return
    fetchLifecycleHistory(true)
  }, [creatorId, creator?.lifecycle?.stage_key, fetchLifecycleHistory])

  const handleRefresh = () => {
    fetchCreator(false)
    fetchLifecycleHistory(false)
  }

  const handleEditOpen = () => {
    const initial = buildEditFormSnapshot(creator)
    setEditForm(initial)
    setEditFormInitial(initial)
    setActiveManageTab('edit')
    // 如需保留弹窗模式，可在这里重新启用
  }

  const handleApplyLifecycleOption0 = () => {
    const nextActionTemplate = creator?.lifecycle?.option0?.next_action_template
    if (!nextActionTemplate) return
    const initial = buildEditFormSnapshot(creator)
    const hasDraft = activeManageTab === 'edit' && Object.keys(editForm || {}).length > 0
    if (!hasDraft || Object.keys(editFormInitial || {}).length === 0) {
      setEditFormInitial(initial)
    }
    setEditForm(prev => ({
      ...(hasDraft ? prev : initial),
      next_action: nextActionTemplate,
    }))
    setActiveManageTab('edit')
  }

  const handleSelectContextTab = (tabKey) => {
    setActiveContextTab(tabKey)
    if (tabKey === 'operations' && activeManageTab !== 'edit') {
      handleEditOpen()
      return
    }
    if (tabKey === 'data' && (!activeManageTab || activeManageTab === 'edit')) {
      setActiveManageTab('finance')
    }
  }

  const handleEditSave = async () => {
    setEditSaving(true)
    try {
      // 更新 creators 表（基本信息）
      await fetchOkOrThrow(`${API_BASE}/creators/${creatorId}`, {
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
      await fetchOkOrThrow(`${API_BASE}/creators/${creatorId}/wacrm`, {
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
      const refreshed = await fetchJsonOrThrow(`${API_BASE}/creators/${creatorId}`)
      setCreator(refreshed)
      onCreatorUpdated?.(refreshed)
      setShowEdit(false)
      fetchStrategyInsight(true)
      fetchLifecycleHistory(true)
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
        <span className="text-sm" style={{ color: WA.textMuted }}>加载中...</span>
      </div>
    </div>
  )

  const displayCreator = buildCreatorDraftPreview(creator, editForm)
  const wacrm = displayCreator?.wacrm || {}
  const joinbrands = displayCreator?.joinbrands || {}
  const isAgencyBound = isAgencyBoundStatus(wacrm, joinbrands)
  const activeAgencyStrategy = !isAgencyBound
    ? resolveUnboundAgencyStrategy({
      clientMemory: clientProfile?.memory || [],
      nextAction: editForm?.next_action || wacrm?.next_action || '',
      strategies: agencyStrategies,
    })
    : null
  const detailStatusMeta = getCreatorStatusMeta(displayCreator)
  const lifecycle = creator?.lifecycle || displayCreator?.lifecycle || null
  const clientInfo = {
    id: displayCreator?.id,
    phone: displayCreator?.wa_phone,
    name: displayCreator?.primary_name,
    wa_owner: displayCreator?.wa_owner,
    conversion_stage: lifecycle?.stage_key || wacrm.beta_status || 'unknown',
    lifecycle_stage: lifecycle?.stage_key || 'unknown',
    lifecycle_label: lifecycle?.stage_label || null,
    priority: wacrm.priority || 'normal',
    sentiment: 'neutral',
    msg_count: Number.isFinite(Number(creator?.msg_count)) ? Number(creator.msg_count) : (creator?.messages?.length || 0),
    messages: creator?.messages || []
  }
  const displayName = displayCreator?.primary_name || creatorName
  const displayPhone = displayCreator?.wa_phone || '-'
  const displayKeeperUsername = displayCreator?.keeper_username || '-'
  const displayOwner = displayCreator?.wa_owner || '-'
  const displayKeeper = displayCreator?.keeper || {}
  const v1DashboardUrl = (displayCreator?.id || displayPhone !== '-')
    ? buildV1DashboardUrl({
      tab: 'wa',
      creatorId: displayCreator?.id,
      openChat: true,
      phone: displayPhone !== '-' ? displayPhone : '',
      name: displayName || '',
    })
    : ''
  const lifecycleOption0 = lifecycle?.option0 || null
  const lifecycleEntrySignals = Array.isArray(lifecycle?.entry_signals)
    ? lifecycle.entry_signals.filter(Boolean)
    : []
  const lifecycleFlags = lifecycle?.flags || {}
  const lifecycleConflicts = Array.isArray(creator?.lifecycle_conflicts)
    ? creator.lifecycle_conflicts
    : (Array.isArray(lifecycle?.conflicts) ? lifecycle.conflicts : [])
  const lifecycleTransitions = Array.isArray(lifecycleHistory)
    ? lifecycleHistory.filter(Boolean)
    : []
  const portraitBaseline = normalizePortraitForSave(clientProfile?.portrait || null)
  const portraitCurrent = normalizePortraitForSave(portraitDraft || null)
  const portraitDirty = JSON.stringify(portraitCurrent) !== JSON.stringify(portraitBaseline)

  const lifecyclePanel = lifecycle && (
    <DetailCard title="生命周期">
      <InfoRow label="主阶段" value={lifecycle.stage_label || '-'} />
      <InfoRow label="Beta 子流程" value={formatLifecycleFlagValue('beta_status', lifecycleFlags.beta_status)} />
      <InfoRow label="目标" value={lifecycle.goal || '-'} />
      {lifecycleEntrySignals.length > 0 && (
        <InfoRow label="进入信号" value={lifecycleEntrySignals.join(' · ')} />
      )}
      {lifecycle.exit_signal_hint && (
        <InfoRow label="退出提示" value={lifecycle.exit_signal_hint} />
      )}
      <div className="mt-2 flex flex-wrap gap-1.5">
        {lifecycleFlags.wa_joined ? (
          <span className="text-[9px] px-2 py-1 rounded-full font-semibold" style={{ background: 'rgba(37,99,235,0.12)', color: '#2563eb' }}>
            已入WA
          </span>
        ) : (
          <span className="text-[9px] px-2 py-1 rounded-full font-semibold" style={{ background: 'rgba(100,116,139,0.12)', color: '#475569' }}>
            未入WA
          </span>
        )}
        {lifecycleFlags.referral_active && (
          <span className="text-[9px] px-2 py-1 rounded-full font-semibold" style={{ background: 'rgba(13,148,136,0.12)', color: '#0d9488' }}>
            推荐中
          </span>
        )}
        {lifecycleFlags.agency_bound && (
          <span className="text-[9px] px-2 py-1 rounded-full font-semibold" style={{ background: 'rgba(0,168,132,0.10)', color: WA.teal }}>
            Agency 已绑定
          </span>
        )}
        {lifecycleFlags.trial_in_progress && (
          <span className="text-[9px] px-2 py-1 rounded-full font-semibold" style={{ background: 'rgba(59,130,246,0.12)', color: '#2563eb' }}>
            7日挑战进行中
          </span>
        )}
        {lifecycleFlags.trial_completed && (
          <span className="text-[9px] px-2 py-1 rounded-full font-semibold" style={{ background: 'rgba(124,58,237,0.12)', color: '#7c3aed' }}>
            7日挑战已完成
          </span>
        )}
        {lifecycleFlags.gmv_tier && lifecycleFlags.gmv_tier !== 'none' && (
          <span className="text-[9px] px-2 py-1 rounded-full font-semibold" style={{ background: 'rgba(245,158,11,0.12)', color: '#b45309' }}>
            GMV {String(lifecycleFlags.gmv_tier).toUpperCase()}
          </span>
        )}
        {lifecycleFlags.churn_risk && (
          <span className="text-[9px] px-2 py-1 rounded-full font-semibold" style={{ background: 'rgba(239,68,68,0.12)', color: '#dc2626' }}>
            流失风险
          </span>
        )}
      </div>
      {lifecycleConflicts.length > 0 && (
        <div className="mt-2 rounded-[16px] border p-2.5 space-y-1.5" style={{ background: 'rgba(239,68,68,0.05)', borderColor: 'rgba(239,68,68,0.12)' }}>
          <div className="text-[10px] font-semibold tracking-wide" style={{ color: '#dc2626' }}>
            生命周期冲突
          </div>
          {lifecycleConflicts.map((item, idx) => {
            const conflictCode = (item && typeof item === 'object') ? (item.code || item.key || item.type) : item
            const keyStr = conflictCode ? String(conflictCode) : `conflict_${idx}`
            return (
              <div key={keyStr} className="text-[10px] leading-4" style={{ color: WA.textDark }}>
                {formatLifecycleConflict(item)}
              </div>
            )
          })}
        </div>
      )}
      {lifecycleOption0 && (
        <div className="mt-2 rounded-[16px] border p-2.5 space-y-1.5" style={{ background: WA.shellPanelMuted, borderColor: WA.borderLight }}>
          <div className="text-[10px] font-semibold tracking-wide" style={{ color: WA.textMuted }}>
            {lifecycleOption0.label}
          </div>
          <div className="text-[10px] leading-4" style={{ color: WA.textDark }}>
            {lifecycleOption0.next_action_template}
          </div>
          {lifecycleOption0.next_action_template_en && (
            <div className="text-[10px] leading-4" style={{ color: WA.textMuted }}>
              EN: {lifecycleOption0.next_action_template_en}
            </div>
          )}
          <button
            onClick={handleApplyLifecycleOption0}
            className="px-2.5 py-1.5 rounded-lg text-[10px] font-semibold text-white"
            style={{ background: WA.teal }}
          >
            应用到下一步策略
          </button>
        </div>
      )}
      <div className="mt-2 rounded-[16px] border p-2.5 space-y-1.5" style={{ borderColor: WA.borderLight, background: WA.shellPanelMuted }}>
        <div className="text-[10px] font-semibold" style={{ color: WA.textMuted }}>
          历史阶段迁移轨迹
          {lifecycleHistorySource && (
            <span className="ml-1" style={{ color: WA.textMuted }}>
              · {lifecycleHistorySource === 'transition_table' ? 'transition table' : 'audit log fallback'}
            </span>
          )}
        </div>
        {lifecycleHistoryLoading && (
          <div className="text-[10px]" style={{ color: WA.textMuted }}>加载中...</div>
        )}
        {!lifecycleHistoryLoading && lifecycleHistoryError && (
          <div className="text-[10px]" style={{ color: '#ef4444' }}>{lifecycleHistoryError}</div>
        )}
        {!lifecycleHistoryLoading && !lifecycleHistoryError && lifecycleTransitions.length === 0 && (
          <div className="text-[10px]" style={{ color: WA.textMuted }}>暂无迁移记录</div>
        )}
        {!lifecycleHistoryLoading && !lifecycleHistoryError && lifecycleTransitions.length > 0 && (
          <div className="space-y-1.5">
            {lifecycleTransitions.map((item, idx) => (
              <div
                key={`${item.id || idx}_${item.at || ''}`}
                className="rounded-lg px-2 py-1.5"
                style={{ background: idx === lifecycleTransitions.length - 1 ? 'rgba(15,118,110,0.10)' : WA.white, border: `1px solid ${WA.borderLight}` }}
              >
                <div className="text-[10px] font-semibold leading-4" style={{ color: WA.textDark }}>
                  {formatLifecycleTransitionLabel(item)}
                </div>
                <div className="text-[10px] leading-4" style={{ color: WA.textMuted }}>
                  {formatLifecycleTransitionSource(item)} · {formatLifecycleTransitionTime(item?.at)}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </DetailCard>
  )

  const profileManagerPanel = profileExpanded && (
    <div
      className="mt-2 p-3 rounded-[18px] space-y-3 text-[12px]"
      style={{ background: WA.white, border: `1px solid ${WA.borderLight}` }}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[12px] font-semibold tracking-wide" style={{ color: WA.textMuted }}>画像管理</span>
          {clientProfile?.portrait_source && (
            <span
              className="text-[12px] px-2 py-0.5 rounded-full"
              style={{
                background: clientProfile.portrait_source === 'manual' ? 'rgba(15,118,110,0.12)' : WA.shellPanelMuted,
                color: clientProfile.portrait_source === 'manual' ? WA.teal : WA.textMuted,
              }}
            >
              来源: {clientProfile.portrait_source === 'manual' ? '手动' : '系统'}
            </span>
          )}
        </div>
        <button
          onClick={() => fetchClientProfile()}
          disabled={profileRefreshing}
          className="text-[12px] px-2 py-1 rounded hover:opacity-80 transition-opacity"
          style={{ color: profileRefreshing ? WA.textMuted : WA.teal }}
        >
          {profileRefreshing ? '刷新中...' : '🔄 刷新'}
        </button>
      </div>

      <div className="rounded-[16px] border p-2.5 space-y-1.5" style={{ background: WA.shellPanelMuted, borderColor: WA.borderLight }}>
        <div className="text-[12px] font-semibold" style={{ color: WA.textMuted }}>AI 摘要</div>
        {clientProfile?.summary ? (
          <div className="text-[12px] leading-6 py-2.5 px-3 rounded-xl" style={{ background: WA.white, color: WA.textDark, border: `1px solid ${WA.borderLight}` }}>
            {clientProfile.summary}
          </div>
        ) : (
          <div className="text-[12px]" style={{ color: WA.textMuted }}>暂无摘要</div>
        )}
      </div>

      <div className="rounded-[16px] border p-2.5 space-y-2" style={{ background: WA.shellPanelMuted, borderColor: WA.borderLight }}>
        <div className="text-[12px] font-semibold" style={{ color: WA.textMuted }}>沟通画像字段</div>
        <div className="space-y-2">
          {PORTRAIT_FIELD_CONFIG.map((field) => {
            const fieldValue = portraitDraft?.[field.key] || { value: '', confidence: 2, evidence: '' }
            return (
              <div
                key={field.key}
                className="rounded-xl p-3 space-y-2"
                style={{ background: WA.white, border: `1px solid ${WA.borderLight}` }}
              >
                <div className="text-[12px] font-semibold" style={{ color: WA.textDark }}>{field.label}</div>
                <div className="text-[12px] leading-5" style={{ color: WA.textMuted }}>{field.hint}</div>
                <div className="grid grid-cols-3 gap-1.5">
                  <select
                    className="text-[12px] px-2.5 py-2 rounded-lg border h-10"
                    style={{ borderColor: WA.borderLight, background: WA.white, color: WA.textDark, fontSize: 12 }}
                    value={fieldValue.value || ''}
                    onChange={(e) => updatePortraitField(field.key, { value: e.target.value })}
                  >
                    <option value="">未设置</option>
                    {field.options.map(([value, label]) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                  <select
                    className="text-[12px] px-2.5 py-2 rounded-lg border h-10"
                    style={{ borderColor: WA.borderLight, background: WA.white, color: WA.textDark, fontSize: 12 }}
                    value={Number(fieldValue.confidence) || 2}
                    onChange={(e) => updatePortraitField(field.key, { confidence: Number(e.target.value) || 2 })}
                  >
                    <option value={1}>置信度 1</option>
                    <option value={2}>置信度 2</option>
                    <option value={3}>置信度 3</option>
                  </select>
                  <input
                    className="text-[12px] px-2.5 py-2 rounded-lg border h-10"
                    style={{ borderColor: WA.borderLight, background: WA.white, color: WA.textDark, fontSize: 12 }}
                    value={fieldValue.evidence || ''}
                    onChange={(e) => updatePortraitField(field.key, { evidence: e.target.value })}
                    placeholder="证据消息片段"
                  />
                </div>
              </div>
            )
          })}
          <div className="flex items-center gap-2 pt-1">
            <button
              onClick={handleSavePortrait}
              disabled={portraitSaving || !portraitDirty}
              className="px-3.5 py-2 rounded-xl text-[12px] font-medium text-white"
              style={{ background: (portraitSaving || !portraitDirty) ? '#9ca3af' : WA.teal }}
            >
              {portraitSaving ? '保存中...' : '保存画像'}
            </button>
            <button
              onClick={() => setPortraitDraft(buildPortraitDraft(clientProfile?.portrait || null))}
              disabled={portraitSaving || !portraitDirty}
              className="px-3.5 py-2 rounded-xl text-[12px] font-medium"
              style={{ background: WA.white, color: WA.textMuted, border: `1px solid ${WA.borderLight}` }}
            >
              撤销修改
            </button>
          </div>
          {portraitError && (
            <div className="text-[12px]" style={{ color: '#ef4444' }}>{portraitError}</div>
          )}
        </div>
      </div>

    </div>
  )

  const financialPanel = activeManageTab === 'finance' && (
    <div
      className="mt-2 p-2.5 rounded-2xl space-y-2"
      style={{ background: WA.white, border: `1px solid ${WA.borderLight}` }}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[10px] font-semibold tracking-wide" style={{ color: WA.textMuted }}>财务面板</span>
          <span className="text-[9px] px-1.5 py-0.5 rounded-full" style={{ background: WA.white, color: WA.textMuted }}>
            {wacrm.monthly_fee_status || 'pending'}
          </span>
          <span className="text-[9px] px-1.5 py-0.5 rounded-full" style={{ background: 'rgba(16,185,129,0.12)', color: '#10b981' }}>
            {wacrm.monthly_fee_amount ? `$${wacrm.monthly_fee_amount}` : '$0'}
          </span>
        </div>
      </div>
      <InlineEditField compact label="Beta 子流程" value={editForm.beta_status || ''} onChange={v => setEditForm(f => ({ ...f, beta_status: v }))} type="select" options={[['not_introduced', '未引入'], ['introduced', '已引入'], ['churned', '流失']]} />
      <InlineEditField compact label="月费" value={editForm.monthly_fee_status || ''} onChange={v => setEditForm(f => ({ ...f, monthly_fee_status: v }))} type="select" options={[['pending', '待支付'], ['paid', '已支付'], ['overdue', '逾期']]} />
      <InlineEditField compact label="金额" value={String(editForm.monthly_fee_amount || 0)} onChange={v => setEditForm(f => ({ ...f, monthly_fee_amount: parseFloat(v) || 0 }))} type="number" />
      <div className="flex justify-end pt-1">
        <button
          onClick={handleEditSave}
          disabled={editSaving}
          className="px-3 py-1.5 rounded-xl text-[9px] font-medium text-white"
          style={{ background: editSaving ? '#9ca3af' : WA.teal }}
        >
          {editSaving ? '保存中...' : '保存财务'}
        </button>
      </div>
    </div>
  )

  const keeperPanel = activeManageTab === 'keeper' && (
    <div
      className="mt-2 p-2.5 rounded-2xl space-y-2"
      style={{ background: WA.white, border: `1px solid ${WA.borderLight}` }}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[10px] font-semibold tracking-wide" style={{ color: WA.textMuted }}>Keeper 面板</span>
          <span className="text-[9px] px-1.5 py-0.5 rounded-full" style={{ background: WA.white, color: WA.textMuted }}>
            GMV {displayKeeper.keeper_gmv ? `$${Number(displayKeeper.keeper_gmv).toLocaleString()}` : '$0'}
          </span>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <InlineEditField compact label="GMV" value={String(editForm.keeper_gmv || 0)} onChange={v => setEditForm(f => ({ ...f, keeper_gmv: parseFloat(v) || 0 }))} type="number" />
        <InlineEditField compact label="30天GMV" value={String(editForm.keeper_gmv30 || 0)} onChange={v => setEditForm(f => ({ ...f, keeper_gmv30: parseFloat(v) || 0 }))} type="number" />
        <InlineEditField compact label="视频总数" value={String(editForm.keeper_videos || 0)} onChange={v => setEditForm(f => ({ ...f, keeper_videos: parseInt(v) || 0 }))} type="number" />
        <InlineEditField compact label="视频发布" value={String(editForm.keeper_videos_posted || 0)} onChange={v => setEditForm(f => ({ ...f, keeper_videos_posted: parseInt(v) || 0 }))} type="number" />
        <InlineEditField compact label="视频售出" value={String(editForm.keeper_videos_sold || 0)} onChange={v => setEditForm(f => ({ ...f, keeper_videos_sold: parseInt(v) || 0 }))} type="number" />
        <InlineEditField compact label="订单数" value={String(editForm.keeper_orders || 0)} onChange={v => setEditForm(f => ({ ...f, keeper_orders: parseInt(v) || 0 }))} type="number" />
        <InlineEditField compact label="橱窗转化率" value={editForm.keeper_card_rate || ''} onChange={v => setEditForm(f => ({ ...f, keeper_card_rate: v }))} type="text" />
        <InlineEditField compact label="订单转化率" value={editForm.keeper_order_rate || ''} onChange={v => setEditForm(f => ({ ...f, keeper_order_rate: v }))} type="text" />
      </div>
      <div className="flex justify-end pt-1">
        <button
          onClick={handleEditSave}
          disabled={editSaving}
          className="px-3 py-1.5 rounded-xl text-[9px] font-medium text-white"
          style={{ background: editSaving ? '#9ca3af' : WA.teal }}
        >
          {editSaving ? '保存中...' : '保存 Keeper'}
        </button>
      </div>
    </div>
  )

  const quickEditPanel = activeManageTab === 'edit' && (
    <div
      className="mt-2 p-2.5 rounded-2xl space-y-2"
      style={{ background: WA.white, border: `1px solid ${WA.borderLight}` }}
    >
      <div className="text-[10px] font-semibold tracking-wide mb-1" style={{ color: WA.textMuted }}>编辑达人</div>
      <InlineEditField compact label="姓名" value={editForm.primary_name || ''} onChange={v => setEditForm(f => ({ ...f, primary_name: v }))} type="text" />
      <InlineEditField compact label="电话" value={editForm.wa_phone || ''} onChange={v => setEditForm(f => ({ ...f, wa_phone: v }))} type="text" />
      <InlineEditField compact label="负责人" value={editForm.wa_owner || ''} onChange={v => setEditForm(f => ({ ...f, wa_owner: v }))} type="select" options={OWNER_ORDER.map(owner => [owner, owner])} />
      <InlineEditField compact label="Keeper" value={editForm.keeper_username || ''} onChange={v => setEditForm(f => ({ ...f, keeper_username: v }))} type="text" />
      <InlineEditField compact label="优先级" value={editForm.priority || ''} onChange={v => setEditForm(f => ({ ...f, priority: v }))} type="select" options={[['normal', '普通'], ['high', '高'], ['urgent', '紧急']]} />
      <InlineEditField compact label="Agency" value={editForm.agency_bound || '0'} onChange={v => setEditForm(f => ({ ...f, agency_bound: v }))} type="select" options={[['0', '否'], ['1', '是']]} />
      <InlineEditField compact label="视频数" value={String(editForm.video_count || 0)} onChange={v => setEditForm(f => ({ ...f, video_count: parseInt(v) || 0 }))} type="number" />
      <InlineEditField compact label="目标" value={String(editForm.video_target || 35)} onChange={v => setEditForm(f => ({ ...f, video_target: parseInt(v) || 35 }))} type="number" />
      <div>
        <div className="text-[9px] mb-0.5 font-medium" style={{ color: WA.textMuted }}>下一步策略选择</div>
        <textarea
          className="w-full text-[9px] px-2 py-1.5 rounded-xl border focus:outline-none focus:ring-2 resize-none"
          style={{ borderColor: WA.borderLight, background: WA.white, color: '#111b21' }}
          rows={2}
          value={editForm.next_action || ''}
          onChange={e => setEditForm(f => ({ ...f, next_action: e.target.value }))}
          placeholder="记录下一步策略或跟进计划..."
        />
        {lifecycleOption0 && (
          <div className="mt-1.5 space-y-1">
            <div className="flex flex-wrap gap-1">
              <button
                onClick={handleApplyLifecycleOption0}
                className="text-[9px] px-2 py-1 rounded-full border"
                style={{ borderColor: WA.teal, background: 'rgba(0,168,132,0.08)', color: WA.teal }}
                title={lifecycleOption0.next_action_template_en || ''}
              >
                采用：{lifecycleOption0.label}
              </button>
            </div>
            {lifecycleOption0.next_action_template_en && (
              <div className="text-[9px]" style={{ color: WA.textMuted }}>
                English playbook: {lifecycleOption0.next_action_template_en}
              </div>
            )}
          </div>
        )}
        {!isAgencyBound && (
          <div className="mt-1.5 space-y-1">
            <div className="flex flex-wrap gap-1">
              {agencyStrategies.map((strategy) => (
                <button
                  key={strategy.id}
                  onClick={() => setEditForm(f => ({ ...f, next_action: strategy.nextActionTemplate }))}
                  className="text-[9px] px-2 py-1 rounded-full border"
                  style={{ borderColor: WA.borderLight, background: WA.white, color: WA.textDark }}
                  title={`${strategy.shortDesc}\n${strategy.nextActionTemplateEn}`}
                >
                  填充：{strategy.name}
                </button>
              ))}
            </div>
            {activeAgencyStrategy && (
              <div className="text-[9px]" style={{ color: WA.textMuted }}>
                推荐策略：{activeAgencyStrategy.name}（{activeAgencyStrategy.nameEn}）
              </div>
            )}
          </div>
        )}
        <div className="mt-2 rounded-xl border px-2 py-1.5" style={{ borderColor: WA.borderLight, background: 'rgba(255,255,255,0.72)' }}>
          <button
            type="button"
            onClick={() => setStrategyPresetExpanded(v => !v)}
            className="w-full flex items-center justify-between text-left"
            style={{ color: WA.textMuted }}
          >
            <span className="text-[9px] font-medium">可选择策略预设</span>
            <span className="text-[9px]" style={{ color: WA.teal }}>
              {strategyPresetExpanded ? '收起' : '展开'}
            </span>
          </button>
          {strategyPresetExpanded && (
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {STRATEGY_PRESET_OPTIONS.map(([key, desc]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setEditForm(f => ({ ...f, next_action: desc }))}
                  className="text-[9px] px-2 py-1 rounded-full border"
                  style={{ borderColor: WA.teal, color: WA.textDark, background: 'rgba(0,168,132,0.04)' }}
                  title={desc}
                >
                  {key}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="border-t pt-2 mt-1" style={{ borderColor: WA.borderLight }}>
        <div className="text-[9px] font-semibold mb-1.5 tracking-wide" style={{ color: WA.textMuted }}>事件标签</div>
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <span className="text-[9px] w-20 shrink-0" style={{ color: WA.textMuted }}>挑战阶段</span>
            <select
              value={editForm.ev_trial_active ? 'active' : (editForm.ev_monthly_started ? 'monthly' : 'none')}
              onChange={e => {
                const v = e.target.value
                setEditForm(f => ({
                  ...f,
                  ev_trial_active: v === 'active',
                  ev_monthly_started: v === 'monthly',
                }))
              }}
              className="flex-1 text-[9px] px-2 py-1.5 rounded-xl border"
              style={{ borderColor: WA.borderLight, background: WA.white, color: WA.textDark }}
            >
              <option value="none">无</option>
              <option value="active">七日挑战进行中</option>
              <option value="monthly">开启月度挑战</option>
            </select>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[9px] w-20 shrink-0" style={{ color: WA.textMuted }}>GMV 阶段</span>
            <select
              value={editForm.ev_gmv_10k ? '10k' : (editForm.ev_gmv_5k ? '5k' : (editForm.ev_gmv_2k ? '2k' : (editForm.ev_gmv_1k ? '1k' : 'none')))}
              onChange={e => {
                const v = e.target.value
                setEditForm(f => ({
                  ...f,
                  ev_gmv_1k: v === '1k',
                  ev_gmv_2k: v === '2k',
                  ev_gmv_5k: v === '5k',
                  ev_gmv_10k: v === '10k',
                }))
              }}
              className="flex-1 text-[9px] px-2 py-1.5 rounded-xl border"
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
            <span className="text-[9px] w-20 shrink-0" style={{ color: WA.textMuted }}>状态</span>
            <select
              value={editForm.ev_churned ? 'churned' : (editForm.ev_agency_bound ? 'agency' : 'active')}
              onChange={e => {
                const v = e.target.value
                setEditForm(f => ({
                  ...f,
                  ev_agency_bound: v === 'agency',
                  ev_churned: v === 'churned',
                }))
              }}
              className="flex-1 text-[9px] px-2 py-1.5 rounded-xl border"
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
          className="flex-1 py-1.5 rounded-xl text-[9px] font-medium text-white"
          style={{ background: editSaving ? '#9ca3af' : WA.teal }}
        >
          {editSaving ? '保存中...' : '保存'}
        </button>
        <button
          onClick={() => setEditForm(editFormInitial)}
          className="px-3 py-1.5 rounded-xl text-[9px] font-medium"
          style={{ background: WA.borderLight, color: WA.textMuted }}
        >
          重置
        </button>
      </div>
    </div>
  )

  const strategyScores = strategyInsight?.scores || {}
  const secondaryScore = Number.isFinite(Number(strategyScores.secondary)) ? Number(strategyScores.secondary) : 0
  const recallScore = Number.isFinite(Number(strategyScores.recall)) ? Number(strategyScores.recall) : 0
  const scoreMax = Math.max(secondaryScore, recallScore, 1)
  const strategyReasons = Array.isArray(strategyInsight?.reasons) ? strategyInsight.reasons.slice(0, 6) : []
  const strategyCurrentName = strategyInsight?.current_strategy?.name || strategyInsight?.current_strategy?.memory_key || '未写入'
  const strategyRecommendedName = strategyInsight?.recommended_strategy?.name || '-'

  const strategyPanel = (
    <DetailCard title="回复策略" className="space-y-2">
      <div className="rounded-xl p-2 space-y-1.5" style={{ border: `1px solid ${WA.borderLight}`, background: 'rgba(255,255,255,0.68)' }}>
        <div className="flex items-center justify-between">
          <div className="text-[9px] font-semibold" style={{ color: WA.textMuted }}>当前自动策略原因 / 打分</div>
          <div className="flex gap-1">
            <button
              onClick={() => fetchStrategyInsight(false)}
              disabled={strategyInsightLoading}
              className="text-[9px] px-2 py-1 rounded-full border"
              style={{ borderColor: WA.borderLight, color: WA.textMuted, background: WA.white }}
            >
              {strategyInsightLoading ? '加载中' : '刷新'}
            </button>
            <button
              onClick={handleRebuildReplyStrategy}
              disabled={strategyRebuilding}
              className="text-[9px] px-2 py-1 rounded-full text-white"
              style={{ background: strategyRebuilding ? '#9ca3af' : WA.teal }}
            >
              {strategyRebuilding ? '重算中' : '自动重算'}
            </button>
          </div>
        </div>
        {strategyInsightError && (
          <div className="text-[9px]" style={{ color: '#ef4444' }}>{strategyInsightError}</div>
        )}
        {!strategyInsightLoading && strategyInsight && (
          <div className="space-y-1.5">
            <div className="grid grid-cols-2 gap-1">
              <InfoChip label="当前" value={strategyCurrentName} />
              <InfoChip label="推荐" value={strategyRecommendedName} />
              <InfoChip label="阶段" value={strategyInsight.lifecycle_label || strategyInsight.lifecycle_stage || '-'} />
              <InfoChip label="Owner" value={strategyInsight.owner || '-'} />
            </div>
            <ScoreBar label="二次触达" value={secondaryScore} max={scoreMax} />
            <ScoreBar label="待召回" value={recallScore} max={scoreMax} />
            {strategyInsight.missing && (
              <div className="text-[9px]" style={{ color: '#f59e0b' }}>
                当前缺失自动策略，建议点击“自动重算”补齐。
              </div>
            )}
            {strategyInsight.current_strategy?.auto_meta?.trigger && (
              <div className="text-[9px]" style={{ color: WA.textMuted }}>
                最近触发：{strategyInsight.current_strategy.auto_meta.trigger}
              </div>
            )}
            {strategyReasons.length > 0 && (
              <div className="space-y-1">
                {strategyReasons.map((reason, idx) => (
                  <div key={`${idx}_${reason}`} className="text-[9px] leading-4" style={{ color: WA.textDark }}>
                    {idx + 1}. {reason}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {!isAgencyBound && (
        <div className="space-y-1.5">
          <div className="text-[9px] font-semibold" style={{ color: WA.teal }}>未绑定Agency专属策略</div>
          <div className="flex flex-wrap gap-1.5">
            {agencyStrategies.map((strategy) => (
              <button
                key={strategy.id}
                onClick={() => addStrategyMemory(strategy.memoryKey, strategy.memoryValue)}
                className="text-[9px] px-2 py-1 rounded-full border"
                style={{ borderColor: WA.teal, color: WA.teal, background: 'rgba(0,168,132,0.08)' }}
                title={strategy.shortDesc}
              >
                + {strategy.name}
              </button>
            ))}
          </div>
          {activeAgencyStrategy && (
            <div className="text-[9px]" style={{ color: WA.textMuted }}>
              当前策略：{activeAgencyStrategy.name} / {activeAgencyStrategy.nameEn}
            </div>
          )}
        </div>
      )}

      {clientProfile?.memory?.filter(m => m.type === 'strategy').length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {clientProfile.memory.filter(m => m.type === 'strategy').map((m, i) => (
            <span key={i} className="flex items-center gap-1 text-[9px] px-2 py-1 rounded-full" style={{ background: 'rgba(0,168,132,0.12)', color: WA.teal }}>
              {m.key}
              <button onClick={() => deleteStrategyMemory(m.key)} className="text-red-400 hover:text-red-600 font-bold ml-0.5">×</button>
            </span>
          ))}
        </div>
      )}
    </DetailCard>
  )

  const eventsPanel = (
    <div className="space-y-2">
      <CreatorEventsSection creatorId={creatorId} />
    </div>
  )

  const detailTabNav = (
    <div className="grid grid-cols-4 gap-1.5">
      {CONTEXT_TABS.map((tab) => (
        <button
          key={tab.key}
          type="button"
          onClick={() => handleSelectContextTab(tab.key)}
          className="px-2.5 py-2 rounded-full text-[11px] font-semibold transition-all"
          style={{
            background: activeContextTab === tab.key ? WA.white : 'rgba(255,255,255,0.4)',
            color: activeContextTab === tab.key ? WA.textDark : WA.textMuted,
            border: `1px solid ${activeContextTab === tab.key ? WA.borderLight : 'rgba(230,223,210,0.65)'}`,
            boxShadow: activeContextTab === tab.key ? '0 6px 18px rgba(31,29,26,0.08)' : 'none',
          }}
        >
          {tab.label}
        </button>
      ))}
    </div>
  )

  const overviewPanel = (
    <div className="space-y-3">
      {lifecyclePanel}
      <DetailCard title="当前档案" className="space-y-2">
        <div className="grid grid-cols-2 gap-2">
          <OverviewFieldCluster
            title="状态"
            rows={[
              ['优先级', wacrm.priority || '-'],
              ['Agency 绑定', wacrm.agency_bound ? '✓ 是' : '✗ 否'],
              ['视频进度', wacrm.video_count ? `${wacrm.video_count} / ${wacrm.video_target || 35}` : '-'],
              ['下一步', wacrm.next_action || '-'],
            ]}
          />
          <OverviewFieldCluster
            title="基本信息"
            rows={[
              ['电话', displayPhone],
              ['Keeper', displayKeeperUsername],
              ['负责人', displayOwner],
              ['Beta 子流程', wacrm.beta_status || '-'],
            ]}
          />
        </div>
      </DetailCard>
      <div className="space-y-3">
        <ActionPill
          label={profileExpanded ? '收起画像管理' : '画像管理'}
          icon={profileExpanded ? '▲' : '👩‍🦰'}
          color={detailStatusMeta.accent === 'transparent' ? WA.teal : detailStatusMeta.accent}
          onClick={() => setProfileExpanded(v => !v)}
        />
        {profileManagerPanel}
      </div>
    </div>
  )

  const operationsPanel = (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-1.5">
        <ManagementTabButton
          active={activeManageTab === 'edit'}
          label="编辑达人"
          icon="✏️"
          color="#3b82f6"
          onClick={() => {
            if (activeManageTab === 'edit') {
              setActiveManageTab(null)
              return
            }
            handleEditOpen()
          }}
        />
        <ManagementTabButton
          active={activeManageTab == null || activeManageTab === 'edit'}
          label="回复策略"
          icon="🧠"
          color="#0f766e"
          onClick={() => {
            if (activeManageTab === 'edit') {
              setActiveManageTab(null)
              return
            }
            handleEditOpen()
          }}
        />
      </div>
      {quickEditPanel}
      {strategyPanel}
    </div>
  )

  const dataPanel = (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-1.5">
        <ManagementTabButton
          active={activeManageTab === 'finance'}
          label="财务面板"
          icon="💳"
          color="#0f766e"
          onClick={() => {
            if (activeManageTab === 'finance') {
              setActiveManageTab(null)
              return
            }
            setActiveManageTab('finance')
          }}
        />
        <ManagementTabButton
          active={activeManageTab === 'keeper'}
          label="Keeper 面板"
          icon="📈"
          color="#2563eb"
          onClick={() => {
            if (activeManageTab === 'keeper') {
              setActiveManageTab(null)
              return
            }
            setActiveManageTab('keeper')
          }}
        />
      </div>
      {activeManageTab !== 'finance' && activeManageTab !== 'keeper' && (
        <div
          className="rounded-2xl px-3 py-3 text-[11px]"
          style={{ background: 'rgba(255,255,255,0.7)', border: `1px solid ${WA.borderLight}`, color: WA.textMuted }}
        >
          选择一个数据面板查看并编辑财务或 Keeper 指标。
        </div>
      )}
      {financialPanel}
      {keeperPanel}
    </div>
  )

  const contextTabContent = (
    activeContextTab === 'events'
      ? eventsPanel
      : activeContextTab === 'operations'
        ? operationsPanel
        : activeContextTab === 'data'
          ? dataPanel
          : overviewPanel
  )

  return (
    <>
      {/* Desktop: as a resizable panel — no overlay */}
      {asPanel ? (
        collapsed ? (
          <div className="flex h-full justify-end pr-1.5 py-4" style={{ background: WA.chatBg, borderLeft: `1px solid ${WA.borderLight}` }}>
            <button
              type="button"
              onClick={() => {
                onExpand?.()
                onTogglePin?.()
              }}
              className="flex h-full w-4 items-center justify-center rounded-full transition-all hover:opacity-85"
              style={{
                background: pinned ? WA.teal + '26' : 'rgba(255,255,255,0.55)',
                color: pinned ? WA.teal : WA.textMuted,
                boxShadow: 'inset 0 0 0 1px rgba(148,163,184,0.12)',
              }}
              title={pinned ? '固定展开中栏' : `展开 ${displayName}`}
            >
              <span className="text-base font-semibold leading-none">‹</span>
            </button>
          </div>
        ) : (
        <div className="flex flex-col h-full" style={{ background: WA.chatBg, borderLeft: `1px solid ${WA.borderLight}` }}>
          {/* Header */}
          <div className="flex items-center gap-3 px-5 py-4" style={{ background: WA.chatBg, borderBottom: `1px solid ${WA.borderLight}` }}>
            <button onClick={onClose} className="text-black/45 hover:text-black/70 text-xl">←</button>
            <div className="w-11 h-11 rounded-full flex items-center justify-center text-white font-bold text-lg" style={{ background: WA.teal }}>
              {(displayName || '?')[0]?.toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-semibold text-lg truncate" style={{ color: WA.textDark }}>{displayName}</div>
              <div className="text-sm" style={{ color: WA.textMuted }}>{displayPhone}</div>
            </div>
            {v1DashboardUrl && (
              <a
                href={v1DashboardUrl}
                target="_blank"
                rel="noreferrer"
                className="rounded-full px-3 py-1.5 text-sm font-semibold transition-all hover:opacity-85"
                style={{ background: 'rgba(0,168,132,0.10)', color: WA.teal }}
                title="在 V1 看板打开该达人"
              >
                V1看板
              </a>
            )}
            <button
              type="button"
              onClick={onTogglePin}
              className="rounded-full px-3 py-1.5 text-sm font-semibold transition-all hover:opacity-85"
              style={{ background: pinned ? 'rgba(0,168,132,0.18)' : 'rgba(255,255,255,0.55)', color: pinned ? WA.teal : WA.textMuted }}
              title={pinned ? '取消固定' : '固定中栏'}
            >
              {pinned ? '已固定' : '固定'}
            </button>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            <div className="grid grid-cols-4 gap-2">
              <MiniStat label="消息" value={creator?.msg_count || 0} />
              <MiniStat label="GMV" value={displayCreator?.keeper_gmv ? '$' + Number(displayCreator?.keeper_gmv).toLocaleString() : '-'} />
              <MiniStat label="30天GMV" value={displayCreator?.keeper_gmv30 ? '$' + Number(displayCreator?.keeper_gmv30).toLocaleString() : '-'} />
              <MiniStat label="事件评分" value={wacrm.event_score != null ? wacrm.event_score.toFixed(1) : '-'} />
              <MiniStat label="紧急度" value={wacrm.urgency_level != null ? wacrm.urgency_level : '-'} />
              <MiniStat label="视频数" value={displayKeeper?.keeper_videos || '-'} />
              <MiniStat label="已发布" value={displayKeeper?.keeper_videos_posted || '-'} />
              <MiniStat label="已售出" value={displayKeeper?.keeper_videos_sold || '-'} />
            </div>
            {detailTabNav}
            {contextTabContent}
          </div>
        </div>
        )
      ) : (
        <>
          {/* Desktop overlay + sidebar */}
          <div className="fixed inset-0 bg-black/30 z-40 hidden md:block" onClick={onClose} />
          <div className="fixed right-0 top-0 h-full w-full z-50 hidden md:flex">

            {/* Desktop Info sidebar */}
            <div className="w-72 shrink-0 flex flex-col h-full" style={{ background: WA.white }}>
              <div className="flex items-center gap-3 px-5 py-4" style={{ background: WA.darkHeader }}>
                <button onClick={onClose} className="text-white/70 hover:text-white text-xl">←</button>
                <div className="w-11 h-11 rounded-full flex items-center justify-center text-white font-bold text-lg" style={{ background: WA.teal }}>
                  {(displayName || '?')[0]?.toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-lg text-white truncate">{displayName}</div>
                  <div className="text-sm text-white/50">{displayPhone}</div>
                </div>
                {v1DashboardUrl && (
                  <a
                    href={v1DashboardUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-full px-3 py-1.5 text-sm font-semibold transition-all hover:opacity-85"
                    style={{ background: 'rgba(255,255,255,0.16)', color: '#fff' }}
                    title="在 V1 看板打开该达人"
                  >
                    V1看板
                  </a>
                )}
              </div>

              <div className="flex-1 overflow-y-auto p-5 space-y-5">
                <div className="grid grid-cols-4 gap-3">
                  <MiniStat label="消息" value={creator?.msg_count || 0} />
                  <MiniStat label="GMV" value={displayCreator?.keeper_gmv ? '$' + Number(displayCreator?.keeper_gmv).toLocaleString() : '-'} />
                  <MiniStat label="30天GMV" value={displayCreator?.keeper_gmv30 ? '$' + Number(displayCreator?.keeper_gmv30).toLocaleString() : '-'} />
                  <MiniStat label="事件评分" value={wacrm.event_score != null ? wacrm.event_score.toFixed(1) : '-'} />
                  <MiniStat label="紧急度" value={wacrm.urgency_level != null ? wacrm.urgency_level : '-'} />
                  <MiniStat label="视频总数" value={displayKeeper?.keeper_videos || '-'} />
                  <MiniStat label="视频发布" value={displayKeeper?.keeper_videos_posted || '-'} />
                  <MiniStat label="视频售出" value={displayKeeper?.keeper_videos_sold || '-'} />
                </div>
                {detailTabNav}
                {contextTabContent}
              </div>
            </div>

            {/* Desktop Message composer */}
            <div className="flex-1 flex flex-col min-w-0" style={{ background: WA.chatBg }}>
              <WAMessageComposer client={clientInfo} creator={creator} onClose={onClose} onMessageSent={onMessageSent} />
            </div>
          </div>

          {/* Mobile: just the chat composer (header is in App's main panel) */}
          <div className="flex-1 flex flex-col md:hidden" style={{ background: WA.chatBg }}>
            <WAMessageComposer client={clientInfo} creator={creator} onClose={onClose} onMessageSent={onMessageSent} />
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
                <span className="text-xl">✏️</span>
                <span className="font-semibold text-white">编辑达人</span>
              </div>
              <button onClick={() => setShowEdit(false)} className="text-white/60 hover:text-white text-xl">✕</button>
            </div>

            {/* 弹窗表单 */}
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-semibold mb-1.5" style={{ color: WA.textMuted }}>姓名</label>
                <input
                  className="w-full text-base px-3 py-2.5 rounded-xl border focus:outline-none focus:ring-2"
                  style={{ borderColor: WA.borderLight, background: WA.lightBg }}
                  value={editForm.primary_name}
                  onChange={e => setEditForm(f => ({ ...f, primary_name: e.target.value }))}
                />
              </div>
              <div>
                <label className="block text-sm font-semibold mb-1.5" style={{ color: WA.textMuted }}>电话</label>
                <input
                  className="w-full text-base px-3 py-2.5 rounded-xl border focus:outline-none focus:ring-2"
                  style={{ borderColor: WA.borderLight, background: WA.lightBg }}
                  value={editForm.wa_phone}
                  onChange={e => setEditForm(f => ({ ...f, wa_phone: e.target.value }))}
                />
              </div>
              <div>
                <label className="block text-sm font-semibold mb-1.5" style={{ color: WA.textMuted }}>负责人</label>
                <select
                  className="w-full text-base px-3 py-2.5 rounded-xl border focus:outline-none focus:ring-2"
                  style={{ borderColor: WA.borderLight, background: WA.lightBg }}
                  value={editForm.wa_owner}
                  onChange={e => setEditForm(f => ({ ...f, wa_owner: e.target.value }))}
                >
                  {OWNER_ORDER.map(owner => (
                    <option key={owner} value={owner}>{owner}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-semibold mb-1.5" style={{ color: WA.textMuted }}>Keeper</label>
                <input
                  className="w-full text-base px-3 py-2.5 rounded-xl border focus:outline-none focus:ring-2"
                  style={{ borderColor: WA.borderLight, background: WA.lightBg }}
                  value={editForm.keeper_username}
                  onChange={e => setEditForm(f => ({ ...f, keeper_username: e.target.value }))}
                />
              </div>
              <div>
                <label className="block text-sm font-semibold mb-1.5" style={{ color: WA.textMuted }}>优先级</label>
                <select
                  className="w-full text-base px-3 py-2.5 rounded-xl border focus:outline-none focus:ring-2"
                  style={{ borderColor: WA.borderLight, background: WA.lightBg }}
                  value={editForm.priority}
                  onChange={e => setEditForm(f => ({ ...f, priority: e.target.value }))}
                >
                  <option value="normal">普通</option>
                  <option value="high">高</option>
                  <option value="urgent">紧急</option>
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-semibold mb-1.5" style={{ color: WA.textMuted }}>Agency绑定</label>
                  <select
                    className="w-full text-base px-3 py-2.5 rounded-xl border focus:outline-none focus:ring-2"
                    style={{ borderColor: WA.borderLight, background: WA.lightBg }}
                    value={editForm.agency_bound}
                    onChange={e => setEditForm(f => ({ ...f, agency_bound: e.target.value }))}
                  >
                    <option value="0">否</option>
                    <option value="1">是</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-semibold mb-1.5" style={{ color: WA.textMuted }}>视频数</label>
                  <input
                    type="number"
                    className="w-full text-base px-3 py-2.5 rounded-xl border focus:outline-none focus:ring-2"
                    style={{ borderColor: WA.borderLight, background: WA.lightBg }}
                    value={editForm.video_count}
                    onChange={e => setEditForm(f => ({ ...f, video_count: e.target.value }))}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-semibold mb-1.5" style={{ color: WA.textMuted }}>目标</label>
                  <input
                    type="number"
                    className="w-full text-base px-3 py-2.5 rounded-xl border focus:outline-none focus:ring-2"
                    style={{ borderColor: WA.borderLight, background: WA.lightBg }}
                    value={editForm.video_target}
                    onChange={e => setEditForm(f => ({ ...f, video_target: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold mb-1.5" style={{ color: WA.textMuted }}>Beta 子流程</label>
                  <select
                    className="w-full text-base px-3 py-2.5 rounded-xl border focus:outline-none focus:ring-2"
                    style={{ borderColor: WA.borderLight, background: WA.lightBg }}
                    value={editForm.beta_status}
                    onChange={e => setEditForm(f => ({ ...f, beta_status: e.target.value }))}
                  >
                    <option value="not_introduced">未引入</option>
                    <option value="introduced">已引入</option>
                    <option value="started">已开始</option>
                    <option value="completed">已完成</option>
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-semibold mb-1.5" style={{ color: WA.textMuted }}>月费</label>
                  <select
                    className="w-full text-base px-3 py-2.5 rounded-xl border focus:outline-none focus:ring-2"
                    style={{ borderColor: WA.borderLight, background: WA.lightBg }}
                    value={editForm.monthly_fee_status}
                    onChange={e => setEditForm(f => ({ ...f, monthly_fee_status: e.target.value }))}
                  >
                    <option value="pending">待支付</option>
                    <option value="paid">已支付</option>
                    <option value="overdue">逾期</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-semibold mb-1.5" style={{ color: WA.textMuted }}>月费金额</label>
                  <input
                    type="number"
                    className="w-full text-base px-3 py-2.5 rounded-xl border focus:outline-none focus:ring-2"
                    style={{ borderColor: WA.borderLight, background: WA.lightBg }}
                    value={editForm.monthly_fee_amount}
                    onChange={e => setEditForm(f => ({ ...f, monthly_fee_amount: e.target.value }))}
                  />
                </div>
              </div>
              <div className="flex gap-2 mt-6">
                <button
                  onClick={handleEditSave}
                  disabled={editSaving}
                  className="flex-1 py-2.5 rounded-xl text-base font-semibold text-white"
                  style={{ background: editSaving ? '#9ca3af' : WA.teal }}
                >
                  {editSaving ? '保存中...' : '保存'}
                </button>
                <button
                  onClick={() => setShowEdit(false)}
                  className="flex-1 py-2.5 rounded-xl text-base font-semibold"
                  style={{ background: WA.borderLight, color: WA.textMuted }}
                >
                  取消
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

function formatLifecycleTransitionLabel(item = {}) {
  const toLabel = item?.to_label || item?.to_stage || '-'
  const fromLabel = item?.from_label || item?.from_stage || ''
  if (item?.action === 'current_snapshot') {
    return `当前阶段：${toLabel}`
  }
  if (!fromLabel) {
    return `进入 ${toLabel}`
  }
  return `${fromLabel} → ${toLabel}`
}

function formatLifecycleTransitionSource(item = {}) {
  const trigger = String(item?.trigger || '').trim().toLowerCase()
  const action = String(item?.action || '').trim().toLowerCase()
  const key = trigger || action
  if (key === 'event_create') return '触发源: 新建事件'
  if (key === 'event_update') return '触发源: 更新事件'
  if (key === 'event_delete') return '触发源: 删除事件'
  if (key === 'wacrm_update') return '触发源: 编辑资料'
  if (key === 'lifecycle_change_wacrm') return '触发源: 编辑资料'
  if (key === 'manual_panel_rebuild') return '触发源: 手动重算'
  if (key === 'current' || key === 'current_snapshot') return '触发源: 当前快照'
  if (key) return `触发源: ${key}`
  return '触发源: 系统'
}

function formatLifecycleTransitionTime(value) {
  if (!value) return '-'
  const dt = new Date(value)
  if (Number.isNaN(dt.getTime())) return String(value)
  const datePart = dt.toLocaleDateString('zh-CN')
  const timePart = dt.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  return `${datePart} ${timePart}`
}

function buildCreatorDraftPreview(creator, editForm = {}) {
  if (!creator) return creator
  if (!editForm || Object.keys(editForm).length === 0) return creator
  const joinbrands = {
    ...(creator.joinbrands || {}),
    ev_trial_active: !!editForm.ev_trial_active,
    ev_monthly_started: !!editForm.ev_monthly_started,
    ev_monthly_joined: !!editForm.ev_monthly_joined,
    ev_whatsapp_shared: !!editForm.ev_whatsapp_shared,
    ev_gmv_1k: !!editForm.ev_gmv_1k,
    ev_gmv_2k: !!editForm.ev_gmv_2k,
    ev_gmv_5k: !!editForm.ev_gmv_5k,
    ev_gmv_10k: !!editForm.ev_gmv_10k,
    ev_agency_bound: !!editForm.ev_agency_bound,
    ev_churned: !!editForm.ev_churned,
  }
  const wacrm = {
    ...(creator.wacrm || {}),
    beta_status: editForm.beta_status ?? creator.wacrm?.beta_status,
    priority: editForm.priority ?? creator.wacrm?.priority,
    agency_bound: Number(editForm.agency_bound ?? creator.wacrm?.agency_bound ?? 0),
    video_count: Number(editForm.video_count ?? creator.wacrm?.video_count ?? 0),
    video_target: Number(editForm.video_target ?? creator.wacrm?.video_target ?? 35),
    monthly_fee_status: editForm.monthly_fee_status ?? creator.wacrm?.monthly_fee_status,
    monthly_fee_amount: Number(editForm.monthly_fee_amount ?? creator.wacrm?.monthly_fee_amount ?? 0),
    next_action: editForm.next_action ?? creator.wacrm?.next_action,
  }
  const keeper = {
    ...(creator.keeper || {}),
    keeper_gmv: Number(editForm.keeper_gmv ?? creator.keeper?.keeper_gmv ?? 0),
    keeper_gmv30: Number(editForm.keeper_gmv30 ?? creator.keeper?.keeper_gmv30 ?? 0),
    keeper_orders: Number(editForm.keeper_orders ?? creator.keeper?.keeper_orders ?? 0),
    keeper_videos: Number(editForm.keeper_videos ?? creator.keeper?.keeper_videos ?? 0),
    keeper_videos_posted: Number(editForm.keeper_videos_posted ?? creator.keeper?.keeper_videos_posted ?? 0),
    keeper_videos_sold: Number(editForm.keeper_videos_sold ?? creator.keeper?.keeper_videos_sold ?? 0),
    keeper_card_rate: editForm.keeper_card_rate ?? creator.keeper?.keeper_card_rate ?? '',
    keeper_order_rate: editForm.keeper_order_rate ?? creator.keeper?.keeper_order_rate ?? '',
    keeper_reg_time: Number(editForm.keeper_reg_time ?? creator.keeper?.keeper_reg_time ?? 0),
    keeper_activate_time: Number(editForm.keeper_activate_time ?? creator.keeper?.keeper_activate_time ?? 0),
  }
  return {
    ...creator,
    primary_name: editForm.primary_name ?? creator.primary_name,
    wa_phone: editForm.wa_phone ?? creator.wa_phone,
    wa_owner: editForm.wa_owner ?? creator.wa_owner,
    keeper_username: editForm.keeper_username ?? creator.keeper_username,
    keeper_gmv: keeper.keeper_gmv,
    keeper_gmv30: keeper.keeper_gmv30,
    keeper_orders: keeper.keeper_orders,
    joinbrands,
    wacrm,
    keeper,
  }
}

function InlineEditField({ label, value, onChange, type = 'text', options = [], compact = false }) {
  const labelClass = compact ? 'text-[9px] mb-0.5 leading-tight' : 'text-[11px] mb-1'
  const fieldClass = compact ? 'w-full text-[9px] px-2 py-1.5 rounded-xl border focus:outline-none focus:ring-2' : 'w-full text-[11px] px-2.5 py-2 rounded-xl border focus:outline-none focus:ring-2'
  if (type === 'select') {
    return (
      <label className="block">
        <div className={labelClass} style={{ color: WA.textMuted }}>{label}</div>
        <select
          className={fieldClass}
          style={{ borderColor: WA.borderLight, background: WA.white, color: WA.textDark }}
          value={value}
          onChange={e => onChange(e.target.value)}
        >
          {options.map(([v, l]) => (
            <option key={v} value={v}>{l}</option>
          ))}
        </select>
      </label>
    )
  }

  return (
    <label className="block">
      <div className={labelClass} style={{ color: WA.textMuted }}>{label}</div>
      <input
        className={fieldClass}
        style={{ borderColor: WA.borderLight, background: WA.white, color: WA.textDark }}
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
      />
    </label>
  )
}

function InfoChip({ label, value }) {
  return (
    <div className="rounded-lg px-1.5 py-1 border" style={{ borderColor: WA.borderLight, background: WA.white }}>
      <div className="text-[9px] leading-tight" style={{ color: WA.textMuted }}>{label}</div>
      <div className="text-[9px] font-semibold truncate" style={{ color: WA.textDark }} title={value}>{value || '-'}</div>
    </div>
  )
}

function ScoreBar({ label, value, max = 1 }) {
  const safeMax = Math.max(Number(max) || 1, 1)
  const safeValue = Math.max(0, Number(value) || 0)
  const pct = Math.min(100, Math.round((safeValue / safeMax) * 100))
  return (
    <div className="space-y-0.5">
      <div className="flex items-center justify-between">
        <span className="text-[9px]" style={{ color: WA.textMuted }}>{label}</span>
        <span className="text-[9px] font-semibold" style={{ color: WA.textDark }}>{safeValue}</span>
      </div>
      <div className="h-1.5 rounded-full" style={{ background: 'rgba(15,23,42,0.08)' }}>
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: WA.teal, transition: 'width 180ms ease' }} />
      </div>
    </div>
  )
}

function MiniStat({ label, value }) {
  return (
    <div className="text-center py-2.5 px-1.5 rounded-2xl border" style={{ background: 'rgba(255,255,255,0.62)', borderColor: WA.borderLight }}>
      <div className="text-[16px] font-semibold leading-tight" style={{ color: WA.textDark }}>{value}</div>
      <div className="text-[12px] mt-1 leading-tight" style={{ color: WA.textMuted }}>{label}</div>
    </div>
  )
}

function InfoRow({ label, value }) {
  return (
    <div className="flex justify-between items-start py-1.5 px-0.5 gap-2.5">
      <span className="shrink-0 text-[11px] leading-tight" style={{ color: WA.textMuted }}>{label}</span>
      <span className="min-w-0 break-words text-[11px] font-medium leading-tight text-right" style={{ color: WA.textDark }}>{value}</span>
    </div>
  )
}

function DetailCard({ title, children, className = '' }) {
  return (
    <div className={`rounded-[18px] p-3 ${className}`.trim()} style={{ background: WA.white, border: `1px solid ${WA.borderLight}` }}>
      <div className="text-[11px] font-semibold mb-2 tracking-[0.08em] uppercase" style={{ color: WA.textMuted }}>{title}</div>
      <div className="space-y-0.5">{children}</div>
    </div>
  )
}

function ActionPill({ label, icon, color, onClick, loading }) {
  return (
    <button
      onClick={onClick}
      disabled={loading}
      className="w-full flex items-center justify-between gap-3 px-3 py-2.5 rounded-[18px] text-[10px] font-medium transition-all hover:opacity-90 disabled:opacity-50"
      style={{ background: WA.white, color, border: `1px solid ${WA.borderLight}` }}
    >
      <span className="flex items-center gap-1.5">
        <span className="text-[11px] leading-none">{loading ? '⏳' : icon}</span>
        <span>{loading ? '刷新中...' : label}</span>
      </span>
      <span className="text-[10px]" style={{ color: WA.textMuted }}>{label.includes('收起') ? '折叠' : '展开'}</span>
    </button>
  )
}

function OverviewFieldCluster({ title, rows = [] }) {
  return (
    <div className="rounded-[16px] border px-3 py-2.5 space-y-1.5" style={{ background: WA.shellPanelMuted, borderColor: WA.borderLight }}>
      <div className="text-[10px] font-semibold tracking-[0.08em] uppercase" style={{ color: WA.textMuted }}>{title}</div>
      {rows.map(([label, value]) => (
        <div key={label} className="flex items-start justify-between gap-2">
          <span className="text-[10px]" style={{ color: WA.textMuted }}>{label}</span>
          <span className="text-[10px] font-medium text-right break-words" style={{ color: WA.textDark }}>{value || '-'}</span>
        </div>
      ))}
    </div>
  )
}

function ManagementTabButton({ active, label, icon, color, onClick }) {
  return (
    <button
      onClick={onClick}
      className="px-2 py-1.5 rounded-2xl text-[9px] font-semibold transition-all"
      style={{
        background: active ? color : WA.white,
        color: active ? WA.white : color,
        border: active ? '1px solid transparent' : `1px solid ${color}22`,
        boxShadow: active ? `${color}18 0 8px 18px` : '0 4px 12px rgba(15,23,42,0.04)',
      }}
    >
      <span className="block text-[10px] leading-none">{icon}</span>
      <span className="block mt-0.5 leading-tight">{label}</span>
    </button>
  )
}

function formatLifecycleFlagValue(key, value) {
  if (!value) return '-'
  if (key === 'beta_status') {
    const map = {
      not_introduced: '未介绍',
      introduced: '已介绍',
      started: '已开始',
      joined: '已加入',
      completed: '已完成',
      churned: '已流失',
    }
    return map[value] || value
  }
  return String(value)
}

function formatLifecycleConflict(item) {
  const map = {
    mainline_without_wa_channel: '尚未确认进入 WA 渠道，但已经被放入生命周期主线。',
    completed_trial_not_activated: '7 日挑战已完成，但主阶段仍停留在获取。',
    agency_bound_not_retention: '已绑定 Agency，但主阶段还没进入留存或变现。',
    gmv_not_revenue: 'GMV 已达到门槛，但主阶段还没进入变现。',
    churn_not_terminated: '已经出现流失信号，但当前主阶段还没进入终止池。',
    referral_without_wa_join: '已出现推荐信号，但还没有确认进入 WA 渠道。',
  }
  if (item && typeof item === 'object') {
    const code = item.code || item.key || item.type
    if (code && map[code]) return map[code]
    if (item.message) return String(item.message)
    if (code) return String(code)
    return '-'
  }
  return map[item] || (item ? String(item) : '-')
}

export { CreatorDetail }
