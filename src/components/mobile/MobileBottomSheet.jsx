import React, { useEffect } from 'react'
import WA from '../../utils/waTheme'

export default function MobileBottomSheet({ open, onClose, title, children, maxHeight = '80dvh' }) {
  useEffect(() => {
    if (!open) return undefined
    const onKey = (e) => { if (e.key === 'Escape') onClose?.() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-end" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div
        className="relative w-full flex flex-col"
        style={{
          background: WA.shellPanelStrong,
          borderTopLeftRadius: 24,
          borderTopRightRadius: 24,
          boxShadow: WA.shellShadow,
          maxHeight,
          paddingBottom: 'env(safe-area-inset-bottom)',
        }}
      >
        <div className="shrink-0 flex items-center justify-between px-4 pt-3 pb-2">
          <div className="flex-1 flex items-center gap-2">
            <span className="w-8 h-1 rounded-full" style={{ background: WA.shellBorderStrong }} />
            {title && (
              <div className="text-[14px] font-semibold ml-1" style={{ color: WA.textDark }}>
                {title}
              </div>
            )}
          </div>
          <button
            onClick={onClose}
            className="inline-flex items-center justify-center rounded-full"
            style={{
              width: 44,
              height: 44,
              background: WA.white,
              color: WA.textMuted,
              border: `1px solid ${WA.borderLight}`,
            }}
            aria-label="关闭"
          >
            ✕
          </button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-4">{children}</div>
      </div>
    </div>
  )
}
