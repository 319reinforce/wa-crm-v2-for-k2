import React from 'react'
import WA from '../../utils/waTheme'

const ICONS = {
  creators: (active) => (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2.2 : 1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 20l1.5-4.5A7 7 0 1 1 9 19Z" />
    </svg>
  ),
  events: (active) => (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2.2 : 1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="5" width="18" height="16" rx="3" />
      <path d="M8 3v4M16 3v4M3 10h18" />
    </svg>
  ),
  strategy: (active) => (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2.2 : 1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3v18M5 8l7-5 7 5M5 16l7 5 7-5" />
    </svg>
  ),
  sft: (active) => (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2.2 : 1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 20V10M12 20V4M20 20v-7" />
    </svg>
  ),
  accounts: (active) => (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2.2 : 1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21a8 8 0 0 1 16 0" />
    </svg>
  ),
}

export default function MobileBottomNav({ tabs, activeTab, onChange }) {
  return (
    <nav
      className="shrink-0 flex items-stretch border-t"
      style={{
        background: WA.shellPanelStrong,
        borderColor: WA.borderLight,
        paddingBottom: 'env(safe-area-inset-bottom)',
      }}
      aria-label="主导航"
    >
      {tabs.map((tab) => {
        const active = activeTab === tab.key
        const Icon = ICONS[tab.key] || ICONS.creators
        return (
          <button
            key={tab.key}
            onClick={() => onChange(tab.key)}
            className="flex-1 inline-flex flex-col items-center justify-center transition-colors"
            style={{
              minHeight: 60,
              gap: 2,
              color: active ? WA.teal : WA.textMuted,
              background: active ? WA.shellAccentSoft : 'transparent',
            }}
            aria-label={tab.label}
            aria-current={active ? 'page' : undefined}
          >
            {Icon(active)}
            <span className="text-[11px] font-semibold" style={{ letterSpacing: '-0.01em' }}>
              {tab.label}
            </span>
          </button>
        )
      })}
    </nav>
  )
}
