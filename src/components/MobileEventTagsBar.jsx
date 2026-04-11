import React from 'react'
import WA from '../utils/waTheme'

export function MobileEventTagsBar({ creator, statusMeta, visible }) {
  if (!creator?.joinbrands) return null

  return (
    <div
      className="overflow-x-auto px-4 py-2 gap-2 transition-all duration-200"
      style={{
        background: WA.white,
        borderBottom: `1px solid ${WA.borderLight}`,
        maxHeight: visible ? '60px' : '0',
        overflowX: 'auto',
        overflowY: 'hidden',
        opacity: visible ? 1 : 0,
      }}
    >
      <div className="flex gap-2">
        {statusMeta?.label && (
          <span className="text-xs px-3 py-1 rounded-full font-semibold shrink-0" style={{ background: statusMeta.bg, color: statusMeta.accent }}>
            {statusMeta.label}
          </span>
        )}
        {creator.joinbrands.ev_trial_active && <span className="text-xs px-3 py-1 rounded-full font-semibold shrink-0" style={{ background: '#3b82f618', color: '#3b82f6' }}>七日挑战进行中</span>}
        {creator.joinbrands.ev_monthly_started && <span className="text-xs px-3 py-1 rounded-full font-semibold shrink-0" style={{ background: '#8b5cf618', color: '#8b5cf6' }}>开启月度挑战</span>}
        {creator.joinbrands.ev_monthly_joined && <span className="text-xs px-3 py-1 rounded-full font-semibold shrink-0" style={{ background: '#10b98118', color: '#10b981' }}>月卡加入</span>}
        {creator.joinbrands.ev_whatsapp_shared && <span className="text-xs px-3 py-1 rounded-full font-semibold shrink-0" style={{ background: '#00a88418', color: '#00a884' }}>WA已发</span>}
        {creator.joinbrands.ev_gmv_1k && <span className="text-xs px-3 py-1 rounded-full font-semibold shrink-0" style={{ background: '#f59e0b18', color: '#f59e0b' }}>GMV 1K</span>}
        {creator.joinbrands.ev_gmv_2k && <span className="text-xs px-3 py-1 rounded-full font-semibold shrink-0" style={{ background: '#f9731618', color: '#f97316' }}>GMV 2K</span>}
        {creator.joinbrands.ev_gmv_5k && <span className="text-xs px-3 py-1 rounded-full font-semibold shrink-0" style={{ background: '#f9731618', color: '#f97316' }}>GMV 5K</span>}
        {creator.joinbrands.ev_gmv_10k && <span className="text-xs px-3 py-1 rounded-full font-semibold shrink-0" style={{ background: '#ef444418', color: '#ef4444' }}>GMV 10K</span>}
        {creator.joinbrands.ev_churned && <span className="text-xs px-3 py-1 rounded-full font-semibold shrink-0" style={{ background: '#ef444418', color: '#ef4444' }}>已流失</span>}
      </div>
    </div>
  )
}
