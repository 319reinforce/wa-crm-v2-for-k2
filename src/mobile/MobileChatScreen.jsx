import React from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import AuthSessionControls from '../components/AuthSessionControls'
import { useCreatorDetail } from './useApi'
import { WAMessageComposer } from '../components/WAMessageComposer'
import WA from '../utils/waTheme'

export default function MobileChatScreen() {
  const { id } = useParams()
  const [searchParams] = useSearchParams()
  const op = String(searchParams.get('op') || '').trim().toLowerCase()
  const { creator, loading, error, reload } = useCreatorDetail(id)
  const nav = useNavigate()

  const backToList = () => nav(`/m?op=${op || 'yiyun'}`)

  if (loading) {
    return (
      <div className="min-h-screen app-shell p-3 flex items-center justify-center" style={{ background: WA.shellBg }}>
        <div className="docs-panel-strong px-6 py-5 text-sm" style={{ color: WA.textMuted }}>
          加载中...
        </div>
      </div>
    )
  }

  if (!creator) {
    return (
      <div className="min-h-screen app-shell p-3 flex items-center justify-center" style={{ background: WA.shellBg }}>
        <div className="docs-panel-strong px-6 py-5 text-center space-y-3">
          <div className="text-sm" style={{ color: WA.textMuted }}>{error || '达人详情加载失败'}</div>
          <div className="flex gap-2 justify-center">
            <button onClick={() => reload()} className="px-3 py-1.5 rounded-full text-sm text-white" style={{ background: WA.teal }}>
              重试
            </button>
            <button onClick={backToList} className="px-3 py-1.5 rounded-full text-sm" style={{ background: WA.shellPanelMuted, color: WA.textDark }}>
              返回列表
            </button>
          </div>
        </div>
      </div>
    )
  }

  const clientInfo = {
    id: creator.id,
    phone: creator.wa_phone,
    name: creator.primary_name,
    wa_owner: creator.wa_owner,
    conversion_stage: creator?.lifecycle?.stage_key || creator?.wacrm?.beta_status || 'unknown',
    lifecycle_stage: creator?.lifecycle?.stage_key || 'unknown',
    lifecycle_label: creator?.lifecycle?.stage_label || null,
  }

  return (
    <div className="min-h-screen app-shell flex flex-col p-3 gap-2.5" style={{ background: WA.shellBg }}>
      <header className="docs-panel-strong px-3 py-2.5 flex items-center gap-3 shrink-0" style={{ background: WA.shellPanelStrong }}>
        <button onClick={backToList} className="w-8 h-8 rounded-full text-lg" style={{ color: WA.textMuted, background: WA.shellPanelMuted }}>←</button>
        <div className="w-9 h-9 rounded-2xl flex items-center justify-center text-white font-bold" style={{ background: WA.teal }}>
          {(creator.primary_name || '?')[0]?.toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold truncate" style={{ color: WA.textDark }}>{creator.primary_name}</div>
          <div className="text-xs truncate" style={{ color: WA.textMuted }}>{creator.wa_phone}</div>
        </div>
        <button
          onClick={() => nav(`/m/chat/${creator.id}/detail?op=${op || 'yiyun'}`)}
          className="px-2.5 py-1.5 rounded-full text-xs font-semibold"
          style={{ background: WA.shellPanelMuted, color: WA.textMuted }}
          title="查看详情"
        >
          详情
        </button>
        <AuthSessionControls compact />
      </header>

      <div className="flex-1 min-h-0 docs-panel overflow-hidden" style={{ background: WA.shellPanelStrong }}>
        <WAMessageComposer
          client={clientInfo}
          creator={creator}
          onClose={backToList}
          onSwipeLeft={backToList}
          onMessageSent={() => {}}
          asPanel
        />
      </div>
    </div>
  )
}
