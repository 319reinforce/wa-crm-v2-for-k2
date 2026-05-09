import React from 'react'
import WA from '../../utils/waTheme'

export function PanelError({ message, onRetry, retryLabel = '重试' }) {
  if (!message) return null
  return (
    <div
      role="alert"
      className="rounded-[18px] px-4 py-3 text-[13px] flex items-center justify-between gap-3"
      style={{ background: 'rgba(220,38,38,0.08)', color: '#b91c1c', border: '1px solid rgba(220,38,38,0.16)' }}
    >
      <span>{message}</span>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="rounded-full px-3 py-1 text-[12px] font-semibold"
          style={{ background: WA.white, color: '#b91c1c', border: '1px solid rgba(220,38,38,0.18)' }}
        >
          {retryLabel}
        </button>
      )}
    </div>
  )
}

export function PanelLoading({ message = '加载中...' }) {
  return (
    <div className="flex items-center justify-center py-16 gap-3" style={{ color: WA.textMuted }}>
      <span aria-hidden="true">⏳</span>
      <span className="text-sm">{message}</span>
    </div>
  )
}

export function PanelEmpty({ icon = '·', title = '暂无数据', detail = '' }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 gap-2 text-center" style={{ color: WA.textMuted }}>
      <span className="text-3xl" aria-hidden="true">{icon}</span>
      <span className="text-sm">{title}</span>
      {detail ? <span className="text-xs">{detail}</span> : null}
    </div>
  )
}
