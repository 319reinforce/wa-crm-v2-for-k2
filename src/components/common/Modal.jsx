import React, { useCallback, useEffect } from 'react'
import { createPortal } from 'react-dom'

/**
 * 通用 Modal 组件 —— 统一 ESC 关闭、backdrop 点击关闭、可选 busy 锁。
 *
 * props:
 *  - open: boolean
 *  - onClose: () => void
 *  - title?: ReactNode
 *  - children: ReactNode
 *  - footer?: ReactNode
 *  - busy?: boolean                 业务在异步中
 *  - confirmWhenBusy?: string       busy 时尝试关闭弹确认；值为确认文案
 *  - dismissOnBackdrop?: boolean    默认 true
 *  - dismissOnEsc?: boolean         默认 true
 *  - width?: number|string          默认 520
 *  - widthClass?: string            与 width 二选一，传 tailwind 宽度类
 *  - bodyClassName?: string
 *  - containerStyle?: object        容器样式覆盖
 *  - zIndex?: number                默认 2147483000
 */
export default function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  busy = false,
  confirmWhenBusy,
  dismissOnBackdrop = true,
  dismissOnEsc = true,
  width = 520,
  widthClass,
  bodyClassName,
  containerStyle,
  zIndex = 2147483000,
}) {
  const handleClose = useCallback(() => {
    if (busy) {
      if (confirmWhenBusy) {
        const ok = typeof window !== 'undefined' && window.confirm(confirmWhenBusy)
        if (!ok) return
      } else {
        return
      }
    }
    onClose?.()
  }, [busy, confirmWhenBusy, onClose])

  useEffect(() => {
    if (!open || !dismissOnEsc) return undefined
    const handler = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        handleClose()
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open, dismissOnEsc, handleClose])

  if (!open || typeof document === 'undefined') return null

  const widthStyle = widthClass ? {} : { width: 'min(92vw, ' + (typeof width === 'number' ? width + 'px' : width) + ')' }

  return createPortal(
    <div
      role="presentation"
      onClick={(e) => {
        if (!dismissOnBackdrop) return
        if (e.target === e.currentTarget) handleClose()
      }}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(15,23,42,0.45)',
        zIndex,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
        ...containerStyle,
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        className={widthClass}
        style={{
          background: '#fff',
          borderRadius: 14,
          boxShadow: '0 20px 60px rgba(15,23,42,0.28)',
          maxHeight: 'calc(100vh - 32px)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          ...widthStyle,
        }}
      >
        {(title || onClose) ? (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '14px 18px',
              borderBottom: '1px solid rgba(15,23,42,0.08)',
              fontWeight: 600,
              fontSize: 15,
              color: '#0f172a',
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>{title}</div>
            <button
              type="button"
              onClick={handleClose}
              aria-label="关闭"
              style={{
                background: 'transparent',
                border: 'none',
                fontSize: 20,
                lineHeight: 1,
                padding: 4,
                cursor: 'pointer',
                color: '#64748b',
              }}
            >
              ✕
            </button>
          </div>
        ) : null}
        <div
          className={bodyClassName}
          style={{
            flex: 1,
            overflow: 'auto',
            padding: 18,
          }}
        >
          {children}
        </div>
        {footer ? (
          <div
            style={{
              padding: '12px 18px',
              borderTop: '1px solid rgba(15,23,42,0.08)',
              display: 'flex',
              gap: 8,
              justifyContent: 'flex-end',
              background: '#f8fafc',
            }}
          >
            {footer}
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  )
}
