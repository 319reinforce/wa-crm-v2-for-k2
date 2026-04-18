import React, { useState } from 'react'
import WA from '../../utils/waTheme'
import MobileBottomSheet from './MobileBottomSheet'
import AuthSessionControls from '../AuthSessionControls'

export default function MobileAuthMenu({ onRefresh, loading }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center justify-center shrink-0 rounded-full"
        style={{
          width: 48,
          height: 48,
          background: WA.white,
          color: WA.textMuted,
          border: `1px solid ${WA.borderLight}`,
        }}
        aria-label="更多"
        title="更多"
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <circle cx="5" cy="12" r="2" />
          <circle cx="12" cy="12" r="2" />
          <circle cx="19" cy="12" r="2" />
        </svg>
      </button>
      <MobileBottomSheet open={open} onClose={() => setOpen(false)} title="更多" maxHeight="60dvh">
        <div className="space-y-3 py-1">
          {onRefresh && (
            <button
              onClick={() => { onRefresh(); setOpen(false) }}
              disabled={loading}
              className="w-full inline-flex items-center gap-3 rounded-2xl disabled:opacity-50"
              style={{
                minHeight: 56,
                padding: '0 16px',
                background: WA.white,
                color: WA.textDark,
                border: `1px solid ${WA.borderLight}`,
              }}
            >
              <span style={{ fontSize: 18 }}>{loading ? '⋯' : '↻'}</span>
              <span className="text-[14px] font-semibold">刷新数据</span>
            </button>
          )}
          <div className="text-[11px] font-semibold tracking-[0.08em] uppercase pt-2 pb-1" style={{ color: WA.textMuted }}>
            账户
          </div>
          <div className="flex flex-wrap gap-2">
            <AuthSessionControls compact />
          </div>
        </div>
      </MobileBottomSheet>
    </>
  )
}
