import React, { useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import AuthSessionControls from '../components/AuthSessionControls'
import { useCreators } from './useApi'
import WA from '../utils/waTheme'
import { getOwnerColor } from '../utils/operators'

const OPERATOR_OPTIONS = ['Yiyun', 'Beau', 'Jiawen']

export default function MobileListScreen() {
  const [search, setSearch] = useState('')
  const [searchParams, setSearchParams] = useSearchParams()
  const owner = useMemo(() => normalizeOwner(searchParams.get('op')), [searchParams])
  const [filterBeta, setFilterBeta] = useState('')
  const [filterPriority, setFilterPriority] = useState('')
  const [filterAgency, setFilterAgency] = useState('')
  const [filterEvent, setFilterEvent] = useState('')
  const [filterLifecycle, setFilterLifecycle] = useState('')
  const [filtersCollapsed, setFiltersCollapsed] = useState(true)
  const { creators, loading } = useCreators({ search, owner })
  const nav = useNavigate()

  const filtered = useMemo(() => creators.filter(c => {
    if (filterBeta && c._full?.wacrm?.beta_status !== filterBeta) return false
    if (filterPriority && c._full?.wacrm?.priority !== filterPriority) return false
    if (filterAgency === 'yes' && !c._full?.wacrm?.agency_bound) return false
    if (filterAgency === 'no' && c._full?.wacrm?.agency_bound) return false
    if (filterEvent) {
      const evKey = `ev_${filterEvent}`
      if (!c._full?.joinbrands?.[evKey]) return false
    }
    if (filterLifecycle && c.lifecycle?.stage_key !== filterLifecycle) return false
    return true
  }), [creators, filterAgency, filterBeta, filterEvent, filterLifecycle, filterPriority])

  const activeFilterCount = [filterBeta, filterPriority, filterAgency, filterEvent, filterLifecycle].filter(Boolean).length

  const selectOwner = (nextOwner) => {
    const next = new URLSearchParams(searchParams)
    next.set('op', String(nextOwner).toLowerCase())
    setSearchParams(next, { replace: true })
  }

  return (
    <div className="min-h-screen flex flex-col app-shell" style={{ background: WA.shellBg }}>
      <div className="px-3 pt-3 pb-2 space-y-2.5 shrink-0">
        <div className="docs-panel-strong px-4 py-3 space-y-3">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-2xl flex items-center justify-center text-white text-sm font-bold" style={{ background: WA.teal }}>
              WA
            </div>
            <div className="flex-1 min-w-0">
              <div className="docs-kicker">Navigator</div>
              <div className="text-[15px] font-semibold" style={{ color: WA.textDark }}>{owner} 达人列表</div>
            </div>
            <div
              className="px-2.5 py-1 rounded-full text-[11px] font-semibold"
              style={{ background: WA.shellAccentSoft, color: WA.teal }}
            >
              {filtered.length} 人
            </div>
          </div>

          <AuthSessionControls compact />

          <div className="flex gap-2 overflow-x-auto docs-scrollbar pb-0.5">
            {OPERATOR_OPTIONS.map(op => (
              <button
                key={op}
                onClick={() => selectOwner(op)}
                className="shrink-0 px-3 py-1.5 rounded-full text-[12px] font-semibold border transition-all"
                style={{
                  background: owner === op ? WA.shellActive : WA.white,
                  color: owner === op ? WA.textDark : WA.textMuted,
                  borderColor: owner === op ? WA.shellBorderStrong : WA.borderLight,
                }}
              >
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full" style={{ background: getOwnerColor(op) }} />
                  {op}
                </span>
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2 px-3 py-2.5 rounded-2xl" style={{ background: WA.shellPanelMuted, border: `1px solid ${WA.borderLight}` }}>
            <span style={{ color: WA.textMuted }}>🔍</span>
            <input
              className="flex-1 bg-transparent text-sm focus:outline-none"
              style={{ color: WA.textDark }}
              placeholder="搜索姓名 / 电话"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            {search && <button onClick={() => setSearch('')} style={{ color: WA.textMuted }}>✕</button>}
          </div>
        </div>

        <div className="docs-panel px-3 py-2.5 space-y-2" style={{ background: WA.shellPanel }}>
          <div className="flex items-center justify-between gap-3">
            <div className="docs-kicker">Filters</div>
            <div className="flex items-center gap-2 text-[11px]">
              {activeFilterCount > 0 && (
                <span className="px-2 py-0.5 rounded-full font-semibold" style={{ background: WA.white, color: WA.textMuted, border: `1px solid ${WA.borderLight}` }}>
                  {activeFilterCount} 项
                </span>
              )}
              <button onClick={() => setFiltersCollapsed(v => !v)} style={{ color: WA.textMuted }}>
                {filtersCollapsed ? '展开' : '收起'}
              </button>
            </div>
          </div>

          {!filtersCollapsed && (
            <div className="grid grid-cols-2 gap-2">
              <Select value={filterBeta} onChange={setFilterBeta} options={[
                ['', 'Beta 子流程'],
                ['not_introduced', '未介绍'],
                ['introduced', '已介绍'],
                ['started', '已开始'],
                ['completed', '已完成'],
              ]} />
              <Select value={filterPriority} onChange={setFilterPriority} options={[
                ['', '优先级'],
                ['urgent', '紧急'],
                ['high', '高'],
                ['medium', '中'],
                ['low', '低'],
              ]} />
              <Select value={filterAgency} onChange={setFilterAgency} options={[
                ['', 'Agency'],
                ['yes', '已绑定'],
                ['no', '未绑定'],
              ]} />
              <Select value={filterEvent} onChange={setFilterEvent} options={[
                ['', '事件'],
                ['trial_active', '七日挑战'],
                ['monthly_started', '月度开启'],
                ['monthly_joined', '月度加入'],
                ['gmv_1k', 'GMV>1K'],
                ['churned', '流失'],
              ]} />
              <Select value={filterLifecycle} onChange={setFilterLifecycle} options={[
                ['', '生命周期'],
                ['acquisition', '获取'],
                ['activation', '激活'],
                ['retention', '留存'],
                ['revenue', '变现'],
                ['terminated', '终止池'],
              ]} />
            </div>
          )}

          {activeFilterCount > 0 && (
            <button
              onClick={() => { setFilterBeta(''); setFilterPriority(''); setFilterAgency(''); setFilterEvent(''); setFilterLifecycle('') }}
              className="w-full text-xs py-1.5 rounded-lg text-center font-medium"
              style={{ color: '#c65f49', background: 'rgba(198,95,73,0.12)' }}
            >
              清除筛选
            </button>
          )}
        </div>
      </div>

      <div className="px-4 py-1.5 text-[11px] shrink-0" style={{ color: WA.textMuted }}>
        {filtered.length} / {creators.length} 位达人
      </div>

      <div className="flex-1 overflow-y-auto px-3 pb-3 docs-scrollbar">
        {loading ? (
          <div className="docs-panel-strong mt-2 flex items-center justify-center py-12 text-sm" style={{ color: WA.textMuted }}>
            加载中...
          </div>
        ) : filtered.length === 0 ? (
          <div className="docs-panel-strong mt-2 flex items-center justify-center py-12 text-sm" style={{ color: WA.textMuted }}>
            没有找到达人
          </div>
        ) : (
          <div className="docs-panel overflow-hidden" style={{ background: WA.shellPanelStrong }}>
            {filtered.map(c => (
              <ChatRow key={c.id} creator={c} onClick={() => nav(`/m/chat/${c.id}`)} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function ChatRow({ creator, onClick }) {
  const statusMeta = getStatusMeta(creator)
  const unread = creator.ev_replied === 0
  const lifecycleLabel = getLifecycleLabel(creator?.lifecycle?.stage_key)
  const referralActive = !!creator?.lifecycle?.flags?.referral_active
  const waJoined = !!creator?.lifecycle?.flags?.wa_joined
  const hasConflicts = !!creator?.lifecycle?.has_conflicts

  return (
    <button
      onClick={onClick}
      className="w-full text-left px-4 py-3 flex items-center gap-3 active:opacity-80"
      style={{ borderBottom: `1px solid ${WA.borderLight}`, background: WA.white }}
    >
      <div className="relative">
        <div className="w-10 h-10 rounded-2xl flex items-center justify-center text-white font-semibold" style={{ background: WA.teal }}>
          {(creator.primary_name || '?')[0]?.toUpperCase()}
        </div>
        {unread && <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full" style={{ background: '#ef4444', boxShadow: '0 0 0 3px white' }} />}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="font-semibold text-sm truncate" style={{ color: WA.textDark }}>{creator.primary_name || 'Unknown'}</div>
          {statusMeta && (
            <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold" style={{ background: statusMeta.bg, color: statusMeta.accent }}>
              {statusMeta.label}
            </span>
          )}
          {lifecycleLabel && (
            <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold" style={{ background: WA.shellAccentSoft, color: WA.teal }}>
              {lifecycleLabel}
            </span>
          )}
          {!waJoined && creator?.lifecycle?.stage_key === 'acquisition' && (
            <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold" style={{ background: 'rgba(100,116,139,0.12)', color: '#475569' }}>
              未入WA
            </span>
          )}
          {referralActive && (
            <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold" style={{ background: 'rgba(13,148,136,0.12)', color: '#0d9488' }}>
              推荐中
            </span>
          )}
          {hasConflicts && (
            <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold" style={{ background: 'rgba(239,68,68,0.12)', color: '#dc2626' }}>
              冲突
            </span>
          )}
        </div>
        <div className="text-xs truncate" style={{ color: WA.textMuted }}>{creator.wa_phone || '-'} · {creator.wa_owner || '-'}</div>
      </div>

      <div className="text-xs text-right shrink-0" style={{ color: WA.textMuted }}>{formatChatListTime(creator.last_active || creator.updated_at)}</div>
    </button>
  )
}

function formatChatListTime(ts) {
  if (!ts) return ''
  const d = new Date(ts)
  const now = new Date()
  const sameDay = d.toDateString() === now.toDateString()
  return sameDay ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : `${d.getMonth() + 1}/${d.getDate()}`
}

function getStatusMeta(c) {
  if (!c) return null
  const w = c._full?.wacrm || c.wacrm || {}
  const jb = c._full?.joinbrands || c.joinbrands || {}
  if (jb.ev_churned) return { label: '流失', accent: '#ef4444', bg: '#fee2e2' }
  if (w.priority === 'high' || w.priority === 'urgent') return { label: '高优', accent: '#f97316', bg: '#ffedd5' }
  if (jb.ev_trial_active) return { label: '七日挑战', accent: '#3b82f6', bg: '#dbeafe' }
  if (jb.ev_monthly_started || jb.ev_monthly_joined) return { label: '月度挑战', accent: '#8b5cf6', bg: '#ede9fe' }
  return null
}

function Select({ value, onChange, options }) {
  return (
    <select
      className="w-full text-[12px] px-3 py-2 rounded-xl"
      style={{ background: WA.white, color: WA.textDark, border: `1px solid ${WA.borderLight}` }}
      value={value}
      onChange={e => onChange(e.target.value)}
    >
      {options.map(([val, label]) => <option key={val || 'all'} value={val}>{label}</option>)}
    </select>
  )
}

function getLifecycleLabel(stageKey) {
  const map = {
    acquisition: '获取',
    activation: '激活',
    retention: '留存',
    revenue: '变现',
    terminated: '终止池',
  }
  return map[stageKey] || ''
}

function normalizeOwner(raw) {
  const value = String(raw || '').trim().toLowerCase()
  if (!value) return 'Yiyun'
  const aliasMap = {
    beau: 'Beau',
    yiyun: 'Yiyun',
    jiawen: 'Jiawen',
  }
  return aliasMap[value] || 'Yiyun'
}
