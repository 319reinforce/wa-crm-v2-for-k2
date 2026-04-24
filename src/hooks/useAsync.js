import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * 异步执行封装，内置防重入 + 组件卸载 abort。
 *
 * 使用：
 *   const sendAsync = useAsync(async (text, { signal }) => {
 *     const res = await fetch('/api/send', { method: 'POST', body: text, signal })
 *     return res.json()
 *   })
 *   // sendAsync.run(text) — loading 时二次调用返回 undefined
 *   // sendAsync.loading / sendAsync.error / sendAsync.reset()
 *
 * @param {(...args: any[]) => Promise<any>} fn
 *   业务函数。最后一个参数会被注入 `{ signal }`，供内部 fetch 使用。
 * @returns {{
 *   run: (...args: any[]) => Promise<any>,
 *   loading: boolean,
 *   error: Error | null,
 *   reset: () => void,
 *   cancel: () => void,
 * }}
 */
export default function useAsync(fn) {
  const fnRef = useRef(fn)
  fnRef.current = fn

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const runningRef = useRef(false)
  const abortRef = useRef(null)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      if (abortRef.current) abortRef.current.abort()
    }
  }, [])

  const run = useCallback(async (...args) => {
    if (runningRef.current) return undefined
    runningRef.current = true

    const controller = new AbortController()
    abortRef.current = controller

    if (mountedRef.current) {
      setLoading(true)
      setError(null)
    }

    try {
      const result = await fnRef.current(...args, { signal: controller.signal })
      return result
    } catch (err) {
      if (controller.signal.aborted) return undefined
      if (mountedRef.current) setError(err instanceof Error ? err : new Error(String(err)))
      throw err
    } finally {
      runningRef.current = false
      if (mountedRef.current) setLoading(false)
      if (abortRef.current === controller) abortRef.current = null
    }
  }, [])

  const reset = useCallback(() => {
    if (mountedRef.current) setError(null)
  }, [])

  const cancel = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort()
      abortRef.current = null
    }
    runningRef.current = false
    if (mountedRef.current) setLoading(false)
  }, [])

  return { run, loading, error, reset, cancel }
}
