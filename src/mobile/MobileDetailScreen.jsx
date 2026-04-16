import React from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import AuthSessionControls from '../components/AuthSessionControls'
import { CreatorDetail } from '../components/CreatorDetail'
import WA from '../utils/waTheme'

export default function MobileDetailScreen() {
  const { id } = useParams()
  const [searchParams] = useSearchParams()
  const op = String(searchParams.get('op') || '').trim().toLowerCase()
  const nav = useNavigate()

  const goChat = () => nav(`/m/chat/${id}?op=${op || 'yiyun'}`)
  const goList = () => nav(`/m?op=${op || 'yiyun'}`)

  return (
    <div className="min-h-screen app-shell flex flex-col p-3 gap-2.5" style={{ background: WA.shellBg }}>
      <header className="docs-panel-strong px-3 py-2.5 flex items-center gap-3 shrink-0" style={{ background: WA.shellPanelStrong }}>
        <button onClick={goChat} className="w-8 h-8 rounded-full text-lg" style={{ color: WA.textMuted, background: WA.shellPanelMuted }}>←</button>
        <div className="flex-1 text-sm font-semibold" style={{ color: WA.textDark }}>达人详情</div>
        <button onClick={goList} className="px-2.5 py-1.5 rounded-full text-xs font-semibold" style={{ background: WA.shellPanelMuted, color: WA.textMuted }}>
          返回列表
        </button>
        <AuthSessionControls compact />
      </header>

      <div className="flex-1 min-h-0 docs-panel overflow-hidden" style={{ background: WA.shellPanelStrong }}>
        <CreatorDetail
          creatorId={id}
          creatorName=""
          onClose={goChat}
          onCreatorUpdated={() => {}}
          onMessageSent={() => {}}
          asPanel
        />
      </div>
    </div>
  )
}
