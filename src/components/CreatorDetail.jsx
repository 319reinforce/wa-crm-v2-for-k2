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
  const [activeManageTab, setActiveManageTab] = useState(null)
  const [agencyStrategies, setAgencyStrategies] = useState(DEFAULT_UNBOUND_AGENCY_STRATEGIES)

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
      .then(data => { if (data) setClientProfile(data) })
      .catch(() => {})
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

  const updateClientTag = useCallback(async (tag, action = 'upsert') => {
    if (!creator?.wa_phone || !tag) return
    try {
      await fetchOkOrThrow(`${API_BASE}/client-profiles/${encodeURIComponent(creator.wa_phone)}/tags`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tag, action })
      })
      fetchClientProfile(true)
    } catch (e) {
      console.error('[ClientProfile][tags] 更新失败:', e)
    }
  }, [creator?.wa_phone, fetchClientProfile])

  const deleteStrategyMemory = useCallback(async (memoryKey) => {
    if (!creator?.wa_phone || !memoryKey) return
    try {
      await fetchOkOrThrow(`${API_BASE}/client-profiles/${encodeURIComponent(creator.wa_phone)}/memory`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ memory_type: 'strategy', memory_key: memoryKey })
      })
      fetchClientProfile(true)
    } catch (e) {
      console.error('[ClientProfile][memory] 删除失败:', e)
    }
  }, [creator?.wa_phone, fetchClientProfile])

  const addStrategyMemory = useCallback(async (memoryKey, memoryValue) => {
    if (!creator?.wa_phone || !memoryKey || !memoryValue) return
    try {
      await fetchOkOrThrow(`${API_BASE}/client-profiles/${encodeURIComponent(creator.wa_phone)}/memory`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ memory_type: 'strategy', memory_key: memoryKey, memory_value: memoryValue })
      })
      fetchClientProfile(true)
    } catch (e) {
      console.error('[ClientProfile][memory] 新增失败:', e)
    }
  }, [creator?.wa_phone, fetchClientProfile])

  useEffect(() => {
    fetchCreator(true)
    fetchClientProfile()
    fetchAgencyStrategies()
    const i = setInterval(() => fetchCreator(true), 8000)
    return () => clearInterval(i)
  }, [fetchCreator, fetchClientProfile, fetchAgencyStrategies])

  useEffect(() => {
    setActiveManageTab(null)
  }, [creatorId])

  // 当 creator 变化时，同步 editForm（用于内联编辑）
  useEffect(() => {
    if (!creator || showEdit) return
    setEditForm(buildEditFormSnapshot(creator))
  }, [creator, showEdit])

  const handleRefresh = () => fetchCreator(false)

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
  const clientInfo = {
    id: displayCreator?.id,
    phone: displayCreator?.wa_phone,
    name: displayCreator?.primary_name,
    wa_owner: displayCreator?.wa_owner,
    conversion_stage: wacrm.beta_status || 'unknown',
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
  const lifecycle = creator?.lifecycle || displayCreator?.lifecycle || null
  const lifecycleOption0 = lifecycle?.option0 || null
  const lifecycleEntrySignals = Array.isArray(lifecycle?.entry_signals)
    ? lifecycle.entry_signals.filter(Boolean)
    : []

  const lifecyclePanel = lifecycle && (
    <DetailCard title="生命周期">
      <InfoRow label="阶段" value={lifecycle.stage_label || '-'} />
      <InfoRow label="目标" value={lifecycle.goal || '-'} />
      {lifecycleEntrySignals.length > 0 && (
        <InfoRow label="进入信号" value={lifecycleEntrySignals.join(' · ')} />
      )}
      {lifecycle.exit_signal_hint && (
        <InfoRow label="退出提示" value={lifecycle.exit_signal_hint} />
      )}
      {lifecycleOption0 && (
        <div className="mt-2 rounded-xl p-2 space-y-1.5" style={{ background: 'rgba(0,168,132,0.06)' }}>
          <div className="text-[7px] font-semibold tracking-wide" style={{ color: WA.textMuted }}>
            {lifecycleOption0.label}
          </div>
          <div className="text-[7px] leading-4" style={{ color: WA.textDark }}>
            {lifecycleOption0.next_action_template}
          </div>
          {lifecycleOption0.next_action_template_en && (
            <div className="text-[7px] leading-4" style={{ color: WA.textMuted }}>
              EN: {lifecycleOption0.next_action_template_en}
            </div>
          )}
          <button
            onClick={handleApplyLifecycleOption0}
            className="px-2.5 py-1.5 rounded-lg text-[7px] font-semibold text-white"
            style={{ background: WA.teal }}
          >
            填入下一步
          </button>
        </div>
      )}
    </DetailCard>
  )

  const profileManagerPanel = profileExpanded && (
    <div
      className="mt-2 p-2.5 rounded-2xl space-y-2"
      style={{ background: 'rgba(255,255,255,0.78)', border: `1px solid ${WA.borderLight}`, boxShadow: '0 10px 24px rgba(15,23,42,0.04)' }}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[8px] font-semibold tracking-wide" style={{ color: WA.textMuted }}>画像管理</span>
          {clientProfile?.tags?.length > 0 && (
            <span className="text-[7px] px-1.5 py-0.5 rounded-full" style={{ background: WA.white, color: WA.textMuted }}>
              {clientProfile.tags.length} 标签
            </span>
          )}
        </div>
        <button
          onClick={() => fetchClientProfile()}
          disabled={profileRefreshing}
          className="text-[7px] px-2 py-1 rounded hover:opacity-80 transition-opacity"
          style={{ color: profileRefreshing ? WA.textMuted : WA.teal }}
        >
          {profileRefreshing ? '刷新中...' : '🔄 刷新'}
        </button>
      </div>

      <div>
        <div className="text-[7px] font-semibold mb-1" style={{ color: WA.textMuted }}>AI 摘要</div>
        {clientProfile?.summary ? (
          <div className="text-[7px] leading-4 py-2 px-2.5 rounded-xl" style={{ background: WA.white, color: WA.textDark }}>
            {clientProfile.summary}
          </div>
        ) : (
          <div className="text-[7px]" style={{ color: WA.textMuted }}>暂无摘要</div>
        )}
      </div>

      <div>
        <div className="text-[7px] font-semibold mb-1" style={{ color: WA.textMuted }}>客户标签</div>
        {clientProfile?.tags?.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-2">
            {clientProfile.tags.map((t, i) => (
              <span key={i} className="flex items-center gap-1 text-[7px] px-2 py-1 rounded-full" style={{ background: WA.white, color: WA.textDark }}>
                {t.tag}
                <button
                  onClick={() => updateClientTag(t.tag, 'delete')}
                  className="text-red-400 hover:text-red-600 font-bold ml-0.5"
                >×</button>
              </span>
            ))}
          </div>
        )}
        <div className="space-y-2">
          <ProfileTagGroup label="语气" tags={[['tone:casual', '休闲'], ['tone:formal', '正式'], ['tone:friendly', '友好']]} onAdd={updateClientTag} />
          <ProfileTagGroup label="内容" tags={[['format:video', '视频'], ['format:text', '图文'], ['format:mixed', '混合']]} onAdd={updateClientTag} />
          <ProfileTagGroup label="阶段" tags={[['stage:new', '新用户'], ['stage:trial', '试用中'], ['stage:onboarding', 'onboarding'], ['stage:active', '活跃'], ['stage:churned', '流失']]} onAdd={updateClientTag} />
          <ProfileTagGroup label="偏好" tags={[['interest:drifto', 'DRIFTO'], ['interest:fashion', '时尚'], ['interest:beauty', '美妆'], ['interest:lifestyle', '生活']]} onAdd={updateClientTag} />
          <ProfileTagGroup label="互动" tags={[['engagement:high', '高'], ['engagement:medium', '中'], ['engagement:low', '低']]} onAdd={updateClientTag} />
          <ProfileTagGroup label="来源" tags={[['source:organic', '自然流量'], ['source:referral', '推荐'], ['source:ads', '广告']]} onAdd={updateClientTag} />
        </div>
      </div>

    </div>
  )

  const financialPanel = activeManageTab === 'finance' && (
    <div
      className="mt-2 p-2.5 rounded-2xl space-y-2"
      style={{ background: 'rgba(255,255,255,0.78)', border: `1px solid ${WA.borderLight}`, boxShadow: '0 10px 24px rgba(15,23,42,0.04)' }}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[8px] font-semibold tracking-wide" style={{ color: WA.textMuted }}>财务面板</span>
          <span className="text-[7px] px-1.5 py-0.5 rounded-full" style={{ background: WA.white, color: WA.textMuted }}>
            {wacrm.monthly_fee_status || 'pending'}
          </span>
          <span className="text-[7px] px-1.5 py-0.5 rounded-full" style={{ background: 'rgba(16,185,129,0.12)', color: '#10b981' }}>
            {wacrm.monthly_fee_amount ? `$${wacrm.monthly_fee_amount}` : '$0'}
          </span>
        </div>
      </div>
      <InlineEditField compact label="Beta" value={editForm.beta_status || ''} onChange={v => setEditForm(f => ({ ...f, beta_status: v }))} type="select" options={[['not_introduced', '未引入'], ['introduced', '已引入'], ['churned', '流失']]} />
      <InlineEditField compact label="月费" value={editForm.monthly_fee_status || ''} onChange={v => setEditForm(f => ({ ...f, monthly_fee_status: v }))} type="select" options={[['pending', '待支付'], ['paid', '已支付'], ['overdue', '逾期']]} />
      <InlineEditField compact label="金额" value={String(editForm.monthly_fee_amount || 0)} onChange={v => setEditForm(f => ({ ...f, monthly_fee_amount: parseFloat(v) || 0 }))} type="number" />
      <div className="flex justify-end pt-1">
        <button
          onClick={handleEditSave}
          disabled={editSaving}
          className="px-3 py-1.5 rounded-xl text-[7px] font-medium text-white"
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
      style={{ background: 'rgba(255,255,255,0.78)', border: `1px solid ${WA.borderLight}`, boxShadow: '0 10px 24px rgba(15,23,42,0.04)' }}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[8px] font-semibold tracking-wide" style={{ color: WA.textMuted }}>Keeper 面板</span>
          <span className="text-[7px] px-1.5 py-0.5 rounded-full" style={{ background: WA.white, color: WA.textMuted }}>
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
          className="px-3 py-1.5 rounded-xl text-[7px] font-medium text-white"
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
      style={{ background: 'rgba(255,255,255,0.78)', border: `1px solid ${WA.borderLight}`, boxShadow: '0 10px 24px rgba(15,23,42,0.04)' }}
    >
      <div className="text-[8px] font-semibold tracking-wide mb-1" style={{ color: WA.textMuted }}>编辑达人</div>
      <InlineEditField compact label="姓名" value={editForm.primary_name || ''} onChange={v => setEditForm(f => ({ ...f, primary_name: v }))} type="text" />
      <InlineEditField compact label="电话" value={editForm.wa_phone || ''} onChange={v => setEditForm(f => ({ ...f, wa_phone: v }))} type="text" />
      <InlineEditField compact label="负责人" value={editForm.wa_owner || ''} onChange={v => setEditForm(f => ({ ...f, wa_owner: v }))} type="select" options={OWNER_ORDER.map(owner => [owner, owner])} />
      <InlineEditField compact label="Keeper" value={editForm.keeper_username || ''} onChange={v => setEditForm(f => ({ ...f, keeper_username: v }))} type="text" />
      <InlineEditField compact label="优先级" value={editForm.priority || ''} onChange={v => setEditForm(f => ({ ...f, priority: v }))} type="select" options={[['normal', '普通'], ['high', '高'], ['urgent', '紧急']]} />
      <InlineEditField compact label="Agency" value={editForm.agency_bound || '0'} onChange={v => setEditForm(f => ({ ...f, agency_bound: v }))} type="select" options={[['0', '否'], ['1', '是']]} />
      <InlineEditField compact label="视频数" value={String(editForm.video_count || 0)} onChange={v => setEditForm(f => ({ ...f, video_count: parseInt(v) || 0 }))} type="number" />
      <InlineEditField compact label="目标" value={String(editForm.video_target || 35)} onChange={v => setEditForm(f => ({ ...f, video_target: parseInt(v) || 35 }))} type="number" />
      <div>
        <div className="text-[7px] mb-0.5" style={{ color: WA.textMuted }}>下一步</div>
        <textarea
          className="w-full text-[7px] px-2 py-1.5 rounded-xl border focus:outline-none focus:ring-2 resize-none"
          style={{ borderColor: WA.borderLight, background: WA.white, color: '#111b21' }}
          rows={2}
          value={editForm.next_action || ''}
          onChange={e => setEditForm(f => ({ ...f, next_action: e.target.value }))}
          placeholder="记录下一步跟进计划..."
        />
        {lifecycleOption0 && (
          <div className="mt-1.5 space-y-1">
            <div className="flex flex-wrap gap-1">
              <button
                onClick={handleApplyLifecycleOption0}
                className="text-[7px] px-2 py-1 rounded-full border"
                style={{ borderColor: WA.teal, background: 'rgba(0,168,132,0.08)', color: WA.teal }}
                title={lifecycleOption0.next_action_template_en || ''}
              >
                填充：{lifecycleOption0.label}
              </button>
            </div>
            {lifecycleOption0.next_action_template_en && (
              <div className="text-[7px]" style={{ color: WA.textMuted }}>
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
                  className="text-[7px] px-2 py-1 rounded-full border"
                  style={{ borderColor: WA.borderLight, background: WA.white, color: WA.textDark }}
                  title={`${strategy.shortDesc}\n${strategy.nextActionTemplateEn}`}
                >
                  填充：{strategy.name}
                </button>
              ))}
            </div>
            {activeAgencyStrategy && (
              <div className="text-[7px]" style={{ color: WA.textMuted }}>
                推荐策略：{activeAgencyStrategy.name}（{activeAgencyStrategy.nameEn}）
              </div>
            )}
          </div>
        )}
      </div>
      <div className="border-t pt-2 mt-1" style={{ borderColor: WA.borderLight }}>
        <div className="text-[7px] font-semibold mb-1.5 tracking-wide" style={{ color: WA.textMuted }}>事件标签</div>
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <span className="text-[7px] w-20 shrink-0" style={{ color: WA.textMuted }}>挑战阶段</span>
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
              className="flex-1 text-[7px] px-2 py-1.5 rounded-xl border"
              style={{ borderColor: WA.borderLight, background: WA.white, color: WA.textDark }}
            >
              <option value="none">无</option>
              <option value="active">七日挑战进行中</option>
              <option value="monthly">开启月度挑战</option>
            </select>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[7px] w-20 shrink-0" style={{ color: WA.textMuted }}>GMV 阶段</span>
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
              className="flex-1 text-[7px] px-2 py-1.5 rounded-xl border"
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
            <span className="text-[7px] w-20 shrink-0" style={{ color: WA.textMuted }}>状态</span>
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
              className="flex-1 text-[7px] px-2 py-1.5 rounded-xl border"
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
          className="flex-1 py-1.5 rounded-xl text-[7px] font-medium text-white"
          style={{ background: editSaving ? '#9ca3af' : WA.teal }}
        >
          {editSaving ? '保存中...' : '保存'}
        </button>
        <button
          onClick={() => setEditForm(editFormInitial)}
          className="px-3 py-1.5 rounded-xl text-[7px] font-medium"
          style={{ background: WA.borderLight, color: WA.textMuted }}
        >
          重置
        </button>
      </div>
    </div>
  )

  const strategyPanel = (
    <DetailCard title="回复策略" className="space-y-2">
      {!isAgencyBound && (
        <div className="space-y-1.5">
          <div className="text-[7px] font-semibold" style={{ color: WA.teal }}>未绑定Agency专属策略</div>
          <div className="flex flex-wrap gap-1.5">
            {agencyStrategies.map((strategy) => (
              <button
                key={strategy.id}
                onClick={() => addStrategyMemory(strategy.memoryKey, strategy.memoryValue)}
                className="text-[7px] px-2 py-1 rounded-full border"
                style={{ borderColor: WA.teal, color: WA.teal, background: 'rgba(0,168,132,0.08)' }}
                title={strategy.shortDesc}
              >
                + {strategy.name}
              </button>
            ))}
          </div>
          {activeAgencyStrategy && (
            <div className="text-[7px]" style={{ color: WA.textMuted }}>
              当前策略：{activeAgencyStrategy.name} / {activeAgencyStrategy.nameEn}
            </div>
          )}
        </div>
      )}

      {clientProfile?.memory?.filter(m => m.type === 'strategy').length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {clientProfile.memory.filter(m => m.type === 'strategy').map((m, i) => (
            <span key={i} className="flex items-center gap-1 text-[7px] px-2 py-1 rounded-full" style={{ background: 'rgba(0,168,132,0.12)', color: WA.teal }}>
              {m.value}
              <button onClick={() => deleteStrategyMemory(m.key)} className="text-red-400 hover:text-red-600 font-bold ml-0.5">×</button>
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
          <button
            key={key}
            onClick={() => addStrategyMemory(key, desc)}
            className="text-[7px] px-2 py-1 rounded-full border"
            style={{ borderColor: WA.teal, color: WA.textDark, background: 'transparent' }}
          >
            + {key}
          </button>
        ))}
      </div>
    </DetailCard>
  )

  const managementTabs = (
    <div className="mt-2 space-y-2">
      <div className="grid grid-cols-3 gap-1.5">
        {[
          { key: 'edit', label: '编辑达人', icon: '✏️', color: '#3b82f6' },
          { key: 'finance', label: '财务面板', icon: '💳', color: '#0f766e' },
          { key: 'keeper', label: 'Keeper 面板', icon: '📈', color: '#2563eb' },
        ].map(tab => (
          <ManagementTabButton
            key={tab.key}
            active={activeManageTab === tab.key}
            label={tab.label}
            icon={tab.icon}
            color={tab.color}
            onClick={() => {
              if (activeManageTab === tab.key) {
                setActiveManageTab(null)
                return
              }
              if (tab.key === 'edit') handleEditOpen()
              else setActiveManageTab(tab.key)
            }}
          />
        ))}
      </div>
      {quickEditPanel}
      {financialPanel}
      {keeperPanel}
      {strategyPanel}
    </div>
  )

  const eventsPanel = (
    <div className="space-y-2">
      <CreatorEventsSection creatorId={creatorId} />
    </div>
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
              <span className="text-sm font-semibold leading-none">‹</span>
            </button>
          </div>
        ) : (
        <div className="flex flex-col h-full" style={{ background: WA.chatBg, borderLeft: `1px solid ${WA.borderLight}` }}>
          {/* Header */}
          <div className="flex items-center gap-3 px-5 py-4" style={{ background: WA.chatBg, borderBottom: `1px solid ${WA.borderLight}` }}>
            <button onClick={onClose} className="text-black/45 hover:text-black/70 text-xl">←</button>
            <div className="w-11 h-11 rounded-full flex items-center justify-center text-white font-bold text-base" style={{ background: WA.teal }}>
              {(displayName || '?')[0]?.toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-semibold text-base truncate" style={{ color: WA.textDark }}>{displayName}</div>
              <div className="text-xs" style={{ color: WA.textMuted }}>{displayPhone}</div>
            </div>
            <button
              type="button"
              onClick={onTogglePin}
              className="rounded-full px-3 py-1.5 text-xs font-semibold transition-all hover:opacity-85"
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

            {lifecyclePanel}

            <div className="grid grid-cols-2 gap-3 items-stretch">
              <DetailCard title="状态" className="h-full">
                <InfoRow label="优先级" value={wacrm.priority || '-'} />
                <InfoRow label="Agency 绑定" value={wacrm.agency_bound ? '✓ 是' : '✗ 否'} />
                <InfoRow label="视频进度" value={wacrm.video_count ? `${wacrm.video_count} / ${wacrm.video_target || 35}` : '-'} />
                {wacrm.next_action && <InfoRow label="下一步" value={wacrm.next_action} />}
              </DetailCard>
              <DetailCard title="基本信息" className="h-full">
                <InfoRow label="电话" value={displayPhone} />
                <InfoRow label="Keeper" value={displayKeeperUsername} />
                <InfoRow label="负责人" value={displayOwner} />
              </DetailCard>
            </div>

            {eventsPanel}

            <div className="space-y-3">
              <ActionPill
                label={profileExpanded ? '收起画像管理' : '画像管理'}
                icon={profileExpanded ? '▲' : '👩‍🦰'}
                color={detailStatusMeta.accent === 'transparent' ? WA.teal : detailStatusMeta.accent}
                onClick={() => setProfileExpanded(v => !v)}
              />
              {profileManagerPanel}
              {managementTabs}
            </div>
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
                <div className="w-11 h-11 rounded-full flex items-center justify-center text-white font-bold text-base" style={{ background: WA.teal }}>
                  {(displayName || '?')[0]?.toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-base text-white truncate">{displayName}</div>
                  <div className="text-xs text-white/50">{displayPhone}</div>
                </div>
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

                {lifecyclePanel}

                <div className="grid grid-cols-2 gap-3 items-stretch">
                  <DetailCard title="状态" className="h-full">
                    <InfoRow label="优先级" value={wacrm.priority || '-'} />
                    <InfoRow label="Agency 绑定" value={wacrm.agency_bound ? '✓ 是' : '✗ 否'} />
                    <InfoRow label="视频进度" value={wacrm.video_count ? `${wacrm.video_count} / ${wacrm.video_target || 35}` : '-'} />
                    {wacrm.next_action && <InfoRow label="下一步" value={wacrm.next_action} />}
                  </DetailCard>
                  <DetailCard title="基本信息" className="h-full">
                    <InfoRow label="电话" value={displayPhone} />
                    <InfoRow label="Keeper" value={displayKeeperUsername} />
                    <InfoRow label="负责人" value={displayOwner} />
                  </DetailCard>
                </div>

                {eventsPanel}

                <div className="space-y-3">
                  <ActionPill
                    label={profileExpanded ? '收起画像管理' : '画像管理'}
                    icon={profileExpanded ? '▲' : '👩‍🦰'}
                    color={detailStatusMeta.accent === 'transparent' ? WA.teal : detailStatusMeta.accent}
                    onClick={() => setProfileExpanded(v => !v)}
                  />
                  {profileManagerPanel}
                  {managementTabs}
                </div>
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
                  {OWNER_ORDER.map(owner => (
                    <option key={owner} value={owner}>{owner}</option>
                  ))}
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
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold mb-1.5" style={{ color: WA.textMuted }}>目标</label>
                  <input
                    type="number"
                    className="w-full text-sm px-3 py-2.5 rounded-xl border focus:outline-none focus:ring-2"
                    style={{ borderColor: WA.borderLight, background: WA.lightBg }}
                    value={editForm.video_target}
                    onChange={e => setEditForm(f => ({ ...f, video_target: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-1.5" style={{ color: WA.textMuted }}>Beta</label>
                  <select
                    className="w-full text-sm px-3 py-2.5 rounded-xl border focus:outline-none focus:ring-2"
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
                  <label className="block text-xs font-semibold mb-1.5" style={{ color: WA.textMuted }}>月费</label>
                  <select
                    className="w-full text-sm px-3 py-2.5 rounded-xl border focus:outline-none focus:ring-2"
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
                  <label className="block text-xs font-semibold mb-1.5" style={{ color: WA.textMuted }}>月费金额</label>
                  <input
                    type="number"
                    className="w-full text-sm px-3 py-2.5 rounded-xl border focus:outline-none focus:ring-2"
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
                  className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white"
                  style={{ background: editSaving ? '#9ca3af' : WA.teal }}
                >
                  {editSaving ? '保存中...' : '保存'}
                </button>
                <button
                  onClick={() => setShowEdit(false)}
                  className="flex-1 py-2.5 rounded-xl text-sm font-semibold"
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
  const labelClass = compact ? 'text-[7px] mb-0.5 leading-tight' : 'text-[11px] mb-1'
  const fieldClass = compact ? 'w-full text-[7px] px-2 py-1.5 rounded-xl border focus:outline-none focus:ring-2' : 'w-full text-[11px] px-2.5 py-2 rounded-xl border focus:outline-none focus:ring-2'
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

function ProfileTagGroup({ label, tags, onAdd }) {
  return (
    <div>
      <div className="text-[7px] font-semibold mb-1" style={{ color: WA.textMuted }}>{label}</div>
      <div className="flex flex-wrap gap-1.5">
        {tags.map(([tag, name]) => (
          <button
            key={tag}
            onClick={() => onAdd(tag)}
            className="text-[7px] px-2 py-1 rounded-full border"
            style={{ borderColor: WA.borderLight, background: WA.white, color: WA.textDark }}
          >
            + {name}
          </button>
        ))}
      </div>
    </div>
  )
}

function MiniStat({ label, value }) {
  return (
    <div className="text-center py-2.5 px-1.5 rounded-2xl border" style={{ background: 'rgba(255,255,255,0.62)', borderColor: WA.borderLight }}>
      <div className="text-[14px] font-semibold leading-tight" style={{ color: WA.textDark }}>{value}</div>
      <div className="text-[10px] mt-1 leading-tight" style={{ color: WA.textMuted }}>{label}</div>
    </div>
  )
}

function InfoRow({ label, value }) {
  return (
    <div className="flex justify-between items-center py-1.5 px-0.5 gap-2.5">
      <span className="text-[11px] leading-tight" style={{ color: WA.textMuted }}>{label}</span>
      <span className="text-[11px] font-medium leading-tight text-right" style={{ color: WA.textDark }}>{value}</span>
    </div>
  )
}

function DetailCard({ title, children, className = '' }) {
  return (
    <div className={`rounded-2xl p-3 ${className}`.trim()} style={{ background: 'rgba(255,255,255,0.62)', border: `1px solid ${WA.borderLight}` }}>
      <div className="text-[11px] font-semibold mb-2" style={{ color: WA.textMuted }}>{title}</div>
      <div className="space-y-0.5">{children}</div>
    </div>
  )
}

function ActionPill({ label, icon, color, onClick, loading }) {
  return (
    <button
      onClick={onClick}
      disabled={loading}
      className="w-full flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[8px] font-medium transition-all hover:opacity-80 disabled:opacity-50"
      style={{ background: color + '18', color }}
    >
      <span className="text-[8px] leading-none">{loading ? '⏳' : icon}</span><span>{loading ? '刷新中...' : label}</span>
    </button>
  )
}

function ManagementTabButton({ active, label, icon, color, onClick }) {
  return (
    <button
      onClick={onClick}
      className="px-2 py-1.5 rounded-2xl text-[7px] font-semibold transition-all"
      style={{
        background: active ? color : WA.white,
        color: active ? WA.white : color,
        border: active ? '1px solid transparent' : `1px solid ${color}22`,
        boxShadow: active ? `${color}18 0 8px 18px` : '0 4px 12px rgba(15,23,42,0.04)',
      }}
    >
      <span className="block text-[8px] leading-none">{icon}</span>
      <span className="block mt-0.5 leading-tight">{label}</span>
    </button>
  )
}

export { CreatorDetail }
