import React, { useCallback, useRef, useState } from 'react'

/**
 * 异步按钮 —— 自动处理 loading / disabled / 防重入。
 *
 * props:
 *  - onClick: (e) => Promise<void> | void
 *  - disabled?: boolean
 *  - loading?: boolean          外部传入的 loading（优先于内部）
 *  - spinner?: ReactNode        loading 时替换文本；不传则显示 "…"
 *  - children: ReactNode
 *  - type / className / style / title / ...其他按钮属性
 */
export default function AsyncButton({
  onClick,
  disabled = false,
  loading: externalLoading,
  spinner,
  children,
  type = 'button',
  ...rest
}) {
  const [internalLoading, setInternalLoading] = useState(false)
  const busyRef = useRef(false)
  const loading = externalLoading != null ? externalLoading : internalLoading

  const handleClick = useCallback(async (e) => {
    if (!onClick || disabled || loading || busyRef.current) return
    busyRef.current = true
    if (externalLoading == null) setInternalLoading(true)
    try {
      await onClick(e)
    } finally {
      busyRef.current = false
      if (externalLoading == null) setInternalLoading(false)
    }
  }, [onClick, disabled, loading, externalLoading])

  return (
    <button
      type={type}
      onClick={handleClick}
      disabled={disabled || loading}
      {...rest}
    >
      {loading ? (spinner != null ? spinner : '…') : children}
    </button>
  )
}
