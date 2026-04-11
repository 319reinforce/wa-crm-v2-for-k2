import React from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useCreatorDetail } from './useApi'
import { WAMessageComposer } from '../components/WAMessageComposer'

const WA = {
  darkHeader: '#111b21',
  teal: '#00a884',
  chatBg: '#efeae2',
  textMuted: '#667781',
}

export default function MobileChatScreen() {
  const { id } = useParams()
  const { creator, loading } = useCreatorDetail(id)
  const nav = useNavigate()

  if (loading || !creator) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: WA.chatBg, color: WA.textMuted }}>
        加载中...
      </div>
    )
  }

  const clientInfo = {
    id: creator.id,
    phone: creator.wa_phone,
    name: creator.primary_name,
    wa_owner: creator.wa_owner,
    conversion_stage: creator?.wacrm?.beta_status || 'unknown',
  }

  return (
    <div className="min-h-screen flex flex-col" style={{ background: WA.chatBg }}>
      <header className="px-4 py-3 flex items-center gap-3" style={{ background: WA.darkHeader }}>
        <button onClick={() => nav('/m')} className="text-white/80 text-lg">←</button>
        <div className="w-9 h-9 rounded-full flex items-center justify-center text-white font-bold" style={{ background: WA.teal }}>
          {(creator.primary_name || '?')[0]?.toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-white truncate">{creator.primary_name}</div>
          <div className="text-xs text-white/60 truncate">{creator.wa_phone}</div>
        </div>
        <button onClick={() => nav(`/m/chat/${creator.id}/detail`)} className="text-white/80 text-lg" title="查看详情">ℹ️</button>
      </header>

      <div className="flex-1 overflow-hidden">
        <WAMessageComposer
          client={clientInfo}
          creator={creator}
          onClose={() => nav('/m')}
          onSwipeLeft={() => nav('/m')}
          onMessageSent={() => {}}
          asPanel
        />
      </div>
    </div>
  )
}
