import React from 'react'
import WA from '../../utils/waTheme'

export default function MobileScreenHeader({
  title,
  subtitle,
  onBack,
  right,
  compact = false,
  children,
}) {
  return (
    <header
      className="shrink-0 flex flex-col border-b"
      style={{
        background: WA.shellPanelStrong,
        borderColor: WA.borderLight,
        paddingTop: 'env(safe-area-inset-top)',
      }}
    >
      <div className={`flex items-center gap-2 min-w-0 ${compact ? 'px-3 py-2' : 'px-4 py-3'}`}>
        {onBack && (
          <button
            onClick={onBack}
            className="inline-flex items-center justify-center shrink-0 rounded-full"
            style={{
              width: 44,
              height: 44,
              fontSize: 20,
              background: WA.white,
              color: WA.textMuted,
              border: `1px solid ${WA.borderLight}`,
            }}
            aria-label="返回"
          >
            ←
          </button>
        )}
        <div className="flex-1 min-w-0">
          {title && (
            <div className="text-[16px] font-semibold truncate" style={{ color: WA.textDark, letterSpacing: '-0.02em' }}>
              {title}
            </div>
          )}
          {subtitle && (
            <div className="text-[12px] truncate" style={{ color: WA.textMuted }}>
              {subtitle}
            </div>
          )}
        </div>
        {right && <div className="flex items-center gap-1.5 shrink-0">{right}</div>}
      </div>
      {children}
    </header>
  )
}
