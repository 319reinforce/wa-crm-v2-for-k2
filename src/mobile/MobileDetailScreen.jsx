import React from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { CreatorDetail } from '../components/CreatorDetail'
import WA from '../utils/waTheme'

export default function MobileDetailScreen() {
  const { id } = useParams()
  const nav = useNavigate()

  return (
    <div className="min-h-screen flex flex-col" style={{ background: WA.lightBg }}>
      <header className="px-4 py-3 flex items-center gap-3" style={{ background: WA.darkHeader }}>
        <button onClick={() => nav(`/m/chat/${id}`)} className="text-white/80 text-lg">←</button>
        <div className="flex-1 text-sm font-semibold text-white">达人详情</div>
        <button onClick={() => nav('/m')} className="text-white/70 text-sm">返回列表</button>
      </header>

      <div className="flex-1 overflow-hidden">
        <CreatorDetail
          creatorId={id}
          creatorName=""
          onClose={() => nav(`/m/chat/${id}`)}
          onCreatorUpdated={() => {}}
          onMessageSent={() => {}}
          asPanel
        />
      </div>
    </div>
  )
}
