import React, { useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useCreators } from './useApi'

const WA = {
  darkHeader: '#111b21',
  teal: '#00a884',
  lightBg: '#f0f2f5',
  textDark: '#111b21',
  textMuted: '#667781',
  borderLight: '#e9edef',
}

export default function MobileListScreen() {
  const [search, setSearch] = useState('')
  const [searchParams] = useSearchParams()
  const owner = useMemo(() => normalizeOwner(searchParams.get('op')), [searchParams])
  const [filterBeta, setFilterBeta] = useState('')
  const [filterPriority, setFilterPriority] = useState('')
  const [filterAgency, setFilterAgency] = useState('')
  const [filterEvent, setFilterEvent] = useState('')
  const [filterLifecycle, setFilterLifecycle] = useState('')
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

  return (
    <div className="min-h-screen flex flex-col" style={{ background: WA.lightBg }}>
      <header className="px-4 py-3 flex items-center gap-3" style={{ background: WA.darkHeader }}>
        <div className="w-9 h-9 rounded-full flex items-center justify-center text-white font-bold" style={{ background: WA.teal }}>WA</div>
        <div className="flex-1 min-w-0">
          <div className="text-white font-semibold">{owner} 达人列表</div>
          <div className="text-xs text-white/60">Tap 进入聊天，再点详情</div>
        </div>
      </header>

      <div className="p-3 space-y-2" style={{ background: WA.darkHeader }}>
        <div className="text-xs px-2 py-1 rounded-lg inline-flex items-center gap-2" style={{ background: '#1f2c33', color: '#cbd5e1' }}>
          <span className="w-2 h-2 rounded-full" style={{ background: WA.teal }} />
          仅显示 {owner} 负责的达人
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Select value={filterBeta} onChange={setFilterBeta} options={[
            ['', 'Beta'],
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
            ['revenue', '收入'],
            ['referral', '传播'],
            ['terminated', '终止池'],
          ]} />
        </div>
        {(filterBeta || filterPriority || filterAgency || filterEvent || filterLifecycle) && (
          <button
            onClick={() => { setFilterBeta(''); setFilterPriority(''); setFilterAgency(''); setFilterEvent(''); setFilterLifecycle('') }}
            className="w-full text-xs py-1.5 rounded-lg text-center font-medium"
            style={{ color: '#ef4444', background: 'rgba(239,68,68,0.12)' }}
          >
            清除筛选
          </button>
        )}
        <div className="flex items-center gap-2 px-3 py-2 rounded-xl" style={{ background: '#1f2c33' }}>
          <span className="text-white/60">🔍</span>
          <input
            className="flex-1 bg-transparent text-sm text-white placeholder-white/40 focus:outline-none"
            placeholder="搜索姓名/电话"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          {search && <button onClick={() => setSearch('')} className="text-white/60">✕</button>}
        </div>
      </div>

      <div className="px-4 py-2 text-xs" style={{ color: WA.textMuted }}>
        {filtered.length} / {creators.length} 位达人
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-12 text-sm" style={{ color: WA.textMuted }}>加载中...</div>
        ) : filtered.length === 0 ? (
          <div className="flex items-center justify-center py-12 text-sm" style={{ color: WA.textMuted }}>没有找到达人</div>
        ) : (
          <div className="divide-y" style={{ borderColor: WA.borderLight }}>
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
  return (
    <button
      onClick={onClick}
      className="w-full text-left px-4 py-3 flex items-center gap-3 bg-white active:opacity-80"
      style={{ borderBottom: `1px solid ${WA.borderLight}` }}
    >
      <div className="relative">
        <div className="w-10 h-10 rounded-full flex items-center justify-center text-white font-semibold" style={{ background: WA.teal }}>
          {(creator.primary_name || '?')[0]?.toUpperCase()}
        </div>
        {unread && <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full" style={{ background: '#ef4444', boxShadow: '0 0 0 3px white' }} />}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <div className="font-semibold text-sm truncate" style={{ color: WA.textDark }}>{creator.primary_name || 'Unknown'}</div>
          {statusMeta && (
            <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold" style={{ background: statusMeta.bg, color: statusMeta.accent }}>
              {statusMeta.label}
            </span>
          )}
          {lifecycleLabel && (
            <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold" style={{ background: 'rgba(0,168,132,0.10)', color: WA.teal }}>
              {lifecycleLabel}
            </span>
          )}
        </div>
        <div className="text-xs" style={{ color: WA.textMuted }}>{creator.wa_phone || '-'} · {creator.wa_owner || '-'}</div>
      </div>
      <div className="text-xs text-right" style={{ color: WA.textMuted }}>{formatChatListTime(creator.last_active || creator.updated_at)}</div>
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
      className="w-full text-sm px-3 py-2 rounded-xl"
      style={{ background: '#1f2c33', color: '#e2e8f0', border: '1px solid rgba(255,255,255,0.08)' }}
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
    revenue: '收入',
    referral: '传播',
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
