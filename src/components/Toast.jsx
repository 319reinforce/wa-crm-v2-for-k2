import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

const ToastContext = createContext(null)

const TOAST_BG = {
  info: '#1f2937',
  success: '#047857',
  error: '#b91c1c',
  warning: '#b45309',
}

let idSeq = 0

export function ToastProvider({ children, defaultDuration = 3200 }) {
  const [toasts, setToasts] = useState([])
  const timersRef = useRef(new Map())

  const dismiss = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
    const timer = timersRef.current.get(id)
    if (timer) {
      clearTimeout(timer)
      timersRef.current.delete(id)
    }
  }, [])

  const push = useCallback((message, options = {}) => {
    if (!message) return null
    const id = ++idSeq
    const toast = {
      id,
      message: typeof message === 'string' ? message : String(message),
      type: options.type || 'info',
      duration: options.duration == null ? defaultDuration : options.duration,
    }
    setToasts((prev) => [...prev, toast])
    if (toast.duration > 0) {
      const timer = setTimeout(() => dismiss(id), toast.duration)
      timersRef.current.set(id, timer)
    }
    return id
  }, [defaultDuration, dismiss])

  useEffect(() => {
    return () => {
      for (const timer of timersRef.current.values()) clearTimeout(timer)
      timersRef.current.clear()
    }
  }, [])

  const api = useRef({
    show: push,
    info: (msg, opts) => push(msg, { ...opts, type: 'info' }),
    success: (msg, opts) => push(msg, { ...opts, type: 'success' }),
    error: (msg, opts) => push(msg, { ...opts, type: 'error' }),
    warning: (msg, opts) => push(msg, { ...opts, type: 'warning' }),
    dismiss,
  })
  api.current.show = push
  api.current.info = (msg, opts) => push(msg, { ...opts, type: 'info' })
  api.current.success = (msg, opts) => push(msg, { ...opts, type: 'success' })
  api.current.error = (msg, opts) => push(msg, { ...opts, type: 'error' })
  api.current.warning = (msg, opts) => push(msg, { ...opts, type: 'warning' })
  api.current.dismiss = dismiss

  return (
    <ToastContext.Provider value={api.current}>
      {children}
      {typeof document !== 'undefined' && createPortal(
        <div
          style={{
            position: 'fixed',
            top: 20,
            right: 20,
            zIndex: 2147483646,
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            pointerEvents: 'none',
            maxWidth: 'min(360px, calc(100vw - 40px))',
          }}
        >
          {toasts.map((t) => (
            <div
              key={t.id}
              role="status"
              onClick={() => dismiss(t.id)}
              style={{
                pointerEvents: 'auto',
                background: TOAST_BG[t.type] || TOAST_BG.info,
                color: '#fff',
                padding: '10px 14px',
                borderRadius: 10,
                boxShadow: '0 8px 24px rgba(0,0,0,0.18)',
                fontSize: 13,
                lineHeight: 1.5,
                cursor: 'pointer',
                wordBreak: 'break-word',
              }}
            >
              {t.message}
            </div>
          ))}
        </div>,
        document.body,
      )}
    </ToastContext.Provider>
  )
}

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) {
    return {
      show: (msg) => { if (typeof window !== 'undefined' && msg) window.alert(msg) },
      info: (msg) => { if (typeof window !== 'undefined' && msg) window.alert(msg) },
      success: (msg) => { if (typeof window !== 'undefined' && msg) window.alert(msg) },
      error: (msg) => { if (typeof window !== 'undefined' && msg) window.alert(msg) },
      warning: (msg) => { if (typeof window !== 'undefined' && msg) window.alert(msg) },
      dismiss: () => {},
    }
  }
  return ctx
}
